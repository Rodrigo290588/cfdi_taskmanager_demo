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

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        systemRole: true,
        memberships: {
          where: { status: 'APPROVED' },
          select: {
            id: true,
            organizationId: true,
            role: true,
            status: true,
          }
        }
      }
    })
    if (!user || user.memberships.length === 0) {
      return massDownloadJsonResponse({ error: 'Sin membresía activa', reqId }, { status: 403 })
    }

    const orgIdsAllowed = new Set(user.memberships.map(m => m.organizationId))

    const fiscalEntitiesWithRfc = await prisma.fiscalEntity.findMany({
      where: {
        rfc: rfc,
        isActive: true,
        organizationId: { in: [...orgIdsAllowed] },
      },
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

    const canAccessRfc = fiscalEntitiesWithRfc.length > 0 || companyAccessWithRfc.length > 0
    if (!canAccessRfc) {
      return massDownloadJsonResponse(
        { error: 'Sin acceso a los paquetes de descarga para este RFC', reqId },
        { status: 403 }
      )
    }

    const allowedCompanyIds = new Set<string>()
    for (const ca of companyAccessWithRfc) {
      if (ca.companyId) allowedCompanyIds.add(ca.companyId)
    }
    if (fiscalEntitiesWithRfc.length > 0) {
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
      if (companyForRfc) {
        if (companyForRfc.companyAccesses.length > 0) {
          allowedCompanyIds.add(companyForRfc.id)
        }
        for (const fe of fiscalEntitiesWithRfc) {
          const orgMatches = companyForRfc.companyAccesses.some(ca => ca.organizationId === fe.organizationId)
          if (orgMatches) allowedCompanyIds.add(companyForRfc.id)
        }
        const directRfcOrgAccess = fiscalEntitiesWithRfc.some(fe => user.memberships.some(m => m.organizationId === fe.organizationId))
        if (directRfcOrgAccess) allowedCompanyIds.add(companyForRfc.id)
      }
    }
    if (companyIdParam && allowedCompanyIds.has(companyIdParam)) {
      allowedCompanyIds.clear()
      allowedCompanyIds.add(companyIdParam)
    }
    if (allowedCompanyIds.size === 0) {
      return massDownloadJsonResponse({ data: [], reqId })
    }

    const relevantOrgIds = new Set<string>()
    for (const fe of fiscalEntitiesWithRfc) relevantOrgIds.add(fe.organizationId)
    for (const ca of companyAccessWithRfc) relevantOrgIds.add(ca.organizationId)

    let memberForPermission: { organizationId: string; role: string } | null = null
    for (const m of user.memberships) {
      if (relevantOrgIds.has(m.organizationId)) {
        memberForPermission = { organizationId: m.organizationId, role: m.role }
        break
      }
    }
    if (!memberForPermission) {
      return massDownloadJsonResponse(
        { error: 'Sin acceso a los paquetes de descarga para este RFC', reqId },
        { status: 403 }
      )
    }

    const canDownload = hasPermission(
      user,
      Permission.CFDI_DOWNLOAD_MASSIVE,
      memberForPermission.organizationId
    )
    if (!canDownload) {
      return massDownloadJsonResponse(
        { error: 'Permiso insuficiente: Descarga Masiva', reqId },
        { status: 403 }
      )
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
      const progreso = code === 1 ? 10 : code === 2 ? 50 : code === 3 ? 100 : 0

      const paquetes = Array.isArray(r.packageIds) ? r.packageIds : []

      const periodoMes = (r.startDate?.getMonth() ?? now.getMonth()) + 1
      const periodoAnio = r.startDate?.getFullYear() ?? now.getFullYear()

      const fecha_vencimiento = new Date(r.createdAt)
      fecha_vencimiento.setDate(fecha_vencimiento.getDate() + 7)

      const errorLogData = r.errorLog as Record<string, unknown> | null
      const numeroCFDIsStr = errorLogData?.numeroCFDIs
      let totalXml = typeof numeroCFDIsStr === 'string' ? parseInt(numeroCFDIsStr, 10) : (code === 3 ? 200 : 0)

      let descargadosXml = code === 3 ? totalXml : (code === 2 ? Math.floor(totalXml * 0.5) : 0)

      if (r.requestType === 'metadata' && r.satMessage) {
        const metadataMatch = r.satMessage.match(/Metadata procesada: (\d+) registros importados/i)
        if (metadataMatch && metadataMatch[1]) {
          descargadosXml = parseInt(metadataMatch[1], 10)
          if (totalXml === 0) totalXml = descargadosXml
        } else if (code !== 3) {
          descargadosXml = 0
        }
      }

      return {
        id_solicitud: r.satPackageId ?? r.id,
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
