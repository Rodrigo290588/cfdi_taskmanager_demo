import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { CfdiType, Prisma } from '@prisma/client'
import { DOMParser } from '@xmldom/xmldom'

function normalizeUpperText(value: string | null | undefined) {
  return (value || '').trim().toUpperCase()
}

function getPagoBaseTotal(xmlContent: string) {
  const parser = new DOMParser()

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

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = searchParams.get('companyId')
    const startDateParam = searchParams.get('startDate')
    const endDateParam = searchParams.get('endDate')
    const originParam = searchParams.get('origin') || 'issued'

    if (!companyId) return NextResponse.json({ error: 'companyId requerido' }, { status: 400 })

    const member = await prisma.member.findFirst({ where: { userId: session.user.id, status: 'APPROVED' } })
    if (!member) return NextResponse.json({ error: 'Membresía no encontrada' }, { status: 404 })

    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { rfc: true } })
    if (!company?.rfc) return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 })

    const rfc = company.rfc
    const fiscalEntity = await prisma.fiscalEntity.findFirst({ where: { rfc } })
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

    const invoices = await prisma.invoice.findMany({
      where: { ...baseWhere, satStatus: 'VIGENTE' },
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
        xmlContent: true,
      }
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const drilldownData: any[] = []
    const paymentInvoices = invoices.filter(inv => inv.cfdiType === 'PAGO')
    const paymentInvoiceUuids = paymentInvoices.map(inv => inv.uuid)

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
    const paymentBaseByNodeKey = new Map<string, number>()
    paymentDetails.forEach(detail => {
      const key = normalizeUpperText(detail.paymentInvoiceUuid)
      const current = relatedUuidsByPaymentUuid.get(key) || []
      const relatedUuid = normalizeUpperText(detail.relatedInvoiceUuid)
      if (relatedUuid && !current.includes(relatedUuid)) {
        current.push(relatedUuid)
      }
      relatedUuidsByPaymentUuid.set(key, current)

      const nodeKey = `${key}:${detail.paymentNodeIndex}`
      paymentBaseByNodeKey.set(nodeKey, Math.max(paymentBaseByNodeKey.get(nodeKey) || 0, toNumber(detail.baseP)))
    })

    const paymentBaseByInvoiceUuid = new Map<string, number>()
    paymentBaseByNodeKey.forEach((baseP, nodeKey) => {
      const separatorIndex = nodeKey.indexOf(':')
      const invoiceUuid = separatorIndex >= 0 ? nodeKey.slice(0, separatorIndex) : nodeKey
      paymentBaseByInvoiceUuid.set(invoiceUuid, (paymentBaseByInvoiceUuid.get(invoiceUuid) || 0) + baseP)
    })

    invoices.forEach(inv => {
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
              const parser = new DOMParser()
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

    // Sort by date descending
    drilldownData.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())

    return NextResponse.json({ data: drilldownData })
  } catch (error) {
    console.error('Drilldown error:', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
