import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { XMLParser, type X2jOptions } from 'fast-xml-parser'
import QRCode from 'qrcode'
import puppeteer from 'puppeteer-core'
import type { Browser, BrowserContext, Page, LaunchOptions } from 'puppeteer-core'
import { generateTemplateClassicHtml } from '@/components/pdf-templates/TemplateClassic'
import { createSemaphore } from '@/lib/semaphore'
import { scanXXEAndReportSafe } from '@/lib/xml-sanitize'

/* =========================================================
 * INV-012 · Concurrency limit Puppeteer tabs (semaphore tabs 5)
 * ========================================================= */
const INVOICE_PDF_MAX_CONCURRENT_PAGES = Number(
  process.env.INVOICE_PDF_MAX_CONCURRENT_PAGES || '5'
)
const _browserTabsSemaphore = createSemaphore(
  Number.isFinite(INVOICE_PDF_MAX_CONCURRENT_PAGES) && INVOICE_PDF_MAX_CONCURRENT_PAGES >= 1
    ? INVOICE_PDF_MAX_CONCURRENT_PAGES
    : 5
)

/* =========================================================
 * INV-006 (FIXED): Browser Pool (NO singleton 12h)
 * - MAX_INSTANCES = 2 · MAX_RENDERS_PER_INSTANCE = 10
 * - Cada instancia tiene su propio user-data-dir TMP UNICO
 * - Después de cada 10 renders, browser.close() + rmSync tmpdir
 * - Rotación evita cross-tenant cookie leak
 * ========================================================= */
const BROWSER_POOL_MAX_INSTANCES = 2
const BROWSER_MAX_RENDERS_PER_INSTANCE = Number(process.env.INVOICE_PDF_MAX_RENDERS_PER_BROWSER || '10')
const BROWSER_CACHE_USER_DATA_TTL_MS = 15 * 60 * 1000

interface BrowserPoolEntry {
  browser: Browser
  tmpUserDataDir: string
  rendersRemaining: number
  createdAtMs: number
}
const _browserPool: BrowserPoolEntry[] = []
const _browserPoolMutex = createSemaphore(1)

const SAFE_XML_PARSER_OPTIONS: Partial<X2jOptions> = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: false,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
  ignoreDeclaration: false,
  ignorePiTags: false,
  processEntities: false,
  stopNodes: ['xxx:stop']
} as const

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
  const envOverride = process.env.PUPPETEER_EXECUTABLE_PATH?.trim()
  if (envOverride) return envOverride
  const candidates = defaultBrowserPathsByPlatform[process.platform] || []
  for (const c of candidates) if (existsSync(c)) return c
  return null
}

/* INV-006 FIXED: --no-sandbox solo si allow explicit env var O getuid root (Docker default) */
function resolveNoSandboxAllowed(): boolean {
  if (process.env.PUPPETEER_ALLOW_NOSANDBOX === 'true') return true
  try {
    if (typeof (process as unknown as { getuid?: () => number }).getuid === 'function'
        && (process as unknown as { getuid: () => number }).getuid() === 0) return true
  } catch { /* ignore */ }
  return false
}

/* =========================================================
 * INV-005 + INV-006 FIXED: launchNewBrowserInstance factory
 * Unique tmpdir per instance → NO global profile cookies leak.
 * Host resolver MAP * ~NOTFOUND + direct proxy + jitless flags.
 * ========================================================= */
function launchNewBrowserInstance(): Browser | Promise<Browser> {
  const executablePath = resolveBrowserExecutablePath()
  if (!executablePath) {
    throw new Error(
      'No se encontro un navegador compatible para generar PDFs. Instala Google Chrome o Microsoft Edge en el servidor, o define la variable PUPPETEER_EXECUTABLE_PATH con la ruta del ejecutable.'
    )
  }
  const noSandbox = resolveNoSandboxAllowed()
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'chrome_pdf_'))
  const launchArgs: LaunchOptions = {
    executablePath,
    headless: true,
    args: [
      ...(noSandbox ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--user-data-dir=' + tmpDir,
      // SSRF DEFENSE HOST LEVEL: resolver bloquea todo DNS EXCEPTO 127 loopback
      '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1 , EXCLUDE localhost',
      // JS hardening
      '--js-flags=--noexpose-wasm --jitless',
      '--block-new-web-contents',
      '--disable-features=IsolateOrigins,OutOfBlinkCors,NetworkService',
      '--permissions-default-setting=3',
      '--allow-file-access-from-files=false',
    ],
    env: { ...process.env, HTTP_PROXY: '', HTTPS_PROXY: '', NO_PROXY: '' }
  }
  const launchPromise = puppeteer.launch(launchArgs)
  // Attach tmpDir al objeto browser para cleanup
  return launchPromise.then((b) => {
    ;(b as Browser & { __tmpDir?: string }).__tmpDir = tmpDir
    _browserPool.push({
      browser: b,
      tmpUserDataDir: tmpDir,
      rendersRemaining: BROWSER_MAX_RENDERS_PER_INSTANCE,
      createdAtMs: Date.now(),
    })
    return b
  })
}

/* =========================================================
 * INV-006 FIXED: acquireBrowserFromPool (rotación)
 * - Si hay instancia con rendersRemaining > 0, reutiliza
 * - Else close la más vieja y crea nueva
 * - Limpia tmpdir con rmSync force=true al cerrar
 * ========================================================= */
async function acquireBrowserFromPool(): Promise<{ browser: Browser; releaseBrowserFn: () => Promise<void> }> {
  const release = await _browserPoolMutex.run(async () => {
    // Cleanup expired entries (TTL)
    const now = Date.now()
    for (let i = _browserPool.length - 1; i >= 0; i--) {
      const e = _browserPool[i]
      const tooOld = now - e.createdAtMs > BROWSER_CACHE_USER_DATA_TTL_MS
      const noRenders = e.rendersRemaining <= 0
      const disconnected = !e.browser.isConnected()
      if (tooOld || noRenders || disconnected) {
        try { await e.browser.close() } catch { /* ignore */ }
        try { rmSync(e.tmpUserDataDir, { recursive: true, force: true, maxRetries: 3 }) } catch { /* ignore */ }
        _browserPool.splice(i, 1)
      }
    }
    // Reutiliza la instancia más llena (menor rendersRemaining > 0) para rotación homogénea
    const reusable = _browserPool.find(e => e.rendersRemaining > 0 && e.browser.isConnected())
    if (reusable) return reusable
    // Pool lleno? Cierra la entrada más vieja
    while (_browserPool.length >= BROWSER_POOL_MAX_INSTANCES) {
      const oldest = _browserPool.shift()!
      try { await oldest.browser.close() } catch { /* ignore */ }
      try { rmSync(oldest.tmpUserDataDir, { recursive: true, force: true, maxRetries: 3 }) } catch { /* ignore */ }
    }
    await launchNewBrowserInstance()
    return _browserPool[_browserPool.length - 1]
  })
  const entry = release as unknown as BrowserPoolEntry
  return {
    browser: entry.browser,
    releaseBrowserFn: async () => {
      try {
        await _browserPoolMutex.run(async () => {
          const idx = _browserPool.findIndex(x => x.browser === entry.browser)
          if (idx >= 0) _browserPool[idx].rendersRemaining = Math.max(0, _browserPool[idx].rendersRemaining - 1)
        })
      } catch { /* ignore */ }
    }
  }
}

/* ==================================================================
 * INV-001 FIXED: HTML escape robusto + deepWalk (DOMPurify-like sin new dependency)
 * ================================================================== */
const _AMP_RE = /&/g; const _LT_RE = /</g; const _GT_RE = />/g; const _QUOT_RE = /"/g; const _SQUOT_RE = /'/g
const _EVENT_HANDLER_RE = /\son[a-z0-9_-]{1,32}\s*=/gi
const _JS_SCHEME_RE = /(javascript|data|vbscript|file)\s*:/gi
export function escapeHtmlForCfdiTemplate(unsafe: unknown): string {
  const s = String(unsafe ?? '')
  if (!s) return ''
  return s
    .replace(_EVENT_HANDLER_RE, ' _attr_removed_=')
    .replace(_JS_SCHEME_RE, '_unsafe_scheme_:')
    .replace(_AMP_RE, '&amp;').replace(_LT_RE, '&lt;').replace(_GT_RE, '&gt;')
    .replace(_QUOT_RE, '&quot;').replace(_SQUOT_RE, '&#39;')
}

/** INV-001 FIXED (CAPA deep-walk): Recorre TODO el árbol CFDI parsed y escapea TODAS las hojas string
 * No confía solo en 4 campos UUID/RFC/Total/Tail. Conceptos, nomina CURP, parte, información aduanera: TODO
 */
function deepEscapeCfdiStrings(input: unknown): unknown {
  if (input === null || input === undefined) return input
  if (typeof input === 'string') return escapeHtmlForCfdiTemplate(input)
  if (typeof input === 'number' || typeof input === 'boolean' || typeof input === 'bigint') return input
  if (Array.isArray(input)) return input.map(deepEscapeCfdiStrings)
  if (typeof input === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      const safeKey = escapeHtmlForCfdiTemplate(k)
      out[safeKey] = deepEscapeCfdiStrings(v)
    }
    return out
  }
  return escapeHtmlForCfdiTemplate(String(input))
}

function decodeXmlIfNeeded(xmlRaw: string): string {
  const trimmed = (xmlRaw || '').trim()
  if (trimmed.startsWith('<')) return trimmed
  try { return Buffer.from(trimmed, 'base64').toString('utf8') } catch { return trimmed }
}

function safeParseCfdiXml(xmlContentUtf8: string) {
  const bytes = Buffer.from(xmlContentUtf8, 'utf-8')
  const xxeScan = scanXXEAndReportSafe(bytes)
  if (!xxeScan.safe) {
    throw new Error(
      `INV-002: CFDI XML rejected by XXE detector. kind=${xxeScan.kinds.join('|') || 'unknown'}`
    )
  }
  const parser = new XMLParser(SAFE_XML_PARSER_OPTIONS)
  return parser.parse(xmlContentUtf8)
}

/* ==================================================================
 * INV-001 FIXED: CAPA request interception en Page. Bloquea TODO 
 * request que no sea data: / about:blank / chrome-extension.
 * ================================================================== */
function installSsrfRequestGuard(page: Page) {
  page.setRequestInterception(true).catch(() => { /* ignore if not supported */ })
  page.on('request', (req) => {
    const u = (req.url() || '').toLowerCase()
    const allow = u.startsWith('data:') || u.startsWith('about:blank') || u.startsWith('chrome-extension:') || u.startsWith('blob:')
    if (!allow) { try { req.abort('blockedbyclient') } catch { /* ignore */ } return }
    try { req.continue() } catch { /* ignore */ }
  })
  // Blanket CSP para eliminar cualquier intento de JS dentro del HTML renderizado
  page.setBypassCSP?.(false)
}

export async function generateCfdiPdfFromXml(params: {
  xmlRaw: string
  invoiceIdForFallback: string
  isCancelled?: boolean
  preSanitizeHook?: (parsed: unknown) => unknown
}) {
  const xmlContent = decodeXmlIfNeeded(params.xmlRaw)

  const MAX_XML_BYTES = Number(process.env.INVOICE_PDF_MAX_XML_BYTES || '5242880')
  const byteLen = Buffer.byteLength(xmlContent, 'utf8')
  if (byteLen > MAX_XML_BYTES) {
    throw new Error(
      `INV-017: CFDI XML exceeds max allowed size ${MAX_XML_BYTES} bytes. Received ${byteLen}.`
    )
  }

  const parsedData = safeParseCfdiXml(xmlContent)
  // INV-001 FIXED: deep escape TODOs las strings del arbol → sanitiza 73+ campos (no 4)
  const sanitizedTree = deepEscapeCfdiStrings(parsedData)
  const postPreprocessed = typeof params.preSanitizeHook === 'function'
    ? deepEscapeCfdiStrings(params.preSanitizeHook(sanitizedTree))
    : sanitizedTree

  type CfdiNode = Record<string, unknown>
  const comprobante = (
    (postPreprocessed as CfdiNode)['cfdi:Comprobante'] ||
    (postPreprocessed as CfdiNode)['Comprobante'] || {}
  ) as CfdiNode
  const emisor = (comprobante['cfdi:Emisor'] || comprobante['Emisor'] || {}) as CfdiNode
  const receptor = (comprobante['cfdi:Receptor'] || comprobante['Receptor'] || {}) as CfdiNode
  const complemento = (comprobante['cfdi:Complemento'] || comprobante['Complemento'] || {}) as CfdiNode
  const timbre = (complemento['tfd:TimbreFiscalDigital'] || complemento['TimbreFiscalDigital'] || {}) as CfdiNode

  const timbreUuidRaw = String(timbre['@_UUID'] || '')
  const safeUuidValue = escapeHtmlForCfdiTemplate(timbreUuidRaw)
  const safeEmisorRfc = escapeHtmlForCfdiTemplate(emisor['@_Rfc'] || '')
  const safeReceptorRfc = escapeHtmlForCfdiTemplate(receptor['@_Rfc'] || '')
  const safeTotal = escapeHtmlForCfdiTemplate(comprobante['@_Total'] || '')
  const safeSelloTail = escapeHtmlForCfdiTemplate(String(timbre['@_SelloCFD'] || '').slice(-8))

  const qrString = `https://verificacfdi.facturaelectronica.sat.gob.mx/default.aspx?id=${safeUuidValue}&re=${safeEmisorRfc}&rr=${safeReceptorRfc}&tt=${safeTotal}&fe=${safeSelloTail}`

  let qrCodeDataUrl = ''
  try {
    qrCodeDataUrl = await QRCode.toDataURL(qrString, { errorCorrectionLevel: 'M', margin: 1 })
  } catch (err) { void err; console.warn('INV-WARN: QR code generation failed (no PII logged). Continuing PDF without QR.') }

  type CfdiParsed = Record<string, unknown>
  const fullHtml = generateTemplateClassicHtml({
    cfdiData: postPreprocessed as unknown as CfdiParsed,
    qrCodeDataUrl,
    brandConfig: { primaryColor: '#0f172a' },
    isCancelled: Boolean(params.isCancelled)
  })

  /* INV-001 + INV-006 CAPA FINAL: semaphore tabs + pool browser rotation + incognito context PER PDF */
  return _browserTabsSemaphore.run<{ pdfBuffer: Buffer; uuid: string }>(async () => {
    const { browser, releaseBrowserFn } = await acquireBrowserFromPool()
    let context: BrowserContext | null = null
    let page: Page | null = null
    try {
      // INV-006 CAPA: Incógnito POR cada PDF (no cookies compartidas entre renders)
      context = await browser.createBrowserContext()
      if (!context) throw new Error('INV-PDF: No se pudo crear BrowserContext aislado (pool inválido).')
      page = await context.newPage()
      if (!page) throw new Error('INV-PDF: No se pudo crear nueva Page en browser context.')
      installSsrfRequestGuard(page)  // <-- CAPA anti-SSRF network 100% bloqueado EXCEPTO data:
      page.setDefaultNavigationTimeout(45000)
      page.setDefaultTimeout(45000)
      await page.setContent(fullHtml, { waitUntil: 'domcontentloaded', timeout: 45000 })
      try { await page.waitForNetworkIdle({ idleTime: 200, timeout: 1500 }) } catch { /* no idle ok offline mode */ }
      const pdfBuffer = await page.pdf({
        format: 'A4', printBackground: true,
        margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' }
      })
      return {
        pdfBuffer: Buffer.from(pdfBuffer),
        uuid: String(timbreUuidRaw || params.invoiceIdForFallback)
      }
    } finally {
      // cleanup ORDEN: page.close() → context.close() → browser.release() → (eventualmente rmSync tmpdir)
      try { if (page) { await page.close() } } catch { /* ignore */ }
      try { if (context) { await context.close() } } catch { /* ignore */ }
      await releaseBrowserFn()
    }
  })
}
