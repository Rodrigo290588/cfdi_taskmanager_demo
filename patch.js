/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');

let content = fs.readFileSync('src/lib/invoice-import.ts', 'utf8');

// 1. Add imports
content = content.replace(
  "import { safeErrSummary, fingerprint } from '@/lib/security'",
  "import { safeErrSummary, fingerprint } from '@/lib/security'\nimport { refreshHrMaterializedViews } from '@/lib/payroll-analytics-service'"
);

// 2. Add parsePayrollFromXml function
const parsePayrollCode = `
export function parsePayrollFromXml(xml: string, issuanceDate: Date) {
  const nominaTag = xml.includes('<nomina12:Nomina') ? 'nomina12:Nomina' : 'Nomina';
  const nominaMatch = new RegExp(String.raw\`<(?:\\w+:)?\${nominaTag}\\b([^>]+)>\`, 'i').exec(xml);
  if (!nominaMatch) return null;
  const attrs = (tag: string, attr: string) => attrNs(xml, tag, attr);
  const nominaStr = nominaMatch[1];
  const nAttrs = (attr: string) => attrNs(\`<Tag \${nominaStr}>\`, 'Tag', attr);
  
  const recTag = xml.includes('<nomina12:Receptor') ? 'nomina12:Receptor' : 'Receptor';
  const recMatch = new RegExp(String.raw\`<(?:\\w+:)?\${recTag}\\b([^>]+)>\`, 'i').exec(xml);
  const recStr = recMatch ? recMatch[1] : '';
  const rAttrs = (attr: string) => attrNs(\`<Tag \${recStr}>\`, 'Tag', attr);
  
  const payrollData = {
    tipoNomina: nAttrs('TipoNomina') || 'O',
    fechaPago: parseCfdiDateTime(nAttrs('FechaPago') || ''),
    fechaInicialPago: parseCfdiDateTime(nAttrs('FechaInicialPago') || ''),
    fechaFinalPago: parseCfdiDateTime(nAttrs('FechaFinalPago') || ''),
    numDiasPagados: parseDecimal(nAttrs('NumDiasPagados'), '0'),
    fechaEmision: issuanceDate,
    departamento: rAttrs('Departamento') || null,
    clabe: rAttrs('CuentaBancaria') || null,
    banco: rAttrs('Banco') || null,
    totalPercepciones: parseDecimal(nAttrs('TotalPercepciones'), '0'),
    totalDeducciones: parseDecimal(nAttrs('TotalDeducciones'), '0'),
    totalOtrosPagos: parseDecimal(nAttrs('TotalOtrosPagos'), '0'),
    receptor: {
      create: {
        rfc: rAttrs('Rfc') || '',
        nombre: rAttrs('Nombre') || 'SIN NOMBRE',
        curp: rAttrs('Curp') || null,
        nss: rAttrs('NumSeguridadSocial') || null,
        fechaInicioRelLaboral: rAttrs('FechaInicioRelLaboral') ? new Date(rAttrs('FechaInicioRelLaboral') as string) : null,
        antiguedad: rAttrs('Antigüedad') ? Number.parseInt((rAttrs('Antigüedad') as string).replace(/\\D/g, ''), 10) || 0 : null,
        tipoContrato: rAttrs('TipoContrato') || null,
        sindicalizado: rAttrs('Sindicalizado') || null,
        tipoJornada: rAttrs('TipoJornada') || null,
        tipoRegimen: rAttrs('TipoRegimen') || null,
        numEmpleado: rAttrs('NumEmpleado') || null,
        departamento: rAttrs('Departamento') || null,
        puesto: rAttrs('Puesto') || null,
        riesgoPuesto: rAttrs('RiesgoPuesto') || null,
        periodicidadPago: rAttrs('PeriodicidadPago') || null,
        salarioBaseCotApor: parseDecimal(rAttrs('SalarioBaseCotApor'), '0'),
        salarioDiarioIntegrado: parseDecimal(rAttrs('SalarioDiarioIntegrado'), '0'),
        claveEntFed: rAttrs('ClaveEntFed') || null,
      }
    },
    percepciones: { create: [] as any[] },
    deducciones: { create: [] as any[] },
    otrosPagos: { create: [] as any[] },
  };

  const percRegex = new RegExp(String.raw\`<(?:\\w+:)?Percepcion\\b([^>]+)>\`, 'gi');
  for (const m of xml.matchAll(percRegex)) {
    const pAttrs = (attr: string) => attrNs(\`<Tag \${m[1]}>\`, 'Tag', attr);
    if (pAttrs('TipoPercepcion')) {
      payrollData.percepciones.create.push({
        tipoPercepcion: pAttrs('TipoPercepcion'),
        clave: pAttrs('Clave'),
        concepto: pAttrs('Concepto') || '',
        importeGravado: parseDecimal(pAttrs('ImporteGravado'), '0'),
        importeExento: parseDecimal(pAttrs('ImporteExento'), '0')
      });
    }
  }

  const dedRegex = new RegExp(String.raw\`<(?:\\w+:)?Deduccion\\b([^>]+)>\`, 'gi');
  for (const m of xml.matchAll(dedRegex)) {
    const dAttrs = (attr: string) => attrNs(\`<Tag \${m[1]}>\`, 'Tag', attr);
    if (dAttrs('TipoDeduccion')) {
      payrollData.deducciones.create.push({
        tipoDeduccion: dAttrs('TipoDeduccion'),
        clave: dAttrs('Clave'),
        concepto: dAttrs('Concepto') || '',
        importe: parseDecimal(dAttrs('Importe'), '0')
      });
    }
  }

  const opRegex = new RegExp(String.raw\`<(?:\\w+:)?OtroPago\\b([^>]+)>\`, 'gi');
  for (const m of xml.matchAll(opRegex)) {
    const oAttrs = (attr: string) => attrNs(\`<Tag \${m[1]}>\`, 'Tag', attr);
    if (oAttrs('TipoOtroPago')) {
      payrollData.otrosPagos.create.push({
        tipoOtroPago: oAttrs('TipoOtroPago'),
        clave: oAttrs('Clave'),
        concepto: oAttrs('Concepto') || '',
        importe: parseDecimal(oAttrs('Importe'), '0')
      });
    }
  }

  return payrollData;
}
`;

content = content.replace(
  "export function parseInvoiceFromXml(xml: string) {",
  parsePayrollCode + "\nexport function parseInvoiceFromXml(xml: string) {"
);

// 3. Add payrollData to parseInvoiceFromXml return
content = content.replace(
  "const total = extractTotalValue(xml, cfdiType, comprobanteTag)",
  "const total = extractTotalValue(xml, cfdiType, comprobanteTag)\n  const payrollData = cfdiType === CfdiType.NOMINA ? parsePayrollFromXml(xml, issuanceDate) : null"
);
content = content.replace(
  "_satBaselineValid: timbreCheck.valid\n  }",
  "_satBaselineValid: timbreCheck.valid,\n    payrollData\n  }"
);

// 4. In createInvoiceFromXml, insert payrollReceipt create
content = content.replace(
  "relatedCfdis: {\n          create: parsed.relatedCfdis,\n        },",
  "relatedCfdis: {\n          create: parsed.relatedCfdis,\n        },\n        payrollReceipt: parsed.payrollData ? {\n          create: {\n            ...parsed.payrollData,\n            organizationId: resolvedOrgId,\n            companyId: context.companyId,\n            fiscalEntityId: context.issuerFiscalEntityId,\n            uuid: parsed.uuid,\n          }\n        } : undefined,"
);

// 5. Call refresh_hr_materialized_views at the end of createInvoiceFromXml
content = content.replace(
  "return { status: 'created' as const, uuid: invoice.uuid, message: 'Invoice importada exitosamente' }",
  "if (parsed.cfdiType === CfdiType.NOMINA) {\n    await refreshHrMaterializedViews(true).catch(e => console.error('[createInvoiceFromXml] refreshHrMaterializedViews failed:', safeErrSummary(e)))\n  }\n  return { status: 'created' as const, uuid: invoice.uuid, message: 'Invoice importada exitosamente' }"
);

fs.writeFileSync('src/lib/invoice-import.ts', content);
