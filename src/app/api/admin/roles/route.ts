import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }

    const member = await prisma.member.findFirst({
      where: { userId: session.user.id },
      include: { organization: true }
    })

    if (!member || member.role !== "ADMIN") {
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 })
    }

    const customRoles = await prisma.customRole.findMany({
      where: { organizationId: member.organizationId },
      orderBy: { createdAt: 'desc' }
    })

    // Roles por defecto del sistema
    const systemRoles = [
      {
        id: 'ADMIN',
        name: 'Administrador',
        description: 'Acceso total a todas las funcionalidades del sistema.',
        isSystemRole: true,
        canViewEmission: true,
        canViewReception: true,
        canViewPayroll: true,
        canViewSatPortal: true,
        canViewMassDownloads: true,
        canManageOrg: true,
        granularPermissions: {
          emissionDashboard: true,
          emissionWorkpaper: true,
          emissionPartial: true,
          emissionCancelations: true,
          receptionDashboard: true,
          receptionWorkpaper: true,
          payrollDashboard: true,
          payrollReceipts: true,
          satConnection: true,
          satCfdiStatus: true,
          massKeys: true,
          massRequests: true,
          massVerification: true,
          massPackages: true,
          massPanel: true,
          orgCompanies: true,
          orgUsers: true,
          orgProfiles: true,
          orgRoles: true,
          orgSettings: true
        }
      },
      {
        id: 'AUDITOR',
        name: 'Auditor',
        description: 'Acceso de solo lectura para auditoría y revisión.',
        isSystemRole: true,
        canViewEmission: true,
        canViewReception: true,
        canViewPayroll: true,
        canViewSatPortal: true,
        canViewMassDownloads: true,
        canManageOrg: false,
        granularPermissions: {
          emissionDashboard: true,
          emissionWorkpaper: true,
          emissionPartial: true,
          emissionCancelations: true,
          receptionDashboard: true,
          receptionWorkpaper: true,
          payrollDashboard: true,
          payrollReceipts: true,
          satConnection: true,
          satCfdiStatus: true,
          massKeys: false, // Auditores generalmente no configuran llaves
          massRequests: true,
          massVerification: true,
          massPackages: true,
          massPanel: true,
          orgCompanies: false,
          orgUsers: false,
          orgProfiles: false,
          orgRoles: false,
          orgSettings: false
        }
      },
      {
        id: 'VIEWER',
        name: 'Visualizador',
        description: 'Acceso básico de solo lectura a los dashboards.',
        isSystemRole: true,
        canViewEmission: true,
        canViewReception: true,
        canViewPayroll: true,
        canViewSatPortal: true,
        canViewMassDownloads: true,
        canManageOrg: false,
        granularPermissions: {
          emissionDashboard: true,
          emissionWorkpaper: false,
          emissionPartial: false,
          emissionCancelations: false,
          receptionDashboard: true,
          receptionWorkpaper: false,
          payrollDashboard: true,
          payrollReceipts: false,
          satConnection: true,
          satCfdiStatus: true,
          massKeys: false,
          massRequests: false,
          massVerification: false,
          massPackages: false,
          massPanel: false,
          orgCompanies: false,
          orgUsers: false,
          orgProfiles: false,
          orgRoles: false,
          orgSettings: false
        }
      }
    ]

    const roles = [...systemRoles, ...customRoles.map(r => ({ ...r, isSystemRole: false }))]

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

    const member = await prisma.member.findFirst({
      where: { userId: session.user.id }
    })

    if (!member || member.role !== "ADMIN") {
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 })
    }

    const body = await req.json()
    const { name, description, permissions, granularPermissions } = body

    if (!name) {
      return NextResponse.json({ error: "El nombre es requerido" }, { status: 400 })
    }

    const existingRole = await prisma.customRole.findFirst({
      where: {
        organizationId: member.organizationId,
        name: name
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
        ...permissions,
        granularPermissions: granularPermissions || {}
      }
    })

    return NextResponse.json({ role: newRole })
  } catch (error) {
    console.error("Error creating custom role:", error)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}
