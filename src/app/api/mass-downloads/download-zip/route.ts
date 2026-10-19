import { NextRequest, NextResponse } from 'next/server'
import { downloadMassPackages } from '@/lib/sat-service'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { hasPermission, Permission } from '@/lib/permissions'
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
function validateParams(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const rfc = (searchParams.get('rfc') || '').trim()
  const idPaquete = (searchParams.get('idPaquete') || '').trim()

  if (!rfc || !idPaquete) {
    return { error: 'Faltan parámetros requeridos: rfc, idPaquete', status: 400 }
  }

  // [SAST-FIX API-04] Validación estricta del RFC (formato SAT)
  if (!/^[A-ZÑ&]{3,4}\d{6}[A-Z\d]{3}$/i.test(rfc)) {
    return { error: 'RFC inválido', status: 400 }
  }

  // Validar idPaquete (alfanumérico + guiones, típico SAT)
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(idPaquete)) {
    return { error: 'idPaquete inválido', status: 400 }
  }

  return { rfc, idPaquete }
}

async function getAuthorizedMember(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      systemRole: true,
      memberships: { where: { status: 'APPROVED' }, select: { organizationId: true, role: true } }
    }
  })
  const member = await prisma.member.findFirst({
    where: { userId, status: 'APPROVED' },
    include: { organization: true }
  })
  
  if (!user || !member?.organization) {
    return { error: 'Sin membresía activa', status: 403 }
  }

  const canDownload = hasPermission(user, Permission.CFDI_DOWNLOAD_MASSIVE, member.organizationId)
  if (!canDownload) {
    return { error: 'Permiso insuficiente: descarga masiva', status: 403 }
  }

  return { member }
}

async function verifyTenantAccess(rfc: string, memberId: string, orgId: string) {
  // Opción A: FiscalEntity activo de la organización
  const fe = await prisma.fiscalEntity.findFirst({
    where: { organizationId: orgId, rfc, isActive: true },
    select: { id: true, rfc: true }
  })
  // Opción B: Company accesible via CompanyAccess N:N
  const ca = fe
    ? null
    : await prisma.companyAccess.findFirst({
        where: {
          memberId,
          company: { rfc }
        },
        select: { companyId: true }
      })

  if (!fe && !ca) {
    return { error: 'RFC no autorizado dentro de tu tenant', status: 403 }
  }
  return null
}

async function verifyPackageRequest(rfc: string, idPaquete: string, memberId: string, orgId: string) {
  // [SAST-FIX API-04] Confirmar que el idPaquete corresponde a ese RFC en MassDownloadRequest
  const reqRow = await prisma.massDownloadRequest.findFirst({
    where: {
      AND: [
        {
          OR: [{ requestingRfc: rfc }, { issuerRfc: rfc }, { receiverRfc: rfc }]
        },
        {
          OR: [
            { satPackageId: idPaquete },
            { packageIds: { array_contains: idPaquete } }
          ]
        },
        {
          company: {
            OR: [
              { rfc },
              {
                companyAccesses: {
                  some: { organizationId: orgId, memberId }
                }
              }
            ]
          }
        }
      ]
    },
    select: { id: true, requestStatus: true, satPackageId: true }
  })

  if (!reqRow) {
    return { error: 'Paquete no encontrado o no asociado al RFC', status: 404 }
  }
  return null
}

export async function GET(request: NextRequest) {
  const reqId = crypto.randomUUID()

  try {
    const session = await auth()
    if (!session?.user?.id) {
      return massDownloadJsonResponse({ error: 'No autorizado', reqId }, { status: 401 })
    }

    const paramsValidation = validateParams(request)
    if (paramsValidation.error) {
      return massDownloadJsonResponse(
        { error: paramsValidation.error, reqId },
        { status: paramsValidation.status }
      )
    }
    const { rfc, idPaquete } = paramsValidation

    const authResult = await getAuthorizedMember(session.user.id)
    if (authResult.error) {
      return massDownloadJsonResponse({ error: authResult.error, reqId }, { status: authResult.status })
    }
    const { member } = authResult

    const tenantError = await verifyTenantAccess(rfc!, member!.id, member!.organizationId)
    if (tenantError) {
      return massDownloadJsonResponse({ error: tenantError.error, reqId }, { status: tenantError.status })
    }

    const reqError = await verifyPackageRequest(rfc!, idPaquete!, member!.id, member!.organizationId)
    if (reqError) {
      return massDownloadJsonResponse({ error: reqError.error, reqId }, { status: reqError.status })
    }

    // Solicitar al SAT
    const result = await downloadMassPackages({ rfc: rfc!, idPaquete: idPaquete! })
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
      organizationId: member!.organizationId,
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
