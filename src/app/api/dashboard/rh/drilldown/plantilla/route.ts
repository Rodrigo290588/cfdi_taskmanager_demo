export const runtime     = 'nodejs';
export const dynamic     = 'force-dynamic';
export const maxDuration = 30;
export const revalidate  = 0;

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
    DRILLDOWN_DEFAULT_PAGE_SIZE,
    DRILLDOWN_ID_REGEX,
    DRILLDOWN_MAX_RANGO_DIAS,
    refineFiscalNominaDateRange,
} from '@/lib/fiscal-nomina-drilldown-helpers';

const ID_REGEX = DRILLDOWN_ID_REGEX;
const MAX_RANGO_DIAS = DRILLDOWN_MAX_RANGO_DIAS;

const TIPO_CONTRATO_CATALOG: Record<string, string> = {
    '01': '01 - Tiempo indeterminado',
    '02': '02 - Obra determinada',
    '03': '03 - Tiempo determinado',
    '04': '04 - Por temporada',
    '05': '05 - Sujeto a prueba',
    '06': '06 - Capacitación inicial',
    '07': '07 - Pago por hora laborada',
    '08': '08 - Comisión laboral',
    '09': '09 - Sin relación de trabajo',
    '10': '10 - Jubilación/pensión/retiro',
    '99': '99 - Otro contrato'
};

const TIPO_JORNADA_CATALOG: Record<string, string> = {
    '01': '01 - Diurna',
    '02': '02 - Nocturna',
    '03': '03 - Mixta',
    '04': '04 - Por horas',
    '05': '05 - Reducida',
    '06': '06 - Continuada',
    '07': '07 - Partida',
    '08': '08 - Por turnos',
    '99': '99 - Otra Jornada'
};

const DrilldownRhPlantillaParams = z
    .object({
        companyId:        z.string().regex(ID_REGEX).min(1),
        organizationId:   z.string().regex(ID_REGEX).nullable().optional(),
        fiscalEntityId:   z.string().regex(ID_REGEX).nullable().optional(),
        startDate:        z.coerce.date(),
        endDate:          z.coerce.date(),
        departamento:     z.string().nullable().optional(),
        tipoNomina:       z.string().nullable().optional(),
        periodicidad:     z.string().nullable().optional(),
        limit:            z.coerce.number().int().min(1).max(2000).default(DRILLDOWN_DEFAULT_PAGE_SIZE),
        kpiType:          z.string().optional(),
    })
    .superRefine((v, c) => refineFiscalNominaDateRange(v, c, MAX_RANGO_DIAS));

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const rawParams = {
            companyId: searchParams.get('companyId'),
            organizationId: searchParams.get('organizationId'),
            fiscalEntityId: searchParams.get('fiscalEntityId'),
            startDate: searchParams.get('startDate'),
            endDate: searchParams.get('endDate'),
            departamento: searchParams.get('departamento'),
            tipoNomina: searchParams.get('tipoNomina'),
            periodicidad: searchParams.get('periodicidad'),
            limit: searchParams.get('limit'),
            kpiType: searchParams.get('kpiType'), // 'plantilla_vigente' | 'antiguedad_promedio' | 'sdi_promedio' | 'tipos_contrato'
        };

        const parsed = DrilldownRhPlantillaParams.safeParse(rawParams);
        if (!parsed.success) {
            return NextResponse.json({ ok: false, error: 'INVALID_PARAMS' }, { status: 400 });
        }

        const p = parsed.data;

        // Base where condition for PayrollReceipt
        const whereReceipt: Prisma.PayrollReceiptWhereInput = {
            companyId: p.companyId,
            fechaPago: {
                gte: p.startDate,
                lte: p.endDate,
            }
        };

        if (p.organizationId) whereReceipt.organizationId = p.organizationId;
        if (p.fiscalEntityId) whereReceipt.fiscalEntityId = p.fiscalEntityId;
        if (p.departamento) whereReceipt.departamento = p.departamento;
        if (p.tipoNomina) whereReceipt.tipoNomina = p.tipoNomina;

        // Querying the latest receipt per employee within the date range
        // Since Prisma doesn't support SELECT DISTINCT ON, we fetch them and group by RFC in memory,
        // or we fetch the Receptors that are linked to these receipts.
        // It's more accurate to query PayrollReceptor directly linked to the receipts we just filtered.

        const receptores = await prisma.payrollReceptor.findMany({
            where: {
                payrollReceipt: whereReceipt
            },
            include: {
                payrollReceipt: {
                    select: {
                        uuid: true,
                        fechaPago: true,
                        tipoNomina: true,
                        departamento: true,
                        invoice: {
                            select: {
                                total: true
                            }
                        }
                    }
                }
            },
            orderBy: {
                payrollReceipt: {
                    fechaPago: 'desc'
                }
            },
        });

        // Group by RFC to get only the latest active record per employee in the period
        const latestByRfc = new Map<string, typeof receptores[0]>();
        for (const rec of receptores) {
            if (!latestByRfc.has(rec.rfc)) {
                latestByRfc.set(rec.rfc, rec);
            }
        }
        
        const uniqueReceptores = Array.from(latestByRfc.values());

        // Map to standard RhDrilldownRow structure
        const data = uniqueReceptores.map(rec => {
            const r = rec.payrollReceipt;
            
            // Calculate antiguedad in years based on fechaInicioRelLaboral or use the SAT antiguedad field (which is usually in weeks or format PnYnMnD)
            let antiguedadAnios = 0;
            if (rec.fechaInicioRelLaboral) {
                const start = new Date(rec.fechaInicioRelLaboral);
                const end = new Date(r.fechaPago);
                const diffTime = Math.abs(end.getTime() - start.getTime());
                antiguedadAnios = diffTime / (1000 * 60 * 60 * 24 * 365.25);
            } else if (rec.antiguedad) {
                // If it's a number, SAT usually defines it in weeks.
                antiguedadAnios = Number(rec.antiguedad) / 52;
            }

            return {
                id: rec.id,
                uuid: r.uuid,
                fechaPago: r.fechaPago.toISOString(),
                tipoNomina: r.tipoNomina || '',
                departamento: rec.departamento || r.departamento || '',
                diasPagados: 0,
                percepciones: 0,
                deducciones: 0,
                otrosPagos: 0,
                neto: Number(r.invoice?.total || 0),
                receptorRfc: rec.rfc,
                receptorNombre: rec.nombre,
                receptorCurp: rec.curp || '',
                
                // Specific fields for Plantilla
                puesto: rec.puesto || '',
                antiguedadAnios: Number(antiguedadAnios.toFixed(2)),
                sdi: Number(rec.salarioDiarioIntegrado || 0),
                tipoContrato: rec.tipoContrato ? (TIPO_CONTRATO_CATALOG[rec.tipoContrato] || rec.tipoContrato) : '',
                tipoJornada: rec.tipoJornada ? (TIPO_JORNADA_CATALOG[rec.tipoJornada] || rec.tipoJornada) : '',
                sindicalizado: rec.sindicalizado === 'Sí' ? 'Sí' : 'No'
            };
        });

        // Apply limit after deduplication
        const limitedData = data.slice(0, p.limit);

        return NextResponse.json({
            ok: true,
            data: limitedData
        });

    } catch (error) {
        console.error('RH Plantilla Drilldown Error:', error);
        return NextResponse.json({ ok: false, error: 'INTERNAL_ERROR' }, { status: 500 });
    }
}