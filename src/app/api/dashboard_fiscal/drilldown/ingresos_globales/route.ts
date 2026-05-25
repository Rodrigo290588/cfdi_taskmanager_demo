import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = searchParams.get('companyId')
    const startDateParam = searchParams.get('startDate')
    const endDateParam = searchParams.get('endDate')
    const originParam = searchParams.get('origin') || 'issued'

    if (!companyId) return NextResponse.json({ error: 'companyId requerido' }, { status: 400 })

    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { rfc: true } })
    if (!company?.rfc) return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 })

    const rfc = company.rfc
    const fiscalEntity = await prisma.fiscalEntity.findFirst({ where: { rfc } })
    if (!fiscalEntity) return NextResponse.json({ data: [] })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dateFilter: any = {}
    if (startDateParam && endDateParam) {
      const end = new Date(endDateParam)
      end.setHours(23, 59, 59, 999)
      dateFilter.issuanceDate = { gte: new Date(startDateParam), lte: end }
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

    const invoices = await prisma.invoice.findMany({
      where: {
        ...baseWhere,
        cfdiType: 'INGRESO',
        satStatus: 'VIGENTE',
        receiverRfc: 'XAXX010101000',
        xmlContent: {
          contains: 'InformacionGlobal'
        }
      },
      select: {
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
        subtotal: true,
      },
      orderBy: { issuanceDate: 'desc' }
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const drilldownData: any[] = invoices.map(inv => {
      const isIssuer = originParam === 'issued' || inv.issuerRfc === rfc
      const rfcOponente = isIssuer ? inv.receiverRfc : inv.issuerRfc
      const nombreOponente = isIssuer ? inv.receiverName : inv.issuerName

      return {
        uuid: inv.uuid,
        uuidRelacionado: '',
        tipo: 'Ingreso Global',
        fecha: inv.issuanceDate,
        serie: inv.series || '',
        folio: inv.folio || '',
        rfc: rfcOponente,
        razonSocial: nombreOponente || 'Desconocido',
        moneda: inv.currency || 'MXN',
        tipoCambio: Number(inv.exchangeRate) || 1,
        importe: Number(inv.subtotal) || 0
      }
    })

    return NextResponse.json({ data: drilldownData })

  } catch (error) {
    console.error('Drilldown API Error:', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}