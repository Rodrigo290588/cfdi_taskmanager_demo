import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await prisma.user.findUnique({
    where: { email: 'rtorreh@gmail.com' },
    select: {
      id: true,
      email: true,
      systemRole: true,
      memberships: {
        include: {
          organization: {
            select: {
              id: true,
              name: true,
              onboardingCompleted: true
            }
          }
        }
      }
    }
  });

  return NextResponse.json({ user });
}
