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
