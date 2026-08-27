/**
 * Anti-regresión SAST FASE 2-C · Dashboard Fiscal
 * Findings cubiertos (DF-009 al DF-012):
 *   DF-009 · DASHBOARD_RATE_LIMITS configuración correcta (mainHeavy, uploadXml, etc.)
 *   DF-010 · enforceDashboardRateLimit bloquea al superar el límite (mainHeavy: 30/min)
 *   DF-011 · enforceDashboardRateLimit scoped POR userId (aislamiento entre usuarios)
 *   DF-012 · uploadXml limit = 15 anti file-upload DoS
 *
 * Coverage target: lib/rate-limit.ts
 *   - DASHBOARD_RATE_LIMITS (definition)
 *   - enforceDashboardRateLimit (+ rateLimitByUserId + checkAndConsumeRateLimit)
 *   - clearRateLimit (+ rotateIfExpired indirecto)
 *
 * Ejecutar: npm run test -- tests/dashboard_fiscal/DF-009-012-rate-limit-dashboard.test.ts --runInBand
 */

import {
  enforceDashboardRateLimit,
  clearRateLimit,
  DASHBOARD_RATE_LIMITS,
  RateLimitError,
} from '@/lib/rate-limit'

describe('[DASHBOARD FISCAL SAST] DF-009 al DF-012 · Rate limit enforcement por usuario/route', () => {

  beforeEach(() => {
    clearRateLimit()
  })

  // ---------------------------------------------------------------------
  // DF-009 · Configuración DASHBOARD_RATE_LIMITS
  // ---------------------------------------------------------------------
  describe('DF-009 · DASHBOARD_RATE_LIMITS configuración base', () => {
    it('mainHeavy.intervalMs = 60s (1 minuto), limit = 30', () => {
      expect(DASHBOARD_RATE_LIMITS.mainHeavy.windowMs).toBe(60 * 1000)
      expect(DASHBOARD_RATE_LIMITS.mainHeavy.limit).toBe(30)
      expect(DASHBOARD_RATE_LIMITS.mainHeavy.key).toBe('dashboard:kpis-main')
    })

    it('uploadXml.limit = 15 anti DoS (subida de archivos XML)', () => {
      expect(DASHBOARD_RATE_LIMITS.uploadXml.limit).toBe(15)
      expect(DASHBOARD_RATE_LIMITS.uploadXml.windowMs).toBe(60 * 1000)
      expect(DASHBOARD_RATE_LIMITS.uploadXml.key).toBe('dashboard:xml-upload')
    })

    it('drilldown.limit = 60, invoices = 120', () => {
      expect(DASHBOARD_RATE_LIMITS.drilldown.limit).toBe(60)
      expect(DASHBOARD_RATE_LIMITS.invoices.limit).toBe(120)
    })

    it('partialDownload.limit = 10 (descarga zip pesada), cancelImport = 5', () => {
      expect(DASHBOARD_RATE_LIMITS.partialDownload.limit).toBe(10)
      expect(DASHBOARD_RATE_LIMITS.cancelImport.limit).toBe(5)
    })

    it('Todas las rutas tienen key, limit y windowMs positivos', () => {
      for (const [name, cfg] of Object.entries(DASHBOARD_RATE_LIMITS)) {
        expect(typeof cfg.key).toBe('string')
        expect(cfg.key.length).toBeGreaterThan(0)
        expect(typeof cfg.limit).toBe('number')
        expect(cfg.limit).toBeGreaterThan(0)
        expect(typeof cfg.windowMs).toBe('number')
        expect(cfg.windowMs).toBeGreaterThan(0)
        // Coverage de keyof typeof
        expect([
          'mainHeavy', 'drilldown', 'invoices', 'partialDownload',
          'partialReport', 'apiLogs', 'uploadXml', 'cancelImport'
        ]).toContain(name)
      }
    })
  })

  // ---------------------------------------------------------------------
  // DF-010 · enforceDashboardRateLimit bloquea después del límite mainHeavy 30
  // ---------------------------------------------------------------------
  describe('DF-010 · enforceDashboardRateLimit mainHeavy: 30 success + 31ª llamada bloqueada', () => {
    it('Las primeras 30 llamadas user1/mainHeavy NO lanzan excepción', () => {
      const userId = 'df010-user-001'
      let successCount = 0
      let errorCount = 0
      for (let i = 0; i < 30; i++) {
        try {
          enforceDashboardRateLimit(userId, 'mainHeavy')
          successCount++
        } catch {
          errorCount++
        }
      }
      expect(successCount).toBe(30)
      expect(errorCount).toBe(0)
    })

    it('La llamada 31 (user1/mainHeavy) SÍ lanza RateLimitError status 429', () => {
      const userId = 'df010-user-001'
      // Consumir 30
      for (let i = 0; i < 30; i++) {
        enforceDashboardRateLimit(userId, 'mainHeavy')
      }
      // Llamada 31
      let caught: RateLimitError | null = null
      try {
        enforceDashboardRateLimit(userId, 'mainHeavy')
      } catch (e) {
        if (e instanceof RateLimitError) caught = e
      }
      expect(caught).not.toBeNull()
      expect(caught).toBeInstanceOf(RateLimitError)
      expect(caught!.statusCode).toBe(429)
      expect(caught!.retryAfterMs).toBeGreaterThan(0)
      expect(caught!.retryAfterMs).toBeLessThanOrEqual(60_000)
      expect(caught!.message).toMatch(/[Dd]emasiadas|too many/i)
    })

    it('Llamadas 32..N también siguen bloqueadas mientras la ventana no expire', () => {
      const userId = 'df010-user-002'
      for (let i = 0; i < 30; i++) {
        enforceDashboardRateLimit(userId, 'mainHeavy')
      }
      let blocked = 0
      for (let i = 0; i < 5; i++) {
        try {
          enforceDashboardRateLimit(userId, 'mainHeavy')
        } catch (e) {
          if (e instanceof RateLimitError) blocked++
        }
      }
      expect(blocked).toBe(5)
    })
  })

  // ---------------------------------------------------------------------
  // DF-011 · Scoped por userId (user2 NO ve afectado el límite de user1)
  // ---------------------------------------------------------------------
  describe('DF-011 · enforceDashboardRateLimit scoped POR userId (aislamiento)', () => {
    it('user1 saturado no afecta a user2 (mainHeavy)', () => {
      const user1 = 'df011-isolation-user1'
      const user2 = 'df011-isolation-user2'

      // Saturar user1
      for (let i = 0; i < 30; i++) {
        enforceDashboardRateLimit(user1, 'mainHeavy')
      }
      // Confirmar user1 está bloqueado
      let user1Blocked = false
      try {
        enforceDashboardRateLimit(user1, 'mainHeavy')
      } catch (e) {
        if (e instanceof RateLimitError) user1Blocked = true
      }
      expect(user1Blocked).toBe(true)

      // Ahora user2 debe tener las 30 disponibles completas
      let user2Success = 0
      for (let i = 0; i < 30; i++) {
        try {
          enforceDashboardRateLimit(user2, 'mainHeavy')
          user2Success++
        } catch {
          break
        }
      }
      expect(user2Success).toBe(30)
    })

    it('Aislamiento por routeKey distinto (mainHeavy vs invoices)', () => {
      const user = 'df011-isolation-multiroute'
      // Saturar mainHeavy
      for (let i = 0; i < 30; i++) {
        enforceDashboardRateLimit(user, 'mainHeavy')
      }
      // invoices limit 120 todavía debe estar disponible (al menos 120 llamadas)
      let invoicesOk = 0
      for (let i = 0; i < 120; i++) {
        try {
          enforceDashboardRateLimit(user, 'invoices')
          invoicesOk++
        } catch {
          break
        }
      }
      expect(invoicesOk).toBe(120)
    })
  })

  // ---------------------------------------------------------------------
  // DF-012 · uploadXml limit = 15 (operación pesada de subida)
  // ---------------------------------------------------------------------
  describe('DF-012 · uploadXml limit = 15 anti file-upload flood', () => {
    it('Primeras 15 llamadas uploadXml OK', () => {
      const user = 'df012-upload-xml'
      let ok = 0
      for (let i = 0; i < 15; i++) {
        try {
          enforceDashboardRateLimit(user, 'uploadXml')
          ok++
        } catch {
          break
        }
      }
      expect(ok).toBe(15)
    })

    it('Llamada 16 uploadXml bloqueada con 429', () => {
      const user = 'df012-upload-xml-2'
      for (let i = 0; i < 15; i++) {
        enforceDashboardRateLimit(user, 'uploadXml')
      }
      let caught: RateLimitError | null = null
      try {
        enforceDashboardRateLimit(user, 'uploadXml')
      } catch (e) {
        if (e instanceof RateLimitError) caught = e
      }
      expect(caught).toBeInstanceOf(RateLimitError)
      expect(caught!.statusCode).toBe(429)
      expect(caught!.retryAfterMs).toBeGreaterThan(0)
    })
  })

  // ---------------------------------------------------------------------
  // Extra · clearRateLimit resetea estado
  // ---------------------------------------------------------------------
  describe('Extra · clearRateLimit resetea estado entre tests', () => {
    it('Después de clearRateLimit, usuario saturado vuelve a tener 30 llamadas', () => {
      const user = 'df-reset-user'
      for (let i = 0; i < 30; i++) {
        enforceDashboardRateLimit(user, 'mainHeavy')
      }
      // Confirmar bloqueado
      let blockedBefore = false
      try {
        enforceDashboardRateLimit(user, 'mainHeavy')
      } catch (e) {
        if (e instanceof RateLimitError) blockedBefore = true
      }
      expect(blockedBefore).toBe(true)

      // Resetear
      clearRateLimit()

      // Ahora debe funcionar de nuevo 30 veces
      let okAfter = 0
      for (let i = 0; i < 30; i++) {
        try {
          enforceDashboardRateLimit(user, 'mainHeavy')
          okAfter++
        } catch {
          break
        }
      }
      expect(okAfter).toBe(30)
    })
  })
})
