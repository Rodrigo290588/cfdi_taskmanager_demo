import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const invoiceUuid = '7CCE029E-1852-4E4F-B2E8-7C437F17CB8F'
  const paymentUuid = '409EF8AA-B259-434E-A2A1-8B811E450947'

  const invoice = await prisma.invoice.findFirst({ where: { uuid: invoiceUuid } })
  console.log('Invoice:', invoice ? 'Found' : 'Not found')

  const payment = await prisma.invoice.findFirst({ where: { uuid: paymentUuid } })
  console.log('Payment Invoice:', payment ? 'Found' : 'Not found')

  if (payment) {
    console.log('Payment cfdiType:', payment.cfdiType)
    console.log('Payment satStatus:', payment.satStatus)
  }

  const paymentDetails = await prisma.invoicePaymentComplementDetail.findMany({
    where: { relatedInvoiceUuid: invoiceUuid }
  })
  console.log('Payment Details (invoicePaymentComplementDetail):', paymentDetails.length)
  if (paymentDetails.length > 0) {
    console.log(paymentDetails)
  }

  const related = await prisma.invoiceRelatedCfdi.findMany({
    where: { relatedUuid: invoiceUuid }
  })
  console.log('Related CFDI (invoiceRelatedCfdi):', related.length)
  if (related.length > 0) {
    console.log(related)
  }
}
main().catch(console.error).finally(() => prisma.$disconnect())