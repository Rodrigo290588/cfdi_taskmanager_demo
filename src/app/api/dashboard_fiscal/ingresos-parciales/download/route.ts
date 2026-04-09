
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import JSZip from 'jszip'
import { DOMParser } from '@xmldom/xmldom'

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const uuid = searchParams.get('uuid')

    if (!uuid) {
      return NextResponse.json({ error: 'UUID requerido' }, { status: 400 })
    }

    // 1. Fetch PPD Invoice
    const invoice = await prisma.invoice.findUnique({
      where: { uuid },
      select: {
        uuid: true,
        series: true,
        folio: true,
        xmlContent: true,
      }
    })

    if (!invoice) {
      return NextResponse.json({ error: 'Factura no encontrada' }, { status: 404 })
    }

    // 2. Fetch Related Payments
    const relatedCfdis = await prisma.invoiceRelatedCfdi.findMany({
      where: {
        relatedUuid: uuid,
        invoice: {
          cfdiType: 'PAGO',
          satStatus: 'VIGENTE'
        }
      },
      include: {
        invoice: {
          select: {
            uuid: true,
            series: true,
            folio: true,
            xmlContent: true
          }
        }
      }
    })

    // 3. Create ZIP
    const zip = new JSZip()
    const parser = new DOMParser()

    // Add Invoice XML
    // Nomenclature: UUID + Serie + Folio + Ingreso.xml
    const sanitizeName = (name: string) => name.replace(/_+/g, '_').replace(/^_|_$/g, '')
    const invName = sanitizeName(`${invoice.uuid}_${invoice.series || ''}_${invoice.folio || ''}_Ingreso.xml`)
    zip.file(invName, invoice.xmlContent)

    // Add Payment XMLs
    // Nomenclature: UUID +_+Serie+_+Folio+_+Num de Parcialidad+_+Pago.xml
    for (const rel of relatedCfdis) {
      const payment = rel.invoice
      if (!payment.xmlContent) continue

      let numParcialidad = '1' // Default
      
      try {
        const doc = parser.parseFromString(payment.xmlContent, 'text/xml')
        // Find DoctoRelacionado for this PPD UUID
        // We need to look inside all Pago elements
        const pagos = Array.from(doc.getElementsByTagName('*')).filter(el => {
          if (!el.nodeName.endsWith(':Pago')) return false
          let curr = el.parentNode
          while(curr) {
            if (curr.nodeName && curr.nodeName.endsWith(':Addenda')) return false
            curr = curr.parentNode
          }
          return true
        })
        
        for (const pago of pagos) {
          const doctos = Array.from(pago.getElementsByTagName('*')).filter(el => 
            el.nodeName.endsWith(':DoctoRelacionado') && 
            el.getAttribute('IdDocumento')?.toLowerCase() === uuid.toLowerCase()
          )
          
          if (doctos.length > 0) {
            const val = doctos[0].getAttribute('NumParcialidad')
            if (val) numParcialidad = val
            break // Found the relation
          }
        }
      } catch (e) {
        console.error('Error parsing payment XML for partiality', payment.uuid, e)
      }

      const payName = sanitizeName(`${payment.uuid}_${payment.series || ''}_${payment.folio || ''}_${numParcialidad}_Pago.xml`)
      zip.file(payName, payment.xmlContent)
    }

    const content = await zip.generateAsync({ type: 'uint8array' })
    
    // Convert to Blob to satisfy BodyInit type
    // Next.js response works better with array buffer
    return new NextResponse(Buffer.from(content), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="factura_${invoice.folio || 'docs'}.zip"`
      }
    })

  } catch (error) {
    console.error('Error generating ZIP:', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
