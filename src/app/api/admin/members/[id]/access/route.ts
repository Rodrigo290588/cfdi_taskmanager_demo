import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  resolveRoleForOrg,
  AdminRoleValidationError
} from '@/lib/admin-roles'

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { id } = await context.params

    const targetMember = await prisma.member.findUnique({ where: { id } })
    if (!targetMember) {
      return NextResponse.json({ error: 'Miembro no encontrado' }, { status: 404 })
    }

    const requester = await prisma.member.findFirst({
      where: {
        userId: session.user.id,
        status: 'APPROVED', // [SAST-FIX #5] Solo miembros APPROVED
        organizationId: targetMember.organizationId
      },
      include: { organization: true }
    })

    if (!requester?.organization) {
      return NextResponse.json({ error: 'No tienes acceso a esta organización' }, { status: 403 })
    }

    const isOwner = requester.organization.ownerId === session.user.id
    const isAdmin = requester.role === 'ADMIN'
    if (!isOwner && !isAdmin) {
      return NextResponse.json({ error: 'Sin permisos para ver accesos' }, { status: 403 })
    }

    const assignments = await prisma.companyAccess.findMany({
      where: { memberId: id },
      select: {
        companyId: true,
        role: true,
        customRoleId: true,
        customRole: {
          select: { name: true }
        }
      }
    })

    return NextResponse.json({
      success: true,
      access: assignments.map(a => ({ 
        companyId: a.companyId, 
        role: a.customRoleId ? a.customRoleId : a.role,
        isCustomRole: !!a.customRoleId,
        customRoleName: a.customRole?.name
      }))
    })
  } catch (error) {
    console.error('Error fetching company access:', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { id } = await context.params
    const body = await request.json()
    const { companyId, role: roleId } = body as { companyId?: string; role?: string }
    if (!companyId || !roleId) {
      return NextResponse.json({ error: 'Parámetros inválidos' }, { status: 400 })
    }

    const targetMember = await prisma.member.findUnique({ where: { id } })
    if (!targetMember) {
      return NextResponse.json({ error: 'Miembro no encontrado' }, { status: 404 })
    }

    const requester = await prisma.member.findFirst({
      where: {
        userId: session.user.id,
        status: 'APPROVED', // [SAST-FIX #5] Solo miembros APPROVED
        organizationId: targetMember.organizationId
      },
      include: { organization: true }
    })

    if (!requester?.organization) {
      return NextResponse.json({ error: 'No tienes acceso a esta organización' }, { status: 403 })
    }

    // [SAST-FIX #1] Asegurar que la empresa pertenece a la misma organización del targetMember.
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        companyAccesses: {
          where: { organizationId: targetMember.organizationId },
          take: 1,
          select: { id: true }
        }
      }
    })
    if (!company) {
      return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 })
    }
    // Company pertenece a la org si existe un CompanyAccess (link Organization <-> Company)
    // para el organizationId del targetMember.
    if (company.companyAccesses.length === 0) {
      return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 })
    }

    const isOwner = requester.organization.ownerId === session.user.id
    const isAdmin = requester.role === 'ADMIN'
    if (!isOwner && !isAdmin) {
      return NextResponse.json({ error: 'Sin permisos para asignar empresas' }, { status: 403 })
    }

    if (roleId === 'NONE') {
      await prisma.companyAccess.deleteMany({ where: { memberId: id, companyId } })
      return NextResponse.json({ success: true })
    }

    // [SAST-FIX #1/#4] Resolver roleId validando pertenencia de CustomRole a la ORG
    const { systemRole, customRoleId } = await resolveRoleForOrg(
      roleId,
      targetMember.organizationId
    )

    const existing = await prisma.companyAccess.findUnique({
      where: { memberId_companyId: { memberId: id, companyId } }
    })

    if (existing) {
      await prisma.companyAccess.update({
        where: { memberId_companyId: { memberId: id, companyId } },
        data: {
          role: systemRole,
          customRoleId
        }
      })
    } else {
      await prisma.companyAccess.create({
        data: {
          organizationId: requester.organization.id,
          companyId,
          memberId: id,
          role: systemRole,
          customRoleId
        }
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof AdminRoleValidationError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    // [SAST-FIX #7] Nunca exponer error.message de Prisma al cliente.
    // Solo internamente en logs.
    console.error('[admin/members/access] Error actualizando acceso de empresa:', error)
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
}
