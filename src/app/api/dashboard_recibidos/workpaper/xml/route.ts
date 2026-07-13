import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getStoredProviderXmlRecordForCompany } from '@/lib/provider-cfdi-storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const recordId = request.nextUrl.searchParams.get('id')
    const companyId = request.nextUrl.searchParams.get('companyId')

    if (!recordId || !companyId) {
      return NextResponse.json({ error: 'Parámetros incompletos' }, { status: 400 })
    }

    const member = await prisma.member.findFirst({
      where: { userId: session.user.id, status: 'APPROVED' }
    })
    if (!member) {
      return NextResponse.json({ error: 'Membresía no encontrada' }, { status: 404 })
    }

    const access = await prisma.companyAccess.findUnique({
      where: { memberId_companyId: { memberId: member.id, companyId } }
    })
    if (!access) {
      return NextResponse.json({ error: 'Sin acceso a la empresa' }, { status: 403 })
    }

    const storedRecord = await getStoredProviderXmlRecordForCompany({
      recordId,
      organizationId: member.organizationId,
      companyId
    })
    if (!storedRecord) {
      return NextResponse.json({ error: 'No se encontró el CFDI solicitado' }, { status: 404 })
    }

    return new NextResponse(storedRecord.xmlContent, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="cfdi_${storedRecord.uuid}.xml"`,
        'Cache-Control': 'private, no-store, max-age=0'
      }
    })
  } catch (error) {
    console.error('Error downloading dashboard_recibidos workpaper XML:', error)
    return NextResponse.json({ error: 'Error interno al descargar el XML' }, { status: 500 })
  }
}
