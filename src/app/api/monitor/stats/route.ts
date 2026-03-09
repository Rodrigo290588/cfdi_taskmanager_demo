import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const totalRecords = await prisma.cfdi.count();
    
    // Get the latest 5 records to show activity
    // Using fechaEmision as the best proxy for "recent" activity in the absence of createdAt
    const recentRecords = await prisma.cfdi.findMany({
      take: 5,
      orderBy: {
        fechaEmision: 'desc',
      },
      select: {
        uuid: true,
        fechaEmision: true,
        montoTotal: true
      }
    });

    return NextResponse.json({
      total: totalRecords,
      recent: recentRecords,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}
