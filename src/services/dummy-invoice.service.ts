import { CfdiType, InvoiceStatus, SatStatus } from '@prisma/client'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'

export async function generateDummyInvoices(rfc: string, companyId: string) {
  try {
    // 1. Find a valid user and organization via CompanyAccess
    const access = await prisma.companyAccess.findFirst({
      where: { companyId },
      include: {
        member: {
          include: { user: true }
        },
        organization: true
      }
    })

    if (!access || !access.member?.user || !access.organization) {
      console.error(`[DummyGen] No valid user/org found for company ${companyId}`)
      return
    }

    const userId = access.member.userId
    const organizationId = access.organizationId

    // 2. Find or create FiscalEntity
    let fiscalEntity = await prisma.fiscalEntity.findUnique({
      where: { rfc }
    })

    if (!fiscalEntity) {
      const company = await prisma.company.findUnique({ where: { id: companyId } })
      
      fiscalEntity = await prisma.fiscalEntity.create({
        data: {
          rfc,
          organizationId,
          businessName: company?.businessName || 'Empresa Dummy',
          taxRegime: company?.taxRegime || '601',
          postalCode: company?.postalCode || '00000',
          isActive: true
        }
      })
    }

    // 3. Generate 200 invoices
    const invoicesData = []
    for (let i = 0; i < 200; i++) {
      const isReceived = i % 2 !== 0 
      const amount = Math.floor(Math.random() * 10000) + 100
      
      invoicesData.push({
        userId,
        issuerFiscalEntityId: fiscalEntity.id,
        uuid: randomUUID(),
        cfdiType: CfdiType.INGRESO,
        currency: 'MXN',
        issuerRfc: isReceived ? 'XAXX010101000' : rfc,
        issuerName: isReceived ? 'Publico General' : fiscalEntity.businessName,
        receiverRfc: isReceived ? rfc : 'XAXX010101000',
        receiverName: isReceived ? fiscalEntity.businessName : 'Publico General',
        subtotal: amount,
        total: amount * 1.16,
        xmlContent: '<xml>Dummy</xml>',
        issuanceDate: new Date(),
        certificationDate: new Date(),
        certificationPac: 'SAT',
        paymentMethod: 'PUE',
        paymentForm: '01',
        cfdiUsage: 'G03',
        placeOfExpedition: '00000',
        status: InvoiceStatus.ACTIVE,
        satStatus: SatStatus.VIGENTE
      })
    }
    
    await prisma.invoice.createMany({
      data: invoicesData
    })
    
    console.log(`[DummyGen] Generated 200 dummy invoices for ${rfc}`)
  } catch (error) {
    console.error('[DummyGen] Error generating dummy invoices:', error)
  }
}
