import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { encrypt } from '@/lib/encryption'
import { validateFiel } from '@/lib/fiel-validation'
import { hasPermission } from '@/lib/permissions'
import { Permission } from '@/lib/permissions'
import { rateLimitByUserId, rateLimit, RateLimitError } from '@/lib/rate-limit'
import {
  getRealClientIp,
  massDownloadJsonResponse,
} from '@/lib/mass-downloads-route-utils'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * [SAST-FIX API-08] Subida de credenciales FIEL:
 *  - Permiso granular CFDI_FIEL_CREDENTIALS
 *  - Validación MIME + extension + tamaño máximo (.key ≤ 8KB, .cer ≤ 10KB)
 *  - Rate limit por usuario: 5 intentos/hora
 *  - Rate limit por IP anti-brute: 20 intentos/hora (previene credential stuffing multi-cuenta)
 *  - Validación magic bytes DER/X.509 para .key y .cer
 *  - No leak de detalles internos en errores 500
 *  - Registro de auditoría UPDATE/CREATE (AuditAction.UPDATE o CREATE)
 *  - Scoping del RFC a FiscalEntity o Company del tenant
 */
const MAX_KEY_SIZE_BYTES = 8 * 1024
const MAX_CER_SIZE_BYTES = 10 * 1024
const RFC_REGEX = /^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$/i
const IP_RL_WINDOW_MS = 60 * 60 * 1000
const IP_RL_LIMIT = 20

function isValidDerMagicBytes(buf: Buffer): boolean {
  if (buf.length < 4) return false
  if (buf[0] !== 0x30) return false
  return buf[1] === 0x82 || buf[1] === 0x81 || buf[1] < 0x80
}

export async function POST(req: NextRequest) {
  const reqId = crypto.randomUUID()

  try {
    const session = await auth()
    if (!session?.user?.id) {
      return massDownloadJsonResponse({ error: 'No autorizado', reqId }, { status: 401 })
    }

    const clientIp = getRealClientIp(req.headers) || 'unknown'
    try {
      const ipRl = await rateLimit(`md:ip:fiel-upload:${clientIp}`, {
        limit: IP_RL_LIMIT,
        interval: IP_RL_WINDOW_MS,
        silent: true,
      })
      if (!ipRl.success) {
        return massDownloadJsonResponse(
          { error: 'Límite de solicitudes excedido', reqId },
          { status: 429, retryAfter: 3600 }
        )
      }
    } catch {
      // Rate limit storage transient error: fail-closed para credential stuffing
      return massDownloadJsonResponse(
        { error: 'Servicio temporalmente no disponible', reqId },
        { status: 503 }
      )
    }

    try {
      await rateLimitByUserId({
        userId: session.user.id,
        key: 'fiel-upload-attempt',
        limit: 5,
        windowMs: 60 * 60 * 1000
      })
    } catch (rlErr) {
      if (rlErr instanceof RateLimitError) {
        return massDownloadJsonResponse(
          { error: rlErr.message, reqId },
          { status: rlErr.statusCode, retryAfter: 3600, headers: { 'X-Request-Id': reqId } }
        )
      }
      throw rlErr
    }

    // [HARDENING P0 Fix #3 real]: AuthZ + user/member + permiso COMPLETOS ANTES de leer formData().
    // Si el usuario no tiene CFDI_FIEL_CREDENTIALS en su org principal (primera APPROVED), se devuelve 403
    // incluso sin parsear cuerpo: evita 400 "faltan campos" que enumeraba permisos.
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        systemRole: true,
        email: true,
        memberships: { where: { status: 'APPROVED' }, select: { id: true, organizationId: true, role: true } }
      }
    })
    if (!user || user.memberships.length === 0) {
      return massDownloadJsonResponse({ error: 'Sin membresía activa', reqId }, { status: 403 })
    }
    // Tomamos la primera membresía APPROVED como scope primario
    const defaultMember = user.memberships[0]
    const defaultOrgId = defaultMember.organizationId

    // Permiso CFDI_FIEL_CREDENTIALS ANTES de cualquier formData() o lectura de campos
    const canSaveFiel = hasPermission(user, Permission.CFDI_FIEL_CREDENTIALS, defaultOrgId)
    if (!canSaveFiel) {
      return massDownloadJsonResponse(
        { error: 'Permiso insuficiente: FIEL', reqId },
        { status: 403, headers: { 'X-Request-Id': reqId } }
      )
    }

    // AuthZ global OK. Ahora obtenemos member de referencia para companyAccess y recién LEEMOS formData.
    const member = await prisma.member.findUnique({
      where: { userId_organizationId: { userId: session.user.id, organizationId: defaultOrgId } },
      select: { id: true, status: true }
    })
    if (!member || member.status !== 'APPROVED') {
      return NextResponse.json(
        { error: 'Sin membresía activa', reqId },
        { status: 403, headers: { 'X-Request-Id': reqId } }
      )
    }

    // [HARDENING P0] FormData() se lee SÓLO DESPUÉS de permiso OK.
    const form = await req.formData()
    const rawOrganizationId = (form.get('organizationId') as string | null)?.trim() || ''
    const rawRfc = (form.get('rfc') as string | null)?.trim() || ''
    const password = form.get('password') as string | null
    const privateKeyFile = form.get('privateKey') as File | null
    const certificateFile = form.get('certificate') as File | null

    if (!rawOrganizationId || !rawRfc || !password || !privateKeyFile || !certificateFile) {
      return massDownloadJsonResponse(
        { error: 'Faltan campos requeridos', reqId },
        { status: 400, headers: { 'X-Request-Id': reqId } }
      )
    }
    if (!RFC_REGEX.test(rawRfc)) {
      return massDownloadJsonResponse(
        { error: 'RFC inválido', reqId },
        { status: 400, headers: { 'X-Request-Id': reqId } }
      )
    }

    // Validar que el organizationId del payload sea de una membership APPROVED del usuario
    const allowedOrgIds = new Set(user.memberships.map(m => m.organizationId))
    if (!allowedOrgIds.has(rawOrganizationId)) {
      return massDownloadJsonResponse(
        { error: 'Permiso insuficiente: FIEL', reqId },
        { status: 403, headers: { 'X-Request-Id': reqId } }
      )
    }

    const finalOrgId = rawOrganizationId
    const finalMemberForScope = rawOrganizationId === defaultOrgId
      ? member
      : await prisma.member.findUnique({
          where: { userId_organizationId: { userId: session.user.id, organizationId: rawOrganizationId } },
          select: { id: true, status: true }
        })
    if (!finalMemberForScope || finalMemberForScope.status !== 'APPROVED') {
      return massDownloadJsonResponse(
        { error: 'Permiso insuficiente: FIEL', reqId },
        { status: 403, headers: { 'X-Request-Id': reqId } }
      )
    }

    // Scope RFC al tenant (FiscalEntity o CompanyAccess)
    const fe = await prisma.fiscalEntity.findFirst({
      where: { organizationId: finalOrgId, rfc: rawRfc, isActive: true },
      select: { id: true }
    })
    const ca = fe
      ? null
      : await prisma.companyAccess.findFirst({
          where: { memberId: finalMemberForScope.id, company: { rfc: rawRfc } },
          select: { companyId: true }
        })
    if (!fe && !ca) {
      return massDownloadJsonResponse(
        { error: 'RFC no asociado a tu organización', reqId },
        { status: 403, headers: { 'X-Request-Id': reqId } }
      )
    }

    const rfc = rawRfc
    const organizationId = finalOrgId

    // [SAST-FIX API-08] Tamaño máximo por archivo
    if (privateKeyFile.size > MAX_KEY_SIZE_BYTES) {
      return massDownloadJsonResponse({ error: 'Archivo .key excede tamaño máximo (8KB)', reqId }, { status: 413 })
    }
    if (certificateFile.size > MAX_CER_SIZE_BYTES) {
      return massDownloadJsonResponse({ error: 'Archivo .cer excede tamaño máximo (10KB)', reqId }, { status: 413 })
    }

    // [SAST-FIX API-08] Validación extensión + magic bytes básicos
    const keyName = privateKeyFile.name.toLowerCase()
    const cerName = certificateFile.name.toLowerCase()
    if (!keyName.endsWith('.key')) {
      return massDownloadJsonResponse({ error: 'El archivo de llave privada debe tener extensión .key', reqId }, { status: 400 })
    }
    if (!cerName.endsWith('.cer')) {
      return massDownloadJsonResponse({ error: 'El certificado debe tener extensión .cer', reqId }, { status: 400 })
    }

    // Read files (ya validados sus tamaños)
    const privateKeyBuffer = Buffer.from(await privateKeyFile.arrayBuffer())
    const certificateBuffer = Buffer.from(await certificateFile.arrayBuffer())

    if (!isValidDerMagicBytes(privateKeyBuffer)) {
      return massDownloadJsonResponse(
        { error: 'El archivo .key no tiene formato válido (DER PKCS8)', reqId },
        { status: 400 }
      )
    }
    if (!isValidDerMagicBytes(certificateBuffer)) {
      return massDownloadJsonResponse(
        { error: 'El archivo .cer no tiene formato válido (X.509 DER)', reqId },
        { status: 400 }
      )
    }

    const validation = validateFiel(privateKeyBuffer, certificateBuffer, password)
    if (!validation.isValid) {
      console.warn('[fiel-upload invalid]', { reqId, userId: session.user.id, reason: validation.error })
      return massDownloadJsonResponse(
        { error: validation.error || 'La FIEL no es válida', reqId },
        { status: 400 }
      )
    }

    if (validation.rfc && validation.rfc !== rfc) {
      return massDownloadJsonResponse(
        { error: 'El RFC del certificado no coincide con el seleccionado', reqId },
        { status: 400 }
      )
    }

    const privateKeyBase64 = privateKeyBuffer.toString('base64')
    const encryptedPrivateKey = encrypt(privateKeyBase64)
    const encryptedPassword = encrypt(password)
    const certificateBase64 = certificateBuffer.toString('base64')

    const prev = await prisma.satCredential.findUnique({
      where: { organizationId_rfc: { organizationId, rfc } },
      select: { id: true, certificate: true }
    })

    // Upsert de credenciales cifradas
    await prisma.satCredential.upsert({
      where: { organizationId_rfc: { organizationId, rfc } },
      update: { encryptedPrivateKey, encryptedPassword, certificate: certificateBase64 },
      create: { organizationId, rfc, encryptedPrivateKey, encryptedPassword, certificate: certificateBase64 }
    })

    // [SAST-FIX API-08] Auditoría. Si existía -> UPDATE; si no -> CREATE
    const auditAction = prev ? ('UPDATE' as const) : ('CREATE' as const)
    const auditIp = getRealClientIp(req.headers)
    try {
      await prisma.auditLog.create({
        data: {
          tableName: 'sat_credentials',
          recordId: prev?.id || `rfc=${rfc}`,
          action: auditAction,
          newValues: { rfc, organizationId, sizeKey: privateKeyBuffer.length, sizeCer: certificateBuffer.length, validation: 'fiel-valid' },
          userId: session.user.id,
          userEmail: session.user.email || '',
          ipAddress: auditIp || undefined,
          userAgent: req.headers.get('user-agent') || undefined,
          description: `FIEL ${auditAction.toLowerCase()}d por usuario (RFC ${rfc})`
        }
      })
    } catch (auditErr) {
      console.warn('[audit-log-fiel fail]', { reqId, err: auditErr instanceof Error ? auditErr.message : String(auditErr) })
    }

    return massDownloadJsonResponse({ success: true, reqId }, { headers: { 'X-Request-Id': reqId } })
  } catch (error) {
    console.error('[fiel-upload 500]', {
      reqId,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    })
    return massDownloadJsonResponse({ error: 'Error interno', reqId }, { status: 500, headers: { 'X-Request-Id': reqId } })
  }
}
