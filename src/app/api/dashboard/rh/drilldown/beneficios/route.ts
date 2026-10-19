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

const BENEFICIOS_KPI_MAP: Record<string, string> = {
    'vales_despensa': '029',
    'fondo_ahorro': '005',
    'premios_puntualidad': '010',
    'premios_asistencia': '049'
};

const BENEFICIOS_DESC_MAP: Record<string, string> = {
    '029': '029 - Vales de despensa',
    '005': '005 - Fondo de ahorro',
    '010': '010 - Premios por puntualidad',
    '049': '049 - Premios por asistencia'
};

const DrilldownRhBeneficiosParams = z
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
            kpiType: searchParams.get('kpiType'),
        };

        const parsed = DrilldownRhBeneficiosParams.safeParse(rawParams);
        if (!parsed.success) {
            return NextResponse.json({ ok: false, error: 'INVALID_PARAMS' }, { status: 400 });
        }

        const p = parsed.data;

        const where: Prisma.PayrollPercepcionWhereInput = {
            payrollReceipt: {
                companyId: p.companyId,
                fechaPago: {
                    gte: p.startDate,
                    lte: p.endDate,
                },
            }
        };

        if (p.organizationId) where.payrollReceipt!.organizationId = p.organizationId;
        if (p.fiscalEntityId) where.payrollReceipt!.fiscalEntityId = p.fiscalEntityId;
        if (p.departamento) where.payrollReceipt!.departamento = p.departamento;
        if (p.tipoNomina) where.payrollReceipt!.tipoNomina = p.tipoNomina;

        if (p.kpiType && BENEFICIOS_KPI_MAP[p.kpiType]) {
            where.tipoPercepcion = BENEFICIOS_KPI_MAP[p.kpiType];
        } else {
            where.tipoPercepcion = { in: ['029', '005', '010', '049'] };
        }

        const percepciones = await prisma.payrollPercepcion.findMany({
            where,
            include: {
                payrollReceipt: {
                    include: {
                        receptor: true,
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
            take: p.limit,
        });

        // To map it to the existing RhDrilldownRow structure
        const data = percepciones.map(perc => {
            const r = perc.payrollReceipt;
            const tipoDesc = BENEFICIOS_DESC_MAP[perc.tipoPercepcion] || perc.tipoPercepcion;
            
            return {
                id: perc.id,
                uuid: r.uuid,
                fechaPago: r.fechaPago.toISOString(),
                tipoNomina: r.tipoNomina || '',
                departamento: r.departamento,
                tipoBeneficio: tipoDesc,
                importeBeneficio: Number(perc.importeGravado || 0) + Number(perc.importeExento || 0),
                diasPagados: Number(r.numDiasPagados || 0),
                percepciones: Number(r.totalPercepciones || 0),
                deducciones: Number(r.totalDeducciones || 0),
                otrosPagos: Number(r.totalOtrosPagos || 0),
                neto: Number(r.invoice?.total || 0),
                receptorRfc: r.receptor?.rfc || '',
                receptorNombre: r.receptor?.nombre || '',
                receptorCurp: r.receptor?.curp || '',
            };
        });

        return NextResponse.json({
            ok: true,
            data
        });

    } catch (error) {
        console.error('RH Beneficios Drilldown Error:', error);
        return NextResponse.json({ ok: false, error: 'INTERNAL_ERROR' }, { status: 500 });
    }
}