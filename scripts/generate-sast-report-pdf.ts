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
    id: '1',
    owaspId: 'A01:2021',
    owaspName: 'Broken Access Control',
    title: 'IDOR + Mass Assignment en Actualización de Roles (Escalación Vertical)',
    fileRef: 'src/app/api/admin/users/[id]/route.ts',
    fileLines: 'L51-L62, L100-L109',
    risk: 'Crítico',
    description:
      'La ruta PATCH /api/admin/users/:id valida que el solicitante sea owner o ADMIN de la organización, pero no valida si el roleId enviado corresponde a un CustomRole existente dentro de la MISMA organización. Cualquier roleId de otra organización pasa la comprobación y su customRoleId se persiste sin pertenencia. Además, strings arbitrarios que no coinciden con [ADMIN, AUDITOR, VIEWER] caen por defecto en VIEWER con customRoleId arbitrario, permitiendo Privilege Escalation por desvío a roles de tenants vecinos.',
    exploit:
      'PATCH /api/admin/users/2c0c...9ab5\n{\n  "roleId": "custom-role-robado-de-OTRA-org",\n  "companyIds": []\n}\n\nSi el CustomRole robado tiene orgRoles: true o providerBusinessRules: true, el atacante hereda permisos elevados sin autorización cruzando el boundary de multi-tenant. El endpoint no emite restricción de organizationId en la query de validación del role.',
    fixedCode: `const isSystemRole = ['ADMIN', 'AUDITOR', 'VIEWER'].includes(roleId)
let systemRole: 'ADMIN' | 'AUDITOR' | 'VIEWER' = 'VIEWER'
let customRoleId: string | null = null

if (isSystemRole) {
  systemRole = roleId as 'ADMIN' | 'AUDITOR' | 'VIEWER'
} else {
  const validCustomRole = await prisma.customRole.findUnique({
    where: { id: roleId },
    select: { id: true, organizationId: true }
  })
  if (!validCustomRole || validCustomRole.organizationId !== adminMembership.organizationId) {
    return NextResponse.json({ error: 'Rol personalizado inválido' }, { status: 400 })
  }
  customRoleId = validCustomRole.id
}`
  },
  {
    id: '2',
    owaspId: 'A01:2021',
    owaspName: 'Broken Access Control',
    title: 'Escalación Horizontal: Admin Dashboard lee datos GLOBALES sin scoping (Cross-Tenant Leak)',
    fileRef: 'src/app/api/admin/dashboard/route.ts',
    fileLines: 'L38-L45, L48-L78',
    risk: 'Crítico',
    description:
      'El handler valida Permission.ADMIN_DASHBOARD en el systemRole del usuario, pero las consultas a Prisma (count, findMany, groupBy) NO filtran por organizationId. Esto expone al admin de la Organización A el conteo total de usuarios del sistema, empresas de tenants vecinos, auditLogs con PII (emails, RFCs), agregados de industrias y estados globales. Violación severa de aislamiento multi-tenant.',
    exploit:
      '1. Iniciar sesión con cuenta normal SystemRole=ADMIN de Org-A.\n2. GET /api/admin/dashboard.\n3. Response incluye:\n   - totalUsers (de TODAS las orgs + platform owners)\n   - totalCompanies / recentCompanies (con createdBy userIds)\n   - recentAuditLogs con userEmail, companyName, description y RFCs\n   - topIndustries / topStates agregados de todo el SaaS.\nPII expuesto sin necesidad de estar autorizado en esos tenants.',
    fixedCode: `// Obtener membresía autorizada con su organizationId
const member = await prisma.member.findFirst({
  where: { userId: user.id, status: 'APPROVED' },
  select: { organizationId: true }
})
if (!member) return NextResponse.json({ error: 'Sin membresía' }, { status: 403 })
const orgId = member.organizationId

// Scopear TODAS las consultas
prisma.company.count({ where: { organizationId: orgId } }),
prisma.company.findMany({ where: { organizationId: orgId }, ... }),
prisma.auditLog.findMany({
  where: {
    timestamp: { gte: ... },
    OR: [
      { organizationId: orgId },
      { company: { organizationId: orgId } }
    ]
  }
})`
  },
  {
    id: '3',
    owaspId: 'A03:2021',
    owaspName: 'Injection',
    title: 'Mass Assignment vía Spread Operator de permissions sin allow-list estricta',
    fileRef: 'src/app/api/admin/roles/route.ts, src/app/api/admin/roles/[id]/route.ts',
    fileLines: 'L192-L217 (POST), L24-L42 (PUT)',
    risk: 'Alto',
    description:
      'La creación/edición de CustomRole recibe body.permissions y lo inyecta directamente con ...permissions sin allow-list ni validación de schema. Si el modelo tiene campos que no debieran escribirse por API (id, organizationId, createdAt, flags internos), el spread permite sobrescribirlos u overpostear campos arbitrarios que coincidan con el schema de Prisma. El parser no rechaza llaves extra.',
    exploit:
      'POST /api/admin/roles\n{\n  "name": "Hacked Role",\n  "permissions": {\n    "organizationId": "uuid-ORG-AJENA",\n    "canManageOrg": true,\n    "createdAt": "1970-01-01T00:00:00.000Z"\n  },\n  "granularPermissions": { "orgRoles": true }\n}\n\nDependiendo de laxitud de Prisma, se pueden colgar roles de otras organizaciones o manipular metadata no editable.',
    fixedCode: `import { z } from 'zod'

const PERMISSION_KEYS = [
  'canViewEmission','canViewReception','canViewPayroll',
  'canViewSatPortal','canViewMassDownloads','canManageOrg'
] as const

const createRoleSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  granularPermissions: z.record(z.string(), z.boolean()).default({}),
  permissions: z.object({
    canViewEmission: z.boolean().default(false),
    canViewReception: z.boolean().default(false),
    canViewPayroll: z.boolean().default(false),
    canViewSatPortal: z.boolean().default(false),
    canViewMassDownloads: z.boolean().default(false),
    canManageOrg: z.boolean().default(false),
  }).strict() // Rechaza llaves desconocidas
})

const body = createRoleSchema.parse(await req.json())
const newRole = await prisma.customRole.create({
  data: {
    organizationId: member.organizationId,
    name: body.name,
    description: body.description,
    ...body.permissions,
    granularPermissions: body.granularPermissions
  }
})`
  },
  {
    id: '4',
    owaspId: 'A04:2021',
    owaspName: 'Insecure Design',
    title: 'Validación de roles inconsistente (Role Collision) entre rutas gemelas',
    fileRef: 'src/app/api/admin/members/[id]/route.ts, src/app/api/admin/members/[id]/access/route.ts',
    fileLines: 'L48-L56, L95-L103',
    risk: 'Alto',
    description:
      'Existen 4 rutas que asignan roles (users/:id, members/:id, members/:id/access y bulk-invite). Sólo bulk-invite verifica que el CustomRole exista en la organización. Las otras 3 no centralizan validación, produciendo Role Collision: un mismo roleId se acepta por una ruta y es rechazado por otra. Rompe auditabilidad y crea surface de ataque desigual según qué endpoint use el atacante.',
    exploit:
      '1. Intentar asignar un CustomRole de org ajena vía bulk-invite → rechazado.\n2. Usar el mismo ID vía PATCH /api/admin/members/:id → aceptado.\n\nEl layout protegido no sirve si existe un endpoint "rápido" desprotegido con la misma funcionalidad.',
    fixedCode: `// src/lib/admin-roles.ts (helper centralizado)
export async function resolveRoleForOrg(
  roleId: string,
  organizationId: string
): Promise<{ systemRole: 'ADMIN'|'AUDITOR'|'VIEWER'; customRoleId: string | null }> {
  if (['ADMIN','AUDITOR','VIEWER'].includes(roleId)) {
    return { systemRole: roleId as any, customRoleId: null }
  }
  const cr = await prisma.customRole.findUnique({
    where: { id: roleId },
    select: { id: true, organizationId: true }
  })
  if (!cr || cr.organizationId !== organizationId) {
    throw new Error('Rol inválido para la organización')
  }
  return { systemRole: 'VIEWER', customRoleId: cr.id }
}

// Invocar en las 4 rutas (users, members, members/access, bulk-invite)`
  },
  {
    id: '5',
    owaspId: 'A07:2021',
    owaspName: 'Identification & Authentication Failures',
    title: 'Guardia de autorización sin filtro status: APPROVED',
    fileRef: 'src/app/api/admin/roles/route.ts, src/app/api/admin/roles/[id]/route.ts',
    fileLines: 'L184-L190, L59-L65',
    risk: 'Alto',
    description:
      'En roles/route.ts y roles/[id]/route.ts, la guardia findFirst(where: {userId}) no filtra status == "APPROVED". Si un admin es dado de baja (status INACTIVE/PENDING/ONBOARDING) pero su member.role sigue siendo ADMIN, las credenciales siguen pasando la guardia. Las otras rutas admin (users, invite, sat-69b/sync) sí filtran APPROVED, creando bypass selectivo.',
    exploit:
      '1. Admin legítimo suspendido: status = INACTIVE, role = ADMIN.\n2. Cookie de sesión / refresh token sigue vigente.\n3. GET /api/admin/roles → PASA.\n4. PUT /api/admin/roles/<id> → PUEDE editar roles y escalar privilegios mientras no se limpie el rol.',
    fixedCode: `const member = await prisma.member.findFirst({
  where: {
    userId: session.user.id,
    status: 'APPROVED' // Filtro OBLIGATORIO
  },
  include: { organization: true }
})
if (!member || member.role !== "ADMIN") {
  return NextResponse.json({ error: "Acceso denegado" }, { status: 403 })
}`
  },
  {
    id: '6',
    owaspId: 'A02:2021',
    owaspName: 'Cryptographic Failures / Sensitive Data Exposure',
    title: 'invitationToken de 32 bytes retornado en texto plano por JSON',
    fileRef: 'src/app/api/admin/users/invite/route.ts',
    fileLines: 'L70-L73',
    risk: 'Medio',
    description:
      'El endpoint POST /api/admin/users/invite retorna invitationToken en el body del response. El comentario "Returned ONLY once so the admin can copy it immediately" es falso: los reverse proxies (nginx, Cloudflare), APMs (Datadog, Sentry) y herramientas SIEM loguean bodies HTTP automáticamente. Además, el historial de DevTools del navegador lo cachea indefinidamente. Token se transmite por HTTP en dev sin seguridad de capa de transporte.',
    exploit:
      'Admin compartiendo pantalla en Zoom/Meet → tercero ve token en Network tab.\nMITM en LAN insegura sin HSTS STS → captura body del response.\nOperador de infraestructura con acceso a logs de balanceador puede extraer tokens de invitación y crear cuentas en nombre de otras organizaciones.',
    fixedCode: `return NextResponse.json({
  success: true,
  message: 'Usuario invitado exitosamente',
  existingUser: invitation.existingUser,
  // invitationToken: ELIMINADO. Se transmite UNICAMENTE por correo.
})

// Si se requiere copiado manual para admins con problemas de email:
// generar JWT firmado de 5 minutos de vida con payload hasheado
// y obligar a un flujo de confirmación 2FA o doble-click antes de emitirlo.`
  },
  {
    id: '7',
    owaspId: 'A02:2021',
    owaspName: 'Cryptographic Failures / Information Disclosure',
    title: 'members/:id/access expone error.message crudo de Prisma al cliente',
    fileRef: 'src/app/api/admin/members/[id]/access/route.ts',
    fileLines: 'L140-L144',
    risk: 'Medio',
    description:
      'El handler PATCH hace const message = error instanceof Error ? error.message : "..." y devuelve NextResponse.json({ error: message }, 500). Prisma emite errores como "Unique constraint failed on the fields: (memberId, companyId)", "Foreign key constraint failed on the field: companyAccess_memberId_fkey" o "column ... does not exist". El atacante mapea nombres de tablas, columnas y restricciones, reduciendo drásticamente el esfuerzo de fingerprint y orientando IDOR/SQLi',
    exploit:
      'PATCH /api/admin/members/<id>/access\n{ "companyId": "...", "role": "BAD_PAYLOAD_TO_FINGERPRINT" }\n\nResponse 500:\n{"error":"Unique constraint failed on the fields: (memberId_companyId): The required connection Company on the CompanyAccess model is missing..."}\n\nNombre de tablas y columnas extraídos sin esfuerzo.',
    fixedCode: `} catch (error) {
  console.error('[admin/members/access] Error interno:', error) // SOLO logs internos
  return NextResponse.json(
    { error: 'Error interno del servidor' },
    { status: 500 }
  )
}`
  },
  {
    id: '8',
    owaspId: 'A05:2021',
    owaspName: 'Security Misconfiguration',
    title: 'Páginas admin "use client" sin proteger server-side ante usuarios no autorizados',
    fileRef: 'src/app/admin/users/page.tsx, roles/page.tsx, profiles/page.tsx, users-bulk/page.tsx',
    fileLines: 'L1-L33, L1-L70, L1-L46, L1-L15',
    risk: 'Bajo',
    description:
      'Sólo admin/dashboard/page.tsx usa <ProtectedRoute> + <PermissionRequired>. Las otras 4 páginas son puras "use client" sin wrapper ni redirect server-side. Usuario sin permiso que conozca URL /admin/users carga shell completo de UI, botones, nombres de módulos y endpoints subyacentes. Expone superficie de ataque y metadata del sistema sin necesidad de 403 temprano.',
    exploit:
      '1. Usuario con role USER simple navega a /admin/roles (ruta conocida por leak de fuente o enum común).\n2. Recibe UI completa del gestor de roles (Nombres de permisos ~60 switches organizados por módulo).\n3. Fingerprint de features y enumeración de granularPermissions de otras orgs a través del layout visual.',
    fixedCode: `// Envolver cada página al igual que admin/dashboard
import { PermissionRequired } from '@/components/auth/PermissionRequired'
import { ProtectedRoute } from '@/components/auth/ProtectedRoute'
import { Permission } from '@/lib/permissions'

return (
  <ProtectedRoute>
    <PermissionRequired permission={Permission.ADMIN_USERS}>
      {/* ... page JSX original ... */}
    </PermissionRequired>
  </ProtectedRoute>
)`
  },
  {
    id: '9',
    owaspId: 'A05:2021',
    owaspName: 'Security Misconfiguration',
    title: 'Rate limit ausente en mutaciones críticas (invitaciones, cambio de status)',
    fileRef: 'src/app/api/admin/users/invite/[id]/route.ts, src/app/api/admin/users/[id]/status/route.ts',
    fileLines: 'DELETE y PATCH handlers completos',
    risk: 'Bajo',
    description:
      'DELETE /api/admin/users/invite/:id y PATCH /api/admin/users/:id/status no tienen rate limit por usuario autenticado. Aunque requieren autorización, un admin comprometido o XSS en el panel podrían iterar IDs visibles en listados (fuera del rango UUID inviable) para activar/inactivar usuarios en bucle sin backoff, causando denegación de servicio operativa.',
    exploit:
      '1. Atacante roba sesión de admin y obtiene listado de userIds/memberIds por GET /api/admin/users.\n2. Script en loop: 1000 llamadas por minuto al PATCH status=INACTIVE.\n3. Ningún rate limiter frena: usuarios se inactivan en masa, denegando acceso a la organización completa.',
    fixedCode: `// src/lib/rate-limit.ts (importar y aplicar en cada handler)
import { rateLimitByUserId } from '@/lib/rate-limit'

await rateLimitByUserId({
  userId: session.user.id,
  key: 'admin-status-patch',
  limit: 30,
  windowMs: 60_000 // 30 cambios por minuto por admin
})`
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
      <span class="toc-id">#${f.id}</span>
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
            <span class="finding-id">#${f.id}</span>
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
<title>SAST Report · Módulo Admin · OWASP Top 10</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    margin: 0; padding: 0; background: #f8fafc; color: #0f172a; line-height: 1.55; font-size: 12px;
  }
  .page { max-width: 1000px; margin: 0 auto; padding: 40px 44px; }

  h1 { font-size: 28px; margin: 0 0 6px 0; color: #0f172a; letter-spacing: -0.02em; }
  h2 { font-size: 18px; margin: 0 0 14px 0; color: #0f172a; }

  .cover {
    background: linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%);
    color: white; padding: 56px 48px; border-radius: 14px; margin-bottom: 32px;
  }
  .cover .eyebrow { font-size: 11px; text-transform: uppercase; letter-spacing: 0.18em; opacity: 0.75; margin-bottom: 18px; }
  .cover .project { font-size: 14px; opacity: 0.85; margin-top: 12px; }
  .cover .meta { margin-top: 24px; display: flex; gap: 28px; flex-wrap: wrap; font-size: 12px; opacity: 0.9; }
  .cover .meta span strong { display:block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; opacity: 0.7; margin-bottom: 2px; }

  .summary { margin-bottom: 36px; }
  .summary-title { font-size: 14px; font-weight: 700; margin: 0 0 14px 0; color: #1e293b; text-transform: uppercase; letter-spacing: 0.05em; }
  .summary-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; }
  .summary-card { border-radius: 10px; padding: 14px 16px; }
  .summary-card:nth-child(5) { background: #e2e8f0; border-left: 6px solid #64748b; }
  .summary-risk { font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 4px; }
  .summary-count { font-size: 26px; font-weight: 800; line-height: 1; }

  .toc {
    background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px 22px; margin-bottom: 36px;
  }
  .toc h3 { margin: 0 0 14px 0; font-size: 14px; color: #1e293b; text-transform: uppercase; letter-spacing: 0.05em; }
  .toc-item { display: grid; grid-template-columns: 30px 1fr 70px; gap: 12px; align-items: center; padding: 7px 4px; border-bottom: 1px solid #f1f5f9; font-size: 11.5px; }
  .toc-item:last-child { border-bottom: none; }
  .toc-id { font-weight: 700; color: #475569; }
  .toc-risk { padding: 3px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; text-align: center; }

  .finding {
    background: white; border: 1px solid #e2e8f0; border-radius: 12px;
    padding: 24px 26px; margin-bottom: 24px; page-break-inside: avoid;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
  }
  .finding-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; margin-bottom: 18px; border-bottom: 2px solid #f1f5f9; padding-bottom: 16px; }
  .finding-owasp { font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #475569; margin-bottom: 6px; }
  .finding-id { display: inline-block; font-weight: 800; background: #0f172a; color: white; padding: 2px 10px; border-radius: 999px; font-size: 11px; margin-right: 10px; vertical-align: middle; }
  .risk-badge { color: white; font-weight: 800; padding: 6px 14px; border-radius: 999px; font-size: 11px; white-space: nowrap; }
  .risk-inline { font-weight: 800; font-size: 13px; }

  .field { margin-bottom: 14px; }
  .field-label { font-weight: 700; color: #1e293b; margin-bottom: 6px; font-size: 12px; }
  .field-value { color: #334155; font-size: 12px; }
  .mono { font-family: "JetBrains Mono", "SF Mono", Consolas, monospace; font-size: 11.5px; }

  .code-block {
    background: #0b1120; color: #e2e8f0; font-family: "JetBrains Mono", "SF Mono", Consolas, monospace;
    font-size: 11px; line-height: 1.55; padding: 14px 16px; border-radius: 8px; overflow-x: auto;
    white-space: pre; margin: 0; border: 1px solid #1e293b;
  }
  .code-block.exploit { border-left: 4px solid #dc2626; }
  .code-block.fixed { border-left: 4px solid #16a34a; background: #052e1b; border-color: #064e3b; color: #bbf7d0; }

  .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 10.5px; display: flex; justify-content: space-between; }

  @media print { body { background: white; } .page { padding: 0; } }
</style>
</head>
<body>
<div class="page">

  <div class="cover">
    <div class="eyebrow">Static Application Security Testing · Pentest Report</div>
    <h1 style="color:white;">Informe SAST · Módulo Admin</h1>
    <div class="project"><strong>Scope:</strong> src/app/admin/** &nbsp;·&nbsp; src/app/api/admin/**</div>
    <div class="project"><strong>Framework:</strong> Next.js 15 (App Router) · TypeScript · Prisma · shadcn/ui</div>
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
    <div>SAST Report · Módulo Admin · ${escapeHtml(generatedAt)}</div>
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
  const pdfPath = join(outDir, `sast-admin-report_${stamp}.pdf`)
  const htmlSnapPath = join(outDir, `sast-admin-report_${stamp}.html`)

  const html = buildHtml(FINDINGS, now.toISOString())

  // Guardar HTML snapshot para debugging
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
          <span>SAST · Módulo Admin · OWASP Top 10</span>
          <span>Confidencial</span>
        </div>`,
      footerTemplate: `
        <div style="width:100%;font-size:9px;color:#64748b;padding:6px 36px;display:flex;justify-content:space-between;">
          <span>${now.toISOString()}</span>
          <span>Página <span class="pageNumber"></span> / <span class="totalPages"></span></span>
        </div>`,
      margin: { top: '60px', right: '14px', bottom: '55px', left: '14px' }
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
