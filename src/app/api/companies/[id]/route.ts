import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { hasPermission, Permission } from '@/lib/permissions'
import { readdir, stat } from 'fs/promises'
import path from 'path'

const approveCompanySchema = z.object({
  action: z.enum(['approve', 'reject']),
  rejectionReason: z.string().optional(),
})

const optionalNullableUrlSchema = z.preprocess(
  (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
  z.string().url().optional().nullable()
)

const optionalNullablePositiveIntSchema = z.preprocess(
  (val) => {
    if (val === '' || val === null || val === undefined) return undefined
    if (typeof val === 'number' && Number.isNaN(val)) return undefined
    return val
  },
  z.number().int().positive().optional().nullable()
)

const updateCompanySchema = z.object({
  name: z.string().min(1),
  rfc: z.string().regex(/^[A-ZÑ&]{3,4}[0-9]{6}[A-V1-9]{3}$/),
  businessName: z.string().min(1),
  legalRepresentative: z.string().optional().nullable(),
  taxRegime: z.string().min(1),
  postalCode: z.string().regex(/^\d{5}$/),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  country: z.string().optional().default('México'),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  website: optionalNullableUrlSchema,
  industry: z.string().optional().nullable(),
  employeesCount: optionalNullablePositiveIntSchema,
  incorporationDate: z.string().optional().nullable()
})

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    
    if (!session?.user?.email) {
      return NextResponse.json(
        { error: 'No autorizado' },
        { status: 401 }
      )
    }

    const { id } = await params
    
    if (!id) {
      return NextResponse.json(
        { error: 'ID de empresa requerido' },
        { status: 400 }
      )
    }

    const body = await request.json()
    
    // Validate input
    const validationResult = approveCompanySchema.safeParse(body)
    
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

    const { action, rejectionReason } = validationResult.data

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

    // Check permissions for approval/rejection
    const requiredPermission = action === 'approve' ? Permission.COMPANY_APPROVE : Permission.COMPANY_REJECT
    if (!hasPermission({ id: user.id, systemRole: user.systemRole }, requiredPermission)) {
      return NextResponse.json(
        { error: 'No tienes permisos para procesar empresas' },
        { status: 403 }
      )
    }

    // Get company
    const company = await prisma.company.findUnique({
      where: { id }
    })

    if (!company) {
      return NextResponse.json(
        { error: 'Empresa no encontrada' },
        { status: 404 }
      )
    }

    // Check if company is pending
    if (company.status !== 'PENDING') {
      return NextResponse.json(
        { error: 'La empresa ya ha sido procesada' },
        { status: 400 }
      )
    }

    // Update company status
    const updatedCompany = await prisma.company.update({
      where: { id },
      data: {
        status: action === 'approve' ? 'APPROVED' : 'REJECTED',
        approvedBy: user.id,
        approvedAt: new Date(),
        rejectionReason: action === 'reject' ? rejectionReason : null,
        updatedBy: user.id,
      }
    })

    // Create audit log
    await prisma.auditLog.create({
      data: {
        tableName: 'companies',
        recordId: company.id,
        action: action === 'approve' ? 'APPROVE' : 'REJECT',
        oldValues: { status: 'PENDING' },
        newValues: { 
          status: action === 'approve' ? 'APPROVED' : 'REJECTED',
          approvedBy: user.id,
          approvedAt: new Date(),
          rejectionReason: action === 'reject' ? rejectionReason : null
        },
        userId: user.id,
        userEmail: user.email,
        description: `Company "${company.name}" ${action === 'approve' ? 'approved' : 'rejected'}`,
        companyId: company.id,
      }
    })

    return NextResponse.json({
      message: `Empresa ${action === 'approve' ? 'aprobada' : 'rechazada'} exitosamente`,
      company: {
        id: updatedCompany.id,
        name: updatedCompany.name,
        rfc: updatedCompany.rfc,
        status: updatedCompany.status,
        approvedAt: updatedCompany.approvedAt,
        rejectionReason: updatedCompany.rejectionReason,
      }
    })

  } catch (error) {
    console.error('Error processing company approval:', error)
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    
    if (!session?.user?.email) {
      return NextResponse.json(
        { error: 'No autorizado' },
        { status: 401 }
      )
    }

    const { id } = await params
    
    if (!id) {
      return NextResponse.json(
        { error: 'ID de empresa requerido' },
        { status: 400 }
      )
    }

    const company = await prisma.company.findUnique({
      where: { id },
      include: {
        auditLogs: {
          orderBy: { timestamp: 'desc' },
          take: 10
        }
      }
    })

    if (!company) {
      return NextResponse.json(
        { error: 'Empresa no encontrada' },
        { status: 404 }
      )
    }

    // compute logo from uploads directory
    const uploadsDir = path.join(process.cwd(), 'public', 'uploads', 'company-logos')
    let logoUrl: string | null = null
    try {
      const files = await readdir(uploadsDir)
      const candidates = files.filter(f => f.startsWith(`${company.id}-`))
      if (candidates.length > 0) {
        const withTimes = await Promise.all(
          candidates.map(async f => ({ f, t: (await stat(path.join(uploadsDir, f))).mtime.getTime() }))
        )
        withTimes.sort((a, b) => b.t - a.t)
        logoUrl = `/uploads/company-logos/${withTimes[0].f}`
      }
    } catch {}

    return NextResponse.json({
      company: {
        id: company.id,
        name: company.name,
        rfc: company.rfc,
        businessName: company.businessName,
        legalRepresentative: company.legalRepresentative,
        taxRegime: company.taxRegime,
        postalCode: company.postalCode,
        address: company.address,
        city: company.city,
        state: company.state,
        country: company.country,
        phone: company.phone,
        email: company.email,
        website: company.website,
        industry: company.industry,
        employeesCount: company.employeesCount,
        incorporationDate: company.incorporationDate,
        status: company.status,
        approvedBy: company.approvedBy,
        approvedAt: company.approvedAt,
        rejectionReason: company.rejectionReason,
        notes: company.notes,
        logo: logoUrl,
        createdAt: company.createdAt,
        updatedAt: company.updatedAt,
        createdBy: company.createdBy,
        updatedBy: company.updatedBy,
      },
      auditLogs: company.auditLogs.map(log => ({
        id: log.id,
        action: log.action,
        description: log.description,
        userEmail: log.userEmail,
        timestamp: log.timestamp,
      }))
    })

  } catch (error) {
    console.error('Error fetching company details:', error)
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()

    if (!session?.user?.email) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: 'ID de empresa requerido' }, { status: 400 })
    }

    const body = await request.json()
    const validationResult = updateCompanySchema.safeParse(body)
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

    const user = await prisma.user.findUnique({ where: { email: session.user.email } })
    if (!user) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
    }

    if (!hasPermission({ id: user.id, systemRole: user.systemRole }, Permission.COMPANY_UPDATE)) {
      return NextResponse.json({ error: 'No tienes permisos para actualizar empresas' }, { status: 403 })
    }

    const existing = await prisma.company.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 })
    }

    const data = validationResult.data
    const updated = await prisma.company.update({
      where: { id },
      data: {
        name: data.name,
        rfc: data.rfc.toUpperCase(),
        businessName: data.businessName,
        legalRepresentative: data.legalRepresentative ?? null,
        taxRegime: data.taxRegime,
        postalCode: data.postalCode,
        address: data.address ?? null,
        city: data.city ?? null,
        state: data.state ?? null,
        country: data.country ?? 'México',
        phone: data.phone ?? null,
        email: data.email ?? null,
        website: data.website ?? null,
        industry: data.industry ?? null,
        employeesCount: data.employeesCount ?? null,
        incorporationDate: data.incorporationDate ? new Date(data.incorporationDate) : null,
        updatedBy: user.id
      }
    })

    await prisma.auditLog.create({
      data: {
        tableName: 'companies',
        recordId: updated.id,
        action: 'UPDATE',
        oldValues: {},
        newValues: data,
        userId: user.id,
        userEmail: user.email,
        description: `Company "${updated.name}" updated`,
        companyId: updated.id
      }
    })

    return NextResponse.json({
      message: 'Empresa actualizada exitosamente',
      company: {
        id: updated.id,
        name: updated.name,
        rfc: updated.rfc,
        businessName: updated.businessName,
        legalRepresentative: updated.legalRepresentative,
        taxRegime: updated.taxRegime,
        postalCode: updated.postalCode,
        address: updated.address,
        city: updated.city,
        state: updated.state,
        country: updated.country,
        phone: updated.phone,
        email: updated.email,
        website: updated.website,
        industry: updated.industry,
        employeesCount: updated.employeesCount,
        incorporationDate: updated.incorporationDate,
        status: updated.status
      }
    })
  } catch (error) {
    console.error('Error updating company:', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
