import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { createAuditEntry } from '@/lib/audit'
import { resolveProviderContextWithPermissionCheck, validateAndParseOrgId } from '@/lib/provider-context'
import { sendProviderXmlValidationEmail } from '@/lib/mail'
import { syncProviderPaymentComplianceBlocks } from '@/lib/provider-payment-compliance'
import { listProviderReportRowsFromStorage, persistProviderAcceptedCfdis, type PersistableProviderAcceptedCfdi } from '@/lib/provider-cfdi-storage'
import { buildProviderReport, type ProviderXmlValidationEmailResult } from '@/lib/provider-cfdi-report'
import { rateLimit } from '@/lib/rate-limit'
import { getRealClientIp, safeErrSummary, fingerprint } from '@/lib/security'
import { SECURITY_HEADERS } from '@/lib/org-dashboard-helpers'
import { Permission } from '@/lib/permissions'
import type { SystemRole } from '@prisma/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const preferredRegion = 'auto'
export const maxDuration = 90
export const bodySizeLimit = '50mb'

const fp32 = (s: string) => fingerprint(s, false).slice(0, 8)

const PROVIDER_AUDIT_SECRET_PATTERNS: ReadonlyArray<RegExp> = [
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /Basic\s+[A-Za-z0-9+/=]+/gi,
  /\bsk_[A-Za-z0-9]{16,}/g,
  /\bpk_[A-Za-z0-9]{16,}/g,
  /SharedAccessSignature=[^"'&<>\s]+/gi,
  /token=[A-Za-z0-9\-._~+/]+=*/gi,
  /password=[^&\s"']+/gi,
]

function redactAuditErrors(errors: string[]): string[] {
  if (!Array.isArray(errors)) return []
  return errors
    .slice(0, 500)
    .map(rawEntry => {
      let out = typeof rawEntry === 'string' ? rawEntry : String(rawEntry ?? '')
      for (const pattern of PROVIDER_AUDIT_SECRET_PATTERNS) {
        out = out.replace(pattern, '[REDACTED_SECRET]')
      }
      if (out.length > 200) {
        out = `${out.slice(0, 197)}...`
      }
      return out
    })
}

const PROVIDER_RATE_LIMITS = {
  contextGetIp: { key: 'provider:cfdi:ctx:ip', limit: 60, interval: 60_000 },
  contextGetUser: { key: 'provider:cfdi:ctx:user', limit: 40, interval: 60_000 },
  contextGetOrg: { key: 'provider:cfdi:ctx:org', limit: 30, interval: 60_000 },
  uploadPostIp: { key: 'provider:cfdi:upload:ip', limit: 10, interval: 60_000 },
  uploadPostUser: { key: 'provider:cfdi:upload:user', limit: 6, interval: 60_000 },
  uploadPostOrg: { key: 'provider:cfdi:upload:org', limit: 4, interval: 60_000 },
} as const

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
  let incidentFp: string | null = null
  try {
    const sourceIp = getRealClientIp(request.headers) || 'unknown-provider'

    const ipLimit = await rateLimit(`${PROVIDER_RATE_LIMITS.contextGetIp.key}:${sourceIp}`, {
      interval: PROVIDER_RATE_LIMITS.contextGetIp.interval,
      limit: PROVIDER_RATE_LIMITS.contextGetIp.limit
    })
    if (!ipLimit.success) {
      return NextResponse.json(
        { error: 'rate_limited_provider_ctx_ip_60_per_min', retry_after_ms: ipLimit.retryAfterMs },
        { status: 429, headers: { ...SECURITY_HEADERS, 'Retry-After': String(Math.ceil(ipLimit.retryAfterMs / 1000)) } }
      )
    }

    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: SECURITY_HEADERS })
    }

    const userId = session.user.id
    incidentFp = fp32(`${userId}:provider-cfdi-report-get:${Date.now()}`)

    const userLimit = await rateLimit(`${PROVIDER_RATE_LIMITS.contextGetUser.key}:${userId}`, {
      interval: PROVIDER_RATE_LIMITS.contextGetUser.interval,
      limit: PROVIDER_RATE_LIMITS.contextGetUser.limit
    })
    if (!userLimit.success) {
      return NextResponse.json(
        { error: 'rate_limited_provider_ctx_user_40_per_min', retry_after_ms: userLimit.retryAfterMs },
        { status: 429, headers: { ...SECURITY_HEADERS, 'Retry-After': String(Math.ceil(userLimit.retryAfterMs / 1000)) } }
      )
    }

    const orgIdRaw = request.nextUrl.searchParams.get('orgId')
    const orgParse = validateAndParseOrgId(orgIdRaw, { required: true })
    if (!orgParse.ok) {
      return NextResponse.json({ error: orgParse.error }, { status: orgParse.status, headers: SECURITY_HEADERS })
    }

    const access = await resolveProviderContextWithPermissionCheck(
      userId,
      session.user.systemRole as unknown as SystemRole,
      orgParse.value,
      Permission.PROVIDER_PORTAL_VIEW
    )
    if ('error' in access) {
      return NextResponse.json({ error: access.error }, { status: access.status, headers: SECURITY_HEADERS })
    }
    const { context } = access

    const orgLimit = await rateLimit(`${PROVIDER_RATE_LIMITS.contextGetOrg.key}:${context.organizationId}`, {
      interval: PROVIDER_RATE_LIMITS.contextGetOrg.interval,
      limit: PROVIDER_RATE_LIMITS.contextGetOrg.limit
    })
    if (!orgLimit.success) {
      return NextResponse.json(
        { error: 'rate_limited_provider_ctx_org_30_per_min', retry_after_ms: orgLimit.retryAfterMs },
        { status: 429, headers: { ...SECURITY_HEADERS, 'Retry-After': String(Math.ceil(orgLimit.retryAfterMs / 1000)) } }
      )
    }

    if (context.allowedCompanies.length === 0) {
      return NextResponse.json(
        { error: 'El proveedor no tiene empresas asignadas para visualizar el reporte' },
        { status: 403, headers: SECURITY_HEADERS }
      )
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
    }, { headers: SECURITY_HEADERS })
  } catch (error) {
    const safe = safeErrSummary(error)
    console.error(
      `[PROV-CFDI-GET-${incidentFp || fp32(String(Date.now()))}]`,
      `name=${safe.name}`,
      `fp=${safe.msgHash.slice(0, 8)}`,
      safe.msg ? `msg=${safe.msg}` : ''
    )
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500, headers: SECURITY_HEADERS })
  }
}

export async function POST(request: NextRequest) {
  let incidentFp: string | null = null
  try {
    const sourceIp = getRealClientIp(request.headers) || 'unknown-provider'

    const ipLimit = await rateLimit(`${PROVIDER_RATE_LIMITS.uploadPostIp.key}:${sourceIp}`, {
      interval: PROVIDER_RATE_LIMITS.uploadPostIp.interval,
      limit: PROVIDER_RATE_LIMITS.uploadPostIp.limit
    })
    if (!ipLimit.success) {
      return NextResponse.json(
        { error: 'rate_limited_provider_upload_ip_10_per_min', retry_after_ms: ipLimit.retryAfterMs },
        { status: 429, headers: { ...SECURITY_HEADERS, 'Retry-After': String(Math.ceil(ipLimit.retryAfterMs / 1000)) } }
      )
    }

    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: SECURITY_HEADERS })
    }

    const userId = session.user.id
    incidentFp = fp32(`${userId}:provider-cfdi-report-post:${Date.now()}`)

    const userLimit = await rateLimit(`${PROVIDER_RATE_LIMITS.uploadPostUser.key}:${userId}`, {
      interval: PROVIDER_RATE_LIMITS.uploadPostUser.interval,
      limit: PROVIDER_RATE_LIMITS.uploadPostUser.limit
    })
    if (!userLimit.success) {
      return NextResponse.json(
        { error: 'rate_limited_provider_upload_user_6_per_min', retry_after_ms: userLimit.retryAfterMs },
        { status: 429, headers: { ...SECURITY_HEADERS, 'Retry-After': String(Math.ceil(userLimit.retryAfterMs / 1000)) } }
      )
    }

    const formData = await request.formData()
    const orgIdRaw = String(formData.get('orgId') || '').trim() || undefined
    const files = formData
      .getAll('files')
      .filter((value): value is File => value instanceof File)

    if (files.length === 0) {
      return NextResponse.json({ error: 'Debes adjuntar al menos un archivo XML o ZIP' }, { status: 400, headers: SECURITY_HEADERS })
    }

    const orgParse = validateAndParseOrgId(orgIdRaw, { required: true })
    if (!orgParse.ok) {
      return NextResponse.json({ error: orgParse.error }, { status: orgParse.status, headers: SECURITY_HEADERS })
    }

    const access = await resolveProviderContextWithPermissionCheck(
      userId,
      session.user.systemRole as unknown as SystemRole,
      orgParse.value,
      Permission.PROVIDER_PORTAL_UPLOAD
    )
    if ('error' in access) {
      return NextResponse.json({ error: access.error }, { status: access.status, headers: SECURITY_HEADERS })
    }
    const { context } = access

    const orgLimit = await rateLimit(`${PROVIDER_RATE_LIMITS.uploadPostOrg.key}:${context.organizationId}`, {
      interval: PROVIDER_RATE_LIMITS.uploadPostOrg.interval,
      limit: PROVIDER_RATE_LIMITS.uploadPostOrg.limit
    })
    if (!orgLimit.success) {
      return NextResponse.json(
        { error: 'rate_limited_provider_upload_org_4_per_min', retry_after_ms: orgLimit.retryAfterMs },
        { status: 429, headers: { ...SECURITY_HEADERS, 'Retry-After': String(Math.ceil(orgLimit.retryAfterMs / 1000)) } }
      )
    }

    if (!context.providerRfc) {
      return NextResponse.json(
        { error: 'La membresía del proveedor no tiene un RFC configurado en members.provider_rfc' },
        { status: 403, headers: SECURITY_HEADERS }
      )
    }

    if (context.allowedCompanies.length === 0) {
      return NextResponse.json(
        { error: 'El proveedor no tiene empresas asignadas para validar los CFDI cargados' },
        { status: 403, headers: SECURITY_HEADERS }
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
        uploadedByUserId: userId
      })
    }

    await createAuditEntry({
      tableName: 'provider_uploaded_cfdis',
      recordId: context.memberId,
      action: 'IMPORT',
      userId,
      userEmail: session.user.email || 'sin-email',
      description: `Carga de CFDI de proveedor. Aprobados: ${uploadDecision.acceptedRecords.length}. Rechazados: ${uploadDecision.errors.length}.`,
      ipAddress: sourceIp,
      userAgent: request.headers.get('user-agent'),
      newValues: {
        organizationId: context.organizationId,
        providerRfc: context.providerRfc,
        approvedCount: uploadDecision.acceptedRecords.length,
        rejectedCount: uploadDecision.errors.length,
        uuids: uploadDecision.acceptedRecords.map(record => record.uuid),
        rejectedFiles: redactAuditErrors(uploadDecision.errors),
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
        const safe = safeErrSummary(rejectedEmails[0])
        console.error(
          `[PROV-CFDI-MAIL-${incidentFp}] count=${rejectedEmails.length}`,
          `name=${safe.name} fp=${safe.msgHash.slice(0, 8)}`
        )
      }
    }

    if (uploadDecision.acceptedRecords.some(record => record.cfdiType === 'P')) {
      try {
        await syncProviderPaymentComplianceBlocks({
          organizationId: context.organizationId,
          providerRfc: context.providerRfc
        })
      } catch (complianceError) {
        const safe = safeErrSummary(complianceError)
        console.error(
          `[PROV-CFDI-COMPLIANCE-${incidentFp}] sync compliance block`,
          `name=${safe.name} fp=${safe.msgHash.slice(0, 8)}`,
          safe.msg ? `msg=${safe.msg}` : ''
        )
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
      }, { status: 403, headers: SECURITY_HEADERS })
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
    }, { headers: SECURITY_HEADERS })
  } catch (error) {
    const message = getProviderUploadErrorMessage(error)
    const safe = safeErrSummary(error)
    console.error(
      `[PROV-CFDI-POST-${incidentFp || fp32(String(Date.now()))}]`,
      `name=${safe.name} fp=${safe.msgHash.slice(0, 8)} user_msg=${message}`
    )
    return NextResponse.json({ error: message }, { status: 400, headers: SECURITY_HEADERS })
  }
}
