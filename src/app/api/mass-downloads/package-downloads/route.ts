import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { hasPermission, Permission } from '@/lib/permissions'
import type { Prisma } from '@prisma/client'
import {
  PackageDownloadsQuerySchema,
  fp32,
  safeErrSummary,
  massDownloadJsonResponse,
} from '@/lib/mass-downloads-route-utils'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

function getEstadoFromStatus(requestStatus: string) {
  switch (requestStatus) {
    case 'SOLICITADO':
      return { code: 1, texto: 'Aceptada' }
    case 'EN_PROCESO':
      return { code: 2, texto: 'En Proceso' }
    case 'TERMINADO':
      return { code: 3, texto: 'Terminada' }
    case 'RECHAZADO':
      return { code: 4, texto: 'Rechazada' }
    case 'VENCIDO':
      return { code: 5, texto: 'Vencida' }
    default:
      return { code: 0, texto: requestStatus || 'Desconocido' }
  }
}

function calculateXmlCounts(
  code: number,
  errorLogData: Record<string, unknown> | null,
  requestType: string,
  satMessage: string | null
): { totalXml: number; descargadosXml: number } {
  const numeroCFDIsStr = errorLogData?.numeroCFDIs
  
  let totalXml = 0
  if (typeof numeroCFDIsStr === 'string') {
    totalXml = Number.parseInt(numeroCFDIsStr, 10)
  } else if (code === 3) {
    totalXml = 200
  }

  let descargadosXml = 0
  if (code === 3) {
    descargadosXml = totalXml
  } else if (code === 2) {
    descargadosXml = Math.floor(totalXml * 0.5)
  }

  if (requestType === 'metadata' && satMessage) {
    const metadataMatch = /Metadata procesada: (\d+) registros importados/i.exec(satMessage)
    if (metadataMatch?.[1]) {
      descargadosXml = Number.parseInt(metadataMatch[1], 10)
      if (totalXml === 0) totalXml = descargadosXml
    } else if (code !== 3) {
      descargadosXml = 0
    }
  }

  return { totalXml, descargadosXml }
}

async function resolveFiscalEntityCompanyAccess(
  rfc: string,
  fiscalEntitiesWithRfc: { organizationId: string }[],
  userMemberships: { organizationId: string }[],
  allowedCompanyIds: Set<string>
) {
  if (fiscalEntitiesWithRfc.length === 0) return

  const feOrgs = new Set(fiscalEntitiesWithRfc.map(fe => fe.organizationId))
  const companyForRfc = await prisma.company.findUnique({
    where: { rfc },
    select: {
      id: true,
      companyAccesses: {
        where: { organizationId: { in: [...feOrgs] } },
        select: { id: true, organizationId: true },
      },
    },
  })

  if (!companyForRfc) return

  if (companyForRfc.companyAccesses.length > 0) allowedCompanyIds.add(companyForRfc.id)

  for (const fe of fiscalEntitiesWithRfc) {
    if (companyForRfc.companyAccesses.some(ca => ca.organizationId === fe.organizationId)) {
      allowedCompanyIds.add(companyForRfc.id)
    }
  }

  if (fiscalEntitiesWithRfc.some(fe => userMemberships.some(m => m.organizationId === fe.organizationId))) {
    allowedCompanyIds.add(companyForRfc.id)
  }
}

async function buildAllowedCompanyIds(
  rfc: string,
  userMemberships: { organizationId: string }[],
  fiscalEntitiesWithRfc: { organizationId: string }[],
  companyAccessWithRfc: { companyId: string | null; organizationId: string }[],
  companyIdParam?: string
) {
  const allowedCompanyIds = new Set<string>()
  for (const ca of companyAccessWithRfc) {
    if (ca.companyId) allowedCompanyIds.add(ca.companyId)
  }
  
  await resolveFiscalEntityCompanyAccess(rfc, fiscalEntitiesWithRfc, userMemberships, allowedCompanyIds)

  if (companyIdParam && allowedCompanyIds.has(companyIdParam)) {
    allowedCompanyIds.clear()
    allowedCompanyIds.add(companyIdParam)
  }

  return allowedCompanyIds
}

function verifyUserPermission(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  user: any,
  fiscalEntitiesWithRfc: { organizationId: string }[],
  companyAccessWithRfc: { organizationId: string }[]
) {
  const relevantOrgIds = new Set<string>()
  for (const fe of fiscalEntitiesWithRfc) relevantOrgIds.add(fe.organizationId)
  for (const ca of companyAccessWithRfc) relevantOrgIds.add(ca.organizationId)

  let memberForPermission = null
  for (const m of user.memberships) {
    if (relevantOrgIds.has(m.organizationId)) {
      memberForPermission = { organizationId: m.organizationId, role: m.role }
      break
    }
  }

  if (!memberForPermission) return { error: 'Sin acceso a los paquetes de descarga para este RFC', status: 403 }

  if (!hasPermission(user, Permission.CFDI_DOWNLOAD_MASSIVE, memberForPermission.organizationId)) {
    return { error: 'Permiso insuficiente: Descarga Masiva', status: 403 }
  }

  return null
}

async function checkAccess(sessionUserId: string, rfc: string, companyIdParam?: string) {
  const user = await prisma.user.findUnique({
    where: { id: sessionUserId },
    select: {
      id: true,
      systemRole: true,
      memberships: {
        where: { status: 'APPROVED' },
        select: { id: true, organizationId: true, role: true, status: true }
      }
    }
  })
  if (!user || user.memberships.length === 0) return { error: 'Sin membresía activa', status: 403 }

  const orgIdsAllowed = new Set(user.memberships.map(m => m.organizationId))

  const fiscalEntitiesWithRfc = await prisma.fiscalEntity.findMany({
    where: { rfc, isActive: true, organizationId: { in: [...orgIdsAllowed] } },
    select: { organizationId: true, id: true, rfc: true },
  })

  const companyAccessWithRfc = await prisma.companyAccess.findMany({
    where: {
      memberId: { in: user.memberships.map(m => m.id) },
      organizationId: { in: [...orgIdsAllowed] },
      company: { rfc: rfc },
    },
    select: {
      companyId: true,
      organizationId: true,
      company: { select: { rfc: true, id: true } },
      memberId: true,
    },
  })

  if (fiscalEntitiesWithRfc.length === 0 && companyAccessWithRfc.length === 0) {
    return { error: 'Sin acceso a los paquetes de descarga para este RFC', status: 403 }
  }

  const allowedCompanyIds = await buildAllowedCompanyIds(
    rfc,
    user.memberships,
    fiscalEntitiesWithRfc,
    companyAccessWithRfc,
    companyIdParam
  )

  const permissionError = verifyUserPermission(user, fiscalEntitiesWithRfc, companyAccessWithRfc)
  if (permissionError) return permissionError

  return { allowedCompanyIds, user }
}

export async function GET(req: Request) {
  const reqId = crypto.randomUUID()
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return massDownloadJsonResponse({ error: 'No autorizado', reqId }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const rawQuery = {
      rfc: searchParams.get('rfc') || undefined,
      companyId: searchParams.get('companyId') || undefined,
    }

    const parsed = PackageDownloadsQuerySchema.safeParse(rawQuery)
    if (!parsed.success) {
      return massDownloadJsonResponse(
        { error: 'Parámetros inválidos', reqId, issues: parsed.error.issues.map(i => i.path.join('.')) },
        { status: 400 }
      )
    }

    const { rfc, companyId: companyIdParam } = parsed.data
    
    const accessResult = await checkAccess(session.user.id, rfc, companyIdParam)
    if ('error' in accessResult) {
      return massDownloadJsonResponse({ error: accessResult.error, reqId }, { status: accessResult.status })
    }

    const { allowedCompanyIds } = accessResult

    if (allowedCompanyIds.size === 0) {
      return massDownloadJsonResponse({ data: [], reqId })
    }

    const reqWhere: Prisma.MassDownloadRequestWhereInput = {
      requestingRfc: rfc,
      companyId: { in: [...allowedCompanyIds] },
    }

    const requests = await prisma.massDownloadRequest.findMany({
      where: reqWhere,
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    const now = new Date()

    const data = requests.map((r) => {
      const { code, texto } = getEstadoFromStatus(r.requestStatus)
      
      let progreso = 0
      if (code === 1) progreso = 10
      else if (code === 2) progreso = 50
      else if (code === 3) progreso = 100

      const paquetes = Array.isArray(r.packageIds) ? r.packageIds : []

      const periodoMes = (r.startDate?.getMonth() ?? now.getMonth()) + 1
      const periodoAnio = r.startDate?.getFullYear() ?? now.getFullYear()

      const fecha_vencimiento = new Date(r.createdAt)
      fecha_vencimiento.setDate(fecha_vencimiento.getDate() + 7)

      const errorLogData = r.errorLog as Record<string, unknown> | null
      const { totalXml, descargadosXml } = calculateXmlCounts(code, errorLogData, r.requestType, r.satMessage)

      return {
        id_solicitud: r.satPackageId ?? r.id,
        id_interno: r.id,
        rfc: r.requestingRfc,
        estado_code: code,
        estado_texto: texto,
        progreso,
        paquetes,
        fecha_vencimiento: fecha_vencimiento.toISOString(),
        fecha_peticion: code === 3 ? r.updatedAt.toISOString() : null,
        periodoMes,
        periodoAnio,
        totalXml,
        descargadosXml,
        requestType: r.requestType,
      }
    })

    return massDownloadJsonResponse({ data, reqId })
  } catch (err) {
    const summary = safeErrSummary(err)
    const errId = fp32(JSON.stringify(summary))
    console.error('[package-downloads 500]', { reqId, errId, summary })
    return massDownloadJsonResponse(
      { error: 'Error al consultar paquetes de descarga', reqId, errId },
      { status: 500 },
    )
  }
}
