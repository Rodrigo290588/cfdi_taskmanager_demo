import { Worker, Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { CFDI_IMPORT_QUEUE_NAME, resolveRedisConnection } from '@/lib/queue'
import unzipper from 'unzipper'
import fs from 'node:fs'
import { createInvoiceFromXml, parseInvoiceFromXml } from '@/lib/invoice-import'
import { CfdiType, ImportRunSource, ImportRunClassificationResult, ImportRunItemStatus } from '@prisma/client'
import { refreshHrMaterializedViews } from '@/lib/payroll-analytics-service'
import { refreshDireccionMaterializedViews } from '@/lib/direccion-analytics-service'
import { safeErrSummary } from '@/lib/security'
import { buildProviderReportFromXmlCandidates } from '@/lib/provider-cfdi-report'
import { persistProviderAcceptedCfdis } from '@/lib/provider-cfdi-storage'

async function resolveOrganizationId(companyId: string, companyRfc: string): Promise<string> {
  const fiscalEntity = await prisma.fiscalEntity.findFirst({
    where: { rfc: companyRfc, isActive: true },
    select: { organizationId: true }
  })
  
  if (fiscalEntity) {
    return fiscalEntity.organizationId
  }
  
  const companyAccess = await prisma.companyAccess.findFirst({
    where: { companyId },
    select: { organizationId: true }
  })
  
  if (companyAccess) {
    return companyAccess.organizationId
  }
  
  throw new Error(`Organización no encontrada para la empresa ${companyId}`)
}

type XmlProcessResult = {
  status: 'imported' | 'skipped' | 'error'
  isNomina: boolean
  errorDetail?: string
}

async function processEmitidoXml(xmlString: string, targetOrganizationId: string): Promise<XmlProcessResult> {
  const result = await createInvoiceFromXml(prisma, xmlString, undefined, targetOrganizationId, {
    importingOrganizationId: targetOrganizationId
  })
  
  const isNomina = result && typeof result === 'object' && 'cfdiType' in result && result.cfdiType === CfdiType.NOMINA
  
  if (result && typeof result === 'object') {
    if (result.status === 'skipped') return { status: 'skipped', isNomina, errorDetail: 'Comprobante duplicado u omitido' }
    if (result.status === 'error') return { status: 'error', isNomina, errorDetail: 'Error al insertar en base de datos (Emitido)' }
  }
  return { status: 'imported', isNomina }
}

async function processRecibidoXml(xmlString: string, targetOrganizationId: string, requestRfc: string, fileName: string): Promise<XmlProcessResult> {
  try {
    const parsed = parseInvoiceFromXml(xmlString)
    
    // Resolver contexto para portal de proveedores
    const member = await prisma.member.findFirst({
      where: { organizationId: targetOrganizationId, status: 'APPROVED' },
      select: { id: true, userId: true }
    })

    if (!member) {
      const msg = `No se encontró miembro aprobado para org ${targetOrganizationId}`
      console.warn(`[CfdiImport] ${msg}, saltando recibido`)
      return { status: 'error', isNomina: false, errorDetail: msg }
    }

    const company = await prisma.company.findUnique({
      where: { rfc: requestRfc },
      select: { id: true, rfc: true, businessName: true }
    })

    if (!company) {
      const msg = `Empresa receptora con RFC ${requestRfc} no encontrada en el sistema`
      console.warn(`[CfdiImport] ${msg}, saltando recibido`)
      return { status: 'error', isNomina: false, errorDetail: msg }
    }

    const report = await buildProviderReportFromXmlCandidates({
      candidates: [{ name: fileName, xml: xmlString }],
      context: {
        memberId: member.id,
        organizationId: targetOrganizationId,
        providerRfc: parsed.issuerRfc,
        providerName: parsed.issuerName,
        allowedCompanies: [{ id: company.id, rfc: company.rfc, businessName: company.businessName || '' }]
      },
      uploadedAt: new Date()
    })

    if (report.acceptedRecords.length > 0) {
      await persistProviderAcceptedCfdis({
        records: report.acceptedRecords,
        context: {
          organizationId: targetOrganizationId,
          memberId: member.id,
          providerRfc: parsed.issuerRfc,
          providerName: parsed.issuerName,
          allowedCompanies: [{ id: company.id, rfc: company.rfc }]
        },
        uploadedByUserId: member.userId
      })
      return { status: 'imported', isNomina: false }
    }
    
    const msg = report.errors[0] || 'Rechazado por validaciones de portal de proveedores'
    console.warn(`[CfdiImport] XML Recibido rechazado:`, report.errors)
    return { status: 'error', isNomina: false, errorDetail: msg }
  } catch (parseError) {
    const msg = `XML Inválido o mal formado: ${parseError instanceof Error ? parseError.message : String(parseError)}`
    console.warn(`[CfdiImport] Error parseando XML Recibido ${fileName}:`, parseError)
    return { status: 'error', isNomina: false, errorDetail: msg }
  }
}

async function processSingleXmlEntry(
  entry: unzipper.Entry,
  targetOrganizationId: string,
  requestRfc: string,
  requestRetrievalType: string
): Promise<XmlProcessResult> {
  try {
    const content = await entry.buffer()
    const xmlString = content.toString('utf8')
    
    // Clasificar y procesar según el tipo de recuperación (emitidos/recibidos)
    if (requestRetrievalType === 'emitidos') {
      return await processEmitidoXml(xmlString, targetOrganizationId)
    } else {
      return await processRecibidoXml(xmlString, targetOrganizationId, requestRfc, entry.path)
    }
  } catch (e) {
    const msg = `Error al leer el archivo desde el ZIP: ${e instanceof Error ? e.message : String(e)}`
    console.error(`[CfdiImport] Error importando XML ${entry.path}:`, e)
    return { status: 'error', isNomina: false, errorDetail: msg }
  }
}

type ZipProcessResult = {
  importedCount: number
  errorCount: number
  skippedCount: number
  hasNomina: boolean
  errorDetails: Array<{ fileName: string; reason: string }>
}

async function processZipStream(
  filePath: string, 
  targetOrganizationId: string, 
  requestRfc: string, 
  requestRetrievalType: string
): Promise<ZipProcessResult> {
  let importedCount = 0
  let errorCount = 0
  let skippedCount = 0
  let hasNomina = false
  const errorDetails: Array<{ fileName: string; reason: string }> = []

  const zip = fs.createReadStream(filePath).pipe(unzipper.Parse({ forceStream: true }))
  
  for await (const entry of zip) {
    const fileName = entry.path
    if (fileName.endsWith('.xml') || fileName.endsWith('.XML')) {
      const { status, isNomina, errorDetail } = await processSingleXmlEntry(entry, targetOrganizationId, requestRfc, requestRetrievalType)
      
      if (isNomina) hasNomina = true
      
      if (status === 'skipped') {
        skippedCount++
        errorDetails.push({ fileName, reason: errorDetail || 'Omitido (Duplicado o ignorado)' })
      } else if (status === 'error') {
        errorCount++
        errorDetails.push({ fileName, reason: errorDetail || 'Error de validación o base de datos' })
      } else {
        importedCount++
      }
    } else {
      entry.autodrain()
    }
  }

  return { importedCount, errorCount, skippedCount, hasNomina, errorDetails }
}

async function handleCfdiImportJob(job: Job) {
  const { requestId, idPaquete, filePath, rfc } = job.data

  try {
    console.log(`[CfdiImport] Procesando paquete CFDI ${idPaquete} (RFC: ${rfc})`)
    
    const request = await prisma.massDownloadRequest.findUnique({
      where: { id: requestId },
      include: { company: true }
    })

    if (!request) {
      throw new Error(`Request ${requestId} no encontrado`)
    }

    const targetOrganizationId = await resolveOrganizationId(request.company.id, request.company.rfc)

    console.log(`[CfdiImport] Descomprimiendo ZIP de ${idPaquete}...`)
    
    const { importedCount, errorCount, skippedCount, hasNomina, errorDetails } = await processZipStream(
      filePath, 
      targetOrganizationId, 
      request.company.rfc, 
      request.retrievalType
    )

    if (hasNomina) {
      console.log(`[CfdiImport] Refrescando vistas materializadas para el paquete ${idPaquete}...`)
      await refreshHrMaterializedViews(true).catch(e => console.error('[CfdiImport] refreshHrMaterializedViews failed:', safeErrSummary(e)))
      await refreshDireccionMaterializedViews(true).catch(e => console.error('[CfdiImport] refreshDireccionMaterializedViews failed:', safeErrSummary(e)))
      await prisma.$executeRawUnsafe('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_fiscal_conciliacion_mensual;').catch(e => console.error('[CfdiImport] mv_fiscal_conciliacion_mensual failed:', safeErrSummary(e)))
    }

    let satMsg = request.satMessage || ''
    satMsg += `\nCFDI procesados: ${importedCount} importados, ${skippedCount} omitidos, ${errorCount} errores.`

    const source: ImportRunSource = request.retrievalType === 'emitidos' ? ImportRunSource.JAVA_M2M : ImportRunSource.PROVIDER_PORTAL
    
    // 1. Crear el registro cabecera (ImportRun) para el monitor
    const totalItems = importedCount + errorCount + skippedCount
    const importRun = await prisma.importRun.create({
      data: {
        organizationId: targetOrganizationId,
        source: source,
        batchId: idPaquete,
        status: errorCount > 0 ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED',
        totalItems: totalItems,
        processedItems: totalItems,
        createdEmitted: request.retrievalType === 'emitidos' ? importedCount : 0,
        createdReceived: request.retrievalType === 'recibidos' ? importedCount : 0,
        skippedItems: skippedCount,
        errorItems: errorCount,
        startedAt: new Date(),
        finishedAt: new Date(),
      }
    })

    // 2. Insertar solo los detalles de los XML que fallaron u omitieron
    if (errorDetails.length > 0) {
      const itemsToInsert = errorDetails.map(err => ({
        importRunId: importRun.id,
        organizationId: targetOrganizationId,
        fileName: err.fileName,
        classificationResult: request.retrievalType === 'emitidos' ? ImportRunClassificationResult.EMITTED : ImportRunClassificationResult.RECEIVED,
        status: ImportRunItemStatus.FAILED,
        errorCode: 'VALIDATION_ERROR',
        errorMessage: err.reason,
        xmlSha256: 'ERROR_NO_HASH'
      }))
      
      // Batch insert de los errores
      await prisma.importRunItem.createMany({
        data: itemsToInsert
      })
    }

    await prisma.massDownloadRequest.update({
      where: { id: requestId },
      data: { satMessage: satMsg, importStatus: 'Completado', totalImported: importedCount }
    })

    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
      }
    } catch(e) {
       console.error(`[CfdiImport] Error eliminando archivo ZIP ${filePath}:`, e)
    }

    console.log(`[CfdiImport] Paquete ${idPaquete} procesado exitosamente.`)

  } catch (error) {
    console.error(`[CfdiImport] Error crítico procesando paquete ${idPaquete}:`, error)
    
    try {
      const errorMsg = error instanceof Error ? error.message : String(error)
      await prisma.massDownloadRequest.update({
        where: { id: requestId },
        data: { 
          satMessage: `Error en procesamiento CFDI: ${errorMsg}`,
          importStatus: 'Error'
        }
      })
    } catch (dbError) {
      console.error(`[CfdiImport] No se pudo actualizar estado de error para ${requestId}:`, dbError)
    }
    
    throw error
  }
}

export function setupCfdiImportWorker() {
  const worker = new Worker(CFDI_IMPORT_QUEUE_NAME, handleCfdiImportJob, {
    connection: resolveRedisConnection(),
    concurrency: 3
  })

  worker.on('failed', (job, err) => {
    console.error(`[CfdiImport] Job ${job?.id} falló:`, err)
  })

  return worker
}
