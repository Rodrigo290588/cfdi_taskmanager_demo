import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { resolveProviderContextWithPermissionCheck, validateAndParseOrgId } from '@/lib/provider-context'
import { getStoredProviderXmlRecordById } from '@/lib/provider-cfdi-storage'
import { rateLimit } from '@/lib/rate-limit'
import { getRealClientIp, safeErrSummary, fingerprint } from '@/lib/security'
import { SECURITY_HEADERS } from '@/lib/org-dashboard-helpers'
import { Permission } from '@/lib/permissions'
import type { SystemRole } from '@prisma/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const fp32 = (s: string) => fingerprint(s, false).slice(0, 8)
const PROVIDER_XML_RATE = {
  ip: { key: 'provider:cfdi:xml:ip', limit: 30, interval: 60_000 },
  user: { key: 'provider:cfdi:xml:user', limit: 20, interval: 60_000 },
  org: { key: 'provider:cfdi:xml:org', limit: 15, interval: 60_000 },
} as const

export async function GET(request: NextRequest) {
  let incidentFp: string | null = null
  try {
    const sourceIp = getRealClientIp(request.headers) || 'unknown-provider'

    const ipLimit = await rateLimit(`${PROVIDER_XML_RATE.ip.key}:${sourceIp}`, {
      interval: PROVIDER_XML_RATE.ip.interval,
      limit: PROVIDER_XML_RATE.ip.limit
    })
    if (!ipLimit.success) {
      return NextResponse.json(
        { error: 'rate_limited_provider_xml_ip_30_per_min', retry_after_ms: ipLimit.retryAfterMs },
        { status: 429, headers: { ...SECURITY_HEADERS, 'Retry-After': String(Math.ceil(ipLimit.retryAfterMs / 1000)) } }
      )
    }

    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: SECURITY_HEADERS })
    }

    const userId = session.user.id
    incidentFp = fp32(`${userId}:provider-xml-download:${Date.now()}`)

    const userLimit = await rateLimit(`${PROVIDER_XML_RATE.user.key}:${userId}`, {
      interval: PROVIDER_XML_RATE.user.interval,
      limit: PROVIDER_XML_RATE.user.limit
    })
    if (!userLimit.success) {
      return NextResponse.json(
        { error: 'rate_limited_provider_xml_user_20_per_min', retry_after_ms: userLimit.retryAfterMs },
        { status: 429, headers: { ...SECURITY_HEADERS, 'Retry-After': String(Math.ceil(userLimit.retryAfterMs / 1000)) } }
      )
    }

    const recordId = request.nextUrl.searchParams.get('id')
    const orgIdRaw = request.nextUrl.searchParams.get('orgId')
    if (!recordId) {
      return NextResponse.json({ error: 'No se recibió el identificador del CFDI' }, { status: 400, headers: SECURITY_HEADERS })
    }

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

    const orgLimit = await rateLimit(`${PROVIDER_XML_RATE.org.key}:${context.organizationId}`, {
      interval: PROVIDER_XML_RATE.org.interval,
      limit: PROVIDER_XML_RATE.org.limit
    })
    if (!orgLimit.success) {
      return NextResponse.json(
        { error: 'rate_limited_provider_xml_org_15_per_min', retry_after_ms: orgLimit.retryAfterMs },
        { status: 429, headers: { ...SECURITY_HEADERS, 'Retry-After': String(Math.ceil(orgLimit.retryAfterMs / 1000)) } }
      )
    }

    const storedRecord = await getStoredProviderXmlRecordById({
      recordId,
      context
    })
    if (!storedRecord) {
      return NextResponse.json({ error: 'No se encontró el CFDI solicitado' }, { status: 404, headers: SECURITY_HEADERS })
    }

    return new NextResponse(storedRecord.xmlContent, {
      headers: {
        ...SECURITY_HEADERS,
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="cfdi_${storedRecord.uuid}.xml"`,
        'X-Content-Type-Options': 'nosniff',
      }
    })
  } catch (error) {
    const safe = safeErrSummary(error)
    console.error(
      `[PROV-XML-DL-${incidentFp || fp32(String(Date.now()))}]`,
      `name=${safe.name} fp=${safe.msgHash.slice(0, 8)}`,
      safe.msg ? `msg=${safe.msg}` : ''
    )
    return NextResponse.json({ error: 'Error interno al descargar el XML' }, { status: 500, headers: SECURITY_HEADERS })
  }
}
