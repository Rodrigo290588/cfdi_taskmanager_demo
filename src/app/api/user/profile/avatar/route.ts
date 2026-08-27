import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { writeFile, mkdir, unlink, realpath } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { SAT_SECURITY_HEADERS, safeErrSummarySat } from '@/lib/sat-gate-helpers'
import { enforceUserRateLimit, RateLimitError } from '@/lib/rate-limit'
import { SystemRole } from '@prisma/client'

const ALLOWED_OUTPUT_EXT = '.webp'
const AVATAR_MAX_PX = 512
const AVATAR_QUALITY = 82
const AVATAR_MAX_FILE_BYTES = 5 * 1024 * 1024

let _cachedUploadsDir: string | null = null
function getRawUploadsDir(): string {
  if (_cachedUploadsDir !== null) return _cachedUploadsDir
  const base = /*turbopackIgnore: true*/ process.cwd()
  _cachedUploadsDir = /*turbopackIgnore: true*/ path.join(base, 'public', 'uploads', 'avatars')
  return _cachedUploadsDir
}

type MagicBytesRule = { ext: string; hex: string; offset?: number }

const MAGIC_BYTES_WHITELIST: MagicBytesRule[] = [
  { ext: 'jpg', hex: 'FFD8FF' },
  { ext: 'png', hex: '89504E470D0A1A0A' },
  { ext: 'gif87', hex: '474946383761' },
  { ext: 'gif89', hex: '474946383961' },
  { ext: 'webp1', hex: '52494646', offset: 0 },
  { ext: 'webp2', hex: '57454250', offset: 8 },
]

const BLOCKED_HEX_SNIPPETS = [
  '3C737667',
  '3C535647',
  '3C21444F43545950452068746D6C',
  '3C21646F63747970652068746D6C',
  '3C736372697074',
  '3C534352495054',
  '3F706870',
]

async function ensureUploadsDir(): Promise<string> {
  const RAW_UPLOADS_DIR = getRawUploadsDir()
  await mkdir(RAW_UPLOADS_DIR, { recursive: true })
  const resolved = await realpath(RAW_UPLOADS_DIR)
  return resolved
}

function bufferToHex(buf: Buffer, length = 16, offset = 0): string {
  return buf.subarray(offset, offset + length).toString('hex').toUpperCase()
}

function isAllowedMagicBytes(buf: Buffer): boolean {
  if (buf.length < 4) return false
  const hex = bufferToHex(buf, 32)
  for (const blocked of BLOCKED_HEX_SNIPPETS) {
    if (hex.includes(blocked)) return false
  }
  let pass = false
  for (const rule of MAGIC_BYTES_WHITELIST) {
    const off = rule.offset || 0
    const ruleBytes = Buffer.from(rule.hex, 'hex')
    if (buf.length < off + ruleBytes.length) continue
    let match = true
    for (let i = 0; i < ruleBytes.length; i++) {
      if (buf[off + i] !== ruleBytes[i]) { match = false; break }
    }
    if (match) { pass = true; break }
  }
  return pass
}

function safeUserIdSegment(userId: string): string {
  const safe = userId.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 128)
  return safe.length > 0 ? safe : 'user'
}

function applyUserSecurityHeaders(
  res: NextResponse,
  cachePrivate = true,
): NextResponse {
  for (const [k, v] of Object.entries(SAT_SECURITY_HEADERS)) {
    res.headers.set(k, v)
  }
  if (cachePrivate) {
    res.headers.set('Cache-Control', 'no-store, private, max-age=0, must-revalidate')
    res.headers.set('Pragma', 'no-cache')
  }
  return res
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      const r = NextResponse.json({ error: 'No autorizado' }, { status: 401 })
      return applyUserSecurityHeaders(r)
    }
    const systemRole: SystemRole =
      ((session.user as { systemRole?: string }).systemRole as SystemRole) || SystemRole.USER
    void systemRole

    enforceUserRateLimit(session.user.id, 'avatarPost')

    const form = await request.formData()
    const file = form.get('avatar') as File | null
    if (!file) {
      const r = NextResponse.json({ error: 'Archivo requerido' }, { status: 400 })
      return applyUserSecurityHeaders(r)
    }
    if (file.size > AVATAR_MAX_FILE_BYTES) {
      const r = NextResponse.json({ error: 'Archivo demasiado grande (máx 5MB)' }, { status: 400 })
      return applyUserSecurityHeaders(r)
    }
    const rawMime = String(file.type || '').toLowerCase().trim()
    if (!/^image\/(jpeg|jpg|png|gif|webp)$/.test(rawMime)) {
      const r = NextResponse.json({ error: 'Tipo de archivo no permitido' }, { status: 400 })
      return applyUserSecurityHeaders(r)
    }

    const rawBuffer = Buffer.from(await file.arrayBuffer())
    if (!isAllowedMagicBytes(rawBuffer)) {
      const r = NextResponse.json({ error: 'Contenido de archivo inválido o bloqueado' }, { status: 400 })
      return applyUserSecurityHeaders(r)
    }

    const safeDir = await ensureUploadsDir()
    const baseName = `${safeUserIdSegment(session.user.id)}${ALLOWED_OUTPUT_EXT}`
    const targetPath = path.join(safeDir, baseName)
    const resolvedTarget = await realpath(path.dirname(targetPath))
    if (resolvedTarget !== safeDir) {
      const r = NextResponse.json({ error: 'Ruta de destino no permitida' }, { status: 400 })
      return applyUserSecurityHeaders(r)
    }

    const sharpModule = await import('sharp')
    const sharp = sharpModule.default ?? sharpModule
    const reencoded = await sharp(rawBuffer)
      .rotate()
      .resize(AVATAR_MAX_PX, AVATAR_MAX_PX, { fit: 'cover', withoutEnlargement: true })
      .webp({ quality: AVATAR_QUALITY, effort: 4 })
      .toBuffer()

    await writeFile(targetPath, reencoded, { flag: 'w', mode: 0o600 })

    const avatarUrl = `/uploads/avatars/${baseName}`
    await prisma.user.update({ where: { id: session.user.id }, data: { image: avatarUrl } })

    const r = NextResponse.json({ success: true, avatarUrl })
    return applyUserSecurityHeaders(r)
  } catch (error) {
    const safe = safeErrSummarySat(error)
    if (error instanceof RateLimitError) {
      const r = NextResponse.json({ error: (error as RateLimitError).message }, { status: 429 })
      r.headers.set('Retry-After', String(Math.ceil((error as RateLimitError).retryAfterMs / 1000)))
      return applyUserSecurityHeaders(r, false)
    }
    const r = NextResponse.json(
      { error: safe.message, incidentFingerprint: safe.incidentFingerprint },
      { status: 500 },
    )
    return applyUserSecurityHeaders(r)
  }
}

export async function DELETE(_request: NextRequest) {
  void _request
  try {
    const session = await auth()
    if (!session?.user?.id) {
      const r = NextResponse.json({ error: 'No autorizado' }, { status: 401 })
      return applyUserSecurityHeaders(r)
    }

    enforceUserRateLimit(session.user.id, 'avatarDelete')

    const prev = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { image: true },
    })

    await prisma.user.update({ where: { id: session.user.id }, data: { image: null } })

    if (prev?.image && prev.image.startsWith('/uploads/avatars/')) {
      try {
        const safeDir = await ensureUploadsDir()
        const rel = prev.image.slice('/uploads/avatars/'.length).replace(/\.\./g, '_')
        const candidate = path.join(safeDir, rel)
        const resolved = await realpath(path.dirname(candidate))
        if (resolved === safeDir && existsSync(candidate)) {
          await unlink(candidate)
        }
      } catch {
        void 0
      }
    }

    const r = NextResponse.json({ success: true })
    return applyUserSecurityHeaders(r)
  } catch (error) {
    const safe = safeErrSummarySat(error)
    if (error instanceof RateLimitError) {
      const r = NextResponse.json({ error: (error as RateLimitError).message }, { status: 429 })
      r.headers.set('Retry-After', String(Math.ceil((error as RateLimitError).retryAfterMs / 1000)))
      return applyUserSecurityHeaders(r, false)
    }
    const r = NextResponse.json(
      { error: safe.message, incidentFingerprint: safe.incidentFingerprint },
      { status: 500 },
    )
    return applyUserSecurityHeaders(r)
  }
}
