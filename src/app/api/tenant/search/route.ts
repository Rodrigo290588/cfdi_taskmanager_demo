import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { z } from 'zod'

// Search query validation schema
const searchSchema = z.object({
  query: z.string().optional().default(''),
  page: z.string().optional().default('1').transform(Number),
  limit: z.string().optional().default('10').transform(Number),
  industry: z.string().optional(),
  state: z.string().optional(),
  companySize: z.string().optional(),
})

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    // Parse query parameters
    const searchParams = Object.fromEntries(request.nextUrl.searchParams)
    const validatedParams = searchSchema.parse(searchParams)
    
    const { query, page, limit, industry, state, companySize } = validatedParams
    
    const skip = (page - 1) * limit

    // Build search filters
    interface WhereClause {
      OR?: Array<{
        name?: { contains: string; mode: 'insensitive' }
        businessDescription?: { contains: string; mode: 'insensitive' }
        city?: { contains: string; mode: 'insensitive' }
        state?: { contains: string; mode: 'insensitive' }
        industry?: { contains: string; mode: 'insensitive' }
      }>
      industry?: { contains: string; mode: 'insensitive' }
      state?: { contains: string; mode: 'insensitive' }
      companySize?: string
    }
    
    const whereClause: WhereClause = {}
    
    // Text search across multiple fields
    if (query) {
      whereClause.OR = [
        { name: { contains: query, mode: 'insensitive' } },
        { businessDescription: { contains: query, mode: 'insensitive' } },
        { city: { contains: query, mode: 'insensitive' } },
        { state: { contains: query, mode: 'insensitive' } },
        { industry: { contains: query, mode: 'insensitive' } }
      ]
    }

    // Filter by specific fields
    if (industry) {
      whereClause.industry = { contains: industry, mode: 'insensitive' }
    }
    
    if (state) {
      whereClause.state = { contains: state, mode: 'insensitive' }
    }
    
    if (companySize) {
      whereClause.companySize = companySize
    }

    // Get total count for pagination
    const totalCount = await prisma.organization.count({
      where: whereClause
    })

    // Get paginated results
    const organizations = await prisma.organization.findMany({
      where: whereClause,
      select: {
        id: true,
        name: true,
        slug: true,
        logo: true,
        description: true,
        city: true,
        state: true,
        country: true,
        industry: true,
        companySize: true,
        createdAt: true,
        ownerId: true,
        contactEmail: true,
        phone: true
      },
      orderBy: {
        createdAt: 'desc'
      },
      skip,
      take: limit
    })

    // Get current user's organizations
    const userOrganizations = await prisma.member.findMany({
      where: {
        userId: session.user.id,
        status: 'APPROVED'
      },
      select: {
        organizationId: true
      }
    })

    const userOrgIds = userOrganizations.map(m => m.organizationId)

    // Mark organizations that belong to current user
    const organizationsWithOwnership = organizations.map(org => ({
      ...org,
      isOwner: org.ownerId === session.user?.id,
      isMember: userOrgIds.includes(org.id)
    }))

    return NextResponse.json({
      success: true,
      organizations: organizationsWithOwnership,
      pagination: {
        total: totalCount,
        page,
        limit,
        totalPages: Math.ceil(totalCount / limit)
      }
    })

  } catch (error) {
    console.error('Error searching tenants:', error)
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { 
          error: 'Parámetros de búsqueda inválidos',
          details: error.issues 
        },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
}