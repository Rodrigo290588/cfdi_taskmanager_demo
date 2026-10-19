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

const DrilldownRhTurnoverParams = z
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
            kpiType: searchParams.get('kpiType'), // 'altas' | 'bajas' | 'reingresos'
        };

        const parsed = DrilldownRhTurnoverParams.safeParse(rawParams);
        if (!parsed.success) {
            return NextResponse.json({ ok: false, error: 'INVALID_PARAMS' }, { status: 400 });
        }

        const p = parsed.data;

        const dateStart = new Date(p.startDate);
        const dateEnd = new Date(p.endDate);
        const monthStart = `${dateStart.getUTCFullYear()}-${String(dateStart.getUTCMonth() + 1).padStart(2, '0')}-01`;
        const monthEnd = `${dateEnd.getUTCFullYear()}-${String(dateEnd.getUTCMonth() + 1).padStart(2, '0')}-01`;

        let typeCondition = '';
        if (p.kpiType === 'altas') {
            typeCondition = "mes_anterior IS NULL OR (mes_pago - mes_anterior) > 60";
        } else if (p.kpiType === 'bajas') {
            typeCondition = "(mes_siguiente IS NULL AND (max_mes_pago - mes_pago) > 60) OR (mes_siguiente - mes_pago > 60)";
        } else if (p.kpiType === 'reingresos') {
            typeCondition = "mes_anterior IS NOT NULL AND (mes_pago - mes_anterior) > 60";
        } else {
            return NextResponse.json({ ok: false, error: 'INVALID_KPI_TYPE' }, { status: 400 });
        }

        const orgFilter = p.organizationId ? Prisma.sql`AND p.organization_id = ${p.organizationId}` : Prisma.empty;
        const entityFilter = p.fiscalEntityId ? Prisma.sql`AND p.fiscal_entity_id = ${p.fiscalEntityId}` : Prisma.empty;
        const deptFilter = p.departamento ? Prisma.sql`AND p.departamento = ${p.departamento}` : Prisma.empty;
        const tipoNominaFilter = p.tipoNomina ? Prisma.sql`AND p.tipo_nomina = ${p.tipoNomina}` : Prisma.empty;

        const query = Prisma.sql`
        WITH max_mes_company AS (
         SELECT payroll_receipts.company_id,
            max((date_trunc('month', (payroll_receipts.fecha_pago)::timestamp with time zone))::date) AS max_mes_pago
           FROM payroll_receipts
          WHERE payroll_receipts.company_id = ${p.companyId}
          GROUP BY payroll_receipts.company_id
        ), recepciones_por_mes AS (
         SELECT pr.organization_id,
            pr.company_id,
            pr.fiscal_entity_id,
            pr.departamento,
            pr.tipo_nomina,
            prre.periodicidad_pago,
            prre.rfc AS receptor_rfc,
            (date_trunc('month', (pr.fecha_pago)::timestamp with time zone))::date AS mes_pago
           FROM payroll_receipts pr
           JOIN payroll_receptors prre ON prre.payroll_receipt_id = pr.id
           WHERE pr.company_id = ${p.companyId}
          GROUP BY pr.organization_id, pr.company_id, pr.fiscal_entity_id, pr.departamento, pr.tipo_nomina, prre.periodicidad_pago, prre.rfc, (date_trunc('month', (pr.fecha_pago)::timestamp with time zone))::date
        ), lag_lead AS (
         SELECT r.organization_id,
            r.company_id,
            r.fiscal_entity_id,
            r.departamento,
            r.tipo_nomina,
            r.periodicidad_pago,
            r.receptor_rfc as empleado_rfc,
            r.mes_pago,
            lag(r.mes_pago) OVER (PARTITION BY r.organization_id, r.company_id, r.tipo_nomina, r.periodicidad_pago, r.receptor_rfc ORDER BY r.mes_pago) AS mes_anterior,
            lead(r.mes_pago) OVER (PARTITION BY r.organization_id, r.company_id, r.tipo_nomina, r.periodicidad_pago, r.receptor_rfc ORDER BY r.mes_pago) AS mes_siguiente,
            m.max_mes_pago
           FROM recepciones_por_mes r
           JOIN max_mes_company m ON m.company_id = r.company_id
        ), target_employees AS (
            SELECT 
                empleado_rfc,
                departamento,
                mes_pago
            FROM lag_lead
            WHERE mes_pago >= ${monthStart}::date
              AND mes_pago <= ${monthEnd}::date
              AND (
                ${Prisma.raw(typeCondition)}
              )
        )
        SELECT 
            p.uuid,
            p.fecha_pago as "fechaPago",
            p.tipo_nomina as "tipoNomina",
            p.departamento as "departamento",
            p.num_dias_pagados as "diasPagados",
            p.total_percepciones as "percepciones",
            p.total_deducciones as "deducciones",
            p.total_otros_pagos as "otrosPagos",
            r.rfc as "receptorRfc",
            r.nombre as "receptorNombre",
            r.curp as "receptorCurp",
            p.invoice_id
        FROM target_employees te
        JOIN payroll_receptors r ON r.rfc = te.empleado_rfc
        JOIN payroll_receipts p ON p.id = r.payroll_receipt_id 
             AND p.company_id = ${p.companyId}
             AND p.departamento IS NOT DISTINCT FROM te.departamento
             AND p.fecha_pago >= te.mes_pago
             AND p.fecha_pago < (te.mes_pago + INTERVAL '1 month')
             ${orgFilter} ${entityFilter} ${deptFilter} ${tipoNominaFilter}
        ORDER BY p.fecha_pago DESC
        LIMIT ${p.limit}
        `;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const receipts: any[] = await prisma.$queryRaw(query);

        const data = receipts.map(r => ({
            id: r.uuid,
            uuid: r.uuid,
            fechaPago: r.fechaPago.toISOString(),
            tipoNomina: r.tipoNomina,
            departamento: r.departamento,
            diasPagados: Number(r.diasPagados || 0),
            percepciones: Number(r.percepciones || 0),
            deducciones: Number(r.deducciones || 0),
            otrosPagos: Number(r.otrosPagos || 0),
            neto: Number(r.percepciones) - Number(r.deducciones) + Number(r.otrosPagos || 0),
            receptorRfc: r.receptorRfc || '',
            receptorNombre: r.receptorNombre || '',
            receptorCurp: r.receptorCurp || '',
        }));

        return NextResponse.json({
            ok: true,
            data
        });

    } catch (error) {
        console.error('RH Turnover Drilldown Error:', error);
        return NextResponse.json({ ok: false, error: 'INTERNAL_ERROR' }, { status: 500 });
    }
}
