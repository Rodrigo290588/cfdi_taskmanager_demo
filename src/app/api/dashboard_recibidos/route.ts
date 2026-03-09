import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

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

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { rfc: true, businessName: true }
    })
    if (!company?.rfc) {
      return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 })
    }

    const rfc = company.rfc

    const fiscalEntity = await prisma.fiscalEntity.findFirst({ where: { rfc } })

    // Do not auto-create fiscal entities or demo invoices; show empty metrics when absent

    if (!fiscalEntity) {
      return NextResponse.json({
        company: { id: companyId, rfc, name: company.businessName },
        kpis: { totalCfdis: 0, totalMonto: 0, tasaCancelacion: 0 },
        byType: [],
        bySatStatus: [],
        monthly: [],
        topSuppliers: [],
        topClients: [],
        paymentMethods: [],
      })
    }

    const issuerFiscalEntityId = fiscalEntity.id
    const baseWhere = { issuerFiscalEntityId, receiverRfc: rfc }

    const [byType, bySatStatus, monthly, topSuppliers, paymentMethods, totals, taxes] = await Promise.all([
      prisma.invoice.groupBy({
        by: ['cfdiType'],
        where: baseWhere,
        _count: { _all: true },
        _sum: { total: true }
      }),
      prisma.invoice.groupBy({
        by: ['satStatus'],
        where: baseWhere,
        _count: { _all: true }
      }),
      Promise.all(
        Array.from({ length: 12 }, (_, i) => {
          const date = new Date();
          date.setMonth(date.getMonth() - i)
          const start = new Date(date.getFullYear(), date.getMonth(), 1)
          const end = new Date(date.getFullYear(), date.getMonth() + 1, 0)
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
      prisma.invoice.groupBy({
        by: ['issuerRfc', 'issuerName'],
        where: baseWhere,
        _sum: { total: true },
        orderBy: { _sum: { total: 'desc' } },
        take: 5
      }),
      prisma.invoice.groupBy({
        by: ['paymentMethod'],
        where: baseWhere,
        _count: { _all: true },
      }),
      prisma.invoice.aggregate({
        where: baseWhere,
        _count: { _all: true },
        _sum: { total: true },
      }),
      prisma.invoice.aggregate({
        where: baseWhere,
        _sum: {
          ivaTransferred: true,
          ivaWithheld: true,
          isrWithheld: true,
          iepsWithheld: true
        }
      })
    ])

    const cancelled = await prisma.invoice.count({ where: { ...baseWhere, satStatus: 'CANCELADO' } })
    
    // Calculate KPIs
    const totalGastos = byType.find(t => t.cfdiType === 'INGRESO')?._sum.total || 0
    const totalNotasCredito = byType.find(t => t.cfdiType === 'EGRESO')?._sum.total || 0
    const totalEgresos = Number(totalGastos) - Number(totalNotasCredito)
    
    // Estimate Paid/Pending based on Payment Method (PUE vs PPD)
    // Note: This is an estimation. PUE is paid, PPD is pending unless paid.
    // Ideally we check 'status' or related payments, but simple heuristic for now:
    // PUE = Paid
    // PPD = Pending
    // We need to fetch sums by payment method to be accurate, but groupBy above only did count.
    // Let's add a separate aggregation for payment status amounts.
    const paymentStatus = await prisma.invoice.groupBy({
      by: ['paymentMethod'],
      where: { ...baseWhere, cfdiType: 'INGRESO' }, // Only count expenses
      _sum: { total: true }
    })
    
    let pagado = 0
    let pendiente = 0
    
    paymentStatus.forEach(p => {
      if (p.paymentMethod === 'PUE') {
        pagado += Number(p._sum.total || 0)
      } else {
        pendiente += Number(p._sum.total || 0)
      }
    })

    return NextResponse.json({
      company: { id: companyId, rfc, name: company.businessName },
      kpis: {
        totalCfdis: totals._count._all || 0,
        totalMonto: totals._sum.total || 0,
        tasaCancelacion: (totals._count._all || 0) ? Math.round((cancelled / (totals._count._all || 1)) * 100) : 0,
        totalGastos,
        totalNotasCredito,
        totalEgresos,
        pagado,
        pendiente,
        cancelaciones: 0, // Need to calc cancellations amount
        taxes: {
          ivaTrasladado: taxes._sum.ivaTransferred || 0,
          ivaRetenido: taxes._sum.ivaWithheld || 0,
          isrRetenido: taxes._sum.isrWithheld || 0,
          iepsRetenido: taxes._sum.iepsWithheld || 0
        }
      },
      byType: byType.map(t => ({ type: t.cfdiType, count: t._count._all, total: t._sum.total || 0 })),
      bySatStatus: bySatStatus.map(s => ({ status: s.satStatus, count: s._count._all })),
      monthly: monthly.reverse(),
      topSuppliers: topSuppliers.map(s => ({ rfc: s.issuerRfc, name: s.issuerName, total: s._sum.total || 0 })),
      topClients: [],
      paymentMethods: paymentMethods.map(p => ({ method: p.paymentMethod, count: p._count._all })),
    })
  } catch (error) {
    console.error('Dashboard recibidos API error:', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
