import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { DOMParser } from '@xmldom/xmldom'

export async function GET(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const rfc = searchParams.get('rfc')
    const paymentDateStart = searchParams.get('paymentDateStart')
    const paymentDateEnd = searchParams.get('paymentDateEnd')
    const incomeCurrency = searchParams.get('incomeCurrency')
    const paymentCurrency = searchParams.get('paymentCurrency')
    const classification = searchParams.get('classification') || 'issued'

    if (!startDate || !endDate || !rfc) {
      return NextResponse.json({ error: 'Faltan parámetros requeridos' }, { status: 400 })
    }

    const start = new Date(startDate)
    const end = new Date(endDate)
    // Adjust end date to include the full day
    end.setHours(23, 59, 59, 999)

    // Build invoice filter
    const invoiceWhere: Record<string, unknown> = {
      cfdiType: 'INGRESO',
      paymentMethod: 'PPD',
      satStatus: 'VIGENTE',
      issuanceDate: {
        gte: start,
        lte: end,
      },
    }

    if (classification === 'received') {
      invoiceWhere.receiverRfc = rfc
    } else if (classification === 'both') {
      invoiceWhere.OR = [
        { issuerRfc: rfc },
        { receiverRfc: rfc }
      ]
    } else {
      // Default to issued
      invoiceWhere.issuerRfc = rfc
    }

    if (incomeCurrency && incomeCurrency !== 'ALL') {
      invoiceWhere.currency = incomeCurrency
    }

    // 1. Fetch PPD Invoices (Ingresos)
    const ppdInvoices = await prisma.invoice.findMany({
      where: invoiceWhere,
      select: {
        id: true,
        uuid: true,
        series: true,
        folio: true,
        issuerRfc: true,
        issuerName: true,
        receiverRfc: true,
        receiverName: true,
        total: true,
        currency: true,
        exchangeRate: true,
        issuanceDate: true,
        xmlContent: true, // Might need to check if PPD itself has info, but usually no.
      },
      orderBy: {
        issuanceDate: 'desc',
      },
    })

    const ppdUuids = ppdInvoices.map((inv) => inv.uuid)

    // 2. Fetch Related Payments (REPs)
    // Build payment invoice filter
    const paymentInvoiceWhere: Record<string, unknown> = {
      cfdiType: 'PAGO',
      satStatus: 'VIGENTE',
    }

    if (paymentCurrency && paymentCurrency !== 'ALL') {
      // Assuming the currency of the payment invoice is usually XXX but can be filtered if data exists
      // However, usually payment currency is inside the XML (MonedaP).
      // But if the user means the currency of the *Payment Document* (which is usually XXX), this filter might return nothing.
      // Wait, 'currency' field in DB for PAGO type is often 'XXX'.
      // The actual currency is in the XML <pago20:Pago MonedaP="...">.
      // BUT, some systems put the payment currency in the main 'currency' field if it's single currency.
      // Let's check the seed script: it sets currency: 'XXX' for PAGO.
      // So filtering by `currency` on the Payment Invoice might fail if it's 'XXX'.
      // We should filter strictly by the XML content extracted later, OR rely on the relation.
      // BUT, we need to filter *before* processing if possible for performance.
      // If we can't filter by DB field, we must filter in memory after extraction.
      // Let's defer the payment currency filter to the processing step (step 3).
    }

    if (paymentDateStart && paymentDateEnd) {
      const pStart = new Date(paymentDateStart)
      const pEnd = new Date(paymentDateEnd)
      pEnd.setHours(23, 59, 59, 999)
      
      paymentInvoiceWhere.issuanceDate = {
        gte: pStart,
        lte: pEnd,
      }
    }

    const relatedCfdis = await prisma.invoiceRelatedCfdi.findMany({
      where: {
        relatedUuid: { in: ppdUuids },
        invoice: paymentInvoiceWhere,
      },
      include: {
        invoice: {
          select: {
            id: true,
            uuid: true,
            series: true,
            folio: true,
            issuanceDate: true,
            currency: true,
            exchangeRate: true,
            xmlContent: true,
          },
        },
      },
    })

    // 3. Process Payments and Calculate Balances
    // Map: PPD UUID -> List of Payments with Amounts
    type PaymentInfo = {
      paymentUuid: string
      paymentDate: Date
      paymentSeries: string | null
      paymentFolio: string | null
      impPagado: number
      monedaDR: string
      equivalenciaDR: number
      numParcialidad: number
      impSaldoAnt: number
      impSaldoInsoluto: number
      monedaP: string
      formaDePagoP: string
    }

    // We need two maps:
    // 1. All payments (to calculate correct balance and status)
    // 2. Filtered payments (to show in the report detail)
    const allPaymentsMap: Record<string, PaymentInfo[]> = {}
    const filteredPaymentsMap: Record<string, PaymentInfo[]> = {}
    
    // Use DOMParser for XML parsing
    const parser = new DOMParser()

    // Helper to get text content from attribute
    const getAttr = (el: Element, name: string) => el.getAttribute(name) || ''

    // Process each related payment
    relatedCfdis.forEach((relation) => {
      const paymentInvoice = relation.invoice
      const ppdUuid = relation.relatedUuid
      
      if (!paymentInvoice.xmlContent) return

      try {
        const doc = parser.parseFromString(paymentInvoice.xmlContent, 'text/xml')
        
        // Find all Pago nodes (handle namespaces pago10 and pago20)
        const pagos = Array.from(doc.getElementsByTagName('*')).filter(el => el.nodeName.endsWith(':Pago'))
        
        pagos.forEach(pagoNode => {
          const monedaP = getAttr(pagoNode, 'MonedaP')
          const fechaPagoStr = getAttr(pagoNode, 'FechaPago')
          const formaDePagoP = getAttr(pagoNode, 'FormaDePagoP')
          const fechaPago = new Date(fechaPagoStr)
          
          // Determine if this payment matches filters
          let matchesFilter = true

          // 1. Payment Currency
          if (paymentCurrency && paymentCurrency !== 'ALL' && monedaP !== paymentCurrency) {
            matchesFilter = false
          }

          // 2. Payment Date Range
          if (paymentDateStart && paymentDateEnd) {
             const pStart = new Date(paymentDateStart)
             const pEnd = new Date(paymentDateEnd)
             pEnd.setHours(23, 59, 59, 999)

             if (fechaPago < pStart || fechaPago > pEnd) {
               matchesFilter = false
             }
          }

          // Find DoctoRelacionado for our target UUID
          const doctos = Array.from(pagoNode.getElementsByTagName('*')).filter(el => 
            el.nodeName.endsWith(':DoctoRelacionado') && 
            getAttr(el, 'IdDocumento').toLowerCase() === ppdUuid.toLowerCase()
          )

          doctos.forEach(doctoNode => {
            const impPagadoStr = getAttr(doctoNode, 'ImpPagado')
            const impPagado = parseFloat(impPagadoStr) || 0
            
            const monedaDR = getAttr(doctoNode, 'MonedaDR') || monedaP
            const equivalenciaDRStr = getAttr(doctoNode, 'EquivalenciaDR')
            const equivalenciaDR = parseFloat(equivalenciaDRStr) || 1
            
            const numParcialidadStr = getAttr(doctoNode, 'NumParcialidad')
            const numParcialidad = parseInt(numParcialidadStr) || 1
            
            const impSaldoAntStr = getAttr(doctoNode, 'ImpSaldoAnt')
            const impSaldoAnt = parseFloat(impSaldoAntStr) || 0
            
            const impSaldoInsolutoStr = getAttr(doctoNode, 'ImpSaldoInsoluto')
            const impSaldoInsoluto = parseFloat(impSaldoInsolutoStr) || 0

            const paymentInfo: PaymentInfo = {
              paymentUuid: paymentInvoice.uuid,
              paymentDate: fechaPago, // Use XML date which is more accurate for the payment itself
              paymentSeries: paymentInvoice.series,
              paymentFolio: paymentInvoice.folio,
              impPagado,
              monedaDR,
              equivalenciaDR,
              numParcialidad,
              impSaldoAnt,
              impSaldoInsoluto,
              monedaP,
              formaDePagoP
            }

            // Add to ALL payments map
            if (!allPaymentsMap[ppdUuid]) {
              allPaymentsMap[ppdUuid] = []
            }
            allPaymentsMap[ppdUuid].push(paymentInfo)

            // Add to FILTERED payments map only if matches
            if (matchesFilter) {
              if (!filteredPaymentsMap[ppdUuid]) {
                filteredPaymentsMap[ppdUuid] = []
              }
              filteredPaymentsMap[ppdUuid].push(paymentInfo)
            }
          })
        })

      } catch (e) {
        console.error('Error parsing XML for payment', paymentInvoice.uuid, e)
      }
    })

    // 4. Final Aggregation
    const results = ppdInvoices.map((inv) => {
      const allPayments = allPaymentsMap[inv.uuid] || []
      const filteredPayments = filteredPaymentsMap[inv.uuid] || []
      
      const totalOriginal = Number(inv.total)
      
      // Calculate Total Paid based on ALL payments to determine status correctly
      const totalPaidAll = allPayments.reduce((acc, p) => {
        let amountInDocCurrency = 0
        if (p.equivalenciaDR && p.equivalenciaDR > 0) {
           amountInDocCurrency = p.impPagado * p.equivalenciaDR
        } else {
           amountInDocCurrency = p.impPagado
        }
        return acc + amountInDocCurrency
      }, 0)

      const saldoInsolutoAll = totalOriginal - totalPaidAll
      const isPaid = saldoInsolutoAll < 0.01

      // If we have active payment filters, we should only include invoices that have matching payments
      const hasPaymentFilters = (paymentCurrency && paymentCurrency !== 'ALL') || (paymentDateStart && paymentDateEnd)
      
      if (hasPaymentFilters && filteredPayments.length === 0) {
        return null // Skip this invoice as it doesn't match the payment filters
      }
      
      // If no payment filters, we typically show all invoices that match the invoice filters (already done in step 1)
      // But usually this report is "Ingresos Pagados" or "Ingresos Parciales".
      // If the intention is to show status, we keep them even if no payments (e.g. unpaid invoices).
      // The frontend filters by isPaid? Yes.
      
      return {
        ...inv,
        total: totalOriginal,
        totalPaid: totalPaidAll, // Show the REAL total paid amount
        saldoInsoluto: saldoInsolutoAll, // Show the REAL balance
        isPaid,
        payments: filteredPayments // Show only matching payments in the detail
      }
    }).filter((item): item is NonNullable<typeof item> => item !== null)


    // 5. KPIs
    // Total Saldo Insoluto (Converted to MXN)
    // We need to convert each invoice's Saldo Insoluto to MXN.
    // If invoice is MXN, use as is.
    // If invoice is USD (or other), use its exchange rate (inv.exchangeRate).
    // Note: inv.exchangeRate is the rate *at issuance*.
    // For "Current" balance in MXN, usually we use the *current* rate or the issuance rate.
    // Accounting standard: Unrealized gain/loss uses current rate.
    // But for simple "Total por Cobrar", using the issuance rate is a common approximation in these dashboards unless live rates are available.
    // Let's use inv.exchangeRate if available, else 1.
    
    let totalSaldoInsolutoMXN = 0
    let totalPorCobrarMXN = 0 // Gross total of unpaid invoices
    
    results.forEach(r => {
      const rate = r.exchangeRate ? Number(r.exchangeRate) : 1
      const saldoMXN = r.saldoInsoluto * rate
      
      totalSaldoInsolutoMXN += saldoMXN
      
      if (!r.isPaid) {
        totalPorCobrarMXN += (r.total * rate)
      }
    })

    return NextResponse.json({
      data: results,
      kpis: {
        totalSaldoInsolutoMXN,
        totalPorCobrarMXN,
        count: results.length,
        countPaid: results.filter(r => r.isPaid).length,
        countPending: results.filter(r => !r.isPaid).length
      }
    })

  } catch (error) {
    console.error('Error processing partial income:', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
