import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { createAuditEntry } from '@/lib/audit'
import { resolveProviderContext } from '@/lib/provider-context'
import { sendProviderXmlValidationEmail } from '@/lib/mail'
import { syncProviderPaymentComplianceBlocks } from '@/lib/provider-payment-compliance'
import { listProviderReportRowsFromStorage, persistProviderAcceptedCfdis, type PersistableProviderAcceptedCfdi } from '@/lib/provider-cfdi-storage'
import { buildProviderReport, type ProviderXmlValidationEmailResult } from '@/lib/provider-cfdi-report'

export const runtime = 'nodejs'

const BLOCKED_PROVIDER_CFDI_TYPES = new Set(['I', 'E', 'T'])

function getProviderUploadErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return 'No fue posible procesar los archivos cargados. Verifica que correspondan a CFDI XML o ZIP validos.'
  }

  const message = error.message.trim()
  const normalizedMessage = message.toLowerCase()

  if (
    normalizedMessage.includes('getattributenames is not a function') ||
    normalizedMessage.includes('not iterable') ||
    normalizedMessage.includes('cannot read properties')
  ) {
    return 'No fue posible leer la estructura del XML cargado. Verifica que el archivo corresponda a un CFDI valido del SAT y que no este dañado.'
  }

  return message || 'No fue posible procesar los archivos cargados. Verifica que correspondan a CFDI XML o ZIP validos.'
}

function applyProviderUploadBlockRules(params: {
  isBlocked: boolean
  blockReason: string | null | undefined
  acceptedRecords: PersistableProviderAcceptedCfdi[]
  emailResults: ProviderXmlValidationEmailResult[]
  errors: string[]
  totalFiles: number
}) {
  if (!params.isBlocked || !params.blockReason) {
    return {
      acceptedRecords: params.acceptedRecords,
      emailResults: params.emailResults,
      errors: params.errors,
      blockedRecords: [] as PersistableProviderAcceptedCfdi[],
      summary: {
        totalFiles: params.totalFiles,
        acceptedInvoices: params.acceptedRecords.filter(record => record.cfdiType !== 'P').length,
        rejectedFiles: params.errors.length
      }
    }
  }

  const blockedRecords = params.acceptedRecords.filter(record => BLOCKED_PROVIDER_CFDI_TYPES.has(record.cfdiType))
  const allowedRecords = params.acceptedRecords.filter(record => !BLOCKED_PROVIDER_CFDI_TYPES.has(record.cfdiType))

  if (blockedRecords.length === 0) {
    return {
      acceptedRecords: params.acceptedRecords,
      emailResults: params.emailResults,
      errors: params.errors,
      blockedRecords,
      summary: {
        totalFiles: params.totalFiles,
        acceptedInvoices: params.acceptedRecords.filter(record => record.cfdiType !== 'P').length,
        rejectedFiles: params.errors.length
      }
    }
  }

  const blockedKeys = new Set(
    blockedRecords.map(record => `${record.fileName}::${record.uuid}`)
  )
  const blockedErrors = blockedRecords.map(record => `${record.fileName}: ${params.blockReason}`)
  const emailResults = params.emailResults.map(result => {
    const key = `${result.fileName}::${result.uuid}`

    if (!blockedKeys.has(key) || result.status !== 'APPROVED') {
      return result
    }

    return {
      ...result,
      status: 'REJECTED' as const,
      rejectionReason: params.blockReason || result.rejectionReason
    }
  })
  const errors = [...params.errors, ...blockedErrors]

  return {
    acceptedRecords: allowedRecords,
    emailResults,
    errors,
    blockedRecords,
    summary: {
      totalFiles: params.totalFiles,
      acceptedInvoices: allowedRecords.filter(record => record.cfdiType !== 'P').length,
      rejectedFiles: errors.length
    }
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const orgId = request.nextUrl.searchParams.get('orgId')
    const context = await resolveProviderContext(session.user.id, orgId)

    if (!context) {
      return NextResponse.json({ error: 'No se encontró la membresía del proveedor' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      provider: {
        memberId: context.memberId,
        organizationId: context.organizationId,
        providerRfc: context.providerRfc,
        providerName: context.providerName,
        providerUploadBlockedAt: context.providerUploadBlockedAt,
        providerUploadBlockedReason: context.providerUploadBlockedReason,
        providerUploadBlockedBySystem: context.providerUploadBlockedBySystem,
        allowedCompanies: context.allowedCompanies
      },
      rows: await listProviderReportRowsFromStorage(context)
    })
  } catch (error) {
    console.error('Error obteniendo contexto del proveedor:', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const formData = await request.formData()
    const orgId = String(formData.get('orgId') || '').trim() || undefined
    const files = formData
      .getAll('files')
      .filter((value): value is File => value instanceof File)

    if (files.length === 0) {
      return NextResponse.json({ error: 'Debes adjuntar al menos un archivo XML o ZIP' }, { status: 400 })
    }

    const context = await resolveProviderContext(session.user.id, orgId)
    if (!context) {
      return NextResponse.json({ error: 'No se encontró la membresía del proveedor' }, { status: 404 })
    }

    if (!context.providerRfc) {
      return NextResponse.json(
        { error: 'La membresía del proveedor no tiene un RFC configurado en members.provider_rfc' },
        { status: 403 }
      )
    }

    if (context.allowedCompanies.length === 0) {
      return NextResponse.json(
        { error: 'El proveedor no tiene empresas asignadas para validar los CFDI cargados' },
        { status: 403 }
      )
    }

    const report = await buildProviderReport({
      files,
      context
    })
    const uploadDecision = applyProviderUploadBlockRules({
      isBlocked: Boolean(context.providerUploadBlockedBySystem),
      blockReason: context.providerUploadBlockedReason,
      acceptedRecords: report.acceptedRecords,
      emailResults: report.emailResults,
      errors: report.errors,
      totalFiles: report.summary.totalFiles
    })

    if (uploadDecision.acceptedRecords.length > 0) {
      await persistProviderAcceptedCfdis({
        records: uploadDecision.acceptedRecords,
        context,
        uploadedByUserId: session.user.id
      })
    }

    await createAuditEntry({
      tableName: 'provider_uploaded_cfdis',
      recordId: context.memberId,
      action: 'IMPORT',
      userId: session.user.id,
      userEmail: session.user.email || 'sin-email',
      description: `Carga de CFDI de proveedor. Aprobados: ${uploadDecision.acceptedRecords.length}. Rechazados: ${uploadDecision.errors.length}.`,
      ipAddress: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip'),
      userAgent: request.headers.get('user-agent'),
      newValues: {
        organizationId: context.organizationId,
        providerRfc: context.providerRfc,
        approvedCount: uploadDecision.acceptedRecords.length,
        rejectedCount: uploadDecision.errors.length,
        uuids: uploadDecision.acceptedRecords.map(record => record.uuid),
        rejectedFiles: uploadDecision.errors,
        blockedFiles: uploadDecision.blockedRecords.map(record => record.fileName)
      }
    })

    if (session.user.email) {
      const emailResults = await Promise.allSettled(
        uploadDecision.emailResults.map(result =>
          sendProviderXmlValidationEmail({
            to: session.user.email || '',
            recipientName: result.emisorNombre || 'Proveedor',
            organizationId: context.organizationId,
            fileName: result.fileName,
            emisorRfc: result.emisorRfc,
            receptorRfc: result.receptorRfc,
            uuid: result.uuid,
            total: result.total,
            fechaEmision: result.fechaEmision,
            fechaCarga: result.fechaCarga,
            validationAnexo20: result.validationAnexo20,
            validationSat: result.validationSat,
            status: result.status,
            rejectionReason: result.rejectionReason || undefined
          })
        )
      )

      const rejectedEmails = emailResults.filter(result => result.status === 'rejected')
      if (rejectedEmails.length > 0) {
        console.error('Error enviando uno o mas correos de validacion XML al proveedor', rejectedEmails)
      }
    }

    if (uploadDecision.acceptedRecords.some(record => record.cfdiType === 'P')) {
      try {
        await syncProviderPaymentComplianceBlocks({
          organizationId: context.organizationId,
          providerRfc: context.providerRfc
        })
      } catch (complianceError) {
        console.error('No fue posible sincronizar el bloqueo del proveedor tras cargar un REP:', complianceError)
      }
    }

    if (uploadDecision.blockedRecords.length > 0 && uploadDecision.acceptedRecords.length === 0) {
      return NextResponse.json({
        error: context.providerUploadBlockedReason || 'La carga de CFDI se encuentra bloqueada hasta regularizar el complemento de pago pendiente.',
        provider: {
          memberId: context.memberId,
          organizationId: context.organizationId,
          providerRfc: context.providerRfc,
          providerName: context.providerName,
          providerUploadBlockedAt: context.providerUploadBlockedAt,
          providerUploadBlockedReason: context.providerUploadBlockedReason,
          providerUploadBlockedBySystem: context.providerUploadBlockedBySystem,
          allowedCompanies: context.allowedCompanies
        },
        rows: await listProviderReportRowsFromStorage(context),
        errors: uploadDecision.errors,
        validationMessages: report.validationMessages,
        summary: uploadDecision.summary
      }, { status: 403 })
    }

    return NextResponse.json({
      success: true,
      provider: {
        memberId: context.memberId,
        organizationId: context.organizationId,
        providerRfc: context.providerRfc,
        providerName: context.providerName,
        providerUploadBlockedAt: context.providerUploadBlockedAt,
        providerUploadBlockedReason: context.providerUploadBlockedReason,
        providerUploadBlockedBySystem: context.providerUploadBlockedBySystem,
        allowedCompanies: context.allowedCompanies
      },
      rows: await listProviderReportRowsFromStorage(context),
      errors: uploadDecision.errors,
      validationMessages: report.validationMessages,
      summary: uploadDecision.summary
    })
  } catch (error) {
    const message = getProviderUploadErrorMessage(error)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
