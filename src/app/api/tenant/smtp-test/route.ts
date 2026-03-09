import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import net from 'net'
import tls from 'tls'

async function smtpProbe({ host, port, secure, timeoutMs = 8000, ehloDomain = 'platfi.local' }: { host: string; port: number; secure?: boolean; timeoutMs?: number; ehloDomain?: string }) {
  return new Promise<{ ok: boolean; message: string }>((resolve) => {
    let socket: net.Socket | tls.TLSSocket | null = null
    const onError = (err?: Error) => {
      try { socket?.destroy() } catch {}
      resolve({ ok: false, message: err?.message || 'Error de conexión SMTP' })
    }
    const onTimeout = () => onError(new Error('Tiempo de espera agotado'))

    try {
      socket = secure ? tls.connect({ host, port, rejectUnauthorized: false }) : net.createConnection({ host, port })
      socket.setTimeout(timeoutMs)
      let buffer = ''

      socket.once('timeout', onTimeout)
      socket.once('error', onError)
      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8')
        if (buffer.includes('\n')) {
          const lines = buffer.split(/\r?\n/) .filter(Boolean)
          const first = lines[0] || ''
          if (first.startsWith('220')) {
            socket?.write(`EHLO ${ehloDomain}\r\n`)
          }
          if (lines.some(l => l.startsWith('250'))) {
            try { socket?.end() } catch {}
            resolve({ ok: true, message: 'Conexión SMTP exitosa' })
          }
        }
      })
    } catch (e) {
      onError(e as Error)
    }
  })
}

export async function POST() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const membership = await prisma.member.findFirst({
      where: { userId: session.user.id, status: 'APPROVED' },
      include: { organization: true }
    })

    if (!membership?.organization) {
      return NextResponse.json({ error: 'No se encontró el tenant' }, { status: 404 })
    }

    const isOwner = membership.organization.ownerId === session.user.id
    const isAdmin = membership.role === 'ADMIN'
    if (!isOwner && !isAdmin) {
      return NextResponse.json({ error: 'Sin permisos para probar SMTP' }, { status: 403 })
    }

    const settings = (membership.organization.systemSettings as unknown as { smtp?: { host?: string; port?: number; secure?: boolean } }) || {}
    const smtp = settings.smtp || {}
    const host = smtp.host
    const port = smtp.port || (smtp.secure ? 465 : 25)
    const secure = !!smtp.secure

    if (!host || !port) {
      return NextResponse.json({ error: 'Configura host y puerto SMTP antes de probar' }, { status: 400 })
    }

    const probe = await smtpProbe({ host, port, secure })
    if (!probe.ok) {
      return NextResponse.json({ success: false, message: probe.message }, { status: 502 })
    }

    return NextResponse.json({ success: true, message: probe.message })
  } catch (error) {
    console.error('SMTP test error:', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
