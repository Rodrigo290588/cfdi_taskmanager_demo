import { NextRequest, NextResponse } from 'next/server'
import { buildDashboardScopedContext, dashboardJsonErrorResponse } from '@/lib/dashboard-fiscal-route-utils'
import { Permission } from '@/lib/permissions'
import { prisma } from '@/lib/prisma'
import { SECURITY_HEADERS } from '@/lib/org-dashboard-helpers'
import type { Prisma } from '@prisma/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const SAFE_AUDIT_VALUE_KEYS = new Set([
  'httpStatusCode', 'step', 'requestDurationMs', 'errorCode', 'stepName', 'count', 'totalInvoices', 'batchSize',
])

function maskEmail(raw: string | null): string {
  if (!raw) return '***@***'
  const parts = raw.split('@')
  if (parts.length !== 2) return '***@***'
  const user = parts[0] || ''
  const domain = parts[1] || '***'
  const visible = Math.min(user.length, 2)
  return `${user.slice(0, visible)}***@${domain}`
}

function maskAuditJsonValues(values: unknown): Record<string, unknown> | null {
  if (!values || typeof values !== 'object') return null
  const obj = values as Record<string, unknown>
  const safe: Record<string, unknown> = {}
  for (const k of Object.keys(obj)) {
    if (SAFE_AUDIT_VALUE_KEYS.has(String(k))) {
      safe[k] = obj[k]
    }
  }
  return Object.keys(safe).length === 0 ? null : safe
}

export async function GET(request: NextRequest) {
  try {
    const { ctx, searchParams, systemRole: _sr } = await buildDashboardScopedContext(request, { routeKey: 'apiLogs', requireCompanyId: false, permission: Permission.VIEW_AUDIT_LOGS })
    void _sr
    const page = Number(searchParams.get('page') || 1)
    const limit = Math.min(Number(searchParams.get('limit') || 20), 100)
    const action = searchParams.get('action') || undefined
    const dateFrom = searchParams.get('dateFrom') || undefined
    const dateTo = searchParams.get('dateTo') || undefined
    const query = searchParams.get('query') || ''

    const orgMembers = await prisma.member.findMany({
      where: { organizationId: ctx.organizationId, status: 'APPROVED' },
      select: { userId: true }
    })
    const userIds = orgMembers.map(m => m.userId)

    const where: Prisma.AuditLogWhereInput = {
      tableName: 'cfdi_api',
      userId: { in: userIds }
    }
    if (action) (where as { action?: string }).action = action
    if (dateFrom || dateTo) {
      where.timestamp = {}
      if (dateFrom) where.timestamp.gte = new Date(dateFrom)
      if (dateTo) where.timestamp.lte = new Date(dateTo)
    }
    if (query) {
      where.OR = [
        { description: { contains: query, mode: 'insensitive' } },
        { userEmail: { contains: query, mode: 'insensitive' } },
        { recordId: { contains: query, mode: 'insensitive' } },
      ]
    }

    const skip = (page - 1) * limit
    const [rows, total, todayTotal, todaySuccess, todayErrors, last7Days] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          action: true,
          description: true,
          userEmail: true,
          timestamp: true,
          recordId: true,
          oldValues: true,
          newValues: true,
        }
      }),
      prisma.auditLog.count({ where }),
      prisma.auditLog.count({
        where: {
          tableName: 'cfdi_api',
          userId: { in: userIds },
          timestamp: {
            gte: new Date(new Date().setHours(0, 0, 0, 0)),
            lte: new Date(new Date().setHours(23, 59, 59, 999))
          }
        }
      }),
      prisma.auditLog.count({
        where: {
          tableName: 'cfdi_api',
          userId: { in: userIds },
          action: 'CREATE',
          timestamp: {
            gte: new Date(new Date().setHours(0, 0, 0, 0)),
            lte: new Date(new Date().setHours(23, 59, 59, 999))
          }
        }
      }),
      prisma.auditLog.count({
        where: {
          tableName: 'cfdi_api',
          userId: { in: userIds },
          action: 'REJECT',
          timestamp: {
            gte: new Date(new Date().setHours(0, 0, 0, 0)),
            lte: new Date(new Date().setHours(23, 59, 59, 999))
          }
        }
      }),
      Promise.all(
        Array.from({ length: 7 }, (_, i) => {
          const day = new Date()
          day.setDate(day.getDate() - i)
          const start = new Date(day.setHours(0, 0, 0, 0))
          const end = new Date(day.setHours(23, 59, 59, 999))
          return prisma.auditLog.count({
            where: {
              tableName: 'cfdi_api',
              userId: { in: userIds },
              timestamp: { gte: start, lte: end }
            }
          })
        })
      ).then(arr => arr.reverse())
    ])

    const startToday = new Date(new Date().setHours(0, 0, 0, 0))
    const endToday = new Date(new Date().setHours(23, 59, 59, 999))
    const [importToday, createToday, rejectToday] = await Promise.all([
      prisma.auditLog.count({ where: { tableName: 'cfdi_api', userId: { in: userIds }, action: 'IMPORT', timestamp: { gte: startToday, lte: endToday } } }),
      prisma.auditLog.count({ where: { tableName: 'cfdi_api', userId: { in: userIds }, action: 'CREATE', timestamp: { gte: startToday, lte: endToday } } }),
      prisma.auditLog.count({ where: { tableName: 'cfdi_api', userId: { in: userIds }, action: 'REJECT', timestamp: { gte: startToday, lte: endToday } } }),
    ])

    const hourlyTodayPromises = Array.from({ length: 24 }, (_, h) => {
      const hStart = new Date(startToday)
      hStart.setHours(h, 0, 0, 0)
      const hEnd = new Date(hStart)
      hEnd.setHours(h, 59, 59, 999)
      return prisma.auditLog.count({
        where: {
          tableName: 'cfdi_api',
          userId: { in: userIds },
          timestamp: { gte: hStart, lte: hEnd }
        }
      })
    })
    const hourlyToday = await Promise.all(hourlyTodayPromises)

    // Métricas de tiempo de respuesta (promedio por hora y promedio diario)
    // Optimización: precargar IMPORT logs del día y mapear por recordId=requestId
    const importLogsToday = await prisma.auditLog.findMany({
      where: {
        tableName: 'cfdi_api',
        userId: { in: userIds },
        action: 'IMPORT',
        timestamp: { gte: startToday, lte: endToday }
      },
      select: { recordId: true, timestamp: true }
    })
    const importMap = new Map<string, Date>()
    for (const il of importLogsToday) {
      if (il.recordId) importMap.set(il.recordId, il.timestamp)
    }

    const responseTimesHourlyAvgMs: number[] = []
    let totalResponseMs = 0
    let totalResponses = 0
    for (let h = 0; h < 24; h++) {
      const hStart = new Date(startToday)
      hStart.setHours(h, 0, 0, 0)
      const hEnd = new Date(startToday)
      hEnd.setHours(h, 59, 59, 999)
      const createLogs = await prisma.auditLog.findMany({
        where: {
          tableName: 'cfdi_api',
          userId: { in: userIds },
          action: 'CREATE',
          timestamp: { gte: hStart, lte: hEnd }
        },
        select: { timestamp: true, oldValues: true }
      })
      let sumMs = 0
      let count = 0
      for (const cl of createLogs) {
        const ov = cl.oldValues as unknown as Record<string, unknown> | null
        const reqId = ov && typeof ov['requestId'] === 'string' ? String(ov['requestId']) : null
        if (!reqId) continue
        const importTs = reqId ? importMap.get(reqId) : undefined
        if (!importTs) continue
        const ms = cl.timestamp.getTime() - importTs.getTime()
        if (ms >= 0) {
          sumMs += ms
          count += 1
        }
      }
      const avg = count ? Math.round(sumMs / count) : 0
      responseTimesHourlyAvgMs.push(avg)
      totalResponseMs += sumMs
      totalResponses += count
    }
    const avgResponseMsToday = totalResponses ? Math.round(totalResponseMs / totalResponses) : 0

    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const recentUsers = await prisma.auditLog.findMany({
      where: { tableName: 'cfdi_api', userId: { in: userIds }, timestamp: { gte: sevenDaysAgo } },
      select: { userEmail: true }
    })
    const userCounts: Record<string, number> = {}
    for (const r of recentUsers) {
      const email = r.userEmail || 'Desconocido'
      userCounts[email] = (userCounts[email] || 0) + 1
    }
    const topUsers7d = Object.entries(userCounts)
      .map(([userEmail, count]) => ({ userEmail: maskEmail(userEmail || null), count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5)

    const rejectRowsToday = await prisma.auditLog.findMany({
      where: { tableName: 'cfdi_api', userId: { in: userIds }, action: 'REJECT', timestamp: { gte: startToday, lte: endToday } },
      select: { oldValues: true, newValues: true, description: true }
    })
    const reasonCounts: Record<string, number> = {}
    for (const r of rejectRowsToday) {
      let reason = 'unknown'
      const nv = r.newValues as unknown as Record<string, unknown> | null
      const ov = r.oldValues as unknown as Record<string, unknown> | null
      if (nv && typeof nv['step'] === 'string') reason = String(nv['step'])
      else if (ov && typeof ov['reason'] === 'string') reason = String(ov['reason'])
      else if (r.description) reason = r.description
      reasonCounts[reason] = (reasonCounts[reason] || 0) + 1
    }
    const errorsByReasonToday = Object.entries(reasonCounts).map(([reason, count]) => ({ reason, count }))

    // Top RFC emisores y receptores últimos 7 días (con acción CREATE)
    const createLast7d = await prisma.auditLog.findMany({
      where: { tableName: 'cfdi_api', userId: { in: userIds }, action: 'CREATE', timestamp: { gte: sevenDaysAgo } },
      select: { newValues: true }
    })
    const issuerCounts: Record<string, number> = {}
    const receiverCounts: Record<string, number> = {}
    for (const row of createLast7d) {
      const nv = row.newValues as unknown as Record<string, unknown> | null
      const ir = nv && typeof nv['issuerRfc'] === 'string' ? String(nv['issuerRfc']) : null
      const rr = nv && typeof nv['receiverRfc'] === 'string' ? String(nv['receiverRfc']) : null
      if (ir) issuerCounts[ir] = (issuerCounts[ir] || 0) + 1
      if (rr) receiverCounts[rr] = (receiverCounts[rr] || 0) + 1
    }
    const topIssuers7d = Object.entries(issuerCounts).map(([rfc, count]) => ({ rfc, count })).sort((a, b) => b.count - a.count).slice(0, 5)
    const topReceivers7d = Object.entries(receiverCounts).map(([rfc, count]) => ({ rfc, count })).sort((a, b) => b.count - a.count).slice(0, 5)

    return NextResponse.json({
      statsToday: { total: todayTotal, success: todaySuccess, errors: todayErrors },
      last7Days,
      byActionToday: { import: importToday, create: createToday, reject: rejectToday },
      hourlyToday,
      responseTimesHourlyAvgMs,
      avgResponseMsToday,
      topIssuers7d,
      topReceivers7d,
      topUsers7d,
      errorsByReasonToday,
      logs: rows.map(r => ({
        id: r.id,
        action: r.action,
        description: r.description,
        userEmail: maskEmail(r.userEmail || null),
        timestamp: r.timestamp,
        recordId: r.recordId,
        oldValues: maskAuditJsonValues(r.oldValues),
        newValues: maskAuditJsonValues(r.newValues),
      })),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    }, { headers: SECURITY_HEADERS })
  } catch (error) {
    return dashboardJsonErrorResponse(error)
  }
}
