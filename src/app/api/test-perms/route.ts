import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { hasPermission, Permission } from '@/lib/permissions';
import { getPrimaryApprovedMembership } from '@/lib/tenant';

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'No session' });
    }

    const membership = await getPrimaryApprovedMembership(session.user.id);
    const orgId = membership?.organizationId;

    const user = {
      id: session.user.id,
      systemRole: session.user.systemRole,
      memberships: session.user.memberships
    };

    const perms = {
      ADMIN_DASHBOARD: hasPermission(user, Permission.ADMIN_DASHBOARD, orgId),
      ADMIN_USERS: hasPermission(user, Permission.ADMIN_USERS, orgId),
      COMPANY_READ: hasPermission(user, Permission.COMPANY_READ, orgId),
    };

    return NextResponse.json({
      sessionUser: session.user,
      orgId,
      perms,
      membershipInDb: membership
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error occurred' });
  }
}
