import { NextRequest, NextResponse } from 'next/server'
import { downloadMassPackages } from '@/lib/sat-service'
import { auth } from '@/lib/auth'

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const rfc = searchParams.get('rfc')
    const idPaquete = searchParams.get('idPaquete')

    if (!rfc || !idPaquete) {
      return NextResponse.json({ error: 'Faltan parámetros requeridos: rfc, idPaquete' }, { status: 400 })
    }

    // Solicitamos el paquete al SAT
    const result = await downloadMassPackages({ rfc, idPaquete })

    // El SAT nos devuelve el paquete en Base64, lo convertimos a Buffer binario
    const buffer = Buffer.from(result.paqueteB64, 'base64')

    // Devolvemos el buffer configurando los headers para que el navegador lo descargue como archivo ZIP
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${idPaquete}.zip"`,
        'Content-Length': buffer.length.toString()
      }
    })

  } catch (error) {
    console.error('Error al descargar el paquete ZIP:', error)
    return NextResponse.json(
      { error: 'No se pudo descargar el paquete desde el SAT', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }
}