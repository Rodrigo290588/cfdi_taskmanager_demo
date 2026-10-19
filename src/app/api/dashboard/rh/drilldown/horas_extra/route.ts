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

const DrilldownRhHorasExtraParams = z
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
            kpiType: searchParams.get('kpiType'), // 'horas_extra_totales' | 'horas_dobles' | 'horas_triples' | 'costo_extra_total'
        };

        const parsed = DrilldownRhHorasExtraParams.safeParse(rawParams);
        if (!parsed.success) {
            return NextResponse.json({ ok: false, error: 'INVALID_PARAMS' }, { status: 400 });
        }

        const p = parsed.data;

        const where: Prisma.PayrollHorasExtraWhereInput = {
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

        if (p.kpiType === 'horas_dobles') {
            where.tipoHoras = '01';
        } else if (p.kpiType === 'horas_triples') {
            where.tipoHoras = '02';
        } else if (p.kpiType === 'horas_extra_totales' || p.kpiType === 'costo_extra_total') {
            // Include both
        }

        const horasExtra = await prisma.payrollHorasExtra.findMany({
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

        // Map it to the existing RhDrilldownRow structure
        const data = horasExtra.map(he => {
            const r = he.payrollReceipt;
            let tipoDesc = he.tipoHoras;
            if (he.tipoHoras === '01') {
                tipoDesc = '01 - Dobles';
            } else if (he.tipoHoras === '02') {
                tipoDesc = '02 - Triples';
            } else if (he.tipoHoras === '03') {
                tipoDesc = '03 - Simples';
            }
            
            return {
                id: he.id,
                uuid: r.uuid,
                fechaPago: r.fechaPago.toISOString(),
                tipoNomina: r.tipoNomina || '',
                tipoHorasExtra: tipoDesc,
                departamento: r.departamento,
                diasPagados: Number(he.dias || 0),
                horasExtraPagadas: Number(he.horasExtra || 0),
                percepciones: Number(he.importePagado || 0),
                deducciones: 0,
                otrosPagos: 0,
                neto: Number(he.importePagado || 0),
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
        console.error('RH Horas Extra Drilldown Error:', error);
        return NextResponse.json({ ok: false, error: 'INTERNAL_ERROR' }, { status: 500 });
    }
}
