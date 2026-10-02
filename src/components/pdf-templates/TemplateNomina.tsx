import { InvoiceTemplateProps } from './TemplateClassic';

type RecordUnknown = Record<string, unknown>;

const get = <T,>(obj: unknown, key: string): T | undefined => {
  if (obj && typeof obj === 'object' && key in (obj as RecordUnknown)) {
    return (obj as RecordUnknown)[key] as T;
  }
  return undefined;
};

const safeString = (val: unknown): string => {
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  return '';
};

const formatCurrency = (amount: unknown) => {
  const num = typeof amount === 'number' ? amount : Number(amount);
  if (Number.isNaN(num) || num === 0) return '$0.00';
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(num);
};

const getTipoNominaLabel = (tipo: unknown): string => {
  if (tipo === 'O') return 'Ordinaria';
  if (tipo === 'E') return 'Extraordinaria';
  return safeString(tipo);
};

const renderPercepciones = (percepcionesArray: RecordUnknown[]) => {
  if (percepcionesArray.length === 0) {
    return '<div class="text-xs text-slate-500 italic py-2">No hay percepciones</div>';
  }
  
  const percepcionesHtml = percepcionesArray.map((p: RecordUnknown) => `
    <tr class="border-b border-slate-200">
      <td class="py-1 px-2">${safeString(p['@_TipoPercepcion'])}</td>
      <td class="py-1 px-2">${safeString(p['@_Clave'])}</td>
      <td class="py-1 px-2">${safeString(p['@_Concepto'])}</td>
      <td class="py-1 px-2 text-right">${formatCurrency(p['@_ImporteGravado'])}</td>
      <td class="py-1 px-2 text-right">${formatCurrency(p['@_ImporteExento'])}</td>
    </tr>
  `).join('');

  return `
  <table class="w-full text-xs border-collapse">
    <thead>
      <tr class="bg-slate-100 text-slate-600">
        <th class="py-1 px-2 text-left">Tipo</th>
        <th class="py-1 px-2 text-left">Clave</th>
        <th class="py-1 px-2 text-left">Concepto</th>
        <th class="py-1 px-2 text-right">Gravado</th>
        <th class="py-1 px-2 text-right">Exento</th>
      </tr>
    </thead>
    <tbody>
      ${percepcionesHtml}
    </tbody>
  </table>
  `;
};

const renderDeducciones = (deduccionesArray: RecordUnknown[]) => {
  if (deduccionesArray.length === 0) {
    return '<div class="text-xs text-slate-500 italic py-2">No hay deducciones</div>';
  }
  
  const deduccionesHtml = deduccionesArray.map((d: RecordUnknown) => `
    <tr class="border-b border-slate-200">
      <td class="py-1 px-2">${safeString(d['@_TipoDeduccion'])}</td>
      <td class="py-1 px-2">${safeString(d['@_Clave'])}</td>
      <td class="py-1 px-2">${safeString(d['@_Concepto'])}</td>
      <td class="py-1 px-2 text-right">${formatCurrency(d['@_Importe'])}</td>
    </tr>
  `).join('');

  return `
  <table class="w-full text-xs border-collapse">
    <thead>
      <tr class="bg-slate-100 text-slate-600">
        <th class="py-1 px-2 text-left">Tipo</th>
        <th class="py-1 px-2 text-left">Clave</th>
        <th class="py-1 px-2 text-left">Concepto</th>
        <th class="py-1 px-2 text-right">Importe</th>
      </tr>
    </thead>
    <tbody>
      ${deduccionesHtml}
    </tbody>
  </table>
  `;
};

const renderOtrosPagos = (otrosPagosArray: RecordUnknown[]) => {
  if (otrosPagosArray.length === 0) return '';
  
  const otrosPagosHtml = otrosPagosArray.map((o: RecordUnknown) => `
    <tr class="border-b border-slate-200">
      <td class="py-1 px-2">${safeString(o['@_TipoOtroPago'])}</td>
      <td class="py-1 px-2">${safeString(o['@_Clave'])}</td>
      <td class="py-1 px-2">${safeString(o['@_Concepto'])}</td>
      <td class="py-1 px-2 text-right">${formatCurrency(o['@_Importe'])}</td>
    </tr>
  `).join('');

  return `
  <table class="w-full text-xs border-collapse">
    <thead>
      <tr class="bg-slate-100 text-slate-600">
        <th class="py-1 px-2 text-left">Tipo</th>
        <th class="py-1 px-2 text-left">Clave</th>
        <th class="py-1 px-2 text-left">Concepto</th>
        <th class="py-1 px-2 text-right">Importe</th>
      </tr>
    </thead>
    <tbody>
      ${otrosPagosHtml}
    </tbody>
  </table>
  `;
};

const renderCadenaOriginal = (timbre: RecordUnknown): string => {
  if (!timbre['@_Version']) return '';
  return `||${safeString(timbre['@_Version'])}|${safeString(timbre['@_UUID'])}|${safeString(timbre['@_FechaTimbrado'])}|${safeString(timbre['@_RfcProvCertif'])}|${safeString(timbre['@_SelloCFD'])}|${safeString(timbre['@_NoCertificadoSAT'])}||`;
};

const renderBrandHeader = (brandConfig: RecordUnknown | undefined): string => {
  if (brandConfig?.logoUrl) {
    return `<img src="${safeString(brandConfig.logoUrl)}" alt="Logo" class="max-h-16 object-contain mb-2" />`;
  }
  return '<div class="text-2xl font-bold primary-text mb-2">EMPRESA DEMO</div>';
};

const renderDescuento = (comprobante: RecordUnknown): string => {
  if (!comprobante['@_Descuento']) return '';
  return `
    <div class="flex justify-between py-1 text-sm text-red-600">
      <span>Descuento:</span>
      <span>-${formatCurrency(comprobante['@_Descuento'])}</span>
    </div>
  `;
};

const renderWatermark = (isCancelled: boolean): string => {
  return isCancelled ? '<div class="watermark">CANCELADO</div>' : '';
};

const renderQrCode = (qrCodeDataUrl: string | undefined): string => {
  return qrCodeDataUrl ? `<img src="${safeString(qrCodeDataUrl)}" alt="QR Code" class="w-full h-auto" />` : '';
};

const renderOtrosPagosWrapper = (otrosPagosHtmlFinal: string, nomina: RecordUnknown): string => {
  if (!otrosPagosHtmlFinal) return '';
  return `
    <div>
      <h3 class="font-bold text-slate-700 mb-2 border-b-2 border-slate-300 pb-1">OTROS PAGOS</h3>
      ${otrosPagosHtmlFinal}
      <div class="flex justify-between mt-2 pt-2 border-t font-semibold text-xs">
        <span>Total Otros Pagos:</span>
        <span>${formatCurrency(nomina['@_TotalOtrosPagos'])}</span>
      </div>
    </div>
  `;
};

const normalizeArray = (raw: unknown): RecordUnknown[] => {
  if (Array.isArray(raw)) return raw as RecordUnknown[];
  if (raw) return [raw as RecordUnknown];
  return [];
};

export const generateTemplateNominaHtml = ({ cfdiData, qrCodeDataUrl, brandConfig, isCancelled }: InvoiceTemplateProps): string => {
  const comprobante = (cfdiData['cfdi:Comprobante'] || cfdiData['Comprobante'] || {}) as RecordUnknown;
  
  const emisor = (comprobante['cfdi:Emisor'] || get(comprobante, 'Emisor') || {}) as RecordUnknown;
  const receptor = (comprobante['cfdi:Receptor'] || get(comprobante, 'Receptor') || {}) as RecordUnknown;
  const complemento = (comprobante['cfdi:Complemento'] || get(comprobante, 'Complemento') || {}) as RecordUnknown;
  const timbre = (complemento?.['tfd:TimbreFiscalDigital'] || get(complemento, 'TimbreFiscalDigital') || {}) as RecordUnknown;
  const nomina = (complemento?.['nomina12:Nomina'] || get(complemento, 'Nomina') || {}) as RecordUnknown;
  
  const primaryColor = brandConfig?.primaryColor || '#1e3a8a';

  // Nómina details
  const receptorNomina = (nomina['nomina12:Receptor'] || get(nomina, 'Receptor') || {}) as RecordUnknown;
  const emisorNomina = (nomina['nomina12:Emisor'] || get(nomina, 'Emisor') || {}) as RecordUnknown;
  
  const percepcionesNode = (nomina['nomina12:Percepciones'] || get(nomina, 'Percepciones') || {}) as RecordUnknown;
  const percepcionesRaw = percepcionesNode['nomina12:Percepcion'] || get(percepcionesNode, 'Percepcion');
  const percepcionesArray = normalizeArray(percepcionesRaw);

  const deduccionesNode = (nomina['nomina12:Deducciones'] || get(nomina, 'Deducciones') || {}) as RecordUnknown;
  const deduccionesRaw = deduccionesNode['nomina12:Deduccion'] || get(deduccionesNode, 'Deduccion');
  const deduccionesArray = normalizeArray(deduccionesRaw);

  const otrosPagosNode = (nomina['nomina12:OtrosPagos'] || get(nomina, 'OtrosPagos') || {}) as RecordUnknown;
  const otrosPagosRaw = otrosPagosNode['nomina12:OtroPago'] || get(otrosPagosNode, 'OtroPago');
  const otrosPagosArray = normalizeArray(otrosPagosRaw);

  const percepcionesHtmlFinal = renderPercepciones(percepcionesArray);
  const deduccionesHtmlFinal = renderDeducciones(deduccionesArray);
  const otrosPagosHtmlFinal = renderOtrosPagos(otrosPagosArray);

  const calcTotalPercepciones = () => {
    const sum = Number(percepcionesNode['@_TotalGravado'] || 0) + Number(percepcionesNode['@_TotalExento'] || 0);
    return percepcionesNode['@_TotalSueldos'] || percepcionesNode['@_TotalGravado'] ? sum : 0;
  };
  const valTotalPercepciones = calcTotalPercepciones();
  
  const calcTotalDeducciones = () => {
    const sum = Number(deduccionesNode['@_TotalOtrasDeducciones'] || 0) + Number(deduccionesNode['@_TotalImpuestosRetenidos'] || 0);
    return deduccionesNode['@_TotalOtrasDeducciones'] || deduccionesNode['@_TotalImpuestosRetenidos'] ? sum : nomina['@_TotalDeducciones'];
  };
  const valTotalDeducciones = calcTotalDeducciones();

  return `<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <title>Recibo de Nómina ${safeString(comprobante['@_Serie'])}${safeString(comprobante['@_Folio'])}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
      body { font-family: 'Inter', sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; position: relative; }
      .primary-bg { background-color: ${primaryColor}; }
      .primary-text { color: ${primaryColor}; }
      .watermark {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%) rotate(-45deg);
        font-size: 120px;
        color: rgba(239, 68, 68, 0.15);
        font-weight: 900;
        letter-spacing: 10px;
        z-index: -1;
        white-space: nowrap;
        pointer-events: none;
        user-select: none;
      }
    </style>
  </head>
  <body class="bg-white text-slate-800 p-8 text-sm">
    ${renderWatermark(!!isCancelled)}
    
    <!-- Header -->
    <div class="flex justify-between items-start mb-6">
      <div class="w-1/2">
        ${renderBrandHeader(brandConfig as RecordUnknown | undefined)}
        <div class="font-semibold text-lg">${safeString(emisor['@_Nombre']) || 'EMPRESA DEMO'}</div>
        <div class="text-slate-600">RFC: ${safeString(emisor['@_Rfc'])}</div>
        <div class="text-slate-600">Régimen Fiscal: ${safeString(emisor['@_RegimenFiscal'])}</div>
        <div class="text-slate-600">Registro Patronal: ${safeString(emisorNomina['@_RegistroPatronal'])}</div>
      </div>
      
      <div class="w-1/2 text-right">
        <h1 class="text-3xl font-bold primary-text mb-2">RECIBO DE NÓMINA</h1>
        <div class="text-slate-600 mb-1">
          <span class="font-semibold">Folio:</span> ${safeString(comprobante['@_Serie'])}${safeString(comprobante['@_Folio']) || 'S/N'}
        </div>
        <div class="text-slate-600 mb-1">
          <span class="font-semibold">Fecha Emisión:</span> ${safeString(comprobante['@_Fecha'])}
        </div>
        <div class="text-slate-600 mb-1">
          <span class="font-semibold">Lugar de Expedición:</span> ${safeString(comprobante['@_LugarExpedicion'])}
        </div>
        <div class="text-slate-600 mb-1">
          <span class="font-semibold">Tipo Nómina:</span> ${getTipoNominaLabel(nomina['@_TipoNomina'])}
        </div>
        <div class="text-slate-600 mb-1">
          <span class="font-semibold">Periodo:</span> ${safeString(nomina['@_FechaInicialPago'])} al ${safeString(nomina['@_FechaFinalPago'])}
        </div>
        <div class="text-slate-600 mb-1">
          <span class="font-semibold">Días Pagados:</span> ${safeString(nomina['@_NumDiasPagados'])}
        </div>
      </div>
    </div>

    <!-- Employee Info -->
    <div class="border border-slate-200 rounded-lg p-4 mb-6 bg-slate-50 text-xs">
      <h3 class="font-bold text-slate-700 mb-2 border-b pb-1">DATOS DEL TRABAJADOR</h3>
      <div class="grid grid-cols-3 gap-4">
        <div>
          <span class="font-semibold block text-slate-600">Nombre:</span>
          ${safeString(receptor['@_Nombre'])}
        </div>
        <div>
          <span class="font-semibold block text-slate-600">RFC:</span>
          ${safeString(receptor['@_Rfc'])}
        </div>
        <div>
          <span class="font-semibold block text-slate-600">CURP:</span>
          ${safeString(receptorNomina['@_Curp'])}
        </div>
        <div>
          <span class="font-semibold block text-slate-600">No. Empleado:</span>
          ${safeString(receptorNomina['@_NumEmpleado'])}
        </div>
        <div>
          <span class="font-semibold block text-slate-600">NSS:</span>
          ${safeString(receptorNomina['@_NumSeguridadSocial'])}
        </div>
        <div>
          <span class="font-semibold block text-slate-600">Departamento:</span>
          ${safeString(receptorNomina['@_Departamento'])}
        </div>
        <div>
          <span class="font-semibold block text-slate-600">Puesto:</span>
          ${safeString(receptorNomina['@_Puesto'])}
        </div>
        <div>
          <span class="font-semibold block text-slate-600">Riesgo Puesto:</span>
          ${safeString(receptorNomina['@_RiesgoPuesto'])}
        </div>
        <div>
          <span class="font-semibold block text-slate-600">Salario Diario Integrado:</span>
          ${formatCurrency(receptorNomina['@_SalarioDiarioIntegrado'])}
        </div>
        <div>
          <span class="font-semibold block text-slate-600">Salario Base Cot. Apor.:</span>
          ${formatCurrency(receptorNomina['@_SalarioBaseCotApor'])}
        </div>
      </div>
    </div>

    <!-- Payroll Details -->
    <div class="flex gap-6 mb-6">
      <!-- Percepciones -->
      <div class="w-1/2">
        <h3 class="font-bold text-slate-700 mb-2 border-b-2 border-slate-300 pb-1">PERCEPCIONES</h3>
        ${percepcionesHtmlFinal}
        <div class="flex justify-between mt-2 pt-2 border-t font-semibold text-xs">
          <span>Total Percepciones:</span>
          <span>${formatCurrency(valTotalPercepciones)}</span>
        </div>
      </div>

      <!-- Deducciones & Otros Pagos -->
      <div class="w-1/2 flex flex-col gap-4">
        <div>
          <h3 class="font-bold text-slate-700 mb-2 border-b-2 border-slate-300 pb-1">DEDUCCIONES</h3>
          ${deduccionesHtmlFinal}
          <div class="flex justify-between mt-2 pt-2 border-t font-semibold text-xs">
            <span>Total Deducciones:</span>
            <span>${formatCurrency(valTotalDeducciones)}</span>
          </div>
        </div>

        ${renderOtrosPagosWrapper(otrosPagosHtmlFinal, nomina)}
      </div>
    </div>

    <!-- Totals -->
    <div class="flex justify-end mb-6">
      <div class="w-1/3 bg-slate-50 p-4 rounded-lg border border-slate-200">
        <div class="flex justify-between py-1 text-sm">
          <span class="text-slate-600">Subtotal:</span>
          <span class="font-semibold">${formatCurrency(comprobante['@_SubTotal'])}</span>
        </div>
        ${renderDescuento(comprobante)}
        <div class="flex justify-between py-2 mt-2 border-t-2 border-slate-800 text-xl font-bold">
          <span>Total a Pagar:</span>
          <span>${formatCurrency(comprobante['@_Total'])}</span>
        </div>
      </div>
    </div>

    <!-- SAT Info & QR -->
    <div class="border-t border-slate-300 pt-6 flex gap-6 text-[10px] text-slate-500 break-all">
      <div class="w-24 flex-shrink-0">
        ${renderQrCode(qrCodeDataUrl)}
      </div>
      <div class="flex-1 space-y-2">
        <div>
          <span class="font-semibold block text-slate-700">Folio Fiscal (UUID):</span>
          ${safeString(timbre['@_UUID']) || 'No certificado'}
        </div>
        <div>
          <span class="font-semibold block text-slate-700">Sello Digital del CFDI:</span>
          ${safeString(timbre['@_SelloCFD'])}
        </div>
        <div>
          <span class="font-semibold block text-slate-700">Sello del SAT:</span>
          ${safeString(timbre['@_SelloSAT'])}
        </div>
        <div>
          <span class="font-semibold block text-slate-700">Cadena Original del complemento de certificación digital del SAT:</span>
          ${renderCadenaOriginal(timbre)}
        </div>
        <div class="flex justify-between text-slate-600 pt-1">
          <span><span class="font-semibold">No. Certificado Emisor:</span> ${safeString(comprobante['@_NoCertificado'])}</span>
          <span><span class="font-semibold">No. Certificado SAT:</span> ${safeString(timbre['@_NoCertificadoSAT'])}</span>
          <span><span class="font-semibold">Fecha Timbrado:</span> ${safeString(timbre['@_FechaTimbrado'])}</span>
        </div>
      </div>
    </div>

    <div class="mt-6 text-center text-slate-400 text-[10px] italic">
      Este documento es una representación impresa de un CFDI de Nómina.
    </div>
  </body>
</html>`;
};
