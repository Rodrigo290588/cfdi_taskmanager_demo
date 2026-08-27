import { NextRequest, NextResponse } from 'next/server'
import { hasRequiredScope, normalizeScopes, verifyMachineToken } from '@/lib/m2m-oauth'
import { safeErrSummary } from '@/lib/security'
import { MAX_EXTERNAL_PAYLOAD_BYTES } from '@/schemas/external'

export interface MachineRequestContext {
  clientId: string
  organizationId: string
  scopes: string[]
}

export interface MachineRouteContext {
  params?: Record<string, string | string[] | undefined> | Promise<Record<string, string | string[] | undefined>>
}

type MachineHandler = (
  request: NextRequest,
  context: MachineRequestContext,
  routeContext?: MachineRouteContext
) => Promise<NextResponse>

const MAX_M2M_PREPARSE_BYTES = Math.ceil(MAX_EXTERNAL_PAYLOAD_BYTES * 1.35)

// EXT-012 ALTO · validateM2MRequestHeaders early Content-Type(415) / Content-Length positivo(411) / size MAX(413)
export function validateM2MRequestHeaders(request: NextRequest, opts: { requireJsonBody?: boolean } = {}): NextResponse | null {
  const { requireJsonBody = false } = opts

  const method = request.method.toUpperCase()
  const hasBody = method === 'POST' || method === 'PUT' || method === 'PATCH'

  if (hasBody) {
    const contentType = request.headers.get('content-type')?.toLowerCase() || ''
    if (requireJsonBody && !contentType.includes('application/json')) {
      return NextResponse.json(
        { error: 'Content-Type inválido; se requiere application/json.' },
        { status: 415 }
      )
    }

    const contentLengthRaw = request.headers.get('content-length')
    if (contentLengthRaw === null || contentLengthRaw === undefined || contentLengthRaw.trim() === '') {
      return NextResponse.json(
        { error: 'Se requiere el encabezado Content-Length para solicitudes con cuerpo.' },
        { status: 411 }
      )
    }

    const contentLength = Number(contentLengthRaw)
    if (!Number.isFinite(contentLength) || contentLength <= 0) {
      return NextResponse.json(
        { error: 'Content-Length debe ser un entero positivo.' },
        { status: 411 }
      )
    }

    if (contentLength > MAX_M2M_PREPARSE_BYTES) {
      return NextResponse.json(
        { error: 'El payload excede el tamaño máximo permitido por el endpoint M2M.' },
        { status: 413 }
      )
    }
  }

  return null
}

// EXT-010 MEDIO · withNoCache headers wrapper Cache-Control:private,no-store + HSTS/Frame-Options
export function withNoCacheHeaders(handler: MachineHandler): MachineHandler {
  return async function noCacheWrappedHandler(request, context, routeContext) {
    const response = await handler(request, context, routeContext)
    try {
      response.headers.set('Cache-Control', 'private, no-store, no-cache, must-revalidate, max-age=0')
      response.headers.set('Pragma', 'no-cache')
      response.headers.set('Expires', '0')
      response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
      response.headers.set('X-Content-Type-Options', 'nosniff')
      response.headers.set('X-Frame-Options', 'DENY')
      response.headers.set('Referrer-Policy', 'no-referrer')
    } catch {}
    return response
  }
}

export function withMachineScope(requiredScope: string, handler: MachineHandler) {
  return async function machineScopedHandler(request: NextRequest, routeContext?: MachineRouteContext) {
    try {
      // EXT-012 · Early validation headers before token parsing (ataques con cuerpo grande sin auth)
      const headerErr = validateM2MRequestHeaders(request, { requireJsonBody: true })
      if (headerErr) return headerErr

      const authHeader = request.headers.get('authorization')

      if (!authHeader?.startsWith('Bearer ')) {
        return NextResponse.json(
          { error: 'Token de acceso requerido' },
          { status: 401 }
        )
      }

      const token = authHeader.slice('Bearer '.length).trim()

      if (!token) {
        return NextResponse.json(
          { error: 'Token de acceso requerido' },
          { status: 401 }
        )
      }

      const payload = await verifyMachineToken(token)

      if (payload.token_use !== 'm2m') {
        return NextResponse.json(
          { error: 'Token inválido para este recurso' },
          { status: 401 }
        )
      }

      if (!hasRequiredScope(payload.scope, requiredScope)) {
        return NextResponse.json(
          { error: 'El token no contiene el scope requerido' },
          { status: 403 }
        )
      }

      return handler(request, {
        clientId: payload.sub,
        organizationId: payload.org_id,
        scopes: normalizeScopes(payload.scope)
      }, routeContext)
    } catch (error) {
      // EXT-008 · safeErrSummary NO tokens/JWT raw en logs
      console.error('[M2M-AUTH] Token validation failed:', safeErrSummary(error))

      return NextResponse.json(
        { error: 'Token inválido o expirado' },
        { status: 401 }
      )
    }
  }
}
