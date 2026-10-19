import { generateCfdiPdfFromXml } from './src/lib/cfdi-pdf';
import fs from 'fs';

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:nomina12="http://www.sat.gob.mx/nomina12" Version="4.0" Serie="N" Folio="123" Fecha="2026-01-06T09:29:50" SubTotal="36276.26" Descuento="35297.26" Total="979.00">
  <cfdi:Emisor Nombre="NACIONAL MONTE DE PIEDAD" Rfc="NMP7502257ZA" RegimenFiscal="603" />
  <cfdi:Receptor Nombre="JOSE LUIS CRUZ" Rfc="CUGL960908TX0" UsoCFDI="CN01" RegimenFiscalReceptor="605" DomicilioFiscalReceptor="12345" />
  <cfdi:Complemento>
    <nomina12:Nomina Version="1.2" TipoNomina="O" FechaInicialPago="2026-01-01" FechaFinalPago="2026-01-31" NumDiasPagados="1">
      <nomina12:Receptor Curp="CUGL960908HDFRRS05" NumEmpleado="2300179" NumSeguridadSocial="94129602531" Departamento="DIRECCION EJECUTIVA" Puesto="ANALISTA" RiesgoPuesto="1" SalarioDiarioIntegrado="0.00" SalarioBaseCotApor="1405.49" />
      <nomina12:Percepciones TotalSueldos="36275.38" TotalGravado="36015.30" TotalExento="260.08">
        <nomina12:Percepcion TipoPercepcion="001" Clave="1" Concepto="Sueldo" ImporteGravado="36015.30" ImporteExento="0.00" />
      </nomina12:Percepciones>
      <nomina12:Deducciones TotalOtrasDeducciones="35297.26">
        <nomina12:Deduccion TipoDeduccion="001" Clave="810" Concepto="Descuento Cuota" Importe="75.29" />
      </nomina12:Deducciones>
    </nomina12:Nomina>
  </cfdi:Complemento>
</cfdi:Comprobante>
`;

async function main() {
  const result = await generateCfdiPdfFromXml({
    xmlRaw: xml,
    invoiceIdForFallback: 'test-123',
    templateType: 'nomina'
  });
  fs.writeFileSync('test_output_styles.pdf', result.pdfBuffer);
  console.log('PDF saved to test_output_styles.pdf');
}

main().catch(console.error);