import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    const { id } = await params
    const body = await req.json()
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

    const updatedRole = await prisma.customRole.update({
      where: { id },
      data: {
        name,
        description,
        ...permissions,
        granularPermissions: granularPermissions || {}
      }
    })

    return NextResponse.json({ role: updatedRole })
  } catch (error) {
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

    const member = await prisma.member.findFirst({
      where: { userId: session.user.id }
    })

    if (!member || member.role !== "ADMIN") {
      return NextResponse.json({ error: "Acceso denegado" }, { status: 403 })
    }

    const { id } = await params

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
