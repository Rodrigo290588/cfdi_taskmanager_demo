import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { hasPermission, Permission } from '@/lib/permissions'

export async function GET() {
  try {
    const session = await auth()
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    // Get user information
    const user = await prisma.user.findUnique({
      where: { email: session.user.email }
    })

    if (!user) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
    }

    // Check admin permissions
    if (!hasPermission({ id: user.id, systemRole: user.systemRole }, Permission.ADMIN_DASHBOARD)) {
      return NextResponse.json({ error: 'No tienes permisos de administrador' }, { status: 403 })
    }

    // Get dashboard statistics
    const [
      totalCompanies,
      pendingCompanies,
      approvedCompanies,
      rejectedCompanies,
      totalUsers,
      recentCompanies,
      recentAuditLogs
    ] = await Promise.all([
      // Company statistics
      prisma.company.count(),
      prisma.company.count({ where: { status: 'PENDING' } }),
      prisma.company.count({ where: { status: 'APPROVED' } }),
      prisma.company.count({ where: { status: 'REJECTED' } }),
      
      // User statistics
      prisma.user.count(),
      
      // Recent companies (last 7 days)
      prisma.company.findMany({
        where: {
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
          }
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

    // Get monthly trends (last 6 months)
    const monthlyTrends = await Promise.all(
      Array.from({ length: 6 }, (_, i) => {
        const date = new Date()
        date.setMonth(date.getMonth() - i)
        const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1)
        const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0)
        
        return prisma.company.count({
          where: {
            createdAt: {
              gte: startOfMonth,
              lte: endOfMonth
            }
          }
        })
      })
    )

    // Get top industries
    const topIndustries = await prisma.company.groupBy({
      by: ['industry'],
      where: { industry: { not: null } },
      _count: { industry: true },
      orderBy: { _count: { industry: 'desc' } },
      take: 5
    })

    // Get top states
    const topStates = await prisma.company.groupBy({
      by: ['state'],
      where: { state: { not: null } },
      _count: { state: true },
      orderBy: { _count: { state: 'desc' } },
      take: 5
    })

    const apiDaily = await Promise.all(
      Array.from({ length: 7 }, (_, i) => {
        const day = new Date()
        day.setDate(day.getDate() - i)
        const start = new Date(day.setHours(0, 0, 0, 0))
        const end = new Date(day.setHours(23, 59, 59, 999))
        return prisma.auditLog.count({
          where: {
            tableName: 'cfdi_api',
            timestamp: { gte: start, lte: end }
          }
        })
      })
    )
    const startToday = new Date(new Date().setHours(0, 0, 0, 0))
    const endToday = new Date(new Date().setHours(23, 59, 59, 999))
    const [apiLogTodayTotal, apiLogTodaySuccess, apiLogTodayErrors] = await Promise.all([
      prisma.auditLog.count({
        where: { tableName: 'cfdi_api', timestamp: { gte: startToday, lte: endToday } }
      }),
      prisma.auditLog.count({
        where: { tableName: 'cfdi_api', action: 'CREATE', timestamp: { gte: startToday, lte: endToday } }
      }),
      prisma.auditLog.count({
        where: { tableName: 'cfdi_api', action: 'REJECT', timestamp: { gte: startToday, lte: endToday } }
      })
    ])

    return NextResponse.json({
      statistics: {
        totalCompanies,
        pendingCompanies,
        approvedCompanies,
        rejectedCompanies,
        totalUsers,
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
        count: item._count.industry
      })),
      topStates: topStates.map(item => ({
        state: item.state || 'Sin estado',
        count: item._count.state
      })),
      recentCompanies: recentCompanies.map(company => ({
        id: company.id,
        name: company.name,
        rfc: company.rfc,
        status: company.status,
        createdAt: company.createdAt,
        createdBy: company.createdBy
      })),
      recentAuditLogs: recentAuditLogs.map(log => ({
        id: log.id,
        action: log.action,
        description: log.description,
        userEmail: log.userEmail,
        timestamp: log.timestamp,
        companyName: log.company?.name
      })),
      apiLogs: {
        last7Days: apiDaily.reverse(),
        today: {
          total: apiLogTodayTotal,
          success: apiLogTodaySuccess,
          errors: apiLogTodayErrors
        }
      }
    })

  } catch (error) {
    console.error('Error fetching admin dashboard data:', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
