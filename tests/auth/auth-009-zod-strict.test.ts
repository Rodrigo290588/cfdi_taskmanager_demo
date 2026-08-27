import { z } from 'zod'
import { signUpSchema, signInSchema, inviteMemberSchema } from '@/schemas/auth'
import { AUTH_PAYLOAD_002_OVERPOSTING } from './fixtures/payloads'

type ZodIssueRecord = Record<string, unknown> & { params?: { keys?: unknown[] } }

function collectUnrecognizedKeys(result: unknown): string[] {
  const r = result as { success: boolean; error?: z.ZodError | null }
  if (r.success) return []
  const all: string[] = []
  const issues: ZodIssueRecord[] = JSON.parse(JSON.stringify(r.error?.issues || []))
  for (const issue of issues) {
    if (issue?.params?.keys && Array.isArray(issue.params.keys)) {
      for (const k of issue.params.keys) {
        if (typeof k === 'string') all.push(k)
      }
    }
  }
  return Array.from(new Set(all))
}
void collectUnrecognizedKeys

describe('AUTH-009: Zod .strict() bloquea overposting y prototype pollution', () => {
  test('signUpSchema rechaza AUTH-PAYLOAD-002 campos excedentes (overposting role/admin)', () => {
    const parse = signUpSchema.safeParse(AUTH_PAYLOAD_002_OVERPOSTING)
    expect(parse.success).toBe(false)
    const issuesJson = JSON.stringify(parse.error?.issues || [])
    expect(issuesJson).toContain('role')
    expect(issuesJson).toContain('isAdmin')
    expect(issuesJson).toContain('emailVerified')
    expect(issuesJson).toContain('unrecognized')
  })

  test('signUpSchema bloquea payload malicioso JSON-parseado con __proto__: Object.prototype sin leak', () => {
    const malicious = JSON.parse('{"name":"Maria","email":"m@test.mx","password":"Valido12345Aa!","confirmPassword":"Valido12345Aa!","__proto__":{"polluted":true}}')
    const parse = signUpSchema.safeParse(malicious)
    expect(parse.success).toBe(true)
    const polluted = (Object.prototype as { polluted?: unknown }).polluted
    expect(polluted).toBeUndefined()
  })

  test('signInSchema es estricto', () => {
    const res = signInSchema.safeParse({ email: 'x@y.mx', password: 'Valido12345!', extraField: true })
    expect(res.success).toBe(false)
    const issuesJson = JSON.stringify(res.error?.issues || [])
    expect(issuesJson).toContain('extraField')
    expect(issuesJson).toContain('unrecognized')
  })

  test('inviteMemberSchema es estricto — rechaza isSuperAdmin overposting', () => {
    const res = inviteMemberSchema.safeParse({
      email: 'new@user.mx',
      role: 'VIEWER',
      companyIds: ['a'],
      isSuperAdmin: true
    })
    expect(res.success).toBe(false)
    const issuesJson = JSON.stringify(res.error?.issues || [])
    expect(issuesJson).toContain('isSuperAdmin')
    expect(issuesJson).toContain('unrecognized')
  })
})
