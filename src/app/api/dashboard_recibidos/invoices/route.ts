import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { decryptXmlContent } from '@/lib/provider-cfdi-storage'

type ProviderInvoiceRowRecord = {
  id: string
  member_id: string
  uploaded_by_user_id: string | null
  receiver_company_id: string | null
  uuid: string
  cfdi_type: string
  series: string | null
  folio: string | null
  currency: string | null
  payment_method: string | null
  payment_form: string | null
  validation_status: string
  sat_estado: string | null
  issuer_rfc: string
  issuer_name: string | null
  receiver_rfc: string
  receiver_name: string | null
  subtotal: unknown
  transferred_taxes_total: unknown
  withheld_taxes_total: unknown
  discount: unknown
  total: unknown
  issuance_date: Date | string | null
  certification_date: Date | string | null
  created_at: Date | string
  updated_at: Date | string
  xml_ciphertext: string
  xml_iv: string
  xml_auth_tag: string
  xml_encryption_alg: string
}

function normalizeText(value: string | null | undefined) {
  return (value || '').trim()
}

function normalizeUpperText(value: string | null | undefined) {
  return normalizeText(value).toUpperCase()
}

function toNumber(value: unknown) {
  const parsed = Number(String(value ?? '').replace(/,/g, '').trim())
  return Number.isFinite(parsed) ? parsed : 0
}

function toIsoString(value: Date | string | null | undefined) {
  if (!value) return ''

  const parsed = value instanceof Date ? value : new Date(value)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString()
}

function getXmlAttribute(xml: string, attr: string) {
  if (!xml) return ''

  const comprobanteMatch = xml.match(/<[^:]+:Comprobante([^>]+)>/)
  if (!comprobanteMatch) return ''

  const match = comprobanteMatch[1].match(new RegExp(`${attr}="([^"]+)"`))
  return match?.[1] || ''
}

function getReceptorAttribute(xml: string, attr: string) {
  if (!xml) return ''

  const receptorMatch = xml.match(/<[^:]+:Receptor([^>]+)>/)
  if (!receptorMatch) return ''

  const match = receptorMatch[1].match(new RegExp(`${attr}="([^"]+)"`))
  return match?.[1] || ''
}

function getTimbreAttribute(xml: string, attr: string) {
  if (!xml) return ''

  const timbreMatch = xml.match(/<(?:[^:]+:)?TimbreFiscalDigital([^>]+)>/)
  if (!timbreMatch) return ''

  const match = timbreMatch[1].match(new RegExp(`${attr}="([^"]+)"`))
  return match?.[1] || ''
}

function getGlobalImpuestosAttribute(xml: string, attr: string) {
  if (!xml) return ''

  const match = xml.match(new RegExp(`<[^:]+:Impuestos[^>]*?\\b${attr}="([^"]+)"`))
  return match?.[1] || ''
}

function getCfdiRelacionadosAttribute(xml: string, type: 'TipoRelacion' | 'UUID') {
  if (!xml) return ''

  if (type === 'TipoRelacion') {
    return Array.from(xml.matchAll(/<(?:[^:]+:)?CfdiRelacionados[^>]*?\bTipoRelacion="([^"]+)"/g)).map(match => match[1]).join(', ')
  }

  return Array.from(xml.matchAll(/<(?:[^:]+:)?CfdiRelacionado[^>]*?\bUUID="([^"]+)"/g)).map(match => match[1]).join(', ')
}

function getCfdiTypesFilter(value: string | null) {
  if (!value) {
    return []
  }

  const map = new Map<string, string>([
    ['INGRESO', 'I'],
    ['I', 'I'],
    ['EGRESO', 'E'],
    ['E', 'E'],
    ['PAGO', 'P'],
    ['P', 'P'],
    ['TRASLADO', 'T'],
    ['T', 'T'],
    ['NOMINA', 'N'],
    ['N', 'N']
  ])

  return Array.from(
    new Set(
      value
        .split(',')
        .map(item => normalizeUpperText(item))
        .map(item => map.get(item) || item)
        .filter(Boolean)
    )
  )
}

function getComparableValue(row: Record<string, unknown>, key: string) {
  const xmlContent = String(row.xmlContent || '')

  if (key === 'version') return getXmlAttribute(xmlContent, 'Version')
  if (key === 'noCertificado') return getXmlAttribute(xmlContent, 'NoCertificado')
  if (key === 'certificado') return getXmlAttribute(xmlContent, 'Certificado')
  if (key === 'domicilioFiscalReceptor') return getReceptorAttribute(xmlContent, 'DomicilioFiscalReceptor')
  if (key === 'residenciaFiscal') return getReceptorAttribute(xmlContent, 'ResidenciaFiscal')
  if (key === 'numRegIdTrib') return getReceptorAttribute(xmlContent, 'NumRegIdTrib')
  if (key === 'regimenFiscalReceptor') return getReceptorAttribute(xmlContent, 'RegimenFiscalReceptor')
  if (key === 'tipoRelacion') return getCfdiRelacionadosAttribute(xmlContent, 'TipoRelacion')
  if (key === 'cfdiRelacionado') return getCfdiRelacionadosAttribute(xmlContent, 'UUID')
  if (key === 'totalImpuestosTrasladados') return getGlobalImpuestosAttribute(xmlContent, 'TotalImpuestosTrasladados') || '0'
  if (key === 'totalImpuestosRetenidos') return getGlobalImpuestosAttribute(xmlContent, 'TotalImpuestosRetenidos') || '0'
  if (key === 'cfdiUsage') return getReceptorAttribute(xmlContent, 'UsoCFDI')
  if (key === 'placeOfExpedition') return getXmlAttribute(xmlContent, 'LugarExpedicion')
  if (key === 'exportKey') return getXmlAttribute(xmlContent, 'Exportacion')
  if (key === 'objectTaxComprobante') return getXmlAttribute(xmlContent, 'ObjetoImp')
  if (key === 'paymentConditions') return getXmlAttribute(xmlContent, 'CondicionesDePago')
  if (key === 'certificationPac') return getTimbreAttribute(xmlContent, 'RfcProvCertif')

  return row[key]
}

function matchesText(value: unknown, search: string) {
  return String(value ?? '').toLowerCase().includes(search.toLowerCase())
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const companyId = searchParams.get('companyId')
    const page = Math.max(Number(searchParams.get('page') || 1), 1)
    const limit = Math.min(Math.max(Number(searchParams.get('limit') || 20), 1), 100000)
    const query = normalizeText(searchParams.get('query'))
    const satStatus = normalizeUpperText(searchParams.get('satStatus'))
    const status = normalizeUpperText(searchParams.get('status'))
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')
    const cfdiTypes = getCfdiTypesFilter(searchParams.get('cfdiType'))

    if (!companyId) {
      return NextResponse.json({ error: 'companyId requerido' }, { status: 400 })
    }

    const member = await prisma.member.findFirst({
      where: { userId: session.user.id, status: 'APPROVED' }
    })
    if (!member) {
      return NextResponse.json({ error: 'Membresía no encontrada' }, { status: 404 })
    }

    const access = await prisma.companyAccess.findUnique({
      where: { memberId_companyId: { memberId: member.id, companyId } }
    })
    if (!access) {
      return NextResponse.json({ error: 'Sin acceso a la empresa' }, { status: 403 })
    }

    const rows = await prisma.$queryRaw<ProviderInvoiceRowRecord[]>(
      Prisma.sql`
        SELECT
          p.id,
          p.member_id,
          p.uploaded_by_user_id,
          p.receiver_company_id,
          p.uuid,
          p.cfdi_type,
          p.series,
          p.folio,
          p.currency,
          p.payment_method,
          p.payment_form,
          p.validation_status,
          p.sat_estado,
          p.issuer_rfc,
          p.issuer_name,
          p.receiver_rfc,
          p.receiver_name,
          p.subtotal,
          p.transferred_taxes_total,
          p.withheld_taxes_total,
          p.discount,
          p.total,
          p.issuance_date,
          p.certification_date,
          p.created_at,
          p.updated_at,
          b.xml_ciphertext,
          b.xml_iv,
          b.xml_auth_tag,
          b.xml_encryption_alg
        FROM provider_uploaded_cfdis p
        INNER JOIN provider_uploaded_cfdi_blobs b
          ON b.provider_uploaded_cfdi_id = p.id
        WHERE p.organization_id = ${member.organizationId}
          AND p.receiver_company_id = ${companyId}
          AND p.validation_status = 'APPROVED'
          ${cfdiTypes.length > 0 ? Prisma.sql`AND p.cfdi_type IN (${Prisma.join(cfdiTypes)})` : Prisma.empty}
          ${satStatus ? Prisma.sql`AND UPPER(COALESCE(p.sat_estado, '')) = ${satStatus}` : Prisma.empty}
          ${dateFrom ? Prisma.sql`AND p.issuance_date >= ${new Date(dateFrom)}` : Prisma.empty}
          ${dateTo ? Prisma.sql`AND p.issuance_date <= ${new Date(dateTo)}` : Prisma.empty}
          ${query ? Prisma.sql`
            AND (
              p.uuid ILIKE ${`%${query}%`}
              OR p.issuer_rfc ILIKE ${`%${query}%`}
              OR COALESCE(p.issuer_name, '') ILIKE ${`%${query}%`}
              OR p.receiver_rfc ILIKE ${`%${query}%`}
              OR COALESCE(p.receiver_name, '') ILIKE ${`%${query}%`}
              OR COALESCE(p.series, '') ILIKE ${`%${query}%`}
              OR COALESCE(p.folio, '') ILIKE ${`%${query}%`}
              OR COALESCE(p.file_name, '') ILIKE ${`%${query}%`}
            )
          ` : Prisma.empty}
        ORDER BY p.issuance_date DESC NULLS LAST, p.updated_at DESC, p.uuid DESC
      `
    )

    const invoices = rows.map(row => {
      const xmlContent = decryptXmlContent({
        ciphertext: row.xml_ciphertext,
        iv: row.xml_iv,
        authTag: row.xml_auth_tag,
        algorithm: row.xml_encryption_alg
      })

      const exchangeRateRaw = getXmlAttribute(xmlContent, 'TipoCambio')

      return {
        id: row.id,
        userId: row.uploaded_by_user_id || '',
        issuerFiscalEntityId: row.receiver_company_id || '',
        uuid: normalizeUpperText(row.uuid),
        cfdiType: normalizeUpperText(row.cfdi_type),
        series: normalizeText(row.series) || null,
        folio: normalizeText(row.folio) || null,
        currency: normalizeUpperText(row.currency) || 'MXN',
        exchangeRate: exchangeRateRaw ? toNumber(exchangeRateRaw) : null,
        status: normalizeUpperText(row.validation_status),
        satStatus: normalizeUpperText(row.sat_estado),
        issuerRfc: normalizeUpperText(row.issuer_rfc),
        issuerName: normalizeText(row.issuer_name),
        receiverRfc: normalizeUpperText(row.receiver_rfc),
        receiverName: normalizeText(row.receiver_name),
        subtotal: toNumber(row.subtotal),
        discount: toNumber(row.discount),
        total: toNumber(row.total),
        ivaTransferred: 0,
        ivaWithheld: 0,
        isrWithheld: 0,
        iepsWithheld: 0,
        xmlContent,
        pdfUrl: null,
        issuanceDate: toIsoString(row.issuance_date),
        certificationDate: toIsoString(row.certification_date) || null,
        certificationPac: getTimbreAttribute(xmlContent, 'RfcProvCertif'),
        paymentMethod: normalizeUpperText(row.payment_method),
        paymentForm: normalizeUpperText(row.payment_form),
        cfdiUsage: getReceptorAttribute(xmlContent, 'UsoCFDI'),
        placeOfExpedition: getXmlAttribute(xmlContent, 'LugarExpedicion'),
        exportKey: getXmlAttribute(xmlContent, 'Exportacion'),
        objectTaxComprobante: getXmlAttribute(xmlContent, 'ObjetoImp') || null,
        paymentConditions: getXmlAttribute(xmlContent, 'CondicionesDePago') || null,
        createdAt: toIsoString(row.created_at),
        updatedAt: toIsoString(row.updated_at)
      }
    })

    const reservedParams = new Set([
      'companyId',
      'page',
      'limit',
      'query',
      'cfdiType',
      'status',
      'satStatus',
      'dateFrom',
      'dateTo',
      'export',
      'origin'
    ])

    const textFilterKeys = [
      'id',
      'userId',
      'issuerFiscalEntityId',
      'uuid',
      'series',
      'folio',
      'currency',
      'issuerRfc',
      'issuerName',
      'receiverRfc',
      'receiverName',
      'paymentMethod',
      'paymentForm',
      'cfdiUsage',
      'placeOfExpedition',
      'exportKey',
      'objectTaxComprobante',
      'paymentConditions',
      'certificationPac',
      'version',
      'noCertificado',
      'certificado',
      'tipoRelacion',
      'cfdiRelacionado',
      'domicilioFiscalReceptor',
      'residenciaFiscal',
      'numRegIdTrib',
      'regimenFiscalReceptor'
    ]

    const exactNumberFields = new Set([
      'subtotal',
      'discount',
      'total',
      'exchangeRate',
      'totalImpuestosTrasladados',
      'totalImpuestosRetenidos'
    ])

    const filteredInvoices = invoices.filter(invoice => {
      if (status && !matchesText(invoice.status, status)) {
        return false
      }

      for (const [key, value] of searchParams.entries()) {
        if (reservedParams.has(key)) {
          continue
        }

        const normalizedValue = normalizeText(value)
        if (!normalizedValue) {
          continue
        }

        const comparableValue = getComparableValue(invoice as unknown as Record<string, unknown>, key)

        if (exactNumberFields.has(key)) {
          if (toNumber(comparableValue) !== toNumber(normalizedValue)) {
            return false
          }
          continue
        }

        if (textFilterKeys.includes(key) && !matchesText(comparableValue, normalizedValue)) {
          return false
        }
      }

      return true
    })

    const total = filteredInvoices.length
    const skip = (page - 1) * limit
    const pagedInvoices = filteredInvoices.slice(skip, skip + limit)

    return NextResponse.json({
      invoices: pagedInvoices,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    })
  } catch (error) {
    console.error('Error fetching provider workpaper invoices for dashboard_recibidos:', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
