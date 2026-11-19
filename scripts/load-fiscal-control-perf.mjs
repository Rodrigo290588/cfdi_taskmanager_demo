import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const batchSize = Number(process.env.PERF_BATCH_SIZE || 100_000)
const organizationId = 'perf_org_001'
const companyId = 'perf_company_001'
const fiscalEntityId = 'perf_entity_001'
const userId = 'perf_user_001'
const memberId = 'perf_member_001'

const sources = [
  ['sat_metadata', 4_000_000],
  ['invoices', 2_000_000],
  ['provider_uploaded_cfdis', 2_000_000],
  ['payroll_receipts', 1_000_000],
]

async function execute(sql) {
  await prisma.$executeRawUnsafe(sql)
}

async function ensureDimensions() {
  await execute(`
    INSERT INTO users (id, email, name, created_at, updated_at)
    VALUES ('${userId}', 'performance@local.invalid', 'Performance Loader', NOW(), NOW())
    ON CONFLICT (id) DO NOTHING`)
  await execute(`
    INSERT INTO organizations (id, name, slug, created_at, updated_at)
    VALUES ('${organizationId}', 'Organización de rendimiento', 'performance-local', NOW(), NOW())
    ON CONFLICT (id) DO NOTHING`)
  await execute(`
    INSERT INTO members (id, user_id, organization_id, role, status, created_at, updated_at)
    VALUES ('${memberId}', '${userId}', '${organizationId}', 'ADMIN', 'APPROVED', NOW(), NOW())
    ON CONFLICT (id) DO NOTHING`)
  await execute(`
    INSERT INTO companies (id, name, rfc, business_name, tax_regime, postal_code, created_by, updated_by, created_at, updated_at)
    VALUES ('${companyId}', 'Empresa de rendimiento', 'PER010101AAA', 'Empresa de rendimiento', '601', '01000', '${userId}', '${userId}', NOW(), NOW())
    ON CONFLICT (id) DO NOTHING`)
  await execute(`
    INSERT INTO fiscal_entities (id, organization_id, rfc, business_name, tax_regime, postal_code, created_at, updated_at)
    VALUES ('${fiscalEntityId}', '${organizationId}', 'PER010101AAA', 'Empresa de rendimiento', '601', '01000', NOW(), NOW())
    ON CONFLICT (id) DO NOTHING`)
}

function rangeSql(table, start, end) {
  const series = `generate_series(${start}, ${end}) AS n`
  if (table === 'sat_metadata') {
    return `INSERT INTO sat_metadata (id, uuid, rfc_emisor, nombre_emisor, rfc_receptor, nombre_receptor, fecha_emision, fecha_certificacion_sat, monto, efecto_comprobante, estatus, created_at, updated_at)
      SELECT 'perf-meta-' || n, md5('perf-' || n), CASE WHEN n <= 2000000 THEN 'PER010101AAA' ELSE 'SUP' || lpad((n % 999999)::text, 6, '0') || 'AA1' END, 'Emisor sintético', 'PER010101AAA', 'Receptor sintético', TIMESTAMP '2018-01-01' + ((n % 3287) * INTERVAL '1 day'), TIMESTAMP '2018-01-01' + ((n % 3287) * INTERVAL '1 day'), (n % 100000)::numeric / 100, CASE WHEN n % 10 = 0 THEN 'E' ELSE 'I' END, '1', NOW(), NOW() FROM ${series} ON CONFLICT (id) DO NOTHING;`
  }
  if (table === 'invoices') {
    return `INSERT INTO invoices (id, issuer_fiscal_entity_id, uuid, cfdi_type, issuer_rfc, issuer_name, receiver_rfc, receiver_name, subtotal, total, xml_content, issuance_date, certification_date, certification_pac, payment_method, payment_form, cfdi_usage, place_of_expedition, created_at, updated_at)
      SELECT 'perf-invoice-' || n, '${fiscalEntityId}', md5('perf-' || CASE WHEN n <= 1000000 THEN 3000000 + n ELSE n END), CASE WHEN n <= 1000000 THEN 'NOMINA' ELSE 'INGRESO' END, 'PER010101AAA', 'Emisor sintético', 'CLI' || lpad((n % 999999)::text, 6, '0') || 'AA1', 'Cliente sintético', (n % 100000)::numeric / 100, (n % 100000)::numeric / 100, '<synthetic/>', TIMESTAMP '2018-01-01' + ((n % 3287) * INTERVAL '1 day'), TIMESTAMP '2018-01-01' + ((n % 3287) * INTERVAL '1 day'), 'AAA010101AAA', 'PUE', '03', 'G03', '01000', NOW(), NOW() FROM ${series} ON CONFLICT (id) DO NOTHING;`
  }
  if (table === 'provider_uploaded_cfdis') {
    return `INSERT INTO provider_uploaded_cfdis (id, organization_id, member_id, receiver_company_id, file_name, uuid, provider_rfc, issuer_rfc, receiver_rfc, cfdi_type, total, xml_sha256, issuance_date, created_at, updated_at)
      SELECT 'perf-received-' || n, '${organizationId}', '${memberId}', '${companyId}', 'synthetic.xml', md5('perf-' || (2000000 + n)), 'SUP' || lpad((n % 999999)::text, 6, '0') || 'AA1', 'SUP' || lpad((n % 999999)::text, 6, '0') || 'AA1', 'PER010101AAA', 'INGRESO', (n % 100000)::numeric / 100, md5('sha-' || n), TIMESTAMP '2018-01-01' + ((n % 3287) * INTERVAL '1 day'), NOW(), NOW() FROM ${series} ON CONFLICT (id) DO NOTHING;`
  }
  return `INSERT INTO payroll_receipts (id, invoice_id, organization_id, company_id, fiscal_entity_id, uuid, tipo_nomina, fecha_pago, fecha_inicial_pago, fecha_final_pago, num_dias_pagados, fecha_emision, total_percepciones, total_deducciones, created_at, updated_at)
    SELECT 'perf-payroll-' || n, 'perf-invoice-' || n, '${organizationId}', '${companyId}', '${fiscalEntityId}', md5('perf-' || (3000000 + n)), 'O', DATE '2018-01-01' + (n % 3287), DATE '2018-01-01' + (n % 3287), DATE '2018-01-01' + (n % 3287), 15, TIMESTAMP '2018-01-01' + ((n % 3287) * INTERVAL '1 day'), (n % 100000)::numeric / 100, 0, NOW(), NOW() FROM ${series} ON CONFLICT (id) DO NOTHING;`
}

async function main() {
  await ensureDimensions()
  for (const [table, total] of sources) {
    for (let start = 1; start <= total; start += batchSize) {
      const end = Math.min(total, start + batchSize - 1)
      const started = Date.now()
      await execute(rangeSql(table, start, end))
      console.info(JSON.stringify({ event: 'perf_load.batch_completed', table, start, end, durationMs: Date.now() - started }))
    }
  }
}

try {
  await main()
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
