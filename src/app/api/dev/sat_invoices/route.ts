import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const limit = Math.min(Number(searchParams.get('limit') || 10), 100)
  const rfc = searchParams.get('rfc') || undefined
  const where = rfc ? { OR: [{ issuerRfc: rfc }, { receiverRfc: rfc }] } : undefined
  const rows = await prisma.satInvoice.findMany({
    where,
    orderBy: { issuanceDate: 'desc' },
    take: limit,
    select: {
      id: true,
      uuid: true,
      cfdiType: true,
      issuerRfc: true,
      issuerName: true,
      receiverRfc: true,
      receiverName: true,
      subtotal: true,
      total: true,
      issuanceDate: true,
      satStatus: true,
      paymentMethod: true,
      paymentForm: true,
      currency: true
    }
  })
  return NextResponse.json({ count: rows.length, invoices: rows })
}
