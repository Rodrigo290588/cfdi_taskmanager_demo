// ============================================================
// src/app/api/admin/dashboard/route.ts
// DASH-SAST-007 FIX: Triple Rate Limit (IP / user / org) — igual que compliance
//             pattern org/dashboard/route.ts.
// DASH-SAST-005 FIX: userEmail en recentAuditLogs SE ENMASCARA (maskEmail).
// DASH-SAST-010 FIX: Next.js exports runtime/nodejs + dynamic/force-dynamic +
//                    fp32 + safeErrSummary en catch (correlation IDs).
// ============================================================
export const runtime     = 'nodejs';
export const dynamic     = 'force-dynamic';
export const maxDuration = 25;

import { NextRequest, NextResponse } from 'next/server';
import { SystemRole } from '@prisma/client';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hasPermission, Permission, enrichUserWithMemberships } from '@/lib/permissions';
import { rateLimit } from '@/lib/rate-limit';
import { getRealClientIp, safeErrSummary } from '@/lib/security';
import { SECURITY_HEADERS } from '@/lib/org-dashboard-helpers';
import { fp32 } from '@/lib/monitor-security-helpers';

/**
 * DASH-SAST-005: PII minimización para correos electrónicos de logs de auditoría.
 * - Mantiene identificables 2 caracteres a la izquierda (saber quién es).
 * - Mantiene 5 caracteres del dominio (saber de qué empresa).
 * - Usuario "mar***@compa***.com" / correo largo sigue siendo legible sin filtrar PII completa.
 */
function maskEmail(email: string | null | undefined, keepLeft = 2, keepRightDomain = 5): string {
  if (!email) return '';
  const raw = String(email).trim();
  const at = raw.indexOf('@');
  if (at === -1) {
    // No parece email: devolver asteriscados (no exponer string arbitrario largo sin máscara)
    return raw.length <= 2 ? raw : raw.slice(0, 1) + '*'.repeat(Math.max(3, Math.min(12, raw.length - 1)));
  }
  const user = raw.slice(0, at);
  const domain = raw.slice(at + 1);
  const maskedUser = user.length <= keepLeft
    ? user
    : user.slice(0, keepLeft) + '*'.repeat(Math.max(3, Math.min(10, user.length - keepLeft)));
  const maskedDomain = domain.length <= keepRightDomain
    ? domain
    : '*'.repeat(Math.max(3, Math.min(10, domain.length - keepRightDomain))) + domain.slice(-keepRightDomain);
  return `${maskedUser}@${maskedDomain}`;
}

export async function GET(request: NextRequest) {
  try {
    // ------------------------------------------------------------------
    // DASH-SAST-007: Rate Limit triple capa (IP / user / org)
    // ------------------------------------------------------------------
    const sourceIp = getRealClientIp(request.headers);
    const ipRl = await rateLimit(`admin-dash-ip:${sourceIp}`, { limit: 30, interval: 60_000 });
    if (!ipRl.success) {
      return NextResponse.json(
        { ok:false, error:'RATE_LIMITED_IP', retryAfterMs: ipRl.retryAfterMs },
        { status:429, headers:{ ...SECURITY_HEADERS, 'Retry-After': String(Math.ceil(ipRl.retryAfterMs/1000)) } }
      );
    }

    // ------------------------------------------------------------------
    // Autenticación (ya existía; preservado)
    // ------------------------------------------------------------------
    const session = await auth();
    if (!session?.user?.email || !session?.user?.id) {
      return NextResponse.json({ ok:false, error:'No autorizado' }, { status: 401, headers: SECURITY_HEADERS });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email }
    });
    if (!user) {
      return NextResponse.json({ ok:false, error:'Usuario no encontrado' }, { status: 404, headers: SECURITY_HEADERS });
    }

    const userRl = await rateLimit(`admin-dash-user:${session.user.id}`, { limit: 20, interval: 60_000 });
    if (!userRl.success) {
      return NextResponse.json(
        { ok:false, error:'RATE_LIMITED_USER', retryAfterMs: userRl.retryAfterMs },
        { status:429, headers:{ ...SECURITY_HEADERS, 'Retry-After': String(Math.ceil(userRl.retryAfterMs/1000)) } }
      );
    }

    // ------------------------------------------------------------------
    // Permiso ADMIN_DASHBOARD (ya existía). Enriquecer user para hasPermission con memberships.
    // ------------------------------------------------------------------
    const enrichedAdmin = await enrichUserWithMemberships({ id: user.id, systemRole: user.systemRole as SystemRole });
    if (!hasPermission(enrichedAdmin, Permission.ADMIN_DASHBOARD)) {
      return NextResponse.json(
        { ok:false, error:'No tienes permisos de administrador' },
        { status: 403, headers: SECURITY_HEADERS }
      );
    }

    // [SAST-FIX #2] Multi-tenant scoping: resolver organizationId con status=APPROVED
    //              y filtrar TODAS las queries para NO exponer datos de otras organizaciones.
    const member = await prisma.member.findFirst({
      where: {
        userId: user.id,
        status: 'APPROVED'
      },
      select: { organizationId: true, role: true }
    });

    if (!member) {
      return NextResponse.json(
        { ok:false, error:'Sin membresía activa' },
        { status: 403, headers: SECURITY_HEADERS }
      );
    }
    const organizationId = member.organizationId;

    const orgRl = await rateLimit(`admin-dash-org:${organizationId}`, { limit: 120, interval: 60_000 });
    if (!orgRl.success) {
      return NextResponse.json(
        { ok:false, error:'RATE_LIMITED_ORG', retryAfterMs: orgRl.retryAfterMs },
        { status:429, headers:{ ...SECURITY_HEADERS, 'Retry-After': String(Math.ceil(orgRl.retryAfterMs/1000)) } }
      );
    }

    // [SAST-FIX #2] Scope helpers. Company NO tiene organizationId columna directa;
    // la relación Organization <-> Company existe via CompanyAccess. AuditLog se
    // scopea a través de su company relation (si tiene; logs sin company quedan
    // fuera del scope por seguridad ya que no hay forma de asignarlos a org).
    const companyInOrg = { companyAccesses: { some: { organizationId } } }
    const auditLogInOrg = { company: { companyAccesses: { some: { organizationId } } } }

    // Get dashboard statistics (SCOPED POR organizationId)
    const [
      totalCompanies,
      pendingCompanies,
      approvedCompanies,
      rejectedCompanies,
      totalMembers,
      recentCompanies,
      recentAuditLogs
    ] = await Promise.all([
      // Company statistics
      prisma.company.count({ where: companyInOrg }),
      prisma.company.count({ where: { ...companyInOrg, status: 'PENDING' as const } }),
      prisma.company.count({ where: { ...companyInOrg, status: 'APPROVED' as const } }),
      prisma.company.count({ where: { ...companyInOrg, status: 'REJECTED' as const } }),

      // Member statistics (org-scoped)
      prisma.member.count({ where: { organizationId } }),

      // Recent companies (last 7 days)
      prisma.company.findMany({
        where: {
          ...companyInOrg,
          createdAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
          }
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          auditLogs: {
            take: 1,
            orderBy: { timestamp: 'desc' }
          }
        }
      }),

      // Recent audit logs
      prisma.auditLog.findMany({
        where: {
          timestamp: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
          },
          ...auditLogInOrg
        },
        orderBy: { timestamp: 'desc' },
        take: 10,
        include: {
          company: {
            select: { name: true, rfc: true }
          }
        }
      })
    ])

    // Calculate approval rate
    const approvalRate = totalCompanies > 0 ? Math.round((approvedCompanies / totalCompanies) * 100) : 0

    // Get monthly trends (last 6 months) - org-scoped
    const monthlyTrends = await Promise.all(
      Array.from({ length: 6 }, (_, i) => {
        const date = new Date()
        date.setMonth(date.getMonth() - i)
        const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1)
        const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0)

        return prisma.company.count({
          where: {
            ...companyInOrg,
            createdAt: {
              gte: startOfMonth,
              lte: endOfMonth
            }
          }
        })
      })
    )

    // Get top industries - org-scoped
    const topIndustries = await prisma.company.groupBy({
      by: ['industry'],
      where: { ...companyInOrg, industry: { not: null } },
      _count: { industry: true },
      orderBy: { _count: { industry: 'desc' } },
      take: 5
    })

    // Get top states - org-scoped
    const topStates = await prisma.company.groupBy({
      by: ['state'],
      where: { ...companyInOrg, state: { not: null } },
      _count: { state: true },
      orderBy: { _count: { state: 'desc' } },
      take: 5
    })

    // [SAST-FIX #2] Los counts de cfdi_api también requieren scoping.
    const apiDaily = await Promise.all(
      Array.from({ length: 7 }, (_, i) => {
        const day = new Date()
        day.setDate(day.getDate() - i)
        const start = new Date(day.setHours(0, 0, 0, 0))
        const end = new Date(day.setHours(23, 59, 59, 999))
        return prisma.auditLog.count({
          where: {
            tableName: 'cfdi_api',
            timestamp: { gte: start, lte: end },
            ...auditLogInOrg
          }
        })
      })
    )
    const startToday = new Date(new Date().setHours(0, 0, 0, 0))
    const endToday = new Date(new Date().setHours(23, 59, 59, 999))
    const todayTimestampFilter = { gte: startToday, lte: endToday } as const
    const [apiLogTodayTotal, apiLogTodaySuccess, apiLogTodayErrors] = await Promise.all([
      prisma.auditLog.count({
        where: { tableName: 'cfdi_api', timestamp: todayTimestampFilter, ...auditLogInOrg }
      }),
      prisma.auditLog.count({
        where: { tableName: 'cfdi_api', action: 'CREATE', timestamp: todayTimestampFilter, ...auditLogInOrg }
      }),
      prisma.auditLog.count({
        where: { tableName: 'cfdi_api', action: 'REJECT', timestamp: todayTimestampFilter, ...auditLogInOrg }
      })
    ])

    // ============================================================
    // DASH-SAST-005 FIX: recentAuditLogs.userEmail SE ENMASCARA con maskEmail()
    // NUNCA devolver el email crudo a la UI.
    // ============================================================
    const maskedRecentAuditLogs = recentAuditLogs.map(log => ({
      id: log.id,
      action: log.action,
      description: log.description,
      userEmail: maskEmail(log.userEmail),
      _userEmailRawPresent: !!log.userEmail,
      timestamp: log.timestamp,
      companyName: log.company?.name
    }));

    return NextResponse.json({
      statistics: {
        totalCompanies,
        pendingCompanies,
        approvedCompanies,
        rejectedCompanies,
        totalUsers: totalMembers,
        approvalRate,
        apiToday: {
          total: apiLogTodayTotal,
          success: apiLogTodaySuccess,
          errors: apiLogTodayErrors
        }
      },
      trends: {
        monthly: monthlyTrends.reverse(), // Reverse to get chronological order
        labels: Array.from({ length: 6 }, (_, i) => {
          const date = new Date()
          date.setMonth(date.getMonth() - (5 - i))
          return date.toLocaleDateString('es-MX', { month: 'short' })
        })
      },
      topIndustries: topIndustries.map(item => ({
        industry: item.industry || 'Sin industria',
        count: (item._count && 'industry' in item._count && typeof item._count.industry === 'number')
          ? (item._count.industry as number)
          : 0
      })),
      topStates: topStates.map(item => ({
        state: item.state || 'Sin estado',
        count: (item._count && 'state' in item._count && typeof item._count.state === 'number')
          ? (item._count.state as number)
          : 0
      })),
      recentCompanies: recentCompanies.map(company => ({
        id: company.id,
        name: company.name,
        rfc: company.rfc,
        status: company.status,
        createdAt: company.createdAt,
        createdBy: company.createdBy
      })),
      recentAuditLogs: maskedRecentAuditLogs,
      apiLogs: {
        last7Days: apiDaily.reverse(),
        today: {
          total: apiLogTodayTotal,
          success: apiLogTodaySuccess,
          errors: apiLogTodayErrors
        }
      },
      // Metadata de seguridad (transparencia)
      _security: {
        rateLimited: false,
        piiMasked: true,
        adminOnly: true,
        organizationId: organizationId,
        scopeRole: member.role
      }
    }, { headers: SECURITY_HEADERS })

  } catch (error) {
    // ------------------------------------------------------------------
    // DASH-SAST-010: Logging seguro con fingerprint + safeErrSummary.
    // Sin stack ni paths internos hacia cliente.
    // ------------------------------------------------------------------
    const fingerprint = fp32(JSON.stringify({
      msg: (error as Error)?.message || 'ERR_UNKNOWN',
      stack: (error as Error)?.stack?.slice(0, 256) || '',
      t: Date.now()
    }));
    const summary = safeErrSummary(error);
    console.error('[ADMIN_DASH_500]', { fp: fingerprint, summary });

    return NextResponse.json(
      {
        ok: false,
        error: 'Error interno del servidor',
        correlationId: fingerprint
      },
      { status: 500, headers: SECURITY_HEADERS }
    );
  }
}
