import { NextRequest, NextResponse } from 'next/server'
import { validateApiKey } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { CfdiType, InvoiceStatus, SatStatus } from '@prisma/client'
import { z } from 'zod'

// Schema for invoice ingestion
const invoiceSchema = z.object({
  uuid: z.string().uuid(),
  cfdiType: z.enum(['INGRESO', 'EGRESO', 'TRASLADO', 'NOMINA', 'PAGO']),
  series: z.string().optional(),
  folio: z.string().optional(),
  currency: z.string().default('MXN'),
  exchangeRate: z.number().optional(),
  issuerRfc: z.string().min(12).max(13),
  issuerName: z.string(),
  receiverRfc: z.string().min(12).max(13),
  receiverName: z.string(),
  subtotal: z.number().positive(),
  discount: z.number().min(0).default(0),
  total: z.number().positive(),
  ivaTrasladado: z.number().min(0).default(0),
  ivaRetenido: z.number().min(0).default(0),
  isrRetenido: z.number().min(0).default(0),
  iepsRetenido: z.number().min(0).default(0),
  xmlContent: z.string(),
  pdfUrl: z.string().url().optional(),
  issuanceDate: z.string().datetime(),
  certificationDate: z.string().datetime(),
  certificationPac: z.string(),
  paymentMethod: z.string(),
  paymentForm: z.string(),
  usageCfdi: z.string(),
  expeditionPlace: z.string(),
  fiscalEntityId: z.string().cuid()
})

const ingestSchema = z.object({
  invoices: z.array(invoiceSchema).min(1),
  syncId: z.string().optional()
})

export async function POST(request: NextRequest) {
  try {
    // Validate API key
    const authResult = await validateApiKey(request)
    if (!authResult.valid) {
      return NextResponse.json(
        { error: authResult.error },
        { status: authResult.status || 401 }
      )
    }

    // Check permissions
    if (!authResult.valid || !authResult.permissions?.includes('write')) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      )
    }

    // Parse request body
    const body = await request.json()
    const validatedData = ingestSchema.parse(body)

    const results = []
    const errors = []

    // Process each invoice
    for (const invoiceData of validatedData.invoices) {
      try {
        // Check if invoice already exists
        const existingInvoice = await prisma.invoice.findUnique({
          where: { uuid: invoiceData.uuid }
        })

        if (existingInvoice) {
          results.push({
            uuid: invoiceData.uuid,
            status: 'skipped',
            message: 'Invoice already exists'
          })
          continue
        }

        // Create invoice
        const invoice = await prisma.invoice.create({
          data: {
            userId: authResult.user?.id,
            uuid: invoiceData.uuid,
            cfdiType: invoiceData.cfdiType as CfdiType,
            series: invoiceData.series,
            folio: invoiceData.folio,
            currency: invoiceData.currency,
            exchangeRate: invoiceData.exchangeRate,
            status: InvoiceStatus.ACTIVE,
            satStatus: SatStatus.VIGENTE,
            issuerRfc: invoiceData.issuerRfc,
            issuerName: invoiceData.issuerName,
            receiverRfc: invoiceData.receiverRfc,
            receiverName: invoiceData.receiverName,
            subtotal: invoiceData.subtotal,
            discount: invoiceData.discount,
            total: invoiceData.total,
            ivaTransferred: invoiceData.ivaTrasladado,
            ivaWithheld: invoiceData.ivaRetenido,
            isrWithheld: invoiceData.isrRetenido,
            iepsWithheld: invoiceData.iepsRetenido,
            xmlContent: invoiceData.xmlContent,
            pdfUrl: invoiceData.pdfUrl,
            issuanceDate: new Date(invoiceData.issuanceDate),
            certificationDate: new Date(invoiceData.certificationDate),
            certificationPac: invoiceData.certificationPac,
            paymentMethod: invoiceData.paymentMethod,
            paymentForm: invoiceData.paymentForm,
            cfdiUsage: invoiceData.usageCfdi,
            placeOfExpedition: invoiceData.expeditionPlace,
            issuerFiscalEntityId: invoiceData.fiscalEntityId
          }
        })

        results.push({
          uuid: invoice.uuid,
          status: 'created',
          id: invoice.id
        })
      } catch (error) {
        console.error(`Error processing invoice ${invoiceData.uuid}:`, error)
        errors.push({
          uuid: invoiceData.uuid,
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }

    return NextResponse.json({
      success: true,
      results,
      errors,
      summary: {
        total: validatedData.invoices.length,
        created: results.filter(r => r.status === 'created').length,
        skipped: results.filter(r => r.status === 'skipped').length,
        errors: errors.length
      },
      syncId: validatedData.syncId
    })

  } catch (error) {
    console.error('Ingest API error:', error)
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { 
          error: 'Validation error',
          details: error.issues 
        },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    // Validate API key
    const authResult = await validateApiKey(request)
    if (!authResult.valid) {
      return NextResponse.json(
        { error: authResult.error },
        { status: authResult.status || 401 }
      )
    }

    // Check permissions
    if (!authResult.valid || !authResult.permissions?.includes('read')) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      )
    }

    // Get query parameters
    const { searchParams } = new URL(request.url)
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100)
    const offset = parseInt(searchParams.get('offset') || '0')
    const fiscalEntityId = searchParams.get('fiscalEntityId')

    // Build where clause
    const where: { userId: string; issuerFiscalEntityId?: string } = {
      userId: authResult.user?.id || ''
    }

    if (fiscalEntityId) {
      where.issuerFiscalEntityId = fiscalEntityId
    }

    // Fetch invoices
    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          uuid: true,
          cfdiType: true,
          series: true,
          folio: true,
          issuerRfc: true,
          issuerName: true,
          receiverRfc: true,
          receiverName: true,
          total: true,
          subtotal: true,
          status: true,
          satStatus: true,
          issuanceDate: true,
          createdAt: true
        }
      }),
      prisma.invoice.count({ where })
    ])

    return NextResponse.json({
      success: true,
      data: invoices,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      }
    })

  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
