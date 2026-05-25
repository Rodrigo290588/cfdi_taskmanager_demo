import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { id: membershipId } = await context.params
    const body = await request.json()
    const { roleId, companyIds } = body

    if (!roleId) {
      return NextResponse.json({ error: 'Faltan datos requeridos' }, { status: 400 })
    }

    // Verify permission
    const adminMembership = await prisma.member.findFirst({
      where: {
        userId: session.user.id,
        status: 'APPROVED'
      },
      include: { organization: true }
    })

    if (!adminMembership || (adminMembership.organization.ownerId !== session.user.id && adminMembership.role !== 'ADMIN')) {
      return NextResponse.json({ error: 'No tienes permisos para realizar esta acción' }, { status: 403 })
    }

    // Ensure we are modifying a member of the same organization
    const targetMember = await prisma.member.findUnique({
      where: { id: membershipId }
    })

    if (!targetMember || targetMember.organizationId !== adminMembership.organizationId) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
    }

    // Prevent modifying the owner's role
    if (targetMember.userId === adminMembership.organization.ownerId) {
      return NextResponse.json({ error: 'No puedes modificar al dueño de la organización' }, { status: 403 })
    }

    const isSystemRole = ['ADMIN', 'AUDITOR', 'VIEWER'].includes(roleId)
    const systemRole = isSystemRole ? roleId as 'ADMIN' | 'AUDITOR' | 'VIEWER' : 'VIEWER'
    const customRoleId = isSystemRole ? null : roleId

    await prisma.$transaction(async (tx) => {
      // Update global role
      await tx.member.update({
        where: { id: membershipId },
        data: {
          role: systemRole,
          customRoleId: customRoleId
        }
      })

      // Get existing company accesses
      const existingAccesses = await tx.companyAccess.findMany({
        where: { memberId: membershipId }
      })
      const existingCompanyIds = existingAccesses.map(a => a.companyId)

      // Companies to add
      const companiesToAdd = (companyIds || []).filter((id: string) => !existingCompanyIds.includes(id))
      // Companies to remove
      const companiesToRemove = existingCompanyIds.filter(id => !(companyIds || []).includes(id))

      if (companiesToRemove.length > 0) {
        await tx.companyAccess.deleteMany({
          where: {
            memberId: membershipId,
            companyId: { in: companiesToRemove }
          }
        })
      }

      // UPDATE existing companies to match the new global role
      const companiesToKeep = existingCompanyIds.filter(id => !companiesToRemove.includes(id))
      if (companiesToKeep.length > 0) {
        await tx.companyAccess.updateMany({
          where: { 
            memberId: membershipId,
            companyId: { in: companiesToKeep }
          },
          data: {
            role: systemRole,
            customRoleId: customRoleId
          }
        })
      }

      if (companiesToAdd.length > 0) {
        await tx.companyAccess.createMany({
          data: companiesToAdd.map((companyId: string) => ({
            companyId,
            memberId: membershipId,
            organizationId: adminMembership.organizationId,
            role: systemRole,
            customRoleId: customRoleId
          }))
        })
      }
    })

    return NextResponse.json({ success: true, message: 'Usuario actualizado correctamente' })

  } catch (error) {
    console.error('Update user error:', error)
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { id: membershipId } = await context.params

    // Verify permission
    const adminMembership = await prisma.member.findFirst({
      where: {
        userId: session.user.id,
        status: 'APPROVED'
      },
      include: { organization: true }
    })

    if (!adminMembership || (adminMembership.organization.ownerId !== session.user.id && adminMembership.role !== 'ADMIN')) {
      return NextResponse.json({ error: 'No tienes permisos para realizar esta acción' }, { status: 403 })
    }

    // Ensure we are modifying a member of the same organization
    const targetMember = await prisma.member.findUnique({
      where: { id: membershipId }
    })

    if (!targetMember || targetMember.organizationId !== adminMembership.organizationId) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
    }

    // Prevent deleting the owner
    if (targetMember.userId === adminMembership.organization.ownerId) {
      return NextResponse.json({ error: 'No puedes eliminar al dueño de la organización' }, { status: 403 })
    }

    // Prevent self-deletion (they should use a different flow if they want to leave)
    if (targetMember.userId === session.user.id) {
      return NextResponse.json({ error: 'No puedes eliminar tu propia cuenta desde aquí' }, { status: 403 })
    }

    await prisma.$transaction(async (tx) => {
      // 1. Delete all company accesses for this user in this org
      await tx.companyAccess.deleteMany({
        where: { memberId: membershipId }
      })

      // 2. Delete the membership
      await tx.member.delete({
        where: { id: membershipId }
      })

      // 3. Deep cleanup: If the user has no other memberships and doesn't own any org,
      // we can safely delete their entire User record to not leave orphans.
      const otherMembershipsCount = await tx.member.count({
        where: { userId: targetMember.userId }
      })
      
      const ownedOrgsCount = await tx.organization.count({
        where: { ownerId: targetMember.userId }
      })

      if (otherMembershipsCount === 0 && ownedOrgsCount === 0) {
        // We DO NOT delete Invoices or SatInvoices to preserve historical business data.
        // The schema uses `onDelete: SetNull` for userId in Invoices/SatInvoices, 
        // so deleting the user will safely detach them, keeping the records intact.
        await tx.session.deleteMany({ where: { userId: targetMember.userId } })
        await tx.account.deleteMany({ where: { userId: targetMember.userId } })
        await tx.apiKey.deleteMany({ where: { userId: targetMember.userId } })
        await tx.auditLog.deleteMany({ where: { userId: targetMember.userId } })
        
        // Finally delete the user
        await tx.user.delete({
          where: { id: targetMember.userId }
        })
      }
    })

    return NextResponse.json({ success: true, message: 'Usuario eliminado correctamente' })

  } catch (error) {
    console.error('Delete user error:', error)
    return NextResponse.json(
      { error: 'Error interno del servidor al eliminar usuario' },
      { status: 500 }
    )
  }
}
