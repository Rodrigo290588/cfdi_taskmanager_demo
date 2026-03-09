import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'crypto'

const prisma = new PrismaClient()

async function main() {
  console.log('Starting seed-ppd...')

  // 1. Get User
  let user = await prisma.user.findFirst()
  if (!user) {
    console.log('No user found, creating one...')
    user = await prisma.user.create({
      data: {
        email: 'demo@example.com',
        name: 'Demo User'
      }
    })
  }
  console.log(`Using user: ${user.email} (${user.id})`)

  // 2. Get/Create Org
  let org = await prisma.organization.findFirst({ where: { ownerId: user.id } })
  if (!org) {
    // try any org
    org = await prisma.organization.findFirst()
    if (!org) {
      console.log('Creating Org...')
      org = await prisma.organization.create({
        data: {
          name: 'Demo Org',
          slug: 'demo-org-' + Date.now(),
          ownerId: user.id,
          onboardingCompleted: true
        }
      })
    }
  }
  console.log(`Using org: ${org.name} (${org.id})`)

  // 3. Get/Create FiscalEntity
  const rfc = 'CUCC4512065I7'
  const businessName = 'CHAU CHU CHIEN SA DE CV'

  let fiscal = await prisma.fiscalEntity.findFirst({ where: { rfc } })
  if (!fiscal) {
    console.log('Creating FiscalEntity...')
    fiscal = await prisma.fiscalEntity.create({
      data: {
        organizationId: org.id,
        rfc,
        businessName,
        taxRegime: '601',
        postalCode: '04120',
        isActive: true
      }
    })
  }
  console.log(`Using FiscalEntity: ${fiscal.rfc} (${fiscal.id})`)

  // 4. Generate 100 PPD Invoices + Payments
  console.log('Generating 100 PPD Invoices and Payments...')
  
  for (let i = 0; i < 100; i++) {
    const total = Math.floor(Math.random() * 10000) + 1000 // 1000 to 11000
    const uuid = randomUUID()
    
    // Create PPD Invoice
    await prisma.invoice.create({
      data: {
        organizationId: org.id,
        userId: user.id,
        issuerFiscalEntityId: fiscal.id,
        uuid,
        cfdiType: 'INGRESO',
        series: 'PPD',
        folio: `A-${i + 1}`,
        currency: 'MXN',
        exchangeRate: 1,
        status: 'ACTIVE',
        satStatus: 'VIGENTE',
        issuerRfc: rfc,
        issuerName: businessName,
        receiverRfc: 'XAXX010101000',
        receiverName: 'PUBLICO EN GENERAL',
        subtotal: total / 1.16,
        total: total,
        paymentMethod: 'PPD',
        paymentForm: '99',
        cfdiUsage: 'G03',
        placeOfExpedition: '04120',
        xmlContent: '<xml>Dummy PPD</xml>',
        issuanceDate: new Date(),
        certificationDate: new Date(),
        certificationPac: 'DUMMY',
      }
    })

    // Create Payment (Partial)
    // Pay 50% to 90% of the total
    const paidAmount = Number((total * (0.5 + Math.random() * 0.4)).toFixed(2))
    const saldoInsoluto = Number((total - paidAmount).toFixed(2))
    const paymentUuid = randomUUID()
    
    // Construct XML for the payment
    const paymentXml = `
      <cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:pago20="http://www.sat.gob.mx/Pagos20">
        <cfdi:Complemento>
          <pago20:Pagos Version="2.0">
            <pago20:Pago Monto="${paidAmount}" MonedaP="MXN" FechaPago="${new Date().toISOString()}">
              <pago20:DoctoRelacionado 
                IdDocumento="${uuid}" 
                MonedaDR="MXN" 
                EquivalenciaDR="1" 
                NumParcialidad="1" 
                ImpSaldoAnt="${total.toFixed(2)}" 
                ImpPagado="${paidAmount.toFixed(2)}" 
                ImpSaldoInsoluto="${saldoInsoluto.toFixed(2)}" 
                ObjetoImpDR="02" 
              />
            </pago20:Pago>
          </pago20:Pagos>
        </cfdi:Complemento>
      </cfdi:Comprobante>
    `

    const paymentInvoice = await prisma.invoice.create({
      data: {
        userId: user.id,
        issuerFiscalEntityId: fiscal.id,
        uuid: paymentUuid,
        cfdiType: 'PAGO',
        series: 'P',
        folio: `P-${i + 1}`,
        currency: 'XXX',
        exchangeRate: 1,
        status: 'ACTIVE',
        satStatus: 'VIGENTE',
        issuerRfc: rfc,
        issuerName: businessName,
        receiverRfc: 'XAXX010101000',
        receiverName: 'PUBLICO EN GENERAL',
        subtotal: 0,
        total: 0,
        paymentMethod: 'PPD', // Usually empty or PPD for the related doc, but for the payment invoice itself it's often null/empty. Let's leave empty as per standard.
        paymentForm: '',
        cfdiUsage: 'CP01',
        placeOfExpedition: '04120',
        xmlContent: paymentXml,
        issuanceDate: new Date(),
        certificationDate: new Date(),
        certificationPac: 'DUMMY',
      }
    })

    // Link them in InvoiceRelatedCfdi
    // The Payment Invoice (paymentInvoice.id) has a relation to the PPD Invoice (uuid)
    await prisma.invoiceRelatedCfdi.create({
      data: {
        invoiceId: paymentInvoice.id,
        relationType: '04', // Generic substitution or just link
        relatedUuid: uuid,
      }
    })

    if (i % 10 === 0) process.stdout.write('.')
  }
  
  console.log('\nDone!')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
