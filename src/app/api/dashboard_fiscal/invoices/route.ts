import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { CfdiType, InvoiceStatus, SatStatus, Prisma } from '@prisma/client'
import {
  buildProjectionMap,
  normalizeProjectionUpperText,
  workpaperAttributeKeySet,
  workpaperComplementFlagKeySet,
  workpaperComplementVersionKeySet,
  workpaperNumericAttributeKeySet
} from '@/lib/cfdi-workpaper-projection'

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
    const page = Number(searchParams.get('page') || 1)
    const isExport = searchParams.get('export') === 'true'
    const defaultLimit = Number(searchParams.get('limit') || 20)
    const limit = isExport ? defaultLimit : Math.min(defaultLimit, 100)
    const query = searchParams.get('query') || ''
    const cfdiTypeParam = searchParams.get('cfdiType')
    const status = searchParams.get('status') as keyof typeof InvoiceStatus | null
    const satStatus = searchParams.get('satStatus') as keyof typeof SatStatus | null
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')

    if (!companyId) {
      return NextResponse.json({ error: 'companyId requerido' }, { status: 400 })
    }

    const member = await prisma.member.findFirst({
      where: { userId: session.user.id, status: 'APPROVED' },
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

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { rfc: true }
    })
    if (!company?.rfc) {
      return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 })
    }

    const fiscalEntity = await prisma.fiscalEntity.findFirst({ where: { rfc: company.rfc } })
    if (!fiscalEntity) {
      return NextResponse.json({ invoices: [], pagination: { total: 0, page, limit, totalPages: 0 } })
    }

    const where: Prisma.InvoiceWhereInput = { issuerFiscalEntityId: fiscalEntity.id, issuerRfc: company.rfc }
    if (query) {
      where.OR = [
        { uuid: { contains: query, mode: 'insensitive' } },
        { issuerRfc: { contains: query, mode: 'insensitive' } },
        { issuerName: { contains: query, mode: 'insensitive' } },
        { receiverRfc: { contains: query, mode: 'insensitive' } },
        { receiverName: { contains: query, mode: 'insensitive' } },
        { folio: { contains: query, mode: 'insensitive' } },
      ]
    }
    if (cfdiTypeParam) {
      const typeMap: Record<string, keyof typeof CfdiType> = {
        'I': 'INGRESO', 'E': 'EGRESO', 'P': 'PAGO', 'T': 'TRASLADO', 'N': 'NOMINA'
      }
      const types = cfdiTypeParam.split(',').flatMap(t => {
        const val = t.trim().toUpperCase()
        if (typeMap[val]) return [typeMap[val]]
        return Object.keys(CfdiType).filter(k => k.includes(val))
      }).filter(Boolean) as (keyof typeof CfdiType)[]
      
      const uniqueTypes = Array.from(new Set(types))
      
      if (uniqueTypes.length > 0) {
        where.cfdiType = { in: uniqueTypes.map(t => CfdiType[t]) }
      } else {
        where.cfdiType = { in: [CfdiType.INGRESO, CfdiType.PAGO] }
      }
    } else {
      where.cfdiType = { in: [CfdiType.INGRESO, CfdiType.PAGO] }
    }
    
    if (status) {
      const s = status.toUpperCase()
      const matchedStatus = Object.keys(InvoiceStatus).find(k => k.includes(s))
      if (matchedStatus) where.status = InvoiceStatus[matchedStatus as keyof typeof InvoiceStatus]
    }
    if (satStatus) {
      const s = satStatus.toUpperCase()
      const matchedSatStatus = Object.keys(SatStatus).find(k => k.includes(s))
      if (matchedSatStatus) where.satStatus = SatStatus[matchedSatStatus as keyof typeof SatStatus]
    }
    if (dateFrom || dateTo) {
      where.issuanceDate = {}
      if (dateFrom) where.issuanceDate.gte = new Date(dateFrom)
      if (dateTo) where.issuanceDate.lte = new Date(dateTo)
    }

    if (!where.AND) {
      where.AND = []
    }

    const simpleFilterFields = [
      'id', 'userId', 'issuerFiscalEntityId', 'uuid', 'series', 'folio', 'currency', 'issuerRfc', 'issuerName',
      'receiverRfc', 'receiverName', 'paymentMethod', 'paymentForm',
      'cfdiUsage', 'placeOfExpedition', 'exportKey', 'objectTaxComprobante',
      'paymentConditions', 'certificationPac'
    ]
    
    simpleFilterFields.forEach(field => {
      const val = searchParams.get(field)
      if (val) {
        // @ts-expect-error - Dynamic assignment to typed where object
        where[field] = { contains: val, mode: 'insensitive' }
      }
    })

    const exactNumberFields = ['subtotal', 'discount', 'total', 'exchangeRate']
    exactNumberFields.forEach(field => {
      const val = searchParams.get(field)
      if (val && !isNaN(Number(val))) {
        // @ts-expect-error - Dynamic assignment to typed where object
        where[field] = Number(val)
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

    for (const [rawKey, rawValue] of searchParams.entries()) {
      if (reservedParams.has(rawKey) || !rawValue) {
        continue
      }

      if (simpleFilterFields.includes(rawKey) || exactNumberFields.includes(rawKey)) {
        continue
      }

      const key = rawKey.startsWith('attr.') ? rawKey.slice(5) : rawKey
      const hasKey = rawKey.startsWith('has.') ? `has${rawKey.slice(4).toLowerCase().replace(/(?:^|_)(\w)/g, (_, char: string) => char.toUpperCase())}` : rawKey
      const normalizedValue = normalizeProjectionUpperText(rawValue)

      if (workpaperComplementFlagKeySet.has(hasKey)) {
        ;(where.AND as Prisma.InvoiceWhereInput[]).push({
          complementIndex: {
            is: {
              [hasKey]: parseBooleanFilter(rawValue)
            }
          }
        })
        continue
      }

      if (workpaperComplementVersionKeySet.has(key)) {
        ;(where.AND as Prisma.InvoiceWhereInput[]).push({
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
          ;(where.AND as Prisma.InvoiceWhereInput[]).push({
            complementAttributes: {
              some: {
                attributeKey: key,
                valueNumber: new Prisma.Decimal(Number(rawValue).toFixed(6))
              }
            }
          })
        } else {
          ;(where.AND as Prisma.InvoiceWhereInput[]).push({
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
      prisma.invoice.findMany({
        where,
        orderBy: { issuanceDate: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          userId: true,
          issuerFiscalEntityId: true,
          uuid: true,
          cfdiType: true,
          series: true,
          folio: true,
          currency: true,
          exchangeRate: true,
          status: true,
          satStatus: true,
          issuerRfc: true,
          issuerName: true,
          receiverRfc: true,
          receiverName: true,
          subtotal: true,
          discount: true,
          total: true,
          ivaTransferred: true,
          ivaWithheld: true,
          isrWithheld: true,
          iepsWithheld: true,
          xmlContent: true,
          pdfUrl: true,
          issuanceDate: true,
          certificationDate: true,
          certificationPac: true,
          paymentMethod: true,
          paymentForm: true,
          cfdiUsage: true,
          placeOfExpedition: true,
          exportKey: true,
          objectTaxComprobante: true,
          paymentConditions: true,
          createdAt: true,
          updatedAt: true,
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
      prisma.invoice.count({ where })
    ])

    const invoices = rows.map(r => ({
      ...r,
      exchangeRate: r.exchangeRate ?? null,
      subtotal: Number(r.subtotal),
      discount: Number(r.discount ?? 0),
      total: Number(r.total),
      ivaTransferred: Number(r.ivaTransferred ?? 0),
      ivaWithheld: Number(r.ivaWithheld ?? 0),
      isrWithheld: Number(r.isrWithheld ?? 0),
      iepsWithheld: Number(r.iepsWithheld ?? 0),
      issuanceDate: r.issuanceDate,
      certificationDate: r.certificationDate,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      projection: buildProjectionMap({
        attributes: r.complementAttributes,
        complementIndex: r.complementIndex
      })
    }))

    return NextResponse.json({
      invoices,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    })
  } catch (error) {
    console.error('Error fetching invoices:', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
