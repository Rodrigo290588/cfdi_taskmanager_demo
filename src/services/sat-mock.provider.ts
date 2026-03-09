import { prisma } from '@/lib/prisma'
import { v4 as uuidv4 } from 'uuid'

export class SATMockProvider {
  async verifySolicitud(idSolicitud: string): Promise<string> {
    const request = await prisma.massDownloadRequest.findFirst({
      where: { satPackageId: idSolicitud },
    })

    if (!request) {
      return `<VerificaSolicitudDescargaResult CodEstatus="5001" EstadoSolicitud="4" Mensaje="Solicitud no encontrada" IdSolicitud="${idSolicitud}" />`
    }

    const now = new Date()
    const createdAt = request.createdAt
    const diffSeconds = Math.floor((now.getTime() - createdAt.getTime()) / 1000)

    let estado = 1
    let mensaje = 'Solicitud aceptada'
    let paquetesXml = ''

    if (diffSeconds <= 30) {
      estado = 1
      mensaje = 'Solicitud aceptada'
    } else if (diffSeconds <= 60) {
      estado = 2
      mensaje = 'Solicitud en proceso'
    } else {
      estado = 3
      mensaje = 'Solicitud terminada'
      const packageIds = [
        uuidv4().toUpperCase(),
        uuidv4().toUpperCase(),
        uuidv4().toUpperCase(),
      ]
      paquetesXml = `<IdsPaquetes>${packageIds.map((id) => `<string>${id}</string>`).join('')}</IdsPaquetes>`
    }

    return `<VerificaSolicitudDescargaResult CodEstatus="5000" EstadoSolicitud="${estado}" Mensaje="${mensaje}" IdSolicitud="${idSolicitud}">${paquetesXml}</VerificaSolicitudDescargaResult>`
  }
}

