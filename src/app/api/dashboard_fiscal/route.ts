import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { CfdiType, Prisma } from '@prisma/client'

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const companyId = searchParams.get('companyId')
    if (!companyId) {
      return NextResponse.json({ error: 'companyId requerido' }, { status: 400 })
    }

    // const userId = session.user!.id

    // Validate user has access to this company via membership
    const member = await prisma.member.findFirst({
      where: { userId: session.user.id, status: 'APPROVED' },
      include: { organization: true }
    })
    if (!member) {
      return NextResponse.json({ error: 'Membresía no encontrada' }, { status: 404 })
    }

    const access = await prisma.companyAccess.findUnique({
      where: { memberId_companyId: { memberId: member.id, companyId } }
    })
    if (!access) {
      return NextResponse.json({ error: 'Sin acceso a la empresa' }, { status: 403 })
    }

    // Fetch company RFC to determine issued vs received
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { rfc: true, businessName: true }
    })
    if (!company?.rfc) {
      return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 })
    }

    const rfc = company.rfc

    // Find matching fiscal entity within the user's organization by RFC
    const fiscalEntity = await prisma.fiscalEntity.findFirst({
      where: { rfc }
    })

    // Do not auto-create fiscal entities or demo invoices; show empty metrics when absent

    if (!fiscalEntity) {
      return NextResponse.json({
        company: { id: companyId, rfc, name: company.businessName },
        kpis: { 
          totalCfdis: 0, 
          totalMonto: 0, 
          tasaCancelacion: 0,
          montoCancelado: 0,
          montoNotasCredito: 0,
          taxes: {
            ivaTrasladado: 0,
            ivaRetenido: 0,
            isrRetenido: 0,
            iepsRetenido: 0
          }
        },
        byType: [],
        bySatStatus: [],
        monthly: [],
        topSuppliers: [],
        topClients: [],
        paymentMethods: [],
      })
    }

    const issuerFiscalEntityId = fiscalEntity.id

    const startDateParam = searchParams.get('startDate')
    const endDateParam = searchParams.get('endDate')
    const originParam = searchParams.get('origin') || 'issued'

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

    // Determine base filter based on origin
    let baseWhere: Prisma.InvoiceWhereInput
    if (originParam === 'received') {
      // For received: We are the receiver
      baseWhere = {
        receiverRfc: rfc,
        cfdiType: { in: [CfdiType.INGRESO, CfdiType.PAGO] },
        ...dateFilter
      }
    } else if (originParam === 'both') {
      // For both: We are either the issuer OR the receiver
      baseWhere = {
        OR: [
          { issuerRfc: rfc },
          { receiverRfc: rfc }
        ],
        cfdiType: { in: [CfdiType.INGRESO, CfdiType.PAGO] },
        ...dateFilter
      }
    } else {
      // Default: Issued (We are the issuer)
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
      
      while (current <= last) {
        monthsToQuery.push(new Date(current))
        current.setMonth(current.getMonth() + 1)
      }
      // Limit to avoid too many points if range is huge? user responsibility.
    } else {
      // Default: last 12 months
      monthsToQuery = Array.from({ length: 12 }, (_, i) => {
        const d = new Date()
        d.setMonth(d.getMonth() - i)
        return new Date(d.getFullYear(), d.getMonth(), 1)
      }).reverse() // Chronological order
    }

    // Aggregations
    const [byType, bySatStatus, monthly, topCounterparties, paymentMethods, totals] = await Promise.all([
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
        where: baseWhere,
        _count: { _all: true }
      }),
      // Monthly totals
      Promise.all(
        monthsToQuery.map(start => {
          const end = new Date(start.getFullYear(), start.getMonth() + 1, 0)
          end.setHours(23, 59, 59, 999)
          
          return prisma.invoice.aggregate({
            where: { ...baseWhere, issuanceDate: { gte: start, lte: end } },
            _count: { _all: true },
            _sum: { total: true }
          }).then(res => ({
            label: `${start.toLocaleString('es-MX', { month: 'short' })} ${start.getFullYear()}`,
            count: res._count._all || 0,
            total: res._sum.total || 0
          }))
        })
      ),
      // Top clients/suppliers (Counterparties)
      // When 'both' is selected, this becomes tricky because we have mixed roles.
      // We'll default to grouping by receiver for consistency, but realistically 'both' might need separate charts.
      // For now, let's keep it simple: if 'received', group by issuer. Else (issued or both), group by receiver.
      prisma.invoice.groupBy({
        by: originParam === 'received' ? ['issuerRfc', 'issuerName'] : ['receiverRfc', 'receiverName'],
        where: baseWhere,
        _sum: { total: true },
        orderBy: { _sum: { total: 'desc' } },
        take: 5
      }),
      // Payment method usage
      prisma.invoice.groupBy({
        by: ['paymentMethod'],
        where: baseWhere,
        _count: { _all: true },
      }),
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
      })
    ])

    const cancelled = await prisma.invoice.aggregate({ 
      where: { ...baseWhere, satStatus: 'CANCELADO' },
      _sum: { total: true },
      _count: { _all: true }
    })
    
    // Calculate egresos (Credit Notes)
    let egresosWhere: Prisma.InvoiceWhereInput

    if (originParam === 'received') {
      egresosWhere = { receiverRfc: rfc, cfdiType: CfdiType.EGRESO, ...dateFilter }
    } else if (originParam === 'both') {
       egresosWhere = { 
         OR: [{ issuerRfc: rfc }, { receiverRfc: rfc }], 
         cfdiType: CfdiType.EGRESO, 
         ...dateFilter 
       }
    } else {
      egresosWhere = { issuerFiscalEntityId, issuerRfc: rfc, cfdiType: CfdiType.EGRESO, ...dateFilter }
    }

    const egresos = await prisma.invoice.aggregate({
      where: egresosWhere,
      _sum: { total: true }
    })

    return NextResponse.json({
      company: { id: companyId, rfc, name: company.businessName },
      kpis: {
        totalCfdis: totals._count._all || 0,
        totalMonto: totals._sum.total || 0,
        tasaCancelacion: (totals._count._all || 0) ? Math.round(((cancelled._count._all || 0) / (totals._count._all || 1)) * 100) : 0,
        montoCancelado: cancelled._sum.total || 0,
        montoNotasCredito: egresos._sum.total || 0,
        taxes: {
          ivaTrasladado: totals._sum.ivaTransferred || 0,
          ivaRetenido: totals._sum.ivaWithheld || 0,
          isrRetenido: totals._sum.isrWithheld || 0,
          iepsRetenido: totals._sum.iepsWithheld || 0
        }
      },
      byType: byType.map(t => ({ type: t.cfdiType, count: t._count._all, total: t._sum.total || 0 })),
      bySatStatus: bySatStatus.map(s => ({ status: s.satStatus, count: s._count._all })),
      monthly: monthly, 
      topClients: topCounterparties.map(c => {
        // Map dynamic keys based on origin
        const rfcVal = originParam === 'received' 
          ? (c as unknown as { issuerRfc: string }).issuerRfc 
          : (c as unknown as { receiverRfc: string }).receiverRfc
        const nameVal = originParam === 'received' 
          ? (c as unknown as { issuerName: string }).issuerName 
          : (c as unknown as { receiverName: string }).receiverName
        return { rfc: rfcVal, name: nameVal, total: c._sum.total || 0 }
      }),
      paymentMethods: paymentMethods.map(p => ({ method: p.paymentMethod, count: p._count._all })),
    })
  } catch (error) {
    console.error('Dashboard fiscal API error:', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
