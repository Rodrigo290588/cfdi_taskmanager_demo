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

    // 3. Generate 50 invoices with concepts and taxes (reduced from 200 for performance with nested writes)
    console.log(`[DummyGen] Starting generation of 50 invoices with concepts for ${rfc}...`)
    
    for (let i = 0; i < 50; i++) {
      const isReceived = i % 2 !== 0 
      const amount = Math.floor(Math.random() * 10000) + 100
      
      // Determine Tax Rate
      const rand = Math.random();
      let taxRate = 0.16;
      let taxType = 'Tasa';
      const taxCode = '002'; // IVA
      
      if (rand < 0.6) {
        taxRate = 0.16; // 60% chance 16%
      } else if (rand < 0.8) {
        taxRate = 0.08; // 20% chance 8%
      } else if (rand < 0.9) {
        taxRate = 0.00; // 10% chance 0%
      } else {
        taxRate = 0; 
        taxType = 'Exento'; // 10% chance Exempt
      }

      const taxAmount = taxType === 'Exento' ? 0 : amount * taxRate;
      const total = amount + taxAmount;

      const transferredTaxes = [
        {
          Base: amount.toFixed(2),
          Impuesto: taxCode,
          TipoFactor: taxType,
          TasaOCuota: taxType === 'Exento' ? null : taxRate.toFixed(6),
          Importe: taxType === 'Exento' ? null : taxAmount.toFixed(2)
        }
      ];

      // Simple XML construction
      const xml = `
<cfdi:Comprobante Total="${total.toFixed(2)}" SubTotal="${amount.toFixed(2)}">
  <cfdi:Emisor Rfc="${isReceived ? 'XAXX010101000' : rfc}" Nombre="${isReceived ? 'Publico General' : fiscalEntity.businessName}"/>
  <cfdi:Receptor Rfc="${isReceived ? rfc : 'XAXX010101000'}" Nombre="${isReceived ? fiscalEntity.businessName : 'Publico General'}"/>
  <cfdi:Conceptos>
    <cfdi:Concepto Importe="${amount.toFixed(2)}" ValorUnitario="${amount.toFixed(2)}" Descripcion="Producto Dummy">
      <cfdi:Impuestos>
        <cfdi:Traslados>
          <cfdi:Traslado Base="${amount.toFixed(2)}" Impuesto="002" TipoFactor="${taxType}" TasaOCuota="${taxType === 'Exento' ? '' : taxRate.toFixed(6)}" Importe="${taxType === 'Exento' ? '' : taxAmount.toFixed(2)}"/>
        </cfdi:Traslados>
      </cfdi:Impuestos>
    </cfdi:Concepto>
  </cfdi:Conceptos>
</cfdi:Comprobante>
      `.trim();

      await prisma.invoice.create({
        data: {
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
          total: total,
          xmlContent: xml,
          issuanceDate: new Date(),
          certificationDate: new Date(),
          certificationPac: 'SAT',
          paymentMethod: 'PUE',
          paymentForm: '01',
          cfdiUsage: 'G03',
          placeOfExpedition: '00000',
          status: InvoiceStatus.ACTIVE,
          satStatus: SatStatus.VIGENTE,
          concepts: {
            create: {
              description: 'Producto Dummy',
              productServiceKey: '01010101',
              unitQuantity: 1,
              unitKey: 'H87',
              unitValue: amount,
              amount: amount,
              objectOfTax: '02', // Sí objeto de impuesto
              transferredTaxesJson: transferredTaxes
            }
          }
        }
      });
    }
    
    console.log(`[DummyGen] Generated 50 dummy invoices with concepts for ${rfc}`)
  } catch (error) {
    console.error('[DummyGen] Error generating dummy invoices:', error)
  }
}
