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

    if (!startDate || !endDate || !rfc) {
      return NextResponse.json({ error: 'Faltan parámetros requeridos' }, { status: 400 })
    }

    const start = new Date(startDate)
    const end = new Date(endDate)
    // Adjust end date to include the full day
    end.setHours(23, 59, 59, 999)

    // Build invoice filter
    const invoiceWhere: Record<string, unknown> = {
      issuerRfc: rfc,
      cfdiType: 'INGRESO',
      paymentMethod: 'PPD',
      satStatus: 'VIGENTE',
      issuanceDate: {
        gte: start,
        lte: end,
      },
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
        issuanceDate: 'asc',
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
      paymentXml?: string | null
    }
    const paymentsMap: Record<string, PaymentInfo[]> = {}
    
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
        const pagos = Array.from(doc.getElementsByTagName('*')).filter(el => {
          if (!el.nodeName.endsWith(':Pago')) return false
          // Exclude if it's inside an Addenda to prevent duplicates from embedded text
          let curr = el.parentNode
          while(curr) {
            if (curr.nodeName && curr.nodeName.endsWith(':Addenda')) {
              return false
            }
            curr = curr.parentNode
          }
          return true
        })
        
        pagos.forEach(pagoNode => {
          const monedaP = getAttr(pagoNode, 'MonedaP')
          const fechaPagoStr = getAttr(pagoNode, 'FechaPago')
          
          // Apply filters
          // 1. Payment Currency
          if (paymentCurrency && paymentCurrency !== 'ALL' && monedaP !== paymentCurrency) {
            return
          }

          // 2. Payment Date Range
          if (paymentDateStart && paymentDateEnd) {
             // FechaPago format: YYYY-MM-DDTHH:mm:ss
             const fechaPago = new Date(fechaPagoStr)
             const pStart = new Date(paymentDateStart)
             const pEnd = new Date(paymentDateEnd)
             pEnd.setHours(23, 59, 59, 999)

             if (fechaPago < pStart || fechaPago > pEnd) {
               return
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

            if (!paymentsMap[ppdUuid]) {
              paymentsMap[ppdUuid] = []
            }
            
            paymentsMap[ppdUuid].push({
              paymentUuid: paymentInvoice.uuid,
              paymentDate: paymentInvoice.issuanceDate, // Or use fechaPagoStr? issuanceDate is safer if XML date is weird
              paymentSeries: paymentInvoice.series,
              paymentFolio: paymentInvoice.folio,
              impPagado,
              monedaDR,
              equivalenciaDR,
              numParcialidad,
              impSaldoAnt,
              impSaldoInsoluto,
              monedaP,
              paymentXml: paymentInvoice.xmlContent
            })
          })
        })

      } catch (e) {
        console.error('Error parsing XML for payment', paymentInvoice.uuid, e)
      }
    })

    // 4. Final Aggregation
    const results = ppdInvoices.map((inv) => {
      const payments = paymentsMap[inv.uuid] || []
      
      // Calculate total paid
      // We need to be careful with currencies.
      // The PPD total is in inv.currency.
      // The Payment details have ImpPagado (Amount Paid assigned to this doc).
      // ImpPagado is usually expressed in the currency of the *Payment* (MonedaP), 
      // BUT in CFDI 4.0 / 2.0 complement, it might be different.
      // Wait, let's check SAT rules.
      // In REP 1.0: ImpPagado is in the currency of the *Payment* (MonedaP).
      // In REP 2.0: ImpPagado is in the currency of the *Related Document* (MonedaDR)? 
      // NO. ImpPagado is the amount *of the payment* applied to the document.
      // If Payment is USD and Doc is MXN:
      //   ImpPagado is in USD.
      //   EquivalenciaDR is the rate to convert USD to MXN.
      //   Amount Credited to Doc (in Doc Currency) = ImpPagado * EquivalenciaDR.
      //   Wait, usually: ImpPagado * EquivalenciaDR = Amount in Doc Currency.
      // Let's verify standard:
      // "El importe pagado corresponde a la cantidad que se abona al documento relacionado expresada en la moneda del pago."
      // So yes, ImpPagado is in Payment Currency.
      // To get the amount reduced from the Debt (in Doc Currency):
      //   AmountInDocCurrency = ImpPagado * EquivalenciaDR (if currencies differ)
      //   If currencies are same, EquivalenciaDR is 1.
      
      // However, there is a nuance. Sometimes EquivalenciaDR is defined as DocCurrency / PaymentCurrency or vice versa.
      // SAT Guide: "EquivalenciaDR: Es el tipo de cambio conforme con la moneda registrada en el documento relacionado."
      // Formula: ImportePagado * EquivalenciaDR = Importe en moneda del documento relacionado.
      // So yes, we multiply.
      
      const totalOriginal = Number(inv.total)
      
      const totalPaidInDocCurrency = payments.reduce((acc, p) => {
        // If currencies are the same, EquivalenciaDR might be 1 or undefined (default 1).
        // If different, use EquivalenciaDR.
        
        // Note: Sometimes users mess up and put 1 even if currencies differ (bad data), 
        // but we assume valid CFDI.
        
        // Robustness check:
        // If p.monedaDR (Doc Currency) === inv.currency (Expected Doc Currency)
        // And p.monedaP (Payment Currency) is... wait, we didn't extract MonedaP from XML yet, 
        // but we have paymentInvoice.currency.
        
        let amountInDocCurrency = 0
        
        // If EquivalenciaDR is present and valid (>0), use it.
        if (p.equivalenciaDR && p.equivalenciaDR > 0) {
           // For REP 1.0/2.0 logic:
           // Amount in Doc Currency = ImpPagado * EquivalenciaDR
           amountInDocCurrency = p.impPagado * p.equivalenciaDR
        } else {
           // Fallback if no equivalence (Assume 1:1)
           amountInDocCurrency = p.impPagado
        }
        
        return acc + amountInDocCurrency
      }, 0)

      // Saldo Insoluto
      // Ideally, we should use the 'ImpSaldoInsoluto' from the LATEST payment if available,
      // because it's the official remaining balance declared to SAT.
      // Calculating it manually (Total - Sum(Payments)) is good for validation,
      // but 'ImpSaldoInsoluto' from the last payment is the "official" state at that moment.
      // However, if there are payments *after* the ones we found (unlikely if we search all),
      // manual calculation is safer if we trust our sum.
      // Let's use Manual Calculation for consistency with the "Sumatoria" logic requested.
      // The user prompt says: "Saldo Insoluto (Pendiente): Resultado de Total Ingreso - Sumatoria(Montos de REPs aplicados)."
      
      const saldoInsoluto = totalOriginal - totalPaidInDocCurrency
      
      // Determine status
      // Use a small epsilon for float comparison
      const isPaid = saldoInsoluto < 0.01

      // Sort payments by paymentDate ascending
      payments.sort((a, b) => new Date(a.paymentDate).getTime() - new Date(b.paymentDate).getTime())

      return {
        ...inv,
        total: totalOriginal,
        totalPaid: totalPaidInDocCurrency,
        saldoInsoluto,
        isPaid,
        payments
      }
    })

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
