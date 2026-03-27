import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

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
    // En App Router, request.json() lee el cuerpo.
    // El límite de tamaño suele ser 4MB por defecto en Vercel, pero configurable en self-hosted.
    const body = await request.json();

    if (!Array.isArray(body)) {
      return NextResponse.json(
        { error: 'El cuerpo de la solicitud debe ser un array (lote) de registros CFDI' },
        { status: 400 }
      );
    }

    // Mapeo de datos al modelo Cfdi
    // Se asume que el cliente envía objetos con las propiedades necesarias
    interface ImportRecord {
      id_uuid?: string;
      uuid?: string;
      UUID?: string;
      rfc_emisor?: string;
      rfcEmisor?: string;
      issuerRfc?: string;
      RFCEmisor?: string;
      fecha?: string | number | Date;
      date?: string | number | Date;
      fechaEmision?: string | number | Date;
      issuanceDate?: string | number | Date;
      [key: string]: unknown;
    }

    const records = (body as ImportRecord[]).map((item) => {
      // Intentar obtener los valores de diferentes posibles nombres de propiedad
      const id_uuid = item.id_uuid || item.uuid || item.UUID;
      const rfc_emisor = item.rfc_emisor || item.rfcEmisor || item.issuerRfc || item.RFCEmisor;
      const fechaRaw = item.fecha || item.date || item.fechaEmision || item.issuanceDate;
      
      let fecha: Date;
      try {
        fecha = new Date(fechaRaw as string | number | Date);
        if (isNaN(fecha.getTime())) {
          fecha = new Date(); // Fallback a ahora si la fecha es inválida, o manejar error
        }
      } catch {
        fecha = new Date();
      }

      return {
        id_uuid,
        rfc_emisor,
        fecha,
        data: item, // Guardar el JSON completo
      };
    });

    // Filtrar registros inválidos (aquellos sin UUID o RFC)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const validRecords = records.filter((r): r is { id_uuid: string; rfc_emisor: string; fecha: Date; data: any } => {
      return typeof r.id_uuid === 'string' && typeof r.rfc_emisor === 'string';
    });

    if (validRecords.length === 0) {
      return NextResponse.json(
        { error: 'No se encontraron registros válidos para insertar' },
        { status: 400 }
      );
    }

    // Inserción masiva con skipDuplicates para idempotencia
    // Prisma createMany es eficiente para lotes grandes
    const result = await prisma.cfdi.createMany({
      // @ts-expect-error - Prisma types mismatch
      data: validRecords,
      skipDuplicates: true,
    });

    return NextResponse.json({
      success: true,
      count: result.count,
      totalReceived: body.length,
      message: `Procesados ${body.length} registros. Insertados ${result.count}.`,
    });

  } catch (error: unknown) {
    console.error('Error en importación masiva (DETALLE):', error);
    if (error instanceof Error) {
        console.error('Stack:', error.stack);
        console.error('Mensaje:', error.message);
    }
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Error interno del servidor', details: errorMessage },
      { status: 500 }
    );
  }
}
