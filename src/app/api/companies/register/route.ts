import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { hasPermission, Permission } from '@/lib/permissions'

const registerCompanySchema = z.object({
  name: z.string().min(1, 'El nombre es requerido').max(200),
  rfc: z.string().regex(/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/, 'RFC inválido'),
  businessName: z.string().min(1, 'La razón social es requerida').max(200),
  legalRepresentative: z.string().optional(),
  taxRegime: z.string().min(1, 'El régimen fiscal es requerido'),
  postalCode: z.string().regex(/^\d{5}$/, 'Código postal inválido'),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().default('México'),
  phone: z.string().optional(),
  email: z.string().email('Email inválido').optional(),
  website: z.string().url('URL inválida').optional(),
  industry: z.string().optional(),
  employeesCount: z.number().int().positive().optional(),
  incorporationDate: z.string().datetime().optional(),
})

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    
    if (!session?.user?.email) {
      return NextResponse.json(
        { error: 'No autorizado' },
        { status: 401 }
      )
    }

    // Get user information
    const user = await prisma.user.findUnique({
      where: { email: session.user.email }
    })

    if (!user) {
      return NextResponse.json(
        { error: 'Usuario no encontrado' },
        { status: 404 }
      )
    }

    // Check permissions
    if (!hasPermission({ id: user.id, systemRole: user.systemRole }, Permission.COMPANY_CREATE)) {
      return NextResponse.json(
        { error: 'No tienes permisos para crear empresas' },
        { status: 403 }
      )
    }

    const body = await request.json()
    
    // Validate input data
    const validationResult = registerCompanySchema.safeParse(body)
    
    if (!validationResult.success) {
      return NextResponse.json(
        { 
          error: 'Datos inválidos',
          details: validationResult.error.issues.map(issue => ({
            field: issue.path.join('.'),
            message: issue.message
          }))
        },
        { status: 400 }
      )
    }

    const data = validationResult.data

    // Check for duplicate RFC
    const existingCompany = await prisma.company.findUnique({
      where: { rfc: data.rfc }
    })

    if (existingCompany) {
      return NextResponse.json(
        { error: 'El RFC ya está registrado' },
        { status: 409 }
      )
    }

    // Create company
    const company = await prisma.company.create({
      data: {
        ...data,
        incorporationDate: data.incorporationDate ? new Date(data.incorporationDate) : undefined,
        createdBy: user.id,
        updatedBy: user.id,
      }
    })

    // Update tenant progress (get user's organization)
    const membership = await prisma.member.findFirst({
      where: {
        userId: user.id,
        status: 'APPROVED'
      },
      include: {
        organization: true
      }
    })

    if (membership && membership.organization.ownerId === user.id) {
      // Update tenant progress after company registration
      await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/tenant/update-progress`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        // Note: This would need proper authentication in a real implementation
      })
    }

    // Create audit log
    await prisma.auditLog.create({
      data: {
        tableName: 'companies',
        recordId: company.id,
        action: 'CREATE',
        newValues: data,
        userId: user.id,
        userEmail: user.email,
        description: `Company "${data.name}" registered with RFC ${data.rfc}`,
        companyId: company.id,
      }
    })

    return NextResponse.json({
      message: 'Empresa registrada exitosamente',
      company: {
        id: company.id,
        name: company.name,
        rfc: company.rfc,
        businessName: company.businessName,
        status: company.status,
        createdAt: company.createdAt,
      }
    })

  } catch (error) {
    console.error('Error registering company:', error)
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
}