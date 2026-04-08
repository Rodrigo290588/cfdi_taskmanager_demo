import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createInvoiceFromXml } from '@/lib/invoice-import'

// Configuración para el límite del cuerpo (aunque en App Router esto depende más del servidor/middleware)
// Se mantiene como referencia de la intención del usuario.
// Nota: La exportación de config está deprecada en App Router y causa error de build.
// export const config = {
//   api: {
//     bodyParser: {
//       sizeLimit: '50mb',
//     },
//   },
// };

export async function POST(request: Request) {
  try {
    const body = await request.json()

    if (!Array.isArray(body)) {
      return NextResponse.json(
        { error: 'El cuerpo de la solicitud debe ser un array (lote) de registros CFDI' },
        { status: 400 }
      )
    }

    interface ImportRecord {
      xmlContent?: string
      xml?: string
      rawXml?: string
      source_file?: string
      [key: string]: unknown
    }

    const records = body as ImportRecord[]
    const contextCache = new Map<string, Promise<{ userId: string; issuerFiscalEntityId: string }>>()
    const results: Array<{ uuid: string | null; status: 'created' | 'skipped' | 'error'; message?: string; id?: string }> = []

    for (const item of records) {
      const xml = item.xmlContent || item.xml || item.rawXml
      if (!xml || !xml.trim().startsWith('<')) {
        results.push({
          uuid: null,
          status: 'error',
          message: `El registro ${String(item.source_file || '')} no incluye xmlContent valido`,
        })
        continue
      }

      try {
        const result = await createInvoiceFromXml(prisma, xml, contextCache)
        results.push(result)
      } catch (error) {
        results.push({
          uuid: null,
          status: 'error',
          message: error instanceof Error ? error.message : 'Error desconocido al importar XML',
        })
      }
    }

    const summary = {
      total: records.length,
      created: results.filter((r) => r.status === 'created').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      errors: results.filter((r) => r.status === 'error').length,
    }

    return NextResponse.json({
      success: summary.errors === 0,
      results,
      summary,
      message: `Procesados ${summary.total} registros. Insertados ${summary.created}.`,
    })
  } catch (error: unknown) {
    console.error('Error en importacion masiva (DETALLE):', error)
    if (error instanceof Error) {
      console.error('Stack:', error.stack)
      console.error('Mensaje:', error.message)
    }
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: 'Error interno del servidor', details: errorMessage },
      { status: 500 }
    )
  }
}
