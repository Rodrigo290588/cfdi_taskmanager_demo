import { NextRequest, NextResponse } from 'next/server'
import { SystemRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { writeFile, mkdir, realpath, unlink } from 'fs/promises'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { getPrimaryApprovedMembership, __tenantGetIpFromNextRequest } from '@/lib/tenant'
import { SAT_SECURITY_HEADERS, safeErrSummarySat } from '@/lib/sat-gate-helpers'
import { rateLimitByUserId, rateLimitByClientId, RateLimitError } from '@/lib/rate-limit'
import { enrichUserWithMemberships, hasPermission, Permission } from '@/lib/permissions'

const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])
const MAX_SIZE_BYTES = 2 * 1024 * 1024

const MAGIC_BYTES_MAP: Record<string, string[]> = {
  png: ['89504e47'],
  jpg: ['ffd8ffe0', 'ffd8ffe1', 'ffd8ffe2', 'ffd8ffe3', 'ffd8ffe8', 'ffd8ffdb'],
  jpeg: ['ffd8ffe0', 'ffd8ffe1', 'ffd8ffe2', 'ffd8ffe3', 'ffd8ffe8', 'ffd8ffdb'],
  gif: ['4749463839'],
}

function mergeSatResponseHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    ...SAT_SECURITY_HEADERS,
    'Cache-Control': 'private, no-store, no-cache',
    ...(extra ?? {})
  }
}

function bufferToHex(buffer: ArrayBuffer, maxBytes = 12): string {
  const bytes = new Uint8Array(buffer, 0, Math.min(maxBytes, buffer.byteLength))
  let hex = ''
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0')
  }
  return hex
}

function validateMagicBytes(arrayBuffer: ArrayBuffer, ext: string): boolean {
  const extClean = ext.toLowerCase().replace(/^\./, '')
  const headerHex = bufferToHex(arrayBuffer, 12)

  if (extClean === 'webp') {
    if (arrayBuffer.byteLength < 12) return false
    const bytes = new Uint8Array(arrayBuffer)
    const riff = [bytes[0], bytes[1], bytes[2], bytes[3]]
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
    if (riff !== '52494646') return false
    const webp = [bytes[8], bytes[9], bytes[10], bytes[11]]
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
    return webp === '57454250'
  }

  const signatures = MAGIC_BYTES_MAP[extClean]
  if (!signatures) return false
  return signatures.some(sig => headerHex.startsWith(sig))
}

async function ensureUploadsDirReal(): Promise<string> {
  const rawDir = path.join(process.cwd(), 'public', 'uploads', 'logos')
  await mkdir(rawDir, { recursive: true })
  return await realpath(rawDir)
}

async function safeResolveLogoPath(uploadsReal: string, fileName: string): Promise<string> {
  const sep = path.sep
  const finalPath = path.resolve(uploadsReal, fileName)
  const expectedPrefix = uploadsReal.endsWith(sep) ? uploadsReal : uploadsReal + sep
  if (!finalPath.startsWith(expectedPrefix)) {
    throw new Error('Path traversal detectado')
  }
  return finalPath
}

async function processImageBuffer(buffer: Buffer, ext: string): Promise<Buffer> {
  const extClean = ext.toLowerCase().replace(/^\./, '')
  try {
    const sharp = (await import('sharp')).default
    const processed = await sharp(buffer)
      .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
      .png({ progressive: true, quality: 82 })
      .toBuffer()
    return processed
  } catch {
    return buffer
  }
  void extClean
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth()

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'No autorizado' },
        { status: 401, headers: mergeSatResponseHeaders() }
      )
    }

    const ip = __tenantGetIpFromNextRequest(request)
    const membership = await getPrimaryApprovedMembership(session.user.id)
    if (!membership?.organization) {
      return NextResponse.json(
        { error: 'No se encontró el tenant' },
        { status: 404, headers: mergeSatResponseHeaders() }
      )
    }
    const org = membership.organization
    if (org.isActive === false) {
      return NextResponse.json(
        { error: 'Tenant inactivo' },
        { status: 403, headers: mergeSatResponseHeaders() }
      )
    }

    try {
      rateLimitByClientId({ clientId: ip, key: 'tenant:logo:post:ip', limit: 40, windowMs: 60_000 })
      rateLimitByUserId({ userId: session.user.id, key: 'tenant:logo:post:user', limit: 10, windowMs: 60_000 })
      rateLimitByUserId({ userId: `orgday:${org.id}`, key: 'tenant:logo:post:orgday', limit: 1000, windowMs: 24 * 60 * 60 * 1000 })
    } catch (rl) {
      if (rl instanceof RateLimitError) {
        return NextResponse.json(
          { error: rl.message },
          {
            status: 429,
            headers: mergeSatResponseHeaders({
              'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000))
            })
          }
        )
      }
      throw rl
    }

    const enrichedUser = await enrichUserWithMemberships({
      id: session.user.id,
      systemRole: ((session.user as { systemRole?: string }).systemRole as SystemRole) || SystemRole.USER
    })
    if (!hasPermission(enrichedUser, Permission.TENANT_MANAGE, org.id)) {
      return NextResponse.json(
        { error: 'No tienes permisos para modificar esta información' },
        { status: 403, headers: mergeSatResponseHeaders() }
      )
    }

    const data = await request.formData()
    const file = data.get('logo') as File | null

    if (!file) {
      return NextResponse.json(
        { error: 'No se proporcionó ningún archivo' },
        { status: 400, headers: mergeSatResponseHeaders() }
      )
    }

    if (file.size > MAX_SIZE_BYTES) {
      return NextResponse.json(
        { error: 'El archivo es demasiado grande. Máximo 2MB' },
        { status: 400, headers: mergeSatResponseHeaders() }
      )
    }

    const fileExt = path.extname(file.name).toLowerCase()
    if (!ALLOWED_EXT.has(fileExt)) {
      return NextResponse.json(
        { error: 'Tipo de archivo no permitido. Use JPEG, PNG, GIF o WebP' },
        { status: 400, headers: mergeSatResponseHeaders() }
      )
    }

    const arrayBuffer = await file.arrayBuffer()
    if (!validateMagicBytes(arrayBuffer, fileExt)) {
      return NextResponse.json(
        { error: 'Tipo de archivo inválido (magic bytes no coinciden)' },
        { status: 400, headers: mergeSatResponseHeaders() }
      )
    }

    const uploadsReal = await ensureUploadsDirReal()
    const fileName = `${uuidv4()}.png`
    const finalPath = await safeResolveLogoPath(uploadsReal, fileName)

    let bufferToSave: Buffer = Buffer.from(arrayBuffer as ArrayBuffer)
    try {
      const processed = await processImageBuffer(bufferToSave, fileExt)
      bufferToSave = processed as unknown as Buffer
    } catch {
      bufferToSave = Buffer.from(arrayBuffer as ArrayBuffer)
    }

    await writeFile(finalPath, bufferToSave)

    const logoUrl = `/uploads/logos/${fileName}`
    const updatedOrganization = await prisma.organization.update({
      where: { id: org.id },
      data: { logo: logoUrl }
    })

    return NextResponse.json(
      {
        success: true,
        logoUrl,
        organization: updatedOrganization,
        message: 'Logo subido exitosamente'
      },
      { headers: mergeSatResponseHeaders() }
    )

  } catch (error) {
    const summary = safeErrSummarySat(error)
    return NextResponse.json(
      {
        error: 'Error al subir el logo',
        incidentFingerprint: summary.incidentFingerprint
      },
      { status: 500, headers: mergeSatResponseHeaders() }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await auth()

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'No autorizado' },
        { status: 401, headers: mergeSatResponseHeaders() }
      )
    }

    const ip = __tenantGetIpFromNextRequest(request)
    const membership = await getPrimaryApprovedMembership(session.user.id)
    if (!membership?.organization) {
      return NextResponse.json(
        { error: 'No se encontró el tenant' },
        { status: 404, headers: mergeSatResponseHeaders() }
      )
    }
    const org = membership.organization
    if (org.isActive === false) {
      return NextResponse.json(
        { error: 'Tenant inactivo' },
        { status: 403, headers: mergeSatResponseHeaders() }
      )
    }

    try {
      rateLimitByClientId({ clientId: ip, key: 'tenant:logo:delete:ip', limit: 40, windowMs: 60_000 })
      rateLimitByUserId({ userId: session.user.id, key: 'tenant:logo:delete:user', limit: 10, windowMs: 60_000 })
      rateLimitByUserId({ userId: `orgday:${org.id}`, key: 'tenant:logo:delete:orgday', limit: 1000, windowMs: 24 * 60 * 60 * 1000 })
    } catch (rl) {
      if (rl instanceof RateLimitError) {
        return NextResponse.json(
          { error: rl.message },
          {
            status: 429,
            headers: mergeSatResponseHeaders({
              'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000))
            })
          }
        )
      }
      throw rl
    }

    const enrichedUser = await enrichUserWithMemberships({
      id: session.user.id,
      systemRole: ((session.user as { systemRole?: string }).systemRole as SystemRole) || SystemRole.USER
    })
    if (!hasPermission(enrichedUser, Permission.TENANT_MANAGE, org.id)) {
      return NextResponse.json(
        { error: 'No tienes permisos para modificar esta información' },
        { status: 403, headers: mergeSatResponseHeaders() }
      )
    }

    const previousLogo = org.logo

    const updatedOrganization = await prisma.organization.update({
      where: { id: org.id },
      data: { logo: null }
    })

    if (previousLogo && typeof previousLogo === 'string' && previousLogo.startsWith('/uploads/logos/')) {
      try {
        const uploadsReal = await ensureUploadsDirReal()
        const prevFileName = path.basename(previousLogo)
        const prevPath = await safeResolveLogoPath(uploadsReal, prevFileName)
        try {
          await unlink(prevPath)
        } catch {
        }
      } catch {
      }
    }

    return NextResponse.json(
      {
        success: true,
        organization: updatedOrganization,
        message: 'Logo eliminado exitosamente'
      },
      { headers: mergeSatResponseHeaders() }
    )

  } catch (error) {
    const summary = safeErrSummarySat(error)
    return NextResponse.json(
      {
        error: 'Error al eliminar el logo',
        incidentFingerprint: summary.incidentFingerprint
      },
      { status: 500, headers: mergeSatResponseHeaders() }
    )
  }
}
