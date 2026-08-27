/**
 * [SAST-FIX #9] Rate limiter en memoria simple (windowed counter per key).
 *
 * Diseño lightweight pensado para endpoints admin-protegidos (usuario ya autenticado).
 * No usa Redis ni persistencia: en un despliegue multi-instancia no sincroniza
 * entre pods, pero es suficiente para el scope local de Next.js dev/prod single-node
 * y evita agregar una dependencia nueva.
 *
 * Para despliegues multi-replica, reemplazar el store interno por Redis INCR + EXPIRE.
 */

interface Slice {
  windowStart: number
  counts: Record<string, number>
}

let store: Slice = {
  windowStart: Date.now(),
  counts: {}
}

function rotateIfExpired(windowMs: number) {
  const now = Date.now()
  if (now - store.windowStart >= windowMs) {
    store = { windowStart: now, counts: {} }
  }
}

export interface RateLimitOpts {
  /** Llave que identifica el recurso a limitar (ej: "admin-status-patch") */
  key: string
  /** Id del usuario autenticado (si aplica). Si se omite solo se usa key global. */
  userId?: string
  /** IP o identificador de cliente (fallback si no hay userId). */
  clientId?: string
  /** Cantidad máxima de requests permitida en el período. */
  limit: number
  /** Duración de la ventana en milisegundos (ej: 60_000 = 1 minuto). */
  windowMs: number
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAfterMs: number
  used: number
  limit: number
}

/**
 * Registra 1 request dentro de la ventana y retorna el estado del límite.
 * No lanza error: es responsabilidad del handler decidir el NextResponse.
 */
export function checkAndConsumeRateLimit(opts: RateLimitOpts): RateLimitResult {
  const { key, userId, clientId, limit, windowMs } = opts
  rotateIfExpired(windowMs)

  const discriminator = userId ?? clientId ?? 'global'
  const composedKey = `${key}::${discriminator}`
  const used = (store.counts[composedKey] || 0) + 1
  store.counts[composedKey] = used

  const allowed = used <= limit
  const remaining = Math.max(0, limit - used)
  const resetAfterMs = Math.max(0, windowMs - (Date.now() - store.windowStart))

  return { allowed, remaining, resetAfterMs, used, limit }
}

export class RateLimitError extends Error {
  readonly statusCode = 429
  readonly retryAfterMs: number
  constructor(message: string, retryAfterMs: number) {
    super(message)
    this.name = 'RateLimitError'
    this.retryAfterMs = retryAfterMs
  }
}

/**
 * Helper declarativo: consume y si excede lanza RateLimitError (429).
 * Manejar en catch del route handler para responder headers Retry-After.
 *
 * Ej:
 *   await rateLimitByUserId({
 *     userId: session.user.id,
 *     key: 'admin-status-patch',
 *     limit: 30,
 *     windowMs: 60_000
 *   })
 */
export function rateLimitByUserId(
  opts: Omit<RateLimitOpts, 'clientId'> & { userId: string }
): RateLimitResult {
  const res = checkAndConsumeRateLimit(opts)
  if (!res.allowed) {
    throw new RateLimitError(
      `Demasiadas solicitudes. Intenta nuevamente en ${Math.ceil(res.resetAfterMs / 1000)}s.`,
      res.resetAfterMs
    )
  }
  return res
}

/** Helper para endpoints anónimos o pre-auth, limitando por clientId/IP. */
export function rateLimitByClientId(
  opts: Omit<RateLimitOpts, 'userId'> & { clientId: string }
): RateLimitResult {
  const res = checkAndConsumeRateLimit(opts)
  if (!res.allowed) {
    throw new RateLimitError(
      `Demasiadas solicitudes. Intenta nuevamente en ${Math.ceil(res.resetAfterMs / 1000)}s.`,
      res.resetAfterMs
    )
  }
  return res
}

/**
 * [SAST-FIX #9 compat legacy] Firma original usada extensamente en auth, register,
 * M2M endpoints y CFDI Import routes. Async (para eventual reemplazo por Redis).
 * Segundo argumento `opts.interval` = windowMs. Retorna shape legacy con
 * `success` booleano y `resetAt` (timestamp ms) + `retryAfterMs`.
 */
export interface LegacyRateLimitResult {
  success: boolean
  limit: number
  remaining: number
  resetAt: number
  retryAfterMs: number
  used?: number
}

export async function rateLimit(
  key: string,
  opts: { interval: number; limit: number; silent?: boolean }
): Promise<LegacyRateLimitResult> {
  const { interval, limit } = opts
  const res = checkAndConsumeRateLimit({
    key,
    limit,
    windowMs: interval
  })
  const now = Date.now()
  return {
    success: res.allowed,
    limit: res.limit,
    remaining: res.remaining,
    resetAt: now + res.resetAfterMs,
    retryAfterMs: res.resetAfterMs,
    used: res.used
  }
}

export function clearRateLimit(): void {
  store = { windowStart: Date.now(), counts: {} }
}

// COMPANIES-014 · Wrapper estandarizado para aplicar rate-limits en todas las rutas /api/companies/**
// Evita duplicar llamadas y números mágicos en cada route handler.

export const COMPANIES_RATE_LIMITS = {
  create: { key: 'companies:create', limit: 20, windowMs: 60 * 60 * 1000 },
  search: { key: 'companies:search', limit: 100, windowMs: 60 * 60 * 1000 },
  approve: { key: 'companies:approve', limit: 30, windowMs: 60 * 60 * 1000 },
  update: { key: 'companies:update', limit: 15, windowMs: 60 * 60 * 1000 },
} as const

export type CompaniesRouteKey = keyof typeof COMPANIES_RATE_LIMITS

/**
 * Helper one-liner para routes de companies: consume rate-limit y lanza 429 si excede.
 * Ej:  enforceCompaniesRateLimit(session.user.id, 'create')
 */
export function enforceCompaniesRateLimit(userId: string, routeKey: CompaniesRouteKey): RateLimitResult {
  const cfg = COMPANIES_RATE_LIMITS[routeKey]
  return rateLimitByUserId({ userId, key: cfg.key, limit: cfg.limit, windowMs: cfg.windowMs })
}

// DASHBOARD-008 · Wrapper estandarizado para 14 rutas /api/dashboard_fiscal/**
// Evita duplicar números mágicos en cada route handler. Permite migrar a Redis backend
// sin cambiar firmas de los consumidores (igual que COMPANIES_RATE_LIMITS legacy).

export const DASHBOARD_RATE_LIMITS = {
  mainHeavy: { key: 'dashboard:kpis-main', limit: 30, windowMs: 60 * 1000 },
  drilldown: { key: 'dashboard:drilldown', limit: 60, windowMs: 60 * 1000 },
  invoices: { key: 'dashboard:invoices-workpaper', limit: 120, windowMs: 60 * 1000 },
  partialDownload: { key: 'dashboard:ppd-zip-download', limit: 10, windowMs: 60 * 1000 },
  partialReport: { key: 'dashboard:ppd-report', limit: 60, windowMs: 60 * 1000 },
  apiLogs: { key: 'dashboard:api-logs', limit: 120, windowMs: 60 * 1000 },
  uploadXml: { key: 'dashboard:xml-upload', limit: 15, windowMs: 60 * 1000 },
  cancelImport: { key: 'dashboard:cancel-layout', limit: 5, windowMs: 60 * 1000 },
  // ---- Dashboard Recibidos (DR keys) ----
  uploadMassive: { key: 'dashboard-recibidos:massive-upload', limit: 10, windowMs: 60 * 1000 },
  drilldownAgg: { key: 'dashboard-recibidos:drilldown-agg', limit: 60, windowMs: 60 * 1000 },
  drilldownInvoices: { key: 'dashboard-recibidos:drilldown-invoices', limit: 120, windowMs: 60 * 1000 },
  drilldownPdf: { key: 'dashboard-recibidos:drilldown-pdf', limit: 15, windowMs: 60 * 1000 },
  drilldownXml: { key: 'dashboard-recibidos:drilldown-xml', limit: 20, windowMs: 60 * 1000 },
} as const

export type DashboardRouteKey = keyof typeof DASHBOARD_RATE_LIMITS

export function enforceDashboardRateLimit(userId: string, routeKey: DashboardRouteKey): RateLimitResult {
  const cfg = DASHBOARD_RATE_LIMITS[routeKey]
  return rateLimitByUserId({ userId, key: cfg.key, limit: cfg.limit, windowMs: cfg.windowMs })
}

// USER-006 / USR-007 · Wrapper estandarizado para 5 verbos /api/user/**
// Evita duplicar números mágicos y permite migrar a Redis sin cambiar firmas.
export const USER_RATE_LIMITS = {
  companyAccess: { key: 'user:company-access', limit: 60, windowMs: 60 * 1000 },
  member: { key: 'user:member', limit: 60, windowMs: 60 * 1000 },
  profileGet: { key: 'user:profile-get', limit: 120, windowMs: 60 * 1000 },
  profilePost: { key: 'user:profile-post', limit: 30, windowMs: 60 * 1000 },
  avatarPost: { key: 'user:avatar-post', limit: 10, windowMs: 60 * 1000 },
  avatarDelete: { key: 'user:avatar-delete', limit: 15, windowMs: 60 * 1000 },
} as const

export type UserRouteKey = keyof typeof USER_RATE_LIMITS

export function enforceUserRateLimit(userId: string, routeKey: UserRouteKey): RateLimitResult {
  const cfg = USER_RATE_LIMITS[routeKey]
  return rateLimitByUserId({ userId, key: cfg.key, limit: cfg.limit, windowMs: cfg.windowMs })
}

export const AUTH_RATE_LIMITS = {
  registerIp:          { key: 'auth:register:ip',          limit: 8,  windowMs: 60 * 60 * 1000 },
  registerIpEmail:     { key: 'auth:register:ip:email',    limit: 2,  windowMs: 12 * 60 * 60 * 1000 },
  signinEmail:         { key: 'auth:signin:email',         limit: 15, windowMs: 15 * 60 * 1000 },
  inviteVerifyIp:      { key: 'auth:invite:verify:ip',     limit: 12, windowMs: 10 * 60 * 1000 },
  inviteAcceptIp:      { key: 'auth:invite:accept:ip',     limit: 5,  windowMs: 60 * 1000 },
  completeRegId:       { key: 'auth:complete:id',          limit: 3,  windowMs: 60 * 60 * 1000 },
  validatePassIp:      { key: 'auth:validate-pass:ip',     limit: 20, windowMs: 60 * 1000 },
  inviteVerifyToken:   { key: 'auth:invite:verify:token',  limit: 3,  windowMs: 15 * 60 * 1000 },
} as const;

export type AuthRouteKey = keyof typeof AUTH_RATE_LIMITS

export async function enforceAuthRateLimit(keySuffix: string, routeKey: AuthRouteKey): Promise<LegacyRateLimitResult> {
  const cfg = AUTH_RATE_LIMITS[routeKey]
  const fullKey = cfg.key + (keySuffix ? ':' + keySuffix : '')
  return rateLimit(fullKey, { interval: cfg.windowMs, limit: cfg.limit })
}
