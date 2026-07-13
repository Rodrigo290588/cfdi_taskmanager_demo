import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'
import { prisma } from '@/lib/prisma'
import { generateCfdiPdfFromXml } from '@/lib/cfdi-pdf'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const fileParam = request.nextUrl.searchParams.get('file')
    let xmlRaw = ''
    let isCancelled = false
    if (fileParam) {
      const filePath =
        fileParam.includes(':\\') || fileParam.startsWith('/')
          ? fileParam
          : path.join(process.cwd(), 'java-client', 'xml-data', fileParam)
      xmlRaw = await readFile(filePath, 'utf8')
    } else {
      let invoice: { xmlContent: string, satStatus?: string | null } | null = await prisma.invoice.findUnique({
        where: { id },
        select: { xmlContent: true, satStatus: true }
      })

      if (!invoice) {
        invoice = await prisma.satInvoice.findUnique({
          where: { id },
          select: { xmlContent: true, satStatus: true }
        })
      }

      if (!invoice || !invoice.xmlContent) {
        return NextResponse.json({ error: 'Factura no encontrada o sin XML' }, { status: 404 })
      }
      xmlRaw = (invoice.xmlContent || '').trim()
      if (invoice.satStatus === 'CANCELADO') {
        isCancelled = true
      }
    }

    const { pdfBuffer, uuid } = await generateCfdiPdfFromXml({
      xmlRaw,
      invoiceIdForFallback: id,
      isCancelled
    })

    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="cfdi_${uuid}.pdf"`
      }
    })
  } catch (error) {
    console.error('Error generating PDF:', error)
    return NextResponse.json({ error: 'Error interno al generar el PDF' }, { status: 500 })
  }
}
