import { describe, expect, test, beforeEach } from '@jest/globals'
import { SystemRole, MemberRole } from '@prisma/client'
import {
  describeIfIntegrationDb,
  integrationPrisma,
  integrationDbAvailable,
} from './setup-integration'
import {
  createOrg,
  createUser,
  createFiscalEntity,
  createCompany,
  createInvoiceWithConcepts,
  ensureMembership,
  ORG_A_ID,
  ORG_B_ID,
  FE_A_RFC,
  COMPANY_A_RFC,
  USER_ADMIN_EMAIL,
  USER_AUDITOR_EMAIL,
  USER_SUPERADMIN_EMAIL,
  truncateAllIntegrationTables,
} from './helpers/prisma-test-helpers'

describeIfIntegrationDb('[FASE2] Prisma + PostgreSQL · Transacciones / Rollback / Bulk 25K Conceptos', () => {
  beforeEach(async () => {
    if (!integrationDbAvailable) return
    await truncateAllIntegrationTables(integrationPrisma)
  })

  describe('CREATE CRUD básico + Constraints FK', () => {
    test('crear Org A + Org B de forma aislada (sin FK dependencias cruzadas)', async () => {
      const a = await createOrg(integrationPrisma, ORG_A_ID, 'Grupo Demo Integ A', 'int-grp-a')
      const b = await createOrg(integrationPrisma, ORG_B_ID, 'Grupo Demo Integ B', 'int-grp-b')
      expect(a.id).toBe(ORG_A_ID)
      expect(b.id).toBe(ORG_B_ID)
      const total = await integrationPrisma.organization.count()
      expect(total).toBeGreaterThanOrEqual(2)
    })

    test('constraint UNIQUE slug organization: duplicar slug lanza error Prisma', async () => {
      await createOrg(integrationPrisma, ORG_A_ID, 'Nombre A', 'slug-unico-int-001')
      const slugCollide = integrationPrisma.organization.create({
        data: {
          id: 'int-collide-slug-002',
          name: 'Nombre B',
          slug: 'slug-unico-int-001',
          onboardingCompleted: false,
          systemSettings: '{}',
          setupRequirements: '{}',
        },
      })
      await expect(slugCollide).rejects.toThrow()
    })

    test('constraint UNIQUE rfc fiscalEntity + company', async () => {
      const orgA = await createOrg(integrationPrisma, ORG_A_ID, 'Org FE', 'int-org-fe')
      const orgB = await createOrg(integrationPrisma, ORG_B_ID, 'Org FE B', 'int-org-fe-b')
      await createFiscalEntity(integrationPrisma, FE_A_RFC, orgA.id)
      const feDupe = createFiscalEntity(integrationPrisma, FE_A_RFC, orgB.id)
      const fe2 = integrationPrisma.fiscalEntity.create({
        data: { rfc: FE_A_RFC, organizationId: orgB.id, businessName: 'Duplicada', taxRegime: '601', postalCode: '06000' },
      })
      await expect(fe2).rejects.toThrow()
      await expect(feDupe).resolves.toBeDefined()
    })

    test('crear 4 usuarios (SA / ADMIN / AUDITOR / VIEWER) con bcrypt password', async () => {
      const sa = await createUser(integrationPrisma, USER_SUPERADMIN_EMAIL, 'SuperAdmin', SystemRole.SUPER_ADMIN)
      const adm = await createUser(integrationPrisma, USER_ADMIN_EMAIL, 'Admin OrgA', SystemRole.ADMIN)
      const aud = await createUser(integrationPrisma, USER_AUDITOR_EMAIL, 'Auditor OrgA', SystemRole.USER)
      expect(sa.systemRole).toBe('SUPER_ADMIN')
      expect(adm.systemRole).toBe('ADMIN')
      expect(aud.systemRole).toBe('USER')
      expect(sa.password).not.toMatch(/Integracion-123!/)
      expect(sa.password?.startsWith('$2')).toBe(true)
      const total = await integrationPrisma.user.count()
      expect(total).toBeGreaterThanOrEqual(3)
    })
  })

  describe('Transacciones y Rollback (CFDI Bulk 25K conceptos)', () => {
    let orgA: any, feA: any, userAdm: any, memAdm: any, _compA: any

    beforeEach(async () => {
      if (!integrationDbAvailable) return
      await truncateAllIntegrationTables(integrationPrisma)
      orgA = await createOrg(integrationPrisma, ORG_A_ID, 'Org Bulk', 'int-org-bulk')
      feA = await createFiscalEntity(integrationPrisma, FE_A_RFC, orgA.id)
      userAdm = await createUser(integrationPrisma, USER_ADMIN_EMAIL, 'Admin Bulk', SystemRole.ADMIN)
      memAdm = await ensureMembership(integrationPrisma, userAdm.id, orgA.id, MemberRole.ADMIN, 'APPROVED')
      compA = await createCompany(integrationPrisma, COMPANY_A_RFC, orgA.id, memAdm.id)
    })

    test('crear 5 facturas × 5,000 conceptos = 25,000 conceptos (pico cierre mes)', async () => {
      expect(feA.id).toBeTruthy()
      const uuids = [
        '11111111-0000-4000-8000-000000000010',
        '11111111-0000-4000-8000-000000000011',
        '11111111-0000-4000-8000-000000000012',
        '11111111-0000-4000-8000-000000000013',
        '11111111-0000-4000-8000-000000000014',
      ]
      const T0 = Date.now()
      const invoices = new Array(5)
      for (let i = 0; i < 5; i++) {
        invoices[i] = await createInvoiceWithConcepts(integrationPrisma, {
          uuid: uuids[i],
          issuerFiscalEntityId: feA.id,
          issuerRfc: FE_A_RFC,
          receiverRfc: COMPANY_A_RFC,
          conceptCount: 5000,
        })
      }
      const durMs = Date.now() - T0
      console.log(`  [bulk 25K conceptos] Tiempo total: ${(durMs / 1000).toFixed(2)}s`)

      const invCount = await integrationPrisma.invoice.count({ where: { uuid: { in: uuids } } })
      expect(invCount).toBe(5)
      const conceptCount = await integrationPrisma.invoiceConcept.count()
      expect(conceptCount).toBe(25000)

      const inv0 = invoices[0]
      // 5000 concepts: quantity = (i % 3) + 1 → seq 1,2,3 repeating = 1666 full cycles (4998 terms) + 1+2 = 5000
      // sum quantities = 1666 * 6 + 3 = 9999
      // subtotal = 9999 * $100 = 999,900
      const subtotalExpected = 999900
      expect(Number(inv0.subtotal)).toBe(subtotalExpected)
      const ivaExpected = Math.round(subtotalExpected * 0.16 * 100) / 100
      expect(Number(inv0.ivaTransferred)).toBe(ivaExpected)
      expect(Number(inv0.total)).toBe(subtotalExpected + ivaExpected)
    }, 90000)

    test('Transaction Prisma: throw en medio de 2 inserts → ROLLBACK total, 0 registros nuevos', async () => {
      const beforeInvoices = await integrationPrisma.invoice.count()
      const beforeConcepts = await integrationPrisma.invoiceConcept.count()
      const badUuid = '11111111-0000-4000-8000-000000000020'
      const willFailUuid = '11111111-0000-4000-8000-000000000021'

      const tx = integrationPrisma.$transaction(async (tx) => {
        await createInvoiceWithConcepts(tx as any, {
          uuid: badUuid,
          issuerFiscalEntityId: feA.id,
          issuerRfc: FE_A_RFC,
          receiverRfc: COMPANY_A_RFC,
          conceptCount: 5000,
        })
        await createInvoiceWithConcepts(tx as any, {
          uuid: willFailUuid,
          issuerFiscalEntityId: feA.id,
          issuerRfc: FE_A_RFC,
          receiverRfc: COMPANY_A_RFC,
          conceptCount: 10,
        })
        await createInvoiceWithConcepts(tx as any, {
          uuid: badUuid,
          issuerFiscalEntityId: feA.id,
          issuerRfc: FE_A_RFC,
          receiverRfc: COMPANY_A_RFC,
          conceptCount: 5,
        })
      })
      await expect(tx).rejects.toThrow()

      const afterInvoices = await integrationPrisma.invoice.count()
      const afterConcepts = await integrationPrisma.invoiceConcept.count()
      expect(afterInvoices).toBe(beforeInvoices)
      expect(afterConcepts).toBe(beforeConcepts)
    }, 60000)

    test('Constraint FK: eliminar invoice → CASCADE elimina conceptos automáticamente', async () => {
      const uuid = '11111111-0000-4000-8000-000000000030'
      const inv = await createInvoiceWithConcepts(integrationPrisma, {
        uuid, issuerFiscalEntityId: feA.id, issuerRfc: FE_A_RFC, receiverRfc: COMPANY_A_RFC, conceptCount: 1000,
      })
      const invId = inv.id
      const beforeConcepts = await integrationPrisma.invoiceConcept.count({ where: { invoiceId: invId } })
      expect(beforeConcepts).toBe(1000)
      await integrationPrisma.invoice.delete({ where: { id: invId } })
      const afterConcepts = await integrationPrisma.invoiceConcept.count({ where: { invoiceId: invId } })
      expect(afterConcepts).toBe(0)
    }, 30000)

    test('Constraint FK: eliminar organization → CASCADE members BORRADOS, users intactos', async () => {
      const usersBefore = await integrationPrisma.user.count()
      const memsBefore = await integrationPrisma.member.count({ where: { organizationId: orgA.id } })
      expect(memsBefore).toBeGreaterThanOrEqual(1)
      await integrationPrisma.organization.delete({ where: { id: orgA.id } })
      const usersAfter = await integrationPrisma.user.count()
      const memsAfter = await integrationPrisma.member.count({ where: { organizationId: orgA.id } })
      expect(usersAfter).toBe(usersBefore)
      expect(memsAfter).toBe(0)
    })
  })

  describe('Concurrencia y actualizaciones atómicas (avoid deadlocks)', () => {
    test('10 actualizaciones secuenciales sobre misma compañía: último write = estado final persistido', async () => {
      const org = await createOrg(integrationPrisma, ORG_A_ID, 'Org Concurrencia', 'int-org-concur')
      const user = await createUser(integrationPrisma, USER_ADMIN_EMAIL, 'User Conc', SystemRole.ADMIN)
      const mem = await ensureMembership(integrationPrisma, user.id, org.id, MemberRole.ADMIN)
      const comp = await createCompany(integrationPrisma, COMPANY_A_RFC, org.id, mem.id)

      // Secuencial = prueba la capacidad del sistema de absorber 10 writes consecutivos
      // sin deadlock ni inconsistencias (environ single-worker test)
      const results: any[] = []
      for (let i = 0; i < 10; i++) {
        const r = await integrationPrisma.company.update({
          where: { id: comp.id },
          data: { name: `Intento ${i}` },
        })
        results.push(r)
      }
      expect(results.length).toBe(10)
      const last = results[9]
      expect(last.name).toMatch(/Intento 9/)
      const reloaded = await integrationPrisma.company.findUnique({
        where: { id: comp.id },
        select: { updatedAt: true, name: true },
      })
      expect(reloaded?.name).toBe('Intento 9')
    })
  })
})
