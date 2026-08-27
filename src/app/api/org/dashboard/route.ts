import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { CfdiType, SystemRole } from '@prisma/client'
import { DOMParser } from '@xmldom/xmldom'
import { rateLimit } from '@/lib/rate-limit'
import { getRealClientIp, safeErrSummary, fingerprint } from '@/lib/security'
import {
  Permission,
  enrichUserWithMemberships,
  hasPermission,
  requireApprovedDashboardAccess,
  DashboardForbiddenError,
} from '@/lib/permissions'
import {
  SECURITY_HEADERS,
  MAX_XML_BYTES_DASHBOARD,
  MAX_PPDS_PARSED_PER_REQUEST,
  MAX_RELATED_CFDIS_PER_RUN,
  NAMESPACE_PATTERNS,
  parseSatDecimal,
  safeTextEncoderLength,
  hasDtdInline,
  findElementsByLocalNamePattern,
  validateAndParseOrgIdFromRequest,
  maskTopClientsPii,
} from '@/lib/org-dashboard-helpers'

const fp32 = (s: string) => fingerprint(s, false).slice(0, 8)
const TEXT_ENCODER_SHARED = new TextEncoder()

type XmldomErrorHandler = {
  warning?: (msg: string | unknown) => void
  error?: (msg: string | unknown) => void
  fatalError?: (msg: string | unknown) => void
}
type DOMParserOptions = { errorHandler: XmldomErrorHandler }

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  let incidentFp: string | null = null
  try {
    const sourceIp = getRealClientIp(request.headers) || 'unknown'

    const ipLimit = await rateLimit(`org:dash:ip:${sourceIp}`, { interval: 60_000, limit: 60 })
    if (!ipLimit.success) {
      return NextResponse.json(
        { error: 'rate_limited_ip_60_per_min', retry_after_ms: ipLimit.retryAfterMs },
        { status: 429, headers: SECURITY_HEADERS },
      )
    }

    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: SECURITY_HEADERS })
    }

    const userId = session.user.id
    incidentFp = fp32(`${userId}:org-dashboard:${Date.now()}`)

    const userLimit = await rateLimit(`org:dash:user:${userId}`, { interval: 60_000, limit: 30 })
    if (!userLimit.success) {
      return NextResponse.json(
        { error: 'rate_limited_user_30_per_min' },
        { status: 429, headers: SECURITY_HEADERS },
      )
    }

    const orgIdParse = validateAndParseOrgIdFromRequest(request)
    if (!orgIdParse.ok) {
      return NextResponse.json(
        { error: orgIdParse.error },
        { status: orgIdParse.status, headers: SECURITY_HEADERS },
      )
    }
    const organizationId = orgIdParse.orgId

    const orgLimit = await rateLimit(`org:dash:org:${organizationId}`, { interval: 60_000, limit: 180 })
    if (!orgLimit.success) {
      return NextResponse.json(
        { error: 'rate_limited_org_180_per_min' },
        { status: 429, headers: SECURITY_HEADERS },
      )
    }

    const enriched = await enrichUserWithMemberships({
      id: userId,
      systemRole: session.user.systemRole as unknown as SystemRole,
    })

    let access: Awaited<ReturnType<typeof requireApprovedDashboardAccess>>
    try {
      access = await requireApprovedDashboardAccess(
        userId,
        session.user.systemRole as unknown as SystemRole,
        {
          organizationId,
          permission: Permission.DASHBOARD_FISCAL_VIEW,
        },
      )
    } catch (accessErr) {
      const statusCode = accessErr instanceof DashboardForbiddenError ? accessErr.statusCode : 403
      const msg = accessErr instanceof Error ? accessErr.message : 'Sin acceso al dashboard'
      return NextResponse.json(
        { error: msg },
        { status: statusCode, headers: SECURITY_HEADERS },
      )
    }
    const validatedOrgId = access.organizationId
    const canViewFullPii = hasPermission(enriched, Permission.RECEP_FISCAL_AUDIT_PII, validatedOrgId)

    const member = await prisma.member.findFirst({
      where: { userId, organizationId: validatedOrgId, status: 'APPROVED' },
      select: { id: true, organizationId: true, role: true },
    })
    if (!member) {
      return NextResponse.json(
        { error: 'Membresía no encontrada o no aprobada para organización' },
        { status: 404, headers: SECURITY_HEADERS },
      )
    }

    const entities = await prisma.fiscalEntity.findMany({
      where: { organizationId: validatedOrgId },
      select: { id: true, rfc: true, businessName: true },
    })

    if (entities.length === 0) {
      return NextResponse.json(
        {
          organization: { id: validatedOrgId },
          kpis: {
            totalCfdis: 0,
            totalMonto: 0,
            tasaCancelacion: 0,
            montoCobrado: 0,
            montoPorCobrar: 0,
            carteraVencida: 0,
          },
          byType: [],
          bySatStatus: [],
          monthly: [],
          topClients: [],
          paymentMethods: [],
        },
        { status: 200, headers: SECURITY_HEADERS },
      )
    }

    const fiscalEntityIds = entities.map((e) => e.id)
    const baseWhere = {
      issuerFiscalEntityId: { in: fiscalEntityIds },
      cfdiType: { in: [CfdiType.INGRESO, CfdiType.PAGO, CfdiType.NOMINA] },
    }

    const [byType, bySatStatus, monthly, totals, cancelled, topClientsRaw, paymentMethods, pueInvoices, ppdInvoicesList] = await Promise.all([
      prisma.invoice.groupBy({
        by: ['cfdiType'],
        where: baseWhere,
        _count: { _all: true },
        _sum: { total: true },
      }),
      prisma.invoice.groupBy({
        by: ['satStatus'],
        where: baseWhere,
        _count: { _all: true },
      }),
      Promise.all(
        Array.from({ length: 12 }, (_, i) => {
          const date = new Date()
          date.setMonth(date.getMonth() - i)
          const start = new Date(date.getFullYear(), date.getMonth(), 1)
          const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999)
          return prisma.invoice
            .aggregate({
              where: { ...baseWhere, issuanceDate: { gte: start, lte: end } },
              _count: { _all: true },
              _sum: { total: true },
            })
            .then((res) => ({
              label: `${start.toLocaleString('es-MX', { month: 'short' })} ${start.getFullYear()}`,
              count: res._count._all || 0,
              total: Number(res._sum.total) || 0,
            }))
        }),
      ),
      prisma.invoice.aggregate({
        where: baseWhere,
        _count: { _all: true },
        _sum: { total: true },
      }),
      prisma.invoice.count({ where: { ...baseWhere, satStatus: 'CANCELADO' } }),
      prisma.invoice.groupBy({
        by: ['receiverRfc', 'receiverName'],
        where: baseWhere,
        _sum: { total: true },
        orderBy: { _sum: { total: 'desc' as const } },
        take: 5,
      }),
      prisma.invoice.groupBy({
        by: ['paymentMethod'],
        where: baseWhere,
        _count: { _all: true },
      }),
      prisma.invoice.aggregate({
        where: {
          ...baseWhere,
          paymentMethod: 'PUE',
          cfdiType: { in: [CfdiType.INGRESO, CfdiType.PAGO] },
        },
        _sum: { total: true },
      }),
      prisma.invoice.findMany({
        where: {
          ...baseWhere,
          paymentMethod: 'PPD',
          cfdiType: { in: [CfdiType.INGRESO, CfdiType.PAGO] },
        },
        select: { uuid: true, total: true, issuanceDate: true },
        take: MAX_PPDS_PARSED_PER_REQUEST,
      }),
    ])

    const totalPUE = parseSatDecimal(String(pueInvoices._sum.total || 0))

    const ppdUuids = ppdInvoicesList.map((i) => i.uuid)
    const relatedCfdis = ppdUuids.length
      ? await prisma.invoiceRelatedCfdi.findMany({
          where: {
            relatedUuid: { in: ppdUuids },
            invoice: { cfdiType: 'PAGO', satStatus: 'VIGENTE' },
          },
          include: { invoice: { select: { xmlContent: true } } },
          take: MAX_RELATED_CFDIS_PER_RUN,
        })
      : []

    const paidAmountsByUuid: Record<string, number> = {}
    const domParserOpts: DOMParserOptions = {
      errorHandler: {
        warning: () => {},
        error: () => {
          throw new Error('ORG_002_XML_PARSE_ERROR_MALFORMED')
        },
        fatalError: () => {
          throw new Error('ORG_002_XML_FATAL_POSSIBLE_XXE')
        },
      },
    }
    const parser = new DOMParser(domParserOpts)
    const getAttr = (el: Element, name: string) => el.getAttribute(name) || ''

    const relatedCfdisSafe = relatedCfdis.slice(0, MAX_RELATED_CFDIS_PER_RUN)
    for (const relation of relatedCfdisSafe) {
      const xml = relation.invoice.xmlContent
      if (!xml) continue
      const uuidFp = fp32(relation.relatedUuid)
      const xmlLen = safeTextEncoderLength(xml) || TEXT_ENCODER_SHARED.encode(xml).length
      if (xmlLen > MAX_XML_BYTES_DASHBOARD) {
        console.warn(
          `[ORG-002] Skip oversized XML uuid_fp=%s bytes=%s limit=%s`,
          uuidFp,
          xmlLen,
          MAX_XML_BYTES_DASHBOARD,
        )
        continue
      }
      if (hasDtdInline(xml)) {
        console.warn(`[ORG-002] Skip DTD-disallowed XML uuid_fp=%s`, uuidFp)
        continue
      }
      try {
        const doc = parser.parseFromString(xml, 'text/xml')
        const parserErrNodes = doc.getElementsByTagNameNS('*', 'parsererror').length
        if (parserErrNodes > 0) continue
        const pagos = findElementsByLocalNamePattern(doc, NAMESPACE_PATTERNS.Pago, 50)
        for (const pagoNode of pagos) {
          const doctos = findElementsByLocalNamePattern(pagoNode, NAMESPACE_PATTERNS.DoctoRel, 200)
          for (const doctoNode of doctos) {
            const idDocRaw = getAttr(doctoNode, 'IdDocumento')
            if (!idDocRaw) continue
            if (idDocRaw.toLowerCase() !== relation.relatedUuid.toLowerCase()) continue
            const impPagado = parseSatDecimal(getAttr(doctoNode, 'ImpPagado'), 6)
            if (!impPagado) continue
            paidAmountsByUuid[relation.relatedUuid] = (paidAmountsByUuid[relation.relatedUuid] || 0) + impPagado
          }
        }
      } catch (xmlErr) {
        const safe = safeErrSummary(xmlErr instanceof Error ? xmlErr : new Error('ORG_DASH_XML_UNKNOWN'))
        console.warn(
          `[ORG-005] Skip XML parse incident_fp=%s type=%s msgHash=%s`,
          incidentFp || uuidFp,
          safe.name,
          safe.msgHash,
        )
        continue
      }
    }

    let totalPPDFullyPaid = 0
    let totalPPDPending = 0
    let carteraVencida = 0
    const now = new Date()
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
    for (const inv of ppdInvoicesList) {
      const paid = paidAmountsByUuid[inv.uuid] || 0
      const invTotal = parseSatDecimal(String(inv.total || 0))
      if (paid >= invTotal - 0.01) {
        totalPPDFullyPaid += invTotal
      } else {
        totalPPDPending += invTotal
        if (now.getTime() - new Date(inv.issuanceDate).getTime() > THIRTY_DAYS_MS) {
          carteraVencida += Math.max(invTotal - paid, 0)
        }
      }
    }

    const montoCobrado = totalPUE + totalPPDFullyPaid
    const montoPorCobrar = totalPPDPending
    const totalCfdis = Number(totals._count._all || 0)
    const totalMonto = Number(totals._sum.total || 0)
    const tasaCancelacion = totalCfdis ? Math.round((cancelled / totalCfdis) * 10000) / 100 : 0

    const topClientsTotals = (topClientsRaw as unknown as Array<{ _sum: { total: number | null } }>)
    const topClients = maskTopClientsPii(
      topClientsRaw as unknown as Array<{ receiverRfc: string | null; receiverName: string | null }>,
      topClientsTotals,
      canViewFullPii,
    )

    return NextResponse.json(
      {
        organization: { id: validatedOrgId },
        kpis: { totalCfdis, totalMonto, tasaCancelacion, montoCobrado, montoPorCobrar, carteraVencida },
        byType: byType.map((t) => ({
          type: t.cfdiType,
          count: Number(t._count._all || 0),
          total: Number(t._sum.total || 0),
        })),
        bySatStatus: bySatStatus.map((s) => ({
          status: s.satStatus,
          count: Number(s._count._all || 0),
        })),
        monthly: monthly.reverse(),
        topClients,
        paymentMethods: paymentMethods.map((p) => ({
          method: p.paymentMethod,
          count: Number(p._count._all || 0),
        })),
      },
      { status: 200, headers: SECURITY_HEADERS },
    )
  } catch (error) {
    const errFp = incidentFp || fp32(`org-dashboard-global:${Date.now()}`)
    const safe = safeErrSummary(error instanceof Error ? error : new Error('ORG_DASH_UNKNOWN'))
    const stackTrunc = 'stackFirst' in safe ? safe.stackFirst : null
    console.error(
      `[ORG-005] Dashboard incident incident_fp=%s type=%s msgHash=%s stack=%s`,
      errFp,
      safe.name,
      safe.msgHash,
      stackTrunc,
    )
    return NextResponse.json(
      { error: 'Error interno del servidor', incident_fingerprint: errFp },
      { status: 500, headers: SECURITY_HEADERS },
    )
  }
}
