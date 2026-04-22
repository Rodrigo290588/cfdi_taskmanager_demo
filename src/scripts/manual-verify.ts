import { verifyMassDownload } from '../lib/sat-service'
import { prisma } from '../lib/prisma'

async function runManualVerification() {
  console.log('--- Iniciando Verificación Manual del SAT ---')

  // Buscar la solicitud pendiente más reciente en la base de datos
  const request = await prisma.massDownloadRequest.findFirst({
    where: {
      requestStatus: { in: ['SOLICITADO', 'EN_PROCESO'] }
    },
    orderBy: { createdAt: 'desc' }
  })

  let rfc = ''
  let idSolicitud = ''

  if (request && request.satPackageId) {
    rfc = request.requestingRfc
    idSolicitud = request.satPackageId
    console.log(`Encontrada solicitud pendiente en DB:`)
    console.log(`- RFC: ${rfc}`)
    console.log(`- IdSolicitud: ${idSolicitud}`)
  } else {
    // Si no hay en DB, usamos el ID del último mensaje por defecto
    console.log('No se encontraron solicitudes pendientes en DB. Usando valores predeterminados (Hardcoded).')
    rfc = 'ODE8604257UA' // RFC de la UI de Opticas Devlyn
    idSolicitud = 'DDD5B123-B984-4396-8EA6-63D03B752414'
    console.log(`- RFC: ${rfc}`)
    console.log(`- IdSolicitud: ${idSolicitud}`)
  }

  try {
    console.log('\nContactando al WebService del SAT...')
    const resultado = await verifyMassDownload({ rfc, idSolicitud })
    
    console.log('\n✅ --- VERIFICACIÓN EXITOSA ---')
    console.log('Respuesta del SAT:')
    console.log(resultado)
    console.log('\n(Recuerda revisar la raíz del proyecto para el archivo Debug_Verificacion_...xml)')

    // Si encontramos el registro en BD, lo actualizamos como haría el worker
    if (request && request.id) {
      await prisma.massDownloadRequest.update({
        where: { id: request.id },
        data: {
          satMessage: resultado.mensaje,
          requestStatus: resultado.estadoSolicitud === '3' ? 'TERMINADO' : 
                         (resultado.estadoSolicitud === '2' ? 'EN_PROCESO' : 
                         (resultado.estadoSolicitud === '1' ? 'SOLICITADO' : 'RECHAZADO')),
          packageIds: resultado.idsPaquetes || []
        }
      })
      console.log(`Registro en DB actualizado con estatus: ${resultado.estadoSolicitud}`)
    }

  } catch (error) {
    console.error('\n❌ --- ERROR EN LA VERIFICACIÓN ---')
    if (error instanceof Error) {
      console.error(error.message)
    } else {
      console.error(String(error))
    }
    console.log('\n(El archivo Debug_Verificacion_...xml se debió generar para su análisis)')
  } finally {
    await prisma.$disconnect()
  }
}

runManualVerification()