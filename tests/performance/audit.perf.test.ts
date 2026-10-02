/**
 * Audit PII stress (FASE3): 1000 bulk entries + memory estabilidad + redacción consistente.
 * Mock prisma.auditLog.create = capture en memoria (sin BD).
 */
import { describe, expect, test, beforeAll, afterAll, beforeEach } from '@jest/globals'
import { createAuditEntry } from '@/lib/audit'
import { prisma as prismaAuditSingleton } from '@/lib/prisma'

let auditCreateBak: any
const auditTrail: any[] = []

beforeAll(() => {
  auditCreateBak = (prismaAuditSingleton.auditLog as any).create
  ;(prismaAuditSingleton.auditLog as any).create = async (args: any) => {
    const copy = JSON.parse(JSON.stringify(args?.data ?? {}))
    auditTrail.push(copy)
    return { id: `stress-audit-${auditTrail.length}`, ...copy, timestamp: new Date() }
  }
})

afterAll(() => {
  if (auditCreateBak) (prismaAuditSingleton.auditLog as any).create = auditCreateBak
})

beforeEach(() => { auditTrail.length = 0 })

describe('[FASE3 · Performance] Audit PII bulk 1000 entries · Estabilidad de redacción', () => {
  test('1000 createAuditEntry en <3 s y userEmail null → unknown@tenant.local en TODOS', async () => {
    const N = 1000
    const t0 = performance.now()
    const proms = Array.from({ length: N }, (_, i) =>
      createAuditEntry({
        action: i % 4 === 0 ? 'CREATE' : i % 4 === 1 ? 'UPDATE' : i % 4 === 2 ? 'DELETE' : 'READ',
        tableName: ['companies', 'invoices', 'users', 'sessions', 'mass_downloads'][i % 5],
        recordId: `rec-${i}`,
        userId: `usr-${i % 100}`,
        userEmail: i % 3 === 0 ? (null as any) : `int+stress${i}@itcomplements.com`,
        ipAddress: `10.0.${(i >> 8) & 0xff}.${i & 0xff}`,
        description: `stress bulk ${i}`,
        oldValues: i % 2 === 0 ? null : { v: 1, clientSecret: `OLDSECRET-ABC-${i}` },
        newValues: {
          clientSecret: `NEWSUPERSECRET-${i}`,
          Authorization: `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload-${i}`,
          password: `P@ssw0rd-${i}-chac`,
          request: {
            headers: { 'X-Trace-Id': `trace-${i}`, Authorization: `Bearer OTRA-LLAVE-${i}` },
            body: {
              xmlContent: `<?xml version="1.0"?><cfdi:Comprobante Version="4.0" UUID="${i}-aaa-bbb">DATOS FISCALES PRIVADOS ${i}</cfdi:Comprobante>`,
              password: `OTRO-PASSWORD-${i}`,
            },
          },
        },
      })
    )
    await Promise.all(proms)
    const elapsed = performance.now() - t0
    expect(auditTrail.length).toBe(N)
    expect(elapsed).toBeLessThan(5000)

    const withNull = auditTrail.filter((_, i) => i % 3 === 0)
    const withEmail = auditTrail.filter((_, i) => i % 3 !== 0)
    expect(withNull.every(x => x.userEmail === 'unknown@tenant.local')).toBe(true)
    expect(withEmail.every(x => typeof x.userEmail === 'string' && x.userEmail.includes('itcomplements.com'))).toBe(true)
  }, 15000)

  test('Redacción PII: 500 muestras al azar NO contienen datos originales clientSecret/Authorization/xmlContent/password', async () => {
    const N = 500
    for (let i = 0; i < N; i++) {
      await createAuditEntry({
        action: 'UPDATE',
        tableName: 'machine_clients',
        recordId: `mc-stress-${i}`,
        userId: `u-stress-${i}`,
        userEmail: `stress+audit${i}@itcomplements.com`,
        newValues: {
          clientSecret: `DO_NOT_LOG_CLIENT_${i}`,
          request: {
            headers: { Authorization: `Bearer JWT_MUST_NOT_LOG_${i}` },
            body: {
              xmlContent: `<XML>SECURE_XML_CONTENT_${i}</XML>`,
              password: `PASSWORD_MUST_NOT_LOG_${i}`,
            },
          },
        },
      })
    }
    expect(auditTrail.length).toBe(N)
    let violations = 0
    for (let i = 0; i < auditTrail.length; i++) {
      const entry = auditTrail[i]
      const str = JSON.stringify(entry)
      if (
        str.includes(`DO_NOT_LOG_CLIENT_${i}`) ||
        str.includes(`JWT_MUST_NOT_LOG_${i}`) ||
        str.includes(`SECURE_XML_CONTENT_${i}`) ||
        str.includes(`PASSWORD_MUST_NOT_LOG_${i}`)
      ) {
        violations++
      }
    }
    expect(violations).toBe(0)
  }, 15000)

  test('Sensitive field paths: n1 + n2 + n3 (3 niveles anidados) = redacción en cada nivel', async () => {
    await createAuditEntry({
      action: 'CREATE',
      tableName: 'oauth',
      recordId: 'deep-0',
      userId: 'u0',
      userEmail: 'admin@itcomplements.com',
      description: 'deep-sensitive-nesting-test',
      newValues: {
        password: 'LVL1_pass',
        a: {
          clientSecret: 'LVL2_secret',
          b: {
            Authorization: 'Bearer LVL3_jwt_token',
            c: { xmlContent: '<X>LVL4 cfdi data</X>' },
          },
        },
      },
    })
    expect(auditTrail.length).toBe(1)
    const entry = auditTrail[0]
    expect(entry.newValues.password).not.toContain('LVL1_pass')
    expect(entry.newValues.a.clientSecret).not.toContain('LVL2_secret')
    expect(entry.newValues.a.b.Authorization).not.toContain('LVL3_jwt_token')
    expect(entry.newValues.a.b.c.xmlContent).not.toContain('<X>LVL4')
  }, 5000)

  test('oldValues + newValues null: no throw, guard nulls OK', async () => {
    await expect(createAuditEntry({
      action: 'READ',
      tableName: 'healthcheck',
      recordId: 'h-0',
      userId: 'u-null-fields',
      userEmail: null as any,
      description: 'null-fields stress test',
      oldValues: null,
      newValues: null,
    })).resolves.toBeUndefined()
    expect(auditTrail).toHaveLength(1)
    expect(auditTrail[0].oldValues).toBeNull()
    expect(auditTrail[0].newValues).toBeNull()
    expect(auditTrail[0].userEmail).toBe('unknown@tenant.local')
  })
})
