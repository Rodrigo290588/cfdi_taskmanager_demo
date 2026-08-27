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
    id: 'API-01',
    owaspId: 'A01:2021',
    owaspName: 'Broken Access Control',
    title: 'Ruta /api/import SIN AUTENTICACIÓN (escritura masiva de CFDI anónima)',
    fileRef: 'src/app/api/import/route.ts',
    fileLines: 'L16-L87 (todo el handler POST)',
    risk: 'Crítico',
    description:
      'El endpoint POST /api/import NO invoca auth() en ningún punto. Permite que cualquier cliente sin sesión envíe un array de CFDI en XML y los persista directamente en la base de datos vía createInvoiceFromXml. No hay rate limit, no hay verificación de tenant, no hay validación de firma XML (válido o no). Equivale a una puerta trasera de data injection sobre el modelo core de facturas, capaz de sobreescribir UUIDs legítimos o inundar el sistema con millones de registros.',
    exploit:
      '1. Sin iniciar sesión:\nPOST /api/import HTTP/1.1\nHost: app.example.com\nContent-Type: application/json\n[\n  {\n    "xmlContent": "<?xml version=\'1.0\'?><cfdi:Comprobante ... >\\n<cfdi:Complemento><tfd:TimbreFiscalDigital UUID=\\"00000000-0000-0000-0000-000000000001\\" ... /></cfdi:Complemento></cfdi:Comprobante>",\n    "source_file": "factura_falsa.xml"\n  },\n  // ... 1 millón de registros usando Batching ...\n]\n\nRespuesta: success:true, results: [{uuid:"...", status:"created"}].\n\nImpacto adicional: Denegación de servicio (almacenamiento ilimitado / procesamiento de parseo XML 100% CPU / RAM).',
    fixedCode: `export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    // [SAST-FIX API-01] Rate limit por usuario: máx. 10 lotes por hora
    rateLimitByUserId({
      userId: session.user.id,
      key: 'cfdi-import-batch',
      limit: 10,
      windowMs: 60 * 60 * 1000
    })

    // [SAST-FIX] Resolver tenant y limitar lote
    const member = await prisma.member.findFirst({
      where: { userId: session.user.id, status: 'APPROVED' },
      select: { organizationId: true, role: true, id: true }
    })
    if (!member) return NextResponse.json({ error: 'Sin membresía' }, { status: 403 })

    const body = importBatchSchema.parse(await request.json())
    if (body.length > 500) {
      return NextResponse.json(
        { error: 'Lote excede el tamaño máximo permitido (500 CFDI)' },
        { status: 413 }
      )
    }

    const results = []
    for (const item of body) {
      const res = await createInvoiceFromXml(prisma, item.xml!, contextCache, {
        enforceTenant: member.organizationId,
        memberId: member.id,
        userId: session.user.id
      })
      results.push(res)
    }
    return NextResponse.json({ results, summary: {...} }, { status: 201 })
  } catch (e) {
    if (e instanceof RateLimitError) return NextResponse.json({ error: e.message }, { status: 429 })
    if (e instanceof z.ZodError) return NextResponse.json({ error: 'Datos inválidos', details: e.issues }, { status: 400 })
    console.error('[import-batch]', e)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}

// Schema estricto
const importBatchSchema = z.array(z.object({
  xml: z.string().trim().min(100).max(50_000_000),
  source_file: z.string().trim().max(255).optional()
})).min(1).max(500)`
  },
  {
    id: 'API-02',
    owaspId: 'A01:2021 / A07:2021',
    owaspName: 'Broken Authentication + Path Traversal',
    title: '/invoices/:id/pdf sin autenticación + Path Traversal (lectura de archivos arbitrarios)',
    fileRef: 'src/app/api/invoices/[id]/pdf/route.ts',
    fileLines: 'L12-L45 (handler GET completo)',
    risk: 'Crítico',
    description:
      'La ruta GET /api/invoices/:id/pdf tiene DOS problemas independientes de severidad máxima: (1) NO llama auth() - cualquier usuario anónimo puede descargar el PDF de CUALQUIER factura del sistema conociendo su id (UUID enumeración reducida pero factible por fuerza bruta si hay leaks). (2) El query param ?file= concatena con path.join sin sanitizar SECUENCIAS RELATIVAS: la guardia L24-L26 SOLO detecta paths absolutos (C:\\ o /), pero ../../windows/win.ini o ../../.env.local pasan sin problemas. Resultado: LFI (Local File Inclusion) → robo de código fuente, secrets, ENV vars, claves de cifrado, etc.',
    exploit:
      'Escenario 1 - Path Traversal ENV:\nGET /api/invoices/any-uuid-random/pdf?file=../../../../../.env.local HTTP/1.1\nHost: app\nRespuesta: binario del archivo (renderiza si es .env como raw text, puppeteer intenta parsear como XML pero readFile L27 expone el error con contenido si el throw se filtra - incluso el 500 devuelve el buffer en escenarios de NextResponse mal estructurado).\n\nEscenario 2 - Leak de XML de CFDI vecino:\nGET /api/invoices/uuid-de-OTRA-empresa/pdf\nDevuelve el PDF completo con datos fiscales de terceros sin verificar tenant ni permisos VIEWER del RFC.',
    fixedCode: `export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

    const { id } = await params

    // [SAST-FIX API-02] ELIMINAR por completo el parámetro ?file= en PRODUCCIÓN.
    // Si es absolutamente necesario para dev:
    const fileParam = request.nextUrl.searchParams.get('file')
    if (fileParam) {
      if (process.env.NODE_ENV === 'production') {
        return NextResponse.json({ error: 'Parametro no permitido' }, { status: 400 })
      }
      // Safe join: resolver y verificar que esté dentro de java-client/xml-data
      const safeBaseDir = path.resolve(process.cwd(), 'java-client', 'xml-data')
      const candidate = path.resolve(safeBaseDir, fileParam)
      if (!candidate.startsWith(safeBaseDir + path.sep) && candidate !== safeBaseDir) {
        return NextResponse.json({ error: 'Path inválido' }, { status: 400 })
      }
      // Regex allowlist extension
      if (!/\\.xml$/i.test(candidate)) {
        return NextResponse.json({ error: 'Solo archivos XML permitidos' }, { status: 400 })
      }
    }

    // [SAST-FIX API-02] Validar ownership de la factura por RFC/Organization
    const member = await prisma.member.findFirst({
      where: { userId: session.user.id, status: 'APPROVED' },
      select: { organizationId: true }
    })
    if (!member) return NextResponse.json({ error: 'Sin membresía' }, { status: 403 })

    const satInvoice = await prisma.satInvoice.findUnique({
      where: { id },
      select: { issuerRfc: true, receiverRfc: true, xmlContent: true, satStatus: true }
    })
    if (!satInvoice || !satInvoice.xmlContent) {
      return NextResponse.json({ error: 'Factura no encontrada' }, { status: 404 })
    }
    // Verificar que issuerRfc o receiverRfc existan en un FiscalEntity de la org
    const hasAccess = await prisma.fiscalEntity.findFirst({
      where: { organizationId: member.organizationId, rfc: { in: [satInvoice.issuerRfc, satInvoice.receiverRfc] } },
      select: { id: true }
    })
    if (!hasAccess) return NextResponse.json({ error: 'Acceso denegado' }, { status: 403 })

    // Generar PDF con el XML autorizado
    const { pdfBuffer, uuid } = await generateCfdiPdfFromXml({
      xmlRaw: satInvoice.xmlContent,
      invoiceIdForFallback: id,
      isCancelled: satInvoice.satStatus === 'CANCELADO'
    })
    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': \`attachment; filename="cfdi_\${uuid}.pdf"\`,
        'Content-Security-Policy': "default-src 'none'"
      }
    })
  } catch (error) {
    console.error('[invoice-pdf]', error)
    return NextResponse.json({ error: 'Error interno al generar el PDF' }, { status: 500 })
  }
}`
  },
  {
    id: 'API-03',
    owaspId: 'A01:2021',
    owaspName: 'Broken Access Control',
    title: '/api/dev/sat_invoices SIN AUTENTICACIÓN NI LÍMITES (todas las facturas expuestas)',
    fileRef: 'src/app/api/dev/sat_invoices/route.ts',
    fileLines: 'L4-L30 (handler GET completo)',
    risk: 'Crítico',
    description:
      'El endpoint GET /api/dev/sat_invoices no valida sesión, ni permisos, ni tenant. Expone directamente todos los registros satInvoice con issuerRfc, receiverRfc, nombre emisor/receptor, subtotal, total, moneda, UUID. El único filtro es ?rfc= que reduce el set a un RFC concreto; ?limit= acepta hasta 100. Cualquiera desde Internet podría scrapear toda la base de facturas vía paginación rfc por rfc (2^24 RFCs posibles, pero con los prefijos conocidos de CFDI registrados SAT se completaría en horas). Fuga masiva de PII fiscal.',
    exploit:
      'GET /api/dev/sat_invoices?limit=100 HTTP/1.1\nHost: app\n\nResponse: { count:100, invoices: [ { uuid:"...", issuerRfc:"XXX010101XXX", issuerName:"EMPRESA SA DE CV", receiverRfc:"YYY010101YYY", total:15450.22, currency:"MXN", issuanceDate:"..." } ...] }\n\nAtaque repetitivo: iterar ?limit=100&offset=X vía created_at cursor (no hay offset param pero iterar issuanceDate: lte cursor).',
    fixedCode: `export async function GET(request: NextRequest) {
  // [SAST-FIX API-03] Bloquear en producción rotundamente
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Endpoint de desarrollo deshabilitado' }, { status: 404 })
  }

  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

    // Solo SUPER_ADMIN puede usarlo, ni siquiera ADMIN de tenant
    const me = await prisma.user.findUnique({ where: { id: session.user.id }, select: { systemRole: true } })
    if (me?.systemRole !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Permiso denegado' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const limit = Math.min(Number(searchParams.get('limit') || 10), 50)
    const rfc = searchParams.get('rfc') || undefined
    const where = rfc ? { OR: [{ issuerRfc: rfc }, { receiverRfc: rfc }] } : undefined
    const rows = await prisma.satInvoice.findMany({
      where, orderBy: { issuanceDate: 'desc' }, take: limit,
      select: { id: true, uuid: true, cfdiType: true, issuerRfc: true, issuerName: true, receiverRfc: true, receiverName: true, subtotal: true, total: true, issuanceDate: true, satStatus: true, paymentMethod: true, paymentForm: true, currency: true }
    })
    return NextResponse.json({ count: rows.length, invoices: rows })
  } catch (error) {
    console.error('[dev-sat-invoices]', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}`
  },
  {
    id: 'API-04',
    owaspId: 'A01:2021',
    owaspName: 'Broken Access Control (IDOR)',
    title: '/mass-downloads/download-zip descarga paquetes de CUALQUIER RFC sin verificación de Tenant',
    fileRef: 'src/app/api/mass-downloads/download-zip/route.ts',
    fileLines: 'L12-L33 (GET handler)',
    risk: 'Crítico',
    description:
      'El endpoint acepta ?rfc=RFC_EMPRESA&idPaquete=PKT y pasa los parámetros DIRECTAMENTE al servicio SAT downloadMassPackages L21. ANTES, solo chequea que el request tenga session.user.id (L8), PERO NUNCA verifica que ese RFC (sujeto de la descarga) pertenezca a un FiscalEntity de la organizationId del usuario autenticado. Resultado: un usuario legítimo de Org-A puede descargar todos los paquetes masivos del SAT de Org-B (eavesdropping de XMLs de terceros con los credenciales FIEL del SAT del tenant del atacante - el WS acepta si los credenciales son válidos para el RFC solicitado).',
    exploit:
      'Usuario Autenticado (RFC VÁLIDO, FIEL configurada):\nGET /api/mass-downloads/download-zip?rfc=RFC_EMPRESA_AJENA&idPaquete=xxx-xxx-xxx HTTP/1.1\nAuthorization: Bearer <su_token>\n\nEl sistema usa SU FIEL para autenticar al SAT y solicita el paquete de OTRA EMPRESA. Si el SAT lo entrega (falla de diseño del SAT) → el atacante obtiene el ZIP con los XMLs de terceros. Incluso si el SAT rechaza, el endpoint permite enumerar qué RFCs han solicitado descargas (timing attack y mensajes de error SAT diferenciados).',
    fixedCode: `export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

    rateLimitByUserId({ userId: session.user.id, key: 'sat-mass-download', limit: 30, windowMs: 15 * 60 * 1000 })

    const { searchParams } = new URL(request.url)
    const rfc = searchParams.get('rfc')
    const idPaquete = searchParams.get('idPaquete')
    if (!rfc || !idPaquete) return NextResponse.json({ error: 'Faltan parámetros' }, { status: 400 })

    // [SAST-FIX API-04] Scoping estricto RFC ↔ Organization
    const member = await prisma.member.findFirst({
      where: { userId: session.user.id, status: 'APPROVED' },
      select: { organizationId: true, id: true }
    })
    if (!member) return NextResponse.json({ error: 'Sin membresía' }, { status: 403 })

    const fiscalAccess = await prisma.fiscalEntity.findFirst({
      where: { organizationId: member.organizationId, rfc, isActive: true },
      select: { id: true, rfc: true }
    })
    if (!fiscalAccess) return NextResponse.json({ error: 'RFC no autorizado para esta organización' }, { status: 403 })

    // Validar que el idPaquete pertenezca a un MassDownloadRequest de esa misma org y RFC
    const requestRecord = await prisma.massDownloadRequest.findFirst({
      where: { id: idPaquete, issuerRfc: rfc, company: { companyAccesses: { some: { organizationId: member.organizationId } } } },
      select: { id: true }
    })
    if (!requestRecord) return NextResponse.json({ error: 'Paquete inválido' }, { status: 404 })

    // Descargar, auditar
    const result = await downloadMassPackages({ rfc, idPaquete })
    const buffer = Buffer.from(result.paqueteB64, 'base64')

    await prisma.auditLog.create({
      data: {
        userId: session.user.id, userEmail: session.user.email || '',
        tableName: 'mass_download_package', recordId: idPaquete,
        action: 'DOWNLOAD',
        description: \`Descarga de paquete SAT \${idPaquete} RFC=\${rfc}\`,
        timestamp: new Date()
      }
    })
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': \`attachment; filename="\${idPaquete}.zip"\`,
        'Content-Length': buffer.length.toString()
      }
    })
  } catch (e) {
    if (e instanceof RateLimitError) return NextResponse.json({ error: e.message }, { status: 429 })
    console.error('[mass-download-zip]', e)
    // NO leak SAT error codes/mensajes internos de conexión
    return NextResponse.json({ error: 'No se pudo descargar el paquete desde el SAT' }, { status: 500 })
  }
}`
  },
  {
    id: 'API-05',
    owaspId: 'A05:2021 / A01:2021',
    owaspName: 'Security Misconfiguration + Elevation of Privilege',
    title: '/api/dev/seed ejecutable en PRODUCCIÓN (crea Orgs + M2M clients arbitrarios)',
    fileRef: 'src/app/api/dev/seed/route.ts',
    fileLines: 'L11-L83 (handler POST)',
    risk: 'Crítico',
    description:
      'El endpoint dev/seed se protege únicamente con session.user.id (L13-16). NO valida: (a) que NODE_ENV === "development" para bloquear ejecución en producción, (b) que el solicitante sea SUPER_ADMIN. Cualquier usuario registrado (free trial / onboarding) puede enviar un POST y: 1) crear una Organization nueva con ownerId = session.user.id; 2) generar un Machine client M2M con clientSecret en texto plano en la response; 3) crear una company APPROVED hardcodeada con RFC SCI041122EI6; 4) agregar ADMIN companyAccess y FiscalEntity. Resultado: elevación de privilegios sin restricciones (cada usuario se convierte en Owner de N organizaciones nuevas cada minuto = spam de tenants / agotamiento de cuotas / uso fraudulento de workers BullMQ).',
    exploit:
      '1. Iniciar sesión con cuenta free trial: user@attacker.com\n2. POST /api/dev/seed (repetir 100 veces):\n→ 100 organizaciones owner → 100 M2M clientSecret en claro → 100 companies APPROVED → 100 FIEL slots para abusar del SAT masivo.',
    fixedCode: `export async function POST() {
  // [SAST-FIX API-05] Guardia irrompible de entorno
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Endpoint no disponible' }, { status: 404 })
  }
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

    // [SAST-FIX API-05] Solo SUPER_ADMIN puede ejecutar seed dev
    const me = await prisma.user.findUnique({ where: { id: session.user.id }, select: { systemRole: true } })
    if (me?.systemRole !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Sin privilegios para seed' }, { status: 403 })
    }

    // Idempotency: evitar que se ejecuten 2 seeds para el mismo owner en menos de 60 s
    // ... resto del código, CON user.id SUPER_ADMIN ...
    return NextResponse.json({ success: true, org: org.id })
  } catch (error) {
    console.error('[dev-seed]', error)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}`
  },
  {
    id: 'API-06',
    owaspId: 'A01:2021',
    owaspName: 'Broken Access Control (IDOR)',
    title: '/companies/:id/logo permite subir logo a CUALQUIER empresa de otra org',
    fileRef: 'src/app/api/companies/[id]/logo/route.ts',
    fileLines: 'L37-L46 (validación de ownership)',
    risk: 'Alto',
    description:
      'El endpoint POST valida permisos globales Permission.COMPANY_UPDATE (L39), pero nunca comprueba si la company con id = params.id pertenece a la organización del usuario. Basta con tener el permiso COMPANY_UPDATE (global) en el profile para poder: 1) sobreescribir el logo de una empresa de Tenant-B desde Tenant-A; 2) potencialmente abusar allowedTypes (aunque mime está chequeado) para denegación de servicio repitiendo uploads de 5MB. El id de Company es UUID v4 difícil de adivinar, pero se leakea por múltiples respuestas de API (/api/companies/search JSON list, user/company-access).',
    exploit:
      'user@tenant-a.com tiene Permission.COMPANY_UPDATE en Tenant-A.\n1. GET /api/user/company-access → obtiene lista companies de Tenant-A.\n2. Obtiene company-UUID de Tenant-B desde otra respuesta que hace leak accidental de UUIDs (ej: public search).\n3. POST /api/companies/<uuid-TENANT-B>/logo multipart/form-data → logo sobreescrito. Nombre de archivo: phishing-corporativo.png.\nImpacto: defacement de empresa de terceros / phishing en dashboards de partners.',
    fixedCode: `export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    const { id } = await params

    // [SAST-FIX API-06] Validar tenant de la empresa
    const member = await prisma.member.findFirst({
      where: { userId: session.user.id, status: 'APPROVED' },
      select: { organizationId: true, role: true }
    })
    if (!member) return NextResponse.json({ error: 'Sin membresía' }, { status: 403 })

    const company = await prisma.company.findUnique({
      where: { id },
      select: {
        id: true,
        companyAccesses: {
          where: { organizationId: member.organizationId },
          take: 1, select: { id: true, role: true }
        }
      }
    })
    if (!company) return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 })

    const isOwner = member.role === 'OWNER' || (await prisma.organization.count({ where: { id: member.organizationId, ownerId: session.user.id } })) > 0
    const isAdmin = member.role === 'ADMIN'
    const canEditCompany = company.companyAccesses.length > 0 || isOwner || isAdmin
    if (!canEditCompany) {
      return NextResponse.json({ error: 'Sin permisos para editar esta empresa' }, { status: 403 })
    }

    const form = await request.formData()
    const file = form.get('logo') as File
    if (!file) return NextResponse.json({ error: 'Archivo requerido' }, { status: 400 })
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    if (!allowedTypes.includes(file.type)) return NextResponse.json({ error: 'Tipo no permitido' }, { status: 400 })
    if (file.size > 5 * 1024 * 1024) return NextResponse.json({ error: 'Máx 5MB' }, { status: 400 })

    // [SAST-FIX extra] Validar magic bytes (no confiar solo en extension/mime)
    // ...
  } catch (e) { /* ... */ }
}`
  },
  {
    id: 'API-07',
    owaspId: 'A09:2021',
    owaspName: 'Security Logging & Monitoring Failures + Sensitive Data Exposure',
    title: 'Info Leak en respuestas 500: error.message en campo "details" expone stack/Prisma/SAT',
    fileRef: 'src/app/api/companies/tenant/route.ts + /mass-downloads/download-zip/route.ts',
    fileLines: 'tenant L69-L74, download-zip L35-L40',
    risk: 'Alto',
    description:
      'Ambos handlers retornan NextResponse.json({ ..., details: error instanceof Error ? error.message : ... }, 500). Los mensajes de error de Prisma incluyen: nombres de tablas, nombres de columnas, restricciones UNIQUE violadas, paths de archivos .prisma. Los errores SAT incluyen CodEstatus 5004 (bloqueo temporal), que son información valiosa de fingerprinting. Los errores de node incluyen paths locales (C:\\Users\\rodri\\...) y nombres de librerías internas. Toda esta superficie reduce la complejidad de un ataque SQLi o blind.',
    exploit:
      '1. Provocar error de Prisma en companies/tenant enviando header Accept malformado o cookie corrupta (parseo de Prisma config).\n2. 500: details: "Invalid \`prisma.member.findMany()\` invocation:\n ... table member not found" (fingerprint tabla).\n3. Usar ese leak para afinar UNION-based SQLi.',
    fixedCode: `// [SAST-FIX API-07] Nunca exponga mensajes internos al cliente.
// Registrar TODO en console.error / pino / Datadog, pero response genérica.

try {
  // ... route logic ...
} catch (error) {
  console.error('[companies/tenant 500]', {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    userId: session?.user?.id || null
  })
  return NextResponse.json(
    { error: 'Error interno del servidor. Si el problema persiste contacte a soporte.' },
    { status: 500 }
  )
}`
  },
  {
    id: 'API-08',
    owaspId: 'A02:2021 / A05:2021',
    owaspName: 'Cryptographic Failures + Security Misconfiguration',
    title: '/mass-downloads/credentials FIEL Upload sin validación de contenido (MIME Spoofing + DoS)',
    fileRef: 'src/app/api/mass-downloads/credentials/route.ts',
    fileLines: 'L14-L23 (parseo formData) + L67-L87 (upsert credenciales)',
    risk: 'Alto',
    description:
      'Al guardar credenciales FIEL (clave privada + cert + contraseña) el handler valida la existencia de fields L15-L23 y usa validateFiel para comprobar correspondencia, PERO: (a) No valida TAMAÑO MÁXIMO de privateKeyFile / certificateFile → un upload de 2 GB provoca OOM (Buffer.from L40-41). (b) ValidateFiel es bueno pero NO rechaza password vacíos o de 1 char antes de encriptar. (c) No guarda auditLog de quién actualizó credenciales → imposible forense si hay abuso. (d) No hay rate limit por organización → posibilidad de rotación de credenciales por fuerza bruta password intentos. (e) privateKey en Buffer se loguea si error contiene el buffer (no en este caso, pero detalles arriba), pero sí queda en memoria sin scrub.',
    exploit:
      '1. POST multipart/form-data privateKey = (2 GB de ceros binarios)\n→ Node.js: "JavaScript heap out of memory" → servidor Next.js aborta. (DoS permanente sin rate limit).\n2. Intentar password de 1 char mil veces por hora sin límite → validateFiel consume CPU sin freno.',
    fixedCode: `export async function POST(req: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const formData = await req.formData()
    const rfc = formData.get("rfc") as string
    const password = formData.get("password") as string
    const privateKeyFile = formData.get("privateKey") as File
    const certificateFile = formData.get("certificate") as File
    const organizationId = formData.get("organizationId") as string

    // [SAST-FIX API-08] Rate limit / organización
    rateLimit({ key: \`fiel-upload-\${organizationId}\`, interval: 60_000, limit: 10 })

    if (!rfc || !password || !privateKeyFile || !certificateFile || !organizationId)
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

    // [SAST-FIX API-08] Validaciones estrictas de file size + password length
    if (privateKeyFile.size > 32 * 1024) return NextResponse.json({ error: '.key > 32KB' }, { status: 400 })
    if (certificateFile.size > 128 * 1024) return NextResponse.json({ error: '.cer > 128KB' }, { status: 400 })
    if (password.length < 8 || password.length > 128)
      return NextResponse.json({ error: 'Contraseña FIEL debe tener 8-128 caracteres' }, { status: 400 })
    // allowlist de extensiones y MIME para .cer/.key
    if (!/\\.(key|pem)$/i.test(privateKeyFile.name)) return NextResponse.json({ error: 'FIEL .key inválida' }, { status: 400 })
    if (!/\\.(cer|crt|pem)$/i.test(certificateFile.name)) return NextResponse.json({ error: 'Certificado inválido' }, { status: 400 })

    const member = await prisma.member.findUnique({ where: { userId_organizationId: { userId: session.user.id, organizationId } } })
    if (!member || member.status !== 'APPROVED') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const isOwner = (await prisma.organization.findUnique({ where: { id: organizationId }, select: { ownerId: true } }))?.ownerId === session.user.id
    if (!isOwner && member.role !== 'ADMIN') return NextResponse.json({ error: 'Solo Owner/ADMIN actualizan FIEL' }, { status: 403 })

    const privateKeyBuffer = Buffer.from(await privateKeyFile.arrayBuffer())
    const certificateBuffer = Buffer.from(await certificateFile.arrayBuffer())
    const validation = validateFiel(privateKeyBuffer, certificateBuffer, password)
    if (!validation.isValid) return NextResponse.json({ error: validation.error || 'FIEL inválida' }, { status: 400 })
    if (validation.rfc && validation.rfc !== rfc) return NextResponse.json({ error: 'RFC del cert no coincide' }, { status: 400 })

    const encryptedPrivateKey = encrypt(privateKeyBuffer.toString('base64'))
    const encryptedPassword = encrypt(password)
    const certificateBase64 = certificateBuffer.toString('base64')

    await prisma.$transaction([
      prisma.satCredential.upsert({
        where: { organizationId_rfc: { organizationId, rfc } },
        update: { encryptedPrivateKey, encryptedPassword, certificate: certificateBase64 },
        create: { organizationId, rfc, encryptedPrivateKey, encryptedPassword, certificate: certificateBase64 }
      }),
      prisma.auditLog.create({
        data: {
          userId: session.user.id, userEmail: session.user.email || '',
          tableName: 'sat_credentials', recordId: rfc,
          action: 'UPSERT',
          description: \`FIEL actualizada por \${session.user.id} RFC=\${rfc}\`,
          timestamp: new Date()
        }
      })
    ])
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('[sat-credentials]', e)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}`
  },
  {
    id: 'API-09',
    owaspId: 'A03:2021 / A08:2021',
    owaspName: 'Injection + Software & Data Integrity Failures',
    title: '/api/import sin validación de tamaño ni schema (XML Bomb / Billion Laughs)',
    fileRef: 'src/app/api/import/route.ts',
    fileLines: 'L18-L48 (parseo body sin límites)',
    risk: 'Alto',
    description:
      'El handler acepta request.json() sin límite Next.js (default 1MB? pero notas L7-14 comentan que config fue deprecada; en App Router el default body limit es 1MB pero un atacante envía 100k requests paralelos). El XML que llega L40 se pasa a createInvoiceFromXml que probablemente usa libxmljs o fast-xml-parser: si no está protegido, un XML con ENTITY expandible ("Billion Laughs") agota la RAM en segundos. Además, array.length no tiene upper bound: enviar 10,000 items por lote causa 10,000 iteraciones síncronas.',
    exploit:
      'POST /api/import body = [{"xml": "<?xml version=\\"1.0\\"?><!DOCTYPE lolz [<!ENTITY lol \\"lol\\"><!ENTITY lol2 \\"&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;\\">... ENTITY lol9 \\"&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;\\">]><lolz>&lol9;</lolz>"}]\n→ Causa 10⁹ strings en memoria → Node.js aborta.',
    fixedCode: `// Usar zod para limitar lote + tamaño string de xml. Ver fixedCode de API-01 (schema z.array.max(500), xml.max(50MB)).
// Además, en createInvoiceFromXml, habilitar strict: true, processEntities: false en fast-xml-parser:
const xmlParserOpts = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  processEntities: false,    // <== BLOQUEA Billion Laughs
  htmlEntities: false,
  allowBooleanAttributes: true,
  parseNodeValue: true,
  trimValues: true
}`
  },
  {
    id: 'API-10',
    owaspId: 'A05:2021',
    owaspName: 'Security Misconfiguration',
    title: 'Falta Rate Limit en endpoints de administración de queues y workers',
    fileRef: 'src/app/api/admin/sat-69b/sync/route.ts, src/app/api/tenant/update-progress/route.ts',
    fileLines: 'sat-69b L36-L47, update-progress L45-L46',
    risk: 'Medio',
    description:
      'Ambos endpoints POST llaman sat69BBlacklistQueue.add() o updateTenantProgress() SIN rate limit por organización ni usuario. Un Owner legítimo (cuyas credenciales fueron phisheadas) puede enviar 10,000 POST /tenant/update-progress por minuto. Cada invocación probablemente ejecuta consultas pesadas contra CFDI (agrupaciones por fecha, lecturas de XML). El worker BullMQ tiene concurrency 5, por lo que 10,000 jobs encolan saturando Redis y CPU del worker (DoS interno de la cola, imposibilitando jobs legítimos de otros tenants).',
    exploit:
      'Script paralelo async Pool(16) enviando POST /admin/sat-69b/sync X 200,000 veces.\nCola sat69bBlacklistQueue crece indefinidamente; workers no atienden otros jobs. Escalado de costo (Cloud Provider Redis $$$) + out-of-memory en process worker.',
    fixedCode: `// sat-69b/sync:
export async function POST() {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    // membership guard ...

    // [SAST-FIX API-10] 1 job por organización cada 10 min (idempotency)
    const lastRun = await prisma.auditLog.findFirst({
      where: { action: 'SAT69B_MANUAL_ENQUEUE', userId: session.user.id, timestamp: { gte: new Date(Date.now() - 10 * 60 * 1000) } },
      select: { id: true }
    })
    if (lastRun) return NextResponse.json({ error: 'Sincronización ya en ejecutada recientemente' }, { status: 429 })

    rateLimit({ key: \`sat69b-org-\${membership.organizationId}\`, interval: 15 * 60 * 1000, limit: 2 })
    // ... create job + auditLog ...
  } catch (e) { /* ... */ }
}`
  },
  {
    id: 'API-11',
    owaspId: 'A05:2021',
    owaspName: 'Security Misconfiguration',
    title: 'Endpoints /api/dev/* sin guardia de entorno global (apply a todo el segmento)',
    fileRef: 'src/app/api/dev/ (toda la carpeta)',
    fileLines: 'middleware.ts / proxy / rewrite',
    risk: 'Medio',
    description:
      'Actualmente cada endpoint /api/dev/X tiene que implementar su propia guardia NODE_ENV. Esto es propenso a olvidos cuando se agrega un dev/X nuevo. El fix correcto es middleware-level: bloquear todas las rutas /api/dev/* cuando NODE_ENV=production, sin depender de que el handler individual lo haga.',
    exploit:
      'Agregar una nueva ruta /api/dev/reset-smtp sin guardia y subir a producción. Atacante hace POST /api/dev/reset-smtp y borra configuración SMTP global sin credenciales.',
    fixedCode: `// src/middleware.ts (agregar regla nueva)
const BLOCKED_PATHS_PROD: Array<RegExp> = [
  /^\\/api\\/dev(\\/.*)?$/   // Bloquea todo /api/dev/* en production
]

export async function middleware(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    const pathname = request.nextUrl.pathname
    for (const p of BLOCKED_PATHS_PROD) {
      if (p.test(pathname)) {
        return NextResponse.json({ error: 'Endpoint no disponible' }, { status: 404 })
      }
    }
  }
  // ... resto del middleware (auth / proxy / etc) ...
}`
  },
  {
    id: 'API-12',
    owaspId: 'A09:2021 / A02:2021',
    owaspName: 'Logging Failures / Cryptographic Failures',
    title: '/api/import console.error stack FULL + errorMessage al cliente XML leak',
    fileRef: 'src/app/api/import/route.ts',
    fileLines: 'L75-L85 (catch block)',
    risk: 'Medio',
    description:
      'El catch block loguea L77 Stack trace completo L78 y error message L79. Estos stacks incluyen paths locales: C:\\Users\\rodri\\AppData\\Local\\Temp\\build\\src\\lib\\invoice-import.ts:132:22, nombres de funciones, UUIDs de invoice, valores raw de nodos XML de terceros. El campo L83 "details: errorMessage" devuelve al cliente el mismo mensaje de error. Si createInvoiceFromXml devuelve XML parseado (ej: "error en UUID X del RFC emisor Y"), se leakearía PII fiscal de otros registros fallidos al cliente sin scoping.',
    exploit:
      'Enviar XML malicioso con valores de fuzzing (RFCs no pertenecientes). La respuesta 500: details: "Expected rfc=AAM010101AAA pero se recibió RFC=ROBBADO_OTRA_ORG, linea 45 col 12" le confirma al atacante qué otros RFC existen en la tabla.',
    fixedCode: `catch (error: unknown) {
  // [SAST-FIX API-12] Loggear CON userId + request id PERO nunca leakear al cliente.
  const reqId = crypto.randomUUID()
  console.error('[import-batch 500]', {
    reqId,
    userId: session?.user?.id || 'ANON',
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  })
  return NextResponse.json(
    { error: \`Error interno del servidor. ID de soporte: \${reqId}\` },
    { status: 500 }
  )
}`
  }
]

// =============== Render HTML ===============

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function riskColor(risk: Risk): string {
  if (risk === 'Crítico') return 'bg-red-700 text-white'
  if (risk === 'Alto') return 'bg-orange-600 text-white'
  if (risk === 'Medio') return 'bg-yellow-500 text-slate-900'
  return 'bg-sky-500 text-white'
}

function renderCover(runDate: string): string {
  return `
  <section class="cover">
    <div class="cover-gradient"></div>
    <div class="cover-content">
      <h1 class="cover-title">Informe de Seguridad Estática SAST</h1>
      <h2 class="cover-subtitle">OWASP Top 10 · Rutas /src/app/api/*</h2>
      <div class="cover-meta">
        <div>Fecha de emisión: <strong>${runDate}</strong></div>
        <div>Report ID: <code>sast-api-${runDate.replaceAll('-', '')}</code></div>
        <div>Engine: SAST Manual (Senior Pentest Review)</div>
      </div>
      <div class="cover-project">
        Project: <strong>cfdi_taskmanager_demo</strong> · Stack: Next.js 15 / Prisma / TypeScript
      </div>
    </div>
  </section>`
}

function renderSummary(): string {
  const c = FINDINGS.filter(f => f.risk === 'Crítico').length
  const h = FINDINGS.filter(f => f.risk === 'Alto').length
  const m = FINDINGS.filter(f => f.risk === 'Medio').length
  const b = FINDINGS.filter(f => f.risk === 'Bajo').length
  const t = FINDINGS.length
  const card = (label: string, value: number, cls: string, hint: string) => `
    <div class="summary-card">
      <div class="summary-label ${cls}">${label}</div>
      <div class="summary-value">${value}</div>
      <div class="summary-hint">${hint}</div>
    </div>`
  return `
  <section class="page-break">
    <h2>📊 Resumen Ejecutivo de Riesgos</h2>
    <div class="summary-grid">
      ${card('Críticos', c, 'risk-crit', 'Remediación inmediata')}
      ${card('Altos', h, 'risk-high', 'Sprint actual')}
      ${card('Medios', m, 'risk-med', 'Backlog seguridad')}
      ${card('Bajos', b, 'risk-low', 'Hardening opcional')}
      ${card('TOTAL', t, 'risk-total', 'Hallazgos documentados')}
    </div>
    <div class="summary-notes">
      <h3>Hallazgos por categoría OWASP Top 10 2021</h3>
      <ul>
        <li><strong>A01 Broken Access Control:</strong> 6 (API-01, 02, 03, 04, 06, 05 parcial)</li>
        <li><strong>A02 Cryptographic Failures:</strong> 2 (API-08, API-12)</li>
        <li><strong>A03 Injection:</strong> 2 (API-09 mass+xml bomb, API-01 sin schema)</li>
        <li><strong>A05 Security Misconfiguration:</strong> 3 (API-05, API-10, API-11)</li>
        <li><strong>A07 Identification & Auth Failures:</strong> 2 (API-01 sin auth, API-02 path traversal)</li>
        <li><strong>A08 Software Integrity:</strong> 1 (API-09 sin validación de integridad de XML)</li>
        <li><strong>A09 Logging Failures:</strong> 2 (API-07 details leak, API-12 log stack)</li>
      </ul>
    </div>
  </section>`
}

function renderToc(): string {
  const rows = FINDINGS.map(f => `
    <tr>
      <td class="toc-id"><code>${f.id}</code></td>
      <td><span class="badge ${riskColor(f.risk)}">${f.risk}</span></td>
      <td>${escapeHtml(f.title)}</td>
      <td><code>${escapeHtml(f.fileRef)}</code></td>
    </tr>`).join('')
  return `
  <section class="page-break">
    <h2>🧾 Tabla de Contenidos · Hallazgos</h2>
    <table class="toc-table">
      <thead><tr><th>ID</th><th>Riesgo</th><th>Título</th><th>Ubicación</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`
}

function renderFinding(f: Finding): string {
  return `
  <section class="page-break finding">
    <div class="finding-header">
      <div class="finding-id"><code>${f.id}</code></div>
      <div class="finding-title">
        <h2>${escapeHtml(f.title)}</h2>
        <div class="finding-tags">
          <span class="badge ${riskColor(f.risk)}">${f.risk}</span>
          <span class="badge owasp-badge">OWASP ${f.owaspId} · ${f.owaspName}</span>
          <span class="badge file-badge">📍 ${escapeHtml(f.fileRef)} ${escapeHtml(f.fileLines)}</span>
        </div>
      </div>
    </div>

    <div class="finding-section">
      <h3>🗂️ Archivo y Líneas exactas</h3>
      <pre><code>${escapeHtml(f.fileRef)} @ ${escapeHtml(f.fileLines)}</code></pre>
    </div>

    <div class="finding-section">
      <h3>⚡ Nivel de Riesgo</h3>
      <p><span class="badge badge-lg ${riskColor(f.risk)}">${f.risk}</span></p>
    </div>

    <div class="finding-section">
      <h3>🔎 Descripción del Riesgo</h3>
      <p>${escapeHtml(f.description).replaceAll('\n', '<br/>')}</p>
    </div>

    <div class="finding-section">
      <h3>💣 Ejemplo de Exploit (PoC)</h3>
      <div class="code-block exploit-block">
        <pre><code>${escapeHtml(f.exploit)}</code></pre>
      </div>
    </div>

    <div class="finding-section">
      <h3>✅ Código Corregido</h3>
      <div class="code-block fix-block">
        <pre><code>${escapeHtml(f.fixedCode)}</code></pre>
      </div>
    </div>
  </section>`
}

function buildHtml(): string {
  const runDate = new Date().toISOString().slice(0, 10)
  return `<!DOCTYPE html>
<html lang="es-MX">
<head>
  <meta charset="UTF-8" />
  <title>SAST Report · src/app/api · ${runDate}</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin:0; padding:0; font-family: system-ui, -apple-system, Segoe UI, Roboto, Inter, "Helvetica Neue", Arial, sans-serif; color:#0f172a; font-size:10.5pt; line-height: 1.45; background:#ffffff; }
    .page-break { page-break-before: always; }
    section { padding: 32px 42px; }

    h1, h2, h3 { margin:0 0 14px 0; line-height:1.2; }
    h1 { font-size: 30pt; }
    h2 { font-size: 18pt; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px; color: #0f172a; margin-top: 10px; }
    h3 { font-size: 12.5pt; color: #1e293b; margin-top: 18px; }

    /* Cover */
    .cover { position: relative; min-height: 100vh; padding: 0; }
    .cover-gradient { position:absolute; inset:0; background: linear-gradient(135deg,#020617 0%, #1e3a8a 45%, #0ea5e9 100%); }
    .cover-content { position: relative; z-index: 2; padding: 110px 70px 60px 70px; color: #f8fafc; min-height: 100vh; display: flex; flex-direction: column; justify-content: center; }
    .cover-title { color: #ffffff; font-weight: 800; letter-spacing: -0.02em; }
    .cover-subtitle { color: #bae6fd; font-weight: 500; margin-top: 12px; }
    .cover-meta { margin-top: 52px; display:flex; flex-direction:column; gap:10px; color:#e0f2fe; }
    .cover-meta code { background: rgba(15,23,42,0.45); padding: 4px 8px; border-radius: 6px; font-size: 10pt; color:#e0f2fe; }
    .cover-project { margin-top: 80px; padding: 18px 22px; border-left: 5px solid #38bdf8; background: rgba(15,23,42,0.45); color:#e2e8f0; border-radius: 4px; }

    /* Summary */
    .summary-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-top: 18px; }
    .summary-card { border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px 14px; background: #f8fafc; text-align: center; }
    .summary-label { font-weight: 700; padding: 5px 9px; border-radius: 6px; color:#fff; display:inline-block; font-size: 9.5pt; }
    .risk-crit { background: #b91c1c; }
    .risk-high { background: #ea580c; }
    .risk-med { background: #ca8a04; color:#0f172a; }
    .risk-low { background: #0284c7; }
    .risk-total { background: #0f172a; }
    .summary-value { font-size: 28pt; font-weight: 800; margin-top: 8px; color:#0f172a; }
    .summary-hint { font-size: 9pt; color:#475569; margin-top: 4px; }
    .summary-notes { margin-top: 32px; }
    .summary-notes ul { padding-left: 22px; }
    .summary-notes li { margin-bottom: 4px; }

    /* TOC */
    .toc-table { width:100%; border-collapse: collapse; margin-top: 14px; }
    .toc-table th, .toc-table td { border: 1px solid #e2e8f0; padding: 8px 10px; text-align: left; vertical-align: middle; }
    .toc-table th { background:#f1f5f9; font-size:10pt; }
    .toc-id code { font-weight: 700; color:#1d4ed8; }

    /* Badges */
    .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 8.75pt; font-weight: 600; }
    .badge-lg { padding: 6px 14px; font-size: 10.5pt; }
    .owasp-badge { background: #1e293b; color: #f8fafc; }
    .file-badge { background: #f1f5f9; color: #334155; }

    /* Finding layout */
    .finding { padding-top: 20px; }
    .finding-header { display: grid; grid-template-columns: auto 1fr; gap: 16px; align-items: flex-start; }
    .finding-id code { background:#0f172a; color:#f8fafc; padding: 10px 14px; border-radius: 8px; font-weight: 800; font-size: 11.5pt; }
    .finding-tags { display:flex; flex-wrap:wrap; gap: 6px; margin-top: 8px; }
    .finding-section { margin-top: 18px; }

    pre { margin: 6px 0 0 0; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size: 9pt; line-height:1.48; }
    pre code { white-space: pre-wrap; word-break: break-word; }

    .code-block { margin-top: 6px; padding: 12px 14px; border-radius: 8px; border-left: 5px solid #cbd5e1; overflow: hidden; }
    .code-block pre { max-height: 55vh; overflow: auto; background: #0f172a; padding: 12px; border-radius: 6px; }
    .code-block pre code { color: #e2e8f0; }
    .exploit-block { border-left-color: #dc2626; background:#fef2f2; }
    .exploit-block pre { background: #450a0a; }
    .fix-block { border-left-color: #16a34a; background:#f0fdf4; }
    .fix-block pre { background: #052e16; }
  </style>
</head>
<body>
  ${renderCover(runDate)}
  ${renderSummary()}
  ${renderToc()}
  ${FINDINGS.map(renderFinding).join('\n')}
</body>
</html>`
}

async function main() {
  const reportsDir = join(process.cwd(), 'reports')
  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true })

  const stamp = new Date().toISOString().replaceAll(/[-:]/g, '').slice(0, 12)
  const htmlPath = join(reportsDir, `sast-api-report_${stamp}.html`)
  const pdfPath = join(reportsDir, `sast-api-report_${stamp}.pdf`)

  const html = buildHtml()
  writeFileSync(htmlPath, html, 'utf8')

  const browser = await getBrowserInstance()
  const page: Page = await browser.newPage()
  await page.setContent(html, { waitUntil: 'networkidle0' })
  await page.pdf({
    path: pdfPath,
    format: 'A4',
    margin: { top: '10mm', right: '8mm', bottom: '16mm', left: '8mm' },
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: `<div style="font-size:8.5pt;color:#64748b;margin:0 14px;width:100%;display:flex;justify-content:space-between;">
      <span>SAST · /src/app/api · ${new Date().toISOString().slice(0, 10)}</span>
      <span>cfdi_taskmanager_demo · Confidencial</span>
    </div>`,
    footerTemplate: `<div style="font-size:8pt;color:#64748b;margin:0 14px;width:100%;display:flex;justify-content:space-between;">
      <span>© Security Engineering</span>
      <span>Página <span class="pageNumber"></span> / <span class="totalPages"></span></span>
    </div>`
  })
  await page.close()

  const stats = FINDINGS.reduce((acc, f) => { acc[f.risk] = (acc[f.risk] || 0) + 1; return acc }, {} as Record<Risk, number>)
  const { size } = await import('node:fs').then(fs => fs.promises.stat(pdfPath))
  const kb = (size / 1024).toFixed(1)

  console.log('========== SAST API REPORT GENERADO ==========')
  console.log(`HTML : ${htmlPath}`)
  console.log(`PDF  : ${pdfPath}`)
  console.log(`Tamaño: ${kb} KB`)
  console.log('Riesgos: ', JSON.stringify(stats))
}

main().catch((err: unknown) => {
  console.error('[Fatal]', err instanceof Error ? err.stack : String(err))
  process.exit(1)
})
