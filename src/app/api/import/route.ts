import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { SatStatus } from '@prisma/client';

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
      montoTotal?: number | string;
      total?: number | string;
      amount?: number | string;
      impuestos?: number | string;
      taxes?: number | string;
      [key: string]: unknown;
    }

    const records = (body as ImportRecord[]).map((item) => {
      // Intentar obtener los valores de diferentes posibles nombres de propiedad
      const uuid = item.id_uuid || item.uuid || item.UUID;
      // El modelo Cfdi actual no tiene campo RFC, así que lo omitimos por ahora para corregir el build.
      // const rfc_emisor = item.rfc_emisor || item.rfcEmisor || item.issuerRfc || item.RFCEmisor;
      const fechaRaw = item.fecha || item.date || item.fechaEmision || item.issuanceDate;
      const montoTotal = item.montoTotal || item.total || item.amount || 0;
      const impuestos = item.impuestos || item.taxes || 0;
      
      let fechaEmision: Date;
      try {
        fechaEmision = new Date(fechaRaw as string | number | Date);
        if (isNaN(fechaEmision.getTime())) {
          fechaEmision = new Date(); // Fallback a ahora si la fecha es inválida
        }
      } catch {
        fechaEmision = new Date();
      }

      return {
        uuid,
        fechaEmision,
        montoTotal,
        impuestos,
        statusSat: SatStatus.VIGENTE as SatStatus,
      };
    });

    // Filtrar registros inválidos (aquellos sin UUID)
    const validRecords = records.filter((r): r is { uuid: string; fechaEmision: Date; montoTotal: number | string; impuestos: number | string; statusSat: SatStatus } => {
      return typeof r.uuid === 'string';
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
