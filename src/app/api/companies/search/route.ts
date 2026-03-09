import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { CompanyStatus } from '@prisma/client'
import { readdir, stat } from 'fs/promises'
import path from 'path'

const searchCompaniesSchema = z.object({
  query: z.string().optional().or(z.literal('')),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional().or(z.literal('')),
  taxRegime: z.string().optional().or(z.literal('')),
  industry: z.string().optional().or(z.literal('')),
  state: z.string().optional().or(z.literal('')),
  dateFrom: z.string().optional().or(z.literal('')),
  dateTo: z.string().optional().or(z.literal('')),
  employeesMin: z.coerce.number().optional().or(z.literal('')),
  employeesMax: z.coerce.number().optional().or(z.literal('')),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  sortBy: z.enum(['name', 'createdAt', 'status', 'rfc']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc')
})

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const searchParams = request.nextUrl.searchParams
    const params = Object.fromEntries(searchParams.entries())
    
    const validatedParams = searchCompaniesSchema.parse(params)
    const { 
      query, status, taxRegime, industry, state, dateFrom, dateTo,
      employeesMin, employeesMax, page, limit, sortBy, sortOrder 
    } = validatedParams

    // Get user's organization through membership
    const member = await prisma.member.findFirst({
      where: { 
        userId: session.user.id,
        status: 'APPROVED'
      },
      include: {
        organization: true
      }
    })

    if (!member?.organization) {
      return NextResponse.json({
        companies: [],
        pagination: {
          total: 0,
          page,
          limit,
          totalPages: 0
        },
        filters: {
          taxRegimes: [],
          industries: [],
          states: []
        }
      })
    }

    const isOwner = member.organization.ownerId === session.user.id
    const isAdmin = member.role === 'ADMIN'
    let userIds: string[] = []
    let accessibleCompanyIds: string[] = []

    if (isOwner || isAdmin) {
      const members = await prisma.member.findMany({
        where: { organizationId: member.organization.id, status: 'APPROVED' },
        select: { userId: true }
      })
      userIds = members.map(m => m.userId)
    } else {
      const access = await prisma.$queryRaw<Array<{ company_id: string }>>`
        SELECT company_id FROM company_access WHERE member_id = ${member.id}
      `
      accessibleCompanyIds = access.map(a => a.company_id)
    }

    interface WhereClause {
      OR?: Array<{
        name?: { contains: string; mode: 'insensitive' }
        rfc?: { contains: string; mode: 'insensitive' }
        businessName?: { contains: string; mode: 'insensitive' }
        legalRepresentative?: { contains: string; mode: 'insensitive' }
        email?: { contains: string; mode: 'insensitive' }
      }>
      status?: CompanyStatus
      taxRegime?: string
      industry?: string
      state?: string
      createdAt?: {
        gte?: Date
        lte?: Date
      }
      employeesCount?: {
        gte?: number
        lte?: number
      }
      createdBy?: {
        in: string[]
      }
      id?: {
        in: string[]
      }
    }
    
    const where: WhereClause = {}
    if (isOwner || isAdmin) {
      where.createdBy = { in: userIds }
    } else {
      where.id = { in: accessibleCompanyIds }
    }

    // Text search across multiple fields
    if (query) {
      where.OR = [
        { name: { contains: query, mode: 'insensitive' } },
        { rfc: { contains: query, mode: 'insensitive' } },
        { businessName: { contains: query, mode: 'insensitive' } },
        { legalRepresentative: { contains: query, mode: 'insensitive' } },
        { email: { contains: query, mode: 'insensitive' } }
      ]
    }

    // Status filter
    if (status) {
      where.status = status
    }

    // Tax regime filter
    if (taxRegime) {
      where.taxRegime = taxRegime
    }

    // Industry filter
    if (industry) {
      where.industry = industry
    }

    // State filter
    if (state) {
      where.state = state
    }

    // Date range filter
    if (dateFrom || dateTo) {
      where.createdAt = {}
      if (dateFrom) {
        where.createdAt.gte = new Date(dateFrom)
      }
      if (dateTo) {
        where.createdAt.lte = new Date(dateTo + 'T23:59:59.999Z')
      }
    }

    // Employee count filter
    if (employeesMin !== undefined && employeesMin !== '') {
      where.employeesCount = {}
      where.employeesCount.gte = Number(employeesMin)
    }
    if (employeesMax !== undefined && employeesMax !== '') {
      if (!where.employeesCount) where.employeesCount = {}
      where.employeesCount.lte = Number(employeesMax)
    }

    // Calculate pagination
    const skip = (page - 1) * limit

    // Get companies with related data
    const [companies, total] = await Promise.all([
      prisma.company.findMany({ where, skip, take: limit, orderBy: { [sortBy]: sortOrder } }),
      prisma.company.count({ where })
    ])

    // Get unique values for filters
    const [taxRegimesRaw, industriesRaw, statesRaw] = await Promise.all([
      prisma.company.findMany({
        select: { taxRegime: true },
        distinct: ['taxRegime']
      }),
      prisma.company.findMany({
        select: { industry: true },
        distinct: ['industry']
      }),
      prisma.company.findMany({
        select: { state: true },
        distinct: ['state']
      })
    ])

    // Filter out null values
    const taxRegimes = taxRegimesRaw.map(r => r.taxRegime).filter(Boolean)
    const industries = industriesRaw.map(i => i.industry).filter(Boolean)
    const states = statesRaw.map(s => s.state).filter(Boolean)

    // Compute latest logo per company from uploads directory (if any)
    const uploadsDir = path.join(process.cwd(), 'public', 'uploads', 'company-logos')
    let latestLogosByCompany: Record<string, string> = {}
    try {
      const files = await readdir(uploadsDir)
      // Build a map of latest file per company id
      const byCompany: Record<string, { f: string; t: number }> = {}
      for (const f of files) {
        const dashIdx = f.indexOf('-')
        if (dashIdx <= 0) continue
        const companyId = f.slice(0, dashIdx)
        const filePath = path.join(uploadsDir, f)
        try {
          const mtime = (await stat(filePath)).mtime.getTime()
          const existing = byCompany[companyId]
          if (!existing || mtime > existing.t) {
            byCompany[companyId] = { f, t: mtime }
          }
        } catch {}
      }
      latestLogosByCompany = Object.fromEntries(
        Object.entries(byCompany).map(([id, { f }]) => [id, `/uploads/company-logos/${f}`])
      )
    } catch {}

    return NextResponse.json({
      companies: companies.map((c) => ({
        ...c,
        logo: latestLogosByCompany[c.id] ?? null,
      })),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      },
      filters: {
        taxRegimes,
        industries,
        states
      }
    })

  } catch (error) {
    console.error('Error searching companies:', error)
    if (error instanceof z.ZodError) {
      return NextResponse.json({ 
        error: 'Parámetros de búsqueda inválidos',
        details: error.issues
      }, { status: 400 })
    }
    return NextResponse.json({ 
      error: 'Error interno del servidor',
      details: error instanceof Error ? error.message : 'Error desconocido'
    }, { status: 500 })
  }
}
