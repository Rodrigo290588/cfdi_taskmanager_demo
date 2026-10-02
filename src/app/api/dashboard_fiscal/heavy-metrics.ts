import { prisma } from '@/lib/prisma'
import { CfdiType, Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { SECURITY_HEADERS } from '@/lib/org-dashboard-helpers'

export function toNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function normalizeUpperText(value: string | null | undefined) {
  return (value || '').trim().toUpperCase()
}

export interface HeavyMetricsOptions {
  baseWhere: Prisma.InvoiceWhereInput
  monthsToQuery: Date[]
  effectiveOrigin: string
  rfc: string
  issuerFiscalEntityId: string
  dateFilter: Prisma.InvoiceWhereInput
  companyId: string
  companyName: string
  includeHeavyMetrics: boolean
  ctx: { organizationId: string }
  originParam: string
  canViewIssued: boolean
  canViewReceived: boolean
}

export async function getDashboardHeavyMetricsResponse({ // NOSONAR
  baseWhere,
  monthsToQuery,
  effectiveOrigin,
  rfc,
  issuerFiscalEntityId,
  dateFilter,
  companyId,
  companyName,
  includeHeavyMetrics,
  ctx,
  originParam,
  canViewIssued,
  canViewReceived
}: HeavyMetricsOptions) {
  // Aggregations
    const [byType, bySatStatus, monthly, topCounterparties, paymentMethods, totals, ventasNominativas, , ingresosBrutosData, topProducts, totalMontoAgg] = await Promise.all([
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
      // Monthly totals (12 aggregate queries in parallel via Promise.all)
      Promise.all(
        monthsToQuery.map(start => {
          const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0))
          end.setUTCHours(23, 59, 59, 999)
          
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
            label: `${start.toLocaleString('es-MX', { month: 'short', timeZone: 'UTC' })} ${start.getUTCFullYear()}`,
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
      (effectiveOrigin === 'received'
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
          },
          isPublicGlobal: false
        },
        _sum: { subtotal: true }
      }),
      // El cálculo de ventas globales se movió abajo, devolvemos null para mantener orden de tupla
      Promise.resolve(null),
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
      // Total Monto for CFDI Ingresos Vigentes
      prisma.invoice.aggregate({
        where: { ...baseWhere, cfdiType: CfdiType.INGRESO, satStatus: 'VIGENTE' },
        _sum: { total: true }
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
    
    // Objeto para consolidar calculos pesados
    const publicGeneralTotals = { ventasGlobales: 0, operacionesIndividuales: 0 }

    let ivaPueRecibido = 0
    let ivaPpdRecibido = 0
    let ivaERecibido = 0

    if (includeHeavyMetrics) {
      // 1. Agregación de impuestos y retenciones (Emitted, Vigentes, INGRESO)
      const taxesAgg = await prisma.invoice.aggregate({
        where: { ...baseWhere, satStatus: 'VIGENTE', cfdiType: CfdiType.INGRESO },
        _sum: {
          iva16Base: true,
          iva16Tax: true,
          iva8Base: true,
          iva8Tax: true,
          iva0Base: true,
          ivaExemptBase: true,
          ivaWithheld: true,
          isrWithheld: true,
          iepsWithheld: true
        }
      })

      ivaBreakdown.tasa16.base = toNumber(taxesAgg._sum.iva16Base)
      ivaBreakdown.tasa16.tax = toNumber(taxesAgg._sum.iva16Tax)
      ivaBreakdown.tasa8.base = toNumber(taxesAgg._sum.iva8Base)
      ivaBreakdown.tasa8.tax = toNumber(taxesAgg._sum.iva8Tax)
      ivaBreakdown.tasa0.base = toNumber(taxesAgg._sum.iva0Base)
      ivaBreakdown.exento.base = toNumber(taxesAgg._sum.ivaExemptBase)

      totalIvaXml = ivaBreakdown.tasa16.tax + ivaBreakdown.tasa8.tax
      totalImpuestosRetenidosXml = toNumber(taxesAgg._sum.ivaWithheld) + toNumber(taxesAgg._sum.isrWithheld) + toNumber(taxesAgg._sum.iepsWithheld)

      // 2. Ventas Globales vs Individuales (XAXX010101000)
      const globalSalesAgg = await prisma.invoice.groupBy({
        by: ['isPublicGlobal'],
        where: { ...baseWhere, satStatus: 'VIGENTE', cfdiType: 'INGRESO', receiverRfc: 'XAXX010101000' },
        _sum: { subtotal: true }
      })
      
      for (const group of globalSalesAgg) {
        if (group.isPublicGlobal) {
          publicGeneralTotals.ventasGlobales += toNumber(group._sum.subtotal)
        } else {
          publicGeneralTotals.operacionesIndividuales += toNumber(group._sum.subtotal)
        }
      }

      // 3. Ingresos PUE y PPD
      const pueInvoices = await prisma.invoice.findMany({
        where: { ...baseWhere, satStatus: 'VIGENTE', cfdiType: 'INGRESO', paymentMethod: 'PUE' },
        select: { total: true, currency: true, exchangeRate: true, iva16Tax: true, iva8Tax: true }
      })

      for (const inv of pueInvoices) {
        let curTotal = toNumber(inv.total)
        if (inv.currency && inv.currency !== 'MXN' && inv.exchangeRate) {
          curTotal = curTotal * Number(inv.exchangeRate)
        }
        ingresosCobradosPue += curTotal
        ivaCobradoTotal += toNumber(inv.iva16Tax) + toNumber(inv.iva8Tax)
      }

      const ppdAgg = await prisma.invoice.aggregate({
        where: { ...baseWhere, satStatus: 'VIGENTE', cfdiType: 'INGRESO', paymentMethod: 'PPD' },
        _sum: { iva16Tax: true, iva8Tax: true }
      })
      ivaEnFacturasPpd = toNumber(ppdAgg._sum.iva16Tax) + toNumber(ppdAgg._sum.iva8Tax)

      // 4. Pagos Emitidos (CRP)
      const emittedPagos = await prisma.invoice.findMany({
        where: { ...baseWhere, satStatus: 'VIGENTE', cfdiType: 'PAGO' },
        select: { uuid: true }
      })
      const emittedPagoUuids = emittedPagos.map(i => normalizeUpperText(i.uuid)).filter(Boolean)
      if (emittedPagoUuids.length > 0) {
        // Obtenemos los detalles de pago uno por uno o en lote. Como no existe taxesJson directamente,
        // tenemos que extraer la factura (invoice) que contiene el xmlData o procesar los campos existentes.
        const paymentDetailsList = await prisma.invoicePaymentComplementDetail.findMany({
          where: { paymentInvoiceUuid: { in: emittedPagoUuids }, satStatusSnapshot: 'VIGENTE' },
          select: { 
            impPagado: true
            // En caso de que no exista taxesJson en la tabla de detalle, dependemos de los totales
            // o de campos pre-procesados de Prisma si existen.
          }
        })
        
        let totalImpuestosTrasladadosP = 0
        let totalImpPagado = 0
        
        for (const detail of paymentDetailsList) {
          totalImpPagado += toNumber(detail.impPagado)
          
          // Dado que el campo taxesJson no existe en el esquema Prisma para el detalle del pago,
          // y el IVA Trasladado es usualmente una proporción del importe pagado o viene 
          // directamente de una regla de 3 basada en el importe original.
          // Si el esquema no guarda el impuesto desglosado por parcialidad, usamos la tasa estándar de IVA (16%)
          // calculada a la inversa sobre el importe pagado, o bien omitimos el desglose complejo
          // hasta que la base de datos lo soporte nativamente.
          
          // Por seguridad, para no romper la compilación y dado que la base de datos no lo tiene,
          // aproximamos el IVA de la parcialidad usando la base matemática estándar (ImportePagado / 1.16 * 0.16)
          // Nota: Esto asume una tasa del 16% para facturas nacionales comunes.
          const baseParcialidad = toNumber(detail.impPagado) / 1.16
          const ivaParcialidad = baseParcialidad * 0.16
          totalImpuestosTrasladadosP += ivaParcialidad
        }
        
        ivaCobradoTotal += totalImpuestosTrasladadosP
        ivaCobradoCrp += totalImpuestosTrasladadosP
        ingresosCobradosCrp += totalImpPagado
      }

      // 5. Facturas Recibidas (Gastos)
      const receivedPueAgg = await prisma.invoice.aggregate({
        where: { receiverRfc: rfc, satStatus: 'VIGENTE', cfdiType: 'INGRESO', paymentMethod: 'PUE', ...dateFilter },
        _sum: { iva16Tax: true, iva8Tax: true }
      })
      ivaPueRecibido = toNumber(receivedPueAgg._sum.iva16Tax) + toNumber(receivedPueAgg._sum.iva8Tax)

      const receivedEgresoAgg = await prisma.invoice.aggregate({
        where: { receiverRfc: rfc, satStatus: 'VIGENTE', cfdiType: 'EGRESO', ...dateFilter },
        _sum: { iva16Tax: true, iva8Tax: true }
      })
      ivaERecibido = toNumber(receivedEgresoAgg._sum.iva16Tax) + toNumber(receivedEgresoAgg._sum.iva8Tax)

      const receivedPagos = await prisma.invoice.findMany({
        where: { receiverRfc: rfc, satStatus: 'VIGENTE', cfdiType: 'PAGO', ...dateFilter },
        select: { uuid: true }
      })
      const receivedPagoUuids = receivedPagos.map(i => normalizeUpperText(i.uuid)).filter(Boolean)
      if (receivedPagoUuids.length > 0) {
        const paymentDetails = await prisma.invoicePaymentComplementDetail.aggregate({
          where: { paymentInvoiceUuid: { in: receivedPagoUuids }, satStatusSnapshot: 'VIGENTE' },
          _sum: { importeP: true }
        })
        ivaPpdRecibido += toNumber(paymentDetails._sum.importeP)
      }
    }

    const cancelled = await prisma.invoice.aggregate({ 
      where: { ...baseWhere, satStatus: 'CANCELADO', cfdiType: CfdiType.INGRESO },
      _sum: { total: true },
      _count: { _all: true }
    })
    
        // Calculate egresos (Credit Notes)
    let egresosWhere: Prisma.InvoiceWhereInput

    if (effectiveOrigin === 'received') {
      egresosWhere = { receiverRfc: rfc, cfdiType: CfdiType.EGRESO, ...dateFilter }
    } else if (effectiveOrigin === 'both') {
       egresosWhere = { 
         OR: [{ issuerRfc: rfc }, { receiverRfc: rfc }], 
         cfdiType: CfdiType.EGRESO, 
         ...dateFilter 
       }
    } else {
      egresosWhere = { issuerFiscalEntityId, issuerRfc: rfc, cfdiType: CfdiType.EGRESO, ...dateFilter }
    }

    const egresos = await prisma.invoice.aggregate({
      where: { 
        ...egresosWhere, 
        satStatus: 'VIGENTE',
        relatedCfdis: {
          some: {
            invoice: {
              cfdiType: 'INGRESO',
              satStatus: 'VIGENTE'
            }
          }
        }
      },
      _sum: { subtotal: true }
    })

    const cancelledEgresos = await prisma.invoice.aggregate({
      where: { ...egresosWhere, satStatus: 'CANCELADO' },
      _sum: { total: true }
    })

    // Calculate Monto Cobrado and Monto Por Cobrar
    const pueInvoices = await prisma.invoice.groupBy({
      by: ['issuerRfc', 'receiverRfc'],
      where: { ...baseWhere, paymentMethod: 'PUE', satStatus: 'VIGENTE', cfdiType: 'INGRESO' },
      _sum: { total: true }
    })
    const totalPUE = pueInvoices.reduce((acc, curr) => acc + (Number(curr._sum.total) || 0), 0)

    const ppdInvoicesList = await prisma.invoice.findMany({
      where: { ...baseWhere, paymentMethod: 'PPD', satStatus: 'VIGENTE', cfdiType: 'INGRESO' },
      select: { uuid: true, total: true, issuanceDate: true, issuerRfc: true, receiverRfc: true },
    })

    const ppdUuids = ppdInvoicesList.map(i => i.uuid)
    const paidAmountsByUuid: Record<string, number> = {}

    const paymentDetails = ppdUuids.length > 0 ? await prisma.invoicePaymentComplementDetail.findMany({
      where: {
        relatedInvoiceUuid: { in: ppdUuids },
        satStatusSnapshot: 'VIGENTE'
      },
      select: {
        relatedInvoiceUuid: true,
        impPagado: true
      }
    }) : []

    paymentDetails.forEach(detail => {
      const relatedUuid = normalizeUpperText(detail.relatedInvoiceUuid)
      paidAmountsByUuid[relatedUuid] = (paidAmountsByUuid[relatedUuid] || 0) + toNumber(detail.impPagado)
    })

    let totalPPDFullyPaid = 0
    let totalPPDPending = 0
    let carteraVencida = 0

    const now = new Date()
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

    ppdInvoicesList.forEach(inv => {
      const paid = paidAmountsByUuid[normalizeUpperText(inv.uuid)] || 0
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
      select: {
        invoiceId: true,
        invoice: {
          select: {
            total: true,
            iva16Tax: true,
            iva8Tax: true
          }
        }
      },
      distinct: ['invoiceId']
    }) : []
    
    const sumNotasCreditoAplicadas = relatedEgresos.reduce((acc, rel) => acc + Number(rel.invoice.total), 0)

    // Calcular IVA de Ajustes (Notas de Crédito relacionadas a PPD)
    let ivaNotasCreditoPpd = 0
    if (includeHeavyMetrics) {
      ivaNotasCreditoPpd = relatedEgresos.reduce((acc, rel) => 
        acc + toNumber(rel.invoice.iva16Tax) + toNumber(rel.invoice.iva8Tax)
      , 0)
    }

    // 6. Ingresos Pendientes de Cobro (PPD Vigentes - CRP - Notas de Crédito relacionadas a PPD)
      const sumFacturasPPD = ppdInvoicesList.reduce((acc, inv) => acc + Number(inv.total), 0)
      const sumComplementosPago = Object.values(paidAmountsByUuid).reduce((acc, val) => acc + val, 0)
      const pendientesCobro = sumFacturasPPD - sumComplementosPago - sumNotasCreditoAplicadas
      // No permitimos saldos negativos por errores de captura del usuario (ej. pagos que superan el saldo)
      const ingresosPendientesCobro = Math.max(0, pendientesCobro)
      const ivaPendienteCobro = ivaEnFacturasPpd - ivaCobradoCrp - ivaNotasCreditoPpd

    // Resolve display names for top clients by RFC (single groupBy IN query vs N+1 findFirst)
    const topRfcs = topCounterparties.map(c => 
      effectiveOrigin === 'received' 
        ? (c as unknown as { issuerRfc: string }).issuerRfc 
        : (c as unknown as { receiverRfc: string }).receiverRfc
    ).filter(Boolean)

    const nameMap: Record<string, string> = {}
    if (topRfcs.length > 0) {
      const rfcIn: Prisma.StringFilter<'Invoice'> = { in: topRfcs as string[] }
      if (effectiveOrigin === 'received') {
        const nameGroups = await prisma.invoice.groupBy({
          by: ['issuerRfc'],
          where: { issuerRfc: rfcIn },
          _min: { issuerName: true }
        })
        for (const g of nameGroups) {
          if (g.issuerRfc) nameMap[g.issuerRfc] = g._min.issuerName || g.issuerRfc
        }
      } else if (effectiveOrigin === 'both') {
        const [asIssuer, asReceiver] = await Promise.all([
          prisma.invoice.groupBy({
            by: ['issuerRfc'],
            where: { issuerRfc: rfcIn },
            _min: { issuerName: true }
          }),
          prisma.invoice.groupBy({
            by: ['receiverRfc'],
            where: { receiverRfc: rfcIn },
            _min: { receiverName: true }
          })
        ])
        for (const g of asIssuer) {
          if (g.issuerRfc) nameMap[g.issuerRfc] = g._min.issuerName || g.issuerRfc
        }
        for (const g of asReceiver) {
          if (g.receiverRfc && !nameMap[g.receiverRfc]) nameMap[g.receiverRfc] = g._min.receiverName || g.receiverRfc
        }
        for (const rfc of topRfcs) {
          if (!nameMap[rfc]) nameMap[rfc] = rfc
        }
      } else {
        const nameGroups = await prisma.invoice.groupBy({
          by: ['receiverRfc'],
          where: { receiverRfc: rfcIn },
          _min: { receiverName: true }
        })
        for (const g of nameGroups) {
          if (g.receiverRfc) nameMap[g.receiverRfc] = g._min.receiverName || g.receiverRfc
        }
      }
  }

  // Final mapping
  return NextResponse.json({
      company: { id: companyId, rfc, name: companyName },
      kpis: {
        totalCfdis: totals._count._all || 0,
        totalMonto: Number(totalMontoAgg._sum.total || 0),
        ventasNominativas: Number(ventasNominativas._sum.subtotal || 0),
        ventasGlobales: publicGeneralTotals.ventasGlobales,
        operacionesIndividuales: publicGeneralTotals.operacionesIndividuales,
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
        const rfcVal = effectiveOrigin === 'received' 
          ? (c as unknown as { issuerRfc: string }).issuerRfc 
          : (c as unknown as { receiverRfc: string }).receiverRfc
        // Aggregate PUE/PPD per RFC
        let clientPUE = 0
        pueInvoices.forEach(pue => {
          const pueRfc = effectiveOrigin === 'received' ? pue.issuerRfc : pue.receiverRfc
          if (pueRfc === rfcVal) {
            clientPUE += Number(pue._sum.total) || 0
          }
        })
        let clientPPDPaid = 0
        let clientPPDPending = 0
        ppdInvoicesList.forEach(inv => {
          const invRfc = effectiveOrigin === 'received' ? inv.issuerRfc : inv.receiverRfc
          if (invRfc === rfcVal) {
             const paid = paidAmountsByUuid[normalizeUpperText(inv.uuid)] || 0
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
      _security: {
        originRequested: originParam,
        originEffective: effectiveOrigin,
        canViewIssued,
        canViewReceived,
        scopedOrganizationId: ctx.organizationId
      },
      meta: {
        heavyMetricsIncluded: includeHeavyMetrics
      }
    }, { headers: SECURITY_HEADERS })
}
