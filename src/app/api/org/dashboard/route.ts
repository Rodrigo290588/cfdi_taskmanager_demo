import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { CfdiType } from '@prisma/client'

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const member = await prisma.member.findFirst({
      where: { userId: session.user.id, status: 'APPROVED' },
      include: { organization: true }
    })
    if (!member?.organization) {
      return NextResponse.json({ error: 'Organización no encontrada' }, { status: 404 })
    }

    const entities = await prisma.fiscalEntity.findMany({
      where: { organizationId: member.organization.id },
      select: { id: true, rfc: true, businessName: true }
    })

    if (entities.length === 0) {
      return NextResponse.json({
        organization: { id: member.organization.id },
        kpis: { totalCfdis: 0, totalMonto: 0, tasaCancelacion: 0 },
        byType: [],
        bySatStatus: [],
        monthly: [],
      })
    }

    const fiscalEntityIds = entities.map(e => e.id)
    const rfcs = entities.map(e => e.rfc)

    const baseWhere = {
      issuerFiscalEntityId: { in: fiscalEntityIds },
      issuerRfc: { in: rfcs },
      cfdiType: { in: [CfdiType.INGRESO, CfdiType.PAGO, CfdiType.NOMINA] }
    }

    const [byType, bySatStatus, monthly, totals, cancelled, topClients, paymentMethods] = await Promise.all([
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
          const date = new Date()
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
      prisma.invoice.aggregate({
        where: baseWhere,
        _count: { _all: true },
        _sum: { total: true },
      }),
      prisma.invoice.count({ where: { ...baseWhere, satStatus: 'CANCELADO' } })
    ,
      prisma.invoice.groupBy({
        by: ['receiverRfc', 'receiverName'],
        where: baseWhere,
        _sum: { total: true },
        orderBy: { _sum: { total: 'desc' } },
        take: 5
      })
    ,
      prisma.invoice.groupBy({
        by: ['paymentMethod'],
        where: baseWhere,
        _count: { _all: true },
      })
    ])

    return NextResponse.json({
      organization: { id: member.organization.id },
      kpis: {
        totalCfdis: totals._count._all || 0,
        totalMonto: totals._sum.total || 0,
        tasaCancelacion: (totals._count._all || 0)
          ? Math.round((cancelled / (totals._count._all || 1)) * 100)
          : 0,
      },
      byType: byType.map(t => ({ type: t.cfdiType, count: t._count._all, total: t._sum.total || 0 })),
      bySatStatus: bySatStatus.map(s => ({ status: s.satStatus, count: s._count._all })),
      monthly: monthly.reverse(),
      topClients: topClients.map(c => ({ rfc: c.receiverRfc, name: c.receiverName, total: c._sum.total || 0 })),
      paymentMethods: paymentMethods.map(p => ({ method: p.paymentMethod, count: p._count._all })),
    })
  } catch (error) {
    console.error('Org dashboard API error:', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
