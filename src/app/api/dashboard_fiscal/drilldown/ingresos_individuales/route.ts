import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { buildDashboardScopedContext, dashboardJsonErrorResponse } from '@/lib/dashboard-fiscal-route-utils'
import { SECURITY_HEADERS } from '@/lib/org-dashboard-helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const DRILLDOWN_BATCH_SIZE = 500

function formatDrilldownData(invoices: Array<Record<string, unknown>>, originParam: string, rfc: string) {
  const drilldownData: Array<Record<string, unknown>> = []
  invoices.forEach(inv => {
    const isIssuer = originParam === 'issued' || inv.issuerRfc === rfc
    const rfcOponente = isIssuer ? inv.receiverRfc : inv.issuerRfc
    const nombreOponente = isIssuer ? inv.receiverName : inv.issuerName

    drilldownData.push({
      uuid: inv.uuid,
      uuidRelacionado: '',
      tipo: 'Ingreso Individual',
      fecha: inv.issuanceDate,
      serie: inv.series || '',
      folio: inv.folio || '',
      rfc: rfcOponente,
      razonSocial: nombreOponente || 'Desconocido',
      moneda: inv.currency || 'MXN',
      tipoCambio: Number(inv.exchangeRate) || 1,
      importe: Number(inv.subtotal) || 0
    })
  })
  return drilldownData
}

async function fetchInvoicesBatch(baseWhere: Record<string, unknown>, cursor: string | undefined) {
  return await prisma.invoice.findMany({
    where: {
      ...baseWhere,
      cfdiType: 'INGRESO',
      satStatus: 'VIGENTE',
      receiverRfc: 'XAXX010101000',
      isPublicGlobal: false
    },
    take: DRILLDOWN_BATCH_SIZE,
    skip: cursor ? 1 : 0,
    cursor: cursor ? { id: cursor } : undefined,
    select: {
      id: true,
      uuid: true,
      folio: true,
      series: true,
      issuanceDate: true,
      issuerRfc: true,
      receiverRfc: true,
      issuerName: true,
      receiverName: true,
      currency: true,
      exchangeRate: true,
      subtotal: true
    },
    orderBy: { issuanceDate: 'desc' }
  })
}

export async function GET(request: NextRequest) {
  try {
    const { ctx, searchParams } = await buildDashboardScopedContext(request, { routeKey: 'drilldown', requireCompanyId: true })

    const companyId = searchParams.get('companyId')!
    const startDateParam = searchParams.get('startDate')
    const endDateParam = searchParams.get('endDate')
    
    if (!startDateParam || !endDateParam) {
      return NextResponse.json({ data: [] }, { headers: SECURITY_HEADERS })
    }

    const originParam = searchParams.get('origin') || 'issued'

    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { rfc: true } })
    if (!company?.rfc) return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404, headers: SECURITY_HEADERS })

    const rfc = company.rfc
    const fiscalEntity = await prisma.fiscalEntity.findFirst({ where: { rfc, organizationId: ctx.organizationId } })
    if (!fiscalEntity) return NextResponse.json({ data: [] }, { headers: SECURITY_HEADERS })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dateFilter: any = {}
    if (startDateParam && endDateParam) {
      const startParts = startDateParam.split('-')
      const endParts = endDateParam.split('-')
      
      const start = new Date(Date.UTC(Number(startParts[0]), Number(startParts[1]) - 1, Number(startParts[2]), 0, 0, 0, 0))
      const end = new Date(Date.UTC(Number(endParts[0]), Number(endParts[1]) - 1, Number(endParts[2]), 23, 59, 59, 999))
      
      dateFilter.issuanceDate = { gte: start, lte: end }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let baseWhere: any
    if (originParam === 'received') {
      baseWhere = { receiverRfc: rfc, ...dateFilter }
    } else if (originParam === 'both') {
      baseWhere = { OR: [{ issuerRfc: rfc }, { receiverRfc: rfc }], ...dateFilter }
    } else {
      baseWhere = { issuerFiscalEntityId: fiscalEntity.id, issuerRfc: rfc, ...dateFilter }
    }

    let cursor: string | undefined = undefined
    const allDrilldownData: Array<Record<string, unknown>> = []

    do {
      const invoices = await fetchInvoicesBatch(baseWhere, cursor)

      if (invoices.length === 0) {
        break
      }

      const formattedData = formatDrilldownData(invoices, originParam, rfc)
      allDrilldownData.push(...formattedData)

      if (invoices.length === DRILLDOWN_BATCH_SIZE) {
        cursor = invoices.at(-1)?.id
      } else {
        cursor = undefined
      }
    } while (cursor)

    allDrilldownData.sort((a, b) => new Date(b.fecha as string).getTime() - new Date(a.fecha as string).getTime())

    return NextResponse.json({ data: allDrilldownData }, { headers: SECURITY_HEADERS })

  } catch (error) {
    return dashboardJsonErrorResponse(error)
  }
}
