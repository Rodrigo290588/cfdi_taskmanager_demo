import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { hasPermission, Permission } from '@/lib/permissions'
import { prisma } from '@/lib/prisma'
import { writeFile, mkdir, unlink, realpath } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { v4 as uuidv4 } from 'uuid'
import crypto from 'node:crypto'
import { rateLimitByUserId, RateLimitError, enforceCompaniesRateLimit } from '@/lib/rate-limit'
import { validateImageMagicBytes } from '@/lib/security'
import { SAT_SECURITY_HEADERS, safeErrSummarySat } from '@/lib/sat-gate-helpers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const bodySizeLimit = 6 * 1024 * 1024

const LOGO_OUTPUT_EXT = '.webp'
const LOGO_MAX_PX = 512
const LOGO_QUALITY = 82
const LOGO_MAX_FILE_BYTES = 5 * 1024 * 1024
const ALLOWED_INPUT_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])
const ALLOWED_INPUT_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

let _cachedUploadsDir: string | null = null
function getRawUploadsDir(): string {
  if (_cachedUploadsDir !== null) return _cachedUploadsDir
  const base = /*turbopackIgnore: true*/ process.cwd()
  _cachedUploadsDir = /*turbopackIgnore: true*/ path.join(base, 'public', 'uploads', 'company-logos')
  return _cachedUploadsDir
}

async function ensureUploadsDir(): Promise<string> {
  const raw = getRawUploadsDir()
  await mkdir(raw, { recursive: true })
  const resolved = await realpath(raw)
  return resolved
}

async function cleanupOldLogos(companyId: string, safeDir: string): Promise<void> {
  try {
    const uploadDir = getRawUploadsDir()
    const { readdir, stat } = await import('node:fs/promises')
    const files = await readdir(uploadDir)
    const candidates = files.filter(f => f.startsWith(`${companyId}-`))
    if (candidates.length > 0) {
      const withTimes = await Promise.all(
        candidates.map(async f => ({ f, t: (await stat(path.join(uploadDir, f))).mtime.getTime() }))
      )
      withTimes.sort((a, b) => b.t - a.t)
      for (const old of withTimes.slice(0, 2)) {
        try {
          const oldPath = path.join(uploadDir, old.f)
          const resOldDir = await realpath(path.dirname(oldPath))
          if (resOldDir === safeDir && existsSync(oldPath)) {
            await unlink(oldPath)
          }
        } catch {
          void 0
        }
      }
    }
  } catch {
    void 0
  }
}

async function validateAndFetchCompanyAndUser(
  id: string,
  sessionUserId: string
) {
  const company = await prisma.company.findUnique({
    where: { id },
    include: {
      companyAccesses: {
        take: 1,
        where: {
          member: {
            userId: sessionUserId,
            status: 'APPROVED',
            organization: { onboardingCompleted: true }
          }
        },
        select: { organizationId: true, memberId: true }
      }
    }
  })

  if (!company) {
    return { error: 'Empresa no encontrada', status: 404 }
  }

  const user = await prisma.user.findUnique({
    where: { id: sessionUserId },
    select: { id: true, systemRole: true, email: true }
  })

  if (!user) {
    return { error: 'Usuario no encontrado', status: 404 }
  }

  const access = company.companyAccesses[0]
  if (!access) {
    const isSuperAdmin = user.systemRole === 'SUPER_ADMIN'
    if (!isSuperAdmin) {
      return { error: 'Permisos insuficientes (sin acceso a compañía)', status: 403 }
    }
  } else {
    const orgOk = hasPermission(
      { id: user.id, systemRole: user.systemRole, memberships: [{ organizationId: access.organizationId, role: 'ADMIN' }] },
      Permission.COMPANY_UPDATE,
      access.organizationId
    )
    if (!orgOk) {
      return { error: 'Permisos insuficientes (company:update)', status: 403 }
    }
  }

  return { company, user }
}

async function validateUploadedFile(request: NextRequest): Promise<{ error?: string; status?: number; file?: File }> {
  const form = await request.formData()
  const file = form.get('logo') as File | null
  if (!file) {
    return { error: 'Archivo requerido', status: 400 }
  }
  if (!ALLOWED_INPUT_MIME.has(file.type)) {
    return { error: 'Tipo de archivo no permitido', status: 400 }
  }
  if (file.size > LOGO_MAX_FILE_BYTES) {
    return { error: 'Archivo demasiado grande (máx 5MB)', status: 413 }
  }
  const ext = path.extname(file.name || '').toLowerCase()
  if (!ALLOWED_INPUT_EXTS.has(ext)) {
    return { error: 'Extensión de archivo no permitida', status: 400 }
  }
  return { file }
}

async function processAndSaveImage(
  file: File,
  companyId: string,
  safeDir: string
): Promise<{ error?: string; status?: number; logoUrl?: string }> {
  const ext = path.extname(file.name || '').toLowerCase()
  const rawBuffer = Buffer.from(await file.arrayBuffer())
  if (rawBuffer.byteLength > LOGO_MAX_FILE_BYTES) {
    return { error: 'Archivo demasiado grande (máx 5MB)', status: 413 }
  }

  if (!validateImageMagicBytes(rawBuffer, ext)) {
    return { error: 'Contenido de archivo no corresponde a una imagen válida', status: 400 }
  }

  const safeBaseName = `${companyId}-${uuidv4()}${LOGO_OUTPUT_EXT}`
  const targetPath = path.join(safeDir, safeBaseName)
  
  const resolvedDir = await realpath(path.dirname(targetPath))
  if (resolvedDir !== safeDir) {
    return { error: 'Ruta de destino no permitida', status: 400 }
  }

  const sharpModule = await import('sharp')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sharp = (sharpModule.default ?? sharpModule) as any
  const reencoded = await sharp(rawBuffer)
    .rotate()
    .resize(LOGO_MAX_PX, LOGO_MAX_PX, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: LOGO_QUALITY, effort: 4 })
    .toBuffer()

  await cleanupOldLogos(companyId, safeDir)

  await writeFile(targetPath, reencoded, { flag: 'w', mode: 0o600 })
  const realFinal = await realpath(targetPath)
  if (path.dirname(realFinal) !== safeDir) {
    try { await unlink(targetPath) } catch { void 0 }
    return { error: 'Ruta de archivo final inválida', status: 400 }
  }

  const logoUrl = `/uploads/company-logos/${encodeURIComponent(safeBaseName)}`
  return { logoUrl }
}

function checkRateLimit(userId: string, reqId: string): NextResponse | null {
  try {
    enforceCompaniesRateLimit(userId, 'update')
    rateLimitByUserId({
      userId,
      key: 'company-logo-upload',
      limit: 5,
      windowMs: 60 * 60 * 1000
    })
    return null
  } catch (rlErr) {
    if (rlErr instanceof RateLimitError) {
      return NextResponse.json(
        { error: rlErr.message, reqId },
        {
          status: rlErr.statusCode,
          headers: {
            'Retry-After': String(Math.ceil(rlErr.retryAfterMs / 1000)),
            'X-Request-Id': reqId,
            ...SAT_SECURITY_HEADERS
          }
        }
      )
    }
    throw rlErr
  }
}

async function logAuditSafe(
  companyId: string,
  logoUrl: string,
  user: { id: string; email: string | null },
  reqId: string
) {
  try {
    await prisma.auditLog.create({
      data: {
        tableName: 'companies',
        recordId: companyId,
        action: 'UPDATE',
        newValues: { logoUrl },
        userId: user.id,
        userEmail: user.email || '',
        description: 'Actualización de logo de compañía'
      }
    })
  } catch (auditErr) {
    console.warn('[company-logo audit fail]', {
      reqId,
      err: auditErr instanceof Error ? auditErr.message : String(auditErr)
    })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const reqId = crypto.randomUUID()
  try {
    const contentLengthRaw = request.headers.get('content-length')
    const contentLength = contentLengthRaw ? Number(contentLengthRaw) : null
    if (contentLength !== null && (Number.isNaN(contentLength) || contentLength > LOGO_MAX_FILE_BYTES)) {
      return NextResponse.json(
        { error: 'Archivo demasiado grande (máx 5MB)', reqId },
        { status: 413, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
      )
    }

    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'No autorizado', reqId },
        { status: 401, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
      )
    }

    const rlResponse = checkRateLimit(session.user.id, reqId)
    if (rlResponse) return rlResponse

    const { id } = await params
    if (!id) {
      return NextResponse.json(
        { error: 'ID de empresa requerido', reqId },
        { status: 400, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
      )
    }

    const validateResult = await validateAndFetchCompanyAndUser(id, session.user.id)
    if (validateResult.error || !validateResult.company || !validateResult.user) {
      return NextResponse.json(
        { error: validateResult.error, reqId },
        { status: validateResult.status, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
      )
    }
    const { company, user } = validateResult

    const fileResult = await validateUploadedFile(request)
    if (fileResult.error || !fileResult.file) {
      return NextResponse.json(
        { error: fileResult.error, reqId },
        { status: fileResult.status, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
      )
    }
    const file = fileResult.file
    const safeDir = await ensureUploadsDir()

    const processResult = await processAndSaveImage(file, company.id, safeDir)
    if (processResult.error || !processResult.logoUrl) {
      return NextResponse.json(
        { error: processResult.error, reqId },
        { status: processResult.status || 500, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
      )
    }

    const logoUrl = processResult.logoUrl
    await prisma.company.update({
      where: { id: company.id },
      data: { updatedBy: user.id }
    })

    await logAuditSafe(company.id, logoUrl, user, reqId)

    return NextResponse.json(
      { success: true, logoUrl, reqId },
      { headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS, 'Cache-Control': 'no-store, private' } }
    )
  } catch (error) {
    const safe = safeErrSummarySat(error)
    console.error('[company-logo 500]', { reqId, fp: safe.incidentFingerprint, name: safe.name })
    return NextResponse.json(
      { error: safe.message, reqId, incidentFingerprint: safe.incidentFingerprint },
      { status: 500, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
    )
  }
}
