import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { createAuditEntry } from '@/lib/audit'

type ProviderPaymentComplianceCandidate = {
  id: string
  organization_id: string
  member_id: string
  provider_rfc: string
  uuid: string
  file_name: string
  payment_complement_due_date: Date | string | null
}

type ProviderPaymentLinkRecord = {
  organization_id: string
  provider_rfc: string
  payment_links_json: unknown
}

type ProviderPaymentLinkJson = {
  relatedUuid?: string
}

function normalizeText(value: string | null | undefined) {
  return (value || '').trim()
}

function normalizeRfc(value: string | null | undefined) {
  return normalizeText(value).toUpperCase()
}

function normalizeUuid(value: string | null | undefined) {
  return normalizeText(value).toUpperCase()
}

function formatDueDate(value: Date | string | null | undefined) {
  const parsed = value ? new Date(value) : null

  if (!parsed || Number.isNaN(parsed.getTime())) {
    return 'sin fecha limite registrada'
  }

  return parsed.toLocaleDateString('es-MX', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  })
}

export function calculateProviderPaymentComplementDueDate(paymentDate: Date | string) {
  const parsed = paymentDate instanceof Date ? new Date(paymentDate) : new Date(paymentDate)

  if (Number.isNaN(parsed.getTime())) {
    throw new Error('No fue posible calcular la fecha limite del complemento de pago porque la fecha de pago es invalida.')
  }

  return new Date(Date.UTC(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth() + 1,
    5,
    23,
    59,
    59,
    999
  ))
}

export function buildProviderUploadBlockedMessage(params: {
  uuid: string
  dueDate: Date | string | null | undefined
}) {
  return `La carga de CFDI de ingreso, egreso y traslado está bloqueada porque el UUID ${params.uuid} se encuentra con estatus PAGADO sin CFDI de pago vinculado y con fecha límite vencida (${formatDueDate(params.dueDate)}). Sube el complemento de pago para regularizar tu acceso.`
}

function getProviderKey(organizationId: string, providerRfc: string) {
  return `${organizationId}::${normalizeRfc(providerRfc)}`
}

function extractRelatedUuidSet(records: ProviderPaymentLinkRecord[], candidateUuids: Set<string>) {
  const relatedUuids = new Set<string>()

  records.forEach(record => {
    const paymentLinks = Array.isArray(record.payment_links_json)
      ? record.payment_links_json as ProviderPaymentLinkJson[]
      : []

    paymentLinks.forEach(link => {
      const relatedUuid = normalizeUuid(link.relatedUuid)

      if (relatedUuid && candidateUuids.has(relatedUuid)) {
        relatedUuids.add(relatedUuid)
      }
    })
  })

  return relatedUuids
}

async function listProviderPaymentComplianceCandidates(filters?: {
  organizationId?: string
  providerRfc?: string
}) {
  return prisma.$queryRaw<ProviderPaymentComplianceCandidate[]>(
    Prisma.sql`
      SELECT
        id,
        organization_id,
        member_id,
        provider_rfc,
        uuid,
        file_name,
        payment_complement_due_date
      FROM provider_uploaded_cfdis
      WHERE validation_status = 'APPROVED'
        AND cfdi_type IN ('I', 'E', 'T')
        AND payment_status_manual = 'PAGADO'
        AND payment_complement_due_date IS NOT NULL
        AND payment_complement_due_date <= NOW()
        ${filters?.organizationId ? Prisma.sql`AND organization_id = ${filters.organizationId}` : Prisma.empty}
        ${filters?.providerRfc ? Prisma.sql`AND provider_rfc = ${normalizeRfc(filters.providerRfc)}` : Prisma.empty}
    `
  )
}

async function listRelevantPaymentLinkRecords(candidates: ProviderPaymentComplianceCandidate[]) {
  if (candidates.length === 0) {
    return []
  }

  const organizationIds = Array.from(new Set(candidates.map(candidate => candidate.organization_id)))
  const providerRfcs = Array.from(new Set(candidates.map(candidate => normalizeRfc(candidate.provider_rfc))))

  return prisma.$queryRaw<ProviderPaymentLinkRecord[]>(
    Prisma.sql`
      SELECT organization_id, provider_rfc, payment_links_json
      FROM provider_uploaded_cfdis
      WHERE validation_status = 'APPROVED'
        AND cfdi_type = 'P'
        AND organization_id IN (${Prisma.join(organizationIds)})
        AND provider_rfc IN (${Prisma.join(providerRfcs)})
    `
  )
}

async function listProviderMembersForCompliance(filters?: {
  organizationId?: string
  providerRfc?: string
}) {
  return prisma.member.findMany({
    where: {
      status: 'APPROVED',
      providerRfc: {
        not: null
      },
      ...(filters?.organizationId ? { organizationId: filters.organizationId } : {}),
      ...(filters?.providerRfc ? { providerRfc: normalizeRfc(filters.providerRfc) } : {})
    },
    select: {
      id: true,
      organizationId: true,
      providerRfc: true,
      providerUploadBlockedAt: true,
      providerUploadBlockedBySystem: true,
      providerUploadBlockedReason: true,
      user: {
        select: {
          email: true
        }
      }
    }
  })
}

export async function syncProviderPaymentComplianceBlocks(filters?: {
  organizationId?: string
  providerRfc?: string
}) {
  const candidates = await listProviderPaymentComplianceCandidates(filters)
  const candidateUuids = new Set(candidates.map(candidate => normalizeUuid(candidate.uuid)))
  const paymentLinkRecords = await listRelevantPaymentLinkRecords(candidates)
  const resolvedRepUuids = extractRelatedUuidSet(paymentLinkRecords, candidateUuids)
  const overdueInvoices = candidates.filter(candidate => !resolvedRepUuids.has(normalizeUuid(candidate.uuid)))
  const earliestOverdueInvoiceByProviderKey = new Map<string, ProviderPaymentComplianceCandidate>()
  const reasonByProviderKey = new Map<string, string>()

  overdueInvoices.forEach(candidate => {
    const providerKey = getProviderKey(candidate.organization_id, candidate.provider_rfc)
    const currentCandidate = earliestOverdueInvoiceByProviderKey.get(providerKey)

    if (
      !currentCandidate
      || new Date(candidate.payment_complement_due_date || 0).getTime() < new Date(currentCandidate.payment_complement_due_date || 0).getTime()
    ) {
      earliestOverdueInvoiceByProviderKey.set(providerKey, candidate)
    }
  })

  earliestOverdueInvoiceByProviderKey.forEach((candidate, providerKey) => {
    reasonByProviderKey.set(providerKey, buildProviderUploadBlockedMessage({
      uuid: normalizeUuid(candidate.uuid),
      dueDate: candidate.payment_complement_due_date
    }))
  })

  const members = await listProviderMembersForCompliance(filters)
  const blockedMemberIds: string[] = []
  const unblockedMemberIds: string[] = []

  for (const member of members) {
    const providerRfc = normalizeRfc(member.providerRfc)

    if (!providerRfc) {
      continue
    }

    const providerKey = getProviderKey(member.organizationId, providerRfc)
    const reason = reasonByProviderKey.get(providerKey)

    if (reason) {
      const shouldUpdate =
        !member.providerUploadBlockedBySystem
        || member.providerUploadBlockedReason !== reason

      if (!shouldUpdate) {
        continue
      }

      await prisma.member.update({
        where: { id: member.id },
        data: {
          providerUploadBlockedBySystem: true,
          providerUploadBlockedAt: member.providerUploadBlockedAt || new Date(),
          providerUploadBlockedReason: reason
        }
      })

      blockedMemberIds.push(member.id)

      await createAuditEntry({
        tableName: 'members',
        recordId: member.id,
        action: 'UPDATE',
        userId: 'system:provider-payment-compliance',
        userEmail: member.user.email || 'system@local',
        description: `Bloqueo automatico de carga para proveedor ${providerRfc} por CFDI pagado sin REP vencido.`,
        newValues: {
          providerUploadBlockedBySystem: true,
          providerUploadBlockedReason: reason
        },
        oldValues: {
          providerUploadBlockedBySystem: member.providerUploadBlockedBySystem,
          providerUploadBlockedReason: member.providerUploadBlockedReason
        }
      })

      continue
    }

    if (!member.providerUploadBlockedBySystem) {
      continue
    }

    await prisma.member.update({
      where: { id: member.id },
      data: {
        providerUploadBlockedBySystem: false,
        providerUploadBlockedAt: null,
        providerUploadBlockedReason: null
      }
    })

    unblockedMemberIds.push(member.id)

    await createAuditEntry({
      tableName: 'members',
      recordId: member.id,
      action: 'UPDATE',
      userId: 'system:provider-payment-compliance',
      userEmail: member.user.email || 'system@local',
      description: `Desbloqueo automatico de carga para proveedor ${providerRfc} al regularizar CFDI de pago vencido.`,
      newValues: {
        providerUploadBlockedBySystem: false,
        providerUploadBlockedReason: null
      },
      oldValues: {
        providerUploadBlockedBySystem: member.providerUploadBlockedBySystem,
        providerUploadBlockedReason: member.providerUploadBlockedReason
      }
    })
  }

  return {
    scannedCandidates: candidates.length,
    overdueInvoices: overdueInvoices.length,
    blockedMembers: blockedMemberIds.length,
    unblockedMembers: unblockedMemberIds.length
  }
}
