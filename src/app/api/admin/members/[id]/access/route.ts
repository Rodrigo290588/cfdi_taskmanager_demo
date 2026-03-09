import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

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

    const assignments = await prisma.$queryRaw<Array<{ company_id: string; role: string }>>`
      SELECT company_id, role FROM company_access WHERE member_id = ${id}
    `

    return NextResponse.json({
      success: true,
      access: assignments.map(a => ({ companyId: a.company_id, role: a.role }))
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
    const { companyId, role } = body as { companyId?: string; role?: 'ADMIN' | 'AUDITOR' | 'VIEWER' | 'NONE' }
    if (!companyId || !role) {
      return NextResponse.json({ error: 'Parámetros inválidos' }, { status: 400 })
    }

    const targetMember = await prisma.member.findUnique({ where: { id } })
    if (!targetMember) {
      return NextResponse.json({ error: 'Miembro no encontrado' }, { status: 404 })
    }

    const requester = await prisma.member.findFirst({
      where: { 
        userId: session.user.id,
        organizationId: targetMember.organizationId
      },
      include: { organization: true }
    })

    if (!requester?.organization) {
      return NextResponse.json({ error: 'No tienes acceso a esta organización' }, { status: 403 })
    }

    const company = await prisma.company.findUnique({ where: { id: companyId } })
    if (!company) {
      return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 })
    }

    const isOwner = requester.organization.ownerId === session.user.id
    const isAdmin = requester.role === 'ADMIN'
    if (!isOwner && !isAdmin) {
      return NextResponse.json({ error: 'Sin permisos para asignar empresas' }, { status: 403 })
    }

    if (role === 'NONE') {
      await prisma.companyAccess.deleteMany({ where: { memberId: id, companyId } })
      return NextResponse.json({ success: true })
    }

    const existing = await prisma.companyAccess.findUnique({
      where: { memberId_companyId: { memberId: id, companyId } }
    })

    if (existing) {
      await prisma.companyAccess.update({
        where: { memberId_companyId: { memberId: id, companyId } },
        data: { role }
      })
    } else {
      await prisma.companyAccess.create({
        data: {
          organizationId: requester.organization.id,
          companyId,
          memberId: id,
          role
        }
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido'
    console.error('Error updating company access:', message)
    return NextResponse.json({ error: message || 'Error interno del servidor' }, { status: 500 })
  }
}
