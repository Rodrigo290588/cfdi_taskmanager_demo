import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { z } from 'zod'
import {
  updateCustomRoleSchema,
  SYSTEM_ROLE_IDS,
  buildSystemRoleDefaults,
  getSystemRoleOverrideForOrg,
  saveSystemRoleOverrideForOrg,
  type SystemRoleId
} from '@/lib/admin-roles'

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }

    // [SAST-FIX #5] Solo miembros APPROVED y permitir OWNER
    const member = await prisma.member.findFirst({
      where: { userId: session.user.id, status: 'APPROVED' },
      include: { organization: true }
    })

    const isOwner = member?.organization?.ownerId === session.user.id
    if (!member || (member.role !== "ADMIN" && !isOwner)) {
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 })
    }

    const { id } = await params

    // System Role → guardar override por organización sin tocar tabla CustomRole
    if (SYSTEM_ROLE_IDS.includes(id as SystemRoleId)) {
      const rawBody = await req.json()
      const body = updateCustomRoleSchema.parse(rawBody)
      const existingOverr = await getSystemRoleOverrideForOrg(member.organizationId, id as SystemRoleId)

      const permissions = body.permissions ?? {
        canViewEmission: existingOverr.canViewEmission,
        canViewReception: existingOverr.canViewReception,
        canViewPayroll: existingOverr.canViewPayroll,
        canViewSatPortal: existingOverr.canViewSatPortal,
        canViewMassDownloads: existingOverr.canViewMassDownloads,
        canManageOrg: existingOverr.canManageOrg
      }
      const granular = { ...existingOverr.granularPermissions, ...(body.granularPermissions || {}) }

      await saveSystemRoleOverrideForOrg(member.organizationId, id as SystemRoleId, {
        canViewEmission: !!permissions.canViewEmission,
        canViewReception: !!permissions.canViewReception,
        canViewPayroll: !!permissions.canViewPayroll,
        canViewSatPortal: !!permissions.canViewSatPortal,
        canViewMassDownloads: !!permissions.canViewMassDownloads,
        canManageOrg: !!permissions.canManageOrg,
        granularPermissions: Object.fromEntries(
          Object.entries(granular).filter(([, v]) => typeof v === 'boolean')
        ) as Record<string, boolean>
      })

      const base = buildSystemRoleDefaults(id as SystemRoleId)
      const updated = await getSystemRoleOverrideForOrg(member.organizationId, id as SystemRoleId)
      return NextResponse.json({
        role: {
          id,
          name: typeof body.name === 'string' ? body.name : base.name,
          description: typeof body.description === 'string' ? body.description : base.description,
          isSystemRole: true,
          canViewEmission: updated.canViewEmission,
          canViewReception: updated.canViewReception,
          canViewPayroll: updated.canViewPayroll,
          canViewSatPortal: updated.canViewSatPortal,
          canViewMassDownloads: updated.canViewMassDownloads,
          canManageOrg: updated.canManageOrg,
          granularPermissions: updated.granularPermissions
        }
      })
    }

    // [SAST-FIX #3] Validación estricta del body.
    const rawBody = await req.json()
    const body = updateCustomRoleSchema.parse(rawBody)
    const { name, description, permissions, granularPermissions } = body

    const existingRole = await prisma.customRole.findFirst({
      where: {
        id,
        organizationId: member.organizationId
      }
    })

    if (!existingRole) {
      return NextResponse.json({ error: "Rol no encontrado" }, { status: 404 })
    }

    // No spread, sino asignación explícita por allow-list.
    const updateData: Record<string, unknown> = {}
    if (typeof name === 'string') updateData.name = name
    if (typeof description === 'string') updateData.description = description
    if (permissions) {
      updateData.canViewEmission = permissions.canViewEmission
      updateData.canViewReception = permissions.canViewReception
      updateData.canViewPayroll = permissions.canViewPayroll
      updateData.canViewSatPortal = permissions.canViewSatPortal
      updateData.canViewMassDownloads = permissions.canViewMassDownloads
      updateData.canManageOrg = permissions.canManageOrg
    }
    if (granularPermissions) updateData.granularPermissions = granularPermissions

    const updatedRole = await prisma.customRole.update({
      where: { id },
      data: updateData
    })

    return NextResponse.json({ role: updatedRole })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({
        error: 'Datos de rol inválidos',
        details: error.issues.map(i => ({
          field: i.path.join('.'),
          message: i.message
        }))
      }, { status: 400 })
    }
    console.error("Error updating custom role:", error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }

    const { id } = await params

    if (SYSTEM_ROLE_IDS.includes(id as SystemRoleId)) {
      return NextResponse.json({ error: "No se pueden eliminar roles de sistema" }, { status: 400 })
    }

    // [SAST-FIX #5] status APPROVED + Owner tiene autoridad
    const member = await prisma.member.findFirst({
      where: { userId: session.user.id, status: 'APPROVED' },
      include: { organization: true }
    })

    const isOwner = member?.organization?.ownerId === session.user.id
    if (!member || (member.role !== "ADMIN" && !isOwner)) {
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 })
    }

    const existingRole = await prisma.customRole.findFirst({
      where: {
        id,
        organizationId: member.organizationId
      }
    })

    if (!existingRole) {
      return NextResponse.json({ error: "Rol no encontrado" }, { status: 404 })
    }

    await prisma.customRole.delete({
      where: { id }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting custom role:", error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}
