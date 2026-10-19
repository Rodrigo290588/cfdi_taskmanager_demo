import { Prisma, RequestStatus, SystemRole, MemberRole } from '@prisma/client'
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

async function validateUserMembership(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
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
    return { error: 'Sin membresía activa', status: 403, user: null }
  }
  return { user }
}

async function determineTargetOrgId(companyId: string) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { rfc: true, id: true },
  })
  if (!company) return { error: 'Empresa no encontrada', status: 404, targetOrgId: null, company: null }

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
    return { error: 'Empresa sin organización asociada', status: 403, targetOrgId: null, company: null }
  }

  return { targetOrgId, company, fiscalEntityForCompany }
}

async function verifyRfcAccess(
  requestingRfc: string,
  companyRfc: string,
  fiscalEntityForCompanyRfc: string | undefined,
  memberId: string,
  targetOrgId: string
) {
  const tenantRfcMatches = companyRfc === requestingRfc
  const feRfcOk = fiscalEntityForCompanyRfc === requestingRfc
  
  const caMatch = !tenantRfcMatches && !feRfcOk
    ? await prisma.companyAccess.findFirst({
        where: {
          memberId,
          organizationId: targetOrgId,
          company: { rfc: requestingRfc },
        },
        select: { companyId: true },
      })
    : null
    
  return tenantRfcMatches || feRfcOk || Boolean(caMatch)
}

async function enqueueMassDownloadJobs(
  requestId: string,
  requestingRfc: string,
  userId: string,
  sourceIp: string,
  reqId: string
) {
  const jobId = `mass-req-init-${requestId}`
  try {
    await getMassDownloadQueue().add(
      'init-mass-download-request',
      {
        requestId,
        rfc: requestingRfc,
        requesterUserId: userId,
        sourceIp,
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
    console.warn('[mass-request queue fail, still persisted]', { reqId, requestId, queueErr: queueErr instanceof Error ? queueErr.message : String(queueErr) })
    try {
      await getMassVerificationQueue().add(
        'verify-request',
        {
          requestId,
          rfc: requestingRfc
        },
        {
          delay: 30000,
          jobId: `verify-init-${requestId}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 60_000 }
        }
      )
    } catch {
      // ignore
    }
  }
}

async function checkRateLimit(userId: string, reqId: string) {
  const rateLimitStr = process.env.MASS_DOWNLOADS_RATE_MAX_PER_HOUR
  const RATE_LIMIT_PER_HOUR = rateLimitStr ? Math.max(5, Number.parseInt(rateLimitStr, 10) || 30) : 30
  try {
    rateLimitByUserId({
      userId,
      key: 'mass-request-create',
      limit: RATE_LIMIT_PER_HOUR,
      windowMs: 60 * 60 * 1000,
    })
    return null
  } catch (rlErr) {
    if (rlErr instanceof RateLimitError) {
      return massDownloadJsonResponse(
        { error: rlErr.message, reqId },
        { status: rlErr.statusCode, headers: { 'Retry-After': '3600' } }
      )
    }
    throw rlErr
  }
}

async function parseRequestBody(req: Request, reqId: string) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return { errorResponse: massDownloadJsonResponse({ error: 'JSON Body inválido', reqId }, { status: 400 }), validatedData: null }
  }

  const validatedResult = PostCreateMassRequestSchema.safeParse(body)
  if (!validatedResult.success) {
    return {
      errorResponse: massDownloadJsonResponse(
        {
          error: 'Parámetros de solicitud inválidos',
          reqId,
          issues: validatedResult.error.issues.map(i => ({
            path: i.path.join('.'),
            code: i.code,
          })),
        },
        { status: 400 }
      ),
      validatedData: null
    }
  }
  return { errorResponse: null, validatedData: validatedResult.data }
}

interface UserWithMemberships {
  id: string
  systemRole: SystemRole
  memberships: {
    id: string
    organizationId: string
    role: MemberRole
    status: string
  }[]
}

async function verifyAuthorization(user: UserWithMemberships, targetOrgId: string, reqId: string) {
  const orgIdsAllowed = new Set(user.memberships.map((m) => m.organizationId))
  if (!orgIdsAllowed.has(targetOrgId)) {
    return { errorResponse: massDownloadJsonResponse({ error: 'Sin acceso a la empresa', reqId }, { status: 403 }), member: null }
  }
  const member = user.memberships.find((m) => m.organizationId === targetOrgId)
  if (!member) {
    return { errorResponse: massDownloadJsonResponse({ error: 'Sin acceso a la organización', reqId }, { status: 403 }), member: null }
  }

  const canRequest = hasPermission(user, Permission.CFDI_REQUEST_MASSIVE, targetOrgId)
  if (!canRequest) {
    return {
      errorResponse: massDownloadJsonResponse(
        { error: 'Permiso insuficiente: Solicitud Descarga Masiva', reqId },
        { status: 403 }
      ),
      member: null
    }
  }
  return { errorResponse: null, member }
}

export async function POST(req: Request) {
  const reqId = crypto.randomUUID()
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return massDownloadJsonResponse({ error: 'No autorizado', reqId }, { status: 401 })
    }

    const rateLimitErrorResponse = await checkRateLimit(session.user.id, reqId)
    if (rateLimitErrorResponse) return rateLimitErrorResponse

    const { errorResponse, validatedData } = await parseRequestBody(req, reqId)
    if (errorResponse || !validatedData) return errorResponse

    const { user, error: membershipError, status: membershipStatus } = await validateUserMembership(session.user.id)
    if (membershipError || !user) {
      return massDownloadJsonResponse({ error: membershipError }, { status: membershipStatus })
    }

    const { targetOrgId, company, fiscalEntityForCompany, error: orgError, status: orgStatus } = await determineTargetOrgId(validatedData.companyId)
    if (orgError || !targetOrgId || !company) {
      return massDownloadJsonResponse({ error: orgError }, { status: orgStatus })
    }

    const authCheck = await verifyAuthorization(user, targetOrgId, reqId)
    if (authCheck.errorResponse || !authCheck.member) return authCheck.errorResponse
    const { member } = authCheck

    const requestingRfc = validatedData.requestingRfc
    const isRfcAllowed = await verifyRfcAccess(
      requestingRfc,
      company.rfc,
      fiscalEntityForCompany?.rfc,
      member.id,
      targetOrgId
    )
    if (!isRfcAllowed) {
      return massDownloadJsonResponse(
        { error: 'El RFC solicitante no está asociado a tu organización', reqId },
        { status: 403 }
      )
    }

    // Usamos el formato nativo para evitar saltos de Timezone en el servidor
    const startDate = validatedData.startDate ? new Date(`${validatedData.startDate}T06:00:00.000Z`) : new Date()
    const endDate = validatedData.endDate ? new Date(`${validatedData.endDate}T23:59:59.999Z`) : new Date()

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

    await enqueueMassDownloadJobs(
      request.id,
      validatedData.requestingRfc,
      session.user.id,
      getRealClientIp(req.headers),
      reqId
    )

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

async function buildTargetCompanyOrgId(companyId: string | undefined): Promise<string | null> {
  if (!companyId) return null
  const c = await prisma.company.findUnique({
    where: { id: companyId },
    select: { rfc: true, id: true },
  })
  if (!c) return null
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
  return feForCompany?.organizationId ?? caForCompany?.organizationId ?? null
}

async function buildAllowedCompanyIds(
  companyId: string | undefined,
  targetCompanyOrgId: string | null,
  orgIdsAllowed: Set<string>
): Promise<string[]> {
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
  return allowedCompanyIds
}

async function buildAllowedRfcs(
  rfc: string | undefined,
  orgIdsAllowed: Set<string>,
  allowedCompanyIds: string[]
): Promise<Set<string>> {
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
      if (!anyCompanyRfc) return allowedRfcsForUser
    }
    allowedRfcsForUser.add(rfc)
  }
  return allowedRfcsForUser
}

interface WhereClauseFilters {
  rfc: string | undefined
  status: string | undefined
  requestType: string | undefined
  startDate: string | undefined
  endDate: string | undefined
  folio: string | undefined
}

function buildWhereClauses(
  allowedCompanyIds: string[],
  allowedRfcsForUser: Set<string>,
  filters: WhereClauseFilters
) {
  const andClauses: Prisma.MassDownloadRequestWhereInput[] = []

  if (allowedCompanyIds.length > 0) {
    andClauses.push({ companyId: { in: allowedCompanyIds } })
  }
  if (allowedRfcsForUser.size > 0) {
    andClauses.push({ requestingRfc: { in: [...allowedRfcsForUser] } })
  } else if (filters.rfc) {
    andClauses.push({ requestingRfc: filters.rfc })
  }

  if (filters.status && filters.status !== 'Todos') {
    andClauses.push({
      OR: [
        { status: filters.status },
        { requestStatus: filters.status as RequestStatus },
      ],
    })
  }

  if (filters.requestType) {
    andClauses.push({ requestType: filters.requestType })
  }

  if (filters.startDate) {
    andClauses.push({ startDate: { gte: new Date(filters.startDate) } })
  }
  if (filters.endDate) {
    andClauses.push({ endDate: { lte: new Date(filters.endDate) } })
  }
  if (filters.folio) {
    andClauses.push({ folio: { contains: filters.folio } })
  }

  return { AND: andClauses }
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

    const targetCompanyOrgId = await buildTargetCompanyOrgId(companyId)
    if (companyId && !targetCompanyOrgId) {
      return massDownloadJsonResponse({ data: [], reqId })
    }

    if (targetCompanyOrgId && !orgIdsAllowed.has(targetCompanyOrgId)) {
      return massDownloadJsonResponse({ data: [], reqId })
    }

    const allowedCompanyIds = await buildAllowedCompanyIds(companyId, targetCompanyOrgId, orgIdsAllowed)
    const allowedRfcsForUser = await buildAllowedRfcs(rfc, orgIdsAllowed, allowedCompanyIds)

    if (rfc && allowedRfcsForUser.size === 0) {
      return massDownloadJsonResponse({ data: [], reqId })
    }

    if (allowedCompanyIds.length === 0 && allowedRfcsForUser.size === 0) {
      return massDownloadJsonResponse({ data: [], reqId })
    }

    const where = buildWhereClauses(
      allowedCompanyIds,
      allowedRfcsForUser,
      {
        rfc,
        status,
        requestType,
        startDate,
        endDate,
        folio
      }
    )

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
