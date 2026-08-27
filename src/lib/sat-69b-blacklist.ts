import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { Readable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isInternalHostname } from '@/lib/security'

type Sat69BStatusBucket =
  | 'PRESUNTO'
  | 'DEFINITIVO'
  | 'DESVIRTUADO'
  | 'SENTENCIA_FAVORABLE'
  | 'NO_LOCALIZADO'
  | 'OTRO'

type Sat69BEntryInput = {
  rfc: string
  taxpayerName: string | null
  statusLabel: string
  statusBucket: Sat69BStatusBucket
  isActiveRisk: boolean
  publicationDate: Date | null
  removalDate: Date | null
}

type Sat69BSyncSource =
  | { type: 'file'; value: string }
  | { type: 'url'; value: string }

const SAT_69B_URL_HOSTNAME_SUFFIX = '.sat.gob.mx'
const SAT_69B_FILE_DIRNAME = '.data' + path.sep + 'blacklist'
const SAT_69B_FETCH_TIMEOUT_MS = 60_000

export type Sat69BSyncResult = {
  source: string
  processedLines: number
  parsedEntries: number
  upsertedEntries: number
  activeRiskEntries: number
  removedStaleEntries: number
  skipped: boolean
}

export type EfosRiskSummary = {
  riskAmount: number
  supplierCount: number
  cfdiCount: number
  lastBlacklistSyncAt: string | null
}

export type EfosRiskInvoiceRow = {
  uuid: string
  file_name: string
  issuer_rfc: string
  issuer_name: string | null
  cfdi_type: string
  series: string | null
  folio: string | null
  issuance_date: Date | string | null
  total: unknown
  sat_estado: string | null
  status_label: string
  status_bucket: string
}

const SAT_69B_ACTIVE_RISK_BUCKETS: Sat69BStatusBucket[] = ['PRESUNTO', 'DEFINITIVO']

function normalizeText(value: string | null | undefined) {
  return (value || '').trim()
}

function normalizeRfc(value: string | null | undefined) {
  return normalizeText(value).toUpperCase()
}

function toNumber(value: unknown) {
  const parsed = Number(String(value ?? '').replace(/,/g, '').trim())
  return Number.isFinite(parsed) ? parsed : 0
}

function __isAllowedSat69BUrl(rawUrl: string): { ok: true; parsed: URL } | { ok: false; reason: string } {
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== 'https:') {
      return { ok: false, reason: `SAT 69B URL requiere HTTPS (recibido ${parsed.protocol})` }
    }
    const host = parsed.hostname.toLowerCase()
    if (!host.endsWith(SAT_69B_URL_HOSTNAME_SUFFIX) && host !== SAT_69B_URL_HOSTNAME_SUFFIX.slice(1)) {
      return { ok: false, reason: `Host 69B fuera de allow-list sat.gob.mx: ${host}` }
    }
    if (isInternalHostname(host)) {
      return { ok: false, reason: `Host 69B resuelve a IP interna/RFC1918/localhost/IMDS: ${host}` }
    }
    return { ok: true, parsed }
  } catch (err) {
    return { ok: false, reason: `URL SAT 69B inválida: ${String(err instanceof Error ? err.message : String(err))}` }
  }
}

function __isAllowedSat69BFilePath(rawPath: string): { ok: true; normalized: string } | { ok: false; reason: string } {
  try {
    const cwd = typeof process !== 'undefined' && typeof process.cwd === 'function' ? process.cwd() : '.'
    const normalized = path.resolve(cwd, rawPath)
    const allowedRoot = path.resolve(cwd, SAT_69B_FILE_DIRNAME) + path.sep
    const normalizedWithSep = normalized + (normalized.endsWith(path.sep) ? '' : path.sep)
    if (!normalizedWithSep.startsWith(allowedRoot)) {
      return { ok: false, reason: `Path archivo 69B fuera de ${SAT_69B_FILE_DIRNAME}/ (startsWith guard fail)` }
    }
    return { ok: true, normalized }
  } catch (err) {
    return { ok: false, reason: `Path SAT 69B inválido: ${String(err instanceof Error ? err.message : String(err))}` }
  }
}

function resolveSat69BSource(): Sat69BSyncSource | null {
  const filePath = normalizeText(process.env.SAT_69B_SOURCE_FILE_PATH)
  if (filePath) {
    const fileCheck = __isAllowedSat69BFilePath(filePath)
    if (!fileCheck.ok) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[SAT 69B] Source file bloqueado por seguridad: ${fileCheck.reason}`)
      }
      return null
    }
    return { type: 'file', value: fileCheck.normalized }
  }

  const url = normalizeText(process.env.SAT_69B_SOURCE_URL)
  if (url) {
    const urlCheck = __isAllowedSat69BUrl(url)
    if (!urlCheck.ok) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(`[SAT 69B] Source URL bloqueado por seguridad: ${urlCheck.reason}`)
      }
      return null
    }
    return { type: 'url', value: url }
  }

  return null
}

function classifyStatusBucket(line: string): { statusBucket: Sat69BStatusBucket; statusLabel: string; isActiveRisk: boolean } {
  const normalized = normalizeText(line).toUpperCase()

  if (normalized.includes('SENTENCIA FAVORABLE')) {
    return {
      statusBucket: 'SENTENCIA_FAVORABLE',
      statusLabel: 'Sentencia favorable',
      isActiveRisk: false
    }
  }

  if (normalized.includes('DESVIRTU')) {
    return {
      statusBucket: 'DESVIRTUADO',
      statusLabel: 'Desvirtuado',
      isActiveRisk: false
    }
  }

  if (normalized.includes('DEFINITIV')) {
    return {
      statusBucket: 'DEFINITIVO',
      statusLabel: 'Definitivo',
      isActiveRisk: true
    }
  }

  if (normalized.includes('PRESUNT')) {
    return {
      statusBucket: 'PRESUNTO',
      statusLabel: 'Presunto',
      isActiveRisk: true
    }
  }

  if (normalized.includes('NO LOCALIZADO')) {
    return {
      statusBucket: 'NO_LOCALIZADO',
      statusLabel: 'No localizado',
      isActiveRisk: false
    }
  }

  return {
    statusBucket: 'OTRO',
    statusLabel: 'Otro',
    isActiveRisk: false
  }
}

function extractFirstDate(value: string) {
  const isoMatch = value.match(/\b(\d{4}-\d{2}-\d{2})\b/)
  if (isoMatch) {
    const parsed = new Date(`${isoMatch[1]}T00:00:00.000Z`)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  const mxMatch = value.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/)
  if (mxMatch) {
    const parsed = new Date(`${mxMatch[3]}-${mxMatch[2]}-${mxMatch[1]}T00:00:00.000Z`)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  return null
}

function inferTaxpayerName(line: string, rfc: string) {
  const compact = line.replace(/\s+/g, ' ').trim()
  const parts = compact.split(/[|,;\t]/).map(part => normalizeText(part)).filter(Boolean)
  const upperRfc = normalizeRfc(rfc)
  const candidate = parts.find(part => normalizeRfc(part) !== upperRfc && !/\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2}/.test(part))

  if (!candidate) {
    return null
  }

  if (candidate.toUpperCase().includes('PRESUNT') || candidate.toUpperCase().includes('DEFINITIV')) {
    return null
  }

  return candidate.slice(0, 255)
}

function parseSat69BLine(line: string): Sat69BEntryInput | null {
  const normalizedLine = normalizeText(line)
  if (!normalizedLine) {
    return null
  }

  if (/RFC|CONTRIBUYENTE|SITUACI[ÓO]N/i.test(normalizedLine) && !/\b[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}\b/i.test(normalizedLine)) {
    return null
  }

  const rfcMatch = normalizedLine.match(/\b[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}\b/i)
  if (!rfcMatch) {
    return null
  }

  const rfc = normalizeRfc(rfcMatch[0])
  const status = classifyStatusBucket(normalizedLine)
  const publicationDate = extractFirstDate(normalizedLine)

  return {
    rfc,
    taxpayerName: inferTaxpayerName(normalizedLine, rfc),
    statusLabel: status.statusLabel,
    statusBucket: status.statusBucket,
    isActiveRisk: status.isActiveRisk,
    publicationDate,
    removalDate: null
  }
}

async function createLineReader(source: Sat69BSyncSource) {
  if (source.type === 'file') {
    const stream = fs.createReadStream(source.value, { encoding: 'utf8' })
    return readline.createInterface({ input: stream, crlfDelay: Infinity })
  }

  const urlCheck = __isAllowedSat69BUrl(source.value)
  if (!urlCheck.ok) {
    throw new Error(`SAT 69B fetch bloqueado: ${urlCheck.reason}`)
  }
  const host = urlCheck.parsed.hostname
  if (isInternalHostname(host)) {
    throw new Error(`SAT 69B fetch bloqueado: hostname ${host} resuelve a IP interna/IMDS`)
  }

  const response = await fetch(source.value, {
    method: 'GET',
    headers: {
      'Accept': 'text/plain;q=0.9,*/*;q=0.1',
      'User-Agent': 'Platfi-Intelligence-SAT-69B-Sync/1.0 (+https://platfi.mx/security.txt)',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(SAT_69B_FETCH_TIMEOUT_MS),
  })

  if (!response.ok || !response.body) {
    throw new Error(`No fue posible descargar la lista 69-B desde ${source.value} (HTTP ${response.status}).`)
  }

  const stream = Readable.fromWeb(response.body as unknown as NodeReadableStream)
  return readline.createInterface({ input: stream, crlfDelay: Infinity })
}

async function upsertSat69BEntriesChunk(entries: Sat69BEntryInput[], runAt: Date) {
  if (entries.length === 0) {
    return
  }

  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO sat_69b_blacklist_entries (
        rfc,
        taxpayer_name,
        status_label,
        status_bucket,
        is_active_risk,
        publication_date,
        removal_date,
        source_type,
        last_seen_at,
        created_at,
        updated_at
      )
      VALUES ${Prisma.join(entries.map(entry => Prisma.sql`(
        ${entry.rfc},
        ${entry.taxpayerName},
        ${entry.statusLabel},
        ${entry.statusBucket},
        ${entry.isActiveRisk},
        ${entry.publicationDate},
        ${entry.removalDate},
        ${'SAT_69B'},
        ${runAt},
        NOW(),
        NOW()
      )`))}
      ON CONFLICT (rfc) DO UPDATE
      SET
        taxpayer_name = EXCLUDED.taxpayer_name,
        status_label = EXCLUDED.status_label,
        status_bucket = EXCLUDED.status_bucket,
        is_active_risk = EXCLUDED.is_active_risk,
        publication_date = EXCLUDED.publication_date,
        removal_date = EXCLUDED.removal_date,
        source_type = EXCLUDED.source_type,
        last_seen_at = EXCLUDED.last_seen_at,
        updated_at = NOW()
    `
  )
}

export async function syncSat69BBlacklist() {
  const source = resolveSat69BSource()
  if (!source) {
    return {
      source: 'not_configured',
      processedLines: 0,
      parsedEntries: 0,
      upsertedEntries: 0,
      activeRiskEntries: 0,
      removedStaleEntries: 0,
      skipped: true
    } satisfies Sat69BSyncResult
  }

  const runAt = new Date()
  const lineReader = await createLineReader(source)
  const entriesMap = new Map<string, Sat69BEntryInput>()
  let processedLines = 0

  for await (const line of lineReader) {
    processedLines += 1
    const parsed = parseSat69BLine(line)

    if (!parsed) {
      continue
    }

    entriesMap.set(parsed.rfc, parsed)
  }

  const entries = Array.from(entriesMap.values())
  const chunkSize = 1000

  for (let offset = 0; offset < entries.length; offset += chunkSize) {
    await upsertSat69BEntriesChunk(entries.slice(offset, offset + chunkSize), runAt)
  }

  const removedResult = await prisma.sat69BBlacklistEntry.deleteMany({
    where: {
      lastSeenAt: {
        lt: runAt
      }
    }
  })

  return {
    source: source.value,
    processedLines,
    parsedEntries: entries.length,
    upsertedEntries: entries.length,
    activeRiskEntries: entries.filter(entry => entry.isActiveRisk).length,
    removedStaleEntries: removedResult.count,
    skipped: false
  } satisfies Sat69BSyncResult
}

export async function getEfosRiskSummary(params: {
  organizationId: string
  companyId: string
  startDate?: Date | null
  endDate?: Date | null
}) {
  const result = await prisma.$queryRaw<Array<{
    risk_amount: unknown
    supplier_count: number
    cfdi_count: number
    last_blacklist_sync_at: Date | string | null
  }>>(Prisma.sql`
    SELECT
      COALESCE(SUM(summary.total_amount), 0) AS risk_amount,
      COUNT(DISTINCT summary.issuer_rfc)::int AS supplier_count,
      COALESCE(SUM(summary.cfdi_count), 0)::int AS cfdi_count,
      MAX(blacklist.last_seen_at) AS last_blacklist_sync_at
    FROM provider_received_cfdi_daily_summary summary
    INNER JOIN sat_69b_blacklist_entries blacklist
      ON blacklist.rfc = summary.issuer_rfc
      AND blacklist.is_active_risk = true
    WHERE summary.organization_id = ${params.organizationId}
      AND summary.receiver_company_id = ${params.companyId}
      AND summary.cfdi_type IN ('I', 'E', 'T')
      ${params.startDate ? Prisma.sql`AND summary.summary_date >= ${params.startDate}` : Prisma.empty}
      ${params.endDate ? Prisma.sql`AND summary.summary_date <= ${params.endDate}` : Prisma.empty}
  `)

  const row = result[0]

  return {
    riskAmount: toNumber(row?.risk_amount),
    supplierCount: Number(row?.supplier_count || 0),
    cfdiCount: Number(row?.cfdi_count || 0),
    lastBlacklistSyncAt: row?.last_blacklist_sync_at ? new Date(row.last_blacklist_sync_at).toISOString() : null
  } satisfies EfosRiskSummary
}

export async function listEfosRiskInvoices(params: {
  organizationId: string
  companyId: string
  startDate?: Date | null
  endDate?: Date | null
}) {
  return prisma.$queryRaw<EfosRiskInvoiceRow[]>(Prisma.sql`
    SELECT
      cfdi.uuid,
      cfdi.file_name,
      cfdi.issuer_rfc,
      cfdi.issuer_name,
      cfdi.cfdi_type,
      cfdi.series,
      cfdi.folio,
      cfdi.issuance_date,
      cfdi.total,
      cfdi.sat_estado,
      blacklist.status_label,
      blacklist.status_bucket
    FROM provider_uploaded_cfdis cfdi
    INNER JOIN sat_69b_blacklist_entries blacklist
      ON blacklist.rfc = cfdi.issuer_rfc
      AND blacklist.is_active_risk = true
    WHERE cfdi.organization_id = ${params.organizationId}
      AND cfdi.receiver_company_id = ${params.companyId}
      AND cfdi.validation_status = 'APPROVED'
      AND cfdi.cfdi_type IN ('I', 'E', 'T')
      ${params.startDate ? Prisma.sql`AND cfdi.issuance_date >= ${params.startDate}` : Prisma.empty}
      ${params.endDate ? Prisma.sql`AND cfdi.issuance_date <= ${params.endDate}` : Prisma.empty}
    ORDER BY cfdi.issuance_date DESC NULLS LAST, cfdi.uuid DESC
  `)
}

export function isSat69BActiveRiskStatus(value: string | null | undefined) {
  return SAT_69B_ACTIVE_RISK_BUCKETS.includes((normalizeText(value).toUpperCase() as Sat69BStatusBucket))
}
