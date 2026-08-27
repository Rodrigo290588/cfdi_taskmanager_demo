import { NextRequest, NextResponse } from 'next/server'
import { downloadMassPackages } from '@/lib/sat-service'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { hasPermission } from '@/lib/permissions'
import { Permission } from '@/lib/permissions'
import {
  massDownloadJsonResponse,
  buildRfc6266ContentDisposition,
  SECURITY_HEADERS,
  MASS_DOWNLOADS_MAX_ZIP_BYTES,
  MASS_DOWNLOADS_ZIP_BASE64_MAX_CHARS,
} from '@/lib/mass-downloads-route-utils'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * [SAST-FIX API-04] Scoping tenant del RFC descargado.
 *   - Solo se permite descargar RFC a los que el usuario tenga acceso via FiscalEntity activo
 *     o bien tenga CompanyAccess sobre una company con dicho RFC.
 * [SAST-FIX API-07] Se elimina el leak de "details" del SAT en errores 500.
 * [MDFC-003] Clamp máximo de ZIP Base64 chars / bytes para evitar OOM.
 * [MDFC-003] RFC6266 hardened filename via buildRfc6266ContentDisposition.
 */
export async function GET(request: NextRequest) {
  const reqId = crypto.randomUUID()

  try {
    const session = await auth()
    if (!session?.user?.id) {
      return massDownloadJsonResponse({ error: 'No autorizado', reqId }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const rfc = (searchParams.get('rfc') || '').trim()
    const idPaquete = (searchParams.get('idPaquete') || '').trim()

    if (!rfc || !idPaquete) {
      return massDownloadJsonResponse(
        { error: 'Faltan parámetros requeridos: rfc, idPaquete', reqId },
        { status: 400 }
      )
    }

    // [SAST-FIX API-04] Validación estricta del RFC (formato SAT)
    if (!/^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$/i.test(rfc)) {
      return massDownloadJsonResponse({ error: 'RFC inválido', reqId }, { status: 400 })
    }

    // Validar idPaquete (alfanumérico + guiones, típico SAT)
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(idPaquete)) {
      return massDownloadJsonResponse({ error: 'idPaquete inválido', reqId }, { status: 400 })
    }

    // [SAST-FIX API-04] Determinar organización activa y permiso
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        systemRole: true,
        memberships: { where: { status: 'APPROVED' }, select: { organizationId: true, role: true } }
      }
    })
    const member = await prisma.member.findFirst({
      where: { userId: session.user.id, status: 'APPROVED' },
      include: { organization: true }
    })
    if (!user || !member || !member.organization) {
      return massDownloadJsonResponse({ error: 'Sin membresía activa', reqId }, { status: 403 })
    }

    const canDownload = hasPermission(user, Permission.CFDI_DOWNLOAD_MASSIVE, member.organizationId)
    if (!canDownload) {
      return massDownloadJsonResponse({ error: 'Permiso insuficiente: descarga masiva', reqId }, { status: 403 })
    }

    // [SAST-FIX API-04] Verificar que el RFC solicitado pertenece al tenant
    // Opción A: FiscalEntity activo de la organización
    const fe = await prisma.fiscalEntity.findFirst({
      where: { organizationId: member.organizationId, rfc, isActive: true },
      select: { id: true, rfc: true }
    })
    // Opción B: Company accesible via CompanyAccess N:N
    const ca = fe
      ? null
      : await prisma.companyAccess.findFirst({
          where: {
            memberId: member.id,
            company: { rfc }
          },
          select: { companyId: true }
        })

    if (!fe && !ca) {
      return massDownloadJsonResponse(
        { error: 'RFC no autorizado dentro de tu tenant', reqId },
        { status: 403 }
      )
    }

    // [SAST-FIX API-04] Confirmar que el idPaquete corresponde a ese RFC en MassDownloadRequest
    const reqRow = await prisma.massDownloadRequest.findFirst({
      where: {
        OR: [{ requestingRfc: rfc }, { issuerRfc: rfc }, { receiverRfc: rfc }],
        satPackageId: idPaquete,
        company: {
          OR: [
            { rfc },
            {
              companyAccesses: {
                some: { organizationId: member.organizationId, memberId: member.id }
              }
            }
          ]
        }
      },
      select: { id: true, requestStatus: true, satPackageId: true }
    })

    if (!reqRow) {
      return massDownloadJsonResponse(
        { error: 'Paquete no encontrado o no asociado al RFC', reqId },
        { status: 404 }
      )
    }

    // Solicitar al SAT
    const result = await downloadMassPackages({ rfc, idPaquete })
    if (!result.paqueteB64 || result.paqueteB64.length > MASS_DOWNLOADS_ZIP_BASE64_MAX_CHARS) {
      return massDownloadJsonResponse(
        { error: `Paquete excede tamaño máximo permitido (${MASS_DOWNLOADS_MAX_ZIP_BYTES >> 20}MB)`, reqId },
        { status: 413 }
      )
    }
    const buffer = Buffer.from(result.paqueteB64, 'base64')
    if (buffer.length > MASS_DOWNLOADS_MAX_ZIP_BYTES) {
      return massDownloadJsonResponse(
        { error: `Paquete descomprimido excede tamaño máximo (${MASS_DOWNLOADS_MAX_ZIP_BYTES >> 20}MB)`, reqId },
        { status: 413 }
      )
    }

    console.info('[mass-download-zip OK]', {
      reqId,
      userId: session.user.id,
      organizationId: member.organizationId,
      rfc,
      idPaquete,
      size: buffer.length
    })

    const safeName = `${idPaquete}.zip`
    const contentDisposition = buildRfc6266ContentDisposition(safeName, 'attachment')

    return new NextResponse(buffer, {
      headers: {
        ...SECURITY_HEADERS,
        'Content-Type': 'application/zip',
        'Content-Disposition': contentDisposition,
        'Content-Length': buffer.length.toString(),
        'X-Request-Id': reqId
      }
    })
  } catch (error) {
    console.error('[mass-download-zip 500]', {
      reqId,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    })
    return massDownloadJsonResponse(
      { error: 'No se pudo descargar el paquete desde el SAT', reqId },
      { status: 500 }
    )
  }
}
