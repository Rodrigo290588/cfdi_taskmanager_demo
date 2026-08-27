import { Prisma, RequestStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getMassVerificationQueue, getMassDownloadQueue } from '@/lib/queue'
import { auth } from '@/lib/auth'
import { hasPermission, Permission } from '@/lib/permissions'
import { rateLimitByUserId, RateLimitError } from '@/lib/rate-limit'
import {
  PostCreateMassRequestSchema,
  RequestsListQuerySchema,
  fp32,
  safeErrSummary,
  getRealClientIp,
  massDownloadJsonResponse,
} from '@/lib/mass-downloads-route-utils'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: Request) {
  const reqId = crypto.randomUUID()
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return massDownloadJsonResponse({ error: 'No autorizado', reqId }, { status: 401 })
    }

    const rateLimit = process.env.MASS_DOWNLOADS_RATE_MAX_PER_HOUR
    const RATE_LIMIT_PER_HOUR = rateLimit ? Math.max(5, parseInt(rateLimit, 10) || 30) : 30
    try {
      await rateLimitByUserId({
        userId: session.user.id,
        key: 'mass-request-create',
        limit: RATE_LIMIT_PER_HOUR,
        windowMs: 60 * 60 * 1000,
      })
    } catch (rlErr) {
      if (rlErr instanceof RateLimitError) {
        return massDownloadJsonResponse(
          { error: rlErr.message, reqId },
          { status: rlErr.statusCode, headers: { 'Retry-After': '3600' } }
        )
      }
      throw rlErr
    }

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return massDownloadJsonResponse({ error: 'JSON Body inválido', reqId }, { status: 400 })
    }

    const validatedResult = PostCreateMassRequestSchema.safeParse(body)
    if (!validatedResult.success) {
      return massDownloadJsonResponse(
        {
          error: 'Parámetros de solicitud inválidos',
          reqId,
          issues: validatedResult.error.issues.map(i => ({
            path: i.path.join('.'),
            code: i.code,
          })),
        },
        { status: 400 }
      )
    }
    const validatedData = validatedResult.data

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        systemRole: true,
        memberships: {
          where: { status: 'APPROVED' },
          select: { id: true, organizationId: true, role: true, status: true },
        },
      },
    })
    if (!user || user.memberships.length === 0) {
      return massDownloadJsonResponse({ error: 'Sin membresía activa', reqId }, { status: 403 })
    }

    const company = await prisma.company.findUnique({
      where: { id: validatedData.companyId },
      select: { rfc: true, id: true },
    })
    if (!company) {
      return massDownloadJsonResponse({ error: 'Empresa no encontrada', reqId }, { status: 404 })
    }

    const fiscalEntityForCompany = await prisma.fiscalEntity.findFirst({
      where: { rfc: company.rfc, isActive: true },
      select: { organizationId: true, id: true, rfc: true },
    })

    const fallbackOrgViaAccess = fiscalEntityForCompany
      ? null
      : await prisma.companyAccess.findFirst({
          where: { companyId: company.id },
          select: { organizationId: true },
        })

    const targetOrgId = fiscalEntityForCompany?.organizationId ?? fallbackOrgViaAccess?.organizationId ?? null
    if (!targetOrgId) {
      return massDownloadJsonResponse({ error: 'Empresa sin organización asociada', reqId }, { status: 403 })
    }

    const orgIdsAllowed = new Set(user.memberships.map(m => m.organizationId))
    if (!orgIdsAllowed.has(targetOrgId)) {
      return massDownloadJsonResponse({ error: 'Sin acceso a la empresa', reqId }, { status: 403 })
    }
    const member = user.memberships.find(m => m.organizationId === targetOrgId)
    if (!member) {
      return massDownloadJsonResponse({ error: 'Sin acceso a la organización', reqId }, { status: 403 })
    }

    const canRequest = hasPermission(
      user,
      Permission.CFDI_REQUEST_MASSIVE,
      targetOrgId
    )
    if (!canRequest) {
      return massDownloadJsonResponse(
        { error: 'Permiso insuficiente: Solicitud Descarga Masiva', reqId },
        { status: 403 }
      )
    }

    const requestingRfc = validatedData.requestingRfc
    const tenantRfcMatches =
      company.rfc === requestingRfc

    const feRfcOk = fiscalEntityForCompany && fiscalEntityForCompany.rfc === requestingRfc
    const caMatch = !tenantRfcMatches && !feRfcOk
      ? await prisma.companyAccess.findFirst({
          where: {
            memberId: member.id,
            organizationId: targetOrgId,
            company: { rfc: requestingRfc },
          },
          select: { companyId: true },
        })
      : null
    const isRfcAllowed = tenantRfcMatches || feRfcOk || Boolean(caMatch)
    if (!isRfcAllowed) {
      return massDownloadJsonResponse(
        { error: 'El RFC solicitante no está asociado a tu organización', reqId },
        { status: 403 }
      )
    }

    const startDate = validatedData.startDate ? new Date(validatedData.startDate) : new Date()
    const endDate = validatedData.endDate ? new Date(validatedData.endDate) : new Date()

    if (endDate.getUTCHours() === 0 && endDate.getUTCMinutes() === 0 && endDate.getUTCSeconds() === 0) {
      endDate.setUTCHours(23, 59, 59, 999)
    }

    const request = await prisma.massDownloadRequest.create({
      data: {
        companyId: validatedData.companyId,
        requestingRfc: validatedData.requestingRfc,
        issuerRfc: validatedData.issuerRfc || '',
        receiverRfc: validatedData.receiverRfc,
        startDate,
        endDate,
        requestType: validatedData.requestType,
        retrievalType: validatedData.retrievalType,
        folio: validatedData.folio,
        voucherType: validatedData.voucherType,
        status: validatedData.status || 'Todos',
        thirdPartyRfc: validatedData.thirdPartyRfc,
        complement: validatedData.complement,
        requestStatus: RequestStatus.SOLICITADO,
        satPackageId: '',
        satMessage: 'Solicitud encolada. El SAT será contactado en segundo plano (trabajador asíncrono).',
        packageIds: [],
        verificationAttempts: 0,
        nextCheck: new Date(Date.now() + 5 * 60 * 1000),
      },
    })

    const jobId = `mass-req-init-${request.id}`
    try {
      await getMassDownloadQueue().add(
        'init-mass-download-request',
        {
          requestId: request.id,
          rfc: validatedData.requestingRfc,
          requesterUserId: session.user.id,
          sourceIp: getRealClientIp(req.headers),
        },
        {
          jobId,
          attempts: 3,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: true,
          removeOnFail: 10,
        }
      )
    } catch (queueErr) {
      console.warn('[mass-request queue fail, still persisted]', { reqId, requestId: request.id, queueErr: queueErr instanceof Error ? queueErr.message : String(queueErr) })
      try {
        await getMassVerificationQueue().add(
          'verify-request',
          {
            requestId: request.id,
            rfc: validatedData.requestingRfc
          },
          {
            delay: 30000,
            jobId: `verify-init-${request.id}`,
            attempts: 3,
            backoff: { type: 'exponential', delay: 60_000 }
          }
        )
      } catch {
        // ignore
      }
    }

    return massDownloadJsonResponse(
      [
        {
          id: request.id,
          satPackageId: '',
          requestStatus: RequestStatus.SOLICITADO,
          enqueued: true,
        },
      ],
      { status: 202, headers: { 'X-Request-Id': reqId } }
    )
  } catch (err) {
    const summary = safeErrSummary(err)
    const errId = fp32(JSON.stringify(summary))
    console.error('[mass-requests POST 500]', { reqId, errId, summary })
    return massDownloadJsonResponse(
      { error: 'Error interno al crear solicitud masiva', reqId, errId },
      { status: 500 }
    )
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
      companyId: searchParams.get('companyId') || undefined,
      rfc: searchParams.get('rfc') || undefined,
      status: searchParams.get('status') || undefined,
      requestType: searchParams.get('requestType') || undefined,
      startDate: searchParams.get('startDate') || undefined,
      endDate: searchParams.get('endDate') || undefined,
      folio: searchParams.get('folio') || undefined,
    }

    const parsed = RequestsListQuerySchema.safeParse(rawQuery)
    if (!parsed.success) {
      return massDownloadJsonResponse(
        { error: 'Parámetros inválidos', reqId, issues: parsed.error.issues.map(i => i.path.join('.')) },
        { status: 400 }
      )
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        systemRole: true,
        memberships: {
          where: { status: 'APPROVED' },
          select: { id: true, organizationId: true, role: true, status: true },
        },
      },
    })
    if (!user || user.memberships.length === 0) {
      return massDownloadJsonResponse({ data: [], reqId })
    }

    const orgIdsAllowed = new Set(user.memberships.map(m => m.organizationId))

    const { companyId, rfc, status, requestType, startDate, endDate, folio } = parsed.data

    let targetCompanyOrgId: string | null = null
    if (companyId) {
      const c = await prisma.company.findUnique({
        where: { id: companyId },
        select: { rfc: true, id: true },
      })
      if (!c) {
        return massDownloadJsonResponse({ data: [], reqId })
      }
      const feForCompany = await prisma.fiscalEntity.findFirst({
        where: { rfc: c.rfc, isActive: true },
        select: { organizationId: true },
      })
      const caForCompany = feForCompany
        ? null
        : await prisma.companyAccess.findFirst({
            where: { companyId: c.id },
            select: { organizationId: true },
          })
      targetCompanyOrgId = feForCompany?.organizationId ?? caForCompany?.organizationId ?? null
    }

    if (targetCompanyOrgId && !orgIdsAllowed.has(targetCompanyOrgId)) {
      return massDownloadJsonResponse({ data: [], reqId })
    }

    const allowedCompanyIds: string[] = []
    if (companyId && targetCompanyOrgId) {
      allowedCompanyIds.push(companyId)
    } else {
      const userCompanyAccesses = await prisma.companyAccess.findMany({
        where: { organizationId: { in: [...orgIdsAllowed] } },
        select: { companyId: true },
      })
      for (const ca of userCompanyAccesses) {
        if (ca.companyId && !allowedCompanyIds.includes(ca.companyId)) {
          allowedCompanyIds.push(ca.companyId)
        }
      }
    }

    const allowedRfcsForUser = new Set<string>()
    if (rfc) {
      const fiscalOk = await prisma.fiscalEntity.findFirst({
        where: { rfc, organizationId: { in: [...orgIdsAllowed] }, isActive: true },
        select: { rfc: true },
      })
      if (!fiscalOk) {
        const anyCompanyRfc = allowedCompanyIds.length > 0
          ? await prisma.company.findFirst({
              where: { id: { in: allowedCompanyIds }, rfc },
              select: { rfc: true },
            })
          : null
        if (!anyCompanyRfc) {
          return massDownloadJsonResponse({ data: [], reqId })
        }
      }
      allowedRfcsForUser.add(rfc)
    }

    if (allowedCompanyIds.length === 0 && allowedRfcsForUser.size === 0) {
      return massDownloadJsonResponse({ data: [], reqId })
    }

    const where: Prisma.MassDownloadRequestWhereInput = { AND: [] }
    const andClauses = where.AND as Prisma.MassDownloadRequestWhereInput[]

    if (allowedCompanyIds.length > 0) {
      andClauses.push({ companyId: { in: allowedCompanyIds } })
    }
    if (allowedRfcsForUser.size > 0) {
      andClauses.push({ requestingRfc: { in: [...allowedRfcsForUser] } })
    } else if (rfc) {
      andClauses.push({ requestingRfc: rfc })
    }

    if (status && status !== 'Todos') {
      andClauses.push({
        OR: [
          { status },
          { requestStatus: status as RequestStatus },
        ],
      })
    }

    if (requestType) {
      andClauses.push({ requestType })
    }

    if (startDate) {
      andClauses.push({ startDate: { gte: new Date(startDate) } })
    }
    if (endDate) {
      andClauses.push({ endDate: { lte: new Date(endDate) } })
    }
    if (startDate && endDate) {
      andClauses.push({ startDate: { gte: new Date(startDate) } })
      andClauses.push({ endDate: { lte: new Date(endDate) } })
    }
    if (folio) {
      andClauses.push({ folio: { contains: folio } })
    }

    const requests = await prisma.massDownloadRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    })

    return massDownloadJsonResponse({ data: requests, reqId })
  } catch (err) {
    const summary = safeErrSummary(err)
    const errId = fp32(JSON.stringify(summary))
    console.error('[mass-requests GET 500]', { reqId, errId, summary })
    return massDownloadJsonResponse({ data: [], error: 'Error al consultar solicitudes', reqId, errId }, { status: 200 })
  }
}
