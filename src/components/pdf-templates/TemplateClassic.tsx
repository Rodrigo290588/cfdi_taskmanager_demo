interface Concepto {
  '@_ClaveProdServ'?: string;
  '@_Cantidad'?: number | string;
  '@_ClaveUnidad'?: string;
  '@_Descripcion'?: string;
  '@_ValorUnitario'?: number | string;
  '@_Importe'?: number | string;
}

interface TimbreFiscalDigital {
  '@_UUID'?: string;
  '@_SelloCFD'?: string;
  '@_SelloSAT'?: string;
  '@_Version'?: string;
  '@_FechaTimbrado'?: string;
  '@_RfcProvCertif'?: string;
  '@_NoCertificadoSAT'?: string;
}

interface CfdiComprobante {
  '@_Serie'?: string;
  '@_Folio'?: string;
  '@_Fecha'?: string;
  '@_LugarExpedicion'?: string;
  '@_TipoDeComprobante'?: string;
  '@_FormaPago'?: string;
  '@_MetodoPago'?: string;
  '@_Moneda'?: string;
  '@_SubTotal'?: number | string;
  '@_Descuento'?: number | string;
  '@_Total'?: number | string;
  '@_NoCertificado'?: string;
  'cfdi:Emisor'?: {
    '@_Nombre'?: string;
    '@_Rfc'?: string;
    '@_RegimenFiscal'?: string;
  };
  'cfdi:Receptor'?: {
    '@_Nombre'?: string;
    '@_Rfc'?: string;
    '@_UsoCFDI'?: string;
    '@_RegimenFiscalReceptor'?: string;
    '@_DomicilioFiscalReceptor'?: string;
  };
  'cfdi:Conceptos'?: {
    'cfdi:Concepto'?: Concepto | Concepto[];
  };
  'cfdi:Impuestos'?: {
    '@_TotalImpuestosTrasladados'?: number | string;
    '@_TotalImpuestosRetenidos'?: number | string;
  };
  'cfdi:Complemento'?: {
    'tfd:TimbreFiscalDigital'?: TimbreFiscalDigital;
  };
}

interface CfdiParsed {
  'cfdi:Comprobante'?: CfdiComprobante;
  'Comprobante'?: CfdiComprobante;
}

export interface InvoiceTemplateProps {
  cfdiData: CfdiParsed;
  qrCodeDataUrl: string;
  brandConfig?: {
    logoUrl?: string;
    primaryColor?: string;
  };
}

export const generateTemplateClassicHtml = ({ cfdiData, qrCodeDataUrl, brandConfig }: InvoiceTemplateProps): string => {
  const comprobante: CfdiComprobante = cfdiData['cfdi:Comprobante'] || cfdiData['Comprobante'] || {};
  const get = <T,>(obj: unknown, key: string): T | undefined => {
    if (obj && typeof obj === 'object' && key in (obj as Record<string, unknown>)) {
      return (obj as Record<string, unknown>)[key] as T;
    }
    return undefined;
  };
  const emisor = comprobante['cfdi:Emisor'] || get<CfdiComprobante['cfdi:Emisor']>(comprobante, 'Emisor') || {};
  const receptor = comprobante['cfdi:Receptor'] || get<CfdiComprobante['cfdi:Receptor']>(comprobante, 'Receptor') || {};
  const conceptosContainer = comprobante['cfdi:Conceptos'] || get<CfdiComprobante['cfdi:Conceptos']>(comprobante, 'Conceptos');
  const conceptos = conceptosContainer?.['cfdi:Concepto'] ?? get<Concepto | Concepto[]>(conceptosContainer, 'Concepto');
  const conceptosArray: Concepto[] = Array.isArray(conceptos) ? conceptos : conceptos ? [conceptos] : [];
  const complemento = comprobante['cfdi:Complemento'] || get<CfdiComprobante['cfdi:Complemento']>(comprobante, 'Complemento') || {};
  const timbre: TimbreFiscalDigital = complemento?.['tfd:TimbreFiscalDigital'] || get<TimbreFiscalDigital>(complemento, 'TimbreFiscalDigital') || {};

  const formatCurrency = (amount: number | string | undefined) => {
    if (!amount && amount !== 0) return '$0.00';
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(amount));
  };

  const primaryColor = brandConfig?.primaryColor || '#1e3a8a';

  const conceptosHtml = conceptosArray.map((c: Concepto) => `
    <tr class="border-b border-slate-200">
      <td class="py-2 px-3">${c['@_ClaveProdServ'] || ''}</td>
      <td class="py-2 px-3">${c['@_Cantidad'] || ''}</td>
      <td class="py-2 px-3">${c['@_ClaveUnidad'] || ''}</td>
      <td class="py-2 px-3 text-xs">${c['@_Descripcion'] || ''}</td>
      <td class="py-2 px-3 text-right">${formatCurrency(c['@_ValorUnitario'])}</td>
      <td class="py-2 px-3 text-right font-medium">${formatCurrency(c['@_Importe'])}</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <title>Factura ${comprobante['@_Serie'] || ''}${comprobante['@_Folio'] || ''}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
      body { font-family: 'Inter', sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .primary-bg { background-color: ${primaryColor}; }
      .primary-text { color: ${primaryColor}; }
    </style>
  </head>
  <body class="bg-white text-slate-800 p-8 text-sm">
    
    <!-- Header -->
    <div class="flex justify-between items-start mb-8">
      <div class="w-1/2">
        ${brandConfig?.logoUrl ? `
          <img src="${brandConfig.logoUrl}" alt="Logo" class="max-h-20 object-contain mb-4" />
        ` : `
          <div class="text-3xl font-bold primary-text mb-4">${emisor['@_Nombre'] || 'EMISOR'}</div>
        `}
        <div class="font-semibold text-lg">${emisor['@_Nombre'] || ''}</div>
        <div class="text-slate-600">RFC: ${emisor['@_Rfc'] || ''}</div>
        <div class="text-slate-600">Régimen Fiscal: ${emisor['@_RegimenFiscal'] || ''}</div>
      </div>
      
      <div class="w-1/2 text-right">
        <h1 class="text-4xl font-bold primary-text mb-2">FACTURA</h1>
        <div class="text-slate-600 mb-1">
          <span class="font-semibold">Folio:</span> ${comprobante['@_Serie'] || ''}${comprobante['@_Folio'] || 'S/N'}
        </div>
        <div class="text-slate-600 mb-1">
          <span class="font-semibold">Fecha:</span> ${comprobante['@_Fecha'] || ''}
        </div>
        <div class="text-slate-600 mb-1">
          <span class="font-semibold">Lugar de Expedición:</span> ${comprobante['@_LugarExpedicion'] || ''}
        </div>
        <div class="text-slate-600 mb-1">
          <span class="font-semibold">Tipo de Comprobante:</span> ${comprobante['@_TipoDeComprobante'] || ''}
        </div>
      </div>
    </div>

    <!-- Client Info -->
    <div class="border border-slate-200 rounded-lg p-4 mb-8 flex justify-between bg-slate-50">
      <div>
        <h3 class="font-bold text-slate-700 mb-2 border-b pb-1">RECEPTOR</h3>
        <div class="font-semibold text-base">${receptor['@_Nombre'] || ''}</div>
        <div class="text-slate-600">RFC: ${receptor['@_Rfc'] || ''}</div>
        <div class="text-slate-600">Uso CFDI: ${receptor['@_UsoCFDI'] || ''}</div>
        <div class="text-slate-600">Régimen Fiscal: ${receptor['@_RegimenFiscalReceptor'] || ''}</div>
        <div class="text-slate-600">C.P.: ${receptor['@_DomicilioFiscalReceptor'] || ''}</div>
      </div>
      <div class="text-right">
        <h3 class="font-bold text-slate-700 mb-2 border-b pb-1">DATOS DE PAGO</h3>
        <div class="text-slate-600"><span class="font-semibold">Forma de Pago:</span> ${comprobante['@_FormaPago'] || ''}</div>
        <div class="text-slate-600"><span class="font-semibold">Método de Pago:</span> ${comprobante['@_MetodoPago'] || ''}</div>
        <div class="text-slate-600"><span class="font-semibold">Moneda:</span> ${comprobante['@_Moneda'] || ''}</div>
      </div>
    </div>

    <!-- Concepts Table -->
    <table class="w-full mb-8 border-collapse">
      <thead>
        <tr class="primary-bg text-white">
          <th class="py-2 px-3 text-left font-semibold">ClaveProdServ</th>
          <th class="py-2 px-3 text-left font-semibold">Cant</th>
          <th class="py-2 px-3 text-left font-semibold">ClaveUnidad</th>
          <th class="py-2 px-3 text-left font-semibold">Descripción</th>
          <th class="py-2 px-3 text-right font-semibold">V. Unitario</th>
          <th class="py-2 px-3 text-right font-semibold">Importe</th>
        </tr>
      </thead>
      <tbody>
        ${conceptosHtml}
      </tbody>
    </table>

    <!-- Totals -->
    <div class="flex justify-end mb-8">
      <div class="w-1/3">
        <div class="flex justify-between py-1">
          <span class="text-slate-600">Subtotal:</span>
          <span class="font-semibold">${formatCurrency(comprobante['@_SubTotal'])}</span>
        </div>
        ${comprobante['@_Descuento'] ? `
          <div class="flex justify-between py-1 text-red-600">
            <span>Descuento:</span>
            <span>-${formatCurrency(comprobante['@_Descuento'])}</span>
          </div>
        ` : ''}
        
        <!-- Impuestos -->
        ${comprobante['cfdi:Impuestos']?.['@_TotalImpuestosTrasladados'] ? `
          <div class="flex justify-between py-1">
            <span class="text-slate-600">Impuestos Trasladados:</span>
            <span class="font-semibold">${formatCurrency(comprobante['cfdi:Impuestos']['@_TotalImpuestosTrasladados'])}</span>
          </div>
        ` : ''}
        ${comprobante['cfdi:Impuestos']?.['@_TotalImpuestosRetenidos'] ? `
          <div class="flex justify-between py-1 text-red-600">
            <span>Impuestos Retenidos:</span>
            <span>-${formatCurrency(comprobante['cfdi:Impuestos']['@_TotalImpuestosRetenidos'])}</span>
          </div>
        ` : ''}

        <div class="flex justify-between py-2 mt-2 border-t-2 border-slate-800 text-lg font-bold">
          <span>Total:</span>
          <span>${formatCurrency(comprobante['@_Total'])}</span>
        </div>
      </div>
    </div>

    <!-- SAT Info & QR -->
    <div class="border-t border-slate-300 pt-6 flex gap-6 text-xs text-slate-500 break-all">
      <div class="w-32 flex-shrink-0">
        ${qrCodeDataUrl ? `<img src="${qrCodeDataUrl}" alt="QR Code" class="w-full h-auto" />` : ''}
      </div>
      <div class="flex-1 space-y-3">
        <div>
          <span class="font-semibold block text-slate-700">Folio Fiscal (UUID):</span>
          ${timbre['@_UUID'] || 'No certificado'}
        </div>
        <div>
          <span class="font-semibold block text-slate-700">Sello Digital del CFDI:</span>
          ${timbre['@_SelloCFD'] || ''}
        </div>
        <div>
          <span class="font-semibold block text-slate-700">Sello del SAT:</span>
          ${timbre['@_SelloSAT'] || ''}
        </div>
        <div>
          <span class="font-semibold block text-slate-700">Cadena Original del complemento de certificación digital del SAT:</span>
          ${timbre['@_Version'] ? `||${timbre['@_Version']}|${timbre['@_UUID']}|${timbre['@_FechaTimbrado']}|${timbre['@_RfcProvCertif']}|${timbre['@_SelloCFD']}|${timbre['@_NoCertificadoSAT']}||` : ''}
        </div>
        <div class="flex justify-between text-slate-600 pt-2">
          <span><span class="font-semibold">No. Certificado Emisor:</span> ${comprobante['@_NoCertificado'] || ''}</span>
          <span><span class="font-semibold">No. Certificado SAT:</span> ${timbre['@_NoCertificadoSAT'] || ''}</span>
          <span><span class="font-semibold">Fecha Timbrado:</span> ${timbre['@_FechaTimbrado'] || ''}</span>
        </div>
      </div>
    </div>

    <div class="mt-8 text-center text-slate-400 text-xs italic">
      Este documento es una representación impresa de un CFDI.
    </div>
  </body>
</html>`;
};
