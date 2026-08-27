import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { hasPermission, Permission } from '@/lib/permissions'
import { prisma } from '@/lib/prisma'
import { writeFile, mkdir, unlink, realpath } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import crypto from 'crypto'
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
const ALLOWED_INPUT_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp']
const ALLOWED_INPUT_MIME = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const reqId = crypto.randomUUID()
  try {
    // COMP-012 FIX BAJO: Double Gate Body Size anti chunked encoding bypass
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

    try {
      enforceCompaniesRateLimit(session.user.id, 'update')
      rateLimitByUserId({
        userId: session.user.id,
        key: 'company-logo-upload',
        limit: 5,
        windowMs: 60 * 60 * 1000
      })
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

    const { id } = await params
    if (!id) {
      return NextResponse.json(
        { error: 'ID de empresa requerido', reqId },
        { status: 400, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
      )
    }

    const company = await prisma.company.findUnique({
      where: { id },
      include: {
        companyAccesses: {
          take: 1,
          where: {
            member: {
              userId: session.user.id,
              status: 'APPROVED',
              // COMP-005 FIX ALTO: equivalente org.isActive = onboardingCompleted (schema Prisma no tiene isActive)
              organization: { onboardingCompleted: true }
            }
          },
          select: { organizationId: true, memberId: true }
        }
      }
    })
    if (!company) {
      return NextResponse.json(
        { error: 'Empresa no encontrada', reqId },
        { status: 404, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
      )
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, systemRole: true, email: true }
    })
    if (!user) {
      return NextResponse.json(
        { error: 'Usuario no encontrado', reqId },
        { status: 404, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
      )
    }

    const access = company.companyAccesses[0]
    if (!access) {
      const isSuperAdmin = user.systemRole === 'SUPER_ADMIN'
      if (!isSuperAdmin) {
        return NextResponse.json(
          { error: 'Permisos insuficientes (sin acceso a compañía)', reqId },
          { status: 403, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
        )
      }
    } else {
      const orgOk = hasPermission(
        { id: user.id, systemRole: user.systemRole, memberships: [{ organizationId: access.organizationId, role: 'ADMIN' }] },
        Permission.COMPANY_UPDATE,
        access.organizationId
      )
      if (!orgOk) {
        return NextResponse.json(
          { error: 'Permisos insuficientes (company:update)', reqId },
          { status: 403, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
        )
      }
    }

    const form = await request.formData()
    const file = form.get('logo') as File | null
    if (!file) {
      return NextResponse.json(
        { error: 'Archivo requerido', reqId },
        { status: 400, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
      )
    }
    if (!ALLOWED_INPUT_MIME.includes(file.type)) {
      return NextResponse.json(
        { error: 'Tipo de archivo no permitido', reqId },
        { status: 400, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
      )
    }
    if (file.size > LOGO_MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: 'Archivo demasiado grande (máx 5MB)', reqId },
        { status: 413, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
      )
    }
    const ext = path.extname(file.name || '').toLowerCase()
    if (!ALLOWED_INPUT_EXTS.includes(ext)) {
      return NextResponse.json(
        { error: 'Extensión de archivo no permitida', reqId },
        { status: 400, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
      )
    }

    const safeDir = await ensureUploadsDir()
    const rawBuffer = Buffer.from(await file.arrayBuffer())
    if (rawBuffer.byteLength > LOGO_MAX_FILE_BYTES) {
      return NextResponse.json(
        { error: 'Archivo demasiado grande (máx 5MB)', reqId },
        { status: 413, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
      )
    }

    // CAPA 3: Magic Bytes validateImageMagicBytes helper
    if (!validateImageMagicBytes(rawBuffer, ext)) {
      return NextResponse.json(
        { error: 'Contenido de archivo no corresponde a una imagen válida', reqId },
        { status: 400, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
      )
    }

    // CAPA 4: UUID safe filename + companyId prefix
    const safeBaseName = `${company.id}-${uuidv4()}${LOGO_OUTPUT_EXT}`
    const targetPath = path.join(safeDir, safeBaseName)
    // CAPA 6: realpath anti-symlink NTFS/Junction post-resolve
    const resolvedDir = await realpath(path.dirname(targetPath))
    if (resolvedDir !== safeDir) {
      return NextResponse.json(
        { error: 'Ruta de destino no permitida', reqId },
        { status: 400, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
      )
    }

    // CAPA 5: Sharp dynamic import reencode 512x512 WebP (destruye polyglots PNG+HTML/PHP)
    const sharpModule = await import('sharp')
    const sharp = sharpModule.default ?? sharpModule
    const reencoded = await sharp(rawBuffer)
      .rotate()
      .resize(LOGO_MAX_PX, LOGO_MAX_PX, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: LOGO_QUALITY, effort: 4 })
      .toBuffer()

    // Eliminar logo anterior de la misma compañía (cleanup)
    try {
      const uploadDir = getRawUploadsDir()
      const { readdir, stat } = await import('fs/promises')
      const files = await readdir(uploadDir)
      const candidates = files.filter(f => f.startsWith(`${company.id}-`))
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

    await writeFile(targetPath, reencoded, { flag: 'w', mode: 0o600 })
    const realFinal = await realpath(targetPath)
    if (path.dirname(realFinal) !== safeDir) {
      try { await unlink(targetPath) } catch { void 0 }
      return NextResponse.json(
        { error: 'Ruta de archivo final inválida', reqId },
        { status: 400, headers: { 'X-Request-Id': reqId, ...SAT_SECURITY_HEADERS } }
      )
    }

    const logoUrl = `/uploads/company-logos/${encodeURIComponent(safeBaseName)}`
    await prisma.company.update({
      where: { id: company.id },
      data: { updatedBy: user.id }
    })

    try {
      await prisma.auditLog.create({
        data: {
          tableName: 'companies',
          recordId: company.id,
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
