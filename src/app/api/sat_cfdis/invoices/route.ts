import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { CfdiType, InvoiceStatus, SatStatus } from '@prisma/client'

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const companyId = searchParams.get('companyId')
    const page = Number(searchParams.get('page') || 1)
    const limit = Math.min(Number(searchParams.get('limit') || 20), 100)
    const query = searchParams.get('query') || ''
    const cfdiType = searchParams.get('cfdiType') as keyof typeof CfdiType | null
    const status = searchParams.get('status') as keyof typeof InvoiceStatus | null
    const satStatus = searchParams.get('satStatus') as keyof typeof SatStatus | null
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')

    if (!companyId) {
      return NextResponse.json({ error: 'companyId requerido' }, { status: 400 })
    }

    const member = await prisma.member.findFirst({
      where: { userId: session.user.id, status: 'APPROVED' },
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
      select: { rfc: true }
    })
    if (!company?.rfc) {
      return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 })
    }

    const fiscalEntity = await prisma.fiscalEntity.findFirst({ where: { rfc: company.rfc } })
    if (!fiscalEntity) {
      return NextResponse.json({ invoices: [], pagination: { total: 0, page, limit, totalPages: 0 } })
    }

    const where: Record<string, unknown> = { fiscalEntityId: fiscalEntity.id }
    if (query) {
      ;(where as Record<string, unknown>).OR = [
        { uuid: { contains: query, mode: 'insensitive' } },
        { issuerRfc: { contains: query, mode: 'insensitive' } },
        { issuerName: { contains: query, mode: 'insensitive' } },
        { receiverRfc: { contains: query, mode: 'insensitive' } },
        { receiverName: { contains: query, mode: 'insensitive' } },
        { folio: { contains: query, mode: 'insensitive' } },
      ]
    }
    if (cfdiType && CfdiType[cfdiType]) (where as Record<string, unknown>).cfdiType = CfdiType[cfdiType]
    if (status && InvoiceStatus[status]) (where as Record<string, unknown>).status = InvoiceStatus[status]
    if (satStatus && SatStatus[satStatus]) (where as Record<string, unknown>).satStatus = SatStatus[satStatus]
    if (dateFrom || dateTo) {
      ;(where as Record<string, unknown>).issuanceDate = {}
      if (dateFrom) ((where as Record<string, unknown>).issuanceDate as Record<string, unknown>).gte = new Date(dateFrom)
      if (dateTo) ((where as Record<string, unknown>).issuanceDate as Record<string, unknown>).lte = new Date(dateTo)
    }

    const skip = (page - 1) * limit
    type SatClient = {
      findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>
      count: (args: unknown) => Promise<number>
    }
    const sat = (prisma as unknown as { satInvoice: SatClient }).satInvoice
    const [rows, total] = await Promise.all([
      sat.findMany({
        where,
        orderBy: { issuanceDate: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          uuid: true,
          cfdiType: true,
          series: true,
          folio: true,
          issuerRfc: true,
          issuerName: true,
          receiverRfc: true,
          receiverName: true,
          subtotal: true,
          total: true,
          issuanceDate: true,
          status: true,
          satStatus: true,
          paymentForm: true,
          paymentMethod: true,
          currency: true,
        }
      }),
      sat.count({ where })
    ])

    const invoices = (rows as Array<Record<string, unknown>>).map((r) => ({
      id: String(r['id']),
      uuid: String(r['uuid']),
      cfdiType: String(r['cfdiType']),
      series: (r['series'] as string | null) ?? null,
      folio: (r['folio'] as string | null) ?? null,
      issuerRfc: String(r['issuerRfc']),
      issuerName: String(r['issuerName']),
      receiverRfc: String(r['receiverRfc']),
      receiverName: String(r['receiverName']),
      subtotal: Number(r['subtotal'] ?? 0),
      total: Number(r['total'] ?? 0),
      issuanceDate: (r['issuanceDate'] as Date | string),
      status: String(r['status']),
      satStatus: String(r['satStatus']),
      paymentForm: String(r['paymentForm'] ?? ''),
      paymentMethod: String(r['paymentMethod'] ?? ''),
      currency: String(r['currency'] ?? 'MXN')
    }))

    return NextResponse.json({
      invoices,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    })
  } catch (error) {
    console.error('Error fetching SAT invoices:', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
