import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET() {
  try {
    const totalRecords = await prisma.cfdi.count();
    
    // Get the latest 5 records to show activity
    // Since we don't have createdAt, we rely on natural insertion order or CUID
    // (Note: CUIDs are roughly time-ordered, but not perfect. Ideally we'd add createdAt)
    const recentRecords = await prisma.cfdi.findMany({
      take: 5,
      orderBy: {
        // @ts-expect-error - Prisma types mismatch
        id: 'desc', // Assuming CUID or Autoincrement (schema said CUID)
      },
      select: {
        // @ts-expect-error - Prisma types mismatch
        id_uuid: true,
        rfc_emisor: true,
        fecha: true
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
  } finally {
    await prisma.$disconnect();
  }
}
