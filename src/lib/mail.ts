import nodemailer from 'nodemailer'
import { prisma } from '@/lib/prisma'

let testAccount: nodemailer.TestAccount | null = null
let transporter: nodemailer.Transporter | null = null

// Interfaz para la configuración SMTP guardada en la base de datos
interface SmtpSettings {
  host?: string
  port?: number
  secure?: boolean
  user?: string
  pass?: string
  fromEmail?: string
  fromName?: string
}

// Inicializa el transportador de correo basándose en la configuración de la organización.
// Si la organización no tiene configurado el SMTP, usa Ethereal Email como fallback para desarrollo.
async function getTransporter(organizationId: string): Promise<{ t: nodemailer.Transporter; sender: string }> {
  try {
    // 1. Intentar obtener la configuración de la BD
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { systemSettings: true }
    })

    const settings = (org?.systemSettings as unknown as { smtp?: SmtpSettings }) || {}
    const smtp = settings.smtp

    if (smtp && smtp.host && smtp.port && smtp.user && smtp.pass) {
      const dbTransporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure ?? (smtp.port === 465),
        auth: {
          user: smtp.user,
          pass: smtp.pass,
        },
      })
      
      const sender = smtp.fromEmail 
        ? (smtp.fromName ? `"${smtp.fromName}" <${smtp.fromEmail}>` : smtp.fromEmail)
        : smtp.user

      return { t: dbTransporter, sender }
    }
  } catch (error) {
    console.error('Error al obtener la configuración SMTP de la BD:', error)
  }

  // 2. Si no hay configuración en la BD, usamos variables de entorno (Fallback 1)
  if (process.env.SMTP_HOST) {
    if (!transporter) {
      transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_PORT === '465',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      })
    }
    const sender = process.env.SMTP_USER || 'no-reply@plataforma.com'
    return { t: transporter, sender }
  }

  // 3. Si no hay nada, creamos cuenta de prueba en Ethereal (Fallback 2)
  console.log('No se encontró configuración SMTP. Creando cuenta de prueba en Ethereal Email...')
  if (!testAccount) {
    testAccount = await nodemailer.createTestAccount()
    transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    })
  }
  return { t: transporter!, sender: testAccount!.user }
}

interface SendInvitationEmailParams {
  to: string
  name: string
  invitationToken: string
  organizationName: string
  organizationId: string
  isProvider?: boolean
}

interface SendProviderXmlValidationEmailParams {
  to: string
  recipientName: string
  organizationId: string
  fileName: string
  emisorRfc: string
  receptorRfc: string
  uuid: string
  total: string
  fechaEmision: string
  fechaCarga: string
  validationAnexo20: string
  validationSat: string
  status: 'APPROVED' | 'REJECTED'
  rejectionReason?: string
}

interface SendProviderPaymentReminderEmailParams {
  to: string
  recipientName: string
  organizationId: string
  fileName: string
  emisorRfc: string
  receptorRfc: string
  uuid: string
  total: string
  fechaEmision: string
  fechaPago: string
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatUtcDate(value: string) {
  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    return value || 'Sin dato'
  }

  return parsed.toLocaleDateString('es-MX', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  })
}

function getProviderPaymentReminderDeadline(value: string) {
  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    return 'el día 5 del mes posterior al pago'
  }

  const deadline = new Date(Date.UTC(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth() + 1,
    5
  ))

  return formatUtcDate(deadline.toISOString())
}

export async function sendInvitationEmail({
  to,
  name,
  invitationToken,
  organizationName,
  organizationId,
  isProvider
}: SendInvitationEmailParams) {
  try {
    const { t, sender } = await getTransporter(organizationId)
    const inviteLink = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/auth/accept-invite?token=${invitationToken}`
    
    const info = await t.sendMail({
      from: sender,
      to,
      subject: `Invitación para unirte a ${organizationName}`,
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px;">
          <h2 style="color: #2563eb; margin-top: 0;">¡Hola ${name}!</h2>
          <p>${isProvider ? `Has sido invitado para unirte como proveedor a la organización <strong>${organizationName}</strong> en nuestra plataforma.` : `Has sido invitado para unirte a la organización <strong>${organizationName}</strong> en nuestra plataforma.`}</p>
          <p>Para aceptar la invitación y configurar tu cuenta, por favor haz clic en el siguiente botón:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${inviteLink}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: #fff; font-weight: bold; text-decoration: none; border-radius: 6px;">
              Aceptar Invitación
            </a>
          </div>
          <p>O copia y pega el siguiente enlace en tu navegador:</p>
          <p style="word-break: break-all; background-color: #f3f4f6; padding: 12px; border-radius: 4px; color: #4b5563; font-size: 14px;">
            <a href="${inviteLink}" style="color: #2563eb;">${inviteLink}</a>
          </p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0 20px;" />
          <p style="font-size: 12px; color: #6b7280; text-align: center;">Si no esperabas esta invitación, puedes ignorar este correo de forma segura.</p>
        </div>
      `,
    })

    console.log('\n=============================================')
    console.log('✅ Correo enviado exitosamente')
    console.log(`Para: ${to}`)
    
    // Si estamos usando la cuenta de prueba (Ethereal), generamos el link para ver el correo
    if (!process.env.SMTP_HOST) {
      console.log('🌐 URL PARA VER EL CORREO DE PRUEBA:')
      console.log(nodemailer.getTestMessageUrl(info))
    }
    console.log('=============================================\n')

    return { success: true, messageId: info.messageId }
  } catch (error) {
    console.error('\n❌ Error enviando el correo:', error)
    return { success: false, error }
  }
}

export async function sendProviderXmlValidationEmail({
  to,
  recipientName,
  organizationId,
  fileName,
  emisorRfc,
  receptorRfc,
  uuid,
  total,
  fechaEmision,
  fechaCarga,
  validationAnexo20,
  validationSat,
  status,
  rejectionReason
}: SendProviderXmlValidationEmailParams) {
  try {
    const { t, sender } = await getTransporter(organizationId)
    const statusLabel = status === 'APPROVED' ? 'Aprobado' : 'Rechazado'
    const statusColor = status === 'APPROVED' ? '#16a34a' : '#dc2626'
    const safeRejectionReason = rejectionReason ? escapeHtml(rejectionReason).replace(/\n/g, '<br />') : ''

    const info = await t.sendMail({
      from: sender,
      to,
      subject: `Resultado de validacion CFDI proveedor: ${statusLabel}`,
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; max-width: 720px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px;">
          <h2 style="color: ${statusColor}; margin-top: 0;">Hola ${escapeHtml(recipientName || 'Proveedor')}</h2>
          <p>Te compartimos el resultado de la validación del XML cargado en la plataforma.</p>
          <div style="margin: 20px 0; padding: 14px 16px; border-radius: 8px; background-color: ${status === 'APPROVED' ? '#f0fdf4' : '#fef2f2'}; border: 1px solid ${status === 'APPROVED' ? '#86efac' : '#fecaca'};">
            <strong style="color: ${statusColor};">Resultado general: ${statusLabel}</strong>
          </div>
          <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
            <tbody>
              <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Archivo</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(fileName || 'Sin dato')}</td></tr>
              <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">RFC Emisor</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(emisorRfc || 'Sin dato')}</td></tr>
              <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">RFC Receptor</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(receptorRfc || 'Sin dato')}</td></tr>
              <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">UUID</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(uuid || 'Sin dato')}</td></tr>
              <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Total</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(total || 'Sin dato')}</td></tr>
              <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Fecha de emisión</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(fechaEmision || 'Sin dato')}</td></tr>
              <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Fecha de carga</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(fechaCarga || 'Sin dato')}</td></tr>
              <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Validación estructura Anexo 20</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(validationAnexo20 || 'Sin dato')}</td></tr>
              <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Validación Estatus SAT</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(validationSat || 'Sin dato')}</td></tr>
            </tbody>
          </table>
          ${safeRejectionReason ? `
            <div style="margin-top: 24px; padding: 14px 16px; border-radius: 8px; background-color: #fef2f2; border: 1px solid #fecaca;">
              <strong style="display: block; color: #b91c1c; margin-bottom: 8px;">Motivo de rechazo</strong>
              <div style="color: #7f1d1d; line-height: 1.5;">${safeRejectionReason}</div>
            </div>
          ` : ''}
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0 20px;" />
          <p style="font-size: 12px; color: #6b7280; text-align: center;">Este correo fue generado automáticamente por la plataforma con el resultado de validación del CFDI cargado.</p>
        </div>
      `,
    })

    console.log('\n=============================================')
    console.log('✅ Correo de validacion XML enviado exitosamente')
    console.log(`Para: ${to}`)
    if (!process.env.SMTP_HOST) {
      console.log('🌐 URL PARA VER EL CORREO DE PRUEBA:')
      console.log(nodemailer.getTestMessageUrl(info))
    }
    console.log('=============================================\n')

    return { success: true, messageId: info.messageId }
  } catch (error) {
    console.error('\n❌ Error enviando el correo de validacion XML:', error)
    return { success: false, error }
  }
}

export async function sendProviderPaymentReminderEmail({
  to,
  recipientName,
  organizationId,
  fileName,
  emisorRfc,
  receptorRfc,
  uuid,
  total,
  fechaEmision,
  fechaPago
}: SendProviderPaymentReminderEmailParams) {
  try {
    const { t, sender } = await getTransporter(organizationId)
    const paymentDeadline = getProviderPaymentReminderDeadline(fechaPago)

    const info = await t.sendMail({
      from: sender,
      to,
      subject: `Recordatorio CFDI de pago requerido para UUID ${uuid}`,
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; max-width: 720px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px;">
          <h2 style="color: #2563eb; margin-top: 0;">Hola ${escapeHtml(recipientName || 'Proveedor')}</h2>
          <p>Te informamos que el estatus de pago de tu CFDI fue actualizado a <strong>PAGADO</strong> en la plataforma.</p>
          <div style="margin: 20px 0; padding: 14px 16px; border-radius: 8px; background-color: #eff6ff; border: 1px solid #bfdbfe;">
            <strong style="color: #1d4ed8;">Acción requerida:</strong>
            <div style="margin-top: 8px; color: #1e3a8a; line-height: 1.6;">
              Debes cargar tu CFDI de pago a mas tardar el <strong>${escapeHtml(paymentDeadline)}</strong>, correspondiente al mes posterior al pago registrado.
            </div>
          </div>
          <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
            <tbody>
              <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Archivo</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(fileName || 'Sin dato')}</td></tr>
              <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">RFC Emisor</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(emisorRfc || 'Sin dato')}</td></tr>
              <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">RFC Receptor</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(receptorRfc || 'Sin dato')}</td></tr>
              <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">UUID</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(uuid || 'Sin dato')}</td></tr>
              <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Total</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(total || 'Sin dato')}</td></tr>
              <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Fecha de emision</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(formatUtcDate(fechaEmision))}</td></tr>
              <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Fecha de pago</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(formatUtcDate(fechaPago))}</td></tr>
              <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Fecha limite sugerida</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(paymentDeadline)}</td></tr>
            </tbody>
          </table>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0 20px;" />
          <p style="font-size: 12px; color: #6b7280; text-align: center;">Este correo fue generado automaticamente por la plataforma como recordatorio para la carga del CFDI de pago.</p>
        </div>
      `,
    })

    console.log('\n=============================================')
    console.log('✅ Correo recordatorio de CFDI de pago enviado exitosamente')
    console.log(`Para: ${to}`)
    if (!process.env.SMTP_HOST) {
      console.log('🌐 URL PARA VER EL CORREO DE PRUEBA:')
      console.log(nodemailer.getTestMessageUrl(info))
    }
    console.log('=============================================\n')

    return { success: true, messageId: info.messageId }
  } catch (error) {
    console.error('\n❌ Error enviando el correo recordatorio de CFDI de pago:', error)
    return { success: false, error }
  }
}
