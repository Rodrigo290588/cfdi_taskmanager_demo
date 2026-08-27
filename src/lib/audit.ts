import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

function isSensitiveAuditKey(key: string) {
  const normalizedKey = key.toLowerCase().replace(/[\s_-]/g, '')

  return [
    'password',
    'passwd',
    'passphrase',
    'passwordhash',
    'secret',
    'secretkey',
    'clientsecret',
    'credential',
    'credentials',
    'token',
    'invitationtoken',
    'invitationtokenhash',
    'authorization',
    'authorizationheader',
    'accesstoken',
    'refreshtoken',
    'apikey',
    'privatekey',
    'sessiontoken',
    'cookie',
    'xmlcontent',
    'xmlciphertext',
    'xmlblob',
    'xmlraw',
    'rawxml',
    'xmlstring'
  ].some(sensitiveKey => normalizedKey.includes(sensitiveKey))
}

function redactSensitiveValues(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(item => redactSensitiveValues(item))
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, currentValue]) => {
      return [key, isSensitiveAuditKey(key) ? '[REDACTED]' : redactSensitiveValues(currentValue)]
    })

    return Object.fromEntries(entries)
  }

  return value
}

type StandardAuditAction =
  | 'CREATE' | 'UPDATE' | 'DELETE' | 'APPROVE' | 'REJECT'
  | 'SUSPEND' | 'CANCEL' | 'LOGIN' | 'LOGOUT' | 'EXPORT' | 'IMPORT' | 'SAT_ERROR'

export async function createAuditEntry(params: {
  tableName: string
  recordId: string
  /** Unión abierta: permite acciones personalizadas tipo DASHBOARD_RECIBIDOS.* sin romper build */
  action: StandardAuditAction | (string & {})
  userId: string
  userEmail: string | null | undefined
  description: string
  ipAddress?: string | null
  userAgent?: string | null
  newValues?: unknown
  oldValues?: unknown
  companyId?: string | null
  /** Campos adicionales opcionales que algunos callers adjuntan (metadata, targetType, etc.)
   *  Se ignoran intencionalmente: solo persistimos el shape de AuditLog Prisma. */
  [extra: string]: unknown
}) {
  const sanitizedNewValues = typeof params.newValues === 'undefined'
    ? undefined
    : redactSensitiveValues(params.newValues) as Prisma.InputJsonValue
  const sanitizedOldValues = typeof params.oldValues === 'undefined'
    ? undefined
    : redactSensitiveValues(params.oldValues) as Prisma.InputJsonValue
  const finalUserEmail = typeof params.userEmail === 'string' && params.userEmail.length > 0
    ? params.userEmail
    : 'unknown@tenant.local'

  // Si la acción personalizada no es enum estándar, mapeamos a la más cercana para
  // no violar el check de Prisma (AuditAction enum en DB).
  const actionStr = String(params.action || 'UPDATE')
  let dbAction: StandardAuditAction
  if (/^CREATE|INSERT|ADD$/i.test(actionStr)) dbAction = 'CREATE'
  else if (/^UPDATE|EDIT|PATCH|PUT$/i.test(actionStr)) dbAction = 'UPDATE'
  else if (/^DELETE|REMOVE|DESTROY$/i.test(actionStr)) dbAction = 'DELETE'
  else if (/^EXPORT|DOWNLOAD|REPORT$/i.test(actionStr)) dbAction = 'EXPORT'
  else if (/^IMPORT|UPLOAD|BATCH|INGEST$/i.test(actionStr)) dbAction = 'IMPORT'
  else if (/^LOGIN|SIGNIN$/i.test(actionStr)) dbAction = 'LOGIN'
  else if (/^LOGOUT|SIGNOUT$/i.test(actionStr)) dbAction = 'LOGOUT'
  else if (/^VIEW|READ|FETCH|LIST|KPI|SUMMARY|MAIN$/i.test(actionStr)) dbAction = 'EXPORT'
  else if (/^SAT\s*ERROR|ERROR/i.test(actionStr)) dbAction = 'SAT_ERROR'
  else dbAction = 'UPDATE'

  await prisma.auditLog.create({
    data: {
      tableName: params.tableName,
      recordId: params.recordId,
      action: dbAction,
      userId: params.userId,
      userEmail: finalUserEmail,
      description: params.description,
      ipAddress: params.ipAddress || undefined,
      userAgent: params.userAgent || undefined,
      companyId: params.companyId || undefined,
      newValues: sanitizedNewValues,
      oldValues: sanitizedOldValues
    }
  })
}
