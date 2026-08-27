import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAuditEntry } from '@/lib/audit'
import { sendProviderPaymentReminderEmail } from '@/lib/mail'
import { syncProviderPaymentComplianceBlocks } from '@/lib/provider-payment-compliance'
import { rateLimit } from '@/lib/rate-limit'
import { getM2MRateLimitConfig, getM2MRateLimitHeaders } from '@/lib/m2m-rate-limit'
import { withMachineScope } from '@/lib/m2m-route'
import { PAYMENTS_UPDATE_SCOPE } from '@/lib/provider-payment-update'
import { prisma } from '@/lib/prisma'
import { updateProviderPaymentStatus } from '@/lib/provider-cfdi-storage'
import type { ProviderPaymentStatusValue } from '@/lib/provider-cfdi-storage'
import { safeErrSummary } from '@/lib/security'
import {
  ExternalProviderPaymentUpdateSchema,
  sanitizeZodIssues,
  MAX_EXTERNAL_PAYLOAD_BYTES
} from '@/schemas/external'

export const runtime = 'nodejs'

function getRequestIp(request: NextRequest) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || null
}

const MAX_PAYMENT_PREPARSE_BYTES = Math.ceil(MAX_EXTERNAL_PAYLOAD_BYTES * 1.35)

async function getProviderPaymentReminderRecipient(recordId: string) {
  const record = await prisma.providerUploadedCfdi.findUnique({
    where: { id: recordId },
    select: {
      organizationId: true,
      fileName: true,
      uuid: true,
      total: true,
      issuanceDate: true,
      issuerRfc: true,
      issuerName: true,
      receiverRfc: true,
      providerName: true,
      providerRfc: true,
      uploadedByUser: {
        select: {
          email: true,
          name: true
        }
      },
      member: {
        select: {
          providerName: true,
          user: {
            select: {
              email: true,
              name: true
            }
          }
        }
      }
    }
  })

  if (!record) {
    return null
  }

  const recipientEmail = record.uploadedByUser?.email || record.member.user.email

  if (!recipientEmail) {
    return null
  }

  return {
    to: recipientEmail,
    recipientName: record.providerName || record.member.providerName || record.uploadedByUser?.name || record.member.user.name || record.issuerName || 'Proveedor',
    organizationId: record.organizationId,
    providerRfc: record.providerRfc,
    fileName: record.fileName,
    emisorRfc: record.issuerRfc,
    receptorRfc: record.receiverRfc,
    uuid: record.uuid,
    total: String(record.total),
    fechaEmision: record.issuanceDate?.toISOString() || '',
  }
}

// EXT-002 · sanitizeZodIssues
// EXT-008 · safeErrSummary NO PII logs
export const PATCH = withMachineScope(PAYMENTS_UPDATE_SCOPE, async (request: NextRequest, authContext) => {
  try {
    const contentLengthRaw = request.headers.get('content-length')
    const contentLength = contentLengthRaw ? Number(contentLengthRaw) : NaN
    if (Number.isFinite(contentLength) && contentLength > MAX_PAYMENT_PREPARSE_BYTES) {
      return NextResponse.json(
        { error: 'El payload excede el tamaño máximo permitido.' },
        { status: 413 }
      )
    }

    const limiter = await rateLimit(
      `m2m:payments:update:${authContext.clientId}`,
      getM2MRateLimitConfig()
    )

    if (!limiter.success) {
      return NextResponse.json(
        { error: 'Demasiadas peticiones para este cliente' },
        {
          status: 429,
          headers: getM2MRateLimitHeaders(limiter)
        }
      )
    }

    const rawBody = await request.json()
    const payload = ExternalProviderPaymentUpdateSchema.parse(rawBody)

    const result = await updateProviderPaymentStatus({
      organizationId: authContext.organizationId,
      uuid: payload.uuid,
      paymentStatus: payload.estatus_pago as ProviderPaymentStatusValue,
      paymentDate: payload.fecha_pago ? new Date(payload.fecha_pago) : null,
      sourceClientId: authContext.clientId
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    await createAuditEntry({
      tableName: 'provider_uploaded_cfdis',
      recordId: result.recordId,
      action: 'UPDATE',
      userId: `m2m:${authContext.clientId}`,
      userEmail: `m2m:${authContext.clientId}`,
      description: `Actualización M2M de estatus de pago para UUID ${result.uuid}`,
      ipAddress: getRequestIp(request),
      userAgent: request.headers.get('user-agent'),
      newValues: {
        uuid: result.uuid,
        estatusPago: result.currentStatus,
        fechaPago: result.currentPaymentDate,
        sourceClientId: authContext.clientId
      },
      oldValues: {
        estatusPago: result.previousStatus,
        fechaPago: result.previousPaymentDate
      }
    })

    const reminderRecipient = await getProviderPaymentReminderRecipient(result.recordId)

    if (
      result.currentStatus === 'PAGADO'
      && result.previousStatus !== 'PAGADO'
      && result.currentPaymentDate
    ) {
      try {
        if (reminderRecipient) {
          const emailResult = await sendProviderPaymentReminderEmail({
            ...reminderRecipient,
            fechaPago: result.currentPaymentDate
          })

          if (!emailResult.success) {
            const sum = safeErrSummary(new Error(String(result.uuid)))
            const hash = 'msgHash' in sum ? (sum as { msgHash?: string }).msgHash : undefined
            console.warn('[EXT-PAYMENTS] Email reminder failed for UUID (hash):', hash || 'unknown')
          }
        }
      } catch (reminderError) {
        // EXT-008 · safeErrSummary NO UUID/RFC/email raw en logs
        console.error('[EXT-PAYMENTS] Reminder preparation failed:', safeErrSummary(reminderError))
      }
    }

    if (reminderRecipient?.providerRfc) {
      try {
        await syncProviderPaymentComplianceBlocks({
          organizationId: reminderRecipient.organizationId,
          providerRfc: reminderRecipient.providerRfc
        })
      } catch (complianceError) {
        console.error('[EXT-PAYMENTS] Compliance sync failed:', safeErrSummary(complianceError))
      }
    }

    return NextResponse.json({
      success: true,
      uuid: result.uuid,
      estatus_pago: result.currentStatus,
      fecha_pago: result.currentPaymentDate || null,
      automatic_status_snapshot: result.automaticStatus
    })
  } catch (error) {
    console.error('[EXT-PAYMENTS] Handler failed:', safeErrSummary(error))

    // EXT-002 · sanitizeZodIssues whitelist fields
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: 'Datos inválidos',
          details: sanitizeZodIssues(error.issues)
        },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
})
