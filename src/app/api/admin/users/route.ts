import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// [HARDENING P0 - Fix #6] Alinear contrato doc: SÓLO Owner o SUPER_ADMIN/systemRole ADMIN.
// - Anterior: permitía membership.role === 'ADMIN' (rol de membresía local)
// - Ahora: permitir sólo (organization.ownerId === session.user.id) OR (session.user.systemRole in {SUPER_ADMIN, ADMIN})
// - reqId añadido para trazabilidad
export async function GET() {
  const reqId = crypto.randomUUID()
  try {
    const session = await auth()

    if (!session?.user) {
      return NextResponse.json(
        { error: 'No autorizado', reqId },
        { status: 401, headers: { 'X-Request-Id': reqId } }
      )
    }

    // Get user's organization
    const membership = await prisma.member.findFirst({
      where: {
        userId: session.user.id,
        status: 'APPROVED'
      },
      include: { organization: true }
    })

    if (!membership) {
      return NextResponse.json(
        { error: 'No perteneces a ninguna organización', reqId },
        { status: 404, headers: { 'X-Request-Id': reqId } }
      )
    }

    const isOwner = membership.organization.ownerId === session.user.id
    const isSuperAdmin = (session.user.systemRole as string) === 'SUPER_ADMIN'

    if (!isOwner && !isSuperAdmin) {
      return NextResponse.json(
        { error: 'No tienes permisos para ver los usuarios', reqId },
        { status: 403, headers: { 'X-Request-Id': reqId } }
      )
    }

    const activeUsers = await prisma.member.findMany({
      where: {
        organizationId: membership.organizationId,
        status: {
          in: ['APPROVED', 'INACTIVE']
        }
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            createdAt: true
          }
        },
        customRole: {
          select: {
            id: true,
            name: true
          }
        },
        companyAccesses: {
          select: {
            companyId: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    })

    return NextResponse.json(
      {
        success: true,
        reqId,
        users: activeUsers.map(member => ({
          id: member.id,
          userId: member.userId,
          name: member.user.name,
          email: member.user.email,
          role: member.customRole ? member.customRole.name : member.role,
          roleId: member.customRoleId || member.role,
          isCustomRole: !!member.customRole,
          status: member.status,
          joinedAt: member.createdAt,
          companyIds: member.companyAccesses.map(ca => ca.companyId)
        }))
      },
      { headers: { 'X-Request-Id': reqId } }
    )
  } catch (error) {
    console.error('[admin/users GET]', { reqId, error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json(
      { error: 'Error interno del servidor', reqId },
      { status: 500, headers: { 'X-Request-Id': reqId } }
    )
  }
}
