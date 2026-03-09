
import { PrismaClient } from '@prisma/client'
import { v4 as uuidv4 } from 'uuid'

const prisma = new PrismaClient()

// Helper to generate random RFC
const generateRfc = (type = 'company') => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const nums = '0123456789'
  let rfc = ''
  if (type === 'company') {
    for (let i = 0; i < 3; i++) rfc += chars.charAt(Math.floor(Math.random() * chars.length))
  } else {
    for (let i = 0; i < 4; i++) rfc += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  for (let i = 0; i < 6; i++) rfc += nums.charAt(Math.floor(Math.random() * nums.length))
  for (let i = 0; i < 3; i++) rfc += chars.charAt(Math.floor(Math.random() * chars.length))
  return rfc
}

// Helper to generate random amount
const randomAmount = (min, max) => {
  return Number((Math.random() * (max - min) + min).toFixed(2))
}

async function main() {
  console.log('Starting seed...')

  // 1. Get Context (User and Fiscal Entity)
  const user = await prisma.user.findFirst()
  if (!user) {
    console.error('No user found. Please create a user first.')
    return
  }

  const fiscalEntity = await prisma.fiscalEntity.findFirst()
  if (!fiscalEntity) {
    console.error('No fiscal entity found. Please create one first.')
    return
  }

  console.log(`Using User: ${user.email} and FiscalEntity: ${fiscalEntity.rfc}`)
  const myRfc = fiscalEntity.rfc

  // Suppliers Pool
  const suppliers = Array.from({ length: 10 }).map(() => ({
    rfc: generateRfc('company'),
    name: `PROVEEDOR ${uuidv4().substring(0, 8).toUpperCase()} SA DE CV`
  }))

  const createdIngresosIds = []

  // 2. Create 100 Active Ingreso Invoices (Received from Suppliers)
  console.log('Creating 100 Active Ingreso Invoices...')
  for (let i = 0; i < 100; i++) {
    const supplier = suppliers[Math.floor(Math.random() * suppliers.length)]
    const uuid = uuidv4()
    const total = randomAmount(1000, 50000)
    const subtotal = Number((total / 1.16).toFixed(2))
    const iva = Number((total - subtotal).toFixed(2))

    await prisma.invoice.create({
      data: {
        userId: user.id,
        issuerFiscalEntityId: fiscalEntity.id,
        uuid: uuid,
        cfdiType: 'INGRESO',
        series: 'F',
        folio: String(i + 1000),
        currency: 'MXN',
        exchangeRate: 1,
        status: 'ACTIVE',
        satStatus: 'VIGENTE',
        issuerRfc: supplier.rfc,
        issuerName: supplier.name,
        receiverRfc: myRfc,
        receiverName: fiscalEntity.businessName,
        subtotal: subtotal,
        total: total,
        ivaTransferred: iva,
        issuanceDate: new Date(),
        certificationDate: new Date(),
        certificationPac: 'SAT',
        paymentMethod: 'PPD',
        paymentForm: '99',
        cfdiUsage: 'G03',
        placeOfExpedition: '64000',
        xmlContent: `<cfdi:Comprobante Total="${total}" SubTotal="${subtotal}" Moneda="MXN" TipoDeComprobante="I" Fecha="${new Date().toISOString()}"><cfdi:Emisor Rfc="${supplier.rfc}" Nombre="${supplier.name}"/><cfdi:Receptor Rfc="${myRfc}" Nombre="${fiscalEntity.businessName}"/></cfdi:Comprobante>`
      }
    })
    createdIngresosIds.push(uuid)
  }

  // 3. Create 30 Cancelled Ingreso Invoices
  console.log('Creating 30 Cancelled Ingreso Invoices...')
  for (let i = 0; i < 30; i++) {
    const supplier = suppliers[Math.floor(Math.random() * suppliers.length)]
    const uuid = uuidv4()
    const total = randomAmount(500, 10000)
    
    await prisma.invoice.create({
      data: {
        userId: user.id,
        issuerFiscalEntityId: fiscalEntity.id,
        uuid: uuid,
        cfdiType: 'INGRESO',
        series: 'C',
        folio: String(i + 5000),
        currency: 'MXN',
        exchangeRate: 1,
        status: 'CANCELLED',
        satStatus: 'CANCELADO',
        issuerRfc: supplier.rfc,
        issuerName: supplier.name,
        receiverRfc: myRfc,
        receiverName: fiscalEntity.businessName,
        subtotal: Number((total / 1.16).toFixed(2)),
        total: total,
        issuanceDate: new Date(),
        certificationDate: new Date(),
        certificationPac: 'SAT',
        paymentMethod: 'PUE',
        paymentForm: '03',
        cfdiUsage: 'G03',
        placeOfExpedition: '64000',
        xmlContent: ''
      }
    })
  }

  // 4. Create 50 Payment Invoices (Linked to Active Ingresos)
  console.log('Creating 50 Payment Invoices...')
  const invoicesToPay = createdIngresosIds.slice(0, 50)

  for (let i = 0; i < invoicesToPay.length; i++) {
    const relatedUuid = invoicesToPay[i]
    const relatedInvoice = await prisma.invoice.findUnique({ where: { uuid: relatedUuid } })
    if (!relatedInvoice) continue

    const paymentUuid = uuidv4()
    const amountPaid = Number(relatedInvoice.total)
    const supplier = suppliers.find(s => s.rfc === relatedInvoice.issuerRfc) || suppliers[0]

    const xml = `
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:pago20="http://www.sat.gob.mx/Pagos20" Version="4.0" Fecha="${new Date().toISOString()}" SubTotal="0" Total="0" Moneda="XXX" TipoDeComprobante="P">
  <cfdi:Emisor Rfc="${supplier.rfc}" Nombre="${supplier.name}"/>
  <cfdi:Receptor Rfc="${myRfc}" Nombre="${fiscalEntity.businessName}"/>
  <cfdi:Complemento>
    <pago20:Pagos Version="2.0">
      <pago20:Pago FechaPago="${new Date().toISOString()}" FormaDePagoP="03" MonedaP="MXN" Monto="${amountPaid.toFixed(2)}" TipoCambioP="1">
        <pago20:DoctoRelacionado IdDocumento="${relatedUuid}" MonedaDR="MXN" EquivalenciaDR="1" NumParcialidad="1" ImpSaldoAnt="${amountPaid.toFixed(2)}" ImpPagado="${amountPaid.toFixed(2)}" ImpSaldoInsoluto="0.00" ObjetoImpDR="01"/>
      </pago20:Pago>
    </pago20:Pagos>
  </cfdi:Complemento>
</cfdi:Comprobante>`

    await prisma.invoice.create({
      data: {
        userId: user.id,
        issuerFiscalEntityId: fiscalEntity.id,
        uuid: paymentUuid,
        cfdiType: 'PAGO',
        series: 'P',
        folio: String(i + 9000),
        currency: 'XXX',
        status: 'ACTIVE',
        satStatus: 'VIGENTE',
        issuerRfc: supplier.rfc,
        issuerName: supplier.name,
        receiverRfc: myRfc,
        receiverName: fiscalEntity.businessName,
        subtotal: 0,
        total: 0,
        issuanceDate: new Date(),
        certificationDate: new Date(),
        certificationPac: 'SAT',
        paymentMethod: '',
        paymentForm: '',
        cfdiUsage: 'CP01',
        placeOfExpedition: '64000',
        xmlContent: xml,
        relatedCfdis: {
          create: {
            relationType: 'Payment', 
            relatedUuid: relatedUuid
          }
        }
      }
    })
  }

  console.log('Seed completed successfully.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
