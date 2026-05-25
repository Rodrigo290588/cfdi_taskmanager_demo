import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    
    if (!session?.user) {
      return NextResponse.json(
        { error: 'No autorizado' },
        { status: 401 }
      )
    }

    const { id: membershipId } = await context.params

    // Get user's organization to verify permissions
    const ownerMembership = await prisma.member.findFirst({
      where: {
        userId: session.user.id,
        status: { equals: 'APPROVED' }
      },
      include: {
        organization: true
      }
    })

    if (!ownerMembership) {
      return NextResponse.json(
        { error: 'No perteneces a ninguna organización' },
        { status: 404 }
      )
    }

    // Only organization owner can delete invitations
    if (ownerMembership.organization.ownerId !== session.user.id) {
      return NextResponse.json(
        { error: 'No tienes permisos para eliminar invitaciones' },
        { status: 403 }
      )
    }

    // Find the invitation to delete
    const invitationToDelete = await prisma.member.findUnique({
      where: { id: membershipId },
      include: { user: true }
    })

    if (!invitationToDelete) {
      return NextResponse.json(
        { error: 'Invitación no encontrada' },
        { status: 404 }
      )
    }

    // Verify the invitation belongs to the owner's organization
    if (invitationToDelete.organizationId !== ownerMembership.organizationId) {
      return NextResponse.json(
        { error: 'No puedes eliminar una invitación de otra organización' },
        { status: 403 }
      )
    }

    // We can only delete PENDING or ONBOARDING invitations
    if (invitationToDelete.status !== 'PENDING' && invitationToDelete.status !== 'ONBOARDING') {
      return NextResponse.json(
        { error: 'Solo se pueden eliminar invitaciones pendientes' },
        { status: 400 }
      )
    }

    const userId = invitationToDelete.userId

    // Begin a transaction to ensure atomic deletion
    await prisma.$transaction(async (tx) => {
      // Check if the user has any other memberships (in other organizations)
      const otherMemberships = await tx.member.count({
        where: { userId: userId, id: { not: membershipId } }
      })

      // Check if the user is the owner of any organization
      const ownedOrganizations = await tx.organization.count({
        where: { ownerId: userId }
      })

      if (otherMemberships === 0 && ownedOrganizations === 0) {
        // Find if this user has any active company access
        await tx.companyAccess.deleteMany({
          where: { memberId: membershipId }
        })

        // Delete the membership first
        await tx.member.delete({
          where: { id: membershipId }
        })

        // Also delete any sessions, accounts, or api keys associated with this user if they exist
        await tx.session.deleteMany({ where: { userId: userId } })
        await tx.account.deleteMany({ where: { userId: userId } })
        await tx.apiKey.deleteMany({ where: { userId: userId } })
        
        // Also delete any invoices, satInvoices, or audit logs if they somehow exist for this ghost user
        await tx.invoice.deleteMany({ where: { userId: userId } })
        await tx.satInvoice.deleteMany({ where: { userId: userId } })
        await tx.auditLog.deleteMany({ where: { userId: userId } })

        // Finally, delete the user
        await tx.user.delete({
          where: { id: userId }
        })
      } else {
        // If they have other memberships, just delete this specific invitation
        // Delete company accesses linked to this membership first to avoid foreign key constraints
        await tx.companyAccess.deleteMany({
          where: { memberId: membershipId }
        })

        await tx.member.delete({
          where: { id: membershipId }
        })
      }
    })

    return NextResponse.json({
      success: true,
      message: 'Invitación eliminada exitosamente'
    })

  } catch (error) {
    console.error('Delete invitation error:', error)
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
}
