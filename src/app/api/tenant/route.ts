import { NextRequest, NextResponse } from 'next/server'
import { updateTenantProgress } from '@/lib/tenant'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { z } from 'zod'

// Validation schema for tenant details
const systemSettingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).optional(),
  smtp: z.object({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    secure: z.boolean().optional(),
    user: z.string().min(1),
    pass: z.string().min(1),
    fromEmail: z.string().email(),
    fromName: z.string().optional()
  }).partial().optional(),
  notifications: z.object({
    emailEnabled: z.boolean().optional(),
    alertsEnabled: z.boolean().optional(),
    auditEnabled: z.boolean().optional()
  }).optional(),
  preferences: z.object({
    locale: z.string().optional(),
    timezone: z.string().optional(),
    sessionTimeoutMinutes: z.number().int().min(5).max(1440).optional()
  }).optional()
}).optional().nullable()

const tenantDetailsSchema = z.object({
  name: z.string().min(1, 'El nombre del tenant es obligatorio').max(100),
  description: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  postalCode: z.string().optional().nullable(),
  country: z.string().optional().nullable().default('México'),
  phone: z.string().optional().nullable(),
  contactEmail: z.preprocess((val) => {
    if (typeof val === 'string') {
      const trimmed = val.trim()
      return trimmed === '' ? undefined : trimmed
    }
    return val
  }, z.string().email('Email inválido').optional().nullable()),
  businessDescription: z.string().optional().nullable(),
  website: z.string().url('URL inválida').optional().nullable(),
  industry: z.string().optional().nullable(),
  companySize: z.string().optional().nullable(),
  foundedYear: z.number().int().min(1800).max(new Date().getFullYear()).optional().nullable(),
  taxId: z.string().optional().nullable(),
  businessType: z.string().optional().nullable(),
  operationalAccessEnabled: z.boolean().optional().nullable(),
  systemSettings: systemSettingsSchema,
})

export type TenantDetailsInput = z.infer<typeof tenantDetailsSchema>

// GET /api/tenant - Get current user's tenant
export async function GET() {
  try {
    const session = await auth()
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    // Find the user's organization (tenant)
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
      return NextResponse.json({ error: 'No se encontró el tenant' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      tenant: member.organization
    })

  } catch (error) {
    console.error('Error getting tenant:', error)
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
}

// POST /api/tenant - Create or update tenant details
export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const body = await request.json()
    
    // Validate input data
    const validatedData = tenantDetailsSchema.parse(body)

    // Find the user's organization
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
      return NextResponse.json({ error: 'No se encontró el tenant' }, { status: 404 })
    }

    // Check if user is the owner or has admin permissions
    const isOwner = member.organization.ownerId === session.user.id
    const isAdmin = member.role === 'ADMIN'
    
    if (!isOwner && !isAdmin) {
      return NextResponse.json(
        { error: 'No tienes permisos para modificar esta información' },
        { status: 403 }
      )
    }

    // Update organization with tenant details
    const updatedTenant = await prisma.organization.update({
      where: { id: member.organization.id },
      data: {
        name: validatedData.name,
        description: validatedData.description,
        address: validatedData.address,
        city: validatedData.city,
        state: validatedData.state,
        postalCode: validatedData.postalCode,
        country: validatedData.country,
        phone: validatedData.phone,
        contactEmail: validatedData.contactEmail,
        businessDescription: validatedData.businessDescription,
        website: validatedData.website,
        industry: validatedData.industry,
        companySize: validatedData.companySize,
        foundedYear: validatedData.foundedYear,
        taxId: validatedData.taxId,
        businessType: validatedData.businessType,
        operationalAccessEnabled: validatedData.operationalAccessEnabled ?? undefined,
        systemSettings: validatedData.systemSettings ?? undefined
      }
    })

    await updateTenantProgress(updatedTenant.id)

    return NextResponse.json({
      success: true,
      tenant: updatedTenant,
      message: 'Información del tenant actualizada exitosamente'
    })

  } catch (error) {
    console.error('Error updating tenant:', error)
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { 
          error: 'Datos inválidos',
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
