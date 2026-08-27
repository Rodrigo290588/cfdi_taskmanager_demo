import { NextRequest, NextResponse } from 'next/server'
import {
  authenticateMachineClient,
  issueMachineToken,
  normalizeScopes,
} from '@/lib/m2m-oauth'
import { getRealClientIp, safeErrSummary, fingerprint } from '@/lib/security'
import { fp32 } from '@/lib/monitor-security-helpers'
import {
  parseBasicAuthSafe,
  normalizeScopesStrict,
} from '@/lib/m2m-security-helpers'
import { rateLimit } from '@/lib/rate-limit'
import { getM2MRateLimitHeaders } from '@/lib/m2m-rate-limit'
import type { AuthFail } from '@/lib/m2m-oauth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const sourceIp = getRealClientIp(request.headers)
  const ref500 = fp32(fingerprint('m2m_oauth_500:' + String(Date.now())))

  try {
    // OAUTH-012: Rate limit DUAL por IP GLOBAL 30req/60s antes de clientId
    const globalIpKey = `m2m:global:ip:${sourceIp || 'no-ip'}`
    const limiterGlobal = await rateLimit(globalIpKey, { interval: 60_000, limit: 30 })
    if (!limiterGlobal.success) {
      return NextResponse.json(
        { error: 'rate_limited_global_ip', error_description: 'Too many requests per IP' },
        { status: 429, headers: getM2MRateLimitHeaders(limiterGlobal as unknown as NonNullable<AuthFail['limiter']>) }
      )
    }

    const contentType = request.headers.get('content-type') || ''
    const rawBody = await request.text()
    const formBody = contentType.includes('application/x-www-form-urlencoded')
      ? new URLSearchParams(rawBody)
      : new URLSearchParams()

    // OAUTH-008: BasicAuth parse seguro (no alloc 20MB + alphabet + padding + max)
    const basicAuth = parseBasicAuthSafe(request.headers.get('authorization'))
    const clientId = (basicAuth?.clientId || formBody.get('client_id') || '').trim()
    const clientSecret = basicAuth?.clientSecret || formBody.get('client_secret') || ''
    const grantType = formBody.get('grant_type')?.trim() || ''

    // OAUTH-010: Scope string MAX 2048 chars + MAX tokens 128 + regex scope token
    const rawScope = formBody.get('scope')?.toString() ?? ''
    const strictScope = normalizeScopesStrict(rawScope)
    if (!strictScope.ok) {
      const descriptions: Record<string, string> = {
        scope_string_too_long: 'scope param max 2048 chars',
        too_many_tokens: 'scope max 128 space-separated tokens',
        invalid_token_format: 'scope inválido: letras minúsculas/números/:_.- 1-64 chars (invalid=' + (strictScope.errorValue ?? '') + ')',
      }
      return NextResponse.json(
        { error: 'invalid_scope', error_description: descriptions[strictScope.error] ?? 'Invalid scope format' },
        { status: 400 }
      )
    }
    const requestedScopes = strictScope.scopes.length > 0
      ? strictScope.scopes
      : normalizeScopes(rawScope || '') // backward compat empty array

    if (grantType !== 'client_credentials') {
      return NextResponse.json(
        { error: 'unsupported_grant_type', error_description: 'Solo se admite client_credentials grant_type=client_credentials' },
        { status: 400 }
      )
    }

    if (!clientId || !clientSecret) {
      return NextResponse.json(
        { error: 'invalid_client', error_description: 'client_id y client_secret requeridos (Authorization: Basic o form body)' },
        { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="M2M OAuth Client Credentials"' } }
      )
    }

    const authResult = await authenticateMachineClient({
      clientId,
      clientSecret,
      requestedScopes,
      sourceIp,
    })

    if (!authResult.ok) {
      const status = authResult.error === 'invalid_scope' ? 403
        : authResult.error === 'rate_limited' ? 429
        : authResult.error === 'access_denied' ? 403
        : authResult.status ?? 401

      const descriptions: Record<string, string> = {
        invalid_scope: (authResult as unknown as AuthFail).error_description || 'El cliente solicitó scopes no autorizados',
        access_denied: 'La IP origen no está autorizada para este cliente o cliente desactivado/caducado',
        rate_limited: 'Rate limit excedido por clientId',
        invalid_client: 'Credenciales de cliente inválidas',
      }
      const headersObj: Record<string, string> = {}
      const failRes = authResult as unknown as AuthFail
      if (failRes.limiter) {
        Object.assign(headersObj, getM2MRateLimitHeaders(failRes.limiter))
      }
      if (status === 401) headersObj['WWW-Authenticate'] = 'Basic realm="M2M OAuth Client Credentials"'
      return NextResponse.json(
        { error: authResult.error, error_description: descriptions[authResult.error] ?? 'Client auth failed' },
        { status, headers: headersObj }
      )
    }

    const token = await issueMachineToken(authResult.client, authResult.scopes)
    const respHeaders = {
      'Cache-Control': 'no-store',
      'Pragma': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    }
    return NextResponse.json({
      access_token: token.accessToken,
      token_type: token.tokenType,
      expires_in: token.expiresIn,
      scope: token.scope,
    }, { headers: respHeaders })

  } catch (error) {
    // OAUTH-005: catch-all safeErrSummary NO leak PII
    const safe = safeErrSummary(error instanceof Error ? error : new Error(String(error)))
    console.error('[M2M OAUTH /token 500 ref=' + ref500 + '] msgHash=' + safe.msgHash, 'msg=' + safe.msg)
    return NextResponse.json(
      {
        error: 'server_error',
        error_description: 'No fue posible emitir el token. Ref=' + ref500,
      },
      { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    )
  }
}
