import type { CfdiType, InvoiceStatus, SatStatus } from '@prisma/client'
import { escapeHtml } from '@/lib/rfc-validate'
import { SAT_IMPORT_DEMO_DEFAULT_INVOICES, SAT_IMPORT_DEMO_MAX_INVOICES_BATCH, SAT_FISCAL_ENTITY_HARDCODE_POSTALCODE } from '@/lib/sat-gate-helpers'

export type SatSeederRng = () => number

export interface SatDemoSupplierClient {
  rfc: string
  name: string
}

export interface SatDemoBuildParams {
  count?: number
  fiscalEntityId: string
  companyRfc: string
  companyBusinessName: string
  userId: string
  issuanceStartIso?: string
  rand?: SatSeederRng
  suppliers?: ReadonlyArray<SatDemoSupplierClient>
  clients?: ReadonlyArray<SatDemoSupplierClient>
  nowOverride?: Date
}

export interface SatDemoInvoiceBuilt {
  userId: string
  fiscalEntityId: string
  uuid: string
  cfdiType: CfdiType
  series: string
  folio: string
  currency: 'MXN'
  exchangeRate: null
  status: InvoiceStatus
  satStatus: SatStatus
  issuerRfc: string
  issuerName: string
  receiverRfc: string
  receiverName: string
  subtotal: number
  total: number
  ivaTrasladado: number
  ivaRetenido: 0
  isrRetenido: 0
  iepsRetenido: 0
  xmlContent: string
  pdfUrl: null
  issuanceDate: Date
  certificationDate: Date
  certificationPac: 'SAT'
  paymentMethod: 'PUE' | 'PPD'
  paymentForm: '01' | '03' | '99'
  usageCfdi: 'G03'
  expeditionPlace: string
}

const DEFAULT_SUPPLIERS: ReadonlyArray<SatDemoSupplierClient> = Object.freeze([
  { rfc: 'PROV001234AB1', name: 'Proveedor Uno SA de CV' },
  { rfc: 'PROV00DEF5678', name: 'Servicios Globales MX SA de CV' },
  { rfc: 'PROV00XYZ9999', name: 'Distribuciones del Norte SA de CV' },
])

const DEFAULT_CLIENTS: ReadonlyArray<SatDemoSupplierClient> = Object.freeze([
  { rfc: 'CLI001234AB1', name: 'Cliente Uno SA de CV' },
  { rfc: 'CLI00DEF5678', name: 'Retail MX SA de CV' },
  { rfc: 'CLI00XYZ9999', name: 'Comercializadora Centro SA de CV' },
])

const CFDI_TYPES: ReadonlyArray<CfdiType> = Object.freeze(['INGRESO' as CfdiType, 'EGRESO' as CfdiType, 'PAGO' as CfdiType, 'NOMINA' as CfdiType])
const SAT_STATUSES: ReadonlyArray<SatStatus> = Object.freeze(['VIGENTE' as SatStatus, 'CANCELADO' as SatStatus, 'NO_ENCONTRADO' as SatStatus])
const PAYMENT_METHODS: ReadonlyArray<'PUE' | 'PPD'> = Object.freeze(['PUE', 'PPD'])
const PAYMENT_FORMS: ReadonlyArray<'01' | '03' | '99'> = Object.freeze(['01', '03', '99'])

function __satDefaultMathRng(): SatSeederRng { return Math.random }

function __satRandInt(rng: SatSeederRng, minInc: number, maxInc: number): number {
  if (!Number.isFinite(minInc)) minInc = 0
  if (!Number.isFinite(maxInc)) maxInc = 0
  if (maxInc < minInc) { const tmp = minInc; minInc = maxInc; maxInc = tmp }
  const r = rng()
  const normalized = Number.isFinite(r) && r >= 0 && r < 1 ? r : 0.5
  return Math.floor(normalized * (maxInc - minInc + 1)) + minInc
}

function __satSanitizeLen(val: unknown, maxLen: number, defaultFallback: string): string {
  const raw = val == null ? '' : String(val)
  const trimmed = raw.trim()
  if (!trimmed) return defaultFallback
  const escaped = escapeHtml(trimmed)
  if (escaped.length <= maxLen) return escaped
  return escaped.slice(0, maxLen)
}

export function sanitizeSatDemoCount(raw: unknown): { ok: true; value: number } | { ok: false; status: 400; error: string } {
  if (raw == null) return { ok: true, value: SAT_IMPORT_DEMO_DEFAULT_INVOICES }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return { ok: false, status: 400, error: 'count debe ser entero finito (batch demo SAT 48 max)' }
  }
  const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10)
  if (!Number.isFinite(n) || Number.isNaN(n)) return { ok: false, status: 400, error: 'count inválido (no es entero base 10, demo SAT)' }
  if (n < 1) return { ok: false, status: 400, error: 'count mínimo 1 (demo SAT)' }
  if (n > SAT_IMPORT_DEMO_MAX_INVOICES_BATCH) return { ok: false, status: 400, error: `count máximo ${SAT_IMPORT_DEMO_MAX_INVOICES_BATCH} (demo SAT, protege DoS insert rows)` }
  return { ok: true, value: Math.trunc(n) }
}

export function buildDemoSatInvoices(params: SatDemoBuildParams): ReadonlyArray<SatDemoInvoiceBuilt> {
  const countOk = sanitizeSatDemoCount(params.count)
  if (!countOk.ok) {
    throw new Error(`SAT_SEEDER_BAD_COUNT: ${countOk.error}`)
  }
  const count = countOk.value
  const now = params.nowOverride instanceof Date ? params.nowOverride : new Date()
  let rng: SatSeederRng
  if (typeof params.rand === 'function') {
    rng = params.rand
  } else {
    const factory = __satDefaultMathRng()
    rng = typeof factory === 'function' ? factory : Math.random
  }
  const suppliers = params.suppliers && params.suppliers.length > 0 ? params.suppliers : DEFAULT_SUPPLIERS
  const clients = params.clients && params.clients.length > 0 ? params.clients : DEFAULT_CLIENTS
  const companyRfc = __satSanitizeLen(params.companyRfc, 13, 'SATDEMORFC001')
  const companyBusiness = __satSanitizeLen(params.companyBusinessName, 255, `Empresa Demo ${companyRfc}`)
  const feid = __satSanitizeLen(params.fiscalEntityId, 64, 'fe_sat_demo_sin_id')
  const uid = __satSanitizeLen(params.userId, 64, 'user_sat_demo_sin_id')
  const usage = 'G03' as const
  const place = __satSanitizeLen(SAT_FISCAL_ENTITY_HARDCODE_POSTALCODE, 5, '00000') as '04120'

  const out: SatDemoInvoiceBuilt[] = []
  for (let i = 0; i < count; i++) {
    const issued = i % 2 === 0
    const date = new Date(now.getTime())
    const monthOffset = __satRandInt(rng, 0, 11)
    date.setMonth(now.getMonth() - monthOffset)
    const dayOfMonth = Math.min(date.getDate(), 28)
    date.setDate(dayOfMonth)
    const subtotal = __satRandInt(rng, 5000, 300_000)
    const ivaT = Math.round(subtotal * 16) / 100
    const total = Number((subtotal + ivaT).toFixed(2))
    const subtotalFixed = Number((total - ivaT).toFixed(2))
    const issuer = issued ? { rfc: companyRfc, name: companyBusiness } : suppliers[__satRandInt(rng, 0, suppliers.length - 1)]
    const receiver = issued ? clients[__satRandInt(rng, 0, clients.length - 1)] : { rfc: companyRfc, name: companyBusiness }
    const uuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `sat_demo_${Date.now()}_${i}_${Math.floor(rng() * 1e9)}`

    out.push({
      userId: uid,
      fiscalEntityId: feid,
      uuid,
      cfdiType: CFDI_TYPES[__satRandInt(rng, 0, CFDI_TYPES.length - 1)],
      series: issued ? 'S' : 'R',
      folio: String(__satRandInt(rng, 1000, 9999)),
      currency: 'MXN',
      exchangeRate: null,
      status: 'ACTIVE' as InvoiceStatus,
      satStatus: SAT_STATUSES[__satRandInt(rng, 0, SAT_STATUSES.length - 1)],
      issuerRfc: __satSanitizeLen(issuer.rfc, 13, 'SATDEMORFC001'),
      issuerName: __satSanitizeLen(issuer.name, 255, `Issuer Demo ${i}`),
      receiverRfc: __satSanitizeLen(receiver.rfc, 13, 'SATDEMORFC002'),
      receiverName: __satSanitizeLen(receiver.name, 255, `Receiver Demo ${i}`),
      subtotal: subtotalFixed,
      total,
      ivaTrasladado: Number(ivaT.toFixed(2)),
      ivaRetenido: 0,
      isrRetenido: 0,
      iepsRetenido: 0,
      xmlContent: '<xml><demo>SAT_IMPORT_DEMO_PLACEHOLDER_SIN_DATOS_SAT_OFICIAL</demo></xml>',
      pdfUrl: null,
      issuanceDate: new Date(date.getTime()),
      certificationDate: new Date(date.getTime() + 60_000),
      certificationPac: 'SAT',
      paymentMethod: PAYMENT_METHODS[__satRandInt(rng, 0, PAYMENT_METHODS.length - 1)],
      paymentForm: PAYMENT_FORMS[__satRandInt(rng, 0, PAYMENT_FORMS.length - 1)],
      usageCfdi: usage,
      expeditionPlace: place,
    })
  }
  return Object.freeze(out)
}
