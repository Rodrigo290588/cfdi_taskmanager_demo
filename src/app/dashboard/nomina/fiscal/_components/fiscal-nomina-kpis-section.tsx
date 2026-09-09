// ============================================================
// fiscal-nomina-kpis-section.tsx · TASK 7
// 6 KpiCards: ISR, Cuotas Terceros, Cancelados, UUID Dup, Brecha 5d, SBC/SDI
// Server async + Suspense en parent. Los datos se traen vía prisma.$queryRaw
// sobre MV mv_fiscal_conciliacion_mensual.
// ============================================================

import { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Landmark, Users2, FileX, CopySlash, Clock12, AlertTriangle } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import { fmtMxn, fmtNum } from '@/lib/fiscal-nomina-formatters';
import type { FiscalNomTableParams } from '@/lib/fiscal-nomina-types';
import {
    KpiCardFiscal, KpiCanceladosTriggerClient, KpiUuidDuplicadosTriggerClient, KpiRetrasosTimbradoTriggerClient,
    KpiAlertasSbcSdiTriggerClient, KpiIsrRetenidoTriggerClient,
} from './fiscal-nomina-shared';

export type FiscalNominaKpisRow = {
    count_receipts: number;
    count_empleados_distinct: number;
    isr_retenido_mxn: number;
    cuotas_infonavit: number;
    cuotas_fonacot: number;
    cuotas_pension: number;
    cuotas_sindicato: number;
    gravado_001_sueldos: number;
    exento_001_sueldos: number;
    count_cancelados: number;
    count_uuid_duplicados: number;
    count_brecha_5dias: number;
    recepciones_sbc_null: number;
    recepciones_sdi_null: number;
    recepciones_desv_sbc_sdi_gt_3pct: number;
};

function safeToNumber(v: unknown, fallback = 0): number {
    if (v === null || v === undefined) return fallback;
    try {
        if (typeof v === 'bigint') {
            const n = Number(v);
            return Number.isFinite(n) ? n : fallback;
        }
        if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
        if (typeof v === 'string') {
            const n = Number.parseFloat(v);
            return Number.isFinite(n) ? n : fallback;
        }
        const n = Number(v);
        return Number.isFinite(n) ? n : fallback;
    } catch {
        return fallback;
    }
}

const SAFE_KPI_DEFAULTS: FiscalNominaKpisRow = {
    count_receipts: 0, count_empleados_distinct: 0,
    isr_retenido_mxn: 0, cuotas_infonavit: 0, cuotas_fonacot: 0, cuotas_pension: 0, cuotas_sindicato: 0,
    gravado_001_sueldos: 0, exento_001_sueldos: 0,
    count_cancelados: 0, count_uuid_duplicados: 0, count_brecha_5dias: 0,
    recepciones_sbc_null: 0, recepciones_sdi_null: 0,
    recepciones_desv_sbc_sdi_gt_3pct: 0,
};

function sanitizeKpisRow(raw: Partial<FiscalNominaKpisRow> | null | undefined): FiscalNominaKpisRow {
    const r = raw ?? {};
    return {
        count_receipts: safeToNumber(r.count_receipts, 0),
        count_empleados_distinct: safeToNumber(r.count_empleados_distinct, 0),
        isr_retenido_mxn: safeToNumber(r.isr_retenido_mxn, 0),
        cuotas_infonavit: safeToNumber(r.cuotas_infonavit, 0),
        cuotas_fonacot: safeToNumber(r.cuotas_fonacot, 0),
        cuotas_pension: safeToNumber(r.cuotas_pension, 0),
        cuotas_sindicato: safeToNumber(r.cuotas_sindicato, 0),
        gravado_001_sueldos: safeToNumber(r.gravado_001_sueldos, 0),
        exento_001_sueldos: safeToNumber(r.exento_001_sueldos, 0),
        count_cancelados: safeToNumber(r.count_cancelados, 0),
        count_uuid_duplicados: safeToNumber(r.count_uuid_duplicados, 0),
        count_brecha_5dias: safeToNumber(r.count_brecha_5dias, 0),
        recepciones_sbc_null: safeToNumber(r.recepciones_sbc_null, 0),
        recepciones_sdi_null: safeToNumber(r.recepciones_sdi_null, 0),
        recepciones_desv_sbc_sdi_gt_3pct: safeToNumber(r.recepciones_desv_sbc_sdi_gt_3pct, 0),
    };
}

export async function fetchFiscalNominaKpis(params: FiscalNomTableParams): Promise<FiscalNominaKpisRow> {
    const s = new Date(params.startDate);
    const e = new Date(params.endDate);
    const sY = s.getFullYear(), sM = s.getMonth() + 1;
    const eY = e.getFullYear(), eM = e.getMonth() + 1;
    const fe = params.fiscalEntityId ?? null;
    try {
    const rows = await prisma.$queryRaw<FiscalNominaKpisRow[]>`
        SELECT COUNT(*)::bigint                                            AS count_receipts,
               0::bigint                                                   AS count_empleados_distinct,
               COALESCE(SUM(isr_retenido_mxn), 0)::numeric(18,6)          AS isr_retenido_mxn,
               COALESCE(SUM(cuotas_infonavit), 0)::numeric(18,6)           AS cuotas_infonavit,
               COALESCE(SUM(cuotas_fonacot), 0)::numeric(18,6)             AS cuotas_fonacot,
               COALESCE(SUM(cuotas_pension), 0)::numeric(18,6)             AS cuotas_pension,
               COALESCE(SUM(cuotas_sindicato), 0)::numeric(18,6)           AS cuotas_sindicato,
               COALESCE(SUM(gravado_001_sueldos), 0)::numeric(18,6)        AS gravado_001_sueldos,
               COALESCE(SUM(exento_001_sueldos), 0)::numeric(18,6)         AS exento_001_sueldos,
               COALESCE(SUM(count_cancelados), 0)::bigint                  AS count_cancelados,
               COALESCE(SUM(count_uuid_duplicados), 0)::bigint             AS count_uuid_duplicados,
               COALESCE(SUM(count_brecha_5dias), 0)::bigint                 AS count_brecha_5dias,
               COALESCE(SUM(recepciones_sbc_null), 0)::bigint              AS recepciones_sbc_null,
               COALESCE(SUM(recepciones_sdi_null), 0)::bigint              AS recepciones_sdi_null,
               COALESCE(SUM(recepciones_desv_sbc_sdi_gt_3pct), 0)::bigint  AS recepciones_desv_sbc_sdi_gt_3pct
          FROM mv_fiscal_conciliacion_mensual
         WHERE company_id = ${params.companyId}::text
           AND (anio, mes) >= ROW(${sY}::int, ${sM}::int)
           AND (anio, mes) <= ROW(${eY}::int, ${eM}::int)
           AND (${fe}::text IS NULL OR fiscal_entity_id = ${fe}::text);
    `;
    const result = rows?.[0];
    if (result) return sanitizeKpisRow(result as Partial<FiscalNominaKpisRow>);
    return SAFE_KPI_DEFAULTS;
  } catch {
    return SAFE_KPI_DEFAULTS;
  }
}

export function KpiGridSkeleton() {
    return (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="space-y-3 border border-border rounded-md p-4">
                    <Skeleton className="h-4 w-full bg-slate-200/70 animate-pulse rounded" />
                    <Skeleton className="h-12 w-12 mx-auto bg-slate-200/60 rounded-md animate-pulse" />
                    <Skeleton className="h-8 w-3/4 mx-auto bg-slate-200/70 rounded animate-pulse" />
                    <Skeleton className="h-3 w-full bg-slate-200/60 rounded animate-pulse" />
                </div>
            ))}
        </div>
    );
}

export async function KpisSection(params: FiscalNomTableParams) {
    type KpiData = {
        ok: true;
        k: FiscalNominaKpisRow;
        cuotasTerceros: number;
        alertasSbcSdi: number;
    } | { ok: false };
    let data: KpiData = { ok: false };
    try {
        const k = await fetchFiscalNominaKpis(params);
        const cuotasTerceros =
            safeToNumber(k.cuotas_infonavit) + safeToNumber(k.cuotas_fonacot) + safeToNumber(k.cuotas_pension) + safeToNumber(k.cuotas_sindicato);
        const alertasSbcSdi =
            safeToNumber(k.recepciones_sbc_null) + safeToNumber(k.recepciones_sdi_null) + safeToNumber(k.recepciones_desv_sbc_sdi_gt_3pct);
        data = { ok: true, k, cuotasTerceros, alertasSbcSdi };
    } catch (e) {
        const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        console.error('[KpisSection] FATAL error render (capturado):', msg);
        data = { ok: false };
    }

    let grid: React.ReactNode;
    if (!data.ok) {
        grid = (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-6">
                {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="border border-dashed border-slate-300 rounded-md p-6 space-y-2 text-center">
                        <div className="h-12 w-12 mx-auto bg-slate-100 rounded-md flex items-center justify-center text-slate-500 text-xs">
                            N/D
                        </div>
                        <div className="text-xs text-muted-foreground">
                            KPI {i + 1} no disponible temporalmente
                        </div>
                    </div>
                ))}
            </div>
        );
    } else {
        const { k, cuotasTerceros, alertasSbcSdi } = data;
        grid = (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-6">
                <div className="relative">
                    <KpiCardFiscal
                        title="ISR Retenido"
                        tone="slate"
                        icon={<Landmark className="h-12 w-12" />}
                        value={fmtMxn(safeToNumber(k.isr_retenido_mxn))}
                        sublabel="TipoDeduccion SAT · 002"
                    />
                    <KpiIsrRetenidoTriggerClient />
                </div>
                <KpiCardFiscal
                    title="Cuotas Terceros"
                    tone="emerald"
                    icon={<Users2 className="h-12 w-12" />}
                    value={fmtMxn(cuotasTerceros)}
                    sublabel="INFONAVIT · FONACOT · Pensión · Sindicato"
                />
                <div className="relative">
                    <KpiCardFiscal
                        title="Cancelados"
                        tone="rose"
                        icon={<FileX className="h-12 w-12" />}
                        value={fmtNum(safeToNumber(k.count_cancelados), 0)}
                        badge={
                            safeToNumber(k.count_cancelados) > 0
                                ? <Badge variant="destructive" className="font-normal text-xs">Riesgo</Badge>
                                : undefined
                        }
                        sublabel="Estatus SAT = CANCELADO"
                    />
                    <KpiCanceladosTriggerClient />
                </div>
                <div className="relative">
                    <KpiCardFiscal
                        title="UUID Duplicados"
                        tone="amber"
                        icon={<CopySlash className="h-12 w-12" />}
                        value={fmtNum(safeToNumber(k.count_uuid_duplicados), 0)}
                        badge={
                            safeToNumber(k.count_uuid_duplicados) > 0
                                ? <Badge variant="destructive" className="font-normal text-xs">Riesgo</Badge>
                                : undefined
                        }
                        sublabel="UUID repetido > 1 carga histórica"
                    />
                    <KpiUuidDuplicadosTriggerClient />
                </div>
                <div className="relative">
                    <KpiCardFiscal
                        title="Retrasos Timbrado"
                        tone="indigo"
                        icon={<Clock12 className="h-12 w-12" />}
                        value={fmtNum(safeToNumber(k.count_brecha_5dias), 0)}
                        badge={
                            safeToNumber(k.count_brecha_5dias) > 0
                                ? <Badge variant="destructive" className="font-normal text-xs">Riesgo SAT</Badge>
                                : undefined
                        }
                        sublabel="Brecha Emisión vs Pago > 5 días"
                    />
                    <KpiRetrasosTimbradoTriggerClient />
                </div>
                <div className="relative">
                    <KpiCardFiscal
                        title="Alertas SBC / SDI"
                        tone="violet"
                        icon={<AlertTriangle className="h-12 w-12" />}
                        value={fmtNum(alertasSbcSdi, 0)}
                        badge={
                            alertasSbcSdi > 0
                                ? <Badge variant="destructive" className="font-normal text-xs">Riesgo IMSS</Badge>
                                : undefined
                        }
                        sublabel="Nulos · Cero · Desviación > 3%"
                    />
                    <KpiAlertasSbcSdiTriggerClient />
                </div>
            </div>
        );
    }
    return <>{grid}</>;
}

export function KpisSectionSuspensed(props: Readonly<Parameters<typeof KpisSection>[0]>) {
    return (
        <Suspense fallback={<KpiGridSkeleton />}>
            <KpisSection {...props} />
        </Suspense>
    );
}