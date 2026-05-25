import { NextRequest, NextResponse } from 'next/server'
import {
  authenticateMachineClient,
  issueMachineToken,
  normalizeScopes,
  safeCompareSecrets
} from '@/lib/m2m-oauth'

function parseBasicAuthorization(authHeader: string | null) {
  if (!authHeader?.startsWith('Basic ')) {
    return null
  }

  try {
    const encoded = authHeader.slice('Basic '.length).trim()
    const decoded = Buffer.from(encoded, 'base64').toString('utf8')
    const separatorIndex = decoded.indexOf(':')

    if (separatorIndex < 0) {
      return null
    }

    return {
      clientId: decoded.slice(0, separatorIndex),
      clientSecret: decoded.slice(separatorIndex + 1)
    }
  } catch {
    return null
  }
}

function getRequestIp(request: NextRequest) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || null
}

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || ''
    const rawBody = await request.text()
    const params = contentType.includes('application/x-www-form-urlencoded')
      ? new URLSearchParams(rawBody)
      : new URLSearchParams()

    const basicAuth = parseBasicAuthorization(request.headers.get('authorization'))
    const clientId = basicAuth?.clientId || params.get('client_id') || ''
    const clientSecret = basicAuth?.clientSecret || params.get('client_secret') || ''
    const grantType = params.get('grant_type') || ''
    const requestedScopes = normalizeScopes(params.get('scope') || '')

    // Dummy safe comparison to keep timing behavior consistent for malformed requests.
    safeCompareSecrets(clientSecret || 'missing_secret', clientSecret || 'missing_secret')

    if (grantType !== 'client_credentials') {
      return NextResponse.json(
        {
          error: 'unsupported_grant_type',
          error_description: 'Solo se admite client_credentials'
        },
        { status: 400 }
      )
    }

    if (!clientId || !clientSecret) {
      return NextResponse.json(
        {
          error: 'invalid_client',
          error_description: 'Credenciales de cliente inválidas'
        },
        { status: 401 }
      )
    }

    const authResult = await authenticateMachineClient({
      clientId,
      clientSecret,
      requestedScopes,
      sourceIp: getRequestIp(request)
    })

    if (!authResult.ok) {
      const status = authResult.error === 'invalid_scope'
        ? 403
        : authResult.status

      return NextResponse.json(
        {
          error: authResult.error,
          error_description: authResult.error === 'invalid_scope'
            ? 'El cliente solicitó scopes no autorizados'
            : authResult.error === 'access_denied'
              ? 'La IP origen no está autorizada para este cliente'
              : 'Credenciales de cliente inválidas'
        },
        { status }
      )
    }

    const token = await issueMachineToken(authResult.client, authResult.scopes)

    return NextResponse.json({
      access_token: token.accessToken,
      token_type: token.tokenType,
      expires_in: token.expiresIn,
      scope: token.scope
    })
  } catch (error) {
    console.error('Error en OAuth client_credentials:', error)

    return NextResponse.json(
      {
        error: 'server_error',
        error_description: 'No fue posible emitir el token'
      },
      { status: 500 }
    )
  }
}
