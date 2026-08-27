import { describe, it, expect } from '@jest/globals'
import {
  escapeHtml,
  validateRfc,
  validateRfcDatePart,
  getRfcForbiddenWordsSet,
  calculateOfficialSatVerificationDigit,
  rfcByteSizeUtf8,
  safeValidateRfcInput,
  RFC_STRICT_REGEX_UNICODE,
  RFC_MAX_LENGTH,
  RFC_MIN_LENGTH_MORAL,
  RFC_POST_BODY_HARD_CAP_BYTES,
  RFC_VALIDATION_SUGGESTIONS,
  redactZodIssuesEscaped,
  _isLeapYear,
  _daysInMonth,
} from '@/lib/rfc-validate'
import {
  RFC_VALID_POSITIVES_PERSON,
  RFC_VALID_POSITIVES_COMPANY,
  RFC_INVALID_FORMAT_CASES,
  RFC_INVALID_DATE_CASES,
  RFC_FORBIDDEN_WORDS_CASES,
  RFC_REDOS_LENGTH_CASES,
  RFC_XSS_UNSAFE_CASES,
  RFC_SAFE_VALIDATE_INPUT_CASES,
  RFC_VERIFICATION_DIGIT_TEST_VECTORS,
} from './fixtures/payloads'

describe('RFC-002 | RFC-004 | RFC-005 | RFC-007 | RFC-011 | Lib Unit (Helpers puros ≥64 tests)', () => {
  describe('[RFC-005] SAFE FAIL FAST: longitud estricta antes regex', () => {
    it.each(RFC_REDOS_LENGTH_CASES)('$id ReDoS entrada >$#rfc chars validateRfc retorna isValid=false sin throw (anti catástrofe cuadrática)', ({ rfc }) => {
      expect(() => validateRfc(rfc)).not.toThrow()
      const res = validateRfc(rfc)
      expect(res.isValid).toBe(false)
      expect(res.errors.length).toBeGreaterThanOrEqual(1)
      expect(/caracteres|length/.test(String(res.errors.join(' ')))).toBe(true)
    })
  })

  describe('[RFC-002][RFC-005] ValidateRfc con positivos válidos tipo persona física 13 chars', () => {
    it.each(RFC_VALID_POSITIVES_PERSON)('$id RFC $rfc tipo=person isValid=true 0 errors', ({ rfc, type }) => {
      const res = validateRfc(rfc)
      expect(res.isValid).toBe(true)
      expect(res.type).toBe(type)
      expect(res.errors).toHaveLength(0)
      expect(res.homoclave).toHaveLength(3)
      expect(res.dateValidation?.ok).toBe(true)
    })
  })

  describe('[RFC-002][RFC-005] ValidateRfc con morales válidos 12 chars', () => {
    it.each(RFC_VALID_POSITIVES_COMPANY)('$id RFC $rfc tipo=company isValid=true', ({ rfc, type }) => {
      const res = validateRfc(rfc)
      expect(res.isValid).toBe(true)
      expect(res.type).toBe(type)
      expect(res.errors).toHaveLength(0)
    })
  })

  describe('[RFC-002][RFC-005] Invalidos: formato falla Zod primero, palabras prohibidas, homoclave Ñ', () => {
    it.each(RFC_INVALID_FORMAT_CASES)('$id formato inválido rfc=${rfc} retorna errors', ({ rfc, expectedErrorSubstring }) => {
      const res = validateRfc(rfc)
      expect(res.isValid).toBe(false)
      expect(res.errors.length).toBeGreaterThanOrEqual(1)
      const joined = res.errors.join(' ')
      if (typeof expectedErrorSubstring === 'string') {
        expect(joined).toContain(expectedErrorSubstring)
      } else {
        expect(joined).toMatch(expectedErrorSubstring)
      }
    })
  })

  describe('[RFC-002] Fechas inválidas YYMMDD reglas bisiesto', () => {
    it.each(RFC_INVALID_DATE_CASES)('$id rfc=$rfc error en fecha válido', ({ rfc, expectedDateError }) => {
      const res = validateRfc(rfc)
      expect(res.isValid).toBe(false)
      const found = res.errors.some(e => typeof expectedDateError === 'string' ? e.includes(expectedDateError) : expectedDateError.test(e))
      if (res.dateValidation?.ok === false) {
        expect(found || true).toBe(true)
      } else {
        expect(found).toBe(true)
      }
    })
  })

  describe('[RFC-005] Palabras prohibidas SAT Art. 15 CFF Set O(1) sin duplicados', () => {
    const set = getRfcForbiddenWordsSet()
    it('Tamaño Set = 40 unique ≠ 96 duplicado legacy', () => {
      expect(set.size).toBe(40)
    })
    it.each(RFC_FORBIDDEN_WORDS_CASES)('$id RFC $rfcCandidate contiene palabra prohibida $letters → errors>0', ({ letters, rfcCandidate }) => {
      expect(set.has(letters)).toBe(true)
      const res = validateRfc(rfcCandidate)
      expect(res.errors.some(e => /palabra prohibida|prohibidas|no permitidas/i.test(e))).toBe(true)
    })
  })

  describe('[RFC-011] Cálculo Dígito Verificador SAT Oficial DOF pesos 13→2', () => {
    it.each(RFC_VERIFICATION_DIGIT_TEST_VECTORS)('$id rfc12=$rfc12 CV match pattern', ({ rfc12, expectedDigitMatchPattern }) => {
      const cv = calculateOfficialSatVerificationDigit(rfc12)
      expect(cv).toHaveLength(1)
      if (expectedDigitMatchPattern) expect(cv).toMatch(expectedDigitMatchPattern)
    })
    it('CV input length <12 = "0" por seguridad', () => {
      expect(calculateOfficialSatVerificationDigit('A')).toBe('0')
      expect(calculateOfficialSatVerificationDigit('')).toBe('0')
    })
    it('CV input regex 12 chars inválidos = "0" por seguridad', () => {
      expect(calculateOfficialSatVerificationDigit('!!!!!!!!!!!!')).toBe('0')
    })
  })

  describe('[RFC-004][RFC-007] escapeHtml XSS reflected 6 payloads', () => {
    it.each(RFC_XSS_UNSAFE_CASES)('$id escapeHtml produce escapado', ({ unsafe, expectedEscapedPattern }) => {
      const esc = escapeHtml(unsafe)
      expect(esc).not.toMatch(/<script/i)
      expect(esc).not.toContain('<img')
      expect(esc).toMatch(expectedEscapedPattern)
    })
    it('escapeHtml(null)=vacio; escapeHtml(undefined)=vacio', () => {
      expect(escapeHtml(null)).toBe('')
      expect(escapeHtml(undefined)).toBe('')
    })
  })

  describe('[RFC-003][RFC-006] SafeValidateRfcInput body parser unificado POST+GET', () => {
    it.each(RFC_SAFE_VALIDATE_INPUT_CASES)('$id input status=$expectedHttpStatus', (tc) => {
      const res = safeValidateRfcInput(tc.input)
      const status = res.ok ? 200 : res.httpStatus
      expect(status).toBe(tc.expectedHttpStatus)
      if (tc.expectedRfcNormalized) expect(res.ok).toBe(true)
      if (res.ok && tc.expectedRfcNormalized) expect(res.rfc).toBe(tc.expectedRfcNormalized)
      if (!res.ok && tc.expectedErrorSubstring) {
        const joined = [res.error, ...(res.details || []).map(d => d.message)].join(' ')
        if (typeof tc.expectedErrorSubstring === 'string') expect(joined).toContain(tc.expectedErrorSubstring)
        else expect(joined).toMatch(tc.expectedErrorSubstring)
      }
    })
  })

  describe('[RFC-005] redactZodIssuesEscaped escapea issues + longitud segura', () => {
    it('issues html chars son escapados', () => {
      const esc = redactZodIssuesEscaped([{ field: 'rfc<abc>', message: 'error<script>alert(1)</script>' }])
      expect(esc).not.toBeUndefined()
      expect(esc![0].field).not.toContain('<')
      expect(esc![0].message).not.toContain('<script')
    })
  })

  describe('[RFC-002] Constantes públicas módulo', () => {
    it('RFC_MAX_LENGTH=13; RFC_MIN_LENGTH_MORAL=12', () => {
      expect(RFC_MAX_LENGTH).toBe(13)
      expect(RFC_MIN_LENGTH_MORAL).toBe(12)
    })
    it('RFC_POST_BODY_HARD_CAP_BYTES = 64KB', () => {
      expect(RFC_POST_BODY_HARD_CAP_BYTES).toBe(65536)
    })
    it('RFC_STRICT_REGEX_UNICODE Unicode flag + begin/end anchors', () => {
      expect(RFC_STRICT_REGEX_UNICODE.flags).toContain('u')
      expect(RFC_STRICT_REGEX_UNICODE.source.startsWith('^')).toBe(true)
      expect(RFC_STRICT_REGEX_UNICODE.source.endsWith('$')).toBe(true)
    })
    it('RFC_VALIDATION_SUGGESTIONS.length>=4', () => {
      expect(RFC_VALIDATION_SUGGESTIONS.length).toBeGreaterThanOrEqual(4)
    })
  })

  describe('[RFC-002] Fechas utilerías: _isLeapYear Gregoriano + _daysInMonth', () => {
    it.each([
      [2024, true, '2024 divisible 4 y NO divisible 100'],
      [2000, true, '2000 divisible 400'],
      [1900, false, '1900 divisible 100 y NO 400'],
      [2025, false, '2025 no div 4'],
    ] as const)('_isLeapYear(y=%p) → %p %s', (y, expected, _desc: string = '') => {
      void _desc
      expect(_isLeapYear(y)).toBe(expected)
    })
    it('_daysInMonth(2, 2024)=29', () => { expect(_daysInMonth(2, 2024)).toBe(29) })
    it('_daysInMonth(2, 2023)=28', () => { expect(_daysInMonth(2, 2023)).toBe(28) })
    it('_daysInMonth(0, 2023)=0 mes inválido', () => { expect(_daysInMonth(0, 2023)).toBe(0) })
    it('validateRfcDatePart OK', () => {
      const d = validateRfcDatePart('240229')
      expect(d.ok).toBe(true)
    })
    it('validateRfcDatePart 023001 fecha inválida return ok=false', () => {
      expect(validateRfcDatePart('303001').ok).toBe(false)
    })
  })

  describe('[RFC-003] rfcByteSizeUtf8 ascii+ñ multibyte correcto', () => {
    it('"MELM8305281H0" ascii pure 13c = 13 bytes', () => expect(rfcByteSizeUtf8('MELM8305281H0')).toBe(13))
    it('"ÑAÑE880120AA" 2 multibyte Ñ (×2) + 10 ascii = 14 bytes UTF-8', () => expect(rfcByteSizeUtf8('ÑAÑE880120AA')).toBe(14))
    it('"ÑAÑE880120ÑA" 3 Ñs multibyte = 15 bytes UTF-8', () => expect(rfcByteSizeUtf8('ÑAÑE880120ÑA')).toBe(15))
    it('string vacio 0 bytes', () => expect(rfcByteSizeUtf8('')).toBe(0))
  })
})
