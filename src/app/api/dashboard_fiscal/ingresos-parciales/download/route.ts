import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  buildDashboardScopedContext,
  dashboardJsonErrorResponse,
  sanitizeDownloadFilename,
  buildRfc5987ContentDisposition
} from '@/lib/dashboard-fiscal-route-utils'
import JSZip from 'jszip'
import { DOMParser } from '@xmldom/xmldom'
import { SECURITY_HEADERS } from '@/lib/org-dashboard-helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

// @xmldom/xmldom Options shape en su type publico expone únicamente { locator / errorHandler.
// Runtime sí acepta opciones legacy (disableEntities / xmlMode / etc.), así que las casteamos
// para preservar la defensa XXE:
const _SAFE_DOM_PARSER_OPTS = {
  disableEntities: true,
  xmlMode: true,
  errorHandler: {
    warning() {},
    error() {},
    fatalError() {},
  },
} as unknown as ConstructorParameters<typeof DOMParser>[0]
function makeSafeDomParser() { return new DOMParser(_SAFE_DOM_PARSER_OPTS) as DOMParser }

export async function GET(req: NextRequest) {
  try {
    const { ctx, searchParams, systemRole: _sr } = await buildDashboardScopedContext(req, { routeKey: 'partialDownload', requireCompanyId: true })
    void _sr
    const uuid = searchParams.get('uuid')

    if (!uuid) {
      return NextResponse.json({ error: 'UUID requerido' }, { status: 400, headers: SECURITY_HEADERS })
    }

    // Scope helper: resolviendo FiscalEntity para evitar usos de issuerFiscalEntity relation
    // en el where de Prisma Invoice (esa columna NO existe en el esquema; la FK correcta es
    // issuerFiscalEntityId).
    const companyId = searchParams.get('companyId')
    const feWhere = ctx.fiscalEntityId
      ? { feId: ctx.fiscalEntityId }
      : (() => {
          throw new Error('No se pudo resolver el contexto de entidad fiscal')
        })()
    void companyId

    // 1. Fetch PPD Invoice — scope estricto por organización (DASHBOARD-003 · BOLA cross-tenant bypass)
    //    Si no pertenece a esta org, se devuelve 404 idéntico al caso no-existe (no enumeración).
    const invoice = await prisma.invoice.findFirst({
      where: {
        uuid,
        issuerFiscalEntityId: feWhere.feId,
      },
      select: {
        uuid: true,
        series: true,
        folio: true,
        xmlContent: true,
        issuerFiscalEntityId: true,
      }
    })

    if (!invoice) {
      return NextResponse.json({ error: 'Factura no encontrada' }, { status: 404, headers: SECURITY_HEADERS })
    }

    // 2. Fetch Related Payments — mismo scope org + invoice CFDI PAGO vigente
    //    NOTA: Para mantener BOLA defense scope organizationId se usa el campo
    //    issuerFiscalEntityId sobre la invoice target, comparándolo contra los
    //    issuerFiscalEntityId permitidos del contexto organizacional. Como fallback
    //    seguro cruzamos la invoice real contra feWhere posteriormente.
    const relatedCfdisRaw = await prisma.invoiceRelatedCfdi.findMany({
      where: {
        relatedUuid: uuid,
      },
      select: {
        id: true,
        createdAt: true,
        invoiceId: true,
        relationType: true,
        relatedUuid: true,
      },
    })
    const relatedCfdis = await Promise.all(
      relatedCfdisRaw.map(async rel => {
        const paymentInvoice = await prisma.invoice.findFirst({
          where: {
            id: rel.invoiceId,
            cfdiType: 'PAGO',
            satStatus: 'VIGENTE',
            issuerFiscalEntityId: feWhere.feId,
          },
          select: {
            uuid: true,
            series: true,
            folio: true,
            xmlContent: true,
          },
        })
        return {
          ...rel,
          invoice: paymentInvoice,
        } as typeof rel & { invoice: typeof paymentInvoice }
      })
    ).then(list =>
      list.filter(row => row.invoice) as unknown as Array<(typeof relatedCfdisRaw)[number] & {
        invoice: { uuid: string; series: string | null; folio: string | null; xmlContent: string | null }
      }>
    )

    // 3. Create ZIP
    const zip = new JSZip()
    const parser = makeSafeDomParser()

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
    
    const unsafeZipName = `factura_${invoice.folio || 'docs'}`
    const sanitizedZipName = sanitizeDownloadFilename(unsafeZipName, 'descarga_ppd', '.zip')
    const contentDisposition = buildRfc5987ContentDisposition(sanitizedZipName, 'attachment')

    // Convert to Blob to satisfy BodyInit type
    // Next.js response works better with array buffer
    return new NextResponse(Buffer.from(content), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': contentDisposition
      }
    })

  } catch (error) {
    return dashboardJsonErrorResponse(error)
  }
}
