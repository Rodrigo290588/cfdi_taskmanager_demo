import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { CfdiType, Prisma } from '@prisma/client'
import { DOMParser } from '@xmldom/xmldom'

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const companyId = searchParams.get('companyId')
    if (!companyId) {
      return NextResponse.json({ error: 'companyId requerido' }, { status: 400 })
    }

    // const userId = session.user!.id

    // Validate user has access to this company via membership
    const member = await prisma.member.findFirst({
      where: { userId: session.user.id, status: 'APPROVED' },
      include: { organization: true }
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

    // Fetch company RFC to determine issued vs received
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { rfc: true, businessName: true }
    })
    if (!company?.rfc) {
      return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 })
    }

    const rfc = company.rfc

    // Find matching fiscal entity within the user's organization by RFC
    const fiscalEntity = await prisma.fiscalEntity.findFirst({
      where: { rfc }
    })

    // Do not auto-create fiscal entities or demo invoices; show empty metrics when absent

    if (!fiscalEntity) {
      return NextResponse.json({
        company: { id: companyId, rfc, name: company.businessName },
        kpis: {
          totalCfdis: 0,
          totalMonto: 0,
          tasaCancelacion: 0,
          taxes: {
            ivaTrasladado: 0,
            ivaRetenido: 0,
            isrRetenido: 0,
            iepsRetenido: 0,
            breakdown: {
              tasa16: { base: 0, tax: 0 },
              tasa8: { base: 0, tax: 0 },
              tasa0: { base: 0, tax: 0 },
              exento: { base: 0, tax: 0 }
            }
          }
        },
        byType: [],
        bySatStatus: [],
        monthly: [],
        topSuppliers: [],
        topClients: [],
        paymentMethods: [],
      })
    }

    const issuerFiscalEntityId = fiscalEntity.id

    const startDateParam = searchParams.get('startDate')
    const endDateParam = searchParams.get('endDate')
    const originParam = searchParams.get('origin') || 'issued'

    const dateFilter: Prisma.InvoiceWhereInput = {}
    if (startDateParam && endDateParam) {
      // Adjust endDate to include the full day
      const end = new Date(endDateParam)
      end.setHours(23, 59, 59, 999)
      
      dateFilter.issuanceDate = {
        gte: new Date(startDateParam),
        lte: end
      }
    }

    // Determine base filter based on origin
    let baseWhere: Prisma.InvoiceWhereInput
    if (originParam === 'received') {
      // For received: We are the receiver
      baseWhere = {
        receiverRfc: rfc,
        cfdiType: { in: [CfdiType.INGRESO, CfdiType.PAGO] },
        ...dateFilter
      }
    } else if (originParam === 'both') {
      // For both: We are either the issuer OR the receiver
      baseWhere = {
        OR: [
          { issuerRfc: rfc },
          { receiverRfc: rfc }
        ],
        cfdiType: { in: [CfdiType.INGRESO, CfdiType.PAGO] },
        ...dateFilter
      }
    } else {
      // Default: Issued (We are the issuer)
      baseWhere = { 
        issuerFiscalEntityId, 
        issuerRfc: rfc, 
        cfdiType: { in: [CfdiType.INGRESO, CfdiType.PAGO] },
        ...dateFilter
      }
    }

    // Determine months for chart
    let monthsToQuery: Date[] = []
    if (startDateParam && endDateParam) {
      const start = new Date(startDateParam)
      const end = new Date(endDateParam)
      // Normalize to start of month
      const current = new Date(start.getFullYear(), start.getMonth(), 1)
      const last = new Date(end.getFullYear(), end.getMonth(), 1)
      
      while (current <= last) {
        monthsToQuery.push(new Date(current))
        current.setMonth(current.getMonth() + 1)
      }
      // Limit to avoid too many points if range is huge? user responsibility.
    } else {
      // Default: last 12 months
      monthsToQuery = Array.from({ length: 12 }, (_, i) => {
        const d = new Date()
        d.setMonth(d.getMonth() - i)
        return new Date(d.getFullYear(), d.getMonth(), 1)
      }).reverse() // Chronological order
    }

    // Aggregations
    const [byType, bySatStatus, monthly, topCounterparties, paymentMethods, totals, ventasNominativas, ventasGlobales, operacionesIndividuales, ingresosBrutosData, topProducts, taxConcepts, ivaAcreditableConcepts] = await Promise.all([
      // CFDI type counts and sums
      prisma.invoice.groupBy({
        by: ['cfdiType'],
        where: baseWhere,
        _count: { _all: true },
        _sum: { total: true }
      }),
      // SAT status distribution
      prisma.invoice.groupBy({
        by: ['satStatus'],
        where: { ...baseWhere, satStatus: { in: ['VIGENTE', 'CANCELADO'] } },
        _count: { _all: true }
      }),
      // Monthly totals
      Promise.all(
        monthsToQuery.map(start => {
          const end = new Date(start.getFullYear(), start.getMonth() + 1, 0)
          end.setHours(23, 59, 59, 999)
          
          return prisma.invoice.aggregate({
            where: { ...baseWhere, issuanceDate: { gte: start, lte: end } },
            _count: { _all: true },
            _sum: { 
              total: true,
              ivaTransferred: true,
              ivaWithheld: true,
              isrWithheld: true,
              iepsWithheld: true
            }
          }).then(res => ({
            label: `${start.toLocaleString('es-MX', { month: 'short' })} ${start.getFullYear()}`,
            count: res._count._all || 0,
            total: res._sum.total || 0,
            taxes: {
              ivaTrasladado: Number(res._sum.ivaTransferred || 0),
              ivaRetenido: Number(res._sum.ivaWithheld || 0),
              isrRetenido: Number(res._sum.isrWithheld || 0),
              iepsRetenido: Number(res._sum.iepsWithheld || 0)
            }
          }))
        })
      ),
      // Top 10 clients grouped strictly by RFC to avoid name-based duplicates
      (originParam === 'received'
        ? prisma.invoice.groupBy({
            by: ['issuerRfc'],
            where: baseWhere,
            _sum: { total: true },
            orderBy: { _sum: { total: 'desc' } },
            take: 10
          })
        : prisma.invoice.groupBy({
            by: ['receiverRfc'],
            where: baseWhere,
            _sum: { total: true },
            orderBy: { _sum: { total: 'desc' } },
            take: 10
          })
      ),
      // Payment method usage (INGRESO only).
      (() => {
        const where: Prisma.InvoiceWhereInput = {
          ...baseWhere,
          cfdiType: CfdiType.INGRESO,
          paymentMethod: { in: ['PUE', 'PPD'] },
        }
        return prisma.invoice.groupBy({
          by: ['paymentMethod'],
          where,
          _count: { _all: true },
          _sum: { total: true },
        })
      })(),
      // Totals and cancellations
      prisma.invoice.aggregate({
        where: baseWhere,
        _count: { _all: true },
        _sum: { 
          total: true,
          ivaTransferred: true,
          ivaWithheld: true,
          isrWithheld: true,
          iepsWithheld: true
        },
      }),
      // Ventas Nominativas
      prisma.invoice.aggregate({
        where: {
          ...baseWhere,
          cfdiType: CfdiType.INGRESO,
          satStatus: 'VIGENTE',
          receiverRfc: {
            notIn: ['XAXX010101000', 'XEXX010101000']
          }
        },
        _sum: { subtotal: true }
      }),
      // Ventas Globales (Público en General)
      prisma.invoice.aggregate({
        where: {
          ...baseWhere,
          cfdiType: CfdiType.INGRESO,
          satStatus: 'VIGENTE',
          receiverRfc: 'XAXX010101000',
          xmlContent: {
            contains: 'InformacionGlobal'
          }
        },
        _sum: { subtotal: true }
      }),
      // Operaciones Individuales (Público en General)
      prisma.invoice.aggregate({
        where: {
          ...baseWhere,
          cfdiType: CfdiType.INGRESO,
          satStatus: 'VIGENTE',
          receiverRfc: 'XAXX010101000',
          NOT: {
            xmlContent: {
              contains: 'InformacionGlobal'
            }
          }
        },
        _sum: { subtotal: true }
      }),
      // Ingresos Brutos Reales (Brutos y Descuentos)
      prisma.invoice.aggregate({
        where: {
          ...baseWhere,
          cfdiType: CfdiType.INGRESO,
          satStatus: 'VIGENTE'
        },
        _sum: { subtotal: true, discount: true }
      }),
      // Top 10 products
      prisma.invoiceConcept.groupBy({
        by: ['description'],
        where: { invoice: baseWhere },
        _sum: { amount: true },
        orderBy: { _sum: { amount: 'desc' } },
        take: 10
      }),
      // Invoices XML for Tax Breakdown
      prisma.invoice.findMany({
        where: { ...baseWhere, satStatus: 'VIGENTE' },
        select: { xmlContent: true, cfdiType: true, paymentMethod: true, currency: true, exchangeRate: true, subtotal: true }
      }),
      // Invoices XML for IVA Acreditable (Gastos y Compras)
      prisma.invoice.findMany({
        where: { 
          receiverRfc: rfc, 
          cfdiType: { in: ['INGRESO', 'EGRESO', 'PAGO'] },
          satStatus: 'VIGENTE',
          ...dateFilter
        },
        select: { xmlContent: true, cfdiType: true, paymentMethod: true }
      })
    ])

    // Calculate Tax Breakdown
    const ivaBreakdown = {
      tasa16: { base: 0, tax: 0 },
      tasa8: { base: 0, tax: 0 },
      tasa0: { base: 0, tax: 0 },
      exento: { base: 0, tax: 0 }
    }

    let totalIvaXml = 0
    let totalImpuestosRetenidosXml = 0
    let ivaCobradoTotal = 0
    let ivaCobradoCrp = 0
    let ivaEnFacturasPpd = 0
    let ingresosCobradosPue = 0
    let ingresosCobradosCrp = 0

    // Use RegEx for faster parsing of XML contents, scoped to Conceptos to avoid double counting
    const conceptosRegex = /<[^:>]*:?Conceptos[^>]*>([\s\S]*?)<\/[^:>]*:?Conceptos>/i
    const trasladoRegex = /<[^:>]*:?Traslado([^>]+)>/gi
    const attrRegex = /(\w+)="([^"]+)"/g
    const totalRetenidosRegex = /TotalImpuestosRetenidos=["']([^"']+)["']/i
    const parserForTaxes = new DOMParser()

    taxConcepts.forEach(inv => {
      if (!inv.xmlContent) return
      
      const xml = inv.xmlContent
      const conceptosMatch = xml.match(conceptosRegex)
      const parseTarget = conceptosMatch ? conceptosMatch[1] : xml // fallback to full xml if not found

      const retenidosMatch = xml.match(totalRetenidosRegex)
      if (retenidosMatch) {
        totalImpuestosRetenidosXml += parseFloat(retenidosMatch[1] || '0')
      }

      // Paso 1.3: Sumatoria de Facturas de Contado (PUE)
      if (inv.cfdiType === 'INGRESO' && inv.paymentMethod === 'PUE') {
        let subtotal = Number(inv.subtotal) || 0
        if (inv.currency && inv.currency !== 'MXN' && inv.exchangeRate) {
          subtotal = subtotal * Number(inv.exchangeRate)
        }
        ingresosCobradosPue += subtotal
      }

      for (const m of parseTarget.matchAll(trasladoRegex)) {
        const attrsStr = m[1]
        const attrs: Record<string, string> = {}
        for (const attrMatch of attrsStr.matchAll(attrRegex)) {
          attrs[attrMatch[1]] = attrMatch[2]
        }

        if (attrs['Impuesto'] === '002' || attrs['Impuesto'] === 'IVA') {
          const base = parseFloat(attrs['Base'] || '0')
          const tax = parseFloat(attrs['Importe'] || '0')
          const tasa = parseFloat(attrs['TasaOCuota'] || '0')
          const tipo = attrs['TipoFactor']

          totalIvaXml += tax

          if (tipo === 'Exento') {
            ivaBreakdown.exento.base += base
          } else if (tipo === 'Tasa' || attrs['TasaOCuota']) {
            if (Math.abs(tasa - 0.16) < 0.01) {
              ivaBreakdown.tasa16.base += base
              ivaBreakdown.tasa16.tax += tax
            } else if (Math.abs(tasa - 0.08) < 0.01) {
              ivaBreakdown.tasa8.base += base
              ivaBreakdown.tasa8.tax += tax
            } else if (Math.abs(tasa - 0.0) < 0.001) {
              ivaBreakdown.tasa0.base += base
            }
          }
          
          // Paso A: Sumar IVA de Facturas PUE
          if (inv.cfdiType === 'INGRESO' && inv.paymentMethod === 'PUE' && attrs['Impuesto'] === '002') {
            ivaCobradoTotal += tax
          }

          // Sumar IVA de Facturas PPD (Para IVA Pendiente de Cobro)
          if (inv.cfdiType === 'INGRESO' && inv.paymentMethod === 'PPD' && attrs['Impuesto'] === '002') {
            ivaEnFacturasPpd += tax
          }
        }
      }

      // Paso B: Sumar IVA de Complementos (CRP)
      if (inv.cfdiType === 'PAGO') {
        try {
          const doc = parserForTaxes.parseFromString(xml, 'text/xml')
          const pagos = Array.from(doc.getElementsByTagName('*')).filter(el => el.nodeName.endsWith(':Pago'))
          pagos.forEach(pagoNode => {
            const impuestosP = Array.from(pagoNode.getElementsByTagName('*')).filter(el => el.nodeName.endsWith(':ImpuestosP'))
            impuestosP.forEach(impNode => {
               const trasladosP = Array.from(impNode.getElementsByTagName('*')).filter(el => el.nodeName.endsWith(':TrasladoP'))
               trasladosP.forEach(trasladoP => {
                  const impuestoP = trasladoP.getAttribute('ImpuestoP')
                  const importeP = parseFloat(trasladoP.getAttribute('ImporteP') || '0')
                  const baseP = parseFloat(trasladoP.getAttribute('BaseP') || '0')
                  if (impuestoP === '002') {
                     ivaCobradoTotal += importeP
                     ivaCobradoCrp += importeP
                     ingresosCobradosCrp += baseP
                  }
               })
            })
          })
        } catch {
          // ignore parse error
        }
      }
    })

    // Calcular IVA Acreditable (Gastos y Compras)
    let ivaPueRecibido = 0
    let ivaPpdRecibido = 0
    let ivaERecibido = 0

    ivaAcreditableConcepts.forEach(inv => {
      if (!inv.xmlContent) return
      const xml = inv.xmlContent

      if (inv.cfdiType === 'INGRESO' && inv.paymentMethod === 'PUE') {
        const conceptosMatch = xml.match(conceptosRegex)
        const parseTarget = conceptosMatch ? conceptosMatch[1] : xml
        for (const m of parseTarget.matchAll(trasladoRegex)) {
          const attrsStr = m[1]
          const attrs: Record<string, string> = {}
          for (const attrMatch of attrsStr.matchAll(attrRegex)) {
            attrs[attrMatch[1]] = attrMatch[2]
          }
          if (attrs['Impuesto'] === '002') {
            ivaPueRecibido += parseFloat(attrs['Importe'] || '0')
          }
        }
      }

      if (inv.cfdiType === 'EGRESO') {
        const conceptosMatch = xml.match(conceptosRegex)
        const parseTarget = conceptosMatch ? conceptosMatch[1] : xml
        for (const m of parseTarget.matchAll(trasladoRegex)) {
          const attrsStr = m[1]
          const attrs: Record<string, string> = {}
          for (const attrMatch of attrsStr.matchAll(attrRegex)) {
            attrs[attrMatch[1]] = attrMatch[2]
          }
          if (attrs['Impuesto'] === '002') {
            ivaERecibido += parseFloat(attrs['Importe'] || '0')
          }
        }
      }

      if (inv.cfdiType === 'PAGO') {
        try {
          const doc = parserForTaxes.parseFromString(xml, 'text/xml')
          const pagos = Array.from(doc.getElementsByTagName('*')).filter(el => el.nodeName.endsWith(':Pago'))
          pagos.forEach(pagoNode => {
            const impuestosP = Array.from(pagoNode.getElementsByTagName('*')).filter(el => el.nodeName.endsWith(':ImpuestosP'))
            impuestosP.forEach(impNode => {
               const trasladosP = Array.from(impNode.getElementsByTagName('*')).filter(el => el.nodeName.endsWith(':TrasladoP'))
               trasladosP.forEach(trasladoP => {
                  const impuestoP = trasladoP.getAttribute('ImpuestoP')
                  const importeP = parseFloat(trasladoP.getAttribute('ImporteP') || '0')
                  if (impuestoP === '002') {
                     ivaPpdRecibido += importeP
                  }
               })
            })
          })
        } catch {
          // ignore parse error
        }
      }
    })

    const cancelled = await prisma.invoice.aggregate({ 
      where: { ...baseWhere, satStatus: 'CANCELADO', cfdiType: CfdiType.INGRESO },
      _sum: { total: true },
      _count: { _all: true }
    })
    
    // Calculate egresos (Credit Notes)
    let egresosWhere: Prisma.InvoiceWhereInput

    if (originParam === 'received') {
      egresosWhere = { receiverRfc: rfc, cfdiType: CfdiType.EGRESO, ...dateFilter }
    } else if (originParam === 'both') {
       egresosWhere = { 
         OR: [{ issuerRfc: rfc }, { receiverRfc: rfc }], 
         cfdiType: CfdiType.EGRESO, 
         ...dateFilter 
       }
    } else {
      egresosWhere = { issuerFiscalEntityId, issuerRfc: rfc, cfdiType: CfdiType.EGRESO, ...dateFilter }
    }

    const egresos = await prisma.invoice.aggregate({
      where: { ...egresosWhere, satStatus: 'VIGENTE' },
      _sum: { subtotal: true }
    })

    const cancelledEgresos = await prisma.invoice.aggregate({
      where: { ...egresosWhere, satStatus: 'CANCELADO' },
      _sum: { total: true }
    })

    // Calculate Monto Cobrado and Monto Por Cobrar
    const pueInvoices = await prisma.invoice.groupBy({
      by: ['issuerRfc', 'receiverRfc'],
      where: { ...baseWhere, paymentMethod: 'PUE' },
      _sum: { total: true }
    })
    const totalPUE = pueInvoices.reduce((acc, curr) => acc + (Number(curr._sum.total) || 0), 0)

    const ppdInvoicesList = await prisma.invoice.findMany({
      where: { ...baseWhere, paymentMethod: 'PPD' },
      select: { uuid: true, total: true, issuanceDate: true, issuerRfc: true, receiverRfc: true },
    })

    const ppdUuids = ppdInvoicesList.map(i => i.uuid)

    const relatedCfdis = ppdUuids.length > 0 ? await prisma.invoiceRelatedCfdi.findMany({
      where: {
        relatedUuid: { in: ppdUuids },
        invoice: { cfdiType: 'PAGO', satStatus: 'VIGENTE' }
      },
      include: {
        invoice: { select: { xmlContent: true } }
      }
    }) : []

    const paidAmountsByUuid: Record<string, number> = {}
    const parser = new DOMParser()
    const getAttr = (el: Element, name: string) => el.getAttribute(name) || ''

    relatedCfdis.forEach(relation => {
      const xml = relation.invoice.xmlContent
      if (!xml) return
      try {
        const doc = parser.parseFromString(xml, 'text/xml')
        const pagos = Array.from(doc.getElementsByTagName('*')).filter(el => el.nodeName.endsWith(':Pago'))
        pagos.forEach(pagoNode => {
          const doctos = Array.from(pagoNode.getElementsByTagName('*')).filter(el => 
            el.nodeName.endsWith(':DoctoRelacionado') && 
            getAttr(el, 'IdDocumento').toLowerCase() === relation.relatedUuid.toLowerCase()
          )
          doctos.forEach(doctoNode => {
            const impPagadoStr = getAttr(doctoNode, 'ImpPagado')
            const impPagado = parseFloat(impPagadoStr) || 0
            paidAmountsByUuid[relation.relatedUuid] = (paidAmountsByUuid[relation.relatedUuid] || 0) + impPagado
          })
        })
      } catch {
        // ignore parse error
      }
    })

    let totalPPDFullyPaid = 0
    let totalPPDPending = 0
    let carteraVencida = 0

    const now = new Date()
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

    ppdInvoicesList.forEach(inv => {
      const paid = paidAmountsByUuid[inv.uuid] || 0
      // Consider fully paid if remaining balance is practically zero
      if (paid >= Number(inv.total) - 0.01) {
        totalPPDFullyPaid += Number(inv.total)
      } else {
        totalPPDPending += Number(inv.total)
        
        // Calculate Cartera Vencida (older than 30 days and not fully paid)
        if (now.getTime() - new Date(inv.issuanceDate).getTime() > THIRTY_DAYS_MS) {
          carteraVencida += (Number(inv.total) - paid)
        }
      }
    })

    const montoCobrado = totalPUE + totalPPDFullyPaid
    const montoPorCobrar = totalPPDPending

    // Ingresos Pendientes de Cobro (PPD - CRP - Notas de Crédito)
    const relatedEgresos = ppdUuids.length > 0 ? await prisma.invoiceRelatedCfdi.findMany({
      where: {
        relatedUuid: { in: ppdUuids },
        invoice: { cfdiType: 'EGRESO', satStatus: 'VIGENTE' }
      },
      select: { invoiceId: true, invoice: { select: { total: true, xmlContent: true } } },
      distinct: ['invoiceId']
    }) : []
    const sumNotasCreditoAplicadas = relatedEgresos.reduce((acc, rel) => acc + Number(rel.invoice.total), 0)

    // Calcular IVA de Ajustes (Notas de Crédito relacionadas a PPD)
    let ivaNotasCreditoPpd = 0
    relatedEgresos.forEach(rel => {
      if (!rel.invoice.xmlContent) return
      const xml = rel.invoice.xmlContent
      const conceptosMatch = xml.match(conceptosRegex)
      const parseTarget = conceptosMatch ? conceptosMatch[1] : xml
      for (const m of parseTarget.matchAll(trasladoRegex)) {
        const attrsStr = m[1]
        const attrs: Record<string, string> = {}
        for (const attrMatch of attrsStr.matchAll(attrRegex)) {
          attrs[attrMatch[1]] = attrMatch[2]
        }
        if (attrs['Impuesto'] === '002') {
          ivaNotasCreditoPpd += parseFloat(attrs['Importe'] || '0')
        }
      }
    })

    const sumFacturasPPD = ppdInvoicesList.reduce((acc, inv) => acc + Number(inv.total), 0)
    const sumComplementosPago = Object.values(paidAmountsByUuid).reduce((acc, val) => acc + val, 0)
    const ingresosPendientesCobro = sumFacturasPPD - sumComplementosPago - sumNotasCreditoAplicadas
    const ivaPendienteCobro = ivaEnFacturasPpd - ivaCobradoCrp - ivaNotasCreditoPpd

    // Resolve display names for top clients by RFC
    const topRfcs = topCounterparties.map(c => 
      originParam === 'received' 
        ? (c as unknown as { issuerRfc: string }).issuerRfc 
        : (c as unknown as { receiverRfc: string }).receiverRfc
    ).filter(Boolean)
    const nameMap: Record<string, string> = {}
    await Promise.all(topRfcs.map(async (r) => {
      const rec = await prisma.invoice.findFirst({
        where: originParam === 'received' ? { issuerRfc: r } : { receiverRfc: r },
        orderBy: { issuanceDate: 'desc' },
        select: { issuerName: true, receiverName: true }
      })
      nameMap[r] = originParam === 'received' ? (rec?.issuerName || r) : (rec?.receiverName || r)
    }))

    return NextResponse.json({
      company: { id: companyId, rfc, name: company.businessName },
      kpis: {
        totalCfdis: totals._count._all || 0,
        totalMonto: Number(totals._sum.total || 0),
        ventasNominativas: Number(ventasNominativas._sum.subtotal || 0),
        ventasGlobales: Number(ventasGlobales._sum.subtotal || 0),
        operacionesIndividuales: Number(operacionesIndividuales._sum.subtotal || 0),
        ingresosBrutos: Number(ingresosBrutosData._sum.subtotal || 0),
        descuentosYBonificaciones: Number(ingresosBrutosData._sum.discount || 0),
        tasaCancelacion: (totals._count._all || 0) ? Math.round(((cancelled._count._all || 0) / (totals._count._all || 1)) * 100) : 0,
        montoCancelado: Number(cancelled._sum.total || 0),
        montoCanceladoEgresos: Number(cancelledEgresos._sum.total || 0),
        montoNotasCredito: Number(egresos._sum.subtotal || 0),
        montoCobrado: montoCobrado || 0,
        montoPorCobrar: montoPorCobrar || 0,
        carteraVencida: carteraVencida || 0,
        ingresosCobradosPue,
        ingresosCobradosCrp,
        ingresosCobradosTotal: ingresosCobradosPue + ingresosCobradosCrp,
        ingresosPendientesCobro,
        ivaPendienteCobro,
        taxes: {
          ivaAcreditableTotal: ivaPueRecibido + ivaPpdRecibido - ivaERecibido,
          ivaPueRecibido: ivaPueRecibido,
          ivaPpdRecibido: ivaPpdRecibido,
          ivaERecibido: ivaERecibido,
          ivaCobradoTotal: ivaCobradoTotal,
          ivaTrasladado: totalIvaXml || totals._sum.ivaTransferred || 0,
          ivaRetenido: totals._sum.ivaWithheld || 0,
          isrRetenido: totals._sum.isrWithheld || 0,
          iepsRetenido: totals._sum.iepsWithheld || 0,
          totalImpuestosRetenidos: totalImpuestosRetenidosXml || (Number(totals._sum.ivaWithheld || 0) + Number(totals._sum.isrWithheld || 0) + Number(totals._sum.iepsWithheld || 0)),
          breakdown: ivaBreakdown
        }
      },
      byType: byType.map(t => ({ type: t.cfdiType, count: t._count._all, total: t._sum.total || 0 })),
      bySatStatus: bySatStatus.map(s => ({ status: s.satStatus, count: s._count._all })),
      monthly: monthly, 
      topClients: topCounterparties.map(c => {
        const rfcVal = originParam === 'received' 
          ? (c as unknown as { issuerRfc: string }).issuerRfc 
          : (c as unknown as { receiverRfc: string }).receiverRfc
        // Aggregate PUE/PPD per RFC
        let clientPUE = 0
        pueInvoices.forEach(pue => {
          const pueRfc = originParam === 'received' ? pue.issuerRfc : pue.receiverRfc
          if (pueRfc === rfcVal) {
            clientPUE += Number(pue._sum.total) || 0
          }
        })
        let clientPPDPaid = 0
        let clientPPDPending = 0
        ppdInvoicesList.forEach(inv => {
          const invRfc = originParam === 'received' ? inv.issuerRfc : inv.receiverRfc
          if (invRfc === rfcVal) {
             const paid = paidAmountsByUuid[inv.uuid] || 0
             if (paid >= Number(inv.total) - 0.01) {
               clientPPDPaid += Number(inv.total)
             } else {
               clientPPDPaid += paid
               clientPPDPending += (Number(inv.total) - paid)
             }
          }
        })
        const cobrado = clientPUE + clientPPDPaid
        const pendiente = clientPPDPending
        const sumTotal = ((c as unknown as { _sum: { total: number | null } })._sum.total) || 0
        return { rfc: rfcVal, name: nameMap[rfcVal] || rfcVal, total: Number(sumTotal) || 0, cobrado, pendiente }
      }),
      topProducts: topProducts.map(p => ({
        name: p.description,
        value: Number(p._sum.amount) || 0
      })),
      paymentMethods: paymentMethods.map(p => ({ method: p.paymentMethod, count: p._count._all, total: Number(p._sum.total || 0) })),
    })
  } catch (error) {
    console.error('Dashboard fiscal API error:', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
