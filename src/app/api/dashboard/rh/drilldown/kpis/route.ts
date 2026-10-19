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

const DrilldownRhKpisParams = z
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

        const parsed = DrilldownRhKpisParams.safeParse(rawParams);
        if (!parsed.success) {
            return NextResponse.json({ ok: false, error: 'INVALID_PARAMS' }, { status: 400 });
        }

        const p = parsed.data;

        // Prisma query
        // We will fetch PayrollReceipt joined with PayrollReceptor
        const where: Prisma.PayrollReceiptWhereInput = {
            companyId: p.companyId,
            fechaPago: {
                gte: p.startDate,
                lte: p.endDate,
            },
        };

        if (p.organizationId) where.organizationId = p.organizationId;
        if (p.fiscalEntityId) where.fiscalEntityId = p.fiscalEntityId;
        if (p.departamento) where.departamento = p.departamento;
        if (p.tipoNomina) where.tipoNomina = p.tipoNomina;
        // periodicidad might need join with receptor or just ignore if not in receipt directly

        const receipts = await prisma.payrollReceipt.findMany({
            where,
            include: {
                receptor: true,
                invoice: {
                    select: {
                        total: true
                    }
                }
            },
            orderBy: {
                fechaPago: 'desc'
            },
            take: p.limit,
        });

        const data = receipts.map(r => ({
            id: r.id,
            uuid: r.uuid,
            fechaPago: r.fechaPago.toISOString(),
            tipoNomina: r.tipoNomina,
            departamento: r.departamento,
            diasPagados: Number(r.numDiasPagados || 0),
            percepciones: Number(r.totalPercepciones || 0),
            deducciones: Number(r.totalDeducciones || 0),
            otrosPagos: Number(r.totalOtrosPagos || 0),
            neto: r.invoice?.total ? Number(r.invoice.total) : Number(r.totalPercepciones) - Number(r.totalDeducciones) + Number(r.totalOtrosPagos || 0),
            receptorRfc: r.receptor?.rfc || '',
            receptorNombre: r.receptor?.nombre || '',
            receptorCurp: r.receptor?.curp || '',
        }));

        return NextResponse.json({
            ok: true,
            data
        });

    } catch (error) {
        console.error('RH Drilldown Error:', error);
        return NextResponse.json({ ok: false, error: 'INTERNAL_ERROR' }, { status: 500 });
    }
}
