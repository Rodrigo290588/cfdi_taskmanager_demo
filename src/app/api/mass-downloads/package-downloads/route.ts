import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { v4 as uuidv4 } from 'uuid'

function getEstadoFromStatus(requestStatus: string) {
  switch (requestStatus) {
    case 'SOLICITADO':
      return { code: 1, texto: 'Aceptada' }
    case 'EN_PROCESO':
      return { code: 2, texto: 'En Proceso' }
    case 'TERMINADO':
      return { code: 3, texto: 'Terminada' }
    default:
      return { code: 0, texto: requestStatus || 'Desconocido' }
  }
}

export async function GET() {
  try {
    const requests = await prisma.massDownloadRequest.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    const now = new Date()

    const data = requests.map((r) => {
      const { code, texto } = getEstadoFromStatus(r.requestStatus)
      const progreso = code === 1 ? 10 : code === 2 ? 50 : code === 3 ? 100 : 0
      const paquetes = Array.isArray(r.packageIds) && r.packageIds.length > 0
        ? r.packageIds
        : code === 3
          ? [uuidv4().toUpperCase(), uuidv4().toUpperCase()]
          : []

      const periodoMes = (r.startDate?.getMonth() ?? now.getMonth()) + 1
      const periodoAnio = r.startDate?.getFullYear() ?? now.getFullYear()

      const fecha_vencimiento = new Date(r.createdAt)
      fecha_vencimiento.setDate(fecha_vencimiento.getDate() + 7)

      const totalXml = 200
      const descargadosXml =
        code === 1 ? 20 : code === 2 ? 100 : code === 3 ? 200 : 0

      return {
        id_solicitud: r.satPackageId ?? r.id,
        rfc: r.requestingRfc,
        estado_code: code,
        estado_texto: texto,
        progreso,
        paquetes,
        fecha_vencimiento: fecha_vencimiento.toISOString(),
        fecha_peticion:
          code === 3 ? r.updatedAt.toISOString() : null,
        periodoMes,
        periodoAnio,
        totalXml,
        descargadosXml,
      }
    })

    return NextResponse.json(data)
  } catch (error) {
    console.error('Error fetching package download data:', error)
    return NextResponse.json(
      { error: 'Internal Error' },
      { status: 500 },
    )
  }
}

export async function POST() {
  try {
    const now = new Date()
    const fakeRfc = 'AAA010101AAA'
    const idSolicitud = uuidv4().toUpperCase()

    const request = await prisma.massDownloadRequest.create({
      data: {
        companyId: 'demo-company',
        requestingRfc: fakeRfc,
        issuerRfc: fakeRfc,
        receiverRfc: null,
        startDate: now,
        endDate: now,
        requestType: 'metadata',
        retrievalType: 'emitidos',
        folio: null,
        voucherType: null,
        status: 'Vigente',
        thirdPartyRfc: null,
        complement: null,
        requestStatus: 'SOLICITADO',
        satPackageId: idSolicitud,
        satMessage: 'Solicitud aceptada',
        packageIds: [],
        verificationAttempts: 0,
        nextCheck: new Date(now.getTime() + 15000),
      },
    })

    return NextResponse.json({
      id_solicitud: request.satPackageId,
    })
  } catch (error) {
    console.error('Error creating demo package request:', error)
    return NextResponse.json(
      { error: 'Internal Error' },
      { status: 500 },
    )
  }
}
