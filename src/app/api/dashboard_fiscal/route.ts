import { NextRequest, NextResponse } from 'next/server'
import { SystemRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { CfdiType, Prisma } from '@prisma/client'
import { DOMParser } from '@xmldom/xmldom'
import { decryptInvoiceXmlContent } from '@/lib/invoice-xml-storage'
import { hasPermission, Permission, type User as PermissionUser } from '@/lib/permissions'
import { SECURITY_HEADERS } from '@/lib/org-dashboard-helpers'
import { fp32 } from '@/lib/monitor-security-helpers'
import { safeErrSummary, type SafeErrorSummary } from '@/lib/security'
import {
  buildDashboardScopedContext,
  dashboardJsonErrorResponse,
  DASHBOARD_MAX_MONTHS
} from '@/lib/dashboard-fiscal-route-utils'

// ============================================================
// DASH-SAST-010: Configuración Next.js segura App Router
//  · runtime nodejs  → Prisma requiere libs TCP, Edge no compatible.
//  · dynamic force  → Dashboard es transaccional, NUNCA cachear.
//  · maxDuration 30 → Saneado de lambdas Vercel/turbo 25-30s.
// ============================================================
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// DASH-SAST-008 · Whitelist estricta parámetro origin.
const DASH_FISCAL_ALLOWED_ORIGINS: ReadonlySet<string> = new Set(['issued', 'received', 'both']);

const INVOICE_BATCH_SIZE = 500

const _SAFE_DOM_PARSER_OPTS = {
  disableEntities: true,
  xmlMode: true,
  errorHandler: { warning() {}, error() {}, fatalError() {} },
} as unknown as ConstructorParameters<typeof DOMParser>[0]
function makeSafeDomParser() { return new DOMParser(_SAFE_DOM_PARSER_OPTS) as DOMParser }

function toNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeUpperText(value: string | null | undefined) {
  return (value || '').trim().toUpperCase()
}

function getPagoTaxTotalsFromXml(xmlContent: string) {
  const parser = makeSafeDomParser()

  try {
    const doc = parser.parseFromString(xmlContent, 'text/xml')
    const pagos = Array.from(doc.getElementsByTagName('*')).filter(el => el.nodeName.endsWith(':Pago'))
    let baseP = 0
    let importeP = 0

    pagos.forEach(pagoNode => {
      const impuestosP = Array.from(pagoNode.getElementsByTagName('*')).filter(el => el.nodeName.endsWith(':ImpuestosP'))
      impuestosP.forEach(impNode => {
        const trasladosP = Array.from(impNode.getElementsByTagName('*')).filter(el => el.nodeName.endsWith(':TrasladoP'))
        trasladosP.forEach(trasladoP => {
          if (normalizeUpperText(trasladoP.getAttribute('ImpuestoP')) !== '002') {
            return
          }

          baseP += toNumber(trasladoP.getAttribute('BaseP'))
          importeP += toNumber(trasladoP.getAttribute('ImporteP'))
        })
      })
    })

    return { baseP, importeP }
  } catch {
    return { baseP: 0, importeP: 0 }
  }
}

function resolveInvoiceXmlFromBlob(blob: {
  xmlCiphertext: string
  xmlIv: string
  xmlAuthTag: string
  xmlEncryptionAlg: string
} | null | undefined) {
  if (!blob) {
    return ''
  }

  try {
    return decryptInvoiceXmlContent({
      ciphertext: blob.xmlCiphertext,
      iv: blob.xmlIv,
      authTag: blob.xmlAuthTag,
      algorithm: blob.xmlEncryptionAlg
    })
  } catch {
    return ''
  }
}

function isGlobalPublicInvoice(xmlContent: string) {
  return /InformacionGlobal/i.test(xmlContent)
}

async function calculatePublicGeneralIncomeTotals(baseWhere: Prisma.InvoiceWhereInput) {
  let cursor: string | undefined
  let ventasGlobales = 0
  let operacionesIndividuales = 0

  do {
    const batch = await prisma.invoice.findMany({
      where: {
        ...baseWhere,
        cfdiType: CfdiType.INGRESO,
        satStatus: 'VIGENTE',
        receiverRfc: 'XAXX010101000'
      },
      orderBy: { id: 'asc' },
      take: INVOICE_BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        subtotal: true,
        blob: {
          select: {
            xmlCiphertext: true,
            xmlIv: true,
            xmlAuthTag: true,
            xmlEncryptionAlg: true
          }
        }
      }
    })

    if (batch.length === 0) {
      break
    }

    batch.forEach(invoice => {
      const xmlContent = resolveInvoiceXmlFromBlob(invoice.blob)
      const subtotal = toNumber(invoice.subtotal)

      if (isGlobalPublicInvoice(xmlContent)) {
        ventasGlobales += subtotal
        return
      }

      operacionesIndividuales += subtotal
    })

    cursor = batch[batch.length - 1]?.id
  } while (cursor)

  return { ventasGlobales, operacionesIndividuales }
}

function buildPaymentTaxTotalsByInvoiceUuid(details: Array<{
  paymentInvoiceUuid: string
  paymentNodeIndex: number
  baseP: Prisma.Decimal | number | null
  importeP: Prisma.Decimal | number | null
}>) {
  const paymentNodeTotals = new Map<string, { baseP: number; importeP: number }>()
  const paymentTaxTotalsByInvoiceUuid = new Map<string, { baseP: number; importeP: number }>()

  details.forEach(detail => {
    const invoiceUuid = normalizeUpperText(detail.paymentInvoiceUuid)
    const nodeKey = `${invoiceUuid}:${detail.paymentNodeIndex}`
    const currentNode = paymentNodeTotals.get(nodeKey) || { baseP: 0, importeP: 0 }
    currentNode.baseP = Math.max(currentNode.baseP, toNumber(detail.baseP))
    currentNode.importeP = Math.max(currentNode.importeP, toNumber(detail.importeP))
    paymentNodeTotals.set(nodeKey, currentNode)
  })

  paymentNodeTotals.forEach((nodeTotals, nodeKey) => {
    const separatorIndex = nodeKey.indexOf(':')
    const invoiceUuid = separatorIndex >= 0 ? nodeKey.slice(0, separatorIndex) : nodeKey
    const currentInvoice = paymentTaxTotalsByInvoiceUuid.get(invoiceUuid) || { baseP: 0, importeP: 0 }
    currentInvoice.baseP += nodeTotals.baseP
    currentInvoice.importeP += nodeTotals.importeP
    paymentTaxTotalsByInvoiceUuid.set(invoiceUuid, currentInvoice)
  })

  return paymentTaxTotalsByInvoiceUuid
}

export async function GET(request: NextRequest) {
  try {
    // DASH-SAST-008: enrichedUser para hasPermission granular EMISSION vs RECEPTION.
    const { ctx, searchParams, systemRole, enrichedUser } = await buildDashboardScopedContext(request, {
      routeKey: 'mainHeavy',
      requireCompanyId: true,
      // Default scoping permiso: DASHBOARD_FISCAL_VIEW. El gate granular se hace ABAJO por origin.
    })

    const startDateParam = searchParams.get('startDate')
    const endDateParam = searchParams.get('endDate')
    const originRaw = searchParams.get('origin') || 'issued'
    const originParam = String(originRaw).toLowerCase();
    // DASHBOARD-005 · Heavy metrics OPT-IN (default FALSE). Solo si usuario envía explicitamente "true".
    const includeHeavyMetrics = searchParams.get('includeHeavyMetrics') === 'true'

    // =================================================================
    // DASH-SAST-008 · Allow-list estricta parámetro origin + granular
    // permission check: EMISSION_VIEW para issued, RECEPTION_VIEW para received.
    // Fail-closed: sin permiso → 403. Para origin=both sin ambos → degradar
    // al único permiso que sí tenga (nunca exponer datos sin permiso).
    // =================================================================
    if (!DASH_FISCAL_ALLOWED_ORIGINS.has(originParam)) {
      return NextResponse.json(
        { error: 'Parámetro origin inválido. Valores permitidos: issued | received | both.', code: 'BAD_ORIGIN' },
        { status: 400, headers: SECURITY_HEADERS }
      )
    }

    const permissionUser: PermissionUser = { id: enrichedUser.id, systemRole: ctx.userSystemRole as SystemRole }
    const canViewIssued = hasPermission(
      permissionUser,
      Permission.MODULE_EMISSION_VIEW,
      ctx.organizationId
    )
    const canViewReceived = hasPermission(
      permissionUser,
      Permission.MODULE_RECEPTION_VIEW,
      ctx.organizationId
    )

    let effectiveOrigin: 'issued' | 'received' | 'both'
    if (originParam === 'received') {
      if (!canViewReceived) {
        return NextResponse.json(
          { error: 'Sin permiso para ver facturas recibidas (MODULE_RECEPTION_VIEW).', code: 'FORBIDDEN_RECEPTION' },
          { status: 403, headers: SECURITY_HEADERS }
        )
      }
      effectiveOrigin = 'received'
    } else if (originParam === 'both') {
      if (!canViewIssued && !canViewReceived) {
        return NextResponse.json(
          { error: 'Sin permiso para ver el dashboard fiscal (EMISSION ni RECEPTION).', code: 'FORBIDDEN_FISCAL' },
          { status: 403, headers: SECURITY_HEADERS }
        )
      }
      // Fail-closed degradación elegante: si solo tiene 1 permiso, mostramos ese scope.
      if (canViewIssued && canViewReceived) effectiveOrigin = 'both'
      else if (canViewIssued) effectiveOrigin = 'issued'
      else effectiveOrigin = 'received'
    } else {
      // issued default
      if (!canViewIssued) {
        return NextResponse.json(
          { error: 'Sin permiso para ver facturas emitidas (MODULE_EMISSION_VIEW).', code: 'FORBIDDEN_EMISSION' },
          { status: 403, headers: SECURITY_HEADERS }
        )
      }
      effectiveOrigin = 'issued'
    }

    const companyId = searchParams.get('companyId')!

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { rfc: true, businessName: true }
    })
    if (!company?.rfc) {
      return NextResponse.json(
        { error: 'Empresa no encontrada' },
        { status: 404, headers: SECURITY_HEADERS }
      )
    }

    const rfc = company.rfc

    // Find matching fiscal entity strictly within the scoped ORGANIZATION from ctx (DASHBOARD-003 RFC leak).
    const fiscalEntity = await prisma.fiscalEntity.findFirst({
      where: { rfc, organizationId: ctx.organizationId },
      select: {
        id: true,
        organizationId: true
      }
    })

    // Do not auto-create fiscal entities or demo invoices; show empty metrics when absent.

    if (!fiscalEntity) {
      return NextResponse.json({
        company: { id: companyId, rfc, name: company.businessName },
        kpis: {
          totalCfdis: 0,
          totalMonto: 0,
          tasaCancelacion: 0,
          taxes: {
            ivaTrasladado: 0,
            ivaRetenido: 0,
            isrRetenido: 0,
            iepsRetenido: 0,
            breakdown: {
              tasa16: { base: 0, tax: 0 },
              tasa8: { base: 0, tax: 0 },
              tasa0: { base: 0, tax: 0 },
              exento: { base: 0, tax: 0 }
            }
          }
        },
        byType: [],
        bySatStatus: [],
        monthly: [],
        topSuppliers: [],
        topClients: [],
        paymentMethods: [],
        _security: {
          originRequested: originParam,
          originEffective: effectiveOrigin,
          canViewIssued,
          canViewReceived
        },
        meta: {
          heavyMetricsIncluded: false
        }
      }, { headers: SECURITY_HEADERS })
    }

    const issuerFiscalEntityId = fiscalEntity.id
    void systemRole

    const dateFilter: Prisma.InvoiceWhereInput = {}
    if (startDateParam && endDateParam) {
      // Adjust endDate to include the full day
      const end = new Date(endDateParam)
      end.setHours(23, 59, 59, 999)
      
      dateFilter.issuanceDate = {
        gte: new Date(startDateParam),
        lte: end
      }
    }

    // =================================================================
    // DASH-SAST-008: filtro base ahora depende de effectiveOrigin.
    // =================================================================
    let baseWhere: Prisma.InvoiceWhereInput
    if (effectiveOrigin === 'received') {
      baseWhere = {
        receiverRfc: rfc,
        cfdiType: { in: [CfdiType.INGRESO, CfdiType.PAGO] },
        ...dateFilter
      }
    } else if (effectiveOrigin === 'both') {
      baseWhere = {
        OR: [
          { issuerFiscalEntityId, issuerRfc: rfc },
          { receiverRfc: rfc }
        ],
        cfdiType: { in: [CfdiType.INGRESO, CfdiType.PAGO] },
        ...dateFilter
      }
    } else {
      // issued default
      baseWhere = { 
        issuerFiscalEntityId, 
        issuerRfc: rfc, 
        cfdiType: { in: [CfdiType.INGRESO, CfdiType.PAGO] },
        ...dateFilter
      }
    }

    // Determine months for chart
    let monthsToQuery: Date[] = []
    if (startDateParam && endDateParam) {
      const start = new Date(startDateParam)
      const end = new Date(endDateParam)
      // Normalize to start of month
      const current = new Date(start.getFullYear(), start.getMonth(), 1)
      const last = new Date(end.getFullYear(), end.getMonth(), 1)

      // DASHBOARD-006 · Hard-cap MAX_MONTHS=36 para evitar 192 queries paralelas Promise.all.
      const diffMonthsRaw = (last.getFullYear() - current.getFullYear()) * 12 + (last.getMonth() - current.getMonth()) + 1
      if (diffMonthsRaw > DASHBOARD_MAX_MONTHS) {
        return NextResponse.json(
          { error: `Rango de fechas inválido. Máximo permitido ${DASHBOARD_MAX_MONTHS} meses (3 años).` },
          { status: 400, headers: SECURITY_HEADERS }
        )
      }

      while (current <= last) {
        monthsToQuery.push(new Date(current))
        current.setMonth(current.getMonth() + 1)
      }
    } else {
      // Default: last 12 months
      monthsToQuery = Array.from({ length: 12 }, (_, i) => {
        const d = new Date()
        d.setMonth(d.getMonth() - i)
        return new Date(d.getFullYear(), d.getMonth(), 1)
      }).reverse() // Chronological order
    }

    if (!includeHeavyMetrics && effectiveOrigin === 'issued') {
      const summaryDateFilter: Prisma.InvoiceIssuedDailySummaryWhereInput = {}
      if (startDateParam && endDateParam) {
        const end = new Date(endDateParam)
        end.setHours(23, 59, 59, 999)
        summaryDateFilter.summaryDate = {
          gte: new Date(startDateParam),
          lte: end
        }
      }

      const summaryRows = await prisma.invoiceIssuedDailySummary.findMany({
        where: {
          organizationId: fiscalEntity.organizationId,
          issuerFiscalEntityId,
          ...summaryDateFilter
        },
        select: {
          summaryDate: true,
          cfdiType: true,
          satStatus: true,
          receiverRfc: true,
          receiverName: true,
          paymentMethod: true,
          salesBucket: true,
          cfdiCount: true,
          subtotalAmount: true,
          discountAmount: true,
          totalAmount: true,
          ivaTransferredTotal: true,
          ivaWithheldTotal: true,
          isrWithheldTotal: true,
          iepsWithheldTotal: true,
          collectedAmount: true,
          pendingAmount: true,
          overdueAmount: true,
          creditNoteAppliedAmount: true
        }
      })

      const monthMap = new Map<string, {
        label: string
        count: number
        total: number
        taxes: {
          ivaTrasladado: number
          ivaRetenido: number
          isrRetenido: number
          iepsRetenido: number
        }
      }>()

      monthsToQuery.forEach(start => {
        const monthKey = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`
        monthMap.set(monthKey, {
          label: `${start.toLocaleString('es-MX', { month: 'short' })} ${start.getFullYear()}`,
          count: 0,
          total: 0,
          taxes: {
            ivaTrasladado: 0,
            ivaRetenido: 0,
            isrRetenido: 0,
            iepsRetenido: 0
          }
        })
      })

      const byTypeMap = new Map<string, { type: string; count: number; total: number }>()
      const bySatStatusMap = new Map<string, { status: string; count: number }>()
      const paymentMethodsMap = new Map<string, { method: string; count: number; total: number }>()
      const topClientsMap = new Map<string, { rfc: string; name: string; total: number; cobrado: number; pendiente: number }>()

      let totalCfdis = 0
      let totalMonto = 0
      let ivaTrasladado = 0
      let ivaRetenido = 0
      let isrRetenido = 0
      let iepsRetenido = 0
      let ventasNominativas = 0
      let ventasGlobales = 0
      let operacionesIndividuales = 0
      let ingresosBrutos = 0
      let descuentosYBonificaciones = 0
      let montoCancelado = 0
      let cancelCount = 0
      let montoNotasCredito = 0
      let montoCanceladoEgresos = 0

      let collectedTotal = 0
      let collectedPueTotal = 0
      let collectedCrpTotal = 0
      let pendingTotal = 0
      let creditNoteAppliedTotal = 0

      summaryRows.forEach(row => {
        const cfdiType = normalizeUpperText(row.cfdiType)
        const satStatus = normalizeUpperText(row.satStatus)
        const paymentMethod = normalizeUpperText(row.paymentMethod)
        const salesBucket = normalizeUpperText(row.salesBucket)
        const receiverRfc = normalizeUpperText(row.receiverRfc)
        const receiverName = (row.receiverName || '').trim()
        const cfdiCount = row.cfdiCount || 0
        const totalAmount = toNumber(row.totalAmount)
        const subtotalAmount = toNumber(row.subtotalAmount)
        const discountAmount = toNumber(row.discountAmount)
        const ivaTransferredTotal = toNumber(row.ivaTransferredTotal)
        const ivaWithheldTotal = toNumber(row.ivaWithheldTotal)
        const isrWithheldTotal = toNumber(row.isrWithheldTotal)
        const iepsWithheldTotal = toNumber(row.iepsWithheldTotal)
        const collectedAmount = toNumber(row.collectedAmount)
        const pendingAmount = toNumber(row.pendingAmount)
        const creditNoteAppliedAmount = toNumber(row.creditNoteAppliedAmount)

        if (cfdiType === 'INGRESO' || cfdiType === 'PAGO') {
          totalCfdis += cfdiCount
          totalMonto += totalAmount
          ivaTrasladado += ivaTransferredTotal
          ivaRetenido += ivaWithheldTotal
          isrRetenido += isrWithheldTotal
          iepsRetenido += iepsWithheldTotal

          const byTypeEntry = byTypeMap.get(cfdiType) || { type: cfdiType, count: 0, total: 0 }
          byTypeEntry.count += cfdiCount
          byTypeEntry.total += totalAmount
          byTypeMap.set(cfdiType, byTypeEntry)

          if (satStatus === 'VIGENTE' || satStatus === 'CANCELADO') {
            const byStatusEntry = bySatStatusMap.get(satStatus) || { status: satStatus, count: 0 }
            byStatusEntry.count += cfdiCount
            bySatStatusMap.set(satStatus, byStatusEntry)
          }

          const summaryDate = row.summaryDate instanceof Date ? row.summaryDate : new Date(row.summaryDate)
          const monthKey = `${summaryDate.getUTCFullYear()}-${String(summaryDate.getUTCMonth() + 1).padStart(2, '0')}`
          const monthEntry = monthMap.get(monthKey)
          if (monthEntry) {
            monthEntry.count += cfdiCount
            monthEntry.total += totalAmount
            monthEntry.taxes.ivaTrasladado += ivaTransferredTotal
            monthEntry.taxes.ivaRetenido += ivaWithheldTotal
            monthEntry.taxes.isrRetenido += isrWithheldTotal
            monthEntry.taxes.iepsRetenido += iepsWithheldTotal
          }

          if (cfdiType === 'INGRESO' && (paymentMethod === 'PUE' || paymentMethod === 'PPD')) {
            const paymentMethodEntry = paymentMethodsMap.get(paymentMethod) || { method: paymentMethod, count: 0, total: 0 }
            paymentMethodEntry.count += cfdiCount
            paymentMethodEntry.total += totalAmount
            paymentMethodsMap.set(paymentMethod, paymentMethodEntry)
          }

          if (receiverRfc) {
            const topClientEntry = topClientsMap.get(receiverRfc) || { rfc: receiverRfc, name: receiverName || receiverRfc, total: 0, cobrado: 0, pendiente: 0 }
            topClientEntry.total += totalAmount
            topClientEntry.cobrado += collectedAmount
            topClientEntry.pendiente += pendingAmount
            if (!topClientEntry.name && receiverName) {
              topClientEntry.name = receiverName
            }
            topClientsMap.set(receiverRfc, topClientEntry)
          }
        }

        if (cfdiType === 'INGRESO' && satStatus === 'VIGENTE') {
          ingresosBrutos += subtotalAmount
          descuentosYBonificaciones += discountAmount
          collectedTotal += collectedAmount
          pendingTotal += pendingAmount
          creditNoteAppliedTotal += creditNoteAppliedAmount

          if (paymentMethod === 'PUE') {
            collectedPueTotal += collectedAmount
          } else if (paymentMethod === 'PPD') {
            collectedCrpTotal += collectedAmount
          }

          if (salesBucket === 'NOMINATIVA') {
            ventasNominativas += subtotalAmount
          } else if (salesBucket === 'GLOBAL') {
            ventasGlobales += subtotalAmount
          } else if (salesBucket === 'INDIVIDUAL') {
            operacionesIndividuales += subtotalAmount
          }
        }

        if (cfdiType === 'INGRESO' && satStatus === 'CANCELADO') {
          montoCancelado += totalAmount
          cancelCount += cfdiCount
        }

        if (cfdiType === 'EGRESO' && satStatus === 'VIGENTE') {
          montoNotasCredito += subtotalAmount
        }

        if (cfdiType === 'EGRESO' && satStatus === 'CANCELADO') {
          montoCanceladoEgresos += totalAmount
        }
      })

      const ingresosNetos = Math.max(
        ingresosBrutos - descuentosYBonificaciones - montoNotasCredito - creditNoteAppliedTotal,
        0
      )

      const ratioTransladoANeto = ingresosNetos > 0 ? ivaTrasladado / Math.max(ingresosBrutos, 1) : 0

      const ivaCobradoAproximado = collectedTotal * ratioTransladoANeto
      const ivaPendienteCobroAproximado = pendingTotal * ratioTransladoANeto
      const ivaNetoReales = ingresosNetos * ratioTransladoANeto

      const totalImpuestosRetenidos = ivaRetenido + isrRetenido + iepsRetenido

      const summaryDaysWithCoverage = new Set<string>()
      summaryRows.forEach(row => {
        const d = row.summaryDate instanceof Date ? row.summaryDate : new Date(row.summaryDate)
        summaryDaysWithCoverage.add(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`)
      })

      let totalRangeDays = 0
      if (startDateParam && endDateParam) {
        const s = new Date(startDateParam)
        const e = new Date(endDateParam)
        s.setHours(0, 0, 0, 0)
        e.setHours(0, 0, 0, 0)
        totalRangeDays = Math.max(1, Math.round((e.getTime() - s.getTime()) / 86400000) + 1)
      } else {
        totalRangeDays = Math.max(1, summaryDaysWithCoverage.size)
      }

      return NextResponse.json({
        company: { id: companyId, rfc, name: company.businessName },
        kpis: {
          totalCfdis,
          totalMonto,
          ventasNominativas,
          ventasGlobales,
          operacionesIndividuales,
          ingresosBrutos,
          descuentosYBonificaciones,
          montoNotasCredito,
          ingresosNetosReales: ingresosNetos,
          ingresosCobradosTotal: collectedTotal,
          ingresosCobradosPue: collectedPueTotal,
          ingresosCobradosCrp: collectedCrpTotal,
          ingresosPendientesCobro: pendingTotal,
          creditNoteAppliedOnPpds: creditNoteAppliedTotal,
          tasaCancelacion: totalCfdis ? Math.round((cancelCount / totalCfdis) * 100) : 0,
          montoCancelado,
          montoCanceladoEgresos,
          taxes: {
            ivaTrasladado,
            ivaRetenido,
            isrRetenido,
            iepsRetenido,
            totalImpuestosRetenidos,
            ivaCobradoTotal: Number(ivaCobradoAproximado.toFixed(2)),
            ivaIngresosNetosReales: Number(ivaNetoReales.toFixed(2)),
            ivaPendienteCobro: Number(ivaPendienteCobroAproximado.toFixed(2)),
            breakdown: {
              tasa16: { base: 0, tax: 0 },
              tasa8: { base: 0, tax: 0 },
              tasa0: { base: 0, tax: 0 },
              exento: { base: 0, tax: 0 }
            },
            heavyMetricsEstimated: summaryRows.length > 0
          }
        },
        byType: Array.from(byTypeMap.values()),
        bySatStatus: Array.from(bySatStatusMap.values()),
        monthly: monthsToQuery.map(start => {
          const monthKey = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`
          return monthMap.get(monthKey) || {
            label: `${start.toLocaleString('es-MX', { month: 'short' })} ${start.getFullYear()}`,
            count: 0,
            total: 0,
            taxes: {
              ivaTrasladado: 0,
              ivaRetenido: 0,
              isrRetenido: 0,
              iepsRetenido: 0
            }
          }
        }),
        topClients: Array.from(topClientsMap.values())
          .sort((a, b) => b.total - a.total)
          .slice(0, 10),
        topProducts: [],
        paymentMethods: Array.from(paymentMethodsMap.values()),
        meta: {
          heavyMetricsIncluded: false,
          heavyMetricsFromSummary: summaryRows.length > 0,
          summaryCoverage: {
            days: summaryDaysWithCoverage.size,
            totalDays: totalRangeDays,
            stale: summaryDaysWithCoverage.size < totalRangeDays
          },
          source: 'summary'
        }
      })
    }

    // Aggregations
    const [byType, bySatStatus, monthly, topCounterparties, paymentMethods, totals, ventasNominativas, publicGeneralTotals, ingresosBrutosData, topProducts] = await Promise.all([
      // CFDI type counts and sums
      prisma.invoice.groupBy({
        by: ['cfdiType'],
        where: baseWhere,
        _count: { _all: true },
        _sum: { total: true }
      }),
      // SAT status distribution
      prisma.invoice.groupBy({
        by: ['satStatus'],
        where: { ...baseWhere, satStatus: { in: ['VIGENTE', 'CANCELADO'] } },
        _count: { _all: true }
      }),
      // Monthly totals (12 aggregate queries in parallel via Promise.all)
      Promise.all(
        monthsToQuery.map(start => {
          const end = new Date(start.getFullYear(), start.getMonth() + 1, 0)
          end.setHours(23, 59, 59, 999)
          
          return prisma.invoice.aggregate({
            where: { ...baseWhere, issuanceDate: { gte: start, lte: end } },
            _count: { _all: true },
            _sum: { 
              total: true,
              ivaTransferred: true,
              ivaWithheld: true,
              isrWithheld: true,
              iepsWithheld: true
            }
          }).then(res => ({
            label: `${start.toLocaleString('es-MX', { month: 'short' })} ${start.getFullYear()}`,
            count: res._count._all || 0,
            total: res._sum.total || 0,
            taxes: {
              ivaTrasladado: Number(res._sum.ivaTransferred || 0),
              ivaRetenido: Number(res._sum.ivaWithheld || 0),
              isrRetenido: Number(res._sum.isrWithheld || 0),
              iepsRetenido: Number(res._sum.iepsWithheld || 0)
            }
          }))
        })
      ),
      // Top 10 clients grouped strictly by RFC to avoid name-based duplicates
      (effectiveOrigin === 'received'
        ? prisma.invoice.groupBy({
            by: ['issuerRfc'],
            where: baseWhere,
            _sum: { total: true },
            orderBy: { _sum: { total: 'desc' } },
            take: 10
          })
        : prisma.invoice.groupBy({
            by: ['receiverRfc'],
            where: baseWhere,
            _sum: { total: true },
            orderBy: { _sum: { total: 'desc' } },
            take: 10
          })
      ),
      // Payment method usage (INGRESO only).
      (() => {
        const where: Prisma.InvoiceWhereInput = {
          ...baseWhere,
          cfdiType: CfdiType.INGRESO,
          paymentMethod: { in: ['PUE', 'PPD'] },
        }
        return prisma.invoice.groupBy({
          by: ['paymentMethod'],
          where,
          _count: { _all: true },
          _sum: { total: true },
        })
      })(),
      // Totals and cancellations
      prisma.invoice.aggregate({
        where: baseWhere,
        _count: { _all: true },
        _sum: { 
          total: true,
          ivaTransferred: true,
          ivaWithheld: true,
          isrWithheld: true,
          iepsWithheld: true
        },
      }),
      // Ventas Nominativas
      prisma.invoice.aggregate({
        where: {
          ...baseWhere,
          cfdiType: CfdiType.INGRESO,
          satStatus: 'VIGENTE',
          receiverRfc: {
            notIn: ['XAXX010101000', 'XEXX010101000']
          }
        },
        _sum: { subtotal: true }
      }),
      calculatePublicGeneralIncomeTotals(baseWhere),
      // Ingresos Brutos Reales (Brutos y Descuentos)
      prisma.invoice.aggregate({
        where: {
          ...baseWhere,
          cfdiType: CfdiType.INGRESO,
          satStatus: 'VIGENTE'
        },
        _sum: { subtotal: true, discount: true }
      }),
      // Top 10 products
      prisma.invoiceConcept.groupBy({
        by: ['description'],
        where: { invoice: baseWhere },
        _sum: { amount: true },
        orderBy: { _sum: { amount: 'desc' } },
        take: 10
      })
    ])

    // Calculate Tax Breakdown
    const ivaBreakdown = {
      tasa16: { base: 0, tax: 0 },
      tasa8: { base: 0, tax: 0 },
      tasa0: { base: 0, tax: 0 },
      exento: { base: 0, tax: 0 }
    }

    let totalIvaXml = 0
    let totalImpuestosRetenidosXml = 0
    let ivaCobradoTotal = 0
    let ivaCobradoCrp = 0
    let ivaEnFacturasPpd = 0
    let ingresosCobradosPue = 0
    let ingresosCobradosCrp = 0

    // Use RegEx for faster parsing of XML contents, scoped to Conceptos to avoid double counting
    const conceptosRegex = /<[^:>]*:?Conceptos[^>]*>([\s\S]*?)<\/[^:>]*:?Conceptos>/i
    const trasladoRegex = /<[^:>]*:?Traslado([^>]+)>/gi
    const attrRegex = /(\w+)="([^"]+)"/g
    const totalRetenidosRegex = /TotalImpuestosRetenidos=["']([^"']+)["']/i
    let ivaPueRecibido = 0
    let ivaPpdRecibido = 0
    let ivaERecibido = 0

    if (includeHeavyMetrics) {
      let emittedCursor: string | undefined
      do {
        const emittedBatch = await prisma.invoice.findMany({
          where: { ...baseWhere, satStatus: 'VIGENTE' },
          orderBy: { id: 'asc' },
          take: INVOICE_BATCH_SIZE,
          ...(emittedCursor ? { cursor: { id: emittedCursor }, skip: 1 } : {}),
          select: {
            id: true,
            uuid: true,
            cfdiType: true,
            paymentMethod: true,
            currency: true,
            exchangeRate: true,
            subtotal: true,
            blob: {
              select: {
                xmlCiphertext: true,
                xmlIv: true,
                xmlAuthTag: true,
                xmlEncryptionAlg: true
              }
            }
          }
        })

        if (emittedBatch.length === 0) {
          break
        }

        const paymentInvoiceUuids = emittedBatch
          .filter(inv => inv.cfdiType === 'PAGO')
          .map(inv => normalizeUpperText(inv.uuid))
          .filter(Boolean)

        const paymentTaxTotalsByInvoiceUuid = paymentInvoiceUuids.length > 0
          ? buildPaymentTaxTotalsByInvoiceUuid(
              await prisma.invoicePaymentComplementDetail.findMany({
                where: {
                  paymentInvoiceUuid: { in: paymentInvoiceUuids },
                  satStatusSnapshot: 'VIGENTE'
                },
                select: {
                  paymentInvoiceUuid: true,
                  paymentNodeIndex: true,
                  baseP: true,
                  importeP: true
                }
              })
            )
          : new Map<string, { baseP: number; importeP: number }>()

        emittedBatch.forEach(inv => {
          const xml = resolveInvoiceXmlFromBlob(inv.blob)
          if (!xml) return

          const conceptosMatch = xml.match(conceptosRegex)
          const parseTarget = conceptosMatch ? conceptosMatch[1] : xml

          const retenidosMatch = xml.match(totalRetenidosRegex)
          if (retenidosMatch) {
            totalImpuestosRetenidosXml += parseFloat(retenidosMatch[1] || '0')
          }

          if (inv.cfdiType === 'INGRESO' && inv.paymentMethod === 'PUE') {
            let subtotal = Number(inv.subtotal) || 0
            if (inv.currency && inv.currency !== 'MXN' && inv.exchangeRate) {
              subtotal = subtotal * Number(inv.exchangeRate)
            }
            ingresosCobradosPue += subtotal
          }

          for (const m of parseTarget.matchAll(trasladoRegex)) {
            const attrsStr = m[1]
            const attrs: Record<string, string> = {}
            for (const attrMatch of attrsStr.matchAll(attrRegex)) {
              attrs[attrMatch[1]] = attrMatch[2]
            }

            if (attrs['Impuesto'] === '002' || attrs['Impuesto'] === 'IVA') {
              const base = parseFloat(attrs['Base'] || '0')
              const tax = parseFloat(attrs['Importe'] || '0')
              const tasa = parseFloat(attrs['TasaOCuota'] || '0')
              const tipo = attrs['TipoFactor']

              totalIvaXml += tax

              if (tipo === 'Exento') {
                ivaBreakdown.exento.base += base
              } else if (tipo === 'Tasa' || attrs['TasaOCuota']) {
                if (Math.abs(tasa - 0.16) < 0.01) {
                  ivaBreakdown.tasa16.base += base
                  ivaBreakdown.tasa16.tax += tax
                } else if (Math.abs(tasa - 0.08) < 0.01) {
                  ivaBreakdown.tasa8.base += base
                  ivaBreakdown.tasa8.tax += tax
                } else if (Math.abs(tasa - 0.0) < 0.001) {
                  ivaBreakdown.tasa0.base += base
                }
              }

              if (inv.cfdiType === 'INGRESO' && inv.paymentMethod === 'PUE' && attrs['Impuesto'] === '002') {
                ivaCobradoTotal += tax
              }

              if (inv.cfdiType === 'INGRESO' && inv.paymentMethod === 'PPD' && attrs['Impuesto'] === '002') {
                ivaEnFacturasPpd += tax
              }
            }
          }

          if (inv.cfdiType === 'PAGO') {
            const paymentTotals = paymentTaxTotalsByInvoiceUuid.get(normalizeUpperText(inv.uuid))
              || getPagoTaxTotalsFromXml(xml)

            ivaCobradoTotal += paymentTotals.importeP
            ivaCobradoCrp += paymentTotals.importeP
            ingresosCobradosCrp += paymentTotals.baseP
          }
        })

        emittedCursor = emittedBatch[emittedBatch.length - 1]?.id
      } while (emittedCursor)

      let receivedCursor: string | undefined
      do {
        const receivedBatch = await prisma.invoice.findMany({
          where: {
            receiverRfc: rfc,
            cfdiType: { in: ['INGRESO', 'EGRESO', 'PAGO'] },
            satStatus: 'VIGENTE',
            ...dateFilter
          },
          orderBy: { id: 'asc' },
          take: INVOICE_BATCH_SIZE,
          ...(receivedCursor ? { cursor: { id: receivedCursor }, skip: 1 } : {}),
          select: {
            id: true,
            uuid: true,
            cfdiType: true,
            paymentMethod: true,
            blob: {
              select: {
                xmlCiphertext: true,
                xmlIv: true,
                xmlAuthTag: true,
                xmlEncryptionAlg: true
              }
            }
          }
        })

        if (receivedBatch.length === 0) {
          break
        }

        const paymentInvoiceUuids = receivedBatch
          .filter(inv => inv.cfdiType === 'PAGO')
          .map(inv => normalizeUpperText(inv.uuid))
          .filter(Boolean)

        const paymentTaxTotalsByInvoiceUuid = paymentInvoiceUuids.length > 0
          ? buildPaymentTaxTotalsByInvoiceUuid(
              await prisma.invoicePaymentComplementDetail.findMany({
                where: {
                  paymentInvoiceUuid: { in: paymentInvoiceUuids },
                  satStatusSnapshot: 'VIGENTE'
                },
                select: {
                  paymentInvoiceUuid: true,
                  paymentNodeIndex: true,
                  baseP: true,
                  importeP: true
                }
              })
            )
          : new Map<string, { baseP: number; importeP: number }>()

        receivedBatch.forEach(inv => {
          const xml = resolveInvoiceXmlFromBlob(inv.blob)
          if (!xml) return

          if (inv.cfdiType === 'INGRESO' && inv.paymentMethod === 'PUE') {
            const conceptosMatch = xml.match(conceptosRegex)
            const parseTarget = conceptosMatch ? conceptosMatch[1] : xml
            for (const m of parseTarget.matchAll(trasladoRegex)) {
              const attrsStr = m[1]
              const attrs: Record<string, string> = {}
              for (const attrMatch of attrsStr.matchAll(attrRegex)) {
                attrs[attrMatch[1]] = attrMatch[2]
              }
              if (attrs['Impuesto'] === '002') {
                ivaPueRecibido += parseFloat(attrs['Importe'] || '0')
              }
            }
          }

          if (inv.cfdiType === 'EGRESO') {
            const conceptosMatch = xml.match(conceptosRegex)
            const parseTarget = conceptosMatch ? conceptosMatch[1] : xml
            for (const m of parseTarget.matchAll(trasladoRegex)) {
              const attrsStr = m[1]
              const attrs: Record<string, string> = {}
              for (const attrMatch of attrsStr.matchAll(attrRegex)) {
                attrs[attrMatch[1]] = attrMatch[2]
              }
              if (attrs['Impuesto'] === '002') {
                ivaERecibido += parseFloat(attrs['Importe'] || '0')
              }
            }
          }

          if (inv.cfdiType === 'PAGO') {
            const paymentTotals = paymentTaxTotalsByInvoiceUuid.get(normalizeUpperText(inv.uuid))
              || getPagoTaxTotalsFromXml(xml)

            ivaPpdRecibido += paymentTotals.importeP
          }
        })

        receivedCursor = receivedBatch[receivedBatch.length - 1]?.id
      } while (receivedCursor)
    }

    const cancelled = await prisma.invoice.aggregate({ 
      where: { ...baseWhere, satStatus: 'CANCELADO', cfdiType: CfdiType.INGRESO },
      _sum: { total: true },
      _count: { _all: true }
    })
    
    // Calculate egresos (Credit Notes)
    let egresosWhere: Prisma.InvoiceWhereInput

    if (effectiveOrigin === 'received') {
      egresosWhere = { receiverRfc: rfc, cfdiType: CfdiType.EGRESO, ...dateFilter }
    } else if (effectiveOrigin === 'both') {
       egresosWhere = { 
         OR: [{ issuerRfc: rfc }, { receiverRfc: rfc }], 
         cfdiType: CfdiType.EGRESO, 
         ...dateFilter 
       }
    } else {
      egresosWhere = { issuerFiscalEntityId, issuerRfc: rfc, cfdiType: CfdiType.EGRESO, ...dateFilter }
    }

    const egresos = await prisma.invoice.aggregate({
      where: { ...egresosWhere, satStatus: 'VIGENTE' },
      _sum: { subtotal: true }
    })

    const cancelledEgresos = await prisma.invoice.aggregate({
      where: { ...egresosWhere, satStatus: 'CANCELADO' },
      _sum: { total: true }
    })

    // Calculate Monto Cobrado and Monto Por Cobrar
    const pueInvoices = await prisma.invoice.groupBy({
      by: ['issuerRfc', 'receiverRfc'],
      where: { ...baseWhere, paymentMethod: 'PUE' },
      _sum: { total: true }
    })
    const totalPUE = pueInvoices.reduce((acc, curr) => acc + (Number(curr._sum.total) || 0), 0)

    const ppdInvoicesList = await prisma.invoice.findMany({
      where: { ...baseWhere, paymentMethod: 'PPD' },
      select: { uuid: true, total: true, issuanceDate: true, issuerRfc: true, receiverRfc: true },
    })

    const ppdUuids = ppdInvoicesList.map(i => i.uuid)
    const paidAmountsByUuid: Record<string, number> = {}

    const paymentDetails = ppdUuids.length > 0 ? await prisma.invoicePaymentComplementDetail.findMany({
      where: {
        relatedInvoiceUuid: { in: ppdUuids },
        satStatusSnapshot: 'VIGENTE'
      },
      select: {
        relatedInvoiceUuid: true,
        impPagado: true
      }
    }) : []

    paymentDetails.forEach(detail => {
      const relatedUuid = normalizeUpperText(detail.relatedInvoiceUuid)
      paidAmountsByUuid[relatedUuid] = (paidAmountsByUuid[relatedUuid] || 0) + toNumber(detail.impPagado)
    })

    const coveredPpdUuids = new Set(paymentDetails.map(detail => normalizeUpperText(detail.relatedInvoiceUuid)))
    const missingPpdUuids = ppdUuids.filter(uuid => !coveredPpdUuids.has(normalizeUpperText(uuid)))

    if (missingPpdUuids.length > 0) {
      const relatedCfdis = await prisma.invoiceRelatedCfdi.findMany({
        where: {
          relatedUuid: { in: missingPpdUuids },
          invoice: { cfdiType: 'PAGO', satStatus: 'VIGENTE' }
        },
        include: {
          invoice: {
            select: {
              blob: {
                select: {
                  xmlCiphertext: true,
                  xmlIv: true,
                  xmlAuthTag: true,
                  xmlEncryptionAlg: true
                }
              }
            }
          }
        }
      })

      const parser = makeSafeDomParser()
      const getAttr = (el: Element, name: string) => el.getAttribute(name) || ''

      relatedCfdis.forEach(relation => {
        const xml = resolveInvoiceXmlFromBlob(relation.invoice.blob)
        if (!xml) return
        try {
          const doc = parser.parseFromString(xml, 'text/xml')
          const pagos = Array.from(doc.getElementsByTagName('*')).filter(el => el.nodeName.endsWith(':Pago'))
          pagos.forEach(pagoNode => {
            const doctos = Array.from(pagoNode.getElementsByTagName('*')).filter(el =>
              el.nodeName.endsWith(':DoctoRelacionado')
              && getAttr(el, 'IdDocumento').toLowerCase() === relation.relatedUuid.toLowerCase()
            )
            doctos.forEach(doctoNode => {
              const impPagado = parseFloat(getAttr(doctoNode, 'ImpPagado') || '0') || 0
              paidAmountsByUuid[relation.relatedUuid] = (paidAmountsByUuid[relation.relatedUuid] || 0) + impPagado
            })
          })
        } catch {
          // ignore parse error
        }
      })
    }

    let totalPPDFullyPaid = 0
    let totalPPDPending = 0
    let carteraVencida = 0

    const now = new Date()
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

    ppdInvoicesList.forEach(inv => {
      const paid = paidAmountsByUuid[normalizeUpperText(inv.uuid)] || 0
      // Consider fully paid if remaining balance is practically zero
      if (paid >= Number(inv.total) - 0.01) {
        totalPPDFullyPaid += Number(inv.total)
      } else {
        totalPPDPending += Number(inv.total)
        
        // Calculate Cartera Vencida (older than 30 days and not fully paid)
        if (now.getTime() - new Date(inv.issuanceDate).getTime() > THIRTY_DAYS_MS) {
          carteraVencida += (Number(inv.total) - paid)
        }
      }
    })

    const montoCobrado = totalPUE + totalPPDFullyPaid
    const montoPorCobrar = totalPPDPending

    // Ingresos Pendientes de Cobro (PPD - CRP - Notas de Crédito)
    const relatedEgresos = ppdUuids.length > 0 ? await prisma.invoiceRelatedCfdi.findMany({
      where: {
        relatedUuid: { in: ppdUuids },
        invoice: { cfdiType: 'EGRESO', satStatus: 'VIGENTE' }
      },
      select: {
        invoiceId: true,
        invoice: {
          select: {
            total: true,
            blob: {
              select: {
                xmlCiphertext: true,
                xmlIv: true,
                xmlAuthTag: true,
                xmlEncryptionAlg: true
              }
            }
          }
        }
      },
      distinct: ['invoiceId']
    }) : []
    const sumNotasCreditoAplicadas = relatedEgresos.reduce((acc, rel) => acc + Number(rel.invoice.total), 0)

    // Calcular IVA de Ajustes (Notas de Crédito relacionadas a PPD)
    let ivaNotasCreditoPpd = 0
    if (includeHeavyMetrics) {
      relatedEgresos.forEach(rel => {
        const xml = resolveInvoiceXmlFromBlob(rel.invoice.blob)
        if (!xml) return
        const conceptosMatch = xml.match(conceptosRegex)
        const parseTarget = conceptosMatch ? conceptosMatch[1] : xml
        for (const m of parseTarget.matchAll(trasladoRegex)) {
          const attrsStr = m[1]
          const attrs: Record<string, string> = {}
          for (const attrMatch of attrsStr.matchAll(attrRegex)) {
            attrs[attrMatch[1]] = attrMatch[2]
          }
          if (attrs['Impuesto'] === '002') {
            ivaNotasCreditoPpd += parseFloat(attrs['Importe'] || '0')
          }
        }
      })
    }

    const sumFacturasPPD = ppdInvoicesList.reduce((acc, inv) => acc + Number(inv.total), 0)
    const sumComplementosPago = Object.values(paidAmountsByUuid).reduce((acc, val) => acc + val, 0)
    const ingresosPendientesCobro = sumFacturasPPD - sumComplementosPago - sumNotasCreditoAplicadas
    const ivaPendienteCobro = ivaEnFacturasPpd - ivaCobradoCrp - ivaNotasCreditoPpd

    // Resolve display names for top clients by RFC (single groupBy IN query vs N+1 findFirst)
    const topRfcs = topCounterparties.map(c => 
      effectiveOrigin === 'received' 
        ? (c as unknown as { issuerRfc: string }).issuerRfc 
        : (c as unknown as { receiverRfc: string }).receiverRfc
    ).filter(Boolean)

    const nameMap: Record<string, string> = {}
    if (topRfcs.length > 0) {
      const rfcIn: Prisma.StringFilter<'Invoice'> = { in: topRfcs as string[] }
      if (effectiveOrigin === 'received') {
        const nameGroups = await prisma.invoice.groupBy({
          by: ['issuerRfc'],
          where: { issuerRfc: rfcIn },
          _min: { issuerName: true }
        })
        for (const g of nameGroups) {
          if (g.issuerRfc) nameMap[g.issuerRfc] = g._min.issuerName || g.issuerRfc
        }
      } else if (effectiveOrigin === 'both') {
        const [asIssuer, asReceiver] = await Promise.all([
          prisma.invoice.groupBy({
            by: ['issuerRfc'],
            where: { issuerRfc: rfcIn },
            _min: { issuerName: true }
          }),
          prisma.invoice.groupBy({
            by: ['receiverRfc'],
            where: { receiverRfc: rfcIn },
            _min: { receiverName: true }
          })
        ])
        for (const g of asIssuer) {
          if (g.issuerRfc) nameMap[g.issuerRfc] = g._min.issuerName || g.issuerRfc
        }
        for (const g of asReceiver) {
          if (g.receiverRfc && !nameMap[g.receiverRfc]) nameMap[g.receiverRfc] = g._min.receiverName || g.receiverRfc
        }
        for (const rfc of topRfcs) {
          if (!nameMap[rfc]) nameMap[rfc] = rfc
        }
      } else {
        const nameGroups = await prisma.invoice.groupBy({
          by: ['receiverRfc'],
          where: { receiverRfc: rfcIn },
          _min: { receiverName: true }
        })
        for (const g of nameGroups) {
          if (g.receiverRfc) nameMap[g.receiverRfc] = g._min.receiverName || g.receiverRfc
        }
      }
    }

    return NextResponse.json({
      company: { id: companyId, rfc, name: company.businessName },
      kpis: {
        totalCfdis: totals._count._all || 0,
        totalMonto: Number(totals._sum.total || 0),
        ventasNominativas: Number(ventasNominativas._sum.subtotal || 0),
        ventasGlobales: publicGeneralTotals.ventasGlobales,
        operacionesIndividuales: publicGeneralTotals.operacionesIndividuales,
        ingresosBrutos: Number(ingresosBrutosData._sum.subtotal || 0),
        descuentosYBonificaciones: Number(ingresosBrutosData._sum.discount || 0),
        tasaCancelacion: (totals._count._all || 0) ? Math.round(((cancelled._count._all || 0) / (totals._count._all || 1)) * 100) : 0,
        montoCancelado: Number(cancelled._sum.total || 0),
        montoCanceladoEgresos: Number(cancelledEgresos._sum.total || 0),
        montoNotasCredito: Number(egresos._sum.subtotal || 0),
        montoCobrado: montoCobrado || 0,
        montoPorCobrar: montoPorCobrar || 0,
        carteraVencida: carteraVencida || 0,
        ingresosCobradosPue,
        ingresosCobradosCrp,
        ingresosCobradosTotal: ingresosCobradosPue + ingresosCobradosCrp,
        ingresosPendientesCobro,
        ivaPendienteCobro,
        taxes: {
          ivaAcreditableTotal: ivaPueRecibido + ivaPpdRecibido - ivaERecibido,
          ivaPueRecibido: ivaPueRecibido,
          ivaPpdRecibido: ivaPpdRecibido,
          ivaERecibido: ivaERecibido,
          ivaCobradoTotal: ivaCobradoTotal,
          ivaTrasladado: totalIvaXml || totals._sum.ivaTransferred || 0,
          ivaRetenido: totals._sum.ivaWithheld || 0,
          isrRetenido: totals._sum.isrWithheld || 0,
          iepsRetenido: totals._sum.iepsWithheld || 0,
          totalImpuestosRetenidos: totalImpuestosRetenidosXml || (Number(totals._sum.ivaWithheld || 0) + Number(totals._sum.isrWithheld || 0) + Number(totals._sum.iepsWithheld || 0)),
          breakdown: ivaBreakdown
        }
      },
      byType: byType.map(t => ({ type: t.cfdiType, count: t._count._all, total: t._sum.total || 0 })),
      bySatStatus: bySatStatus.map(s => ({ status: s.satStatus, count: s._count._all })),
      monthly: monthly, 
      topClients: topCounterparties.map(c => {
        const rfcVal = effectiveOrigin === 'received' 
          ? (c as unknown as { issuerRfc: string }).issuerRfc 
          : (c as unknown as { receiverRfc: string }).receiverRfc
        // Aggregate PUE/PPD per RFC
        let clientPUE = 0
        pueInvoices.forEach(pue => {
          const pueRfc = effectiveOrigin === 'received' ? pue.issuerRfc : pue.receiverRfc
          if (pueRfc === rfcVal) {
            clientPUE += Number(pue._sum.total) || 0
          }
        })
        let clientPPDPaid = 0
        let clientPPDPending = 0
        ppdInvoicesList.forEach(inv => {
          const invRfc = effectiveOrigin === 'received' ? inv.issuerRfc : inv.receiverRfc
          if (invRfc === rfcVal) {
             const paid = paidAmountsByUuid[normalizeUpperText(inv.uuid)] || 0
             if (paid >= Number(inv.total) - 0.01) {
               clientPPDPaid += Number(inv.total)
             } else {
               clientPPDPaid += paid
               clientPPDPending += (Number(inv.total) - paid)
             }
          }
        })
        const cobrado = clientPUE + clientPPDPaid
        const pendiente = clientPPDPending
        const sumTotal = ((c as unknown as { _sum: { total: number | null } })._sum.total) || 0
        return { rfc: rfcVal, name: nameMap[rfcVal] || rfcVal, total: Number(sumTotal) || 0, cobrado, pendiente }
      }),
      topProducts: topProducts.map(p => ({
        name: p.description,
        value: Number(p._sum.amount) || 0
      })),
      paymentMethods: paymentMethods.map(p => ({ method: p.paymentMethod, count: p._count._all, total: Number(p._sum.total || 0) })),
      _security: {
        originRequested: originParam,
        originEffective: effectiveOrigin,
        canViewIssued,
        canViewReceived,
        scopedOrganizationId: ctx.organizationId
      },
      meta: {
        heavyMetricsIncluded: includeHeavyMetrics
      }
    }, { headers: SECURITY_HEADERS })
  } catch (err) {
    // DASH-SAST-010 · fp32 fingerprint correlación de incidentes de seguridad
    const fingerprint = fp32(JSON.stringify({
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? (err.stack || '').slice(0, 512) : '',
      ts: Date.now()
    }))
    const safeSummary = safeErrSummary(err)
    // SafeErrorSummary es discriminated union; todas las variantes NO-Nil tienen
    // msgHash; las productivas tienen msg (string|null). El último catch-all
    // (name: string) también provee msg (string|null). Accedemos por narrowing
    // seguro sin `any`, y usamos coalescencia sobre campos declarados.
    type SafeUnionWithMsg = Exclude<SafeErrorSummary, { name: 'NilError' }>;
    const safeMsg: string | null =
      (safeSummary.name !== 'NilError' ? (safeSummary as SafeUnionWithMsg).msg : null)
      ?? safeSummary.msgHash
      ?? 'Error interno';
    console.error(`[DashboardFiscal fingerprint=${fingerprint}] ${safeSummary.name}: ${safeMsg ?? '-'}`)
    const resp = dashboardJsonErrorResponse(err)
    // Aplica SECURITY_HEADERS a todas las respuestas de error (incluidas 429/403/400)
    Object.entries(SECURITY_HEADERS).forEach(([k, v]) => {
      if (!resp.headers.has(k)) resp.headers.set(k, v)
    })
    if (!resp.headers.has('X-Security-Incident-Fp')) {
      resp.headers.set('X-Security-Incident-Fp', fingerprint)
    }
    return resp
  }
}
