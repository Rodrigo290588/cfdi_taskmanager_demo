import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { decryptInvoiceXmlContent } from '@/lib/invoice-xml-storage'
import { buildDashboardScopedContext, dashboardJsonErrorResponse } from '@/lib/dashboard-fiscal-route-utils'
import { SECURITY_HEADERS } from '@/lib/org-dashboard-helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const DRILLDOWN_BATCH_SIZE = 500

function resolveInvoiceXmlFromBlob(blob: {
  xmlCiphertext: string
  xmlIv: string
  xmlAuthTag: string
  xmlEncryptionAlg: string
} | null | undefined) {
  if (!blob) {
    return ''
  }

  try {
    return decryptInvoiceXmlContent({
      ciphertext: blob.xmlCiphertext,
      iv: blob.xmlIv,
      authTag: blob.xmlAuthTag,
      algorithm: blob.xmlEncryptionAlg
    })
  } catch {
    return ''
  }
}

function isGlobalPublicInvoice(xmlContent: string) {
  return /InformacionGlobal/i.test(xmlContent)
}

export async function GET(request: NextRequest) {
  try {
    const { ctx, searchParams, systemRole: _sr } = await buildDashboardScopedContext(request, { routeKey: 'drilldown', requireCompanyId: true })
    void _sr

    const companyId = searchParams.get('companyId')!
    const startDateParam = searchParams.get('startDate')
    const endDateParam = searchParams.get('endDate')
    const originParam = searchParams.get('origin') || 'issued'

    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { rfc: true } })
    if (!company?.rfc) return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404, headers: SECURITY_HEADERS })

    const rfc = company.rfc
    const fiscalEntity = await prisma.fiscalEntity.findFirst({ where: { rfc, organizationId: ctx.organizationId } })
    if (!fiscalEntity) return NextResponse.json({ data: [] }, { headers: SECURITY_HEADERS })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dateFilter: any = {}
    if (startDateParam && endDateParam) {
      const end = new Date(endDateParam)
      end.setHours(23, 59, 59, 999)
      dateFilter.issuanceDate = { gte: new Date(startDateParam), lte: end }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let baseWhere: any
    if (originParam === 'received') {
      baseWhere = { receiverRfc: rfc, ...dateFilter }
    } else if (originParam === 'both') {
      baseWhere = { OR: [{ issuerRfc: rfc }, { receiverRfc: rfc }], ...dateFilter }
    } else {
      baseWhere = { issuerFiscalEntityId: fiscalEntity.id, issuerRfc: rfc, ...dateFilter }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const drilldownData: any[] = []
    let cursor: string | undefined

    do {
      const invoices = await prisma.invoice.findMany({
        where: {
          ...baseWhere,
          cfdiType: 'INGRESO',
          satStatus: 'VIGENTE',
          receiverRfc: 'XAXX010101000'
        },
        orderBy: { id: 'asc' },
        take: DRILLDOWN_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          uuid: true,
          folio: true,
          series: true,
          issuanceDate: true,
          issuerRfc: true,
          receiverRfc: true,
          issuerName: true,
          receiverName: true,
          currency: true,
          exchangeRate: true,
          subtotal: true,
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

      if (invoices.length === 0) {
        break
      }

      invoices.forEach(inv => {
        const xmlContent = resolveInvoiceXmlFromBlob(inv.blob)
        if (!isGlobalPublicInvoice(xmlContent)) {
          return
        }

        const isIssuer = originParam === 'issued' || inv.issuerRfc === rfc
        const rfcOponente = isIssuer ? inv.receiverRfc : inv.issuerRfc
        const nombreOponente = isIssuer ? inv.receiverName : inv.issuerName

        drilldownData.push({
          uuid: inv.uuid,
          uuidRelacionado: '',
          tipo: 'Ingreso Global',
          fecha: inv.issuanceDate,
          serie: inv.series || '',
          folio: inv.folio || '',
          rfc: rfcOponente,
          razonSocial: nombreOponente || 'Desconocido',
          moneda: inv.currency || 'MXN',
          tipoCambio: Number(inv.exchangeRate) || 1,
          importe: Number(inv.subtotal) || 0
        })
      })

      cursor = invoices[invoices.length - 1]?.id
    } while (cursor)

    drilldownData.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())

    return NextResponse.json({ data: drilldownData }, { headers: SECURITY_HEADERS })

  } catch (error) {
    return dashboardJsonErrorResponse(error)
  }
}
