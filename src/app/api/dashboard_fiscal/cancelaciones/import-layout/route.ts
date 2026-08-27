import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as readline from 'node:readline'
import { Prisma, SatStatus } from '@prisma/client'
import { z } from 'zod'
import { buildDashboardScopedContext, dashboardJsonErrorResponse } from '@/lib/dashboard-fiscal-route-utils'
import { createAuditEntry } from '@/lib/audit'
import {
  parseCancellationLayoutLine,
  type ParsedCancellationLayoutRow
} from '@/lib/dashboard-fiscal-cancelaciones-layout'
import {
  resolveInvoiceIssuedSummaryRelatedAmounts,
  syncInvoiceIssuedDailySummaryRecordChange,
  type InvoiceIssuedSummarySource
} from '@/lib/invoice-issued-daily-summary'
import { prisma } from '@/lib/prisma'
import { SECURITY_HEADERS } from '@/lib/org-dashboard-helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const MAX_SIZE = 5 * 1024 * 1024

const importLayoutPayloadSchema = z.strictObject({
  companyId: z.string().uuid()
})

const invoiceSummarySelect = {
  id: true,
  uuid: true,
  issuerRfc: true,
  receiverRfc: true,
  receiverName: true,
  cfdiType: true,
  satStatus: true,
  paymentMethod: true,
  issuanceDate: true,
  subtotal: true,
  discount: true,
  total: true,
  ivaTransferred: true,
  ivaWithheld: true,
  isrWithheld: true,
  iepsWithheld: true,
  issuerFiscalEntityId: true,
  fiscalEntity: {
    select: {
      organizationId: true,
      rfc: true
    }
  },
  xmlContent: true,
  blob: {
    select: {
      xmlCiphertext: true,
      xmlIv: true,
      xmlAuthTag: true,
      xmlEncryptionAlg: true
    }
  }
} satisfies Prisma.InvoiceSelect

type InvoiceSummaryRecord = Prisma.InvoiceGetPayload<{ select: typeof invoiceSummarySelect }>

type ImportResultRow = {
  lineNumber: number
  uuid: string
  statusCol9: string
  cancelableCol10: string
  processCol11: string
  reason: string
  rawLine: string
}

type ImportSummary = {
  processed: number
  updated: number
  ignored: number
  notFound: number
  invalid: number
  unhandled: number
}

function getClientIp(request: NextRequest) {
  const forwardedFor = request.headers.get('x-forwarded-for')
  if (forwardedFor) {
    return forwardedFor.split(',')[0]?.trim() || null
  }

  return request.headers.get('x-real-ip') || null
}

function buildImportResultRow(row: ParsedCancellationLayoutRow, reason?: string): ImportResultRow {
  return {
    lineNumber: row.lineNumber,
    uuid: row.uuid,
    statusCol9: row.statusCol9,
    cancelableCol10: row.cancelableCol10,
    processCol11: row.processCol11,
    reason: reason || row.reason,
    rawLine: row.rawLine
  }
}

function toSummaryRecord(record: InvoiceSummaryRecord): InvoiceIssuedSummarySource {
  return {
    id: record.id,
    uuid: record.uuid,
    issuerRfc: record.issuerRfc,
    receiverRfc: record.receiverRfc,
    receiverName: record.receiverName,
    cfdiType: record.cfdiType,
    satStatus: record.satStatus,
    paymentMethod: record.paymentMethod,
    issuanceDate: record.issuanceDate,
    subtotal: record.subtotal,
    discount: record.discount,
    total: record.total,
    ivaTransferred: record.ivaTransferred,
    ivaWithheld: record.ivaWithheld,
    isrWithheld: record.isrWithheld,
    iepsWithheld: record.iepsWithheld,
    issuerFiscalEntityId: record.issuerFiscalEntityId,
    fiscalEntity: record.fiscalEntity,
    xmlContent: record.xmlContent,
    blob: record.blob
  }
}

function buildSummary(rows: {
  processedCount: number
  updatedRows: Array<unknown>
  ignoredRows: Array<unknown>
  notFoundRows: Array<unknown>
  invalidRows: Array<unknown>
  unhandledRows: Array<unknown>
}): ImportSummary {
  return {
    processed: rows.processedCount,
    updated: rows.updatedRows.length,
    ignored: rows.ignoredRows.length,
    notFound: rows.notFoundRows.length,
    invalid: rows.invalidRows.length,
    unhandled: rows.unhandledRows.length
  }
}

export async function POST(request: NextRequest) {
  let filePath = ''

  try {
    const scoped = await buildDashboardScopedContext(request, { routeKey: 'cancelImport', requireCompanyId: true })
    const { ctx: scopedCtx, enrichedUser, searchParams: _sp, systemRole: _sr } = scoped
    void _sr
    void _sp

    const formData = await request.formData()
    const payload = importLayoutPayloadSchema.safeParse({
      companyId: formData.get('companyId')
    })

    if (!payload.success) {
      return NextResponse.json({ error: payload.error.issues[0]?.message || 'Solicitud inválida' }, { status: 400, headers: SECURITY_HEADERS })
    }

    const companyId = payload.data.companyId
    // Obliga a scoped.member.companyId === companyId (buildDashboardScopedContext ya
    // corrobora miembro aprobado + rol + permission + match org, NO el companyId exacto).
    if (scopedCtx.companyId && scopedCtx.companyId !== companyId) {
      return NextResponse.json({ error: 'El companyId no coincide con el contexto aprobado' }, { status: 403, headers: SECURITY_HEADERS })
    }
    // Scope org seguro: validar que exista un CompanyAccess aprobado para esta company + org + user
    // (ya se revisó en buildDashboardScopedContext pero repetimos WHERE aquí para garantizar
    // organizationId forzado, ya que Company WHERE no dispone del campo organizationId).
    if (scopedCtx.userSystemRole !== 'SUPER_ADMIN') {
      const access = await prisma.companyAccess.findFirst({
        where: {
          companyId,
          organizationId: scopedCtx.organizationId,
          member: { userId: scopedCtx.enrichedUser.id, status: 'APPROVED' }
        },
        select: { id: true }
      })
      if (!access) {
        return NextResponse.json({ error: 'Empresa no encontrada en la organización autorizada' }, { status: 404, headers: SECURITY_HEADERS })
      }
    }
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { rfc: true }
    })
    if (!company?.rfc) {
      return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404, headers: SECURITY_HEADERS })
    }
    const companyRfcScoped = company.rfc

    const file = formData.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No se recibió ningún archivo' }, { status: 400, headers: SECURITY_HEADERS })
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'El archivo excede el límite permitido de 5MB' }, { status: 400, headers: SECURITY_HEADERS })
    }

    if (!file.name.toLowerCase().endsWith('.txt') || file.type !== 'text/plain') {
      return NextResponse.json({ error: 'Tipo de archivo no permitido. Solo se admite texto plano (.txt)' }, { status: 400, headers: SECURITY_HEADERS })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    for (let i = 0; i < Math.min(buffer.length, 1024); i += 1) {
      if (buffer[i] === 0) {
        return NextResponse.json({ error: 'Contenido inválido. El archivo parece ser un binario disfrazado.' }, { status: 400, headers: SECURITY_HEADERS })
      }
    }

    const safeFilename = `${crypto.randomUUID()}.txt`
    filePath = path.join(os.tmpdir(), safeFilename)
    fs.writeFileSync(filePath, buffer)

    const parsedRows: ParsedCancellationLayoutRow[] = []
    let lineNumber = 0
    let processedCount = 0

    const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' })
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity })

    for await (const line of rl) {
      lineNumber += 1
      const parsedRow = parseCancellationLayoutLine(line, lineNumber)

      if (parsedRow.decision === 'header') {
        continue
      }

      processedCount += 1
      parsedRows.push(parsedRow)
    }

    const invalidRows = parsedRows
      .filter(row => row.decision === 'invalid')
      .map(row => buildImportResultRow(row))

    const ignoredRows: ImportResultRow[] = parsedRows
      .filter(row => row.decision === 'ignore')
      .map(row => buildImportResultRow(row))

    const unhandledRows = parsedRows
      .filter(row => row.decision === 'unhandled')
      .map(row => buildImportResultRow(row))

    const updateRows = parsedRows.filter(row => row.decision === 'update')

    const updatedRows: Array<ImportResultRow & { previousSatStatus: string; nextSatStatus: string }> = []
    const notFoundRows: ImportResultRow[] = []
    let updateManyResult: { count: number } = { count: 0 }
    let updateManySkipped = true

    if (updateRows.length > 0) {
      await prisma.$transaction(async tx => {
        const uniqueUpdateUuids = Array.from(new Set(updateRows.map(row => row.uuid)))

        const invoices = await tx.invoice.findMany({
          where: {
            uuid: { in: uniqueUpdateUuids }
          },
          select: invoiceSummarySelect
        })

        const currentInvoiceMap = new Map(
          invoices.map(invoice => [invoice.uuid.toUpperCase(), toSummaryRecord(invoice)])
        )
        const workingInvoiceMap = new Map(currentInvoiceMap)

        const relationRows = await tx.invoiceRelatedCfdi.findMany({
          where: {
            invoiceId: {
              in: invoices
                .filter(invoice => ['PAGO', 'EGRESO'].includes(invoice.cfdiType))
                .map(invoice => invoice.id)
            }
          },
          select: {
            invoiceId: true,
            relatedUuid: true
          }
        })

        const relatedUuidsByInvoiceId = new Map<string, string[]>()
        relationRows.forEach(row => {
          const existing = relatedUuidsByInvoiceId.get(row.invoiceId) || []
          existing.push(row.relatedUuid.toUpperCase())
          relatedUuidsByInvoiceId.set(row.invoiceId, existing)
        })

        const rowsToApply: Array<{
          parsedRow: ParsedCancellationLayoutRow
          previousRecord: InvoiceIssuedSummarySource
          nextRecord: InvoiceIssuedSummarySource
        }> = []
        const impactedRelatedUuidSet = new Set<string>()

        updateRows.forEach(row => {
          const workingRecord = workingInvoiceMap.get(row.uuid)
          if (!workingRecord) {
            notFoundRows.push(buildImportResultRow(row, 'No se encontró el UUID en la base de datos'))
            return
          }

          if (workingRecord.satStatus === SatStatus.CANCELADO) {
            ignoredRows.push(buildImportResultRow(row, 'El CFDI ya estaba en estatus CANCELADO'))
            return
          }

          const nextRecord: InvoiceIssuedSummarySource = {
            ...workingRecord,
            satStatus: SatStatus.CANCELADO
          }

          rowsToApply.push({
            parsedRow: row,
            previousRecord: workingRecord,
            nextRecord
          })

          workingInvoiceMap.set(row.uuid, nextRecord)

          if (['PAGO', 'EGRESO'].includes(workingRecord.cfdiType || '')) {
            const relatedUuids = relatedUuidsByInvoiceId.get(workingRecord.id) || []
            relatedUuids.forEach(relatedUuid => impactedRelatedUuidSet.add(relatedUuid))
          }
        })

        const affectedUpdateUuids = Array.from(new Set(
          rowsToApply.map(row => row.previousRecord.uuid.toUpperCase())
        ))
        const affectedRelatedUuids = Array.from(impactedRelatedUuidSet).filter(uuid =>
          !affectedUpdateUuids.includes(uuid)
        )

        const previousUpdatedRelatedAmounts = await resolveInvoiceIssuedSummaryRelatedAmounts({
          uuids: affectedUpdateUuids,
          db: tx
        })

        const impactedRelatedInvoices = affectedRelatedUuids.length > 0
          ? await tx.invoice.findMany({
              where: {
                uuid: { in: affectedRelatedUuids }
              },
              select: invoiceSummarySelect
            })
          : []

        const previousImpactedRelatedAmounts = await resolveInvoiceIssuedSummaryRelatedAmounts({
          uuids: impactedRelatedInvoices.map(invoice => invoice.uuid),
          db: tx
        })

        const arrayIdsCancelar = rowsToApply.map(row => row.previousRecord.id)
        const arrayUniqueIds = Array.from(new Set(arrayIdsCancelar))

        updateManyResult = await tx.invoice.updateMany({
          where: {
            id: { in: arrayUniqueIds },
            satStatus: SatStatus.VIGENTE,
            issuerRfc: companyRfcScoped
          },
          data: { satStatus: SatStatus.CANCELADO }
        })

        updateManySkipped = updateManyResult.count === 0

        for (const rowToApply of rowsToApply) {
          await syncInvoiceIssuedDailySummaryRecordChange({
            db: tx,
            previousRecord: rowToApply.previousRecord,
            nextRecord: rowToApply.nextRecord,
            relatedAmounts: previousUpdatedRelatedAmounts
          })

          updatedRows.push({
            ...buildImportResultRow(rowToApply.parsedRow, 'Se actualizó satStatus a CANCELADO'),
            previousSatStatus: String(rowToApply.previousRecord.satStatus || ''),
            nextSatStatus: String(rowToApply.nextRecord.satStatus || '')
          })
        }

        if (impactedRelatedInvoices.length > 0) {
          const nextImpactedRelatedAmounts = await resolveInvoiceIssuedSummaryRelatedAmounts({
            uuids: impactedRelatedInvoices.map(invoice => invoice.uuid),
            db: tx
          })

          for (const impactedInvoice of impactedRelatedInvoices) {
            const impactedRecord = toSummaryRecord(impactedInvoice)

            await syncInvoiceIssuedDailySummaryRecordChange({
              db: tx,
              previousRecord: impactedRecord,
              nextRecord: impactedRecord,
              previousRelatedAmounts: previousImpactedRelatedAmounts,
              nextRelatedAmounts: nextImpactedRelatedAmounts
            })
          }
        }
      })
    }

    const summary = buildSummary({
      processedCount,
      updatedRows,
      ignoredRows,
      notFoundRows,
      invalidRows,
      unhandledRows
    })

    await createAuditEntry({
      tableName: 'invoice_cancellation_layout',
      recordId: crypto.randomUUID(),
      action: 'IMPORT',
      userId: enrichedUser.id,
      userEmail: enrichedUser.email || 'usuario_sin_email@local.intranet',
      companyId: companyId,
      ipAddress: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
      description: updateManySkipped
        ? `Importación de layout de cancelaciones (0 registros actualizados): ${summary.updated} en plan, ${summary.ignored} ignorados, ${summary.notFound} no encontrados, ${summary.invalid} inválidos, ${summary.unhandled} no contemplados`
        : `Importación de layout de cancelaciones (${updateManyResult.count} registros actualizados vía updateMany): ${summary.updated} planificados, ${summary.ignored} ignorados, ${summary.notFound} no encontrados, ${summary.invalid} inválidos, ${summary.unhandled} no contemplados`,
      newValues: {
        fileName: file.name,
        fileSize: file.size,
        summary,
        updateManyCount: updateManyResult.count,
        updateManySkipped,
        samples: {
          updated: updatedRows.slice(0, 50).map(row => ({
            lineNumber: row.lineNumber,
            uuid: row.uuid,
            previousSatStatus: row.previousSatStatus,
            nextSatStatus: row.nextSatStatus
          })),
          ignored: ignoredRows.slice(0, 50).map(row => ({
            lineNumber: row.lineNumber,
            uuid: row.uuid,
            reason: row.reason
          })),
          notFound: notFoundRows.slice(0, 50).map(row => ({
            lineNumber: row.lineNumber,
            uuid: row.uuid
          })),
          invalid: invalidRows.slice(0, 50).map(row => ({
            lineNumber: row.lineNumber,
            reason: row.reason
          })),
          unhandled: unhandledRows.slice(0, 50).map(row => ({
            lineNumber: row.lineNumber,
            uuid: row.uuid,
            statusCol9: row.statusCol9,
            cancelableCol10: row.cancelableCol10,
            processCol11: row.processCol11
          }))
        }
      }
    })

    return NextResponse.json({
      success: true,
      fileName: file.name,
      summary,
      updatedRows,
      ignoredRows,
      notFoundRows,
      invalidRows,
      unhandledRows
    }, { headers: SECURITY_HEADERS })
  } catch (error) {
    return dashboardJsonErrorResponse(error)
  } finally {
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath)
      } catch (cleanupError) {
        console.error(`[SECURITY LOG] No se pudo eliminar el archivo temporal: ${filePath}`, cleanupError)
      }
    }
  }
}
