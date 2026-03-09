import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { CfdiType, InvoiceStatus, SatStatus } from '@prisma/client'

function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

export async function POST() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }
    const userId = session.user.id

    // Ensure organization
    let org = await prisma.organization.findFirst({ where: { ownerId: userId } })
    if (!org) {
      org = await prisma.organization.create({
        data: {
          name: 'Org Demo',
          slug: `org-demo-${Date.now()}`,
          ownerId: userId,
          onboardingCompleted: true,
          operationalAccessEnabled: true,
        }
      })
    }

    // Ensure member
    let member = await prisma.member.findFirst({ where: { userId, organizationId: org.id } })
    if (!member) {
      member = await prisma.member.create({
        data: { userId, organizationId: org.id, role: 'ADMIN', status: 'APPROVED' }
      })
    }

    // Create demo company (Factrónica)
    const rfc = 'SCI041122EI6'
    const businessName = 'Factrónica S de RL'
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
          createdBy: userId,
          updatedBy: userId,
        }
      })
    }

    // Link access
    const access = await prisma.companyAccess.upsert({
      where: { memberId_companyId: { memberId: member.id, companyId: company.id } },
      update: { role: 'ADMIN' },
      create: { organizationId: org.id, memberId: member.id, companyId: company.id, role: 'ADMIN' }
    })

    // Create fiscal entity mapped by RFC (Factrónica)
    let fiscal = await prisma.fiscalEntity.findFirst({ where: { organizationId: org.id, rfc } })
    if (!fiscal) {
      fiscal = await prisma.fiscalEntity.create({
        data: { organizationId: org.id, rfc, businessName, taxRegime: '601', postalCode: '04120', isActive: true }
      })
    }

    // Generate invoices across last 12 months
    const existing = await prisma.invoice.count({ where: { issuerFiscalEntityId: fiscal.id } })
    const countToCreate = existing > 0 ? 0 : 60
    const suppliers = [
      { rfc: 'PROV001234AB1', name: 'Proveedor Uno SA de CV' },
      { rfc: 'PROV00DEF5678', name: 'Servicios Globales MX SA de CV' },
      { rfc: 'PROV00XYZ9999', name: 'Distribuciones del Norte SA de CV' }
    ]
    const clients = [
      { rfc: 'CLI001234AB1', name: 'Cliente Uno SA de CV' },
      { rfc: 'CLI00DEF5678', name: 'Retail MX SA de CV' },
      { rfc: 'CLI00XYZ9999', name: 'Comercializadora Centro SA de CV' }
    ]

    if (countToCreate > 0) {
      const invoicesData = Array.from({ length: countToCreate }, (_, i) => {
        const issued = i % 2 === 0 // half issued by company, half received
        const date = new Date()
        const monthShift = rand(0, 11)
        date.setMonth(date.getMonth() - monthShift)
        const subtotal = rand(5000, 200000)
        const total = subtotal * 1.16
        const satStatus = [SatStatus.VIGENTE, SatStatus.CANCELADO, SatStatus.NO_ENCONTRADO][rand(0, 2)]
        const cfdiType = [CfdiType.INGRESO, CfdiType.EGRESO, CfdiType.PAGO, CfdiType.NOMINA][rand(0, 3)]
        const payMethod = ['PUE', 'PPD'][rand(0, 1)]
        const payForm = ['03', '01', '99'][rand(0, 2)]
        const issuer = issued ? { rfc, name: businessName } : suppliers[rand(0, suppliers.length - 1)]
        const receiver = issued ? clients[rand(0, clients.length - 1)] : { rfc, name: businessName }
        return {
          userId,
          issuerFiscalEntityId: fiscal.id,
          uuid: crypto.randomUUID(),
          cfdiType,
          series: issued ? 'S' : 'R',
          folio: `${rand(1000, 9999)}`,
          currency: 'MXN',
          exchangeRate: null,
          status: InvoiceStatus.ACTIVE,
          satStatus,
          issuerRfc: issuer.rfc,
          issuerName: issuer.name,
          receiverRfc: receiver.rfc,
          receiverName: receiver.name,
          subtotal,
          total,
          ivaTransferred: subtotal * 0.16,
          ivaWithheld: 0,
          isrWithheld: 0,
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

    // Create dedicated scenario for CHAU CHU CHIEN SA DE CV in fiscal control panel
    const chauRfc = 'CUCC4512065I7'
    const chauBusinessName = 'CHAU CHU CHIEN SA DE CV'

    let chauCompany = await prisma.company.findUnique({ where: { rfc: chauRfc } })
    if (!chauCompany) {
      chauCompany = await prisma.company.create({
        data: {
          name: chauBusinessName,
          rfc: chauRfc,
          businessName: chauBusinessName,
          taxRegime: '601',
          postalCode: '04120',
          status: 'APPROVED',
          createdBy: userId,
          updatedBy: userId,
        }
      })
    }

    const chauAccess = await prisma.companyAccess.upsert({
      where: { memberId_companyId: { memberId: member.id, companyId: chauCompany.id } },
      update: { role: 'ADMIN' },
      create: { organizationId: org.id, memberId: member.id, companyId: chauCompany.id, role: 'ADMIN' }
    })

    let chauFiscal = await prisma.fiscalEntity.findFirst({ where: { rfc: chauRfc } })
    if (!chauFiscal) {
      chauFiscal = await prisma.fiscalEntity.create({
        data: {
          organizationId: org.id,
          rfc: chauRfc,
          businessName: chauBusinessName,
          taxRegime: '601',
          postalCode: '04120',
          isActive: true,
        }
      })
    }

    const existingChauSat = await prisma.satInvoice.count({ where: { fiscalEntityId: chauFiscal.id } })
    const existingChauInvoices = await prisma.invoice.count({ where: { issuerFiscalEntityId: chauFiscal.id } })

    let chauSatCreated = 0
    let chauInvoicesCreated = 0

    if (existingChauSat === 0 && existingChauInvoices === 0) {
      const totalSat = 100
      const totalXml = 90
      const now = new Date()

      const chauSatData = Array.from({ length: totalSat }, (_, i) => {
        const issued = i % 2 === 0
        const date = new Date(now)
        date.setMonth(now.getMonth() - rand(0, 11))
        const subtotal = rand(5000, 200000)
        const total = Number((subtotal * 1.16).toFixed(2))
        const satStatus = [SatStatus.VIGENTE, SatStatus.CANCELADO, SatStatus.NO_ENCONTRADO][rand(0, 2)]
        const cfdiType = [CfdiType.INGRESO, CfdiType.EGRESO, CfdiType.PAGO, CfdiType.NOMINA][rand(0, 3)]
        const payMethod = ['PUE', 'PPD'][rand(0, 1)]
        const payForm = ['03', '01', '99'][rand(0, 2)]
        const issuer = issued ? { rfc: chauRfc, name: chauBusinessName } : suppliers[rand(0, suppliers.length - 1)]
        const receiver = issued ? clients[rand(0, clients.length - 1)] : { rfc: chauRfc, name: chauBusinessName }

        return {
          userId,
          fiscalEntityId: chauFiscal.id,
          uuid: crypto.randomUUID(),
          cfdiType,
          series: issued ? 'S' : 'R',
          folio: `${rand(1000, 9999)}`,
          currency: 'MXN',
          exchangeRate: null,
          status: InvoiceStatus.ACTIVE,
          satStatus,
          issuerRfc: issuer.rfc,
          issuerName: issuer.name,
          receiverRfc: receiver.rfc,
          receiverName: receiver.name,
          subtotal,
          discount: 0,
          total,
          ivaTrasladado: Number((subtotal * 0.16).toFixed(2)),
          ivaRetenido: 0,
          isrRetenido: 0,
          iepsRetenido: 0,
          xmlContent: '<xml>metadata</xml>',
          pdfUrl: null,
          issuanceDate: date,
          certificationDate: new Date(date.getTime() + 60000),
          certificationPac: 'SAT',
          paymentMethod: payMethod,
          paymentForm: payForm,
          usageCfdi: 'G03',
          expeditionPlace: '04120',
        }
      })

      await prisma.satInvoice.createMany({ data: chauSatData })
      chauSatCreated = chauSatData.length

      const chauInvoiceData = chauSatData.slice(0, totalXml).map((sat) => ({
        userId,
        issuerFiscalEntityId: chauFiscal!.id,
        uuid: sat.uuid,
        cfdiType: sat.cfdiType,
        series: sat.series,
        folio: sat.folio,
        currency: sat.currency,
        exchangeRate: sat.exchangeRate,
        status: sat.status,
        satStatus: sat.satStatus,
        issuerRfc: sat.issuerRfc,
        issuerName: sat.issuerName,
        receiverRfc: sat.receiverRfc,
        receiverName: sat.receiverName,
        subtotal: sat.subtotal,
        discount: sat.discount,
        total: sat.total,
        ivaTransferred: sat.ivaTrasladado,
        ivaWithheld: sat.ivaRetenido,
        isrWithheld: sat.isrRetenido,
        iepsWithheld: sat.iepsRetenido,
        xmlContent: '<xml>demo</xml>',
        pdfUrl: null,
        issuanceDate: sat.issuanceDate,
        certificationDate: sat.certificationDate,
        certificationPac: sat.certificationPac,
        paymentMethod: sat.paymentMethod,
        paymentForm: sat.paymentForm,
        cfdiUsage: sat.usageCfdi,
        placeOfExpedition: sat.expeditionPlace,
      }))

      await prisma.invoice.createMany({ data: chauInvoiceData })
      chauInvoicesCreated = chauInvoiceData.length
    }

    return NextResponse.json({
      organizationId: org.id,
      companyId: company.id,
      fiscalEntityId: fiscal.id,
      invoicesCreated: countToCreate,
      access: access.role,
      chauCompanyId: chauCompany.id,
      chauFiscalEntityId: chauFiscal.id,
      chauAccessRole: chauAccess.role,
      chauSatCreated,
      chauInvoicesCreated,
    })
  } catch (error) {
    console.error('Seed error', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
