import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const totalRecords = await prisma.cfdi.count()

    const recentRecords = await prisma.cfdi.findMany({
      take: 5,
      orderBy: {
        fechaEmision: 'desc'
      },
      select: {
        uuid: true,
        rfcEmisor: true,
        fechaEmision: true
      }
    })

    return NextResponse.json({
      total: totalRecords,
      recent: recentRecords.map(record => ({
        id_uuid: record.uuid,
        rfc_emisor: record.rfcEmisor || '',
        fecha: record.fechaEmision.toISOString()
      })),
      timestamp: Date.now()
    })
  } catch (error) {
    console.error('Error fetching stats:', error)
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 })
  }
}
