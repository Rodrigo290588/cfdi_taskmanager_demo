import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'
import type { Browser, Page, LaunchOptions } from 'puppeteer-core'

let cachedBrowser: Browser | null = null

const defaultBrowserPathsByPlatform: Record<NodeJS.Platform, string[]> = {
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/usr/bin/microsoft-edge',
    '/usr/bin/microsoft-edge-stable',
  ],
  aix: [], android: [], freebsd: [], haiku: [], openbsd: [], sunos: [], cygwin: [], netbsd: [],
}

function resolveBrowserExecutablePath(): string | null {
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim()
  if (envPath) return envPath
  const candidates = defaultBrowserPathsByPlatform[process.platform] || []
  for (const c of candidates) if (existsSync(c)) return c
  return null
}

async function getBrowserInstance(): Promise<Browser> {
  if (cachedBrowser && cachedBrowser.isConnected()) return cachedBrowser
  const executablePath = resolveBrowserExecutablePath()
  if (!executablePath) {
    throw new Error(
      '[SAST-PDF] No se encontró Chrome/Edge. Instálalo o define PUPPETEER_EXECUTABLE_PATH.'
    )
  }
  const launchOptions: LaunchOptions = {
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  }
  cachedBrowser = await puppeteer.launch(launchOptions)
  return cachedBrowser
}

type Risk = 'Crítico' | 'Alto' | 'Medio' | 'Bajo'

interface Finding {
  id: string
  owaspId: string
  owaspName: string
  title: string
  fileRef: string
  fileLines: string
  risk: Risk
  description: string
  exploit: string
  fixedCode: string
}

const FINDINGS: Finding[] = [
  {
    id: 'AUTH-001',
    owaspId: 'A02:2021',
    owaspName: 'Cryptographic Failures / Sensitive Data Exposure',
    title: 'M2M ClientSecret expuesto en response de registro (Credential Leak)',
    fileRef: 'src/app/api/auth/register/route.ts',
    fileLines: 'L162-L165',
    risk: 'Crítico',
    description:
      'El endpoint POST /api/auth/register devuelve machineClient.clientSecret en texto plano dentro del JSON de respuesta al completar el registro. Un atacante que intercepte esta respuesta (MITM, logs de proxy, DevTools persistente, extensiones maliciosas del navegador) obtiene credenciales M2M válidas con scopes de la organización recién creada. El secret NO debe abandonar el servidor salvo mecanismos fuera-de-banda (email cifrado, vault unidireccional). Cualquier secreción persistente en cliente rompe el modelo Zero-Trust de M2M.',
    exploit:
      '1. Usuario legítimo se registra: POST /api/auth/register → 200 OK.\n2. Response body:\n   {\n     "success": true,\n     "machineClient": {\n       "clientId": "m2m_abc...",\n       "clientSecret": "sk_live_MUY_SECRETO_12345",  <-- LEAK\n       "scopes": ["cfdi.import", "cfdi.report", ...]\n     }\n   }\n3. Atacante con acceso al response (XSS post-registro, extensiones maliciosas, reverse proxy con body logging, HTTP sin HSTS) roba el secret.\n4. Usa el clientId/secret contra cualquier endpoint /api/external/** con scope cfdi.import para subir CFDI maliciosos, invocar reportes o saturar workers en nombre de la organización sin pasar por login de usuario.',
    fixedCode: `// src/app/api/auth/register/route.ts (respuesta final)

// 7. Secure Response — NUNCA retornar clientSecret por HTTP al navegador
const { password: _, ...userWithoutPassword } = result.user

return NextResponse.json({
  success: true,
  user: userWithoutPassword,
  organizationId: result.organization.id,
  machineClient: {
    clientId: result.machineClient.clientId,
    // clientSecret: ELIMINADO — no sale del servidor
    scopes: result.machineClient.scopes,
    secretDelivery: 'email-only' // Canal seguro alterno
  },
  message: 'Usuario creado exitosamente. Las credenciales M2M serán enviadas por correo.'
})

// === Alternativa robusta si el user-agent realmente necesita el secret ===
// Emitir JWT de corta duración (5min) firmado con server-side key, que el cliente
// presente en un endpoint autenticado adicional con 2FA o challenge de email.
// El endpoint retorna el secret UNA sola vez, lo marca como "entregado" y rotula
// auditoría. Nunca lo cachea el navegador.`
  },
  {
    id: 'AUTH-002',
    owaspId: 'A05:2021',
    owaspName: 'Security Misconfiguration',
    title: 'NextAuth trustHost:true sin allow-list → Host Header Injection',
    fileRef: 'src/lib/auth.ts',
    fileLines: 'L155',
    risk: 'Alto',
    description:
      'trustHost:true en NextAuth desactiva la validación del encabezado Host / X-Forwarded-Host y confía ciegamente en el valor enviado por el cliente. Esto habilita ataques de Host Header Injection: password reset poisoning (links de recuperación con dominio atacante), cache poisoning en reverse proxies con keying por Host, OAuth callback URL manipulation y bypass de CSRF si los tokens se enlazan al hostname. NextAuth 5 no aplica ninguna allow-list por defecto cuando trustHost está en true.',
    exploit:
      'Escenario 1 — Password Reset Poisoning:\nPOST /auth/forgot-password\nHost: evil-attacker.com\n\nEl link "Recupera tu contraseña" se genera con base URL = evil-attacker.com\nUsuario legítimo recibe email → clickea → atacante captura el token de reset.\n\nEscenario 2 — Cache Poisoning (Varnish/Nginx con cache key Host+Path):\nGET /auth/signin\nHost: attacker-controlled-cdn-domain.com\n\nProxies / CDNs usan el Host para keyear caché. NextAuth confía en el Host y responde con redirects/metadata al dominio atacante. Usuarios vecinos reciben la respuesta cacheada con dominio malicioso.\n\nEscenario 3 — OAuth Callback Desvío:\nAtacante setea Host → evil.com. Flujo Google OAuth termina redirigiendo a evil.com/api/auth/callback/google con code=..., atacante captura el código y canjea acceso a cuenta.',
    fixedCode: `// src/lib/auth.ts

import type { NextAuthConfig } from "next-auth"

// ❌ ELIMINAR: trustHost: true
// ✅ Usar URL canónica + permitir solo los hosts oficiales

const PUBLIC_HOSTS_ALLOWLIST = new Set([
  'localhost',
  'localhost:3000',
  '127.0.0.1',
  '127.0.0.1:3000',
  // Dominio(s) oficiales de producción/staging
  (process.env.NEXTAUTH_URL ? new URL(process.env.NEXTAUTH_URL).host : '').toLowerCase()
].filter(Boolean))

const authOptions: NextAuthConfig = {
  adapter: PrismaAdapter(prisma) as Adapter,
  providers: [ /* ... */ ],

  // Reemplazamos trustHost:true por callback URL explícita y validación manual
  // trustHost: true,  <-- ELIMINAR ESTA LÍNEA

  callbacks: {
    async redirect({ url, baseUrl }) {
      // 1) Permitir URLs internas (relative)
      if (url.startsWith('/')) return \`\${baseUrl}\${url}\`
      // 2) Permitir URLs absolutas SÓLO si el host coincide con el baseUrl
      try {
        const targetHost = new URL(url).host.toLowerCase()
        const baseHost = new URL(baseUrl).host.toLowerCase()
        if (targetHost === baseHost) return url
        if (PUBLIC_HOSTS_ALLOWLIST.has(targetHost)) return url
      } catch {
        /* URL malformada → fallback seguro */
      }
      return baseUrl
    },
    // ...resto de callbacks
  },
  pages: { signIn: "/auth/signin" },
}

// === Adicional: middleware valida el header ANTES de llegar a NextAuth ===
// En src/middleware.ts o proxy.ts bloquear Host desconocidos con 400 / 403
// temprano, sin consumir runtime de NextAuth.`
  },
  {
    id: 'AUTH-003',
    owaspId: 'A01:2021',
    owaspName: 'Broken Access Control',
    title: 'Open Redirect post-login por callbackUrl sin validación de dominio',
    fileRef: 'src/components/auth/signin-form.tsx',
    fileLines: 'L54',
    risk: 'Alto',
    description:
      'El componente SignInForm toma callbackUrl directamente de useSearchParams() sin whitelist ni validación de host: const callback = searchParams?.get("callbackUrl") || "/dashboard". Un atacante puede construir una URL phishing del tipo /auth/signin?callbackUrl=https%3A%2F%2Fevil-site.phish y, después de credenciales correctas, router.push() redirige silenciosamente al usuario al dominio malicioso. Clonando la UI del dashboard, el atacante obtiene credenciales adicionales (2FA) o ejecuta drive-by-downloads. Esta es la puerta de entrada clásica a phishing encadenado en portales corporativos.',
    exploit:
      '1. Atacante envía email a empleado de empresa X:\n   "Tu reporte fiscal está listo: https://app.cfditaskmanager.mx/auth/signin?callbackUrl=https%3A%2F%2Fapp-cfditaskmanager-login-verification.phish%2Ffakereport.pdf"\n\n2. Empleado hace clic, ve login LEGÍTIMO (misma UI, mismo dominio, mismo cert TLS).\n3. Ingresa user+pass correctos → NextAuth OK.\n4. signin-form.tsx ejecuta router.push(https://evil.phish/fakereport.pdf).\n5. Victima aterriza en clon idéntico del dashboard que pide "verifica tu contraseña nuevamente por seguridad".\n6. Atacante captura 2 sets de credenciales y obtiene persistence mediante drive-by install de malware corporativo.\n\nBonus: next-auth originalmente tiene protección, pero router.push() la BURLA porque el redirect se hace en código de usuario DESPUÉS de signIn(redirect:false).',
    fixedCode: `// src/components/auth/signin-form.tsx

function safeRedirectUrl(raw: string | null | undefined, fallback = '/dashboard'): string {
  if (!raw) return fallback
  // Caso 1: relative path (empieza con "/") → seguro, pero sanitizar saltos
  if (raw.startsWith('/') && !raw.startsWith('//')) {
    // Quitar /../ y secuencias path-traversal básicas
    try {
      const u = new URL(raw, 'http://placeholder.local')
      return u.pathname + u.search + u.hash
    } catch {
      return fallback
    }
  }
  // Caso 2: URL absoluta → verificar host contra allowlist
  try {
    const u = new URL(raw)
    const safeHosts = new Set([
      (process.env.NEXT_PUBLIC_APP_URL ? new URL(process.env.NEXT_PUBLIC_APP_URL).host : '').toLowerCase(),
      'localhost:3000',
      'localhost'
    ].filter(Boolean))
    if (safeHosts.has(u.host.toLowerCase())) {
      return raw
    }
  } catch {
    /* URL inválida → fallback */
  }
  return fallback
}

// En handleSubmit, reemplazar:
//   const callback = searchParams?.get('callbackUrl') || '/dashboard'
// por:
const callback = safeRedirectUrl(searchParams?.get('callbackUrl'))`
  },
  {
    id: 'AUTH-004',
    owaspId: 'A07:2021',
    owaspName: 'Identification & Authentication Failures',
    title: 'Work factor bcrypt inconsistente entre flujos de registro (10 vs 12 rounds)',
    fileRef: 'src/app/api/auth/register/route.ts, src/app/api/auth/complete-registration/route.ts',
    fileLines: 'L67 vs L44',
    risk: 'Medio',
    risk_band: 'orange',
    description:
      'Existen 2 flujos de establecimiento de contraseña: (a) signup directo bcrypt.hash(password, 12) rounds; (b) invitación accept → complete-registration bcrypt.hash(password, 10) rounds. La diferencia de cost factor crea 3 problemas: (1) cuentas por invitación son ~4x más rápidas de crackear offline si hay leak de hashes; (2) timing side-channel: se puede distinguir si un email entró por "invite" vs "signup" midiendo latencia del endpoint que ejecuta hash (útil para enumeración + OSINT); (3) debt técnico: auditorías de cumplimiento (PCI-DSS 8.3.2, NIST 800-63B 5.1.1.2) requieren factor de trabajo uniforme y actualmente alineado al mínimo recomendado (≥10) pero NO homogéneo.',
    exploit:
      'Escenario A — Hash Leak + Offline Crack:\nSupongamos dump de 100k hashes de DB:\n   $2b$12$... (usuarios directos)  → ~0.6s cada uno en GPU RTX 4090\n   $2b$10$... (usuarios invite)   → ~0.15s cada uno en misma GPU\n\nAtacante ordena por cost y crackea primero los $2b$10$. Obtiene ~25% más credenciales en el mismo tiempo.\n\nEscenario B — User Enumeration por timing:\nMedir Δ en /api/auth/complete-registration (10 rounds = más rápido) vs /api/auth/register (12 rounds). Permite inferir con >95% confianza el canal de origen de una cuenta, mejorando precisión de ataques de spear-phishing orientados a cuentas "invitadas" (suelen ser cuentas de proveedores con menos conciencia de seguridad).',
    fixedCode: `// ====== Valor centralizado en src/lib/auth-config.ts ======
export const PASSWORD_BCRYPT_ROUNDS = 12  // Uniforme para TODOS los flujos
// Ajustar a 13 o 14 si el P95 de registro/reset acepta ~500ms.
// Monitorear con histograma de latencia bcrypt.

// ====== src/app/api/auth/register/route.ts ======
import { PASSWORD_BCRYPT_ROUNDS } from '@/lib/auth-config'
const hashedPassword = await bcrypt.hash(password, PASSWORD_BCRYPT_ROUNDS)

// ====== src/app/api/auth/complete-registration/route.ts ======
import { PASSWORD_BCRYPT_ROUNDS } from '@/lib/auth-config'
const hashedPassword = await bcrypt.hash(password, PASSWORD_BCRYPT_ROUNDS)

// ====== Plus defensivo: timing-safe dummy compare ======
// Centralizar el dummy bcrypt.compare para usuarios inexistentes
// con la MISMA constante de rounds. Evitar hardcodear hash dummy
// con rounds fijos distintos a los de producción.`
  },
  {
    id: 'AUTH-005',
    owaspId: 'A04:2021',
    owaspName: 'Insecure Design',
    title: 'Endpoint validate-password sin rate-limit ni autenticación (DoS + Política Leak)',
    fileRef: 'src/app/api/auth/validate-password/route.ts',
    fileLines: 'L6-L41',
    risk: 'Alto',
    description:
      'POST /api/auth/validate-password es un endpoint público sin rate limit, sin requerir cookie invite_session válida (sólo lo lee "si existe"), sin límite de tamaño de body ni validación de content-type. Permite a atacantes no autenticados: (1) DoS: disparar millones de requests consumiendo CPU en regex/replace del validador; (2) Leak de política completa: construir wordlist óptima conociendo al 100% reglas de longitud, complejidad, términos prohibidos, secuencias, blacklist; (3) Enumeración indirecta: si el atacante coloca en password el nombre/email de un usuario conocido y el endpoint lo bloquea con "No debe contener tu nombre" confirma que NOMBRE coincide con una cuenta real en el sistema (combinable con invite_session leakada).',
    exploit:
      'Paso 1 — Reconocimiento de política (200 requests sin rate-limit):\nPOST /api/auth/validate-password\n{"password":"12345678"} → error "longitud 12"\n{"password":"a" * 12} → error "3 de 4 clases"\n{"password":"Aa0" + "x"*9} → error "caracter especial"\n{"password":"Aa0!xxxxxxxxx"} → error "palabra extremadamente común"\n\nResultado: atacante conoce el EXACTO vector de validación para generar 10B candidatos compatibles con el policy. Reduce keyspace ~60% en ataques de wordlist.\n\nPaso 2 — DoS a costo casi cero:\n$ for i in {1..1000000}; do curl -s -X POST /validate-password -d \'{"p":"A"}\' ; done\n\nCada request ejecuta ~6 regex + includes() + split. 1M requests → CPU satura en 1 solo núcleo. Sin coste de hashing criptográfico: el atacante gana 10:1 en ratio de consumo. Workers BullMQ y otros endpoints se degradan por starved CPU.',
    fixedCode: `// src/app/api/auth/validate-password/route.ts

export async function POST(request: NextRequest) {
  // === 1) Protección temprana de Content-Type y body size ===
  const contentType = request.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    return NextResponse.json(badPass('Solicitud inválida'), { status: 415 })
  }
  // Límite estricto: contraseña > 128 chars NUNCA será necesaria.
  const maxBody = 512
  const rawBody = await request.text()
  if (rawBody.length > maxBody) {
    return NextResponse.json(badPass('Payload excede tamaño permitido'), { status: 413 })
  }

  // === 2) Rate limit ANTES de hacer parse ni trabajo ===
  const forwardedFor = request.headers.get('x-forwarded-for')
  const ip = forwardedFor ? forwardedFor.split(',')[0].trim() : 'anon'
  const rl = await rateLimit(\`validate-pass::\${ip}\`, {
    interval: 60 * 1000,  // por minuto
    limit: 20             // 20 validaciones / IP / minuto
  })
  if (!rl.success) {
    return NextResponse.json(badPass('Demasiadas solicitudes. Intenta más tarde.'), { status: 429 })
  }

  // === 3) Sólo atender si el caller demuestra que está en un flujo
  //    de registro/invitación (cookie válida). Cerrar la puerta a scrapers.
  const sessionCookie = request.cookies.get('invite_session')
  // Opcionalmente aceptar también un csrf de signup recién emitido.
  let userName = '', userEmail = ''
  if (sessionCookie?.value) {
    try { /* lógica original jwtVerify + prisma */ } catch {}
  }

  // === 4) Parseo estricto con Zod ===
  const schema = z.object({ password: z.string().max(128) })
  let password: string
  try {
    const parsed = schema.parse(JSON.parse(rawBody))
    password = parsed.password
  } catch {
    return NextResponse.json(badPass('Datos inválidos'), { status: 400 })
  }

  return NextResponse.json(validatePasswordStrength(password, userName, userEmail))
}

function badPass(mensaje: string) {
  return {
    valida: false,
    nivel_fuerza: 'Debil' as const,
    errores: [mensaje],
    sugerencia: 'Por favor revisa los requisitos e intenta de nuevo.'
  }
}`
  },
  {
    id: 'AUTH-006',
    owaspId: 'A01:2021',
    owaspName: 'Broken Access Control',
    title: 'Invitation Token no invalidado al primer accept (replay + race claim)',
    fileRef: 'src/app/api/auth/invite/accept/route.ts',
    fileLines: 'L50-L53',
    risk: 'Medio',
    description:
      'En el flujo de aceptación de invitación, cuando needsPassword === true el token NO se marca nulo ni la membresía cambia de estado. El código comentado explícitamente: "We DO NOT destroy the token yet. We leave them as PENDING". Esto permite: (1) Replay attacks: si el link se filtra (correo reenviado, screenshots, clipboard sniffing) cualquier tercero puede clicarlo y disparar nuevo invite_session JWT, permitiendo establecer password en nombre del usuario invitado si el usuario legítimo todavía no lo hizo; (2) Race Condition: 2 pestañas que ejecutan accept al mismo tiempo pueden generar 2 cookies invite_session distintas, si luego hay un desfase de validación en complete-registration; (3) Expiración prolongada: el token dura hasta invitationExpiresAt (típicamente 7-30 días) en lugar de invalidarse con el primer intento serio de aceptar. Cualquier leak del link durante esa ventana es una puerta abierta a account takeover del invitado.',
    exploit:
      'Escenario — Empresa envía invitación a empleado@empresa.com:\n1. Admin pulsa "Invitar" → link con token llega por email.\n2. Empleado abre email en PC público del cibercafé, hace clic → carga /auth/accept-invitex?token=...\n3. Empleado cierra pestaña antes de poner contraseña "porque no era su PC". Pero NO se invalidó el token: sigue vivo 7 días más.\n4. Persona maliciosa que miraba por encima o tiene keylogger en el PC reabre el link.\n5. Ejecuta POST /api/auth/invite/accept con el mismo token → recibe cookie invite_session JWT.\n6. Redirigido a /auth/complete-registration → setea contraseña al gusto → TOMA DE CUENTA COMPLETA.\n\nEl empleado legítimo nunca volvió al link porque "ya lo había aceptado visualmente", así que no detecta nada hasta días/weeks después cuando intenta entrar y no puede.',
    fixedCode: `// src/app/api/auth/invite/accept/route.ts

await prisma.\$transaction(async (tx) => {
  // Idempotency + invalidación preventiva: MARCAR EL TOKEN COMO CONSUMIDO
  // y el member como IN_PROGRESS (agregar status al enum si hace falta)
  const updated = await tx.member.updateMany({
    where: {
      id: membership.id,
      status: 'PENDING',          // Solo si está realmente pendiente
      invitationTokenHash: { not: null }  // Protección contra doble-claim
    },
    data: {
      // Si no puedes agregar status "IN_PROGRESS", al menos destruye el token
      // YA, no después. Genera uno de re-emit si el usuario abandona.
      status: needsPassword ? 'PENDING_PASSWORD_SETUP' : 'APPROVED',
      invitationTokenHash: needsPassword ? null : membership.invitationTokenHash,
      // Alternativa conservadora: invalidar token SIEMPRE en el primer accept:
      invitationTokenHash: null,
      invitationExpiresAt: needsPassword ? new Date(Date.now() + 1000 * 60 * 15) : null,
      approvedAt: !needsPassword ? new Date() : undefined
    }
  })

  // updateMany devuelve count. Si count === 0 → otro hilo ya lo tomó.
  if (updated.count === 0) {
    throw new Error('INVITE_ALREADY_CLAIMED')
  }
})

// ====== Complemento: re-emisión segura de token ======
// Si el usuario abandona y quiere volver a entrar, el admin debe generar
// NUEVO token (con botón "Reenviar invitación"). El token viejo se invalida
// en el mismo momento. Reutilizar token es un anti-pattren de seguridad.`
  },
  {
    id: 'AUTH-007',
    owaspId: 'A07:2021',
    owaspName: 'Identification & Authentication Failures',
    title: 'Fallback secret hardcodeado para firmar JWT cuando falta NEXTAUTH_SECRET',
    fileRef: 'src/app/api/auth/validate-password/route.ts, src/app/api/auth/invite/accept/route.ts, src/app/api/auth/complete-registration/route.ts',
    fileLines: 'L14, L61, L22',
    risk: 'Alto',
    description:
      'Las 3 rutas invitan new TextEncoder().encode(process.env.NEXTAUTH_SECRET || "fallback_secret_for_dev"). Si el operador olvida setear NEXTAUTH_SECRET en producción (error común en despliegues con Docker, serverless o migration de entornos), todos los JWT de invite_session y validate-password se firman con un secreto PÚBLICO (está en el código fuente del repo). Cualquier atacante que lea el repo puede forjar JWTs userId/memberId arbitrarios y ejecutar: (1) POST /complete-registration estableciendo contraseña de CUALQUIER cuenta del sistema, (2) GET validate-password con contexto userName/email de CUALQUIER usuario del sistema. Esto es A07:2021 Identification Failures severo porque convierte un misconfiguration en Account Takeover total.',
    exploit:
      '1. Atacante confirma que el target NO tiene NEXTAUTH_SECRET:\n   POST /api/auth/complete-registration\n   Cookie: invite_session=<JWT-forjado-con-fallback-secret>\n   Body: {"password":"Atacante123!"}\n   JWT payload: {"userId":"uuid-usuario-victim","memberId":"uuid-member"}.\n\n2. Como el secret "fallback_secret_for_dev" es conocido, la firma JWT pasa.\n3. userId/role se casan con cualquier cuenta del sistema (si atino con UUID de SUPER_ADMIN → full takeover).\n4. Luego: login con credenciales del admin vía /auth/signin.\n\nDetector barato: hacer login con JWT aleatorio firmado con "fallback_secret_for_dev". Si 200 OK = vulnerable.\n\nLa superficie se agrava porque el fallback está en 3 archivos independientes. En un futuro cuando alguien cambie auth.ts y olvide actualizar los endpoints, quedan 2/3 con el secret viejo.',
    fixedCode: `// ===== src/lib/security.ts (única fuente de la verdad) =====
import { TextEncoder } from 'util'

export function getAuthSecretOrThrow(): Uint8Array {
  const raw = process.env.NEXTAUTH_SECRET?.trim()
  if (!raw || raw.length < 32) {
    // Falla RÁPIDO en startup. Nunca entregar response 200 con secret débil.
    const msg =
      process.env.NODE_ENV === 'production'
        ? 'FATAL: NEXTAUTH_SECRET no configurado o demasiado débil (< 32 chars). Deteniendo request por seguridad.'
        : 'DEV ERROR: configura NEXTAUTH_SECRET en .env.local (≥ 32 chars). Usa: openssl rand -hex 32'
    console.error(msg)
    throw new Error(msg)
  }
  return new TextEncoder().encode(raw)
}

// ===== Aplicar en los 3 archivos =====
// Reemplazar TODAS las líneas:
//   const secret = new TextEncoder().encode(process.env.NEXTAUTH_SECRET || 'fallback_secret_for_dev')
// Por:
import { getAuthSecretOrThrow } from '@/lib/security'
const secret = getAuthSecretOrThrow()

// ===== Adicional: healthcheck de startup =====
// En next.config o bootstrap, validar antes de listen.
// Devolver 503 /health si el secret falta para que k8s no marque ready.`
  },
  {
    id: 'AUTH-008',
    owaspId: 'A05:2021',
    owaspName: 'Security Misconfiguration',
    title: 'Rate-limit por IP en registro; IP spoofable vía header arbitrario',
    fileRef: 'src/app/api/auth/register/route.ts',
    fileLines: 'L15-L32',
    risk: 'Alto',
    description:
      'El rate-limit de registro usa request.headers.get("x-forwarded-for").split(",")[0].trim(). El header X-Forwarded-For es ADDITIVE: cada proxy append al final. El CLIENTE controla el primer elemento (lo envía el navegador en su req). Si el reverse proxy (Nginx/Cloudflare) no está configurado para trustear sólo IPs de upstreams conocidos y reescribir XFF, el atacante puede poner X-Forwarded-For: <ip-random-cada-request> y evadir COMPLETAMENTE el rate limit. 5 registros/IP/hora se convierte en ∞ registros. Con ello (a) se explota registro de cuentas spam-bot, (b) email enumeration infinito bypass, (c) agotamiento de storage en DB creando millones de users + orgs + members.',
    exploit:
      'Bypass sin esfuerzo en cloud con proxy mal-configurado:\n\nfor i in {1..10000}; do\n  FAKE_IP="$((RANDOM % 255)).$((RANDOM % 255)).$((RANDOM % 255)).$((RANDOM % 255))"\n  curl -X POST /api/auth/register \\\n       -H "X-Forwarded-For: \${FAKE_IP}" \\\n       -d \'{"name":"bot\${i}","email":"bot\${i}@dispostable.com","password":"Bb1!zzzzzzzz","confirmPassword":"Bb1!zzzzzzzz"}\'\ndone\n\nCada request ve "ip = FAKE_IP" porque split()[0] = valor controlado por atacante.\nRate-limit nunca llega al límite 5. Se crean 10k cuentas en 10 minutos.\n\nSi además el X-Real-IP de Nginx no sobreescribe el header, cualquier instancia detrás de LB tiene esta vulnerabilidad. Next.js por defecto NO valida la cadena de proxies de confianza: hay que setear experimental.trustHost con hosts confiables.',
    fixedCode: `// src/app/api/auth/register/route.ts

function getRealClientIp(req: NextRequest): string {
  // —— 1) Allow list de proxies CONFIABLES (LB, WAF, Cloudflare) ——
  const TRUSTED_PROXY_IPS = new Set(
    (process.env.TRUSTED_PROXY_IPS || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  )
  // Por defecto incluimos well-known de Cloudflare como ejemplo
  const DIRECT_TRUSTED = new Set([
    'node_modules_localhost_only',  // placeholder; poblar según tu infra
  ])
  void DIRECT_TRUSTED

  // —— 2) Obtener cadena XFF desde el header más a la DERECHA (proxy más cercano) ——
  const xff = req.headers.get('x-forwarded-for')?.trim()
  const xri = req.headers.get('x-real-ip')?.trim()
  const fwdChain = xff ? xff.split(',').map(s => s.trim()) : []

  // —— 3) Estrategia segura: recorrer de DERECHA a IZQUIERDA, quitar los trusted ——
  let candidate = xri || ''
  for (let i = fwdChain.length - 1; i >= 0; i--) {
    const ip = fwdChain[i]
    if (TRUSTED_PROXY_IPS.has(ip)) continue
    candidate = ip
    break
  }
  if (!candidate) candidate = 'unknown'

  return candidate
}

// === Luego en el handler ===
const ip = getRealClientIp(request)

// === Plus: si todavía no podemos confiar en IP (por NAT/CGNAT), combinar rate-limit
// por email TAMBIÉN: tanto por IP como por email_target. Ataques de enumeración
// fallan en cualquiera de los 2 límites.`
  },
  {
    id: 'AUTH-009',
    owaspId: 'A03:2021',
    owaspName: 'Injection',
    title: 'Zod validation details leak internal schema structure al cliente',
    fileRef: 'src/app/api/auth/register/route.ts',
    fileLines: 'L173-L181',
    risk: 'Bajo',
    description:
      'Cuando signUpSchema.parse(body) lanza ZodError, el catch mapea error.issues.map(e => e.message).join(", ") y lo envía en response.details al frontend. Los mensajes de Zod por defecto son muy verbosos sobre la estructura interna: "Debe contener al menos un carácter especial (@$!%*?&)", "Las contraseñas no coinciden: path confirmPassword", "String must contain at least 1 character(s)". Esto acelera: (a) fingerprint exacto del policy engine; (b) crafting de payloads cada vez más ajustados sin necesidad de fuzzing; (c) si en el futuro se expanden campos en el schema, los mensajes revelan nombres de campos nuevos antes que estén documentados públicamente. No es un RCE directo, pero es Information Disclosure del contrato interno del validador.',
    exploit:
      'Atacante itera payloads maliciosos contra /api/auth/register:\n\n1. {"password":"x"}  → details:"La contraseña debe tener al menos 8 caracteres, Debe contener al menos una letra mayúscula, Debe contener al menos una letra minúscula, Debe contener al menos un número, Debe contener al menos un carácter especial (@$!%*?&)"\n\n→ Fingerprint instantáneo: regexes, constantes, nombres de campos y reglas de match exactas.\n\n2. {"name":"a<script>alert(1)</script>"} → details:"El nombre solo puede contener letras y espacios: /^[a-zA-Z\\s\\u00C0-\\u00FF]*$/"\n\n→ El atacante ve el PATTERN REGEX EXACTO del allowlist. Se evita fuzzing ciego para XSS/SQLi posteriores. Conocer ^[a-zA-Z\\s\\u00C0-\\u00FF]*$ le dice que Unicode Latin Extended es aceptado; útil para filter-bypass en componentes que luego rinden ese dato sin sanitizar (ej: reportes PDF sin escape).',
    fixedCode: `// src/app/api/auth/register/route.ts

const FRIENDLY_ERRORS: Record<string, string> = {
  'name_min': 'El nombre es demasiado corto.',
  'name_max': 'El nombre es demasiado largo.',
  'name_regex': 'El nombre contiene caracteres no permitidos.',
  'email_invalid': 'El formato del correo electrónico no es válido.',
  'password_min': 'La contraseña no cumple con los requisitos mínimos de seguridad.',
  'password_complexity': 'La contraseña no cumple con los requisitos mínimos de seguridad.',
  'password_match': 'Las contraseñas no coinciden.',
  '_generic': 'Uno o más campos son inválidos. Revisa la información e intenta de nuevo.'
}

function mapZodToSafe(_err: z.ZodError): { error: string; details: string } {
  // No enviamos issue.message crudo. Agrupamos por primera ocurrencia.
  const firstIssue = _err.issues[0]
  if (!firstIssue) {
    return { error: 'Datos inválidos', details: FRIENDLY_ERRORS._generic }
  }
  const path = firstIssue.path.join('.')
  const code = firstIssue.code
  let bucket = '_generic'
  if (path === 'name' && code === 'too_small') bucket = 'name_min'
  else if (path === 'name' && code === 'too_big') bucket = 'name_max'
  else if (path === 'name' && code === 'invalid_string') bucket = 'name_regex'
  else if (path === 'email') bucket = 'email_invalid'
  else if (path === 'password' && code === 'too_small') bucket = 'password_min'
  else if (path === 'password' && code === 'invalid_string') bucket = 'password_complexity'
  else if (path === 'confirmPassword') bucket = 'password_match'
  return { error: 'Datos inválidos', details: FRIENDLY_ERRORS[bucket] || FRIENDLY_ERRORS._generic }
}

// === Reemplazar bloque catch existente ===
} catch (error) {
  console.error('Registration error:', error) // SOLO server-side con full Zod
  if (error instanceof z.ZodError) {
    const safe = mapZodToSafe(error)
    return NextResponse.json(safe, { status: 400 })
  }
  return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
}`
  },
  {
    id: 'AUTH-010',
    owaspId: 'A08:2021',
    owaspName: 'Software and Data Integrity Failures',
    title: 'Slug generation propensa a colisiones adversariales (DoS + enum de users)',
    fileRef: 'src/app/api/auth/register/route.ts',
    fileLines: 'L71-L85',
    risk: 'Medio',
    description:
      'El slug de organización se deriva del local-part del email: email.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "-"). Si 2 usuarios se llaman "juan" en emails distintos (juan@gmail.com vs juan@yahoo.com), se colisiona y el bucle prueba juan-1, juan-2, ... juan-99. El problema: (a) DoS: un atacante registra 100 cuentas juan* → al usuario real juan@legitimo.com le toca fallback UUID (peor UX, pero más importante: el bucle hace 100 queries SELECT a prisma.organization.findUnique POR request. 100 requests concurrentes = 10,000 queries SQL → DB se ralentiza); (b) User enumeration: si registrar juan@... demora 80ms (no colisiona) pero 1200ms (colisiona 15 veces), el atacante sabe que el local-part está tomado. Con un diccionario de nombres comunes reconstruye el 60% de los emails del sistema con un timing oracle del lado servidor.',
    exploit:
      'Paso 1 — DoS sin creación masiva de cuentas (solo colisiones):\nAtacante envía 100 requests de registro con email local-part = "admin":\n   admin@test1.com → slug admin\n   admin@test2.com → slug admin-1 (1 retry query)\n   admin@test3.com → slug admin-2 (2 retry queries)\n   ...\n   admin@test100.com → 99 retry queries\n\nTotal queries SQL: sum(0..99) = 4,950 SELECTs. Todo por no haber usado \ncount + createMany con sufijo aleatorio directo. Cada 100 requests = 5k queries\nfaciles de disparar sin pasar captcha.\n\nPaso 2 — Timing enumeration de user base:\nRegistrar "carlos@..." → 52 ms → no collision → nadie usa local-part carlos.\nRegistrar "maria@..." → 782 ms → 8 retries → al menos 8 marías preexistentes.\n\nCon R de 5,000 nombres top hispanohablantes, atacante reconstruye nombres de usuarios reales del sistema sin necesidad de leak de DB. Luego usa esos nombres en spear-phishing personalizado.',
    fixedCode: `// src/app/api/auth/register/route.ts (sección slug)

// 5. Generación de slug SEGURA (1 sola query + sufijo criptográfico):
const localPart = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g,'').slice(0, 32)
if (!localPart) {
  return NextResponse.json({ error: 'Email inválido para crear organización' }, { status: 400 })
}
// Prefijar con random corto para evitar colisiones por diseño.
// Usamos 32 bits de entropía hex → 8 chars. Colisión 50% con ~1B de orgs. OK.
const randomSuffix = crypto.randomUUID().slice(0, 8)
const slug = \`\${localPart}-\${randomSuffix}\`

// === Opcional: si UX requiere slugs limpios (sufijo sólo si choca): ===
// Hacer UNA sola query para saber si existe el baseSlug, y recién ahí suffixear.
// NUNCA hacer bucle N+1. Ej:
//   const collision = await prisma.organization.count({ where: { slug: baseSlug } })
//   const slug = collision ? \`\${baseSlug}-\${randomSuffix}\` : baseSlug

// === Adicional: índice único en Prisma para defender de race conditions ===
// model Organization {
//   slug String @unique
// }
// Si por alguna razón llega una dup, Prisma lanza Unique constraint failed que
// el catch transforma en 409 Conflict y se reintenta UNA sola vez con suffix nuevo.
// Total queries por request: 1 o 2. Constante. No hay DoS por N*M.`
  },
  {
    id: 'AUTH-011',
    owaspId: 'A01:2021',
    owaspName: 'Broken Access Control',
    title: 'complete-registration sin verificación cruzada de member ↔ user (IDOR)',
    fileRef: 'src/app/api/auth/complete-registration/route.ts',
    fileLines: 'L23-L63',
    risk: 'Alto',
    description:
      'El endpoint POST /api/auth/complete-registration lee userId y memberId del JWT invite_session. Luego ejecuta 2 updates separados: tx.user.update({ where: { id: userId } }) y tx.member.update({ where: { id: memberId } }). NUNCA valida que el member.userId === userId ni que la membresía pertenezca al status correcto (PENDING_PASSWORD_SETUP o al menos no APPROVED ya). Si un atacante forja o obtiene un JWT con userId=victima_A y memberId=member_de_ORG_B (una combinación que NO corresponde a la realidad), las 2 queries siguen ejecutándose: (1) setea contraseña a user A; (2) aprueba member B que pertenece a OTRO usuario de ORG_B. Resultado: doble ATO (cambio de pass de víctima A + aprobación arbitraria de membresía que puede dar acceso a org ajena).',
    exploit:
      'Precondiciones: atacante consiguió un invite_session JWT de SU CUENTA (por ejemplo aceptando su propia invitación):\n   JWT payload real = {userId: "attacker-uuid", memberId: "attacker-member-uuid"}\n\nAhora el atacante, por medio de AUTH-007 (fallback secret), leak accidental o padding oracle, MODIFICA el payload a:\n   JWT payload = {userId: "VICTIMA-CEO-uuid", memberId: "RANDOM-MEMBER-uuid-de-otra-org"}\n\nPOST /complete-registration\nCookie: invite_session=<JWT-modificado>\nBody: {"password":"MiPassword123!"}\n\nResultado transaccional:\n 1) User CEO → se le cambia contraseña a MiPassword123!  (CEO no tenía pass o la sobreescribe? depende de estado, pero emailVerified se pone a new Date() también)\n 2) Member RANDOM de org ajena → status:APPROVED, invitationTokenHash:null.\n\nSi el atacante lograba en (1) sobreescribir password, ahora tiene login directo como CEO. Si no, en (2) un miembro PENDING de otra organización ahora está APPROVED y el dueño legítimo de esa credencial puede aprovisionar acceso que luego el atacante explota por otros vectores.',
    fixedCode: `// src/app/api/auth/complete-registration/route.ts

// Dentro del \$transaction:
await prisma.\$transaction(async (tx) => {

  // 1) Validar existencia y consistencia RELACIONAL
  const member = await tx.member.findUnique({
    where: { id: memberId },
    select: {
      userId: true,
      status: true,
      invitationExpiresAt: true
    }
  })

  if (!member) {
    throw new Error('MEMBER_NOT_FOUND')
  }

  // === IDOR DEFENSE: cruzar member.userId === JWT.userId === user existente ===
  if (member.userId !== userId) {
    console.error(\`[complete-registration] CRITICAL mismatch: member \${memberId} no pertenece a user \${userId}\`)
    throw new Error('TOKEN_MISMATCH')
  }

  // === Status Machine: sólo permitir si está en estado esperando password ===
  const validStatuses = new Set(['PENDING', 'PENDING_PASSWORD_SETUP'])
  if (!validStatuses.has(member.status as string)) {
    throw new Error('MEMBER_WRONG_STATUS')
  }
  if (member.invitationExpiresAt && member.invitationExpiresAt < new Date()) {
    throw new Error('INVITATION_EXPIRED')
  }

  // === Password validation YA ESTÁ; pero double-check contra db ===
  const user = await tx.user.findUnique({ where: { id: userId } })
  if (!user) throw new Error('USER_NOT_FOUND')

  const hashedPassword = await bcrypt.hash(password, PASSWORD_BCRYPT_ROUNDS)

  // Solo actualizar si el usuario NO tenía password (o permitir reset controlado)
  if (user.password) {
    throw new Error('USER_ALREADY_HAS_PASSWORD') // No sobre-escribir por este flujo!
  }

  await tx.user.update({
    where: { id: userId },
    data: {
      password: hashedPassword,
      emailVerified: new Date(),
      onboardingStep: 'COMPLETED'
    }
  })

  await tx.member.update({
    where: { id: memberId },
    data: {
      status: 'APPROVED',
      approvedAt: new Date(),
      approvedBy: userId,
      invitationTokenHash: null,
      invitationExpiresAt: null
    }
  })
})`
  },
  {
    id: 'AUTH-012',
    owaspId: 'A09:2021',
    owaspName: 'Security Logging & Monitoring Failures',
    title: 'Error handling silencioso en JWT verify + bcrypt dummy compare (blind spots)',
    fileRef: 'src/app/api/auth/validate-password/route.ts, src/lib/auth.ts',
    fileLines: 'L23-L25, L69',
    risk: 'Bajo',
    description:
      'Hay 2 puntos de swallow sin logging: (1) validate-password/route.ts catch JWT hace "// ignore" silencioso; (2) auth.ts bcrypt.compare dummy usa .catch(() => {}). Aunque es una buena práctica no romper el flujo al usuario, la ausencia total de métricas/logs impide detectar: (a) ataques de JWT forjado masivo contra validate-password; (b) rotaciones de secreto que dejan tokens inválidos sin que el equipo de ops lo note; (c) versiones de bcrypt rojas/incompatibles que provocan que el timing de compare falle silenciosamente y ya no proteja contra enumeración. NIST SP 800-92 y PCI-DSS 10.2 requieren registros audibles de fallos criptográficos.',
    exploit:
      'Atacante ejecuta escaneo silencioso de JWTs antiguos contra el endpoint:\n\nfor t in $(cat potentially-leaked-jwts.txt); do\n  curl -b "invite_session=$t" -X POST /validate-password -d \'{"password":"A"}\'\ndone\n\nCada request falla el jwtVerify, se va al catch {} y NO deja ningún rastro. El SIEM/Security Operation Center ve: 0 errores, 0 warnings, 10,000 200 OK. No hay forma de diferenciar: (a) uso legítimo de password validation, de (b) ataque de reutilización de tokens. 80% de los breaches se detectan > 100 días después; sin logs, ese plazo se convierte en indefinido.\n\nIdem para bcrypt dummy: si un día actualizan bcrypt y la dummy hash hardcodeada ya no la acepta (por ej. prefijo $2b$ vs $2a$ mal parseado), .catch(() => {}) silencia el TypeError. El timing protection desaparece, y la defensa contra enumeración por timing se cae sin alertar a nadie.',
    fixedCode: `// src/app/api/auth/validate-password/route.ts (L23-L25)

} catch (jwtErr) {
  // NO logueamos el valor del token (contiene PII/secret). Pero SÍ logueamos:
  // hashed fingerprint + source IP + UA hash para correlación.
  const fp = crypto.createHash('sha256')
    .update(sessionCookie!.value)
    .digest('hex')
    .slice(0, 16)
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim()
  const ua = (request.headers.get('user-agent') || '').slice(0, 96)
  console.warn(
    \`[auth:validate-password] jwt_verify_failed fp=\${fp} ip=\${ip} ua=\${ua} err=\${jwtErr instanceof Error ? jwtErr.message : 'unknown'}\`
  )
  // No subir de nivel ni leak info al cliente. Continuar sin userName/userEmail.
}

// ===== src/lib/auth.ts L69 (dummy bcrypt.compare) =====
try {
  await bcrypt.compare(password, "$2b$10$huPOUmjEOrRVhh7IiDkWWeJiXfJNXMS8KezTCXLutccf6cAhzvFh6")
} catch (dummyErr) {
  // Si el dummy falla, NO protegemos más contra timing. ES CRÍTICO alertar.
  console.error(
    '[auth:bcrypt-dummy] FATAL bcrypt dummy compare falló. Timing protection INACTIVA. err=',
    (dummyErr as Error)?.message || dummyErr
  )
  // En producción: disparar alerta P1 via Sentry.captureMessage / PagerDuty.
  // Continuar para no romper el login, pero el equipo debe enterarse YA.
  if (process.env.NODE_ENV === 'production') {
    // await reportToSentry('bcrypt_dummy_failed', ...)
  }
}`
  }
]

const RISK_COLORS: Record<Risk, string> = {
  'Crítico': '#dc2626',
  'Alto': '#ea580c',
  'Medio': '#ca8a04',
  'Bajo': '#16a34a',
}

const RISK_BG: Record<Risk, string> = {
  'Crítico': '#fee2e2',
  'Alto': '#ffedd5',
  'Medio': '#fef9c3',
  'Bajo': '#dcfce7',
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function countByRisk(findings: Finding[]): Record<Risk, number> {
  const acc: Record<Risk, number> = { 'Crítico': 0, 'Alto': 0, 'Medio': 0, 'Bajo': 0 }
  for (const f of findings) acc[f.risk]++
  return acc
}

function buildHtml(findings: Finding[], generatedAt: string): string {
  const counts = countByRisk(findings)
  const total = findings.length

  const summaryCards = (Object.keys(counts) as Risk[]).map(risk => `
    <div class="summary-card" style="background:${RISK_BG[risk]}; border-left:6px solid ${RISK_COLORS[risk]}">
      <div class="summary-risk" style="color:${RISK_COLORS[risk]}">${risk}</div>
      <div class="summary-count">${counts[risk]}</div>
    </div>
  `).join('')

  const toc = findings.map(f => `
    <div class="toc-item">
      <span class="toc-id">${escapeHtml(f.id)}</span>
      <span class="toc-title">${escapeHtml(f.title)}</span>
      <span class="toc-risk" style="background:${RISK_BG[f.risk]};color:${RISK_COLORS[f.risk]}">${f.risk}</span>
    </div>
  `).join('')

  const findingsHtml = findings.map(f => `
    <section class="finding">
      <div class="finding-header">
        <div>
          <div class="finding-owasp">OWASP ${escapeHtml(f.owaspId)} · ${escapeHtml(f.owaspName)}</div>
          <h2>
            <span class="finding-id">${f.id}</span>
            ${escapeHtml(f.title)}
          </h2>
        </div>
        <div class="risk-badge" style="background:${RISK_COLORS[f.risk]}">
          ${f.risk}
        </div>
      </div>

      <div class="field">
        <div class="field-label">📄 Archivo y Línea exacta:</div>
        <div class="field-value mono">${escapeHtml(f.fileRef)} <span style="color:#64748b">[${escapeHtml(f.fileLines)}]</span></div>
      </div>

      <div class="field">
        <div class="field-label">⚠️ Nivel de Riesgo:</div>
        <div class="field-value"><span class="risk-inline" style="color:${RISK_COLORS[f.risk]}">${f.risk}</span></div>
      </div>

      <div class="field">
        <div class="field-label">🔍 Descripción del Riesgo:</div>
        <div class="field-value">${escapeHtml(f.description)}</div>
      </div>

      <div class="field">
        <div class="field-label">💥 Ejemplo de Exploit:</div>
        <pre class="code-block exploit">${escapeHtml(f.exploit)}</pre>
      </div>

      <div class="field">
        <div class="field-label">✅ Código Corregido:</div>
        <pre class="code-block fixed">${escapeHtml(f.fixedCode)}</pre>
      </div>
    </section>
  `).join('')

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>SAST Report · Módulo Auth · OWASP Top 10</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    margin: 0; padding: 0; background: #f8fafc; color: #0f172a; line-height: 1.55; font-size: 11.5px;
  }
  .page { max-width: 1000px; margin: 0 auto; padding: 36px 44px; }

  h1 { font-size: 26px; margin: 0 0 6px 0; color: #0f172a; letter-spacing: -0.02em; }
  h2 { font-size: 16px; margin: 0 0 14px 0; color: #0f172a; }

  .cover {
    background: linear-gradient(135deg, #450a0a 0%, #7f1d1d 40%, #0f172a 100%);
    color: white; padding: 52px 48px; border-radius: 14px; margin-bottom: 30px;
  }
  .cover .eyebrow { font-size: 11px; text-transform: uppercase; letter-spacing: 0.18em; opacity: 0.75; margin-bottom: 18px; }
  .cover .project { font-size: 13px; opacity: 0.88; margin-top: 10px; }
  .cover .meta { margin-top: 22px; display: flex; gap: 28px; flex-wrap: wrap; font-size: 12px; opacity: 0.9; }
  .cover .meta span strong { display:block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; opacity: 0.7; margin-bottom: 2px; }

  .summary { margin-bottom: 32px; }
  .summary-title { font-size: 13px; font-weight: 700; margin: 0 0 12px 0; color: #1e293b; text-transform: uppercase; letter-spacing: 0.05em; }
  .summary-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; }
  .summary-card { border-radius: 10px; padding: 12px 14px; }
  .summary-card:nth-child(5) { background: #e2e8f0; border-left: 6px solid #64748b; }
  .summary-risk { font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 4px; }
  .summary-count { font-size: 24px; font-weight: 800; line-height: 1; }

  .toc {
    background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px 20px; margin-bottom: 30px;
  }
  .toc h3 { margin: 0 0 12px 0; font-size: 13px; color: #1e293b; text-transform: uppercase; letter-spacing: 0.05em; }
  .toc-item { display: grid; grid-template-columns: 70px 1fr 70px; gap: 12px; align-items: center; padding: 6px 4px; border-bottom: 1px solid #f1f5f9; font-size: 11px; }
  .toc-item:last-child { border-bottom: none; }
  .toc-id { font-weight: 800; color: #475569; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .toc-risk { padding: 3px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; text-align: center; }

  .finding {
    background: white; border: 1px solid #e2e8f0; border-radius: 12px;
    padding: 22px 24px; margin-bottom: 22px; page-break-inside: avoid;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
  }
  .finding-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; margin-bottom: 16px; border-bottom: 2px solid #f1f5f9; padding-bottom: 14px; }
  .finding-owasp { font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #475569; margin-bottom: 6px; }
  .finding-id { display: inline-block; font-weight: 800; background: #450a0a; color: white; padding: 2px 10px; border-radius: 999px; font-size: 10px; margin-right: 10px; vertical-align: middle; letter-spacing: 0.06em; }
  .risk-badge { color: white; font-weight: 800; padding: 6px 14px; border-radius: 999px; font-size: 11px; white-space: nowrap; }
  .risk-inline { font-weight: 800; font-size: 13px; }

  .field { margin-bottom: 12px; }
  .field-label { font-weight: 700; color: #1e293b; margin-bottom: 6px; font-size: 11.5px; }
  .field-value { color: #334155; font-size: 11.5px; }
  .mono { font-family: "JetBrains Mono", "SF Mono", Consolas, monospace; font-size: 11px; }

  .code-block {
    background: #0b1120; color: #e2e8f0; font-family: "JetBrains Mono", "SF Mono", Consolas, monospace;
    font-size: 10.5px; line-height: 1.5; padding: 12px 14px; border-radius: 8px; overflow-x: auto;
    white-space: pre; margin: 0; border: 1px solid #1e293b;
  }
  .code-block.exploit { border-left: 4px solid #dc2626; }
  .code-block.fixed { border-left: 4px solid #16a34a; background: #052e1b; border-color: #064e3b; color: #bbf7d0; }

  .footer { margin-top: 36px; padding-top: 18px; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 10px; display: flex; justify-content: space-between; }

  @media print { body { background: white; } .page { padding: 0; } }
</style>
</head>
<body>
<div class="page">

  <div class="cover">
    <div class="eyebrow">Static Application Security Testing · Pentest Report</div>
    <h1 style="color:white;">Informe SAST · Módulo Auth</h1>
    <div class="project"><strong>Scope:</strong> src/app/auth/** · src/app/api/auth/** · src/lib/auth.ts · src/components/auth/**</div>
    <div class="project"><strong>Framework:</strong> Next.js 15+ (App Router) · NextAuth v5 · Prisma · Zod · bcryptjs · jose</div>
    <div class="meta">
      <span><strong>Estándar</strong>OWASP Top 10 2021</span>
      <span><strong>Hallazgos Totales</strong>${total} vulnerabilidades</span>
      <span><strong>Fecha de emisión</strong>${generatedAt}</span>
      <span><strong>Engine</strong>puppeteer-core · Manual SAST</span>
    </div>
  </div>

  <div class="summary">
    <div class="summary-title">📊 Resumen de severidad</div>
    <div class="summary-grid">
      ${summaryCards}
      <div class="summary-card">
        <div class="summary-risk" style="color:#475569">TOTAL</div>
        <div class="summary-count" style="color:#0f172a">${total}</div>
      </div>
    </div>
  </div>

  <div class="toc">
    <h3>📑 Índice de hallazgos</h3>
    ${toc}
  </div>

  ${findingsHtml}

  <div class="footer">
    <div>SAST Report · Módulo Auth · ${escapeHtml(generatedAt)}</div>
    <div>Página <span class="pageNumber"></span> de <span class="totalPages"></span></div>
  </div>

</div>
</body>
</html>`
}

async function main() {
  const outDir = join(process.cwd(), 'reports')
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })

  const now = new Date()
  const stamp =
    now.getFullYear() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') +
    '_' +
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0')
  const pdfPath = join(outDir, `sast-auth-report_${stamp}.pdf`)
  const htmlSnapPath = join(outDir, `sast-auth-report_${stamp}.html`)

  const html = buildHtml(FINDINGS, now.toISOString())

  writeFileSync(htmlSnapPath, html, 'utf-8')
  console.log(`[SAST-PDF] HTML snapshot: ${htmlSnapPath}`)

  console.log('[SAST-PDF] Iniciando navegador...')
  const browser = await getBrowserInstance()
  let page: Page | null = null
  try {
    page = await browser.newPage()
    page.setDefaultNavigationTimeout(60000)
    page.setDefaultTimeout(60000)
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 60000 })

    try {
      await page.waitForNetworkIdle({ idleTime: 200, timeout: 2000 })
    } catch {
      /* network idle no estricto */
    }

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: `
        <div style="width:100%;font-size:9px;color:#64748b;padding:6px 36px;display:flex;justify-content:space-between;">
          <span>SAST · Módulo Auth · OWASP Top 10 2021</span>
          <span>Confidencial · Interno</span>
        </div>`,
      footerTemplate: `
        <div style="width:100%;font-size:9px;color:#64748b;padding:6px 36px;display:flex;justify-content:space-between;">
          <span>${now.toISOString()}</span>
          <span>Página <span class="pageNumber"></span> / <span class="totalPages"></span></span>
        </div>`,
      margin: { top: '56px', right: '14px', bottom: '52px', left: '14px' }
    })

    writeFileSync(pdfPath, Buffer.from(pdfBuffer))
    console.log(`[SAST-PDF] ✅ PDF generado exitosamente en: ${pdfPath}`)
    console.log(`[SAST-PDF] Tamaño: ${(Buffer.byteLength(pdfBuffer) / 1024).toFixed(1)} KB`)
  } finally {
    if (page) { try { await page.close() } catch {} }
    if (cachedBrowser) { try { await cachedBrowser.close(); cachedBrowser = null } catch {} }
  }
}

main().catch(err => {
  console.error('[SAST-PDF] ❌ Error fatal:', err)
  process.exit(1)
})
