import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { CfdiType, InvoiceStatus, SatStatus, SystemRole, Prisma } from '@prisma/client'
import { createMachineClient } from '@/lib/machine-client-service'
import { enforceDevEndpoint, getDevEnvStatus } from '@/lib/dev-endpoint-guard'
import { rateLimitByUserId, RateLimitError } from '@/lib/rate-limit'
import {
  DEV_M2M_EXPIRE_DEFAULT_HOURS,
  DEV_RAND_DEMO_RFC_CHARS,
  DEV_SEED_IDEMPOTENCY_WINDOW_MS,
  DevSeedEnvWhitelistSchema,
  DevSeedHeadersStrictSchema,
  MAX_DEV_SEED_LIMIT
} from '@/schemas/dev'
import type { DevSeedEnvWhitelistParsed } from '@/schemas/dev'
import { createAuditEntry } from '@/lib/audit'
import { getRealClientIp } from '@/lib/security'
import { randomInt, randomUUID as secureRandomUuid } from 'node:crypto'

const M2M_SCOPE_ALLOWLIST_DEV_DEMO = new Set([
  'cfdi.view:read',
  'dashboard:view',
  'reports:read',
  'workpapers:view'
])

function applyHardeningHeaders(res: NextResponse): NextResponse {
  res.headers.set('X-Content-Type-Options', 'nosniff')
  res.headers.set('X-Frame-Options', 'DENY')
  res.headers.set('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'")
  res.headers.set('Referrer-Policy', 'no-referrer')
  res.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  return res
}

function randSafe(min: number, max: number): number {
  if (max < min) return min
  return randomInt(min, max + 1)
}

function buildDemoRfc(prefixCharsLen: number = 3, fallbackHomo: string = 'DEM'): string {
  const lettersFirst = fallbackHomo.slice(0, Math.max(2, Math.min(4, prefixCharsLen)))
  const digits = String(randSafe(100000, 999999))
  const homoclave = Array.from({ length: 3 }, () =>
    DEV_RAND_DEMO_RFC_CHARS[randSafe(0, DEV_RAND_DEMO_RFC_CHARS.length - 1)]
  ).join('')
  return (lettersFirst + digits + homoclave).toUpperCase()
}

function buildDemoBusinessName(prefix1: string, prefix2: string): string {
  const suffixes = [
    'SA de CV',
    'S de RL de CV',
    'Operaciones SA de CV',
    'Servicios Globales MX',
    'Distribuciones y Consultoría S de RL'
  ]
  return (
    prefix1.charAt(0).toUpperCase() +
    prefix1.slice(1) +
    ' ' +
    prefix2.charAt(0).toUpperCase() +
    prefix2.slice(1) +
    ' ' +
    suffixes[randSafe(0, suffixes.length - 1)]
  )
}

type SeedEnvCtx = {
  rfcEmp1: string
  rfcEmp2: string
  biz1: string
  biz2: string
}

function resolveSeedDemoEnv(): SeedEnvCtx {
  const raw: Partial<SeedEnvCtx & DevSeedEnvWhitelistParsed> = DevSeedEnvWhitelistSchema.safeParse(process.env).data || {}
  return {
    rfcEmp1: (raw.SEED_DEMO_RFC_1 || buildDemoRfc(3, 'DEM')).toUpperCase().trim(),
    rfcEmp2: (raw.SEED_DEMO_RFC_2 || buildDemoRfc(3, 'EMP')).toUpperCase().trim(),
    biz1: (raw.SEED_DEMO_BUSINESS_1 || buildDemoBusinessName('Empresa', 'Operaciones Demo')).trim().slice(0, 120),
    biz2: (raw.SEED_DEMO_BUSINESS_2 || buildDemoBusinessName('Organización', 'Pruebas QA')).trim().slice(0, 120)
  }
}

export async function POST(request: NextRequest) {
  try {
    const guard = await enforceDevEndpoint(request, { requireSuperAdmin: true })
    if (guard) return applyHardeningHeaders(guard)

    const session = await auth()
    if (!session?.user?.id || typeof session.user.id !== 'string' || session.user.id.length < 8) {
      return applyHardeningHeaders(NextResponse.json({ error: 'Sesión inválida' }, { status: 401 }))
    }
    const userId: string = session.user.id

    const headersParsed = DevSeedHeadersStrictSchema.safeParse(Object.fromEntries(request.headers.entries()))
    const traceId = headersParsed.success ? headersParsed.data['x-request-trace-id'] : undefined

    rateLimitByUserId({
      userId,
      key: 'dev-seed-post-idempotent-distributed-v2',
      limit: 1,
      windowMs: DEV_SEED_IDEMPOTENCY_WINDOW_MS
    })

    const envCtx = resolveSeedDemoEnv()

    const supplierPool: Array<{ rfc: string; name: string }> = Array.from({ length: 6 }, (_, i) => ({
      rfc: buildDemoRfc(3, 'PRO' + String(i)),
      name: buildDemoBusinessName('Proveedor', 'No ' + String(i + 1))
    }))
    const clientPool: Array<{ rfc: string; name: string }> = Array.from({ length: 6 }, (_, i) => ({
      rfc: buildDemoRfc(3, 'CLI' + String(i)),
      name: buildDemoBusinessName('Cliente', 'Corporativo ' + String(i + 1))
    }))

    const MAX_SEED_TRX_RETRIES = 3
    let finalSummary = {
      organizationId: '',
      machineClient: null as null | { clientId: string; scopes: string[]; expiresAtISO: string | null },
      companyIds: [] as string[],
      fiscalEntityIds: [] as string[],
      chauInvoicesCreated: 0,
      chauSatCreated: 0,
      invoicesScenario1: 0,
      accessRoles: {} as Record<string, string>
    }

    for (let attempt = 0; attempt < MAX_SEED_TRX_RETRIES; attempt++) {
      try {
        const txResult = await prisma.$transaction(
          async (tx) => {
            let org = await tx.organization.findFirst({
              where: { ownerId: userId },
              select: { id: true, name: true, slug: true }
            })
            let createdMachineClient: null | { clientId: string; scopes: string[]; expiresAtISO: string | null } = null

            if (!org) {
              const slug = `org-demo-${Date.now()}-${randSafe(1000, 9999)}`
              org = await tx.organization.create({
                data: {
                  name: 'Org QA Dev (seed-demo)',
                  slug,
                  ownerId: userId,
                  onboardingCompleted: true,
                  operationalAccessEnabled: true
                },
                select: { id: true, name: true, slug: true }
              })
              const expiresAt = new Date(Date.now() + DEV_M2M_EXPIRE_DEFAULT_HOURS * 3600 * 1000)
              const m = await createMachineClient(tx as unknown as Prisma.TransactionClient, {
                organizationId: org.id,
                organizationSlug: org.slug,
                createdByUserId: userId,
                description: 'Cliente M2M TEMPORAL · seed-demo endpoint · expira en 12h stage',
                scopes: Array.from(M2M_SCOPE_ALLOWLIST_DEV_DEMO),
                expiresAt
              })
              createdMachineClient = { clientId: m.clientId, scopes: m.scopes, expiresAtISO: expiresAt.toISOString() }
            }
            const orgId = org.id

            let member = await tx.member.findFirst({
              where: { userId, organizationId: orgId },
              select: { id: true, role: true, status: true }
            })
            if (!member) {
              member = await tx.member.create({
                data: { userId, organizationId: orgId, role: 'ADMIN', status: 'APPROVED' },
                select: { id: true, role: true, status: true }
              })
            }
            if (member.status !== 'APPROVED') {
              throw new Error('Dev Seed: member status not approved')
            }
            const memberId = member.id

            const companiesToSeed = [
              { rfc: envCtx.rfcEmp1, biz: envCtx.biz1, regime: '601', postal: '04120', scenario1InvoicesCount: 60, scn2SatInvoices: 0, scn2XmlInvoices: 0 },
              { rfc: envCtx.rfcEmp2, biz: envCtx.biz2, regime: '601', postal: '04120', scenario1InvoicesCount: 0, scn2SatInvoices: 100, scn2XmlInvoices: 90 }
            ]

            const outputCompanies: string[] = []
            const outputFiscalEntities: string[] = []
            const outputRoles: Record<string, string> = {}
            let scn1TotalInvoices = 0
            let scn2SatTotal = 0
            let scn2InvTotal = 0

            for (const c of companiesToSeed) {
              const regime = c.regime
              const postal = c.postal

              let company = await tx.company.findUnique({ where: { rfc: c.rfc }, select: { id: true, rfc: true } })
              if (!company) {
                company = await tx.company.create({
                  data: {
                    name: c.biz,
                    rfc: c.rfc,
                    businessName: c.biz,
                    taxRegime: regime,
                    postalCode: postal,
                    status: 'APPROVED',
                    createdBy: userId,
                    updatedBy: userId
                  },
                  select: { id: true, rfc: true }
                })
              }
              outputCompanies.push(company.id)

              const access = await tx.companyAccess.upsert({
                where: { memberId_companyId: { memberId, companyId: company.id } },
                update: { role: 'ADMIN' },
                create: { organizationId: orgId, memberId, companyId: company.id, role: 'ADMIN' },
                select: { role: true }
              })
              outputRoles[c.rfc] = access.role

              let fiscal = await tx.fiscalEntity.findFirst({
                where: { organizationId: orgId, rfc: c.rfc },
                select: { id: true, rfc: true, organizationId: true }
              })
              if (!fiscal) {
                fiscal = await tx.fiscalEntity.create({
                  data: { organizationId: orgId, rfc: c.rfc, businessName: c.biz, taxRegime: regime, postalCode: postal, isActive: true },
                  select: { id: true, rfc: true, organizationId: true }
                })
              }
              outputFiscalEntities.push(fiscal.id)

              if (c.scenario1InvoicesCount > 0) {
                const existing = await tx.invoice.count({ where: { issuerFiscalEntityId: fiscal.id } })
                const countToCreate = existing > 0 ? 0 : Math.min(c.scenario1InvoicesCount, MAX_DEV_SEED_LIMIT)
                if (countToCreate > 0) {
                  const shapeNow = Array.from({ length: countToCreate }, (_, k) => {
                    const issued = k % 2 === 0
                    const d = new Date()
                    d.setMonth(d.getMonth() - randSafe(0, 11))
                    d.setDate(randSafe(1, 28))
                    const subtotal = randSafe(5000, 200000)
                    const total = Number((subtotal * 1.16).toFixed(2))
                    const satStatus = [SatStatus.VIGENTE, SatStatus.CANCELADO, SatStatus.NO_ENCONTRADO][randSafe(0, 2)]
                    const cfdiType = [CfdiType.INGRESO, CfdiType.EGRESO, CfdiType.PAGO, CfdiType.NOMINA][randSafe(0, 3)]
                    const payMethod = ['PUE', 'PPD'][randSafe(0, 1)]
                    const payForm = ['03', '01', '99'][randSafe(0, 2)]
                    const issuer = issued ? { rfc: c.rfc, name: c.biz } : supplierPool[randSafe(0, supplierPool.length - 1)]
                    const receiver = issued ? clientPool[randSafe(0, clientPool.length - 1)] : { rfc: c.rfc, name: c.biz }
                    return {
                      userId,
                      issuerFiscalEntityId: fiscal!.id,
                      uuid: secureRandomUuid(),
                      cfdiType,
                      series: issued ? 'SDV' : 'SDVR',
                      folio: String(randSafe(100000, 999999)),
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
                      ivaTransferred: Number((subtotal * 0.16).toFixed(2)),
                      ivaWithheld: 0,
                      isrWithheld: 0,
                      iepsWithheld: 0,
                      xmlContent: '<xml>demo-seed-redacted-safe</xml>',
                      pdfUrl: null,
                      issuanceDate: d,
                      certificationDate: new Date(d.getTime() + 60000),
                      certificationPac: 'PAC-DEMO-LOCAL',
                      paymentMethod: payMethod,
                      paymentForm: payForm,
                      cfdiUsage: 'G03',
                      placeOfExpedition: postal
                    }
                  })
                  await tx.invoice.createMany({ data: shapeNow })
                  scn1TotalInvoices += countToCreate
                }
              }

              if (c.scn2SatInvoices > 0 && c.scn2XmlInvoices > 0) {
                const existingSatCount = await tx.satInvoice.count({ where: { fiscalEntityId: fiscal.id } })
                const existingXmlCount = await tx.invoice.count({ where: { issuerFiscalEntityId: fiscal.id } })
                const needCreate = existingSatCount === 0 && existingXmlCount === 0
                if (needCreate) {
                  const totalSat = Math.min(c.scn2SatInvoices, MAX_DEV_SEED_LIMIT)
                  const totalXml = Math.min(c.scn2XmlInvoices, totalSat)
                  const now = new Date()

                  const chauSatData = Array.from({ length: totalSat }, (_, i) => {
                    const issued = i % 2 === 0
                    const d = new Date(now)
                    d.setMonth(now.getMonth() - randSafe(0, 11))
                    d.setDate(randSafe(1, 28))
                    const subtotal = randSafe(5000, 200000)
                    const total = Number((subtotal * 1.16).toFixed(2))
                    const satStatus = [SatStatus.VIGENTE, SatStatus.CANCELADO, SatStatus.NO_ENCONTRADO][randSafe(0, 2)]
                    const cfdiType = [CfdiType.INGRESO, CfdiType.EGRESO, CfdiType.PAGO, CfdiType.NOMINA][randSafe(0, 3)]
                    const payMethod = ['PUE', 'PPD'][randSafe(0, 1)]
                    const payForm = ['03', '01', '99'][randSafe(0, 2)]
                    const issuer = issued ? { rfc: c.rfc, name: c.biz } : supplierPool[randSafe(0, supplierPool.length - 1)]
                    const receiver = issued ? clientPool[randSafe(0, clientPool.length - 1)] : { rfc: c.rfc, name: c.biz }
                    return {
                      userId,
                      fiscalEntityId: fiscal!.id,
                      uuid: secureRandomUuid(),
                      cfdiType,
                      series: issued ? 'SCH' : 'SCR',
                      folio: String(randSafe(1000000, 9999999)),
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
                      xmlContent: '<metadata-sat-redacted-seed-safe/>',
                      pdfUrl: null,
                      issuanceDate: d,
                      certificationDate: new Date(d.getTime() + 60000),
                      certificationPac: 'SAT-DEMO',
                      paymentMethod: payMethod,
                      paymentForm: payForm,
                      usageCfdi: 'G03',
                      expeditionPlace: postal
                    }
                  })
                  await tx.satInvoice.createMany({ data: chauSatData })
                  scn2SatTotal += totalSat

                  const invoicesFromSat = chauSatData.slice(0, totalXml).map((s) => ({
                    userId,
                    issuerFiscalEntityId: fiscal!.id,
                    uuid: s.uuid,
                    cfdiType: s.cfdiType,
                    series: s.series,
                    folio: s.folio,
                    currency: s.currency,
                    exchangeRate: s.exchangeRate,
                    status: s.status,
                    satStatus: s.satStatus,
                    issuerRfc: s.issuerRfc,
                    issuerName: s.issuerName,
                    receiverRfc: s.receiverRfc,
                    receiverName: s.receiverName,
                    subtotal: s.subtotal,
                    total: s.total,
                    ivaTransferred: s.ivaTrasladado,
                    ivaWithheld: s.ivaRetenido,
                    isrWithheld: s.isrRetenido,
                    iepsWithheld: s.iepsRetenido,
                    xmlContent: '<demo-seed-redacted-invoice-safe/>',
                    pdfUrl: s.pdfUrl,
                    issuanceDate: s.issuanceDate,
                    certificationDate: s.certificationDate,
                    certificationPac: s.certificationPac,
                    paymentMethod: s.paymentMethod,
                    paymentForm: s.paymentForm,
                    cfdiUsage: s.usageCfdi,
                    placeOfExpedition: s.expeditionPlace
                  }))
                  await tx.invoice.createMany({ data: invoicesFromSat })
                  scn2InvTotal += totalXml
                }
              }
            }

            return {
              organizationId: orgId,
              machineClient: createdMachineClient,
              companyIds: outputCompanies,
              fiscalEntityIds: outputFiscalEntities,
              accessRoles: outputRoles,
              scn1Invoices: scn1TotalInvoices,
              scn2SatCreated: scn2SatTotal,
              scn2InvCreated: scn2InvTotal
            }
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 15000, timeout: 60000 }
        )

        finalSummary = {
          organizationId: txResult.organizationId,
          machineClient: txResult.machineClient,
          companyIds: txResult.companyIds,
          fiscalEntityIds: txResult.fiscalEntityIds,
          chauSatCreated: txResult.scn2SatCreated,
          chauInvoicesCreated: txResult.scn2InvCreated,
          invoicesScenario1: txResult.scn1Invoices,
          accessRoles: txResult.accessRoles
        }
        break
      } catch (err) {
        const errObj = err as unknown as { code?: unknown; name?: unknown }
        const code = (typeof errObj.code === 'string' ? errObj.code : typeof errObj.name === 'string' ? errObj.name : 'UNKNOWN')
        const retryableCodes = new Set(['P2002', 'P2034', '40P01', 'SERIALIZATION_FAILURE', 'TRANSACTION_ROLLBACK'])
        if (attempt + 1 < MAX_SEED_TRX_RETRIES && (retryableCodes.has(String(code)) || /serialize|deadlock|unique.*conflict/i.test(String((err as Error).message)))) {
          await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 120 + randSafe(20, 80)))
          continue
        }
        throw err
      }
    }

    await createAuditEntry({
      tableName: 'AuditLog',
      recordId: 'dev-seed-completed',
      action: 'SEED_DEVOPS_OK',
      userId,
      userEmail: session?.user?.email,
      description: `Seed DEV completado: ${finalSummary.invoicesScenario1 + finalSummary.chauInvoicesCreated} CFDIs + ${finalSummary.chauSatCreated} SAT metadata`,
      ipAddress: getRealClientIp(request.headers),
      userAgent: request.headers.get('user-agent') ?? 'unknown',
      newValues: {
        traceId: traceId ?? secureRandomUuid(),
        envStatus: getDevEnvStatus(),
        rateLimitWindowMs: DEV_SEED_IDEMPOTENCY_WINDOW_MS,
        m2mScopeAllowlistCount: M2M_SCOPE_ALLOWLIST_DEV_DEMO.size,
        rfcEmpresasProcesadas: [envCtx.rfcEmp1, envCtx.rfcEmp2].length,
        invoicesScenario1Created: finalSummary.invoicesScenario1,
        satScenario2Rows: finalSummary.chauSatCreated,
        xmlScenario2Rows: finalSummary.chauInvoicesCreated
      }
    }).catch(() => {})

    const summarySafe = {
      executionId: secureRandomUuid(),
      ok: true,
      envStatus: {
        nodeEnv: process.env.NODE_ENV ?? 'unknown',
        explicitAllow: getDevEnvStatus().explicitAllow,
        devEndpointsEnabled: true
      },
      machineClient: finalSummary.machineClient
        ? {
            clientIdSuffix: finalSummary.machineClient.clientId.slice(-8),
            scopesCount: finalSummary.machineClient.scopes.length,
            expiresAt: finalSummary.machineClient.expiresAtISO
          }
        : null,
      counts: {
        companyAccessRolesDefined: Object.keys(finalSummary.accessRoles).length,
        scenario1InvoicesCreated: finalSummary.invoicesScenario1,
        scenario2SatInvoicesCreated: finalSummary.chauSatCreated,
        scenario2XmlInvoicesCreated: finalSummary.chauInvoicesCreated
      },
      fingerprints: {
        organizationIdSuffix: finalSummary.organizationId ? finalSummary.organizationId.slice(-12) : null,
        companyIdsSuffixes: finalSummary.companyIds.map((c) => c.slice(-8)),
        fiscalEntityIdsSuffixes: finalSummary.fiscalEntityIds.map((f) => f.slice(-8))
      },
      seededBy: {
        role: SystemRole.SUPER_ADMIN
      }
    }

    return applyHardeningHeaders(NextResponse.json(summarySafe, { status: 200 }))
  } catch (error) {
    if (error instanceof RateLimitError) {
      const r = NextResponse.json({ error: error.message }, { status: error.statusCode })
      r.headers.set('Retry-After', String(Math.ceil(error.retryAfterMs / 1000)))
      return applyHardeningHeaders(r)
    }
    const fingerprint = (await import('node:crypto'))
      .createHash('sha256')
      .update(String((error as Error)?.message || 'empty-seed'))
      .digest('hex')
      .slice(0, 16)
    const errObj = error as unknown as { code?: unknown }
    const rawCode = typeof errObj.code === 'string' ? errObj.code : undefined
    const code = rawCode ?? 'UNKNOWN'
    const prismaCode = rawCode?.startsWith('P') ? rawCode : null
    console.error('[dev-seed 500]', {
      fingerprint,
      code,
      prismaErrorCode: prismaCode,
      errName: (error as Error)?.name
    })
    return applyHardeningHeaders(
      NextResponse.json({ error: 'Error interno (ref #' + fingerprint + ')' }, { status: 500 })
    )
  }
}
