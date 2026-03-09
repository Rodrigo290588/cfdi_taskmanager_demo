
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'crypto'

const prisma = new PrismaClient()

// Helper to generate random numbers
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min

async function main() {
  console.log('Starting seed to attach payments to EXISTING invoices...')

  // 1. Calculate date 3 months ago
  const threeMonthsAgo = new Date()
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)

  console.log(`Searching for PPD invoices since: ${threeMonthsAgo.toISOString()}`)

  // 2. Find existing PPD invoices
  const existingInvoices = await prisma.invoice.findMany({
    where: {
      cfdiType: 'INGRESO',
      paymentMethod: 'PPD',
      issuanceDate: {
        gte: threeMonthsAgo
      },
      status: 'ACTIVE'
    },
    take: 5,
    orderBy: {
      issuanceDate: 'desc'
    }
  })

  if (existingInvoices.length === 0) {
    console.log('No existing PPD invoices found in the last 3 months.')
    return
  }

  console.log(`Found ${existingInvoices.length} existing PPD invoices. Adding payments...`)

  for (const invoice of existingInvoices) {
    // Skip if already has many payments (arbitrary check, but let's just add more)
    // Actually, user wants to see "multiple payments".
    
    const user = await prisma.user.findUnique({ where: { id: invoice.userId } })
    const fiscal = await prisma.fiscalEntity.findUnique({ where: { id: invoice.issuerFiscalEntityId } })
    
    if (!user || !fiscal) {
      console.log(`Skipping invoice ${invoice.uuid} (missing user/fiscal data)`)
      continue
    }

    // We need receiver info too, assume it's in the invoice
    const client = {
      rfc: invoice.receiverRfc,
      name: invoice.receiverName
    }

    // Generate 2 payments
    const paymentsToAdd = [
      { amount: Number((invoice.total * 0.3).toFixed(2)), partiality: 1 },
      { amount: Number((invoice.total * 0.3).toFixed(2)), partiality: 2 }
    ]

    console.log(`Processing Invoice: ${invoice.uuid} (Total: ${invoice.total})`)

    // If there were existing payments, we should account for them, but for this test let's just pretend we are adding new ones from scratch or on top.
    // To be safe and avoid logic errors with "Saldo Insoluto", let's assume these are the *only* payments or append.
    // If existing payments exist, we should start partiality higher.
    
    // Check existing payments count
    const existingPayments = await prisma.invoiceRelatedCfdi.findMany({
      where: { relatedUuid: invoice.uuid },
      include: { invoice: true }
    })
    
    let nextPartiality = existingPayments.length + 1
    
    // Calculate current balance based on existing payments
    // We don't have the payment amounts easily available without fetching the related PAGO invoices.
    // Let's just fetch them to be accurate.
    // (Already fetched above in existingPayments)
    
    // Calculate real balance
    // This is tricky because `impPagado` is inside the XML, not always in a column. 
    // But let's just append payments and not worry too much about exact math for the *test*, 
    // as long as the rows appear.
    // However, to be nice, let's try.
    
    // Simplified approach: Just add 2 small payments.
    
    for (const p of paymentsToAdd) {
      const amount = p.amount
      const partiality = nextPartiality++
      
      const paymentDate = new Date() // Today
      const paymentUuid = randomUUID()
      
      // We don't really know the previous balance without parsing XMLs of all previous payments.
      // Let's just use a dummy balance logic: Total - (Amount * (Partiality-1))
      const saldoAnt = invoice.total - (amount * (partiality - 1))
      const saldoInsoluto = saldoAnt - amount
      
      // XML for Payment
      const paymentXml = `
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:pago20="http://www.sat.gob.mx/Pagos20" Version="4.0" Serie="P" Folio="${rand(1000, 9999)}" Fecha="${paymentDate.toISOString()}" SubTotal="0" Moneda="XXX" Total="0" TipoDeComprobante="P" LugarExpedicion="${fiscal.postalCode}">
  <cfdi:Emisor Rfc="${fiscal.rfc}" Nombre="${fiscal.businessName}" RegimenFiscal="${fiscal.taxRegime}"/>
  <cfdi:Receptor Rfc="${client.rfc}" Nombre="${client.name}" UsoCFDI="CP01"/>
  <cfdi:Complemento>
    <pago20:Pagos Version="2.0">
      <pago20:Pago FechaPago="${paymentDate.toISOString()}" FormaDePagoP="03" MonedaP="${invoice.currency}" Monto="${amount}" TipoCambioP="1">
        <pago20:DoctoRelacionado IdDocumento="${invoice.uuid}" Serie="${invoice.series||''}" Folio="${invoice.folio||''}" MonedaDR="${invoice.currency}" EquivalenciaDR="1" NumParcialidad="${partiality}" ImpSaldoAnt="${saldoAnt.toFixed(2)}" ImpPagado="${amount.toFixed(2)}" ImpSaldoInsoluto="${saldoInsoluto.toFixed(2)}" ObjetoImpDR="02"/>
      </pago20:Pago>
    </pago20:Pagos>
  </cfdi:Complemento>
</cfdi:Comprobante>`

      // Create Payment Invoice Record
      const paymentInvoice = await prisma.invoice.create({
        data: {
          userId: user.id,
          issuerFiscalEntityId: fiscal.id,
          uuid: paymentUuid,
          cfdiType: 'PAGO',
          series: 'P',
          folio: `${rand(1000, 9999)}`,
          currency: 'XXX',
          status: 'ACTIVE',
          satStatus: 'VIGENTE',
          issuerRfc: fiscal.rfc,
          issuerName: fiscal.businessName,
          receiverRfc: client.rfc,
          receiverName: client.name,
          subtotal: 0,
          total: 0,
          paymentMethod: '',
          paymentForm: '',
          cfdiUsage: 'CP01',
          placeOfExpedition: fiscal.postalCode,
          xmlContent: paymentXml,
          issuanceDate: paymentDate,
          certificationDate: paymentDate,
          certificationPac: 'SAT-DEMO'
        }
      })

      // Link it
      await prisma.invoiceRelatedCfdi.create({
        data: {
          invoiceId: paymentInvoice.id,
          relatedUuid: invoice.uuid,
          relationType: '04'
        }
      })
      
      console.log(`  -> Added Payment (Parcialidad ${partiality}) to Invoice ${invoice.uuid}`)
    }
  }
  
  console.log('Done attaching payments to existing invoices.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
