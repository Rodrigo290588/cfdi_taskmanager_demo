import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { CfdiType, Prisma } from '@prisma/client'
import { DOMParser } from '@xmldom/xmldom'
import { decryptInvoiceXmlContent } from '@/lib/invoice-xml-storage'
import { buildDashboardScopedContext, dashboardJsonErrorResponse } from '@/lib/dashboard-fiscal-route-utils'
import { SECURITY_HEADERS } from '@/lib/org-dashboard-helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const INVOICE_BATCH_SIZE = 500

const _SAFE_DOM_PARSER_OPTS = {
  disableEntities: true,
  xmlMode: true,
  errorHandler: { warning() {}, error() {}, fatalError() {} },
} as unknown as ConstructorParameters<typeof DOMParser>[0]
function makeSafeDomParser() { return new DOMParser(_SAFE_DOM_PARSER_OPTS) as DOMParser }

function normalizeUpperText(value: string | null | undefined) {
  return (value || '').trim().toUpperCase()
}

function getPagoBaseTotal(xmlContent: string) {
  const parser = makeSafeDomParser()

  try {
    const doc = parser.parseFromString(xmlContent, 'text/xml')
    const pagos = Array.from(doc.getElementsByTagName('*')).filter(el => el.nodeName.endsWith(':Pago'))
    let totalBaseP = 0

    pagos.forEach(pagoNode => {
      const impuestosP = Array.from(pagoNode.getElementsByTagName('*')).filter(el => el.nodeName.endsWith(':ImpuestosP'))
      impuestosP.forEach(impNode => {
        const trasladosP = Array.from(impNode.getElementsByTagName('*')).filter(el => el.nodeName.endsWith(':TrasladoP'))
        trasladosP.forEach(trasladoP => {
          const impuestoP = trasladoP.getAttribute('ImpuestoP')
          const baseP = parseFloat(trasladoP.getAttribute('BaseP') || '0')
          if (impuestoP === '002') {
            totalBaseP += baseP
          }
        })
      })
    })

    return totalBaseP
  } catch {
    return 0
  }
}

function toNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

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

function buildPaymentBaseByInvoiceUuid(details: Array<{
  paymentInvoiceUuid: string
  paymentNodeIndex: number
  baseP: Prisma.Decimal | number | null
}>) {
  const paymentBaseByNodeKey = new Map<string, number>()
  const paymentBaseByInvoiceUuid = new Map<string, number>()

  details.forEach(detail => {
    const key = normalizeUpperText(detail.paymentInvoiceUuid)
    const nodeKey = `${key}:${detail.paymentNodeIndex}`
    paymentBaseByNodeKey.set(nodeKey, Math.max(paymentBaseByNodeKey.get(nodeKey) || 0, toNumber(detail.baseP)))
  })

  paymentBaseByNodeKey.forEach((baseP, nodeKey) => {
    const separatorIndex = nodeKey.indexOf(':')
    const invoiceUuid = separatorIndex >= 0 ? nodeKey.slice(0, separatorIndex) : nodeKey
    paymentBaseByInvoiceUuid.set(invoiceUuid, (paymentBaseByInvoiceUuid.get(invoiceUuid) || 0) + baseP)
  })

  return paymentBaseByInvoiceUuid
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
    if (!company?.rfc) return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 })

    const rfc = company.rfc
    const fiscalEntity = await prisma.fiscalEntity.findFirst({ where: { rfc, organizationId: ctx.organizationId } })
    if (!fiscalEntity) return NextResponse.json({ data: [] })

    const dateFilter: Prisma.InvoiceWhereInput = {}
    if (startDateParam && endDateParam) {
      const end = new Date(endDateParam)
      end.setHours(23, 59, 59, 999)
      dateFilter.issuanceDate = { gte: new Date(startDateParam), lte: end }
    }

    let baseWhere: Prisma.InvoiceWhereInput
    if (originParam === 'received') {
      baseWhere = { receiverRfc: rfc, cfdiType: { in: [CfdiType.INGRESO, CfdiType.PAGO] }, ...dateFilter }
    } else if (originParam === 'both') {
      baseWhere = { OR: [{ issuerRfc: rfc }, { receiverRfc: rfc }], cfdiType: { in: [CfdiType.INGRESO, CfdiType.PAGO] }, ...dateFilter }
    } else {
      baseWhere = { issuerFiscalEntityId: fiscalEntity.id, issuerRfc: rfc, cfdiType: { in: [CfdiType.INGRESO, CfdiType.PAGO] }, ...dateFilter }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const drilldownData: any[] = []
    let cursor: string | undefined

    do {
      const batch = await prisma.invoice.findMany({
        where: { ...baseWhere, satStatus: 'VIGENTE' },
        orderBy: { id: 'asc' },
        take: INVOICE_BATCH_SIZE,
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
          cfdiType: true,
          paymentMethod: true,
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

      if (batch.length === 0) {
        break
      }

      const normalizedBatch = batch.map(inv => {
        const xmlContent = resolveInvoiceXmlFromBlob(inv.blob)
        return {
          ...inv,
          xmlContent
        }
      })

      const paymentInvoiceUuids = normalizedBatch
        .filter(inv => inv.cfdiType === 'PAGO')
        .map(inv => normalizeUpperText(inv.uuid))
        .filter(Boolean)

      const paymentDetails = paymentInvoiceUuids.length > 0
        ? await prisma.invoicePaymentComplementDetail.findMany({
            where: {
              paymentInvoiceUuid: { in: paymentInvoiceUuids },
              satStatusSnapshot: 'VIGENTE'
            },
            select: {
              paymentInvoiceUuid: true,
              paymentNodeIndex: true,
              relatedInvoiceUuid: true,
              baseP: true
            }
          })
        : []

      const relatedUuidsByPaymentUuid = new Map<string, string[]>()
      paymentDetails.forEach(detail => {
        const key = normalizeUpperText(detail.paymentInvoiceUuid)
        const current = relatedUuidsByPaymentUuid.get(key) || []
        const relatedUuid = normalizeUpperText(detail.relatedInvoiceUuid)
        if (relatedUuid && !current.includes(relatedUuid)) {
          current.push(relatedUuid)
        }
        relatedUuidsByPaymentUuid.set(key, current)
      })

      const paymentBaseByInvoiceUuid = buildPaymentBaseByInvoiceUuid(paymentDetails)

      normalizedBatch.forEach(inv => {
        const isIssuer = originParam === 'issued' || inv.issuerRfc === rfc
        const rfcOponente = isIssuer ? inv.receiverRfc : inv.issuerRfc
        const nombreOponente = isIssuer ? inv.receiverName : inv.issuerName

        if (inv.cfdiType === 'INGRESO' && inv.paymentMethod === 'PUE') {
          let subtotal = Number(inv.subtotal) || 0
          if (inv.currency && inv.currency !== 'MXN' && inv.exchangeRate) {
            subtotal = subtotal * Number(inv.exchangeRate)
          }

          drilldownData.push({
            uuid: inv.uuid,
            uuidRelacionado: '',
            tipo: 'Factura Contado (PUE)',
            fecha: inv.issuanceDate,
            serie: inv.series || '',
            folio: inv.folio || '',
            rfc: rfcOponente,
            razonSocial: nombreOponente || 'Desconocido',
            moneda: inv.currency || 'MXN',
            tipoCambio: Number(inv.exchangeRate) || 1,
            importe: subtotal
          })
        }

        if (inv.cfdiType === 'PAGO' && inv.xmlContent) {
          const totalBaseP = paymentBaseByInvoiceUuid.get(normalizeUpperText(inv.uuid)) || getPagoBaseTotal(inv.xmlContent)
          if (totalBaseP > 0) {
            const relatedUuidsFromTable = relatedUuidsByPaymentUuid.get(normalizeUpperText(inv.uuid)) || []
            let relatedUuids = relatedUuidsFromTable.join(', ')

            if (!relatedUuids) {
              try {
                const parser = makeSafeDomParser()
                const doc = parser.parseFromString(inv.xmlContent, 'text/xml')
                const pagos = Array.from(doc.getElementsByTagName('*')).filter(el => el.nodeName.endsWith(':Pago'))
                const relatedSet = new Set<string>()

                pagos.forEach(pagoNode => {
                  const doctos = Array.from(pagoNode.getElementsByTagName('*')).filter(el => el.nodeName.endsWith(':DoctoRelacionado'))
                  doctos.forEach(docto => {
                    const idDocumento = normalizeUpperText(docto.getAttribute('IdDocumento'))
                    if (idDocumento) {
                      relatedSet.add(idDocumento)
                    }
                  })
                })

                relatedUuids = Array.from(relatedSet).join(', ')
              } catch {
                relatedUuids = ''
              }
            }

            drilldownData.push({
              uuid: inv.uuid,
              uuidRelacionado: relatedUuids,
              tipo: 'Complemento de Pago (CRP)',
              fecha: inv.issuanceDate,
              serie: inv.series || '',
              folio: inv.folio || '',
              rfc: rfcOponente,
              razonSocial: nombreOponente || 'Desconocido',
              moneda: inv.currency || 'MXN',
              tipoCambio: Number(inv.exchangeRate) || 1,
              importe: totalBaseP
            })
          }
        }
      })

      cursor = batch[batch.length - 1]?.id
    } while (cursor)

    // Sort by date descending
    drilldownData.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())

    return NextResponse.json({ data: drilldownData }, { headers: SECURITY_HEADERS })
  } catch (error) {
    return dashboardJsonErrorResponse(error)
  }
}
