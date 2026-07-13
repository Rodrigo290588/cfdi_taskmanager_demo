import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { generateCfdiPdfFromXml } from '@/lib/cfdi-pdf'
import { resolveProviderContext } from '@/lib/provider-context'
import { getStoredProviderXmlRecordById } from '@/lib/provider-cfdi-storage'

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
    const orgId = request.nextUrl.searchParams.get('orgId')
    if (!recordId) {
      return NextResponse.json({ error: 'No se recibió el identificador del CFDI' }, { status: 400 })
    }

    const context = await resolveProviderContext(session.user.id, orgId)
    if (!context) {
      return NextResponse.json({ error: 'No se encontró la membresía del proveedor' }, { status: 404 })
    }

    const storedRecord = await getStoredProviderXmlRecordById({
      recordId,
      context
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
    console.error('Error generating provider CFDI PDF:', error)
    return NextResponse.json({ error: 'Error interno al generar el PDF' }, { status: 500 })
  }
}
