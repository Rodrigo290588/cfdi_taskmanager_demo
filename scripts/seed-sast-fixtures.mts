import { PrismaClient, SystemRole, MemberRole, CfdiType, InvoiceStatus, SatStatus, RequestStatus, CompanyStatus } from '@prisma/client'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'

const prisma = new PrismaClient()

const ORG_A_ID = 'cmnntrppk000502gcp93ketfx'
const ORG_B_ID = 'cmipiwlqk000mvyvtc22tnlrb'

const COMPANY_A2_ID = 'cmnnunarz000802gccsfno9x5'
const COMPANY_B2_ID = 'cmipm3aze000pvyvt6q649yye'

const FE_A1_ID_EXISTING = 'cmnnz2tka000102tko4p0hn49'
const FE_A_RFC = 'ODE8604257UA'

const FE_B1_ID_EXISTING = 'cmipmamqx0014vyvtwv9hs45x'
const FE_B_RFC_EXISTING = 'SCI041122EI5'

const MDR_A_EXISTING_ID = 'cmlr74hh00009fdc8939soc95'
const MDR_B_EXISTING_ID = 'cmlsilswo0003fdy88s3thgi0'
const INVOICE_A_HAPPY_EXISTING_UUID = '8f89461e-5ba0-4a24-adfc-66065fd4b01a'
const INVOICE_B_ATTACK_EXISTING_UUID = 'cb12477b-e214-4cd8-b339-4d1bb5192885'

async function ensureOrganization(id: string, slug: string, name: string, ownerEmail?: string) {
  let org = await prisma.organization.findUnique({
    where: { id },
    select: { id: true, slug: true, name: true }
  })
  if (!org) {
    org = await prisma.organization.create({
      data: {
        id,
        name,
        slug,
        description: `Organización de prueba SAST: ${name}`,
        country: 'México',
        onboardingCompleted: true,
        operationalAccessEnabled: false
      },
      select: { id: true, slug: true, name: true }
    })
    console.log('ORG_CREATED', org.id, org.slug, org.name)
  }
  return org
}

async function ensureUser(email: string, name: string, systemRole: SystemRole, password: string) {
  const hashed = await bcrypt.hash(password, 10)
  let u = await prisma.user.findUnique({ where: { email }, select: { id: true, systemRole: true } })
  if (!u) {
    u = await prisma.user.create({
      data: {
        email,
        name,
        password: hashed,
        systemRole,
        emailVerified: new Date()
      },
      select: { id: true, systemRole: true }
    })
    console.log('USER_CREATED', email, u.id, 'role=', u.systemRole)
  } else {
    const patch: any = { systemRole }
    if (password) patch.password = hashed
    await prisma.user.update({ where: { email }, data: patch })
    console.log('USER_UPDATED', email, u.id, 'role=', u.systemRole, '->', systemRole)
  }
  return u
}

async function ensureMembership(userId: string, organizationId: string, role: MemberRole, status: string = 'APPROVED') {
  let m = await prisma.member.findFirst({
    where: { userId, organizationId },
    select: { id: true }
  })
  if (!m) {
    m = await prisma.member.create({
      data: { userId, organizationId, role, status },
      select: { id: true }
    })
    console.log('MEMBERSHIP_CREATED', userId, organizationId, role, m.id)
  } else {
    await prisma.member.update({ where: { id: m.id }, data: { role, status } })
    console.log('MEMBERSHIP_UPDATED', userId, organizationId, role, m.id)
  }
  return m
}

async function ensureCompanyAccess(companyId: string, organizationId: string, memberId: string) {
  const exists = await prisma.companyAccess.count({ where: { companyId, memberId } })
  if (exists === 0) {
    const ca = await prisma.companyAccess.create({ data: { companyId, organizationId, memberId, role: 'ADMIN' as any } })
    console.log('COMPANY_ACCESS_CREATED', companyId, organizationId, memberId, ca.id)
  }
}

function randomRfcPersonaMoral(prefix = 'TST') {
  const sixDigits = String(Math.floor(100000 + Math.random() * 900000))
  const homoclave = Math.random().toString(36).slice(2, 5).toUpperCase().replace(/O/gi, '0').replace(/I/gi, '1')
  return `${prefix}${sixDigits}${homoclave}`
}

async function ensureFiscalEntity(rfc: string, organizationId: string) {
  let fe = await prisma.fiscalEntity.findUnique({ where: { rfc } })
  if (!fe) {
    fe = await prisma.fiscalEntity.create({
      data: {
        rfc,
        organizationId,
        businessName: `Entidad Fiscal Prueba ${rfc}`,
        taxRegime: '601',
        postalCode: '06000',
        isActive: true
      }
    })
    console.log('FE_CREATED', rfc, organizationId, fe.id)
  }
  return fe
}

async function ensureCompany(rfc: string, organizationId: string, memberId?: string, extra: any = {}) {
  let c = await prisma.company.findUnique({ where: { rfc } })
  if (!c) {
    c = await prisma.company.create({
      data: {
        rfc,
        name: `Empresa Prueba ${rfc}`,
        businessName: `Empresa Prueba ${rfc} SA de CV`,
        taxRegime: '601',
        postalCode: '06000',
        country: 'México',
        status: CompanyStatus.APPROVED,
        createdBy: 'seed-sast',
        updatedBy: 'seed-sast',
        ...extra
      }
    })
    console.log('COMPANY_CREATED', rfc, organizationId, c.id)
  }
  if (memberId) {
    await ensureCompanyAccess(c.id, organizationId, memberId)
  }
  return c
}

async function ensureInvoice(uuid: string, orgIssuerFeId: string, issuerRfc: string, receiverRfc: string, ensureXml = false) {
  let inv = await prisma.invoice.findUnique({ where: { uuid } })
  const xml = `<?xml version="1.0" encoding="UTF-8"?><cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Serie="A" Folio="${Math.floor(Math.random()*999999)}" Fecha="${new Date().toISOString().slice(0,19)}" Sello="SELLO_FAKE" FormaPago="01" NoCertificado="00000000000000000000" Certificado="CERTFAKE" SubTotal="1000.00" Total="1160.00" Moneda="MXN" TipoDeComprobante="I" MetodoPago="PUE" LugarExpedicion="06000" Confirmacion="0000"><cfdi:Emisor Rfc="${issuerRfc}" Nombre="Emisor SA" RegimenFiscal="601"/><cfdi:Receptor Rfc="${receiverRfc}" Nombre="Cliente" DomicilioFiscalReceptor="06000" RegimenFiscalReceptor="601" UsoCFDI="G01"/><cfdi:Conceptos><cfdi:Concepto ClaveProdServ="01010101" Cantidad="1" ClaveUnidad="ACT" Descripcion="Servicio de prueba SAST" ValorUnitario="1000.00" Importe="1000.00" ObjetoImp="02"><cfdi:Impuestos><cfdi:Traslados><cfdi:Traslado Base="1000.00" Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="160.00"/></cfdi:Traslados></cfdi:Impuestos></cfdi:Concepto></cfdi:Conceptos><cfdi:Impuestos TotalImpuestosTrasladados="160.00"><cfdi:Traslados><cfdi:Traslado Impuesto="002" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="160.00"/></cfdi:Traslados></cfdi:Impuestos><cfdi:Complemento><tfd:TimbreFiscalDigital xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="1.1" UUID="${uuid}" FechaTimbrado="${new Date().toISOString().slice(0,19)}" RfcProvCertif="SAT000000000" SelloCFD="SELLO" SelloSAT="SELLO" NoCertificadoSAT="00000000000000000000"/></cfdi:Complemento></cfdi:Comprobante>`

  if (!inv) {
    inv = await prisma.invoice.create({
      data: {
        uuid,
        cfdiType: CfdiType.INGRESO,
        issuerFiscalEntityId: orgIssuerFeId,
        issuerRfc,
        issuerName: `Emisor Prueba ${issuerRfc}`,
        receiverRfc,
        receiverName: `Receptor Prueba ${receiverRfc}`,
        subtotal: 1000,
        total: 1160,
        ivaTransferred: 160,
        currency: 'MXN',
        status: InvoiceStatus.ACTIVE,
        satStatus: SatStatus.VIGENTE,
        issuanceDate: new Date(),
        certificationDate: new Date(),
        certificationPac: 'PAC-SAST-TEST',
        paymentMethod: 'PUE',
        paymentForm: '01',
        cfdiUsage: 'G01',
        placeOfExpedition: '06000',
        exportKey: '01',
        userId: ensureXml ? (
          (await prisma.user.findFirst({ where: { email: 'sa-sast@itcomplements.com' }, select: { id: true } }))?.id || undefined
        ) : undefined,
        xmlContent: ensureXml ? xml : (inv?.xmlContent || xml)
      }
    })
    console.log('INVOICE_CREATED', uuid, issuerRfc, '->', receiverRfc)
  } else if (ensureXml && !inv.xmlContent) {
    inv = await prisma.invoice.update({ where: { uuid }, data: { xmlContent: xml } })
    console.log('INVOICE_XML_PATCHED', uuid)
  }
  return inv
}

async function ensureMassDownloadRequest(args: {
  id?: string
  companyId: string
  requestingRfc: string
  issuerRfc: string
  satPackageId: string
  startDate: Date
  endDate: Date
  status?: RequestStatus
}) {
  const { id, companyId, requestingRfc, issuerRfc, satPackageId, startDate, endDate, status = RequestStatus.TERMINADO } = args
  let mdr = id ? await prisma.massDownloadRequest.findUnique({ where: { id } }) : null
  if (!mdr) {
    mdr = await prisma.massDownloadRequest.create({
      data: {
        id: id || undefined,
        companyId,
        requestingRfc,
        issuerRfc,
        satPackageId,
        requestType: 'EMITIDOS',
        retrievalType: 'emitidos',
        status: 'Todos',
        voucherType: 'I',
        startDate,
        endDate,
        requestStatus: status
      }
    })
    console.log('MDR_CREATED', mdr.id, requestingRfc, satPackageId)
  }
  return mdr
}

async function main() {
  await prisma.$connect()

  // Crear Organizaciones PRIMERO (FK en members y fiscalEntities)
  await ensureOrganization(ORG_A_ID, 'grupo-demo-sast-a', 'Grupo Demo SAST (Org-A)')
  await ensureOrganization(ORG_B_ID, 'itcomplements-sast-b', 'ITComplements SAST (Org-B)')

  const U_ADM_EMAIL = 'rtorreh@itcomplements.com'
  const U_ADM_PASS = 'Holamundo1?'
  const uAdm = await ensureUser(U_ADM_EMAIL, 'Rodrigo Edmundo Torre Hernández', SystemRole.ADMIN, U_ADM_PASS)
  await ensureMembership(uAdm.id, ORG_A_ID, MemberRole.ADMIN, 'APPROVED')
  const memAdm = await prisma.member.findFirstOrThrow({ where: { userId: uAdm.id, organizationId: ORG_A_ID }, select: { id: true } })

  const U_SA_EMAIL = 'sa-sast@itcomplements.com'
  const uSa = await ensureUser(U_SA_EMAIL, 'QA SuperAdmin SAST', SystemRole.SUPER_ADMIN, 'SAST-Super@dmin123!')
  await ensureMembership(uSa.id, ORG_A_ID, MemberRole.ADMIN, 'APPROVED')

  const U_CAD_EMAIL = 'audit-sast@itcomplements.com'
  const uCad = await ensureUser(U_CAD_EMAIL, 'QA Auditor SAST Org-A', SystemRole.USER, 'Auditor-123!')
  await ensureMembership(uCad.id, ORG_A_ID, MemberRole.AUDITOR, 'APPROVED')
  const memCad = await prisma.member.findFirstOrThrow({ where: { userId: uCad.id, organizationId: ORG_A_ID }, select: { id: true } })

  const U_OTH_EMAIL = 'other-sast@itcomplements.com'
  const uOth = await ensureUser(U_OTH_EMAIL, 'QA Usuario Externo Org-B (atacante)', SystemRole.USER, 'Externo-123!')
  await ensureMembership(uOth.id, ORG_B_ID, MemberRole.VIEWER, 'APPROVED')
  const memOth = await prisma.member.findFirstOrThrow({ where: { userId: uOth.id, organizationId: ORG_B_ID }, select: { id: true } })

  const RFC_A1 = FE_A_RFC
  const RFC_A2 = randomRfcPersonaMoral('QA2')
  await ensureFiscalEntity(RFC_A1, ORG_A_ID)
  const companyA2 = await ensureCompany(RFC_A2, ORG_A_ID, memAdm.id)
  try { await ensureCompanyAccess(COMPANY_A2_ID, ORG_A_ID, memAdm.id) } catch {}
  try { await ensureCompanyAccess(companyA2.id, ORG_A_ID, memAdm.id) } catch {}
  try { await ensureCompanyAccess(COMPANY_A2_ID, ORG_A_ID, memCad.id) } catch {}
  try { await ensureCompanyAccess(companyA2.id, ORG_A_ID, memCad.id) } catch {}

  const RFC_B1 = randomRfcPersonaMoral('QBB')
  const RFC_B2 = randomRfcPersonaMoral('QB2')
  const feB1 = await ensureFiscalEntity(RFC_B1, ORG_B_ID)
  const companyB2 = await ensureCompany(RFC_B2, ORG_B_ID, memOth.id)
  try { await ensureCompanyAccess(COMPANY_B2_ID, ORG_B_ID, memOth.id) } catch {}
  try { await ensureCompanyAccess(companyB2.id, ORG_B_ID, memOth.id) } catch {}

  const RFC_RECEPTOR_COMUN = 'XAXX010101000'

  const INVOICE_A_PROPIA_UUID = '11111111-0000-4000-8000-000000000001'
  const INVOICE_B_AJENA_UUID = '11111111-0000-4000-8000-000000000002'
  const orgAFeId = (await prisma.fiscalEntity.findUniqueOrThrow({ where: { rfc: RFC_A1 }, select: { id: true } })).id
  await ensureInvoice(INVOICE_A_PROPIA_UUID, orgAFeId, RFC_A1, RFC_RECEPTOR_COMUN, true)
  await ensureInvoice(INVOICE_B_AJENA_UUID, feB1.id, RFC_B1, RFC_RECEPTOR_COMUN, true)

  const MDR_A_PROPIO_ID = 'mdr-sast-org-a-prop-001'
  const MDR_B_AJENO_ID = 'mdr-sast-org-b-aje-001'
  const start = new Date(Date.now() - 30 * 24 * 3600 * 1000)
  const end = new Date()
  await ensureMassDownloadRequest({
    id: MDR_A_PROPIO_ID,
    companyId: companyA2.id,
    requestingRfc: RFC_A1,
    issuerRfc: RFC_A1,
    satPackageId: 'AAAAAAAA-0000-0000-0000-00000000000A',
    startDate: start, endDate: end, status: RequestStatus.TERMINADO
  })
  await ensureMassDownloadRequest({
    id: MDR_B_AJENO_ID,
    companyId: companyB2.id,
    requestingRfc: RFC_B1,
    issuerRfc: RFC_B1,
    satPackageId: 'BBBBBBBB-0000-0000-0000-00000000000B',
    startDate: start, endDate: end, status: RequestStatus.TERMINADO
  })

  console.log('')
  console.log('=== 🔑 CREDENCIALES GENERADAS ===')
  console.log('U-SA  SUPER_ADMIN  email:', U_SA_EMAIL, ' pass: SAST-Super@dmin123!  id=', uSa.id)
  console.log('U-ADM ADMIN (Org-A) email:', U_ADM_EMAIL, ' pass:', U_ADM_PASS, '  id=', uAdm.id, ' orgId=', ORG_A_ID)
  console.log('U-CAD AUDITOR (Org-A) email:', U_CAD_EMAIL, ' pass: Auditor-123!  id=', uCad.id)
  console.log('U-OTH VIEWER (Org-B) email:', U_OTH_EMAIL, ' pass: Externo-123!  id=', uOth.id)
  console.log('')
  console.log('=== 🏢 SCOPING MULTI-TENANT ===')
  console.log('ORG-A Grupo Demo   id=', ORG_A_ID)
  console.log('ORG-B ITComplements id=', ORG_B_ID)
  console.log('RFC-A1 (FiscalEntity Org-A):', RFC_A1, '  (existe, FE id existente vinculada a Grupo Demo)')
  console.log('RFC-A2 (Company Org-A):      ', RFC_A2, '  companyId=', companyA2.id)
  console.log('RFC-B1 (FiscalEntity Org-B): ', RFC_B1, '  feId=', feB1.id)
  console.log('RFC-B2 (Company Org-B):      ', RFC_B2, '  companyId=', companyB2.id)
  console.log('')
  console.log('=== 🧾 INVOICES PARA PDF (API-02) ===')
  console.log('Propia  Org-A UUID:', INVOICE_A_PROPIA_UUID)
  console.log('Ajena   Org-B UUID:', INVOICE_B_AJENA_UUID, ' (intento IDOR debe 403)')
  console.log('Existente happy UUID (backup existente):', INVOICE_A_HAPPY_EXISTING_UUID)
  console.log('Existente attack UUID (backup existente):', INVOICE_B_ATTACK_EXISTING_UUID)
  console.log('')
  console.log('=== 📦 MASS-DOWNLOAD REQUESTS (API-04) ===')
  console.log('Propio  Org-A id=', MDR_A_PROPIO_ID, ' satPackageId= AAAAAAAA-0000-0000-0000-00000000000A  RFC=', RFC_A1)
  console.log('Ajeno   Org-B id=', MDR_B_AJENO_ID, '  satPackageId= BBBBBBBB-0000-0000-0000-00000000000B  RFC=', RFC_B1, ' (ataque debe 403)')
  console.log('Existentes OK para usar si hace falta: MDR id=', MDR_A_EXISTING_ID, ' y ', MDR_B_EXISTING_ID)
  console.log('')
  console.log('=== 🖼️ COMPAÑÍAS PARA LOGO (API-06) ===')
  console.log('Propia  Org-A companyId existente:', COMPANY_A2_ID, ' rfc=ODE8604257UA')
  console.log('Ajena   Org-B companyId existente:', COMPANY_B2_ID, ' rfc=SCI041122EI6')
  console.log('Nueva   Org-A companyId nueva (RFC-A2):', companyA2.id)
  console.log('Nueva   Org-B companyId nueva (RFC-B2):', companyB2.id)
  console.log('')
  console.log('=== 💾 NOTAS ===')
  console.log('- Rate-Limit store: MEMORIA (variable store en src/lib/rate-limit.ts). RESET = reiniciar next dev.')
  console.log('- PostgreSQL client pg_dump no encontrado en PATH → backup generado por script JSON/CSV snapshots.')
}

main().then(() => prisma.$disconnect()).catch(async (e) => {
  console.error('SEED_FIXTURES_FAIL', e)
  await prisma.$disconnect()
  process.exit(1)
})
