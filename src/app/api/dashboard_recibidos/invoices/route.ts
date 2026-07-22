import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { decryptXmlContent } from '@/lib/provider-cfdi-storage'
import {
  buildProjectionMap,
  normalizeProjectionUpperText,
  workpaperAttributeKeySet,
  workpaperComplementFlagKeySet,
  workpaperComplementVersionKeySet,
  workpaperNumericAttributeKeySet
} from '@/lib/cfdi-workpaper-projection'

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

function parseBooleanFilter(value: string) {
  const normalized = normalizeProjectionUpperText(value)
  if (['1', 'TRUE', 'SI', 'SÍ', 'YES'].includes(normalized)) return true
  if (['0', 'FALSE', 'NO'].includes(normalized)) return false
  return true
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

    const where: Prisma.ProviderUploadedCfdiWhereInput = {
      organizationId: member.organizationId,
      receiverCompanyId: companyId,
      validationStatus: 'APPROVED'
    }

    if (cfdiTypes.length > 0) {
      where.cfdiType = { in: cfdiTypes }
    }
    if (satStatus) {
      where.satEstado = satStatus
    }
    if (status) {
      where.validationStatus = { contains: status, mode: 'insensitive' }
    }
    if (dateFrom || dateTo) {
      where.issuanceDate = {}
      if (dateFrom) where.issuanceDate.gte = new Date(dateFrom)
      if (dateTo) where.issuanceDate.lte = new Date(dateTo)
    }
    if (query) {
      where.OR = [
        { uuid: { contains: query, mode: 'insensitive' } },
        { issuerRfc: { contains: query, mode: 'insensitive' } },
        { issuerName: { contains: query, mode: 'insensitive' } },
        { receiverRfc: { contains: query, mode: 'insensitive' } },
        { receiverName: { contains: query, mode: 'insensitive' } },
        { series: { contains: query, mode: 'insensitive' } },
        { folio: { contains: query, mode: 'insensitive' } },
        { fileName: { contains: query, mode: 'insensitive' } }
      ]
    }

    if (!where.AND) {
      where.AND = []
    }

    const directTextFilterMap: Record<string, keyof Prisma.ProviderUploadedCfdiWhereInput> = {
      id: 'id',
      uuid: 'uuid',
      series: 'series',
      folio: 'folio',
      currency: 'currency',
      issuerRfc: 'issuerRfc',
      issuerName: 'issuerName',
      receiverRfc: 'receiverRfc',
      receiverName: 'receiverName',
      paymentMethod: 'paymentMethod',
      paymentForm: 'paymentForm'
    }

    const directNumericFilterMap: Record<string, keyof Prisma.ProviderUploadedCfdiWhereInput> = {
      subtotal: 'subtotal',
      discount: 'discount',
      total: 'total'
    }

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

    for (const [rawKey, rawValue] of searchParams.entries()) {
      if (reservedParams.has(rawKey) || !rawValue) {
        continue
      }

      if (rawKey in directTextFilterMap) {
        ;(where.AND as Prisma.ProviderUploadedCfdiWhereInput[]).push({
          [directTextFilterMap[rawKey]]: {
            contains: rawValue,
            mode: 'insensitive'
          }
        })
        continue
      }

      if (rawKey in directNumericFilterMap && !Number.isNaN(Number(rawValue))) {
        ;(where.AND as Prisma.ProviderUploadedCfdiWhereInput[]).push({
          [directNumericFilterMap[rawKey]]: new Prisma.Decimal(Number(rawValue).toFixed(6))
        })
        continue
      }

      const key = rawKey.startsWith('attr.') ? rawKey.slice(5) : rawKey
      const hasKey = rawKey.startsWith('has.') ? `has${rawKey.slice(4).toLowerCase().replace(/(?:^|_)(\w)/g, (_, char: string) => char.toUpperCase())}` : rawKey
      const normalizedValue = normalizeProjectionUpperText(rawValue)

      if (workpaperComplementFlagKeySet.has(hasKey)) {
        ;(where.AND as Prisma.ProviderUploadedCfdiWhereInput[]).push({
          complementIndex: {
            is: {
              [hasKey]: parseBooleanFilter(rawValue)
            }
          }
        })
        continue
      }

      if (workpaperComplementVersionKeySet.has(key)) {
        ;(where.AND as Prisma.ProviderUploadedCfdiWhereInput[]).push({
          complementIndex: {
            is: {
              [key]: {
                contains: rawValue,
                mode: 'insensitive'
              }
            }
          }
        })
        continue
      }

      if (workpaperAttributeKeySet.has(key)) {
        if (workpaperNumericAttributeKeySet.has(key) && !Number.isNaN(Number(rawValue))) {
          ;(where.AND as Prisma.ProviderUploadedCfdiWhereInput[]).push({
            complementAttributes: {
              some: {
                attributeKey: key,
                valueNumber: new Prisma.Decimal(Number(rawValue).toFixed(6))
              }
            }
          })
        } else {
          ;(where.AND as Prisma.ProviderUploadedCfdiWhereInput[]).push({
            complementAttributes: {
              some: {
                attributeKey: key,
                valueSearch: {
                  contains: normalizedValue,
                  mode: 'insensitive'
                }
              }
            }
          })
        }
      }
    }

    const skip = (page - 1) * limit
    const [rows, total] = await Promise.all([
      prisma.providerUploadedCfdi.findMany({
        where,
        orderBy: [
          { issuanceDate: 'desc' },
          { updatedAt: 'desc' },
          { uuid: 'desc' }
        ],
        skip,
        take: limit,
        select: {
          id: true,
          memberId: true,
          uploadedByUserId: true,
          receiverCompanyId: true,
          uuid: true,
          cfdiType: true,
          series: true,
          folio: true,
          currency: true,
          paymentMethod: true,
          paymentForm: true,
          validationStatus: true,
          satEstado: true,
          issuerRfc: true,
          issuerName: true,
          receiverRfc: true,
          receiverName: true,
          subtotal: true,
          discount: true,
          total: true,
          issuanceDate: true,
          certificationDate: true,
          createdAt: true,
          updatedAt: true,
          xmlBlob: {
            select: {
              xmlCiphertext: true,
              xmlIv: true,
              xmlAuthTag: true,
              xmlEncryptionAlg: true
            }
          },
          complementIndex: {
            select: {
              hasPagos: true,
              pagosVersion: true,
              hasNomina: true,
              nominaVersion: true,
              hasCartaPorte: true,
              cartaPorteVersion: true,
              hasComercioExterior: true,
              comercioExteriorVersion: true
            }
          },
          complementAttributes: {
            select: {
              attributeKey: true,
              valueText: true,
              valueNumber: true,
              valueBoolean: true
            }
          }
        }
      }),
      prisma.providerUploadedCfdi.count({ where })
    ])

    const pagedInvoices = rows.map(row => {
      const xmlContent = row.xmlBlob
        ? decryptXmlContent({
            ciphertext: row.xmlBlob.xmlCiphertext,
            iv: row.xmlBlob.xmlIv,
            authTag: row.xmlBlob.xmlAuthTag,
            algorithm: row.xmlBlob.xmlEncryptionAlg
          })
        : ''

      const projection = buildProjectionMap({
        attributes: row.complementAttributes,
        complementIndex: row.complementIndex
      })
      const exchangeRateRaw = getXmlAttribute(xmlContent, 'TipoCambio')

      return {
        id: row.id,
        userId: row.uploadedByUserId || '',
        issuerFiscalEntityId: row.receiverCompanyId || '',
        uuid: normalizeUpperText(row.uuid),
        cfdiType: normalizeUpperText(row.cfdiType),
        series: normalizeText(row.series) || null,
        folio: normalizeText(row.folio) || null,
        currency: normalizeUpperText(row.currency) || 'MXN',
        exchangeRate: exchangeRateRaw ? toNumber(exchangeRateRaw) : null,
        status: normalizeUpperText(row.validationStatus),
        satStatus: normalizeUpperText(row.satEstado),
        issuerRfc: normalizeUpperText(row.issuerRfc),
        issuerName: normalizeText(row.issuerName),
        receiverRfc: normalizeUpperText(row.receiverRfc),
        receiverName: normalizeText(row.receiverName),
        subtotal: toNumber(row.subtotal),
        discount: toNumber(row.discount),
        total: toNumber(row.total),
        ivaTransferred: 0,
        ivaWithheld: 0,
        isrWithheld: 0,
        iepsWithheld: 0,
        xmlContent,
        pdfUrl: null,
        issuanceDate: toIsoString(row.issuanceDate),
        certificationDate: toIsoString(row.certificationDate) || null,
        certificationPac: String(projection.certificationPac ?? getTimbreAttribute(xmlContent, 'RfcProvCertif')),
        paymentMethod: normalizeUpperText(row.paymentMethod),
        paymentForm: normalizeUpperText(row.paymentForm),
        cfdiUsage: String(projection.cfdiUsage ?? getReceptorAttribute(xmlContent, 'UsoCFDI')),
        placeOfExpedition: String(projection.placeOfExpedition ?? getXmlAttribute(xmlContent, 'LugarExpedicion')),
        exportKey: String(projection.exportKey ?? getXmlAttribute(xmlContent, 'Exportacion')),
        objectTaxComprobante: String(projection.objectTaxComprobante ?? getXmlAttribute(xmlContent, 'ObjetoImp')) || null,
        paymentConditions: String(projection.paymentConditions ?? getXmlAttribute(xmlContent, 'CondicionesDePago')) || null,
        createdAt: toIsoString(row.createdAt),
        updatedAt: toIsoString(row.updatedAt),
        projection
      }
    })

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
