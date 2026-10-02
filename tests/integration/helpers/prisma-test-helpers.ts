import net from 'node:net'
import { execFileSync } from 'node:child_process'
import { PrismaClient, SystemRole, MemberRole, CfdiType, InvoiceStatus, SatStatus } from '@prisma/client'
import bcrypt from 'bcryptjs'

export const TEST_DATABASE_URL =
  'postgresql://postgres:postgres@localhost:5434/platfi_intelligence_TEST_AUTH?schema=public&connect_timeout=5'

export const ORG_A_ID = 'int-cmnntrppk000502gcp93ketfx'
export const ORG_B_ID = 'int-cmipiwlqk000mvyvtc22tnlrb'
export const FE_A_RFC = 'ODE8604257UA'
export const FE_B_RFC = 'SCI041122EI5'
export const COMPANY_A_RFC = 'INT123456789'
export const COMPANY_B_RFC = 'INT987654321'
export const USER_ADMIN_EMAIL = 'int-admin@itcomplements.com'
export const USER_AUDITOR_EMAIL = 'int-auditor@itcomplements.com'
export const USER_VIEWER_EMAIL = 'int-viewer@itcomplements.com'
export const USER_SUPERADMIN_EMAIL = 'int-sa@itcomplements.com'

export const INTEGRATION_TEST_TIMEOUT_MS = 120000
const TABLE_ORDER_FK_SAFE = [
  'audit_logs',
  'invoice_complement_attributes',
  'invoice_complement_index',
  'invoice_blobs',
  'invoice_concepts',
  'invoice_related_cfdis',
  'invoice_payment_complement_details',
  'invoice_issued_daily_summary',
  'invoices',
  'sat_invoices',
  'sat_metadata',
  'provider_uploaded_cfdi_complement_attributes',
  'provider_uploaded_cfdi_complement_index',
  'provider_uploaded_cfdi_blobs',
  'provider_uploaded_cfdis',
  'provider_received_cfdi_daily_summary',
  'mass_download_requests',
  'company_access',
  'companies',
  'custom_roles',
  'fiscal_entities',
  'members',
  'api_keys',
  'verificationtokens',
  'accounts',
  'sessions',
  'machine_clients',
  'sat_validation_error_knowledge',
  'users',
  'organizations',
  'sat_credentials',
  'import_directory_sessions',
  'import_runs',
]

export async function isPostgresTestAvailable(
  host = 'localhost',
  port = 5434,
  timeoutMs = 2000
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    const onError = () => {
      socket.destroy()
      resolve(false)
    }
    socket.setTimeout(timeoutMs)
    socket.once('error', onError)
    socket.once('timeout', onError)
    socket.connect(port, host, () => {
      socket.destroy()
      resolve(true)
    })
  })
}

export function isPostgresTestAvailableSync(
  host = 'localhost',
  port = 5434,
  timeoutMs = 2000
): boolean {
  try {
    const isWin = process.platform === 'win32'
    let out: string
    if (isWin) {
      out = execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          `$ErrorActionPreference='Stop'; try { $tcp = New-Object System.Net.Sockets.TcpClient; $iar = $tcp.BeginConnect('${host}',${port},$null,$null); $wait = $iar.AsyncWaitHandle.WaitOne(${timeoutMs},$false); if (-not $wait) { throw 'timeout' }; $tcp.EndConnect($iar) | Out-Null; $tcp.Close(); Write-Output 'OK' } catch { Write-Output 'NO' }`,
        ],
        { encoding: 'utf8', timeout: timeoutMs + 1000, stdio: ['ignore', 'pipe', 'ignore'] }
      ).trim()
    } else {
      out = execFileSync(
        'sh',
        [
          '-c',
          `timeout $((timeoutMs+999)/1000) sh -c "echo > /dev/tcp/${host}/${port}" 2>/dev/null && echo OK || echo NO`,
        ],
        { encoding: 'utf8', timeout: timeoutMs + 1000, stdio: ['ignore', 'pipe', 'ignore'] }
      ).trim()
    }
    return out === 'OK'
  } catch {
    return false
  }
}

export function forceIntegrationDatabaseUrl() {
  process.env.DATABASE_URL = TEST_DATABASE_URL
  process.env.DIRECT_URL = TEST_DATABASE_URL
}

export function createIntegrationPrisma(logQuery = false): PrismaClient {
  forceIntegrationDatabaseUrl()
  return new PrismaClient({
    log: logQuery ? ['query', 'error', 'warn'] : ['error'],
  })
}

export async function truncateAllIntegrationTables(prisma: PrismaClient): Promise<void> {
  for (const table of TABLE_ORDER_FK_SAFE) {
    try {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`)
    } catch (_e) {
      // Ignore missing tables
    }
  }
}

export async function createOrg(prisma: PrismaClient, id: string, name: string, slug: string) {
  return prisma.organization.upsert({
    where: { id },
    update: {},
    create: {
      id,
      name,
      slug,
      description: `Org integración ${name}`,
      country: 'México',
      onboardingCompleted: true,
      operationalAccessEnabled: true,
    },
  })
}

export async function createUser(
  prisma: PrismaClient,
  email: string,
  name: string,
  systemRole: SystemRole,
  password = 'Integracion-123!'
) {
  const hashed = await bcrypt.hash(password, 10)
  return prisma.user.upsert({
    where: { email },
    update: { name, systemRole, password: hashed, emailVerified: new Date() },
    create: {
      email,
      name,
      systemRole,
      password: hashed,
      emailVerified: new Date(),
    },
  })
}

export async function ensureMembership(
  prisma: PrismaClient,
  userId: string,
  organizationId: string,
  role: MemberRole = MemberRole.VIEWER,
  status = 'APPROVED'
) {
  let m = await prisma.member.findFirst({ where: { userId, organizationId } })
  if (!m) {
    m = await prisma.member.create({ data: { userId, organizationId, role, status } })
  } else {
    m = await prisma.member.update({ where: { id: m.id }, data: { role, status } })
  }
  return m
}

export async function createFiscalEntity(
  prisma: PrismaClient,
  rfc: string,
  organizationId: string,
  businessName?: string
) {
  return prisma.fiscalEntity.upsert({
    where: { rfc },
    update: {},
    create: {
      rfc,
      organizationId,
      businessName: businessName || `FiscalEntity ${rfc}`,
      taxRegime: '601',
      postalCode: '06000',
      isActive: true,
    },
  })
}

export async function createCompany(
  prisma: PrismaClient,
  rfc: string,
  organizationId: string,
  memberId?: string
) {
  const c = await prisma.company.upsert({
    where: { rfc },
    update: {},
    create: {
      rfc,
      name: `Company ${rfc}`,
      businessName: `Company ${rfc} SA CV`,
      taxRegime: '601',
      postalCode: '06000',
      country: 'México',
      status: 'APPROVED' as any,
      createdBy: 'integration-tests',
      updatedBy: 'integration-tests',
    },
  })
  if (memberId) {
    await prisma.companyAccess.upsert({
      where: { memberId_companyId: { memberId, companyId: c.id } },
      update: {},
      create: { memberId, companyId: c.id, organizationId, role: 'ADMIN' as any },
    })
  }
  return c
}

export interface BuildInvoiceConceptOptions {
  count: number
  unitValue?: number
  descriptionPrefix?: string
}

export function buildInvoiceConcepts(opts: BuildInvoiceConceptOptions) {
  const { count, unitValue = 100.0, descriptionPrefix = 'Concepto' } = opts
  const concepts = new Array(count)
  let subtotal = 0
  for (let i = 0; i < count; i++) {
    const qty = (i % 3) + 1
    const amt = unitValue * qty
    subtotal += amt
    concepts[i] = {
      productServiceKey: '01010101',
      identificationNumber: `SKU-${String(i).padStart(6, '0')}`,
      unitQuantity: qty,
      unitKey: 'ACT',
      unitDescription: 'Actividad',
      description: `${descriptionPrefix} ${i + 1}`,
      unitValue: unitValue,
      amount: amt,
      discount: 0,
      objectOfTax: '02',
      transferredTaxesJson: { Base: amt, Impuesto: '002', TipoFactor: 'Tasa', TasaOCuota: 0.16, Importe: amt * 0.16 },
      withheldTaxesJson: null,
    }
  }
  const iva = Math.round(subtotal * 0.16 * 100) / 100
  const total = Math.round((subtotal + iva) * 100) / 100
  return { concepts, subtotal, iva, total }
}

export async function createInvoiceWithConcepts(
  prisma: PrismaClient,
  opts: {
    uuid: string
    issuerFiscalEntityId: string
    issuerRfc: string
    receiverRfc: string
    conceptCount: number
    issuanceDate?: Date
  }
) {
  const { uuid, issuerFiscalEntityId, issuerRfc, receiverRfc, conceptCount, issuanceDate } = opts
  const built = buildInvoiceConcepts({ count: conceptCount })
  const xmlContent = `<?xml version="1.0" encoding="UTF-8"?><cfdi:Comprobante Version="4.0" UUID="${uuid}"></cfdi:Comprobante>`
  return prisma.invoice.create({
    data: {
      uuid,
      cfdiType: CfdiType.INGRESO,
      issuerFiscalEntityId,
      issuerRfc,
      issuerName: `Emisor ${issuerRfc}`,
      receiverRfc,
      receiverName: `Receptor ${receiverRfc}`,
      subtotal: built.subtotal,
      total: built.total,
      ivaTransferred: built.iva,
      ivaWithheld: 0,
      isrWithheld: 0,
      iepsWithheld: 0,
      currency: 'MXN',
      status: InvoiceStatus.ACTIVE,
      satStatus: SatStatus.VIGENTE,
      issuanceDate: issuanceDate ?? new Date(),
      certificationDate: new Date(),
      certificationPac: 'PAC-INTEGRACION-001',
      paymentMethod: 'PUE',
      paymentForm: '01',
      cfdiUsage: 'G01',
      placeOfExpedition: '06000',
      exportKey: '01',
      xmlContent,
      concepts: { create: built.concepts },
    },
    include: { concepts: true },
  })
}
