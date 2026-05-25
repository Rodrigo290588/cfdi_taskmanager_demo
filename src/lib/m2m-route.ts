import { NextRequest, NextResponse } from 'next/server'
import { hasRequiredScope, normalizeScopes, verifyMachineToken } from '@/lib/m2m-oauth'

export interface MachineRequestContext {
  clientId: string
  organizationId: string
  scopes: string[]
}

type MachineHandler = (
  request: NextRequest,
  context: MachineRequestContext
) => Promise<NextResponse>

export function withMachineScope(requiredScope: string, handler: MachineHandler) {
  return async function machineScopedHandler(request: NextRequest) {
    try {
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
      })
    } catch (error) {
      console.error('Error validando token M2M:', error)

      return NextResponse.json(
        { error: 'Token inválido o expirado' },
        { status: 401 }
      )
    }
  }
}
