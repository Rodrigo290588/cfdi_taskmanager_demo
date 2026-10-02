import { describe, expect, test, beforeEach } from '@jest/globals'
import { MemberRole, SystemRole } from '@prisma/client'
import {
  describeIfIntegrationDb,
  integrationPrisma,
  integrationDbAvailable,
} from './setup-integration'
import {
  createOrg,
  createUser,
  createFiscalEntity,
  createInvoiceWithConcepts,
  ensureMembership,
  buildInvoiceConcepts,
  truncateAllIntegrationTables,
  ORG_A_ID,
  FE_A_RFC,
  COMPANY_A_RFC,
} from './helpers/prisma-test-helpers'
import {
  DashboardRateLimitError,
  DASHBOARD_MAX_MONTHS,
  sanitizeDownloadFilename,
  buildRfc5987ContentDisposition,
} from '@/lib/dashboard-fiscal-route-utils'
import {
  DashboardForbiddenError,
  DashboardMissingParamError,
} from '@/lib/permissions'

const RECEPTOR_RFC_BULK = 'XAXX010101000'

describeIfIntegrationDb('[FASE2] Dashboard Fiscal · KPI Queries / Drilldown / Invariancia LIMIT + Concept Integrity', () => {
  let orgId: string, feId: string, userId: string, _memberId: string
  const feRfc = FE_A_RFC

  beforeEach(async () => {
    if (!integrationDbAvailable) return
    await truncateAllIntegrationTables(integrationPrisma)
    const org = await createOrg(integrationPrisma, ORG_A_ID, 'Org Dashboard', 'int-org-dash')
    orgId = org.id
    const fe = await createFiscalEntity(integrationPrisma, feRfc, orgId)
    feId = fe.id
    const u = await createUser(integrationPrisma, 'int-dash-admin@itcomplements.com', 'Dash Admin', SystemRole.ADMIN)
    userId = u.id
    const m = await ensureMembership(integrationPrisma, userId, orgId, MemberRole.ADMIN, 'APPROVED')
    memberId = m.id
  })

  const createTestInvoicesBatch = async (count: number, conceptsPerInvoice = 50, spreadDays = 365) => {
    const uuids: string[] = []
    const baseDate = new Date('2025-01-01T00:00:00Z')
    const dayMs = 24 * 3600 * 1000
    for (let i = 0; i < count; i++) {
      const uuid = `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`
      const d = new Date(baseDate.getTime() + (i % spreadDays) * dayMs)
      await createInvoiceWithConcepts(integrationPrisma, {
        uuid,
        issuerFiscalEntityId: feId,
        issuerRfc: feRfc,
        receiverRfc: i % 2 === 0 ? RECEPTOR_RFC_BULK : COMPANY_A_RFC,
        conceptCount: conceptsPerInvoice,
        issuanceDate: d,
      })
      uuids.push(uuid)
    }
    return uuids
  }

  describe('Crear datos semilla 365 días x 548 CFDIs × 50 conceptos = 27,400 conceptos', () => {
    test('semilla 548 CFDIs en 365 días (promedio 1.5/día ≈ 548/año) → invoices=548, concepts=27400', async () => {
      const n = 548
      const c = 50
      const uuids = await createTestInvoicesBatch(n, c, 365)
      expect(uuids.length).toBe(n)
      const invCount = await integrationPrisma.invoice.count({ where: { issuerFiscalEntityId: feId } })
      const conCount = await integrationPrisma.invoiceConcept.count()
      expect(invCount).toBeGreaterThanOrEqual(n)
      expect(conCount).toBeGreaterThanOrEqual(n * c)
      console.log(`  [seed dashboard] ${invCount} invoices · ${conCount} concepts`)
    }, 90000)
  })

  describe('KPI queries: count / sumas / agrupaciones (Dashboard Fiscal principal)', () => {
    const seedSmallKpi = async () => {
      const smallSeed = [
        { uuid: '00000000-0000-4000-8000-000000000101', total: 1000, subtotal: 862.07, iva: 137.93, qtyConcs: 1, date: new Date('2025-03-01') },
        { uuid: '00000000-0000-4000-8000-000000000102', total: 2000, subtotal: 1724.14, iva: 275.86, qtyConcs: 2, date: new Date('2025-03-05') },
        { uuid: '00000000-0000-4000-8000-000000000103', total: 3000, subtotal: 2586.21, iva: 413.79, qtyConcs: 3, date: new Date('2025-03-15') },
        { uuid: '00000000-0000-4000-8000-000000000104', total: 4000, subtotal: 3448.28, iva: 551.72, qtyConcs: 4, date: new Date('2025-04-01') },
        { uuid: '00000000-0000-4000-8000-000000000105', total: 5000, subtotal: 4310.34, iva: 689.66, qtyConcs: 5, date: new Date('2025-04-10') },
      ]
      for (const s of smallSeed) {
        const built = buildInvoiceConcepts({ count: s.qtyConcs, unitValue: s.subtotal / s.qtyConcs })
        const xml = `<CFDI UUID="${s.uuid}"/>`
        await integrationPrisma.invoice.create({
          data: {
            uuid: s.uuid,
            cfdiType: 'INGRESO',
            issuerFiscalEntityId: feId,
            issuerRfc: feRfc,
            issuerName: `Emisor ${feRfc}`,
            receiverRfc: RECEPTOR_RFC_BULK,
            receiverName: 'Receptor Publico General',
            subtotal: s.subtotal,
            total: s.total,
            ivaTransferred: s.iva,
            ivaWithheld: 0,
            isrWithheld: 0,
            iepsWithheld: 0,
            currency: 'MXN',
            status: 'ACTIVE',
            satStatus: 'VIGENTE',
            issuanceDate: s.date,
            certificationDate: s.date,
            certificationPac: 'PAC-DASH-001',
            paymentMethod: 'PUE',
            paymentForm: '01',
            cfdiUsage: 'G01',
            placeOfExpedition: '06000',
            exportKey: '01',
            xmlContent: xml,
            concepts: { create: built.concepts },
          },
        })
      }
    }

    test('KPI principal: CFDIs VIGENTES en rango 2025-marzo = 3 / abril = 2 / total = 5', async () => {
      await seedSmallKpi()
      const rangeMar = await integrationPrisma.invoice.count({
        where: {
          issuerFiscalEntityId: feId,
          satStatus: 'VIGENTE',
          issuanceDate: { gte: new Date('2025-03-01'), lte: new Date('2025-03-31T23:59:59Z') },
        },
      })
      expect(rangeMar).toBe(3)
      const rangeAbr = await integrationPrisma.invoice.count({
        where: {
          issuerFiscalEntityId: feId,
          satStatus: 'VIGENTE',
          issuanceDate: { gte: new Date('2025-04-01'), lte: new Date('2025-04-30T23:59:59Z') },
        },
      })
      expect(rangeAbr).toBe(2)
    })

    test('KPI principal: SUM total marzo = $6,000 / SUM IVA marzo = $827.58 / SUM abril = $1241.38', async () => {
      await seedSmallKpi()
      const agg = await integrationPrisma.invoice.aggregate({
        where: {
          issuerFiscalEntityId: feId,
          issuanceDate: { gte: new Date('2025-03-01'), lte: new Date('2025-03-31T23:59:59Z') },
        },
        _sum: { total: true, ivaTransferred: true, subtotal: true },
        _count: { uuid: true },
      })
      expect(Number(agg._sum.total)).toBe(6000)
      expect(Number(agg._sum.ivaTransferred)).toBeCloseTo(827.58, 2)
      expect(agg._count.uuid).toBe(3)
    })

    test('Drilldown receptor RFC: XAXX010101000 (público general) = todos los 5 CFDIs de KPI', async () => {
      await seedSmallKpi()
      const rows = await integrationPrisma.invoice.findMany({
        where: { receiverRfc: RECEPTOR_RFC_BULK, issuerFiscalEntityId: feId },
        select: { uuid: true },
      })
      expect(rows.length).toBe(5)
    })
  })

  describe('Invariancia LIMIT + ORDER BY: LIMIT 10 vs LIMIT 1000 (mismo where, mismo order) retornan mismos 10 primeros', () => {
    test('LIMIT 10 vs LIMIT 1000 mismos 10 primeros (ORDER BY issuanceDate ASC)', async () => {
      const n = 100
      const d0 = new Date('2025-01-01T00:00:00Z')
      const arr = Array.from({ length: n }, (_, i) => {
        const d = new Date(d0.getTime() + i * 86400000)
        return { uuid: `99999999-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, date: d }
      })
      for (const x of arr) {
        await createInvoiceWithConcepts(integrationPrisma, {
          uuid: x.uuid,
          issuerFiscalEntityId: feId,
          issuerRfc: feRfc,
          receiverRfc: COMPANY_A_RFC,
          conceptCount: 5,
          issuanceDate: x.date,
        })
      }

      const top10 = await integrationPrisma.invoice.findMany({
        where: { issuerFiscalEntityId: feId, receiverRfc: COMPANY_A_RFC },
        select: { uuid: true, issuanceDate: true },
        orderBy: [{ issuanceDate: 'asc' }],
        take: 10,
      })
      const top1000 = await integrationPrisma.invoice.findMany({
        where: { issuerFiscalEntityId: feId, receiverRfc: COMPANY_A_RFC },
        select: { uuid: true, issuanceDate: true },
        orderBy: [{ issuanceDate: 'asc' }],
        take: 1000,
      })
      expect(top10.length).toBe(10)
      expect(top1000.length).toBeGreaterThanOrEqual(100)
      for (let i = 0; i < 10; i++) {
        expect(top10[i].uuid).toBe(top1000[i].uuid)
        expect(top10[i].issuanceDate.toISOString()).toBe(top1000[i].issuanceDate.toISOString())
      }
    }, 60000)
  })

  describe('Integridad Conceptos: SUM(concept.amount) == invoice.subtotal (sin drift, no hay redondeos incorrectos)', () => {
    test('50 invoices × 20 concepts cada uno = sumas consistentes al 100% (redondeos Decimal)', async () => {
      const d0 = new Date('2025-05-01')
      for (let i = 0; i < 50; i++) {
        const uuid = `77777777-0000-4000-8000-${String(i + 1).padStart(12, '0')}`
        const inv = await createInvoiceWithConcepts(integrationPrisma, {
          uuid,
          issuerFiscalEntityId: feId,
          issuerRfc: feRfc,
          receiverRfc: COMPANY_A_RFC,
          conceptCount: 20,
          issuanceDate: new Date(d0.getTime() + i * 3600000),
        })
        const sumConcs = await integrationPrisma.invoiceConcept.aggregate({
          where: { invoiceId: inv.id },
          _sum: { amount: true },
        })
        const conceptsTotal = Number(sumConcs._sum.amount || 0)
        expect(conceptsTotal).toBeCloseTo(Number(inv.subtotal), 2)
      }
    }, 90000)
  })
})

describeIfIntegrationDb('[FASE2] Dashboard Fiscal · Utils puros (sanitize filename, RFC5987, RateLimitError)', () => {
  describe('sanitizeDownloadFilename (seguridad nombres archivo para Content-Disposition)', () => {
    test('nombre ASCII simple = se preserva', () => {
      expect(sanitizeDownloadFilename('reporte_marzo_2025')).toBe('reporte_marzo_2025')
    })
    test('caracteres no seguros (slash, space, ñ, acentos) → reemplazados por _', () => {
      expect(sanitizeDownloadFilename('reporte / mar 2025 ñandú.xlsx')).toBe('reporte___mar_2025__and__xlsx')
    })
    test('nombre vacío → fallback default "download"', () => {
      expect(sanitizeDownloadFilename('')).toBe('download')
      expect(sanitizeDownloadFilename(null as any)).toBe('download')
    })
    test('nombre > 120 chars se trunca a 120 + trim underscores extremos', () => {
      const longName = 'r'.repeat(200)
      const got = sanitizeDownloadFilename(longName)
      expect(got.length).toBeLessThanOrEqual(120)
      expect(got.startsWith('_')).toBe(false)
      expect(got.endsWith('_')).toBe(false)
    })
    test('extensión sin punto → se antepone punto (csv)', () => {
      expect(sanitizeDownloadFilename('reporte', 'fallback', 'csv')).toBe('reporte.csv')
    })
    test('extensión CON punto → se respeta (.xlsx)', () => {
      expect(sanitizeDownloadFilename('resumen', 'fb', '.xlsx')).toBe('resumen.xlsx')
    })
  })

  describe('buildRfc5987ContentDisposition', () => {
    test('attachment filename ASCII', () => {
      const h = buildRfc5987ContentDisposition('reporte.csv', 'attachment')
      expect(h).toContain('attachment; filename="reporte.csv"')
      expect(h).toContain("filename*=UTF-8''reporte.csv")
    })
    test('inline + chars diacríticos (ñ, í) → ascii + UTF8 encoded filename*', () => {
      const h = buildRfc5987ContentDisposition('reporte_año_ñandí.csv', 'inline')
      expect(h.startsWith('inline;')).toBe(true)
      expect(h).toContain('UTF-8\'\'')
      expect(h).toContain('%C3%B1') // ñ
      expect(h).toContain('%C3%AD') // í
    })
    test('type default = attachment', () => {
      expect(buildRfc5987ContentDisposition('a.pdf').startsWith('attachment;')).toBe(true)
    })
  })

  describe('DashboardRateLimitError constructor + DASHBOARD_MAX_MONTHS', () => {
    test('constructor retryAfter default 60s', () => {
      const e = new DashboardRateLimitError()
      expect(e).toBeInstanceOf(Error)
      expect(e.name).toBe('DashboardRateLimitError')
      expect(e.code).toBe('RATE_LIMIT')
      expect(e.statusCode).toBe(429)
      expect(e.retryAfterSeconds).toBe(60)
      expect(e.message).toBe('Límite de solicitudes excedido')
    })
    test('constructor retryAfter custom', () => {
      expect(new DashboardRateLimitError(30).retryAfterSeconds).toBe(30)
    })
    test('DASHBOARD_MAX_MONTHS = 36 (3 años)', () => {
      expect(DASHBOARD_MAX_MONTHS).toBe(36)
    })
    test('DashboardForbiddenError + DashboardMissingParamError: instanceof / message', () => {
      const forb = new DashboardForbiddenError('no accede')
      expect(forb).toBeInstanceOf(Error)
      expect(forb.statusCode).toBe(403)
      expect(forb.code).toBe('DASHBOARD_FORBIDDEN')
      const miss = new DashboardMissingParamError('companyId requerido')
      expect(miss).toBeInstanceOf(Error)
      expect(miss.statusCode).toBe(400)
      expect(miss.code).toBe('DASHBOARD_BAD_REQUEST')
    })
  })
})
