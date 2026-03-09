
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'crypto'

const prisma = new PrismaClient()

// Helper to generate random numbers
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min

async function main() {
  console.log('Starting seed for multi-payment invoices...')

  // 1. Get a valid user, org, and fiscal entity
  const fiscal = await prisma.fiscalEntity.findFirst({
    where: { rfc: 'SCI041122EI6' }, 
    include: { organization: true }
  }) || await prisma.fiscalEntity.findFirst({
    include: { organization: true }
  })

  if (!fiscal) {
    console.error('No fiscal entity found.')
    process.exit(1)
  }

  const org = fiscal.organization
  const user = await prisma.user.findFirst({
    where: { id: org.ownerId }
  })

  if (!user) {
    console.error('No user found.')
    process.exit(1)
  }

  console.log(`Using Fiscal Entity: ${fiscal.businessName} (${fiscal.rfc})`)

  const client = { rfc: 'MUL001234MP1', name: 'Cliente Multi Pagos SA de CV' }

  // Case 1: Invoice with 3 Partial Payments (Fully Paid)
  await createMultiPaymentInvoice(user, fiscal, client, 10000, [3000, 3000, 4000])

  // Case 2: Invoice with 2 Partial Payments (Still Pending)
  await createMultiPaymentInvoice(user, fiscal, client, 20000, [5000, 5000])

  // Case 3: Invoice with 1 Payment (Single Shot)
  await createMultiPaymentInvoice(user, fiscal, client, 5000, [5000])

  // Case 4: Invoice with 0 Payments (Pending)
  await createMultiPaymentInvoice(user, fiscal, client, 8000, [])

  // Case 5: Invoice with 1 Payment (Partial)
  await createMultiPaymentInvoice(user, fiscal, client, 15000, [1000])

  console.log('Successfully created 5 test records.')
}

async function createMultiPaymentInvoice(user, fiscal, client, subtotal, payments) {
  const ppdUuid = randomUUID()
  const issuanceDate = new Date() // Today
  
  const total = Number((subtotal * 1.16).toFixed(2))
  const iva = Number((subtotal * 0.16).toFixed(2))

  // Create PPD Invoice
  const ppdInvoice = await prisma.invoice.create({
    data: {
      userId: user.id,
      issuerFiscalEntityId: fiscal.id,
      uuid: ppdUuid,
      cfdiType: 'INGRESO',
      series: 'TEST',
      folio: `${rand(10000, 99999)}`,
      currency: 'MXN',
      status: 'ACTIVE',
      satStatus: 'VIGENTE',
      issuerRfc: fiscal.rfc,
      issuerName: fiscal.businessName,
      receiverRfc: client.rfc,
      receiverName: client.name,
      subtotal: subtotal,
      total: total,
      ivaTransferred: iva,
      paymentMethod: 'PPD',
      paymentForm: '99',
      cfdiUsage: 'G03',
      placeOfExpedition: fiscal.postalCode,
      xmlContent: `<cfdi:Comprobante Total="${total}" ...></cfdi:Comprobante>`, // Simplified
      issuanceDate: issuanceDate,
      certificationDate: issuanceDate,
      certificationPac: 'SAT-DEMO'
    }
  })

  console.log(`Created PPD Invoice: ${ppdInvoice.uuid} (Total: ${total})`)

  let currentBalance = total
  let parcialidad = 1

  for (const amount of payments) {
    const paymentDate = new Date(issuanceDate)
    paymentDate.setDate(paymentDate.getDate() + parcialidad) // Each payment 1 day apart
    
    const paymentUuid = randomUUID()
    const saldoAnt = currentBalance
    const saldoInsoluto = Number((saldoAnt - amount).toFixed(2))
    currentBalance = saldoInsoluto

    // XML for Payment
    const paymentXml = `
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:pago20="http://www.sat.gob.mx/Pagos20" Version="4.0" Serie="P" Folio="${rand(1000, 9999)}" Fecha="${paymentDate.toISOString()}" SubTotal="0" Moneda="XXX" Total="0" TipoDeComprobante="P" LugarExpedicion="${fiscal.postalCode}">
  <cfdi:Emisor Rfc="${fiscal.rfc}" Nombre="${fiscal.businessName}" RegimenFiscal="${fiscal.taxRegime}"/>
  <cfdi:Receptor Rfc="${client.rfc}" Nombre="${client.name}" UsoCFDI="CP01"/>
  <cfdi:Complemento>
    <pago20:Pagos Version="2.0">
      <pago20:Pago FechaPago="${paymentDate.toISOString()}" FormaDePagoP="03" MonedaP="MXN" Monto="${amount}" TipoCambioP="1">
        <pago20:DoctoRelacionado IdDocumento="${ppdUuid}" Serie="TEST" Folio="${ppdInvoice.folio}" MonedaDR="MXN" EquivalenciaDR="1" NumParcialidad="${parcialidad}" ImpSaldoAnt="${saldoAnt.toFixed(2)}" ImpPagado="${amount.toFixed(2)}" ImpSaldoInsoluto="${saldoInsoluto.toFixed(2)}" ObjetoImpDR="02"/>
      </pago20:Pago>
    </pago20:Pagos>
  </cfdi:Complemento>
</cfdi:Comprobante>`

    // Create Payment Invoice
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

    // Link
    await prisma.invoiceRelatedCfdi.create({
      data: {
        invoiceId: paymentInvoice.id,
        relatedUuid: ppdUuid,
        relationType: '04'
      }
    })

    console.log(`  -> Added Payment ${parcialidad}: ${amount} (New Balance: ${saldoInsoluto})`)
    parcialidad++
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
