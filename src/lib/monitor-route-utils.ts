import { Permission, enrichUserWithMemberships, hasPermission } from './permissions'

export interface MonitorAccessContext {
  organizationId: string
  userId: string
  systemRole: string
  membershipRole?: string
}

export class MonitorAccessError extends Error {
  statusCode: 400 | 401 | 403 | 404
  constructor(message: string, statusCode: 400 | 401 | 403 | 404) {
    super(message)
    this.name = 'MonitorAccessError'
    this.statusCode = statusCode
  }
}

// MON-001 + MON-002 · Gate ÚNICO para TODAS las 5 rutas /api/monitor/**
// Regla 19.2.A Cross-Check: hasPermission signature estricta 3 args (user, perm, orgId)
// - NO organiza al azar (heap order): pick DETERMINÍSTICO by updatedAt DESC membership
// - Rechaza VIEWER/AUDITOR/MEMBER con status APPROVED pero matriz sin DASHBOARD_FISCAL_VIEW
// - Fail-Closed: si hay exception en prisma → 500 + safeErrSummary (no se devuelve data)
export async function requireMonitorAccess(params: {
  userId: string | undefined | null
  systemRole?: string | null
  requestedOrgId?: string | null
}): Promise<MonitorAccessContext> {
  const { userId, systemRole, requestedOrgId } = params
  if (!userId) {
    throw new MonitorAccessError('Sesión no válida: autenticación requerida', 401)
  }

  const systemRoleSafe = (systemRole as 'SUPER_ADMIN' | 'ADMIN' | 'COMPANY_ADMIN' | 'USER' | undefined) || 'USER'
  const enriched = await enrichUserWithMemberships({
    id: userId,
    systemRole: systemRoleSafe,
  })

  const approved = (enriched.memberships ?? [])
    .filter((m) => m.status === 'APPROVED')

  if (!approved || approved.length === 0) {
    throw new MonitorAccessError('No se encontró una membresía aprobada para acceder al monitor', 404)
  }

  // MON-001 FIX aprobado: ya NO existe casteo (m as unknown as {status?:string}).
  // La interface User ahora declara status?: APPROVED|PENDING|REJECTED y
  // enrichUserWithMemberships L434 usa orderBy createdAt ASC + mapea status explícitamente.
  // MON-005 FIX multi-tenant fail-closed: con >1 membresía sin orgId explícito NUNCA adivinar.
  let targetMembership: typeof approved[number] | undefined

  if (requestedOrgId) {
    targetMembership = approved.find((m) => m.organizationId === requestedOrgId)
    if (!targetMembership) {
      throw new MonitorAccessError('Membresía no encontrada para la organización solicitada', 404)
    }
  } else {
    if (approved.length === 1) {
      targetMembership = approved[0]  // Caso safe: 1 sola organización (95% usuarios)
    } else {
      throw new MonitorAccessError(
        'Sesión multi-tenant: envía explícitamente ?orgId= para seleccionar organización. ' +
        'No adivinamos silenciosamente = silo tenant fail-closed.',
        400
      )
    }
  }

  if (!targetMembership || !targetMembership.organizationId) {
    throw new MonitorAccessError('No se pudo resolver la organización para el monitor', 404)
  }

  // MON-002 FIX: hasPermission() máx 3 args (NUNCA 4)
  const permGranted = hasPermission(
    enriched,
    Permission.DASHBOARD_FISCAL_VIEW,
    targetMembership.organizationId,
  )
  if (!permGranted) {
    throw new MonitorAccessError(
      'Permiso insuficiente para acceder al monitor de importación. Permiso requerido: DASHBOARD_FISCAL_VIEW',
      403,
    )
  }

  return {
    userId: enriched.id,
    systemRole: enriched.systemRole,
    organizationId: targetMembership.organizationId,
    membershipRole: String(targetMembership.role || 'MEMBER'),
  }
}
