import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { z } from 'zod'
import {
  createCustomRoleSchema,
  SYSTEM_ROLE_IDS,
  type SystemRoleId,
  getSystemRoleOverrideForOrg,
  saveSystemRoleOverrideForOrg,
  buildSystemRoleDefaults
} from '@/lib/admin-roles'

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }

    // [SAST-FIX #5] Exigir status=APPROVED para todas las guardias de roles.
    const member = await prisma.member.findFirst({
      where: { userId: session.user.id, status: 'APPROVED' },
      include: { organization: true }
    })

    const isOwner = member?.organization?.ownerId === session.user.id
    if (!member || (member.role !== "ADMIN" && !isOwner)) {
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 })
    }

    const customRoles = await prisma.customRole.findMany({
      where: { organizationId: member.organizationId },
      orderBy: { createdAt: 'desc' }
    })

    // Roles por defecto del sistema (ahora con override por organización si existe)
    const systemRoles = await Promise.all(
      (SYSTEM_ROLE_IDS as readonly SystemRoleId[]).map(async roleId => {
        const base = buildSystemRoleDefaults(roleId)
        const overr = await getSystemRoleOverrideForOrg(member.organizationId, roleId)
        return {
          id: base.id,
          name: base.name,
          description: base.description,
          isSystemRole: true as const,
          canViewEmission: overr.canViewEmission,
          canViewReception: overr.canViewReception,
          canViewPayroll: overr.canViewPayroll,
          canViewSatPortal: overr.canViewSatPortal,
          canViewMassDownloads: overr.canViewMassDownloads,
          canManageOrg: overr.canManageOrg,
          granularPermissions: overr.granularPermissions
        }
      })
    )

    const roles = [...systemRoles, ...customRoles.map(r => ({ ...r, isSystemRole: false as const }))]

    return NextResponse.json({ roles })
  } catch (error) {
    console.error("Error fetching custom roles:", error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }

    // [SAST-FIX #5] Exigir status=APPROVED y permitir OWNER además de ADMIN
    //              (el owner de la organización NO tiene role=ADMIN).
    const member = await prisma.member.findFirst({
      where: { userId: session.user.id, status: 'APPROVED' },
      include: { organization: true }
    })

    const isOwner = member?.organization?.ownerId === session.user.id
    if (!member || (member.role !== "ADMIN" && !isOwner)) {
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 })
    }

    // [SAST-FIX #3] Validar body con Zod strict. No más spread inseguro.
    const rawBody = await req.json()
    const targetId = typeof rawBody === 'object' && rawBody && 'id' in rawBody ? String((rawBody as { id?: unknown }).id ?? '') : ''

    // Si el usuario intenta guardar un System Role (ADMIN, AUDITOR, VIEWER) -> guardar override por organización
    if (SYSTEM_ROLE_IDS.includes(targetId as SystemRoleId)) {
      const body = createCustomRoleSchema.parse(rawBody)
      const { permissions, granularPermissions } = body

      await saveSystemRoleOverrideForOrg(member.organizationId, targetId as SystemRoleId, {
        canViewEmission: !!permissions.canViewEmission,
        canViewReception: !!permissions.canViewReception,
        canViewPayroll: !!permissions.canViewPayroll,
        canViewSatPortal: !!permissions.canViewSatPortal,
        canViewMassDownloads: !!permissions.canViewMassDownloads,
        canManageOrg: !!permissions.canManageOrg,
        granularPermissions: Object.fromEntries(
          Object.entries(granularPermissions || {}).filter(([, v]) => typeof v === 'boolean')
        ) as Record<string, boolean>
      })

      const overr = await getSystemRoleOverrideForOrg(member.organizationId, targetId as SystemRoleId)
      const base = buildSystemRoleDefaults(targetId as SystemRoleId)

      return NextResponse.json({
        role: {
          id: targetId,
          name: body.name || base.name,
          description: body.description || base.description,
          isSystemRole: true,
          canViewEmission: overr.canViewEmission,
          canViewReception: overr.canViewReception,
          canViewPayroll: overr.canViewPayroll,
          canViewSatPortal: overr.canViewSatPortal,
          canViewMassDownloads: overr.canViewMassDownloads,
          canManageOrg: overr.canManageOrg,
          granularPermissions: overr.granularPermissions
        }
      })
    }

    const body = createCustomRoleSchema.parse(rawBody)
    const { name, description, permissions, granularPermissions } = body

    const existingRole = await prisma.customRole.findFirst({
      where: {
        organizationId: member.organizationId,
        name
      }
    })

    if (existingRole) {
      return NextResponse.json({ error: "Ya existe un rol con este nombre" }, { status: 400 })
    }

    const newRole = await prisma.customRole.create({
      data: {
        organizationId: member.organizationId,
        name,
        description,
        canViewEmission: permissions.canViewEmission,
        canViewReception: permissions.canViewReception,
        canViewPayroll: permissions.canViewPayroll,
        canViewSatPortal: permissions.canViewSatPortal,
        canViewMassDownloads: permissions.canViewMassDownloads,
        canManageOrg: permissions.canManageOrg,
        granularPermissions
      }
    })

    return NextResponse.json({ role: newRole })
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
    console.error("Error creating custom role:", error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}
