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

    const member = await prisma.member.findFirst({
      where: { userId: session.user.id, status: 'APPROVED' }
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

    type SatClient = {
      groupBy: (args: unknown) => Promise<Array<Record<string, unknown>>>
      aggregate: (args: unknown) => Promise<Record<string, unknown>>
    }
    const sat = (prisma as unknown as { satInvoice: SatClient }).satInvoice

    const [byType, bySatStatus, monthly, topSuppliers, topClients, paymentMethods, totals] = await Promise.all([
      sat.groupBy({
        by: ['cfdiType'],
        where: { OR: [{ issuerRfc: rfc }, { receiverRfc: rfc }] },
        _count: { _all: true },
        _sum: { total: true }
      }),
      sat.groupBy({
        by: ['satStatus'],
        where: { OR: [{ issuerRfc: rfc }, { receiverRfc: rfc }] },
        _count: { _all: true }
      }),
      sat.groupBy({
        by: ['issuanceDate'],
        where: { OR: [{ issuerRfc: rfc }, { receiverRfc: rfc }] },
        _sum: { total: true },
        _count: { _all: true }
      }),
      sat.groupBy({
        by: ['issuerName'],
        where: { receiverRfc: rfc },
        _sum: { total: true }
      }),
      sat.groupBy({
        by: ['receiverName'],
        where: { issuerRfc: rfc },
        _sum: { total: true }
      }),
      sat.groupBy({
        by: ['paymentMethod'],
        where: { OR: [{ issuerRfc: rfc }, { receiverRfc: rfc }] },
        _count: { _all: true }
      }),
      sat.aggregate({
        where: { OR: [{ issuerRfc: rfc }, { receiverRfc: rfc }] },
        _sum: { total: true },
        _count: { _all: true }
      })
    ])

    const monthlySeries: Array<{ label: string; count: number; total: number }> = (monthly as Array<Record<string, unknown>>)
      .map((m) => {
        const d = new Date(String(m['issuanceDate']))
        const cnt = Number(((m['_count'] as Record<string, unknown>)?._all) ?? 0)
        const sumTotal = Number(((m['_sum'] as Record<string, unknown>)?.total) ?? 0)
        return { label: d.toLocaleDateString('es-MX', { month: 'short', year: 'numeric' }), count: cnt, total: sumTotal }
      })
      .sort((a, b) => new Date(a.label).getTime() - new Date(b.label).getTime())

    return NextResponse.json({
      company: { id: companyId, rfc, name: company.businessName },
      kpis: {
        totalCfdis: Number(((totals['_count'] as Record<string, unknown>)?._all) ?? 0),
        totalMonto: Number(((totals['_sum'] as Record<string, unknown>)?.total) ?? 0),
        tasaCancelacion: 0
      },
      byType: (byType as Array<Record<string, unknown>>).map((t) => ({ type: String(t['cfdiType']), count: Number(((t['_count'] as Record<string, unknown>)?._all) ?? 0), total: Number(((t['_sum'] as Record<string, unknown>)?.total) ?? 0) })),
      bySatStatus: (bySatStatus as Array<Record<string, unknown>>).map((s) => ({ status: String(s['satStatus']), count: Number(((s['_count'] as Record<string, unknown>)?._all) ?? 0) })),
      monthly: monthlySeries,
      topSuppliers: (topSuppliers as Array<Record<string, unknown>>).map((s) => ({ name: String(s['issuerName']), total: Number(((s['_sum'] as Record<string, unknown>)?.total) ?? 0) })).sort((a, b) => b.total - a.total).slice(0, 10),
      topClients: (topClients as Array<Record<string, unknown>>).map((c) => ({ name: String(c['receiverName']), total: Number(((c['_sum'] as Record<string, unknown>)?.total) ?? 0) })).sort((a, b) => b.total - a.total).slice(0, 10),
      paymentMethods: (paymentMethods as Array<Record<string, unknown>>).map((p) => ({ method: String(p['paymentMethod']), count: Number(((p['_count'] as Record<string, unknown>)?._all) ?? 0) }))
    })
  } catch (error) {
    console.error('Error SAT CFDis metrics:', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
