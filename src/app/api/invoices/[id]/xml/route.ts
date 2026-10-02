import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { decryptInvoiceXmlContent } from '@/lib/invoice-xml-storage'
import { hasPermission, Permission } from '@/lib/permissions'
import { MemberRole, SystemRole, CfdiType } from '@prisma/client'

const _MEMBER_ROLE_ORDER: Record<MemberRole, number> = { VIEWER: 0, AUDITOR: 1, ADMIN: 2 } as const
function _rank(role?: MemberRole | null): number { return role ? _MEMBER_ROLE_ORDER[role] ?? 0 : 0 }
function _isViewerTier(role: MemberRole | null, systemRole: SystemRole | null): boolean {
  if (systemRole === SystemRole.SUPER_ADMIN || systemRole === SystemRole.ADMIN) return false
  return _rank(role) <= _rank(MemberRole.VIEWER)
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params
    const session = await auth()
    if (!session?.user?.id) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    const invoice = await prisma.invoice.findUnique({
      where: { id },
      select: {
        xmlContent: true,
        cfdiType: true,
        issuerFiscalEntityId: true
      }
    })

    if (!invoice) {
      return new NextResponse('Invoice not found', { status: 404 })
    }

    const fiscalEntity = await prisma.fiscalEntity.findUnique({
      where: { id: invoice.issuerFiscalEntityId },
      select: { organizationId: true }
    })

    if (!fiscalEntity) {
      return new NextResponse('Fiscal entity not found', { status: 404 })
    }

    const orgId = fiscalEntity.organizationId

    const member = await prisma.member.findFirst({
      where: { userId: session.user.id, organizationId: orgId, status: 'APPROVED' },
      select: { role: true }
    })

    if (!member) {
      return new NextResponse('Forbidden', { status: 403 })
    }

    const userContext = {
      id: session.user.id,
      systemRole: (session.user.systemRole ?? 'USER') as SystemRole,
      memberships: [{ organizationId: orgId, role: member.role as MemberRole }]
    }

    const isNominaQuery = invoice.cfdiType === CfdiType.NOMINA
    const canViewSalaries = hasPermission(userContext, Permission.NOMINA_VIEW_SALARIES, orgId)
    if (isNominaQuery && !canViewSalaries) {
      return new NextResponse('Permiso NOMINA_VIEW_SALARIES requerido', { status: 403 })
    }

    const viewerMaskMode = _isViewerTier(member.role, (session.user.systemRole ?? null) as unknown as SystemRole) && isNominaQuery
    if (viewerMaskMode) {
      return new NextResponse('El XML de nómina no está disponible para visualizadores debido a datos sensibles', { status: 403 })
    }

    let xml = invoice.xmlContent
    if (!xml) {
      const blobRow = await prisma.invoice.findUnique({
        where: { id },
        select: {
          blob: {
            select: {
              xmlCiphertext: true,
              xmlIv: true,
              xmlAuthTag: true,
              xmlEncryptionAlg: true
            }
          }
        }
      })
      if (blobRow?.blob) {
        xml = decryptInvoiceXmlContent({
          ciphertext: blobRow.blob.xmlCiphertext,
          iv: blobRow.blob.xmlIv,
          authTag: blobRow.blob.xmlAuthTag,
          algorithm: blobRow.blob.xmlEncryptionAlg
        })
      }
    }

    if (!xml) {
      return new NextResponse('XML content missing', { status: 404 })
    }

    return new NextResponse(xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml',
        'Content-Disposition': `attachment; filename="cfdi_${id}.xml"`
      }
    })
  } catch (error) {
    console.error('Error fetching XML:', error)
    return new NextResponse('Internal Server Error', { status: 500 })
  }
}
