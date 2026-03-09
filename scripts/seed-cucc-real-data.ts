import { PrismaClient, CfdiType, InvoiceStatus, SatStatus } from '@prisma/client'
import { v4 as uuidv4 } from 'uuid'

const prisma = new PrismaClient()

// Configuración
const TARGET_RFC = 'CUCC4512065I7'
const TARGET_NAME = 'CHAU CHU CHIEN SA DE CV'
const TOTAL_RECORDS = 1000
const RECORDS_WITH_XML = 800

// Datos auxiliares
const CONCEPTS = [
  { description: 'Servicios de Consultoría de Software', key: '81111500', unit: 'E48', unitVal: 15000 },
  { description: 'Desarrollo de Módulos Web', key: '43232400', unit: 'E48', unitVal: 25000 },
  { description: 'Licencia de Uso de Software', key: '43232800', unit: 'E48', unitVal: 5000 },
  { description: 'Soporte Técnico Mensual', key: '81111801', unit: 'E48', unitVal: 2000 },
  { description: 'Capacitación de Personal', key: '86101700', unit: 'E48', unitVal: 8000 },
]

const PARTNERS = [
  { rfc: 'XAXX010101000', name: 'PUBLICO EN GENERAL' },
  { rfc: 'GOMC8001015A0', name: 'GRUPO COMERCIAL DEL NORTE SA DE CV' },
  { rfc: 'TECN900202123', name: 'TECNOLOGIA AVANZADA DE MEXICO SC' },
  { rfc: 'CONS000303XYZ', name: 'CONSTRUCTORA Y EDIFICADORA DEL SUR SA DE CV' },
  { rfc: 'DIST990404ABC', name: 'DISTRIBUIDORA DE ALIMENTOS Y BEBIDAS SA DE CV' },
  { rfc: 'SERV880505DEF', name: 'SERVICIOS PROFESIONALES INTEGRALES SC' },
]

function getRandomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function getRandomDate(start: Date, end: Date): Date {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()))
}

async function main() {
  console.log(`Iniciando generación de datos para ${TARGET_RFC}...`)

  // 1. Buscar entidad objetivo
  const targetEntity = await prisma.fiscalEntity.findUnique({
    where: { rfc: TARGET_RFC },
    include: { organization: true },
  })

  if (!targetEntity) {
    console.error(`No se encontró la entidad fiscal con RFC ${TARGET_RFC}. Asegúrate de que exista en la BD.`)
    process.exit(1)
  }

  const userId = targetEntity.organization.ownerId
  if (!userId) {
    console.error('La organización de la entidad no tiene ownerId.')
    process.exit(1)
  }

  console.log(`Entidad encontrada: ${targetEntity.businessName} (ID: ${targetEntity.id})`)

  // 2. Crear entidades dummy para contrapartes (para poder ligar Invoices recibidas)
  // Usaremos la misma organización para simplificar
  const partnerEntities = []
  for (const p of PARTNERS) {
    // Buscar si ya existe, si no crear
    let partner = await prisma.fiscalEntity.findUnique({ where: { rfc: p.rfc } })
    if (!partner) {
      partner = await prisma.fiscalEntity.create({
        data: {
          rfc: p.rfc,
          businessName: p.name,
          taxRegime: '601',
          postalCode: '00000',
          organizationId: targetEntity.organizationId,
        },
      })
      console.log(`Creada entidad partner: ${p.name}`)
    }
    partnerEntities.push(partner)
  }

  // 3. Generar registros
  const satInvoicesData = []
  const invoicesData = []

  const startDate = new Date('2024-01-01')
  const endDate = new Date('2025-12-31')

  for (let i = 0; i < TOTAL_RECORDS; i++) {
    const isIssued = Math.random() > 0.4 // 60% Emitidas, 40% Recibidas
    const partner = getRandomItem(partnerEntities)
    
    const issuerRfc = isIssued ? TARGET_RFC : partner.rfc
    const issuerName = isIssued ? TARGET_NAME : partner.businessName
    const receiverRfc = isIssued ? partner.rfc : TARGET_RFC
    const receiverName = isIssued ? partner.businessName : TARGET_NAME
    
    // Determinar IDs para Invoice
    // Si es emitida, issuerFiscalEntityId es targetEntity.id
    // Si es recibida, issuerFiscalEntityId es partner.id
    const issuerFiscalEntityId = isIssued ? targetEntity.id : partner.id

    const uuid = uuidv4()
    const issuanceDate = getRandomDate(startDate, endDate)
    const certificationDate = new Date(issuanceDate.getTime() + 1000 * 60 * 5) // 5 min después
    
    // Montos
    const concept = getRandomItem(CONCEPTS)
    const quantity = Math.floor(Math.random() * 5) + 1
    const subtotal = Number((concept.unitVal * quantity).toFixed(2))
    const discount = Math.random() > 0.8 ? Number((subtotal * 0.05).toFixed(2)) : 0
    const base = subtotal - discount
    const ivaRate = 0.16
    const ivaTrasladado = Number((base * ivaRate).toFixed(2))
    const total = Number((base + ivaTrasladado).toFixed(2))

    // Estatus
    const isCancelled = Math.random() > 0.9 // 10% canceladas
    const satStatus = isCancelled ? SatStatus.CANCELADO : SatStatus.VIGENTE
    const invoiceStatus = isCancelled ? InvoiceStatus.CANCELLED : InvoiceStatus.ACTIVE

    // Datos comunes limpios (sin campos que varían de nombre)
    const common = {
      uuid,
      issuerRfc,
      issuerName,
      receiverRfc,
      receiverName,
      issuanceDate,
      certificationDate,
      total,
      subtotal,
      discount,
      currency: 'MXN',
      cfdiType: CfdiType.INGRESO,
      satStatus,
      status: invoiceStatus,
      xmlContent: `<cfdi:Comprobante Total="${total}" SubTotal="${subtotal}" Fecha="${issuanceDate.toISOString()}"><cfdi:Emisor Rfc="${issuerRfc}" Nombre="${issuerName}"/><cfdi:Receptor Rfc="${receiverRfc}" Nombre="${receiverName}"/></cfdi:Comprobante>`,
      userId,
      paymentMethod: 'PUE',
      paymentForm: '03',
      certificationPac: 'SAT970701NN3'
    }

    // Crear SatInvoice
    satInvoicesData.push({
      ...common,
      ivaTrasladado, // Nombre específico SatInvoice
      usageCfdi: 'G03', // Nombre específico SatInvoice
      expeditionPlace: '64000', // Nombre específico SatInvoice
      fiscalEntityId: targetEntity.id,
      series: 'A',
      folio: i.toString(),
    })

    // Crear Invoice
    if (i < RECORDS_WITH_XML) {
      invoicesData.push({
        ...common,
        ivaTransferred: ivaTrasladado, // Nombre específico Invoice
        cfdiUsage: 'G03', // Nombre específico Invoice
        placeOfExpedition: '64000', // Nombre específico Invoice
        issuerFiscalEntityId,
        series: 'A',
        folio: i.toString(),
      })
    }
      
      // Conceptos para Invoice
      // Necesitaremos insertar los conceptos después de insertar las facturas, o uno por uno.
      // createMany no soporta relaciones anidadas.
      // Lo haremos en un paso posterior si es necesario, o simplificamos insertando uno a uno.
      // Para eficiencia, mejor insertamos Invoices primero y luego Conceptos si fuera crítico,
      // pero aquí 1000 registros no son tantos, podemos hacer un loop de create.
    }

  console.log(`Preparados ${satInvoicesData.length} registros SatInvoice y ${invoicesData.length} Invoice.`)
  console.log('Insertando en base de datos (esto puede tomar unos momentos)...')

  // Insertar SatInvoices (createMany es rápido)
  // Dividir en chunks si es necesario, pero 1000 pasa bien.
  await prisma.satInvoice.createMany({
    data: satInvoicesData,
    skipDuplicates: true,
  })
  console.log('SatInvoices insertados.')

  // Insertar Invoices e InvoiceConcepts
  // Como createMany no devuelve los IDs generados (y necesitamos IDs para conceptos si usamos autoincrement),
  // y el campo ID es CUID generado por Prisma (o default DB),
  // Invoice usa @default(cuid()) para ID.
  // Si usamos createMany, no obtendremos los IDs para insertar conceptos.
  // Opción 1: Insertar uno por uno (lento pero seguro).
  // Opción 2: Generar CUIDs manualmente en el script.
  // Usaremos Opción 1 para simplificar código, 800 inserts no tardarán tanto en local.

  let insertedInvoices = 0
  for (const invData of invoicesData) {
    try {
      await prisma.invoice.create({
        data: {
          ...invData,
          concepts: {
            create: [
              {
                description: 'Servicio Profesional',
                productServiceKey: '81111500',
                unitQuantity: 1,
                unitKey: 'E48',
                unitValue: invData.subtotal,
                amount: invData.subtotal,
                objectOfTax: '02',
                transferredTaxesJson: JSON.stringify([{ base: invData.subtotal, tax: '002', type: 'Tasa', rate: 0.16, amount: invData.ivaTransferred }]),
              }
            ]
          }
        }
      })
      insertedInvoices++
      if (insertedInvoices % 100 === 0) process.stdout.write('.')
    } catch (e) {
      console.error(`Error insertando invoice ${invData.uuid}:`, e)
    }
  }
  console.log(`\nInvoices insertados: ${insertedInvoices}`)

  console.log('Generación de datos completada.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
