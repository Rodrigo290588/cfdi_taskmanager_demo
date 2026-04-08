import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { XMLParser } from 'fast-xml-parser';
import QRCode from 'qrcode';
import puppeteer from 'puppeteer';
import type { Browser } from 'puppeteer';
import { generateTemplateClassicHtml } from '@/components/pdf-templates/TemplateClassic';
import { readFile } from 'fs/promises';
import path from 'path';

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
    if (fileParam) {
      const filePath =
        fileParam.includes(':\\') || fileParam.startsWith('/')
          ? fileParam
          : path.join(process.cwd(), 'java-client', 'xml-data', fileParam);
      xmlRaw = await readFile(filePath, 'utf8');
    } else {
      let invoice: { xmlContent: string } | null = await prisma.invoice.findUnique({
        where: { id },
        select: { xmlContent: true }
      });

      if (!invoice) {
        invoice = await prisma.satInvoice.findUnique({
          where: { id },
          select: { xmlContent: true }
        });
      }

      if (!invoice || !invoice.xmlContent) {
        return NextResponse.json({ error: 'Factura no encontrada o sin XML' }, { status: 404 });
      }
      xmlRaw = (invoice.xmlContent || '').trim();
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
      brandConfig: { primaryColor: '#0f172a' }
    });

    let browser: Browser | null = null
    try {
      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });
      
      const page = await browser.newPage();
      page.setDefaultNavigationTimeout(45000)
      page.setDefaultTimeout(45000)
      await page.setContent(fullHtml, { waitUntil: 'domcontentloaded', timeout: 45000 });
      try {
        // Pequeña espera para permitir aplicar estilos de CDN si están disponibles
        await page.waitForNetworkIdle({ idleTime: 500, timeout: 3000 });
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

      await page.close()

      return new NextResponse(Buffer.from(pdfBuffer), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="cfdi_${timbre['@_UUID'] || id}.pdf"`,
        }
      });
    } finally {
      if (browser) {
        try { await browser.close() } catch {}
      }
    }

  } catch (error) {
    console.error('Error generating PDF:', error);
    return NextResponse.json({ error: 'Error interno al generar el PDF' }, { status: 500 });
  }
}
