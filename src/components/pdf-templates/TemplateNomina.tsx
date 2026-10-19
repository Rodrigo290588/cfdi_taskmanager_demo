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

const normalizeArray = (raw: unknown): RecordUnknown[] => {
  if (Array.isArray(raw)) return raw as RecordUnknown[];
  if (raw) return [raw as RecordUnknown];
  return [];
};

const renderConceptos = (conceptosArray: RecordUnknown[]) => {
  if (conceptosArray.length === 0) return '';
  const rows = conceptosArray.map((c) => `
    <tr>
      <td class="text-center">${safeString(c['@_ClaveProdServ'])}</td>
      <td class="text-center">${safeString(c['@_Cantidad'])}</td>
      <td class="text-center">${safeString(c['@_ClaveUnidad'])}</td>
      <td>${safeString(c['@_Descripcion'])}</td>
      <td class="text-right">${formatCurrency(c['@_ValorUnitario'])}</td>
      <td class="text-right">${formatCurrency(c['@_Importe'])}</td>
      <td class="text-right">${formatCurrency(c['@_Descuento'])}</td>
    </tr>
  `).join('');

  return `
    <div class="section-title mt-2">CONCEPTOS</div>
    <table>
      <thead>
        <tr>
          <th>ClaveProdServ</th>
          <th>Cantidad</th>
          <th>Clave Unidad</th>
          <th>Descripcion</th>
          <th>Valor Unitario</th>
          <th>Importe</th>
          <th>Descuento</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
};

const renderPercepciones = (percepcionesArray: RecordUnknown[]) => {
  if (percepcionesArray.length === 0) return '';
  const rows = percepcionesArray.map((p) => `
    <tr>
      <td class="text-center">${safeString(p['@_TipoPercepcion'])}</td>
      <td class="text-center">${safeString(p['@_Clave'])}</td>
      <td>${safeString(p['@_Concepto'])}</td>
      <td class="text-right">${formatCurrency(p['@_ImporteGravado'])}</td>
      <td class="text-right">${formatCurrency(p['@_ImporteExento'])}</td>
    </tr>
  `).join('');

  return `
    <div class="section-title">CONCEPTOS PERCEPCIONES</div>
    <table>
      <thead>
        <tr>
          <th>Clave SAT</th>
          <th>Clave CIA</th>
          <th>Descripcion</th>
          <th>Gravado</th>
          <th>Exento</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
};

const renderDeducciones = (deduccionesArray: RecordUnknown[]) => {
  if (deduccionesArray.length === 0) return '';
  const rows = deduccionesArray.map((d) => `
    <tr>
      <td class="text-center">${safeString(d['@_TipoDeduccion'])}</td>
      <td class="text-center">${safeString(d['@_Clave'])}</td>
      <td>${safeString(d['@_Concepto'])}</td>
      <td class="text-right">${formatCurrency(d['@_Importe'])}</td>
    </tr>
  `).join('');

  return `
    <div class="section-title">CONCEPTOS DEDUCCIONES</div>
    <table>
      <thead>
        <tr>
          <th>Clave SAT</th>
          <th>Clave CIA</th>
          <th>Descripción</th>
          <th>Importe</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
};

const renderOtrosPagos = (otrosPagosArray: RecordUnknown[]) => {
  if (otrosPagosArray.length === 0) return '';
  const rows = otrosPagosArray.map((o) => `
    <tr>
      <td class="text-center">${safeString(o['@_TipoOtroPago'])}</td>
      <td class="text-center">${safeString(o['@_Clave'])}</td>
      <td>${safeString(o['@_Concepto'])}</td>
      <td class="text-right">${formatCurrency(o['@_Importe'])}</td>
    </tr>
  `).join('');

  return `
    <div class="section-title mt-2">CONCEPTOS OTROS PAGOS</div>
    <table>
      <thead>
        <tr>
          <th>Clave SAT</th>
          <th>Clave CIA</th>
          <th>Descripción</th>
          <th>Importe</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
};

const renderSubsidioAlEmpleo = (otrosPagosArray: RecordUnknown[]) => {
  const subsidio = otrosPagosArray.find(o => o['@_TipoOtroPago'] === '002' && (o['nomina12:SubsidioAlEmpleo'] || get(o, 'SubsidioAlEmpleo')));
  if (!subsidio) return '';
  
  const subsidioNode = (subsidio['nomina12:SubsidioAlEmpleo'] || get(subsidio, 'SubsidioAlEmpleo')) as RecordUnknown;
  
  return `
    <div class="section-title mt-2">SUBSIDIO AL EMPLEO</div>
    <table>
      <thead>
        <tr>
          <th>Subsidio causado</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="text-right">${formatCurrency(subsidioNode['@_SubsidioCausado'])}</td>
        </tr>
      </tbody>
    </table>
  `;
};

const renderIncapacidades = (incapacidadesArray: RecordUnknown[]) => {
  if (incapacidadesArray.length === 0) return '';
  const rows = incapacidadesArray.map((i) => `
    <tr>
      <td class="text-center">${safeString(i['@_TipoIncapacidad'])}</td>
      <td class="text-center">${safeString(i['@_DiasIncapacidad'])}</td>
      <td class="text-right">${formatCurrency(i['@_ImporteMonetario'])}</td>
    </tr>
  `).join('');

  return `
    <div class="section-title mt-2">INCAPACIDADES</div>
    <table>
      <thead>
        <tr>
          <th>Tipo</th>
          <th>Días</th>
          <th>Importe</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
};

const renderHorasExtra = (horasExtraArray: RecordUnknown[]) => {
  if (horasExtraArray.length === 0) return '';
  const rows = horasExtraArray.map((h) => `
    <tr>
      <td class="text-center">${safeString(h['@_TipoHoras'])}</td>
      <td class="text-center">${safeString(h['@_Dias'])}</td>
      <td class="text-center">${safeString(h['@_HorasExtra'])}</td>
      <td class="text-right">${formatCurrency(h['@_ImportePagado'])}</td>
    </tr>
  `).join('');

  return `
    <div class="section-title mt-2">HORAS EXTRA</div>
    <table>
      <thead>
        <tr>
          <th>Tipo</th>
          <th>Días</th>
          <th>Horas</th>
          <th>Importe</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
};

export const generateTemplateNominaHtml = ({ cfdiData, qrCodeDataUrl, isCancelled }: InvoiceTemplateProps): string => {
  const comprobante = (cfdiData['cfdi:Comprobante'] || cfdiData['Comprobante'] || {}) as RecordUnknown;
  const emisor = (comprobante['cfdi:Emisor'] || get(comprobante, 'Emisor') || {}) as RecordUnknown;
  const receptor = (comprobante['cfdi:Receptor'] || get(comprobante, 'Receptor') || {}) as RecordUnknown;
  const complemento = (comprobante['cfdi:Complemento'] || get(comprobante, 'Complemento') || {}) as RecordUnknown;
  const timbre = (complemento?.['tfd:TimbreFiscalDigital'] || get(complemento, 'TimbreFiscalDigital') || {}) as RecordUnknown;
  const nomina = (complemento?.['nomina12:Nomina'] || get(complemento, 'Nomina') || {}) as RecordUnknown;
  
  const conceptosContainer = (comprobante['cfdi:Conceptos'] || get(comprobante, 'Conceptos')) as RecordUnknown;
  const conceptosRaw = conceptosContainer?.['cfdi:Concepto'] || get(conceptosContainer, 'Concepto');
  const conceptosArray = normalizeArray(conceptosRaw);

  const receptorNomina = (nomina['nomina12:Receptor'] || get(nomina, 'Receptor') || {}) as RecordUnknown;
  const emisorNomina = (nomina['nomina12:Emisor'] || get(nomina, 'Emisor') || {}) as RecordUnknown;
  
  const percepcionesNode = (nomina['nomina12:Percepciones'] || get(nomina, 'Percepciones') || {}) as RecordUnknown;
  const percepcionesArray = normalizeArray(percepcionesNode['nomina12:Percepcion'] || get(percepcionesNode, 'Percepcion'));

  const deduccionesNode = (nomina['nomina12:Deducciones'] || get(nomina, 'Deducciones') || {}) as RecordUnknown;
  const deduccionesArray = normalizeArray(deduccionesNode['nomina12:Deduccion'] || get(deduccionesNode, 'Deduccion'));

  const otrosPagosNode = (nomina['nomina12:OtrosPagos'] || get(nomina, 'OtrosPagos') || {}) as RecordUnknown;
  const otrosPagosArray = normalizeArray(otrosPagosNode['nomina12:OtroPago'] || get(otrosPagosNode, 'OtroPago'));

  const incapacidadesNode = (nomina['nomina12:Incapacidades'] || get(nomina, 'Incapacidades') || {}) as RecordUnknown;
  const incapacidadesArray = normalizeArray(incapacidadesNode['nomina12:Incapacidad'] || get(incapacidadesNode, 'Incapacidad'));

  const horasExtraArray = normalizeArray(receptorNomina['nomina12:HorasExtra'] || get(receptorNomina, 'HorasExtra'));

  const cadenaOriginal = timbre['@_Version'] 
    ? `||${safeString(timbre['@_Version'])}|${safeString(timbre['@_UUID'])}|${safeString(timbre['@_FechaTimbrado'])}|${safeString(timbre['@_RfcProvCertif'])}|${safeString(timbre['@_SelloCFD'])}|${safeString(timbre['@_NoCertificadoSAT'])}||`
    : '';

  return String.raw`<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <title>Recibo de Nómina \${safeString(comprobante['@_Serie'])}\${safeString(comprobante['@_Folio'])}</title>
    <style>
      body { 
        font-family: Arial, Helvetica, sans-serif; 
        font-size: 9px; 
        -webkit-print-color-adjust: exact; 
        print-color-adjust: exact; 
        margin: 0; 
        padding: 0;
        color: #000;
      }
      table { 
        width: 100%; 
        border-collapse: collapse; 
        margin-bottom: 4px; 
      }
      th, td { 
        border: 1px solid #000; 
        padding: 2px 4px; 
      }
      th { 
        background-color: #f3f4f6; 
        font-weight: bold; 
        text-align: center; 
      }
      .header-container { 
        display: flex; 
        justify-content: space-between; 
        margin-bottom: 10px; 
      }
      .header-left { 
        width: 80%; 
      }
      .header-right { 
        width: 20%; 
        display: flex;
        justify-content: flex-end;
      }
      .qr-code {
        max-width: 120px;
        max-height: 120px;
      }
      .company-title {
        font-size: 16px;
        font-weight: bold;
        margin-bottom: 6px;
        text-transform: uppercase;
      }
      .info-row {
        margin-bottom: 2px;
      }
      .info-grid { 
        display: grid; 
        grid-template-columns: repeat(3, 1fr); 
        gap: 4px; 
        margin-bottom: 10px; 
      }
      .info-item {
        display: flex;
      }
      .info-label { 
        font-weight: bold; 
        margin-right: 4px; 
      }
      .text-right { text-align: right; }
      .text-center { text-align: center; }
      .section-title { 
        font-weight: bold; 
        text-align: center; 
        background-color: #f3f4f6; 
        border: 1px solid #000; 
        border-bottom: none;
        padding: 2px; 
      }
      .flex-row { 
        display: flex; 
        gap: 8px; 
        align-items: flex-start;
      }
      .flex-half { 
        width: 50%; 
      }
      .footer-container { 
        display: flex; 
        gap: 8px; 
        margin-top: 8px;
      }
      .stamps { 
        width: 70%; 
      }
      .stamp-box {
        border: 1px solid #000;
        padding: 2px 4px;
        margin-bottom: 4px;
        font-size: 7px;
        word-break: break-all;
      }
      .stamp-title {
        font-weight: bold;
      }
      .totals { 
        width: 30%; 
      }
      .totals table {
        margin-bottom: 4px;
      }
      .mt-2 { margin-top: 8px; }
      .watermark {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%) rotate(-45deg);
        font-size: 100px;
        color: rgba(239, 68, 68, 0.15);
        font-weight: 900;
        z-index: -1;
        pointer-events: none;
      }
      .leyenda-final {
        margin-top: 4px;
        border: 1px solid #000;
        padding: 4px;
        text-transform: uppercase;
        font-size: 8px;
      }
    </style>
  </head>
  <body>
    ${isCancelled ? '<div class="watermark">CANCELADO</div>' : ''}
    
    <div class="header-container">
      <div class="header-left">
        <div class="company-title">${safeString(emisor['@_Nombre'])}</div>
        <div class="info-row"><span class="info-label">RFC:</span> ${safeString(emisor['@_Rfc'])}</div>
        <div class="info-row"><span class="info-label">Registro Patronal:</span> ${safeString(emisorNomina['@_RegistroPatronal'])}</div>
        <div class="info-row"><span class="info-label">Regimen Fiscal:</span> ${safeString(emisor['@_RegimenFiscal'])} <span class="info-label ml-2">Uso CFDI:</span> ${safeString(receptor['@_UsoCFDI'])}</div>
        <div class="info-row"><span class="info-label">Lugar de Expedición:</span> ${safeString(comprobante['@_LugarExpedicion'])}</div>
        <div class="info-row"><span class="info-label">Método Pago:</span> ${safeString(comprobante['@_MetodoPago'])} <span class="info-label ml-2">Forma Pago:</span> ${safeString(comprobante['@_FormaPago'])}</div>
        <div class="info-row"><span class="info-label">F. Fiscal:</span> ${safeString(timbre['@_UUID'])}</div>
        <div class="info-row"><span class="info-label">Fecha Certificación:</span> ${safeString(timbre['@_FechaTimbrado'])}</div>
        <div class="info-row"><span class="info-label">Certificado CSD:</span> ${safeString(comprobante['@_NoCertificado'])}</div>
        <div class="info-row"><span class="info-label">Certificado SAT:</span> ${safeString(timbre['@_NoCertificadoSAT'])}</div>
      </div>
      <div class="header-right">
        ${qrCodeDataUrl ? `<img src="${safeString(qrCodeDataUrl)}" class="qr-code" alt="QR" />` : ''}
      </div>
    </div>

    <div class="info-grid">
      <div class="info-item"><span class="info-label">No. Empleado:</span> ${safeString(receptorNomina['@_NumEmpleado'])}</div>
      <div class="info-item"><span class="info-label">Grupo Pago:</span></div>
      <div class="info-item"><span class="info-label">Num. Seg. Social:</span> ${safeString(receptorNomina['@_NumSeguridadSocial'])}</div>
      
      <div class="info-item"><span class="info-label">Empleado:</span> ${safeString(receptor['@_Nombre'])}</div>
      <div class="info-item"><span class="info-label">Fecha Inicio Rel. Laboral:</span> ${safeString(receptorNomina['@_FechaInicioRelLaboral'])}</div>
      <div class="info-item"><span class="info-label">Periodicidad:</span> ${safeString(receptorNomina['@_PeriodicidadPago'])} <span class="info-label ml-2">Días Pagados:</span> ${safeString(nomina['@_NumDiasPagados'])}</div>
      
      <div class="info-item"><span class="info-label">RFC:</span> ${safeString(receptor['@_Rfc'])} <span class="info-label ml-2">CURP:</span> ${safeString(receptorNomina['@_Curp'])}</div>
      <div class="info-item"><span class="info-label">Fecha de Pago:</span> ${safeString(nomina['@_FechaPago'])}</div>
      <div class="info-item"><span class="info-label">Tipo contrato:</span> ${safeString(receptorNomina['@_TipoContrato'])}</div>
      
      <div class="info-item"><span class="info-label">Puesto:</span> ${safeString(receptorNomina['@_Puesto'])}</div>
      <div class="info-item"><span class="info-label">Antigüedad:</span> ${safeString(receptorNomina['@_Antigüedad'])}</div>
      <div class="info-item"><span class="info-label">Riesgo puesto:</span> ${safeString(receptorNomina['@_RiesgoPuesto'])}</div>
      
      <div class="info-item"><span class="info-label">Periodo Pago:</span> ${safeString(nomina['@_FechaInicialPago'])} a ${safeString(nomina['@_FechaFinalPago'])}</div>
      <div class="info-item"></div>
      <div class="info-item"><span class="info-label">Tipo de Régimen:</span> ${safeString(receptorNomina['@_TipoRegimen'])}</div>
    </div>

    ${renderConceptos(conceptosArray)}

    <div class="flex-row">
      <div class="flex-half">
        ${renderPercepciones(percepcionesArray)}
      </div>
      <div class="flex-half">
        ${renderDeducciones(deduccionesArray)}
      </div>
    </div>

    ${renderOtrosPagos(otrosPagosArray)}
    ${renderSubsidioAlEmpleo(otrosPagosArray)}
    
    <div class="flex-row">
      <div class="flex-half">
        ${renderIncapacidades(incapacidadesArray)}
      </div>
      <div class="flex-half">
        ${renderHorasExtra(horasExtraArray)}
      </div>
    </div>

    <div class="footer-container">
      <div class="stamps">
        <div class="stamp-box">
          <span class="stamp-title">Sello Digital CFDI:</span> ${safeString(timbre['@_SelloCFD'])}
        </div>
        <div class="stamp-box">
          <span class="stamp-title">Sello SAT:</span> ${safeString(timbre['@_SelloSAT'])}
        </div>
        <div class="stamp-box">
          <span class="stamp-title">Cadena Original:</span> ${cadenaOriginal}
        </div>
        
        <div class="leyenda-final">
          CON LA CANTIDAD NETA RECIBIDA VÍA DEPÓSITO BANCARIO A MI CUENTA CLABE, ME DOY POR CUBIERTO DE LOS SALARIOS Y PRESTACIONES GENERADAS DURANTE EL PERIODO DE ESTE RECIBO, OTORGANDO EL FINIQUITO MAS AMPLIO QUE EN DERECHO PROCEDA A FAVOR DE ${safeString(emisor['@_Nombre'])}.
        </div>
      </div>
      
      <div class="totals">
        <table>
          <tbody>
            <tr>
              <td>Total Percepciones</td>
              <td class="text-right">${formatCurrency(nomina['@_TotalPercepciones'])}</td>
            </tr>
            <tr>
              <td>Total Otros Pagos</td>
              <td class="text-right">${formatCurrency(nomina['@_TotalOtrosPagos'])}</td>
            </tr>
          </tbody>
        </table>
        
        <div class="section-title">DEDUCCIONES</div>
        <table>
          <tbody>
            <tr>
              <td>Otras Deducciones</td>
              <td class="text-right">${formatCurrency(deduccionesNode['@_TotalOtrasDeducciones'])}</td>
            </tr>
            <tr>
              <td>Total ISR</td>
              <td class="text-right">${formatCurrency(deduccionesNode['@_TotalImpuestosRetenidos'])}</td>
            </tr>
            <tr>
              <td>Total Deducciones</td>
              <td class="text-right">${formatCurrency(nomina['@_TotalDeducciones'])}</td>
            </tr>
          </tbody>
        </table>

        <table>
          <tbody>
            <tr>
              <td>Subtotal</td>
              <td class="text-right">${formatCurrency(comprobante['@_SubTotal'])}</td>
            </tr>
            <tr>
              <td>Descuento</td>
              <td class="text-right">${formatCurrency(comprobante['@_Descuento'])}</td>
            </tr>
            <tr>
              <td>Pago Neto</td>
              <td class="text-right">${formatCurrency(comprobante['@_Total'])}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    
    <div class="text-center mt-2" style="font-size: 8px;">
      Este documento es una representación impresa de un CFDI
    </div>
  </body>
</html>`;
};
