import { NextRequest, NextResponse } from 'next/server'
import { SystemRole } from '@prisma/client'
import { auth } from '@/lib/auth'
import { Permission, enrichUserWithMemberships, hasPermission } from '@/lib/permissions'
import { SAT_SECURITY_HEADERS, safeErrSummarySat } from '@/lib/sat-gate-helpers'
import { rateLimit, RateLimitError } from '@/lib/rate-limit'
import { getPrimaryApprovedMembership, __tenantGetIpFromNextRequest } from '@/lib/tenant'
import { z } from 'zod'
import net from 'net'
import tls from 'tls'
import { promises as dns } from 'dns'

const BLOCKED_NETS_RE = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^127\./,
  /^169\.254\./,
  /^\[?(::1|fe80:|fc|fd|0\.)/i,
]

const FQDN_PUBLIC_RE = /^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/

const ALLOWED_SMTP_PORTS = new Set([25, 465, 587, 2525, 2526])

const smtpTestSettingsSchema = z.object({
  host: z.string().trim().min(1).max(253),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean().optional().default(false),
  timeoutMs: z.number().int().min(1000).max(30000).optional().default(8000),
  ehloDomain: z.string().trim().min(1).max(253).optional().default('platfi.local'),
})

type SmtpTestSettings = z.infer<typeof smtpTestSettingsSchema>

function ipIsBlocked(ip: string): boolean {
  return BLOCKED_NETS_RE.some(re => re.test(ip))
}

async function dnsLookupSafe(host: string): Promise<string[]> {
  try {
    const [v4, v6] = await Promise.all([
      dns.resolve4(host).catch(() => [] as string[]),
      dns.resolve6(host).catch(() => [] as string[]),
    ])
    const all = [...v4, ...v6]
    if (all.length === 0) {
      throw new Error('No se pudo resolver el host DNS')
    }
    for (const ip of all) {
      if (ipIsBlocked(ip)) {
        throw new Error('Host resuelto a IP interna/privada bloqueada (SSRF guard)')
      }
    }
    return all
  } catch (e) {
    if (e instanceof Error && /SSRF|interna|privada/i.test(e.message)) throw e
    throw new Error('Error resolviendo DNS del host SMTP')
  }
}

async function smtpProbe(settings: SmtpTestSettings) {
  const { host, port, secure, timeoutMs, ehloDomain } = settings
  return new Promise<{ ok: boolean; message: string }>((resolve) => {
    let socket: net.Socket | tls.TLSSocket | null = null
    const onError = (err?: Error) => {
      try { socket?.destroy() } catch {}
      resolve({ ok: false, message: err?.message || 'Error de conexión SMTP' })
    }
    const onTimeout = () => onError(new Error('Tiempo de espera agotado'))

    try {
      if (secure) {
        socket = tls.connect({
          host,
          port,
          rejectUnauthorized: true,
          timeout: timeoutMs,
          servername: host,
        })
      } else {
        socket = net.createConnection({ host, port })
        socket.setTimeout(timeoutMs)
      }
      let buffer = ''
      let ehloSent = false

      socket.once('timeout', onTimeout)
      socket.once('error', onError)
      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8')
        if (buffer.includes('\n')) {
          const lines = buffer.split(/\r?\n/).filter(Boolean)
          const first = lines[0] || ''
          if (!ehloSent && first.startsWith('220')) {
            ehloSent = true
            try { socket?.write(`EHLO ${ehloDomain}\r\n`) } catch {}
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

export async function POST(request: NextRequest) {
  const headers = {
    ...SAT_SECURITY_HEADERS,
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    'Pragma': 'no-cache',
  } as Record<string, string>

  try {
    const clientIp = __tenantGetIpFromNextRequest(request)
    const rlIp = await rateLimit(`tenant:smtp-test:ip:${clientIp}`, { interval: 60_000, limit: 10, silent: true })
    if (!rlIp.success) {
      const retrySec = Math.ceil(rlIp.retryAfterMs / 1000)
      return NextResponse.json(
        { error: `Demasiadas solicitudes. Intenta nuevamente en ${retrySec}s.` },
        { status: 429, headers: { ...headers, 'Retry-After': String(retrySec) } }
      )
    }

    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers })
    }

    const rlUser = await rateLimit(`tenant:smtp-test:user:${session.user.id}`, { interval: 60_000, limit: 15, silent: true })
    if (!rlUser.success) {
      const retrySec = Math.ceil(rlUser.retryAfterMs / 1000)
      return NextResponse.json(
        { error: `Demasiadas solicitudes. Intenta nuevamente en ${retrySec}s.` },
        { status: 429, headers: { ...headers, 'Retry-After': String(retrySec) } }
      )
    }

    const primaryMembership = await getPrimaryApprovedMembership(session.user.id)
    if (!primaryMembership?.organization) {
      return NextResponse.json({ error: 'No se encontró el tenant' }, { status: 404, headers })
    }
    const { organizationId, organization } = primaryMembership

    const rlOrg = await rateLimit(`tenant:smtp-test:org:${organizationId}`, { interval: 60_000, limit: 30, silent: true })
    if (!rlOrg.success) {
      const retrySec = Math.ceil(rlOrg.retryAfterMs / 1000)
      return NextResponse.json(
        { error: `Demasiadas solicitudes. Intenta nuevamente en ${retrySec}s.` },
        { status: 429, headers: { ...headers, 'Retry-After': String(retrySec) } }
      )
    }

    const enrichedUser = await enrichUserWithMemberships({
      id: session.user.id,
      systemRole: ((session.user as { systemRole?: string }).systemRole as SystemRole) || SystemRole.USER
    })
    if (!hasPermission(enrichedUser, Permission.TENANT_MANAGE, organizationId)) {
      const isOwner = organization.ownerId === session.user.id
      const isAdmin = primaryMembership.role === 'ADMIN'
      if (!isOwner && !isAdmin) {
        return NextResponse.json({ error: 'Sin permisos para probar SMTP' }, { status: 403, headers })
      }
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      body = null
    }

    let validated: SmtpTestSettings

    if (body && typeof body === 'object') {
      const parsed = smtpTestSettingsSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Configuración SMTP inválida', details: parsed.error.issues },
          { status: 400, headers }
        )
      }
      validated = parsed.data
    } else {
      const settings = (organization.systemSettings as unknown as { smtp?: { host?: string; port?: number; secure?: boolean; timeoutMs?: number; ehloDomain?: string } }) || {}
      const smtp = settings.smtp || {}
      const candidate = {
        host: String(smtp.host ?? '').trim(),
        port: Number(smtp.port) || (smtp.secure ? 465 : 25),
        secure: !!smtp.secure,
        timeoutMs: smtp.timeoutMs,
        ehloDomain: smtp.ehloDomain,
      }
      const parsed = smtpTestSettingsSchema.safeParse(candidate)
      if (!parsed.success) {
        return NextResponse.json({ error: 'Configura host y puerto SMTP antes de probar' }, { status: 400, headers })
      }
      validated = parsed.data
    }
    const { host, port } = validated

    if (!ALLOWED_SMTP_PORTS.has(port)) {
      return NextResponse.json(
        { error: `Puerto SMTP no permitido. Usa uno de: ${[...ALLOWED_SMTP_PORTS].join(', ')}` },
        { status: 400, headers }
      )
    }

    const looksLikeIp = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) || /^\[?[0-9a-fA-F:]+$/.test(host)
    if (looksLikeIp) {
      if (ipIsBlocked(host)) {
        return NextResponse.json({ error: 'Host IP interna/privada bloqueada' }, { status: 400, headers })
      }
    } else {
      if (!FQDN_PUBLIC_RE.test(host)) {
        return NextResponse.json({ error: 'Host debe ser un FQDN público válido' }, { status: 400, headers })
      }
      await dnsLookupSafe(host)
    }

    const probe = await smtpProbe(validated)
    if (!probe.ok) {
      return NextResponse.json({ success: false, message: probe.message }, { status: 502, headers })
    }

    return NextResponse.json({ success: true, message: probe.message }, { headers })
  } catch (error) {
    if (error instanceof RateLimitError) {
      const retrySec = Math.ceil(error.retryAfterMs / 1000)
      return NextResponse.json(
        { error: error.message },
        { status: 429, headers: { ...headers, 'Retry-After': String(retrySec) } }
      )
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Configuración SMTP inválida', details: error.issues },
        { status: 400, headers }
      )
    }
    const safe = safeErrSummarySat(error)
    console.error(`[SMTP-TEST] ${safe.name}:`, safe.message, 'fp=', safe.incidentFingerprint)
    return NextResponse.json(
      { error: safe.message, incidentFingerprint: safe.incidentFingerprint },
      { status: 500, headers }
    )
  }
}
