import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

function isSensitiveAuditKey(key: string) {
  const normalizedKey = key.toLowerCase().replace(/[\s_-]/g, '')

  return [
    'password',
    'passwordhash',
    'secret',
    'clientsecret',
    'token',
    'invitationtoken',
    'invitationtokenhash',
    'authorization',
    'authorizationheader',
    'accesstoken',
    'refreshtoken'
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

export async function createAuditEntry(params: {
  tableName: string
  recordId: string
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'APPROVE' | 'REJECT' | 'SUSPEND' | 'CANCEL' | 'LOGIN' | 'LOGOUT' | 'EXPORT' | 'IMPORT' | 'SAT_ERROR'
  userId: string
  userEmail: string
  description: string
  ipAddress?: string | null
  userAgent?: string | null
  newValues?: unknown
  oldValues?: unknown
  companyId?: string | null
}) {
  const sanitizedNewValues = typeof params.newValues === 'undefined'
    ? undefined
    : redactSensitiveValues(params.newValues) as Prisma.InputJsonValue
  const sanitizedOldValues = typeof params.oldValues === 'undefined'
    ? undefined
    : redactSensitiveValues(params.oldValues) as Prisma.InputJsonValue

  await prisma.auditLog.create({
    data: {
      tableName: params.tableName,
      recordId: params.recordId,
      action: params.action,
      userId: params.userId,
      userEmail: params.userEmail,
      description: params.description,
      ipAddress: params.ipAddress || undefined,
      userAgent: params.userAgent || undefined,
      companyId: params.companyId || undefined,
      newValues: sanitizedNewValues,
      oldValues: sanitizedOldValues
    }
  })
}
