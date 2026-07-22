import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, type CipherGCM, type DecipherGCM } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { upsertProviderUploadedCfdiComplementProjection } from '@/lib/cfdi-complement-projection-storage'
import { calculateProviderPaymentComplementDueDate } from '@/lib/provider-payment-compliance'
import { syncProviderReceivedCfdiSummaryRecordChange } from '@/lib/provider-received-cfdi-summary'

export type ProviderPersistedPaymentDetail = {
  paymentUuid: string
  paymentDate: string
  paymentSeries: string | null
  paymentFolio: string | null
  montoPagado: number
  montoTotalPagos: number
  monedaPago: string
  equivalenciaDR: number
  numParcialidad: number
  impSaldoAnt: number
  impSaldoInsoluto: number
}

type ProviderPersistedPaymentLink = ProviderPersistedPaymentDetail & {
  relatedUuid?: string
}

export const PROVIDER_PAYMENT_STATUS_VALUES = ['INICIAL', 'EN_PROCESO', 'PAGADO', 'COMPLETO'] as const

export type ProviderPaymentStatusValue = (typeof PROVIDER_PAYMENT_STATUS_VALUES)[number]

export type ProviderPersistedReportRow = {
  id: string
  storageId: string
  fileName: string
  receptorRfc: string
  providerId: string
  emisorRfc: string
  emisorNombre: string
  tipoComprobante: string
  serie: string
  folio: string
  uuid: string
  fechaComprobante: string
  fechaRecepcion: string
  metodoPago: string
  estatusPago: string
  fechaPago: string
  subtotal: number
  totalImpuestosTrasladados: number
  totalImpuestosRetenidos: number
  descuento: number
  total: number
  montoPago: number
  monedaPago: string
  totalOriginal: number
  totalPagado: number
  saldoPorCobrar: number
  moneda: string
  estatus: string
  satCodigoEstatus: string
  satEstado: string
  satEsCancelable: string
  satEstatusCancelacion: string
  satValidacionEFOS: string
  payments: ProviderPersistedPaymentDetail[]
}

type ProviderPaymentStateSnapshot = {
  status: string
  paymentDate: string
  source: 'manual' | 'automatic'
}

export type PersistableProviderAcceptedCfdi = {
  fileName: string
  xmlContent: string
  uuid: string
  providerRfc: string
  providerName: string | null
  issuerRfc: string
  issuerName: string
  receiverRfc: string
  receiverName: string
  cfdiType: string
  series: string
  folio: string
  paymentMethod: string
  paymentForm: string
  issuerFiscalRegime: string
  hasResicoIsrRetention: boolean
  hasObjetoImpTaxMismatch: boolean
  objetoImpTaxMismatchReason: string
  currency: string
  subtotal: number
  transferredTaxesTotal: number
  withheldTaxesTotal: number
  discount: number
  total: number
  issuanceDate: string
  certificationDate: string
  validationAnexo20: string
  validationSat: string
  satCodigoEstatus: string
  satEstado: string
  satEsCancelable: string
  satEstatusCancelacion: string
  satValidacionEFOS: string
  paymentLinksJson?: unknown
}

type ProviderContextForStorage = {
  organizationId: string
  memberId: string
  providerRfc: string
  providerName: string | null
  allowedCompanies: Array<{
    id: string
    rfc: string
  }>
}

type StoredProviderCfdiRecord = {
  id: string
  file_name: string
  uuid: string
  receiver_rfc: string
  provider_rfc: string
  issuer_rfc: string
  issuer_name: string | null
  cfdi_type: string
  series: string | null
  folio: string | null
  payment_method: string | null
  currency: string | null
  subtotal: unknown
  transferred_taxes_total: unknown
  withheld_taxes_total: unknown
  discount: unknown
  total: unknown
  issuance_date: Date | string | null
  last_validated_at: Date | string | null
  sat_codigo_estatus: string | null
  sat_estado: string | null
  sat_es_cancelable: string | null
  sat_estatus_cancelacion: string | null
  sat_validacion_efos: string | null
  payment_links_json: unknown
  payment_status_manual: string | null
  payment_date_manual: Date | string | null
}

type ProviderPaymentUpdateRecord = {
  id: string
  uuid: string
  organization_id: string
  receiver_company_id: string | null
  provider_rfc: string
  receiver_rfc: string
  issuer_rfc: string
  issuer_name: string | null
  cfdi_type: string
  payment_method: string | null
  total: unknown
  issuance_date: Date | string | null
  sat_estado: string | null
  transferred_taxes_total: unknown
  withheld_taxes_total: unknown
  payment_status_manual: string | null
  payment_date_manual: Date | string | null
  validation_status: string
}

const PROVIDER_XML_ENCRYPTION_KEY_ENV = 'PROVIDER_CFDI_XML_ENCRYPTION_KEY'
const PROVIDER_XML_KEY_VERSION = process.env.PROVIDER_CFDI_XML_KEY_VERSION || 'v1'
const PROVIDER_XML_ENCRYPTION_ALGORITHM = 'aes-256-gcm'
const PROVIDER_XML_IV_LENGTH = 12

function normalizeRfc(value: string | null | undefined) {
  return (value || '').trim().toUpperCase()
}

function normalizeText(value: string | null | undefined) {
  return (value || '').trim()
}

function toNumber(value: unknown) {
  const parsed = Number(String(value ?? '').replace(/,/g, '').trim())
  return Number.isFinite(parsed) ? parsed : 0
}

function toIsoString(value: Date | string | null | undefined) {
  if (!value) {
    return ''
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString()
}

function normalizePaymentStatus(value: string | null | undefined) {
  return normalizeText(value).toUpperCase()
}

function resolveEncryptionKey() {
  const rawValue = process.env[PROVIDER_XML_ENCRYPTION_KEY_ENV]
  if (!rawValue) {
    throw new Error(
      `No se encontró la llave ${PROVIDER_XML_ENCRYPTION_KEY_ENV}. Configúrala para habilitar el resguardo cifrado de XML de proveedores.`
    )
  }

  const normalizedValue = rawValue.trim()

  if (/^[0-9a-fA-F]{64}$/.test(normalizedValue)) {
    return createHash('sha256').update(Buffer.from(normalizedValue, 'hex')).digest()
  }

  try {
    const base64Buffer = Buffer.from(normalizedValue, 'base64')
    if (base64Buffer.length >= 32) {
      return createHash('sha256').update(base64Buffer).digest()
    }
  } catch {}

  return createHash('sha256').update(normalizedValue, 'utf8').digest()
}

function sha256Hex(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function encryptXmlContent(xmlContent: string) {
  const key = resolveEncryptionKey()
  const iv = randomBytes(PROVIDER_XML_IV_LENGTH)
  const cipher = createCipheriv(PROVIDER_XML_ENCRYPTION_ALGORITHM, key, iv) as CipherGCM

  const ciphertext = Buffer.concat([cipher.update(xmlContent, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return {
    sha256: sha256Hex(xmlContent),
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    algorithm: PROVIDER_XML_ENCRYPTION_ALGORITHM,
    keyVersion: PROVIDER_XML_KEY_VERSION
  }
}

export function decryptXmlContent(params: {
  ciphertext: string
  iv: string
  authTag: string
  algorithm: string
}) {
  const key = resolveEncryptionKey()
  const decipher = createDecipheriv(
    params.algorithm || PROVIDER_XML_ENCRYPTION_ALGORITHM,
    key,
    Buffer.from(params.iv, 'base64')
  ) as DecipherGCM
  decipher.setAuthTag(Buffer.from(params.authTag, 'base64'))

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(params.ciphertext, 'base64')),
    decipher.final()
  ])

  return decrypted.toString('utf8')
}

function getStatusForInvoice(total: number, metodoPago: string, totalPagado: number) {
  const normalizedMetodo = normalizeText(metodoPago).toUpperCase()

  if (normalizedMetodo === 'PUE') {
    return 'Pagado'
  }

  const saldoPorCobrar = Math.max(total - totalPagado, 0)
  if (saldoPorCobrar <= 0.01) {
    return 'Pagado'
  }

  if (totalPagado > 0.01) {
    return 'Parcialmente cobrado'
  }

  if (normalizedMetodo === 'PPD') {
    return 'Pendiente'
  }

  return 'Pendiente'
}

function getEffectivePaymentState(params: {
  manualStatus: string | null | undefined
  manualPaymentDate: Date | string | null | undefined
  automaticStatus: string
  automaticPaymentDate: string
}): ProviderPaymentStateSnapshot {
  const manualStatus = normalizePaymentStatus(params.manualStatus)

  if (manualStatus) {
    return {
      status: manualStatus,
      paymentDate: toIsoString(params.manualPaymentDate),
      source: 'manual'
    }
  }

  return {
    status: params.automaticStatus,
    paymentDate: params.automaticPaymentDate,
    source: 'automatic'
  }
}

function mapStoredRecordsToReportRows(records: StoredProviderCfdiRecord[], allowedReceiverRfcs: Set<string>) {
  const invoiceRecords = records.filter(record => {
    return record.cfdi_type !== 'P' && allowedReceiverRfcs.has(normalizeRfc(record.receiver_rfc))
  })
  const invoiceUuidSet = new Set(invoiceRecords.map(record => normalizeText(record.uuid).toUpperCase()))
  const paymentsByInvoice = new Map<string, ProviderPersistedPaymentDetail[]>()

  records
    .filter(record => record.cfdi_type === 'P')
    .forEach(record => {
      const paymentLinks = Array.isArray(record.payment_links_json)
        ? (record.payment_links_json as ProviderPersistedPaymentLink[])
        : []

      paymentLinks.forEach(currentLink => {
        const relatedUuid = normalizeText(currentLink.relatedUuid).toUpperCase()
        if (!relatedUuid || !invoiceUuidSet.has(relatedUuid)) {
          return
        }

        const currentPayments = paymentsByInvoice.get(relatedUuid) || []
        currentPayments.push({
          paymentUuid: normalizeText(currentLink.paymentUuid),
          paymentDate: normalizeText(currentLink.paymentDate),
          paymentSeries: currentLink.paymentSeries || null,
          paymentFolio: currentLink.paymentFolio || null,
          montoPagado: toNumber(currentLink.montoPagado),
          montoTotalPagos: toNumber(currentLink.montoTotalPagos),
          monedaPago: normalizeText(currentLink.monedaPago),
          equivalenciaDR: toNumber(currentLink.equivalenciaDR) || 1,
          numParcialidad: Math.trunc(toNumber(currentLink.numParcialidad)) || 1,
          impSaldoAnt: toNumber(currentLink.impSaldoAnt),
          impSaldoInsoluto: toNumber(currentLink.impSaldoInsoluto)
        })
        paymentsByInvoice.set(relatedUuid, currentPayments)
      })
    })

  return invoiceRecords
    .map<ProviderPersistedReportRow>(record => {
      const uuid = normalizeText(record.uuid).toUpperCase()
      const payments = (paymentsByInvoice.get(uuid) || [])
        .sort((left, right) => new Date(left.paymentDate).getTime() - new Date(right.paymentDate).getTime())

      const total = toNumber(record.total)
      const metodoPago = normalizeText(record.payment_method)
      const totalPagado = payments.reduce((acc, payment) => {
        const equivalencia = payment.equivalenciaDR > 0 ? payment.equivalenciaDR : 1
        return acc + (payment.montoPagado * equivalencia)
      }, metodoPago.toUpperCase() === 'PUE' ? total : 0)

      const saldoPorCobrar = Math.max(total - totalPagado, 0)
      const latestPayment = payments[payments.length - 1]
      const paymentCurrencies = Array.from(new Set(payments.map(payment => payment.monedaPago).filter(Boolean)))
      const automaticPaymentStatus = getStatusForInvoice(total, metodoPago, totalPagado)
      const effectivePaymentState = getEffectivePaymentState({
        manualStatus: record.payment_status_manual,
        manualPaymentDate: record.payment_date_manual,
        automaticStatus: automaticPaymentStatus,
        automaticPaymentDate: latestPayment?.paymentDate || ''
      })

      return {
        id: uuid,
        storageId: record.id,
        fileName: normalizeText(record.file_name),
        receptorRfc: normalizeRfc(record.receiver_rfc),
        providerId: normalizeRfc(record.provider_rfc),
        emisorRfc: normalizeRfc(record.issuer_rfc),
        emisorNombre: normalizeText(record.issuer_name),
        tipoComprobante: normalizeText(record.cfdi_type),
        serie: normalizeText(record.series),
        folio: normalizeText(record.folio),
        uuid,
        fechaComprobante: toIsoString(record.issuance_date),
        fechaRecepcion: toIsoString(record.last_validated_at),
        metodoPago,
        estatusPago: effectivePaymentState.status,
        fechaPago: effectivePaymentState.paymentDate,
        subtotal: toNumber(record.subtotal),
        totalImpuestosTrasladados: toNumber(record.transferred_taxes_total),
        totalImpuestosRetenidos: toNumber(record.withheld_taxes_total),
        descuento: toNumber(record.discount),
        total,
        montoPago: payments.reduce((acc, payment) => acc + payment.montoTotalPagos, 0),
        monedaPago: paymentCurrencies.length === 1 ? paymentCurrencies[0] : paymentCurrencies.length > 1 ? 'MULTI' : '',
        totalOriginal: total,
        totalPagado,
        saldoPorCobrar,
        moneda: normalizeText(record.currency) || 'MXN',
        estatus: automaticPaymentStatus,
        satCodigoEstatus: normalizeText(record.sat_codigo_estatus),
        satEstado: normalizeText(record.sat_estado),
        satEsCancelable: normalizeText(record.sat_es_cancelable),
        satEstatusCancelacion: normalizeText(record.sat_estatus_cancelacion),
        satValidacionEFOS: normalizeText(record.sat_validacion_efos),
        payments
      }
    })
    .sort((left, right) => new Date(right.fechaComprobante).getTime() - new Date(left.fechaComprobante).getTime())
}

export async function persistProviderAcceptedCfdis(params: {
  records: PersistableProviderAcceptedCfdi[]
  context: ProviderContextForStorage
  uploadedByUserId: string
}) {
  if (params.records.length === 0) {
    return
  }

  const companyIdByRfc = new Map(
    params.context.allowedCompanies.map(company => [normalizeRfc(company.rfc), company.id] as const)
  )

  await prisma.$transaction(async tx => {
    for (const record of params.records) {
      const normalizedUuid = normalizeText(record.uuid).toUpperCase()
      const existingRecord = await tx.providerUploadedCfdi.findUnique({
        where: {
          organizationId_uuid: {
            organizationId: params.context.organizationId,
            uuid: normalizedUuid
          }
        },
        select: {
          id: true,
          organizationId: true,
          receiverCompanyId: true,
          issuanceDate: true,
          cfdiType: true,
          satEstado: true,
          issuerRfc: true,
          issuerName: true,
          paymentMethod: true,
          paymentStatusManual: true,
          total: true,
          transferredTaxesTotal: true,
          withheldTaxesTotal: true,
          validationStatus: true
        }
      })
      const storageId = existingRecord?.id || randomUUID()
      const encryptedXml = encryptXmlContent(record.xmlContent)
      const receiverCompanyId = companyIdByRfc.get(normalizeRfc(record.receiverRfc)) || null
      const paymentLinksJson = typeof record.paymentLinksJson === 'undefined' ? null : JSON.stringify(record.paymentLinksJson)
      const issuanceDate = record.issuanceDate ? new Date(record.issuanceDate) : null
      const certificationDate = record.certificationDate ? new Date(record.certificationDate) : null

      await tx.$executeRaw(
        Prisma.sql`
          INSERT INTO provider_uploaded_cfdis (
            id,
            organization_id,
            member_id,
            uploaded_by_user_id,
            receiver_company_id,
            file_name,
            uuid,
            provider_rfc,
            provider_name,
            issuer_rfc,
            issuer_name,
            receiver_rfc,
            receiver_name,
            cfdi_type,
            series,
            folio,
            payment_method,
            payment_form,
            issuer_fiscal_regime,
            has_resico_isr_retention,
            has_objetoimp_tax_mismatch,
            objetoimp_tax_mismatch_reason,
            currency,
            subtotal,
            transferred_taxes_total,
            withheld_taxes_total,
            discount,
            total,
            issuance_date,
            certification_date,
            validation_status,
            validation_anexo20,
            validation_sat,
            sat_codigo_estatus,
            sat_estado,
            sat_initial_estado,
            sat_es_cancelable,
            sat_estatus_cancelacion,
            sat_validacion_efos,
            sat_status_last_checked_at,
            payment_links_json,
            xml_sha256,
            first_validated_at,
            last_validated_at
          )
          VALUES (
            ${storageId},
            ${params.context.organizationId},
            ${params.context.memberId},
            ${params.uploadedByUserId},
            ${receiverCompanyId},
            ${record.fileName},
            ${record.uuid},
            ${record.providerRfc},
            ${record.providerName},
            ${record.issuerRfc},
            ${record.issuerName},
            ${record.receiverRfc},
            ${record.receiverName},
            ${record.cfdiType},
            ${record.series || null},
            ${record.folio || null},
            ${record.paymentMethod || null},
            ${record.paymentForm || null},
            ${record.issuerFiscalRegime || null},
            ${record.hasResicoIsrRetention},
            ${record.hasObjetoImpTaxMismatch},
            ${record.objetoImpTaxMismatchReason || null},
            ${record.currency || 'MXN'},
            ${record.subtotal},
            ${record.transferredTaxesTotal},
            ${record.withheldTaxesTotal},
            ${record.discount},
            ${record.total},
            ${issuanceDate},
            ${certificationDate},
            'APPROVED',
            ${record.validationAnexo20},
            ${record.validationSat},
            ${record.satCodigoEstatus || null},
            ${record.satEstado || null},
            ${record.satEstado || null},
            ${record.satEsCancelable || null},
            ${record.satEstatusCancelacion || null},
            ${record.satValidacionEFOS || null},
            NOW(),
            CAST(${paymentLinksJson} AS jsonb),
            ${encryptedXml.sha256},
            NOW(),
            NOW()
          )
          ON CONFLICT (organization_id, uuid) DO UPDATE SET
            member_id = EXCLUDED.member_id,
            uploaded_by_user_id = EXCLUDED.uploaded_by_user_id,
            receiver_company_id = EXCLUDED.receiver_company_id,
            file_name = EXCLUDED.file_name,
            provider_rfc = EXCLUDED.provider_rfc,
            provider_name = EXCLUDED.provider_name,
            issuer_rfc = EXCLUDED.issuer_rfc,
            issuer_name = EXCLUDED.issuer_name,
            receiver_rfc = EXCLUDED.receiver_rfc,
            receiver_name = EXCLUDED.receiver_name,
            cfdi_type = EXCLUDED.cfdi_type,
            series = EXCLUDED.series,
            folio = EXCLUDED.folio,
            payment_method = EXCLUDED.payment_method,
            payment_form = EXCLUDED.payment_form,
            issuer_fiscal_regime = EXCLUDED.issuer_fiscal_regime,
            has_resico_isr_retention = EXCLUDED.has_resico_isr_retention,
            has_objetoimp_tax_mismatch = EXCLUDED.has_objetoimp_tax_mismatch,
            objetoimp_tax_mismatch_reason = EXCLUDED.objetoimp_tax_mismatch_reason,
            currency = EXCLUDED.currency,
            subtotal = EXCLUDED.subtotal,
            transferred_taxes_total = EXCLUDED.transferred_taxes_total,
            withheld_taxes_total = EXCLUDED.withheld_taxes_total,
            discount = EXCLUDED.discount,
            total = EXCLUDED.total,
            issuance_date = EXCLUDED.issuance_date,
            certification_date = EXCLUDED.certification_date,
            validation_status = EXCLUDED.validation_status,
            validation_anexo20 = EXCLUDED.validation_anexo20,
            validation_sat = EXCLUDED.validation_sat,
            sat_codigo_estatus = EXCLUDED.sat_codigo_estatus,
            sat_estado = EXCLUDED.sat_estado,
            sat_initial_estado = COALESCE(provider_uploaded_cfdis.sat_initial_estado, EXCLUDED.sat_initial_estado),
            sat_es_cancelable = EXCLUDED.sat_es_cancelable,
            sat_estatus_cancelacion = EXCLUDED.sat_estatus_cancelacion,
            sat_validacion_efos = EXCLUDED.sat_validacion_efos,
            sat_status_last_checked_at = NOW(),
            payment_links_json = EXCLUDED.payment_links_json,
            xml_sha256 = EXCLUDED.xml_sha256,
            last_validated_at = NOW(),
            upload_count = provider_uploaded_cfdis.upload_count + 1,
            updated_at = NOW()
        `
      )

      await tx.$executeRaw(
        Prisma.sql`
          INSERT INTO provider_uploaded_cfdi_blobs (
            provider_uploaded_cfdi_id,
            xml_ciphertext,
            xml_iv,
            xml_auth_tag,
            xml_encryption_alg,
            xml_key_version,
            created_at,
            updated_at
          )
          VALUES (
            ${storageId},
            ${encryptedXml.ciphertext},
            ${encryptedXml.iv},
            ${encryptedXml.authTag},
            ${encryptedXml.algorithm},
            ${encryptedXml.keyVersion},
            NOW(),
            NOW()
          )
          ON CONFLICT (provider_uploaded_cfdi_id) DO UPDATE SET
            xml_ciphertext = EXCLUDED.xml_ciphertext,
            xml_iv = EXCLUDED.xml_iv,
            xml_auth_tag = EXCLUDED.xml_auth_tag,
            xml_encryption_alg = EXCLUDED.xml_encryption_alg,
            xml_key_version = EXCLUDED.xml_key_version,
            updated_at = NOW()
        `
      )

      await upsertProviderUploadedCfdiComplementProjection(tx, {
        providerUploadedCfdiId: storageId,
        xmlContent: record.xmlContent
      })

      await syncProviderReceivedCfdiSummaryRecordChange({
        db: tx,
        previousRecord: existingRecord ? {
          organizationId: existingRecord.organizationId,
          receiverCompanyId: existingRecord.receiverCompanyId,
          issuanceDate: existingRecord.issuanceDate,
          cfdiType: existingRecord.cfdiType,
          satEstado: existingRecord.satEstado,
          issuerRfc: existingRecord.issuerRfc,
          issuerName: existingRecord.issuerName,
          paymentMethod: existingRecord.paymentMethod,
          paymentStatusManual: existingRecord.paymentStatusManual,
          total: existingRecord.total,
          transferredTaxesTotal: existingRecord.transferredTaxesTotal,
          withheldTaxesTotal: existingRecord.withheldTaxesTotal,
          validationStatus: existingRecord.validationStatus
        } : null,
        nextRecord: {
          organizationId: params.context.organizationId,
          receiverCompanyId,
          issuanceDate,
          cfdiType: record.cfdiType,
          satEstado: record.satEstado,
          issuerRfc: record.issuerRfc,
          issuerName: record.issuerName,
          paymentMethod: record.paymentMethod,
          paymentStatusManual: existingRecord?.paymentStatusManual || null,
          total: record.total,
          transferredTaxesTotal: record.transferredTaxesTotal,
          withheldTaxesTotal: record.withheldTaxesTotal,
          validationStatus: 'APPROVED'
        }
      })
    }
  })
}

export async function listProviderReportRowsFromStorage(context: ProviderContextForStorage) {
  const records = await prisma.$queryRaw<StoredProviderCfdiRecord[]>(
    Prisma.sql`
      SELECT
        id,
        file_name,
        uuid,
        receiver_rfc,
        provider_rfc,
        issuer_rfc,
        issuer_name,
        cfdi_type,
        series,
        folio,
        payment_method,
        currency,
        subtotal,
        transferred_taxes_total,
        withheld_taxes_total,
        discount,
        total,
        issuance_date,
        last_validated_at,
        sat_codigo_estatus,
        sat_estado,
        sat_es_cancelable,
        sat_estatus_cancelacion,
        sat_validacion_efos,
        payment_links_json,
        payment_status_manual,
        payment_date_manual
      FROM provider_uploaded_cfdis
      WHERE organization_id = ${context.organizationId}
        AND provider_rfc = ${context.providerRfc}
        AND validation_status = 'APPROVED'
      ORDER BY issuance_date DESC NULLS LAST, last_validated_at DESC, uuid DESC
    `
  )

  const allowedReceiverRfcs = new Set(context.allowedCompanies.map(company => normalizeRfc(company.rfc)))
  return mapStoredRecordsToReportRows(records, allowedReceiverRfcs)
}

export async function getStoredProviderXmlRecordById(params: {
  recordId: string
  context: ProviderContextForStorage
}) {
  const record = await prisma.$queryRaw<Array<{
    id: string
    uuid: string
    receiver_rfc: string
    sat_estado: string | null
    xml_ciphertext: string
    xml_iv: string
    xml_auth_tag: string
    xml_encryption_alg: string
  }>>(
    Prisma.sql`
      SELECT
        p.id,
        p.uuid,
        p.receiver_rfc,
        p.sat_estado,
        b.xml_ciphertext,
        b.xml_iv,
        b.xml_auth_tag,
        b.xml_encryption_alg
      FROM provider_uploaded_cfdis p
      INNER JOIN provider_uploaded_cfdi_blobs b
        ON b.provider_uploaded_cfdi_id = p.id
      WHERE p.id = ${params.recordId}
        AND p.organization_id = ${params.context.organizationId}
        AND p.provider_rfc = ${params.context.providerRfc}
        AND p.validation_status = 'APPROVED'
      LIMIT 1
    `
  )

  const currentRecord = record[0]
  if (!currentRecord) {
    return null
  }

  const allowedReceiverRfcs = new Set(params.context.allowedCompanies.map(company => normalizeRfc(company.rfc)))
  if (!allowedReceiverRfcs.has(normalizeRfc(currentRecord.receiver_rfc))) {
    return null
  }

  return {
    id: currentRecord.id,
    uuid: currentRecord.uuid,
    satEstado: normalizeText(currentRecord.sat_estado),
    xmlContent: decryptXmlContent({
      ciphertext: currentRecord.xml_ciphertext,
      iv: currentRecord.xml_iv,
      authTag: currentRecord.xml_auth_tag,
      algorithm: currentRecord.xml_encryption_alg
    })
  }
}

export async function getStoredProviderXmlRecordForCompany(params: {
  recordId: string
  organizationId: string
  companyId: string
}) {
  const record = await prisma.$queryRaw<Array<{
    id: string
    uuid: string
    sat_estado: string | null
    xml_ciphertext: string
    xml_iv: string
    xml_auth_tag: string
    xml_encryption_alg: string
  }>>(
    Prisma.sql`
      SELECT
        p.id,
        p.uuid,
        p.sat_estado,
        b.xml_ciphertext,
        b.xml_iv,
        b.xml_auth_tag,
        b.xml_encryption_alg
      FROM provider_uploaded_cfdis p
      INNER JOIN provider_uploaded_cfdi_blobs b
        ON b.provider_uploaded_cfdi_id = p.id
      WHERE p.id = ${params.recordId}
        AND p.organization_id = ${params.organizationId}
        AND p.receiver_company_id = ${params.companyId}
        AND p.validation_status = 'APPROVED'
      LIMIT 1
    `
  )

  const currentRecord = record[0]
  if (!currentRecord) {
    return null
  }

  return {
    id: currentRecord.id,
    uuid: currentRecord.uuid,
    satEstado: normalizeText(currentRecord.sat_estado),
    xmlContent: decryptXmlContent({
      ciphertext: currentRecord.xml_ciphertext,
      iv: currentRecord.xml_iv,
      authTag: currentRecord.xml_auth_tag,
      algorithm: currentRecord.xml_encryption_alg
    })
  }
}

export async function getStoredProviderXmlForSatMonitoring(params: {
  recordId: string
}) {
  const records = await prisma.$queryRaw<Array<{
    id: string
    uuid: string
    file_name: string
    organization_id: string
    receiver_company_id: string | null
    issuer_rfc: string
    issuer_name: string | null
    receiver_rfc: string
    cfdi_type: string
    issuance_date: Date | string | null
    total: unknown
    sat_estado: string | null
    sat_initial_estado: string | null
    sat_es_cancelable: string | null
    sat_estatus_cancelacion: string | null
    xml_ciphertext: string
    xml_iv: string
    xml_auth_tag: string
    xml_encryption_alg: string
  }>>(
    Prisma.sql`
      SELECT
        p.id,
        p.uuid,
        p.file_name,
        p.organization_id,
        p.receiver_company_id,
        p.issuer_rfc,
        p.issuer_name,
        p.receiver_rfc,
        p.cfdi_type,
        p.issuance_date,
        p.total,
        p.sat_estado,
        p.sat_initial_estado,
        p.sat_es_cancelable,
        p.sat_estatus_cancelacion,
        b.xml_ciphertext,
        b.xml_iv,
        b.xml_auth_tag,
        b.xml_encryption_alg
      FROM provider_uploaded_cfdis p
      INNER JOIN provider_uploaded_cfdi_blobs b
        ON b.provider_uploaded_cfdi_id = p.id
      WHERE p.id = ${params.recordId}
        AND p.validation_status = 'APPROVED'
      LIMIT 1
    `
  )

  const currentRecord = records[0]
  if (!currentRecord) {
    return null
  }

  return {
    id: currentRecord.id,
    uuid: currentRecord.uuid,
    fileName: currentRecord.file_name,
    organizationId: currentRecord.organization_id,
    receiverCompanyId: currentRecord.receiver_company_id,
    issuerRfc: normalizeRfc(currentRecord.issuer_rfc),
    issuerName: normalizeText(currentRecord.issuer_name),
    receiverRfc: normalizeRfc(currentRecord.receiver_rfc),
    cfdiType: normalizeText(currentRecord.cfdi_type),
    issuanceDate: currentRecord.issuance_date,
    total: toNumber(currentRecord.total),
    satEstado: normalizeText(currentRecord.sat_estado),
    satInitialEstado: normalizeText(currentRecord.sat_initial_estado),
    satEsCancelable: normalizeText(currentRecord.sat_es_cancelable),
    satEstatusCancelacion: normalizeText(currentRecord.sat_estatus_cancelacion),
    xmlContent: decryptXmlContent({
      ciphertext: currentRecord.xml_ciphertext,
      iv: currentRecord.xml_iv,
      authTag: currentRecord.xml_auth_tag,
      algorithm: currentRecord.xml_encryption_alg
    })
  }
}

export async function getExistingPersistedInvoiceUuids(params: {
  context: ProviderContextForStorage
  uuids: string[]
}) {
  const normalizedUuids = Array.from(
    new Set(params.uuids.map(uuid => normalizeText(uuid).toUpperCase()).filter(Boolean))
  )
  if (normalizedUuids.length === 0) {
    return new Set<string>()
  }

  const allowedReceiverRfcs = Array.from(
    new Set(params.context.allowedCompanies.map(company => normalizeRfc(company.rfc)).filter(Boolean))
  )
  if (allowedReceiverRfcs.length === 0) {
    return new Set<string>()
  }

  const records = await prisma.$queryRaw<Array<{ uuid: string }>>(
    Prisma.sql`
      SELECT uuid
      FROM provider_uploaded_cfdis
      WHERE organization_id = ${params.context.organizationId}
        AND provider_rfc = ${params.context.providerRfc}
        AND validation_status = 'APPROVED'
        AND cfdi_type <> 'P'
        AND receiver_rfc IN (${Prisma.join(allowedReceiverRfcs)})
        AND uuid IN (${Prisma.join(normalizedUuids)})
    `
  )

  return new Set(records.map(record => normalizeText(record.uuid).toUpperCase()))
}

async function getPersistedPaymentsForInvoice(params: {
  organizationId: string
  providerRfc: string
  invoiceUuid: string
}) {
  const records = await prisma.$queryRaw<Array<{ payment_links_json: unknown }>>(
    Prisma.sql`
      SELECT payment_links_json
      FROM provider_uploaded_cfdis
      WHERE organization_id = ${params.organizationId}
        AND provider_rfc = ${params.providerRfc}
        AND validation_status = 'APPROVED'
        AND cfdi_type = 'P'
    `
  )

  const normalizedInvoiceUuid = normalizeText(params.invoiceUuid).toUpperCase()
  const payments: ProviderPersistedPaymentDetail[] = []

  records.forEach(record => {
    const paymentLinks = Array.isArray(record.payment_links_json)
      ? (record.payment_links_json as ProviderPersistedPaymentLink[])
      : []

    paymentLinks.forEach(currentLink => {
      if (normalizeText(currentLink.relatedUuid).toUpperCase() !== normalizedInvoiceUuid) {
        return
      }

      payments.push({
        paymentUuid: normalizeText(currentLink.paymentUuid),
        paymentDate: normalizeText(currentLink.paymentDate),
        paymentSeries: currentLink.paymentSeries || null,
        paymentFolio: currentLink.paymentFolio || null,
        montoPagado: toNumber(currentLink.montoPagado),
        montoTotalPagos: toNumber(currentLink.montoTotalPagos),
        monedaPago: normalizeText(currentLink.monedaPago),
        equivalenciaDR: toNumber(currentLink.equivalenciaDR) || 1,
        numParcialidad: Math.trunc(toNumber(currentLink.numParcialidad)) || 1,
        impSaldoAnt: toNumber(currentLink.impSaldoAnt),
        impSaldoInsoluto: toNumber(currentLink.impSaldoInsoluto)
      })
    })
  })

  return payments.sort((left, right) => new Date(left.paymentDate).getTime() - new Date(right.paymentDate).getTime())
}

export async function updateProviderPaymentStatus(params: {
  organizationId: string
  uuid: string
  paymentStatus: ProviderPaymentStatusValue
  paymentDate: Date | null
  sourceClientId: string
}) {
  const normalizedUuid = normalizeText(params.uuid).toUpperCase()

  const records = await prisma.$queryRaw<ProviderPaymentUpdateRecord[]>(
    Prisma.sql`
      SELECT
        id,
        uuid,
        organization_id,
        receiver_company_id,
        provider_rfc,
        receiver_rfc,
        issuer_rfc,
        issuer_name,
        cfdi_type,
        payment_method,
        total,
        issuance_date,
        sat_estado,
        transferred_taxes_total,
        withheld_taxes_total,
        payment_status_manual,
        payment_date_manual,
        validation_status
      FROM provider_uploaded_cfdis
      WHERE organization_id = ${params.organizationId}
        AND uuid = ${normalizedUuid}
      LIMIT 1
    `
  )

  const record = records[0]
  if (!record) {
    return { ok: false as const, status: 404, error: 'No se encontró un CFDI con el UUID proporcionado.' }
  }

  if (normalizeText(record.validation_status).toUpperCase() !== 'APPROVED') {
    return { ok: false as const, status: 409, error: 'El CFDI existe, pero no se encuentra aprobado para actualización de pago.' }
  }

  if (normalizeText(record.cfdi_type).toUpperCase() === 'P') {
    return { ok: false as const, status: 400, error: 'No es posible actualizar el estatus de pago directamente sobre un REP.' }
  }

  const payments = await getPersistedPaymentsForInvoice({
    organizationId: params.organizationId,
    providerRfc: normalizeRfc(record.provider_rfc),
    invoiceUuid: normalizedUuid
  })

  const total = toNumber(record.total)
  const automaticStatus = getStatusForInvoice(total, normalizeText(record.payment_method), payments.reduce((acc, payment) => {
    const equivalencia = payment.equivalenciaDR > 0 ? payment.equivalenciaDR : 1
    return acc + (payment.montoPagado * equivalencia)
  }, normalizeText(record.payment_method).toUpperCase() === 'PUE' ? total : 0))

  const currentPaymentState = getEffectivePaymentState({
    manualStatus: record.payment_status_manual,
    manualPaymentDate: record.payment_date_manual,
    automaticStatus,
    automaticPaymentDate: payments[payments.length - 1]?.paymentDate || ''
  })

  if (currentPaymentState.status === 'COMPLETO' && params.paymentStatus !== 'COMPLETO') {
    return {
      ok: false as const,
      status: 409,
      error: 'La transición no es válida: un CFDI con estatus COMPLETO no puede regresar a un estado anterior.'
    }
  }

  const paymentComplementDueDate = params.paymentStatus === 'PAGADO' && params.paymentDate
    ? calculateProviderPaymentComplementDueDate(params.paymentDate)
    : null

  await prisma.$transaction(async tx => {
    await tx.$executeRaw(
      Prisma.sql`
        UPDATE provider_uploaded_cfdis
        SET
          payment_status_manual = ${params.paymentStatus},
          payment_date_manual = ${params.paymentDate},
          payment_complement_due_date = ${paymentComplementDueDate},
          payment_status_updated_at = NOW(),
          payment_status_updated_by_client_id = ${params.sourceClientId},
          updated_at = NOW()
        WHERE id = ${record.id}
      `
    )

    await syncProviderReceivedCfdiSummaryRecordChange({
      db: tx,
      previousRecord: {
        organizationId: record.organization_id,
        receiverCompanyId: record.receiver_company_id,
        issuanceDate: record.issuance_date,
        cfdiType: record.cfdi_type,
        satEstado: record.sat_estado,
        issuerRfc: record.issuer_rfc,
        issuerName: record.issuer_name,
        paymentMethod: record.payment_method,
        paymentStatusManual: record.payment_status_manual,
        total: record.total,
        transferredTaxesTotal: record.transferred_taxes_total,
        withheldTaxesTotal: record.withheld_taxes_total,
        validationStatus: record.validation_status
      },
      nextRecord: {
        organizationId: record.organization_id,
        receiverCompanyId: record.receiver_company_id,
        issuanceDate: record.issuance_date,
        cfdiType: record.cfdi_type,
        satEstado: record.sat_estado,
        issuerRfc: record.issuer_rfc,
        issuerName: record.issuer_name,
        paymentMethod: record.payment_method,
        paymentStatusManual: params.paymentStatus,
        total: record.total,
        transferredTaxesTotal: record.transferred_taxes_total,
        withheldTaxesTotal: record.withheld_taxes_total,
        validationStatus: record.validation_status
      }
    })
  })

  return {
    ok: true as const,
    recordId: record.id,
    uuid: normalizedUuid,
    previousStatus: currentPaymentState.status,
    previousPaymentDate: currentPaymentState.paymentDate,
    currentStatus: params.paymentStatus,
    currentPaymentDate: params.paymentDate ? params.paymentDate.toISOString() : '',
    automaticStatus
  }
}
