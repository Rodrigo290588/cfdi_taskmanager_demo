import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAuditEntry } from '@/lib/audit'
import { sendProviderPaymentReminderEmail } from '@/lib/mail'
import { syncProviderPaymentComplianceBlocks } from '@/lib/provider-payment-compliance'
import { rateLimit } from '@/lib/rate-limit'
import { getM2MRateLimitConfig, getM2MRateLimitHeaders } from '@/lib/m2m-rate-limit'
import { withMachineScope } from '@/lib/m2m-route'
import { providerPaymentUpdateSchema, PAYMENTS_UPDATE_SCOPE } from '@/lib/provider-payment-update'
import { prisma } from '@/lib/prisma'
import { updateProviderPaymentStatus } from '@/lib/provider-cfdi-storage'

export const runtime = 'nodejs'

function getRequestIp(request: NextRequest) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || null
}

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

export const PATCH = withMachineScope(PAYMENTS_UPDATE_SCOPE, async (request: NextRequest, authContext) => {
  try {
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

    const payload = providerPaymentUpdateSchema.parse(await request.json())
    const result = await updateProviderPaymentStatus({
      organizationId: authContext.organizationId,
      uuid: payload.uuid,
      paymentStatus: payload.estatus_pago,
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
            console.error('No fue posible enviar el recordatorio de CFDI de pago para UUID', result.uuid)
          }
        } else {
          console.warn('No se encontró correo destinatario para recordatorio de CFDI de pago del UUID', result.uuid)
        }
      } catch (reminderError) {
        console.error('Error preparando el recordatorio de CFDI de pago:', reminderError)
      }
    }

    if (reminderRecipient?.providerRfc) {
      try {
        await syncProviderPaymentComplianceBlocks({
          organizationId: reminderRecipient.organizationId,
          providerRfc: reminderRecipient.providerRfc
        })
      } catch (complianceError) {
        console.error('No fue posible sincronizar el bloqueo del proveedor tras actualizar el estatus de pago:', complianceError)
      }
    }

    return NextResponse.json({
      success: true,
      organizationId: authContext.organizationId,
      uuid: result.uuid,
      estatus_pago: result.currentStatus,
      fecha_pago: result.currentPaymentDate || null,
      automatic_status_snapshot: result.automaticStatus
    })
  } catch (error) {
    console.error('Error en endpoint externo de actualización de pagos:', error)

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: 'Datos inválidos',
          details: error.issues.map(issue => ({
            field: issue.path.join('.'),
            message: issue.message
          }))
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
