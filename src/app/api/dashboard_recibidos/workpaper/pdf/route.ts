import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { generateCfdiPdfFromXml } from '@/lib/cfdi-pdf'
import { getStoredProviderXmlRecordForCompany } from '@/lib/provider-cfdi-storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

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

    const { pdfBuffer, uuid: resolvedUuid } = await generateCfdiPdfFromXml({
      xmlRaw: storedRecord.xmlContent,
      invoiceIdForFallback: storedRecord.uuid,
      isCancelled: storedRecord.satEstado === 'CANCELADO'
    })

    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="cfdi_${resolvedUuid}.pdf"`
      }
    })
  } catch (error) {
    console.error('Error generating dashboard_recibidos workpaper PDF:', error)
    return NextResponse.json({ error: 'Error interno al generar el PDF' }, { status: 500 })
  }
}
