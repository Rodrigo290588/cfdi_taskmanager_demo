import { PrismaClient } from '@prisma/client'

console.log("Running updated seed-dev.mjs")

const prisma = new PrismaClient({ log: ['query'] })

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

async function seedCompany({ user, org, member, rfc, businessName, targetCount = 120 }) {
  let company = await prisma.company.findUnique({ where: { rfc } })
  if (!company) {
    company = await prisma.company.create({
      data: {
        name: businessName,
        rfc,
        businessName,
        taxRegime: '601',
        postalCode: '04120',
        status: 'APPROVED',
        createdBy: user.id,
        updatedBy: user.id,
      }
    })
  }

  await prisma.companyAccess.upsert({
    where: { memberId_companyId: { memberId: member.id, companyId: company.id } },
    update: { role: 'ADMIN' },
    create: { organizationId: org.id, memberId: member.id, companyId: company.id, role: 'ADMIN' }
  })

  let fiscal = await prisma.fiscalEntity.findUnique({ where: { rfc } })
  if (!fiscal) {
    fiscal = await prisma.fiscalEntity.create({
      data: { organizationId: org.id, rfc, businessName, taxRegime: '601', postalCode: '04120', isActive: true }
    })
  } else if (fiscal.organizationId !== org.id) {
    // If it exists but belongs to another org, move it to the demo org (optional, but ensures demo user sees it)
    console.log(`Moving FiscalEntity ${rfc} from org ${fiscal.organizationId} to ${org.id}`)
    fiscal = await prisma.fiscalEntity.update({
      where: { id: fiscal.id },
      data: { organizationId: org.id }
    })
  }

  const existing = await prisma.invoice.count({ where: { issuerFiscalEntityId: fiscal.id } })
  const toCreate = Math.max(0, targetCount - existing)

  const suppliers = [
    { rfc: 'PROV001234AB1', name: 'Proveedor Uno SA de CV' },
    { rfc: 'PROV00DEF5678', name: 'Servicios Globales MX SA de CV' },
    { rfc: 'PROV00XYZ9999', name: 'Distribuciones del Norte SA de CV' },
    { rfc: 'PROV00FOO1111', name: 'Tecnologías Avanzadas SA de CV' },
    { rfc: 'PROV00BAR2222', name: 'Consultoría Fiscal MX SA de CV' }
  ]
  const clients = [
    { rfc: 'CLI001234AB1', name: 'Cliente Uno SA de CV' },
    { rfc: 'CLI00DEF5678', name: 'Retail MX SA de CV' },
    { rfc: 'CLI00XYZ9999', name: 'Comercializadora Centro SA de CV' },
    { rfc: 'CLI00BAZ3333', name: 'Servicios Integrales MX SA de CV' }
  ]

  if (toCreate > 0) {
    const invoicesData = Array.from({ length: toCreate }, (_, i) => {
      const issued = i % 3 !== 0 // ~66% emitidas, ~34% recibidas
      const date = new Date()
      const monthShift = rand(0, 11)
      date.setMonth(date.getMonth() - monthShift)
      const subtotal = rand(5000, 350000)
      const total = Number((subtotal * 1.16).toFixed(2))
      const satStatusPool = ['VIGENTE', 'CANCELADO', 'NO_ENCONTRADO']
      const satStatus = satStatusPool[rand(0, satStatusPool.length - 1)]
      const cfdiTypePool = ['INGRESO', 'EGRESO', 'PAGO', 'NOMINA', 'TRASLADO']
      const cfdiType = cfdiTypePool[rand(0, cfdiTypePool.length - 1)]
      const payMethod = ['PUE', 'PPD'][rand(0, 1)]
      const payFormPool = ['03', '01', '99', '28']
      const payForm = payFormPool[rand(0, payFormPool.length - 1)]
      const issuer = issued ? { rfc, name: businessName } : suppliers[rand(0, suppliers.length - 1)]
      const receiver = issued ? clients[rand(0, clients.length - 1)] : { rfc, name: businessName }
      return {
        userId: user.id,
        issuerFiscalEntityId: fiscal.id,
        uuid: crypto.randomUUID(),
        cfdiType,
        series: issued ? 'S' : 'R',
        folio: `${rand(1000, 9999)}`,
        currency: 'MXN',
        exchangeRate: null,
        status: 'ACTIVE',
        satStatus,
        issuerRfc: issuer.rfc,
        issuerName: issuer.name,
        receiverRfc: receiver.rfc,
        receiverName: receiver.name,
        subtotal,
        total,
        ivaTransferred: Number((subtotal * 0.16).toFixed(2)),
        ivaWithheld: rand(0, 1) ? Number((subtotal * 0.04).toFixed(2)) : 0,
        isrWithheld: rand(0, 1) ? Number((subtotal * 0.10).toFixed(2)) : 0,
        iepsWithheld: 0,
        xmlContent: '<xml>demo</xml>',
        pdfUrl: null,
        issuanceDate: date,
        certificationDate: new Date(date.getTime() + 60000),
        certificationPac: 'PAC DEMO',
        paymentMethod: payMethod,
        paymentForm: payForm,
        cfdiUsage: 'G03',
        placeOfExpedition: '04120',
      }
    })
    await prisma.invoice.createMany({ data: invoicesData })
  }

  console.log('Seed company completed', { rfc, companyId: company.id, fiscalEntityId: fiscal.id, created: toCreate })
}

async function main() {
  const email = 'demo@local.test'
  let user = await prisma.user.findUnique({ where: { email } })
  if (!user) {
    user = await prisma.user.create({
      data: { email, name: 'Usuario Demo', systemRole: 'ADMIN' }
    })
  }

  let org = await prisma.organization.findFirst({ where: { ownerId: user.id } })
  if (!org) {
    org = await prisma.organization.create({
      data: {
        name: 'Org Demo',
        slug: `org-demo-${Date.now()}`,
        ownerId: user.id,
        onboardingCompleted: true,
        operationalAccessEnabled: true,
      }
    })
  }

  let member = await prisma.member.findFirst({ where: { userId: user.id, organizationId: org.id } })
  if (!member) {
    member = await prisma.member.create({
      data: { userId: user.id, organizationId: org.id, role: 'ADMIN', status: 'APPROVED' }
    })
  }

  await seedCompany({ user, org, member, rfc: 'SCI041122EI6', businessName: 'Factrónica S de RL', targetCount: 180 })
  await seedCompany({ user, org, member, rfc: 'SCI041122EI5', businessName: 'Servicios Corporativos ITC SA de CV', targetCount: 140 })

  console.log('Seed completed for both companies', { organizationId: org.id })
}

main().then(() => prisma.$disconnect()).catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
