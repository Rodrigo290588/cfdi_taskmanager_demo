import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import crypto from 'crypto'
import { SAT_SECURITY_HEADERS, safeErrSummarySat } from '@/lib/sat-gate-helpers'
import { enforceCompaniesRateLimit, RateLimitError } from '@/lib/rate-limit'

const REQ_ID_HEADER = 'X-Request-Id'

export async function GET(_request: NextRequest) {
  void _request
  const reqId = crypto.randomUUID()
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'No autorizado', reqId },
        { status: 401, headers: { [REQ_ID_HEADER]: reqId, ...SAT_SECURITY_HEADERS } }
      )
    }

    try {
      enforceCompaniesRateLimit(session.user.id, 'search')
    } catch (rlErr) {
      if (rlErr instanceof RateLimitError) {
        return NextResponse.json(
          { error: rlErr.message, reqId },
          {
            status: rlErr.statusCode,
            headers: {
              [REQ_ID_HEADER]: reqId,
              'Retry-After': String(Math.ceil(rlErr.retryAfterMs / 1000)),
              ...SAT_SECURITY_HEADERS
            }
          }
        )
      }
      throw rlErr
    }

    // TSC FIX: incluir relation organization explícitamente; hard constraint org activa = onboardingCompleted=true
    const member = await prisma.member.findFirst({
      where: {
        userId: session.user.id,
        status: 'APPROVED',
        organization: { onboardingCompleted: true }
      },
      include: { organization: true }
    })

    if (!member?.organization) {
      return NextResponse.json(
        { companies: [], reqId },
        { status: 200, headers: { [REQ_ID_HEADER]: reqId, ...SAT_SECURITY_HEADERS, 'Cache-Control': 'no-store, private' } }
      )
    }

    const isOwner = member.organization.ownerId === session.user.id
    const isAdmin = member.role === 'ADMIN'

    type Out = { id: string; rfc: string | null; businessName: string | null; status: string; name: string }
    let companies: Out[]

    if (isOwner || isAdmin) {
      // COMP-003 FIX ALTO IDOR Tenant: memberId === member.id para scope al usuario actual
      companies = await prisma.company.findMany({
        where: {
          companyAccesses: {
            some: {
              organizationId: member.organization.id,
              memberId: member.id,
              member: { status: 'APPROVED', organization: { onboardingCompleted: true } }
            }
          }
        },
        select: { id: true, rfc: true, businessName: true, status: true, name: true },
        orderBy: { createdAt: 'desc' }
      })
    } else {
      companies = await prisma.company.findMany({
        where: {
          companyAccesses: {
            some: {
              memberId: member.id,
              organizationId: member.organization.id,
              member: { status: 'APPROVED', organization: { onboardingCompleted: true } }
            }
          }
        },
        select: { id: true, rfc: true, businessName: true, status: true, name: true },
        orderBy: { createdAt: 'desc' }
      })
    }

    return NextResponse.json(
      {
        companies: companies.map((c) => ({
          id: c.id,
          rfc: c.rfc,
          businessName: c.businessName || c.name,
          isActive: c.status === 'APPROVED'
        })),
        reqId
      },
      { headers: { [REQ_ID_HEADER]: reqId, ...SAT_SECURITY_HEADERS, 'Cache-Control': 'no-store, private' } }
    )
  } catch (error) {
    const safe = safeErrSummarySat(error)
    console.error('[companies-tenant 500]', { reqId, fp: safe.incidentFingerprint, name: safe.name })
    return NextResponse.json(
      { error: safe.message, reqId, incidentFingerprint: safe.incidentFingerprint },
      { status: 500, headers: { [REQ_ID_HEADER]: reqId, ...SAT_SECURITY_HEADERS } }
    )
  }
}
