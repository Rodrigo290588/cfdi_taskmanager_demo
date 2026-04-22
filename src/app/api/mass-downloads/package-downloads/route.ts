import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

function getEstadoFromStatus(requestStatus: string) {
  switch (requestStatus) {
    case 'SOLICITADO':
      return { code: 1, texto: 'Aceptada' }
    case 'EN_PROCESO':
      return { code: 2, texto: 'En Proceso' }
    case 'TERMINADO':
      return { code: 3, texto: 'Terminada' }
    case 'RECHAZADO':
      return { code: 4, texto: 'Rechazada' }
    case 'VENCIDO':
      return { code: 5, texto: 'Vencida' }
    default:
      return { code: 0, texto: requestStatus || 'Desconocido' }
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const rfc = searchParams.get('rfc')

    if (!rfc) {
      return NextResponse.json({ error: 'El RFC es requerido' }, { status: 400 })
    }

    const requests = await prisma.massDownloadRequest.findMany({
      where: { requestingRfc: rfc },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    const now = new Date()

    const data = requests.map((r) => {
      const { code, texto } = getEstadoFromStatus(r.requestStatus)
      const progreso = code === 1 ? 10 : code === 2 ? 50 : code === 3 ? 100 : 0
      
      const paquetes = Array.isArray(r.packageIds) ? r.packageIds : []

      const periodoMes = (r.startDate?.getMonth() ?? now.getMonth()) + 1
      const periodoAnio = r.startDate?.getFullYear() ?? now.getFullYear()

      const fecha_vencimiento = new Date(r.createdAt)
      fecha_vencimiento.setDate(fecha_vencimiento.getDate() + 7)

      // Extraer datos reales del errorLog si existen, si no simular en base al estado
      const errorLogData = r.errorLog as Record<string, unknown> | null
      const numeroCFDIsStr = errorLogData?.numeroCFDIs
      let totalXml = typeof numeroCFDIsStr === 'string' ? parseInt(numeroCFDIsStr, 10) : (code === 3 ? 200 : 0)
      
      // Si está TERMINADO asumimos que los XML se descargaron (simulación parcial si el worker aún está bajando)
      // En un entorno real se contaría desde la base de datos o el registro del worker
      let descargadosXml = code === 3 ? totalXml : (code === 2 ? Math.floor(totalXml * 0.5) : 0)

      if (r.requestType === 'metadata' && r.satMessage) {
        const metadataMatch = r.satMessage.match(/Metadata procesada: (\d+) registros importados/i)
        if (metadataMatch && metadataMatch[1]) {
          descargadosXml = parseInt(metadataMatch[1], 10)
          if (totalXml === 0) totalXml = descargadosXml // Fallback if SAT didn't provide numeroCFDIs
        } else if (code !== 3) {
          descargadosXml = 0
        }
      }

      return {
        id_solicitud: r.satPackageId ?? r.id,
        rfc: r.requestingRfc,
        estado_code: code,
        estado_texto: texto,
        progreso,
        paquetes,
        fecha_vencimiento: fecha_vencimiento.toISOString(),
        fecha_peticion: code === 3 ? r.updatedAt.toISOString() : null,
        periodoMes,
        periodoAnio,
        totalXml,
        descargadosXml,
        requestType: r.requestType,
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


