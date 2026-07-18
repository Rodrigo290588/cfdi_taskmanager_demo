import { existsSync } from 'node:fs'
import { XMLParser } from 'fast-xml-parser'
import QRCode from 'qrcode'
import puppeteer from 'puppeteer-core'
import type { Browser, Page, LaunchOptions } from 'puppeteer-core'
import { generateTemplateClassicHtml } from '@/components/pdf-templates/TemplateClassic'

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
  aix: [],
  android: [],
  freebsd: [],
  haiku: [],
  openbsd: [],
  sunos: [],
  cygwin: [],
  netbsd: [],
}

function resolveBrowserExecutablePath() {
  const browserPathFromEnv = process.env.PUPPETEER_EXECUTABLE_PATH?.trim()

  if (browserPathFromEnv) {
    return browserPathFromEnv
  }

  const candidates = defaultBrowserPathsByPlatform[process.platform] || []

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

async function getBrowserInstance(): Promise<Browser> {
  if (cachedBrowser && cachedBrowser.isConnected()) {
    return cachedBrowser
  }

  const executablePath = resolveBrowserExecutablePath()

  if (!executablePath) {
    throw new Error(
      'No se encontro un navegador compatible para generar PDFs. Instala Google Chrome o Microsoft Edge en el servidor, o define la variable PUPPETEER_EXECUTABLE_PATH con la ruta del ejecutable.'
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

function decodeXmlIfNeeded(xmlRaw: string) {
  const normalizedXml = (xmlRaw || '').trim()
  if (normalizedXml.startsWith('<')) {
    return normalizedXml
  }

  try {
    return Buffer.from(normalizedXml, 'base64').toString('utf8')
  } catch {
    return normalizedXml
  }
}

export async function generateCfdiPdfFromXml(params: {
  xmlRaw: string
  invoiceIdForFallback: string
  isCancelled?: boolean
}) {
  const xmlContent = decodeXmlIfNeeded(params.xmlRaw)
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_'
  })
  const parsedData = parser.parse(xmlContent)

  const comprobante = parsedData['cfdi:Comprobante'] || parsedData['Comprobante'] || {}
  const emisor = comprobante['cfdi:Emisor'] || comprobante['Emisor'] || {}
  const receptor = comprobante['cfdi:Receptor'] || comprobante['Receptor'] || {}
  const complemento = comprobante['cfdi:Complemento'] || comprobante['Complemento'] || {}
  const timbre = complemento?.['tfd:TimbreFiscalDigital'] || complemento?.['TimbreFiscalDigital'] || {}

  const qrString = `https://verificacfdi.facturaelectronica.sat.gob.mx/default.aspx?id=${timbre['@_UUID'] || ''}&re=${emisor['@_Rfc'] || ''}&rr=${receptor['@_Rfc'] || ''}&tt=${comprobante['@_Total'] || ''}&fe=${(timbre['@_SelloCFD'] || '').slice(-8)}`

  let qrCodeDataUrl = ''
  try {
    qrCodeDataUrl = await QRCode.toDataURL(qrString, { errorCorrectionLevel: 'M', margin: 1 })
  } catch (error) {
    console.error('Error generating QR code', error)
  }

  const fullHtml = generateTemplateClassicHtml({
    cfdiData: parsedData,
    qrCodeDataUrl,
    brandConfig: { primaryColor: '#0f172a' },
    isCancelled: Boolean(params.isCancelled)
  })

  let page: Page | null = null

  try {
    const browser = await getBrowserInstance()
    page = await browser.newPage()
    page.setDefaultNavigationTimeout(45000)
    page.setDefaultTimeout(45000)
    await page.setContent(fullHtml, { waitUntil: 'domcontentloaded', timeout: 45000 })

    try {
      await page.waitForNetworkIdle({ idleTime: 200, timeout: 2000 })
    } catch {}

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '20px',
        right: '20px',
        bottom: '20px',
        left: '20px'
      }
    })

    return {
      pdfBuffer: Buffer.from(pdfBuffer),
      uuid: String(timbre['@_UUID'] || params.invoiceIdForFallback)
    }
  } finally {
    if (page) {
      try {
        await page.close()
      } catch {}
    }
  }
}
