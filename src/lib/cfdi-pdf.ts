import { XMLParser } from 'fast-xml-parser'
import QRCode from 'qrcode'
import puppeteer from 'puppeteer'
import type { Browser, Page } from 'puppeteer'
import { generateTemplateClassicHtml } from '@/components/pdf-templates/TemplateClassic'

let cachedBrowser: Browser | null = null

async function getBrowserInstance(): Promise<Browser> {
  if (cachedBrowser && cachedBrowser.isConnected()) {
    return cachedBrowser
  }

  cachedBrowser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  })

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
