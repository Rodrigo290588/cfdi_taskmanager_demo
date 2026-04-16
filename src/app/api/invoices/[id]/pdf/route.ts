import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { XMLParser } from 'fast-xml-parser';
import QRCode from 'qrcode';
import puppeteer from 'puppeteer';
import type { Browser, Page } from 'puppeteer';
import { generateTemplateClassicHtml } from '@/components/pdf-templates/TemplateClassic';
import { readFile } from 'fs/promises';
import path from 'path';

let cachedBrowser: Browser | null = null;

async function getBrowserInstance(): Promise<Browser> {
  if (cachedBrowser && cachedBrowser.isConnected()) {
    return cachedBrowser;
  }
  cachedBrowser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  return cachedBrowser;
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const fileParam = request.nextUrl.searchParams.get('file');
    let xmlRaw = '';
    let isCancelled = false;
    if (fileParam) {
      const filePath =
        fileParam.includes(':\\') || fileParam.startsWith('/')
          ? fileParam
          : path.join(process.cwd(), 'java-client', 'xml-data', fileParam);
      xmlRaw = await readFile(filePath, 'utf8');
    } else {
      let invoice: { xmlContent: string, satStatus?: string | null } | null = await prisma.invoice.findUnique({
        where: { id },
        select: { xmlContent: true, satStatus: true }
      });

      if (!invoice) {
        invoice = await prisma.satInvoice.findUnique({
          where: { id },
          select: { xmlContent: true, satStatus: true }
        });
      }

      if (!invoice || !invoice.xmlContent) {
        return NextResponse.json({ error: 'Factura no encontrada o sin XML' }, { status: 404 });
      }
      xmlRaw = (invoice.xmlContent || '').trim();
      if (invoice.satStatus === 'CANCELADO') {
        isCancelled = true;
      }
    }

    if (!xmlRaw.startsWith('<')) {
      try {
        xmlRaw = Buffer.from(xmlRaw, 'base64').toString('utf8');
      } catch {}
    }
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
    });
    const parsedData = parser.parse(xmlRaw);

    const comprobante = parsedData['cfdi:Comprobante'] || parsedData['Comprobante'] || {};
    const emisor = comprobante['cfdi:Emisor'] || comprobante['Emisor'] || {};
    const receptor = comprobante['cfdi:Receptor'] || comprobante['Receptor'] || {};
    const complemento = comprobante['cfdi:Complemento'] || comprobante['Complemento'] || {};
    const timbre = complemento?.['tfd:TimbreFiscalDigital'] || complemento?.['TimbreFiscalDigital'] || {};

    const qrString = `https://verificacfdi.facturaelectronica.sat.gob.mx/default.aspx?id=${timbre['@_UUID'] || ''}&re=${emisor['@_Rfc'] || ''}&rr=${receptor['@_Rfc'] || ''}&tt=${comprobante['@_Total'] || ''}&fe=${(timbre['@_SelloCFD'] || '').slice(-8)}`;
    
    let qrCodeDataUrl = '';
    try {
      qrCodeDataUrl = await QRCode.toDataURL(qrString, { errorCorrectionLevel: 'M', margin: 1 });
    } catch (e) {
      console.error('Error generating QR code', e);
    }

    const fullHtml = generateTemplateClassicHtml({
      cfdiData: parsedData,
      qrCodeDataUrl,
      brandConfig: { primaryColor: '#0f172a' },
      isCancelled
    });

    let browser: Browser | null = null
    let page: Page | null = null;
    try {
      browser = await getBrowserInstance();
      
      page = await browser.newPage();
      page.setDefaultNavigationTimeout(45000)
      page.setDefaultTimeout(45000)
      await page.setContent(fullHtml, { waitUntil: 'domcontentloaded', timeout: 45000 });
      try {
        // Reducimos el tiempo de espera a 200ms para no bloquear tanto la generación
        await page.waitForNetworkIdle({ idleTime: 200, timeout: 2000 });
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
      });

      return new NextResponse(Buffer.from(pdfBuffer), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="cfdi_${timbre['@_UUID'] || id}.pdf"`,
        }
      });
    } finally {
      if (page) {
        try { await page.close() } catch {}
      }
      // No cerramos el browser aquí para reusarlo en futuras peticiones
    }

  } catch (error) {
    console.error('Error generating PDF:', error);
    return NextResponse.json({ error: 'Error interno al generar el PDF' }, { status: 500 });
  }
}
