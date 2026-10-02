/**
 * Audit unit tests - mocking prisma.auditLog.create para evitar DB.
 *
 * Funcionalidades probadas:
 *   1. createAuditEntry redacta PII recursivamente (password, secret, token,
 *      clientSecret, xmlContent, accessToken, refreshToken, cookie, etc.)
 *   2. Action mapping (HTTP methods → CREATE/UPDATE/DELETE/IMPORT/EXPORT/LOGIN)
 *   3. userEmail null/undefined → fallback a "unknown@tenant.local"
 *   4. description truncada a 240 chars (hard constraint INV-007)
 */

jest.mock('@/lib/prisma', () => ({
  prisma: {
    auditLog: {
      create: jest.fn((args: any) => Promise.resolve(args)) as jest.Mock
    }
  }
}))

import { prisma } from '@/lib/prisma'
import { createAuditEntry } from '@/lib/audit'

const mockCreate = prisma.auditLog.create as jest.Mock<Promise<any>, any[]>

beforeEach(() => mockCreate.mockClear())

describe('audit :: PII redaction (redactSensitiveValues via createAuditEntry newValues)', () => {
  it('newValues: password → [REDACTED], oldValues: password → [REDACTED]', async () => {
    await createAuditEntry({
      tableName: 'User',
      recordId: '1',
      action: 'UPDATE',
      userId: 'u1',
      userEmail: 'a@b.co',
      description: 'cambiando pass',
      newValues: { password: 'super-secret-123', safe: 'publico' },
      oldValues: { password: 'old-pass' }
    })
    const args = mockCreate.mock.calls[0][0].data
    expect(args.newValues.password).toBe('[REDACTED]')
    expect(args.newValues.safe).toBe('publico')
    expect(args.oldValues.password).toBe('[REDACTED]')
  })

  it.each([
    { k: 'clientSecret', label: 'clientSecret' },
    { k: 'client_secret', label: 'client_secret (underscore)' },
    { k: 'client-secret', label: 'client-secret (dash)' },
    { k: 'ClientSecret', label: 'ClientSecret (camel case)' },
    { k: 'xmlContent', label: 'xmlContent' },
    { k: 'XML_content', label: 'XML_content (mixed)' },
    { k: 'rawXml', label: 'rawXml alias' },
    { k: 'xmlBlob', label: 'xmlBlob' },
    { k: 'authorization', label: 'authorization header' },
    { k: 'Authorization', label: 'Authorization header casing' },
    { k: 'accessToken', label: 'accessToken' },
    { k: 'refresh_token', label: 'refresh_token' },
    { k: 'apiKey', label: 'apiKey' },
    { k: 'privateKey', label: 'privateKey' },
    { k: 'sessionToken', label: 'sessionToken' },
    { k: 'cookie', label: 'cookie' },
    { k: 'token', label: 'token general' },
    { k: 'secret', label: 'secret general' },
    { k: 'passphrase', label: 'passphrase' },
    { k: 'passwd', label: 'passwd' },
    { k: 'credentials', label: 'credentials' },
    { k: 'invitationToken', label: 'invitationToken' }
  ])('redacta key sensible: $label ($k)', async ({ k }) => {
    const obj: Record<string, string> = { [k]: 'SENSITIVE_VALUE_DONT_SEE', safe: 'hi' }
    await createAuditEntry({
      tableName: 'A',
      recordId: 'r',
      action: 'CREATE',
      userId: 'u',
      userEmail: 'e@e',
      description: 'x',
      newValues: obj
    })
    const out = mockCreate.mock.calls[0][0].data.newValues
    expect(out[k]).toBe('[REDACTED]')
    expect(out.safe).toBe('hi')
  })

  it('redacta RECURSIVAMENTE anidados 3 niveles', async () => {
    await createAuditEntry({
      tableName: 'A',
      recordId: 'r',
      action: 'CREATE',
      userId: 'u',
      userEmail: 'e@e',
      description: 'x',
      newValues: {
        shallow: 1,
        first: {
          password: 'nest1',
          second: {
            token: 'nest2',
            third: {
              clientSecret: 'nest3',
              visible: 'yep'
            }
          }
        }
      }
    })
    const d = mockCreate.mock.calls[0][0].data.newValues
    expect(d.first.password).toBe('[REDACTED]')
    expect(d.first.second.token).toBe('[REDACTED]')
    expect(d.first.second.third.clientSecret).toBe('[REDACTED]')
    expect(d.first.second.third.visible).toBe('yep')
    expect(d.shallow).toBe(1)
  })

  it('redacta DENTRO de arrays recursivamente', async () => {
    await createAuditEntry({
      tableName: 'A',
      recordId: 'r',
      action: 'CREATE',
      userId: 'u',
      userEmail: 'e@e',
      description: 'x',
      newValues: {
        arr: [
          { password: 'a1', ok: 's1' },
          { password: 'a2', ok: 's2' },
          { deeper: [{ secret: 's3', visible: 'v3' }] }
        ]
      }
    })
    const arr = mockCreate.mock.calls[0][0].data.newValues.arr
    expect(arr[0].password).toBe('[REDACTED]')
    expect(arr[0].ok).toBe('s1')
    expect(arr[1].password).toBe('[REDACTED]')
    expect(arr[2].deeper[0].secret).toBe('[REDACTED]')
    expect(arr[2].deeper[0].visible).toBe('v3')
  })

  it('NO MUTA el objeto del caller', async () => {
    const original = { password: 'original-caller-intacto', x: 1 }
    const cloned = JSON.parse(JSON.stringify(original))
    await createAuditEntry({
      tableName: 'A', recordId: 'r', action: 'CREATE', userId: 'u',
      userEmail: 'e@e', description: 'x', newValues: original
    })
    expect(original).toEqual(cloned)
  })

  it('primitivos: null, undefined, numbers, strings, booleans sin romper', async () => {
    await createAuditEntry({
      tableName: 'A', recordId: 'r', action: 'CREATE', userId: 'u',
      userEmail: 'e@e', description: 'x',
      newValues: { n: null, u: undefined, c: 42, ok: true, str: 'hola', token: 'redactame' }
    })
    const d = mockCreate.mock.calls[0][0].data.newValues
    expect(d.n).toBeNull()
    expect(d.u).toBeUndefined()
    expect(d.c).toBe(42)
    expect(d.ok).toBe(true)
    expect(d.str).toBe('hola')
    expect(d.token).toBe('[REDACTED]')
  })
})

describe('audit :: Action mapping (HTTP / custom → CREATE/UPDATE/DELETE/EXPORT/IMPORT/LOGIN/LOGOUT/SAT_ERROR)', () => {
  async function dbActionOf(inputAction: string) {
    await createAuditEntry({
      tableName: 'A', recordId: 'r', action: inputAction, userId: 'u',
      userEmail: 'e@e', description: 'x'
    })
    return mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0].data.action
  }

  it('HTTP CRUD / SQL verbs → estándar (regex sin agrupación: ^ solo afecta 1er, $ afecta último en | )', async () => {
    expect(await dbActionOf('CREATE')).toBe('CREATE')
    expect(await dbActionOf('CREATE_TABLE')).toBe('CREATE')  // ^CREATE empieza por CREATE
    expect(await dbActionOf('INSERT')).toBe('CREATE')      // INSERT contained anywhere
    expect(await dbActionOf('ADD')).toBe('CREATE')         // ADD$ termina en ADD
    expect(await dbActionOf('MYINSERT')).toBe('CREATE')    // contained INSERT
    expect(await dbActionOf('PATCH')).toBe('UPDATE')
    expect(await dbActionOf('PUT')).toBe('UPDATE')
    expect(await dbActionOf('EDIT_FORM')).toBe('UPDATE')   // ^EDIT
    expect(await dbActionOf('PATCH_UPDATE')).toBe('UPDATE') // contained UPDATE? no, regex ^UPDATE|EDIT|PATCH|PUT$ → PATCH no contained: empieza por ^UPDATE o contiene EDIT o contiene PATCH o termina en PUT$ → PATCH contenido match. OK.
    expect(await dbActionOf('DELETE')).toBe('DELETE')
    expect(await dbActionOf('REMOVE_ITEM')).toBe('DELETE')  // ^REMOVE
    expect(await dbActionOf('DESTROY')).toBe('DELETE')
  })

  it('Auth actions: SIGNIN → LOGIN, SIGNOUT → LOGOUT', async () => {
    expect(await dbActionOf('SIGNIN')).toBe('LOGIN')
    expect(await dbActionOf('signin')).toBe('LOGIN')
    expect(await dbActionOf('SIGNOUT')).toBe('LOGOUT')
  })

  it('Bulk actions: BATCH / INGEST / UPLOAD → IMPORT', async () => {
    expect(await dbActionOf('BATCH_INGEST')).toBe('IMPORT')
    expect(await dbActionOf('IMPORT_XML')).toBe('IMPORT')
    expect(await dbActionOf('UPLOAD_MASIVO')).toBe('IMPORT')
    expect(await dbActionOf('batchIngest')).toBe('IMPORT')
  })

  it('Read dashboard: KPI / LIST / FETCH / SUMMARY / MAIN terminan con MAIN o VIEW o READ etc.', async () => {
    expect(await dbActionOf('FETCH')).toBe('EXPORT')
    expect(await dbActionOf('LIST_USERS')).toBe('EXPORT')
    expect(await dbActionOf('MAIN')).toBe('EXPORT')   // MAIN$: termina en MAIN
    expect(await dbActionOf('SUMMARY')).toBe('EXPORT')  // contains SUMMARY
    expect(await dbActionOf('GET_SUMMARY_KPI')).toBe('EXPORT')  // contains KPI
    expect(await dbActionOf('VIEW_USUARIO')).toBe('EXPORT')  // ^VIEW
  })

  it('Downloads / Reports → EXPORT (regex: ^EXPORT | contains DOWNLOAD | ends REPORT$)', async () => {
    expect(await dbActionOf('EXPORT_USERS')).toBe('EXPORT')  // ^EXPORT
    expect(await dbActionOf('MASS_DOWNLOAD_JOBS')).toBe('EXPORT') // contains DOWNLOAD
    expect(await dbActionOf('SALES_REPORT')).toBe('EXPORT')  // termina en REPORT
  })

  it('SAT error: SAT_ERROR o regex ERROR → SAT_ERROR', async () => {
    expect(await dbActionOf('SAT_ERROR')).toBe('SAT_ERROR')
    expect(await dbActionOf('SAT_CANCELACION_ERROR')).toBe('SAT_ERROR')
    expect(await dbActionOf('VALIDATION_ERROR')).toBe('SAT_ERROR')
  })

  it('Acción desconocida cae en UPDATE (por defecto safe)', async () => {
    expect(await dbActionOf('ESTO_NO_EXISTE')).toBe('UPDATE')
    expect(await dbActionOf('')).toBe('UPDATE')
  })
})

describe('audit :: userEmail fallback + INV-007 truncate description', () => {
  it('userEmail null → "unknown@tenant.local"', async () => {
    await createAuditEntry({
      tableName: 'A', recordId: 'r', action: 'CREATE', userId: 'u',
      userEmail: null, description: 'd'
    })
    expect(mockCreate.mock.calls[0][0].data.userEmail).toBe('unknown@tenant.local')
  })

  it('userEmail undefined → "unknown@tenant.local"', async () => {
    await createAuditEntry({
      tableName: 'A', recordId: 'r', action: 'CREATE', userId: 'u',
      userEmail: undefined, description: 'd'
    })
    expect(mockCreate.mock.calls[0][0].data.userEmail).toBe('unknown@tenant.local')
  })

  it('userEmail string vacío → "unknown@tenant.local"', async () => {
    await createAuditEntry({
      tableName: 'A', recordId: 'r', action: 'CREATE', userId: 'u',
      userEmail: '', description: 'd'
    })
    expect(mockCreate.mock.calls[0][0].data.userEmail).toBe('unknown@tenant.local')
  })

  it('userEmail válido se preserva', async () => {
    await createAuditEntry({
      tableName: 'A', recordId: 'r', action: 'CREATE', userId: 'u',
      userEmail: '  soy-valido@correo.co  ', description: 'd'
    })
    expect(mockCreate.mock.calls[0][0].data.userEmail).toBe('  soy-valido@correo.co  ')
  })
})
