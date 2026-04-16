import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma, RequestStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { v4 as uuidv4 } from 'uuid'
import { verifyMassDownload } from '@/lib/sat-service'
import { massVerificationQueue } from '@/lib/queue'

const createSchema = z.object({
  companyId: z.string(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  receiverRfc: z.string().optional(),
  issuerRfc: z.string().optional(),
  requestingRfc: z.string(),
  retrievalType: z.enum(['emitidos', 'recibidos', 'folio']).default('emitidos'),
  requestType: z.enum(['metadata', 'cfdi']),
  voucherType: z.enum(['I', 'E', 'P', 'T', 'N']).optional(),
  status: z.enum(['Todos', 'Cancelado', 'Vigente']).default('Todos'),
  thirdPartyRfc: z.string().optional(),
  complement: z.string().optional(),
  folio: z.string().optional(),
})

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const validatedData = createSchema.parse(body)

    const startDate = validatedData.startDate ? new Date(validatedData.startDate) : new Date()
    const endDate = validatedData.endDate ? new Date(validatedData.endDate) : new Date()

    const satIdSolicitud = uuidv4().toUpperCase()

    const request = await prisma.massDownloadRequest.create({
      data: {
        companyId: validatedData.companyId,
        requestingRfc: validatedData.requestingRfc,
        issuerRfc: validatedData.issuerRfc || '',
        receiverRfc: validatedData.receiverRfc,
        startDate,
        endDate,
        requestType: validatedData.requestType,
        retrievalType: validatedData.retrievalType,
        folio: validatedData.folio,
        voucherType: validatedData.voucherType,
        status: validatedData.status || 'Todos',
        thirdPartyRfc: validatedData.thirdPartyRfc,
        complement: validatedData.complement,
        requestStatus: RequestStatus.SOLICITADO,
        satPackageId: satIdSolicitud,
        satMessage: 'Solicitud registrada; pendiente de verificación con el SAT',
        packageIds: [],
        verificationAttempts: 0,
        nextCheck: new Date(Date.now() + 30000), // Revisar en 30 segundos
      },
    })

    // ===== OPTIMIZACIÓN: Encolar el trabajo de verificación en Redis (BullMQ) =====
    // En lugar de que el usuario verifique manualmente, delegamos esto a un proceso en segundo plano
    if (satIdSolicitud && satIdSolicitud !== '') {
      await massVerificationQueue.add('verify-request', {
        requestId: request.id,
        rfc: validatedData.requestingRfc
      }, {
        delay: 30000, // Esperar 30 segundos antes de la primera verificación
        jobId: `verify-init-${request.id}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 60000 } // Si falla, reintenta en 1m, 2m, 4m...
      })
    }
    // ==============================================================================

    return NextResponse.json([
      {
        id: request.id,
        satPackageId: satIdSolicitud,
        requestStatus: request.requestStatus,
      },
    ])
  } catch (error) {
    console.error('Error creating mass download request:', error)
    return NextResponse.json(
      { error: 'Internal Error', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const companyId = searchParams.get('companyId')
    const rfc = searchParams.get('rfc') // Option to filter by requestingRfc directly
    const status = searchParams.get('status')
    const requestType = searchParams.get('requestType')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const folio = searchParams.get('folio')

    const where: Prisma.MassDownloadRequestWhereInput = {}

    if (companyId) {
      where.companyId = companyId
    }

    if (rfc) {
      where.requestingRfc = rfc
    }
    
    // If neither is provided, we might want to return empty or all user accessible (but for now let's assume UI passes one)
    if (!companyId && !rfc) {
      // Potentially return 400 or just return empty array
      // return NextResponse.json({ error: 'Company ID or RFC is required' }, { status: 400 })
    }

    if (status && status !== 'Todos') {
      where.status = status
    }

    if (requestType) {
      where.requestType = requestType
    }

    if (startDate) {
      where.startDate = { gte: new Date(startDate) }
    }

    if (endDate) {
      where.endDate = { lte: new Date(endDate) }
    }
    
    if (folio) {
      where.folio = { contains: folio }
    }

    // Combine date filters if both exist
    if (startDate && endDate) {
      where.startDate = { gte: new Date(startDate) }
      where.endDate = { lte: new Date(endDate) }
    }

    const requests = await prisma.massDownloadRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100, // Limit to 100 for now
    })

    // ===== OPTIMIZACIÓN: Devolvemos directamente desde la base de datos =====
    // El trabajo pesado de consultar al SAT (VerificaSolicitaDescarga) ya NO se 
    // hace aquí en tiempo real, bloqueando el request HTTP.
    // Ese trabajo ahora vive en src/workers/verification.worker.ts (usando Redis).
    return NextResponse.json(requests)

  } catch (error) {
    console.error('Error fetching mass download requests:', error)
    return NextResponse.json(
      { error: 'Internal Error', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}
