// ============================================================
// DrilldownDialogAlertasSbcSdiNom.tsx · FASE C KPI#6
// Client Boundary · Reporte Alertas SBC (SalarioBaseCotApor) / SDI (SalarioDiarioIntegrado)
//
// 5 CRITERIOS de Alerta:
//   SBC_NULL / SDI_NULL → Badge rose destructive
//   SBC_ZERO / SDI_ZERO → Badge amber outline
//   DESV_3PCT           → Badge violet
//
// Patrón 100% piloto Cancelados/KPI4/KPI5:
// Fullscreen Dialog · 15 cols · sticky filtros · pag 200 · Total Filtrado · CSV BOM · 3 EmptyStates
// ============================================================
'use client';

import { useEffect, useMemo, useState } from 'react';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    Download, FileWarning, Loader2, AlertTriangle,
} from 'lucide-react';
import { FiscalNomEmptyState } from './fiscal-nomina-shared';
import { fmtMxn, fmtNum, fmtDateEs } from '@/lib/fiscal-nomina-formatters';
import { sanitizeDownloadFilename } from '@/lib/dashboard-fiscal-route-utils';

export const DRILLDOWN_ALERTAS_PAGE_SIZE = 200;

export type AlertaSbcSdiTipoFlag =
    | 'SBC_NULL'
    | 'SDI_NULL'
    | 'SBC_ZERO'
    | 'SDI_ZERO'
    | 'DESV_3PCT';

export type DrilldownAlertaSbcSdiRow = {
    receiptId: string | null;
    invoiceId: string;
    /** UUID de timbre SAT del CFDI (RFC SAT Anexo 20) */
    uuid: string;
    fechaPago: string | null;
    fechaEmision: string | null;
    tipoNomina: string;
    serie: string | null;
    folio: string | null;
    empleadoRfc: string;
    empleadoNombre: string;
    empleadoNum: string | null;
    curp: string | null;
    nss: string | null;
    departamento: string | null;
    salarioBaseCotApor: number | null;
    salarioDiarioIntegrado: number | null;
    pctDesviacion: number | null;
    alertaSbcNull: boolean;
    alertaSdiNull: boolean;
    alertaSbcZero: boolean;
    alertaSdiZero: boolean;
    alertaDesv3pct: boolean;
    tiposAlertaList: AlertaSbcSdiTipoFlag[];
    satStatus: string;
    pdfUrl: string | null;
};

export type DrilldownAlertasSbcSdiResponse = {
    ok: boolean;
    generatedAt?: string;
    scope?: {
        companyId: string;
        filters: { startDate: string; endDate: string };
    };
    pageInfo?: {
        pageSize: number;
        returned: number;
        hasNextPage: boolean;
        nextCursor: string | null;
    };
    totals?: {
        countAlertas: number;
        countTotalFlags: number;
        countAlertas_SBC_NULL: number;
        countAlertas_SDI_NULL: number;
        countAlertas_SBC_ZERO: number;
        countAlertas_SDI_ZERO: number;
        countAlertas_DESV_3PCT: number;
        maxPctDesv: number;
        avgPctDesv: number;
        countEmpleadosAfectados: number;
        countComprobantesAfectados: number;
    };
    data?: DrilldownAlertaSbcSdiRow[];
    error?: string;
    correlationId?: string;
    helpText?: string;
};

export type AlertasFilters = Partial<Record<
    | 'tiposAlerta'
    | 'sbc'
    | 'sdi'
    | 'pctDesv'
    | 'empleadoRfc'
    | 'empleadoNombre'
    | 'empleadoNum'
    | 'curp'
    | 'nss'
    | 'departamento'
    | 'tipoNomina'
    | 'fechaPago'
    | 'fechaEmision'
    | 'folio'
    | 'uuid'
    | 'satStatus',
    string
>>;

function _s(v: unknown): string {
    if (v === null || v === undefined) return '';
    switch (typeof v) {
        case 'string':  return v.normalize('NFD').toLowerCase();
        case 'number':
        case 'bigint':
        case 'boolean': return String(v).normalize('NFD').toLowerCase();
        default:         return '';
    }
}

function _match(row: DrilldownAlertaSbcSdiRow, f: AlertasFilters): boolean {
    const checks: Array<[string, string | undefined]> = [
        [row.tiposAlertaList.join(' '), f.tiposAlerta],
        [row.salarioBaseCotApor == null ? 'N/D' : fmtMxn(row.salarioBaseCotApor), f.sbc],
        [row.salarioDiarioIntegrado == null ? 'N/D' : fmtMxn(row.salarioDiarioIntegrado), f.sdi],
        [row.pctDesviacion == null ? '' : `${fmtNum(row.pctDesviacion, 2)}%`, f.pctDesv],
        [row.empleadoRfc, f.empleadoRfc],
        [row.empleadoNombre, f.empleadoNombre],
        [row.empleadoNum || '', f.empleadoNum],
        [row.curp || '', f.curp],
        [row.nss || '', f.nss],
        [row.departamento || '', f.departamento],
        [row.tipoNomina, f.tipoNomina],
        [fmtDateEs(row.fechaPago) ?? '', f.fechaPago],
        [fmtDateEs(row.fechaEmision) ?? '', f.fechaEmision],
        [[row.serie, row.folio].filter(Boolean).join('/'), f.folio],
        [row.uuid, f.uuid],
        [row.satStatus, f.satStatus],
    ];
    for (const [val, q] of checks) {
        if (!q) continue;
        if (!_s(val).includes(_s(q))) return false;
    }
    return true;
}

type _AlertaFlagMeta = Readonly<{
    label: string;
    colorClass: string;
    variant: 'destructive' | 'secondary' | 'outline' | 'default';
}>;

const ALERTA_FLAG_META: Readonly<Record<AlertaSbcSdiTipoFlag, _AlertaFlagMeta>> = {
    SBC_NULL:  { label: 'SBC Nulo',  colorClass: 'bg-rose-50 border-rose-200 text-rose-800',   variant: 'destructive' },
    SDI_NULL:  { label: 'SDI Nulo',  colorClass: 'bg-rose-50 border-rose-200 text-rose-800',   variant: 'destructive' },
    SBC_ZERO:  { label: 'SBC = 0',   colorClass: 'bg-amber-50 border-amber-200 text-amber-800', variant: 'outline' },
    SDI_ZERO:  { label: 'SDI = 0',   colorClass: 'bg-amber-50 border-amber-200 text-amber-800', variant: 'outline' },
    DESV_3PCT: { label: 'Desv > 3%', colorClass: 'bg-violet-50 border-violet-200 text-violet-800', variant: 'default' },
};
function pctTone(p: number | null | undefined): string {
    if (p == null || !Number.isFinite(p)) return '';
    if (p >= 10) return 'text-rose-700 font-bold';
    if (p >= 5)  return 'text-amber-700 font-semibold';
    return 'text-indigo-700';
}

type _RenderTotals = {
    totalFlags: number;
    countSbcNull: number;
    countSdiNull: number;
    countSbcZero: number;
    countSdiZero: number;
    countDesv: number;
    maxPct: number;
    avgPct: number;
    empleadosAfect: number;
    comprobantesAfect: number;
};

type _RenderUIState = Readonly<{
    loading: boolean;
    errorMsg: string | null;
    rows: DrilldownAlertaSbcSdiRow[];
    paginated: DrilldownAlertaSbcSdiRow[];
    filtered: DrilldownAlertaSbcSdiRow[];
}>;

type _RenderUIControls = Readonly<{
    filters: AlertasFilters;
    filteredTotals: _RenderTotals;
    updateFilter: <K extends keyof AlertasFilters>(k: K, v: string) => void;
}>;

function _renderLoadingState() {
    return (
        <div className="flex-1 flex justify-center items-center gap-2 text-muted-foreground p-8">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="text-sm">Cargando reporte de alertas SBC / SDI...</span>
        </div>
    );
}

function _renderErrorState(errorMsg: string) {
    return (
        <div className="flex-1 flex justify-center items-center p-8">
            <FiscalNomEmptyState
                icon={<FileWarning className="h-10 w-10" />}
                title="No se pudo cargar el reporte"
                subtitle={errorMsg}
                hint="Revisa tu conexión o notifica a soporte."
            />
        </div>
    );
}

function _renderEmptyState() {
    return (
        <div className="flex-1 flex justify-center items-center p-8">
            <FiscalNomEmptyState
                icon={<AlertTriangle className="h-10 w-10 text-violet-500" />}
                title="Sin desviaciones en SBC / SDI"
                subtitle="No se detectaron nulos, ceros ni desviaciones > 3% entre SalarioBaseCotApor y SalarioDiarioIntegrado en el periodo."
                hint="Cambia el rango de fechas o valida la integración de payroll_receptors desde el XML del CFDI."
            />
        </div>
    );
}

function _renderTableWithData(
    ui: _RenderUIState,
    c: _RenderUIControls,
) {
    const { paginated, filtered } = ui;
    const { filters, filteredTotals, updateFilter } = c;
    return (
        <Table className="w-full min-w-max">
            <TableHeader className="sticky top-0 bg-muted z-10 shadow-sm">
                <TableRow>
                    <TableHead className="w-[210px]">Tipo(s) Alerta</TableHead>
                    <TableHead className="w-[120px] text-right">SBC</TableHead>
                    <TableHead className="w-[120px] text-right">SDI</TableHead>
                    <TableHead className="w-[110px] text-right">% Desviación</TableHead>
                    <TableHead className="w-[130px]">RFC Empleado</TableHead>
                    <TableHead className="max-w-[360px]">Nombre Empleado</TableHead>
                    <TableHead className="w-[90px]">No. Emp.</TableHead>
                    <TableHead className="w-[160px]">CURP</TableHead>
                    <TableHead className="w-[110px]">NSS</TableHead>
                    <TableHead className="w-[160px]">Departamento</TableHead>
                    <TableHead className="w-[90px]">Tipo</TableHead>
                    <TableHead className="w-[110px]">Fecha Pago</TableHead>
                    <TableHead className="w-[110px]">Fecha Emisión</TableHead>
                    <TableHead className="w-[110px]">Folio/Serie</TableHead>
                    <TableHead className="w-[310px]">UUID</TableHead>
                </TableRow>
                <TableRow className="bg-muted/50 border-b shadow-sm">
                    <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar tipo..." className="h-7 text-xs bg-background" value={filters.tiposAlerta || ''} onChange={e => updateFilter('tiposAlerta', e.target.value)}/></TableHead>
                    <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background text-right" value={filters.sbc || ''} onChange={e => updateFilter('sbc', e.target.value)}/></TableHead>
                    <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background text-right" value={filters.sdi || ''} onChange={e => updateFilter('sdi', e.target.value)}/></TableHead>
                    <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar %" className="h-7 text-xs bg-background text-right" value={filters.pctDesv || ''} onChange={e => updateFilter('pctDesv', e.target.value)}/></TableHead>
                    <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background font-mono" value={filters.empleadoRfc || ''} onChange={e => updateFilter('empleadoRfc', e.target.value)}/></TableHead>
                    <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background" value={filters.empleadoNombre || ''} onChange={e => updateFilter('empleadoNombre', e.target.value)}/></TableHead>
                    <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background font-mono" value={filters.empleadoNum || ''} onChange={e => updateFilter('empleadoNum', e.target.value)}/></TableHead>
                    <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background font-mono" value={filters.curp || ''} onChange={e => updateFilter('curp', e.target.value)}/></TableHead>
                    <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background font-mono" value={filters.nss || ''} onChange={e => updateFilter('nss', e.target.value)}/></TableHead>
                    <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background" value={filters.departamento || ''} onChange={e => updateFilter('departamento', e.target.value)}/></TableHead>
                    <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background" value={filters.tipoNomina || ''} onChange={e => updateFilter('tipoNomina', e.target.value)}/></TableHead>
                    <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background" value={filters.fechaPago || ''} onChange={e => updateFilter('fechaPago', e.target.value)}/></TableHead>
                    <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background" value={filters.fechaEmision || ''} onChange={e => updateFilter('fechaEmision', e.target.value)}/></TableHead>
                    <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background" value={filters.folio || ''} onChange={e => updateFilter('folio', e.target.value)}/></TableHead>
                    <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar UUID..." className="h-7 text-xs bg-background font-mono" value={filters.uuid || ''} onChange={e => updateFilter('uuid', e.target.value)}/></TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {paginated.map((r, i) => {
                    const highlightFila =
                        r.alertaSbcNull || r.alertaSdiNull ||
                        (r.pctDesviacion != null && r.pctDesviacion >= 10);
                    return (
                        <TableRow
                            key={`${r.receiptId || r.invoiceId}-${i}`}
                            className={highlightFila ? 'bg-rose-50 hover:bg-rose-50 dark:bg-rose-950/20' : undefined}
                        >
                            <TableCell className="whitespace-nowrap">
                                <div className="flex flex-wrap gap-1.5 items-center">
                                    {r.tiposAlertaList.length === 0 ? (
                                        <Badge variant="secondary" className="text-[11px] px-2 py-0.5">—</Badge>
                                    ) : r.tiposAlertaList.map(t => (
                                        <Badge
                                            key={t}
                                            variant={ALERTA_FLAG_META[t].variant}
                                            className={['text-[11px] px-2 py-0.5 border', ALERTA_FLAG_META[t].colorClass].join(' ')}
                                        >
                                            {ALERTA_FLAG_META[t].label}
                                        </Badge>
                                    ))}
                                </div>
                            </TableCell>
                            <TableCell className={sbcColClass(r)}>
                                {r.salarioBaseCotApor == null ? (
                                    <span className="text-rose-700 font-semibold">N/D</span>
                                ) : (
                                    fmtMxn(r.salarioBaseCotApor)
                                )}
                            </TableCell>
                            <TableCell className={sdiColClass(r)}>
                                {r.salarioDiarioIntegrado == null ? (
                                    <span className="text-rose-700 font-semibold">N/D</span>
                                ) : (
                                    fmtMxn(r.salarioDiarioIntegrado)
                                )}
                            </TableCell>
                            <TableCell className={`whitespace-nowrap text-right ${pctTone(r.pctDesviacion)}`}>
                                {r.pctDesviacion == null ? '—' : `${fmtNum(r.pctDesviacion, 2)}%`}
                            </TableCell>
                            <TableCell className="whitespace-nowrap font-mono text-[11px]">{r.empleadoRfc}</TableCell>
                            <TableCell className="max-w-[340px] truncate" title={r.empleadoNombre}>{r.empleadoNombre}</TableCell>
                            <TableCell className="whitespace-nowrap font-mono text-[11px]">{r.empleadoNum || '-'}</TableCell>
                            <TableCell className="whitespace-nowrap font-mono text-[11px]">{r.curp || '-'}</TableCell>
                            <TableCell className="whitespace-nowrap font-mono text-[11px]">{r.nss || '-'}</TableCell>
                            <TableCell className="whitespace-nowrap text-[12px]">{r.departamento || '-'}</TableCell>
                            <TableCell className="whitespace-nowrap text-[11px] font-semibold">{r.tipoNomina}</TableCell>
                            <TableCell className="whitespace-nowrap">{fmtDateEs(r.fechaPago)}</TableCell>
                            <TableCell className="whitespace-nowrap">{fmtDateEs(r.fechaEmision)}</TableCell>
                            <TableCell className="whitespace-nowrap text-[12px] font-medium">
                                {[r.serie, r.folio].filter(Boolean).join(' / ') || '-'}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-[11px] font-mono truncate max-w-[290px]" title={r.uuid}>
                                {r.uuid}
                                {r.pdfUrl ? (
                                    <>
                                        {' · '}
                                        <a className="text-blue-600 hover:underline" target="_blank" rel="noreferrer noopener" href={r.pdfUrl}>PDF↗</a>
                                    </>
                                ) : null}
                            </TableCell>
                        </TableRow>
                    );
                })}
                {filtered.length === 0 && (
                    <TableRow>
                        <TableCell colSpan={15} className="h-24 text-center text-muted-foreground text-sm">
                            No se encontraron resultados para tu búsqueda.
                        </TableCell>
                    </TableRow>
                )}
                {filtered.length > 0 && (
                    <TableRow className="bg-muted/50 font-bold hover:bg-muted/50">
                        <TableCell colSpan={10} className="text-right text-xs">
                            Total Filtrado · {fmtNum(filtered.length)} comprobante(s) · flags totales {fmtNum(filteredTotals.totalFlags)} ·{' '}
                            Nulos (SBC {fmtNum(filteredTotals.countSbcNull)} · SDI {fmtNum(filteredTotals.countSdiNull)}) ·{' '}
                            Ceros (SBC {fmtNum(filteredTotals.countSbcZero)} · SDI {fmtNum(filteredTotals.countSdiZero)}) ·{' '}
                            {'Desv>3%'} {fmtNum(filteredTotals.countDesv)} ·{' '}
                            Peak {fmtNum(filteredTotals.maxPct, 2)}% · avg {fmtNum(filteredTotals.avgPct, 2)}% ·{' '}
                            {fmtNum(filteredTotals.empleadosAfect)} trabajador(es) · {fmtNum(filteredTotals.comprobantesAfect)} CFDI
                        </TableCell>
                        <TableCell colSpan={5} className="text-center text-xs">
                            ·
                        </TableCell>
                    </TableRow>
                )}
            </TableBody>
        </Table>
    );
}

function renderMainContent(
    ui: _RenderUIState,
    c: _RenderUIControls,
) {
    if (ui.loading) return _renderLoadingState();
    if (ui.errorMsg) return _renderErrorState(ui.errorMsg);
    if (ui.rows.length === 0) return _renderEmptyState();
    return _renderTableWithData(ui, c);
}

type DrilldownDialogAlertasSbcSdiNomProps = Readonly<{
    open: boolean;
    onOpenChange: (open: boolean) => void;
    companyId: string;
    companyRfc?: string | null;
    companyDisplayName?: string | null;
    startDate: string;
    endDate: string;
}>;

function sbcColClass(r: DrilldownAlertaSbcSdiRow): string {
    const base = 'whitespace-nowrap text-right font-medium';
    if (r.alertaSbcNull) return `${base} text-rose-700`;
    if (r.alertaSbcZero) return `${base} text-amber-700`;
    return base;
}

function sdiColClass(r: DrilldownAlertaSbcSdiRow): string {
    const base = 'whitespace-nowrap text-right font-medium';
    if (r.alertaSdiNull) return `${base} text-rose-700`;
    if (r.alertaSdiZero) return `${base} text-amber-700`;
    return base;
}

export function DrilldownDialogAlertasSbcSdiNom(props: DrilldownDialogAlertasSbcSdiNomProps) {
    const [loading, setLoading] = useState(false);
    const [rows, setRows] = useState<DrilldownAlertaSbcSdiRow[]>([]);
    const [serverTotals, setServerTotals] = useState<DrilldownAlertasSbcSdiResponse['totals'] | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [filters, setFilters] = useState<AlertasFilters>({});
    const [page, setPage] = useState(1);

    useEffect(() => {
        if (!props.open) return;
        let cancelled = false;
        (async () => {
            setLoading(true);
            setErrorMsg(null);
            try {
                const url = new URL('/api/dashboard/nomina/fiscal/drilldown/alertas_sbc_sdi', window.location.origin);
                url.searchParams.set('companyId', props.companyId);
                url.searchParams.set('startDate', props.startDate);
                url.searchParams.set('endDate', props.endDate);
                const res = await fetch(url.toString(), {
                    method: 'GET',
                    credentials: 'same-origin',
                    headers: { Accept: 'application/json' },
                    cache: 'no-store',
                });
                if (!res.ok) {
                    try {
                        const j = (await res.json()) as DrilldownAlertasSbcSdiResponse;
                        throw new Error(j.error || `HTTP ${res.status}`);
                    } catch (error_) {
                        if (error_ instanceof Error && error_.message.startsWith('Error: ')) throw error_;
                        throw new Error(`HTTP ${res.status}`);
                    }
                }
                const json = (await res.json()) as DrilldownAlertasSbcSdiResponse;
                if (!json.ok || !Array.isArray(json.data)) {
                    throw new Error(json.error || 'Respuesta inválida del servidor');
                }
                if (cancelled) return;
                setRows(json.data);
                setServerTotals(json.totals ?? null);
                setPage(1);
                setFilters({});
            } catch (e) {
                if (cancelled) return;
                const msg = e instanceof Error ? e.message : String(e);
                setErrorMsg(msg);
                setRows([]);
                setServerTotals(null);
                console.error('[DrilldownDialogAlertasSbcSdiNom] fetch error:', msg);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [props.open, props.companyId, props.startDate, props.endDate]);

    const filtered = useMemo(() => rows.filter(r => _match(r, filters)), [rows, filters]);
    const totalPages = Math.max(1, Math.ceil(filtered.length / DRILLDOWN_ALERTAS_PAGE_SIZE));
    const safePage = Math.min(Math.max(1, page), totalPages);
    const paginated = useMemo(
        () => filtered.slice((safePage - 1) * DRILLDOWN_ALERTAS_PAGE_SIZE, safePage * DRILLDOWN_ALERTAS_PAGE_SIZE),
        [filtered, safePage],
    );
    const filteredTotals = useMemo(() => {
        const base = filtered.reduce((acc, r) => ({
            countSbcNull:  acc.countSbcNull  + (r.alertaSbcNull  ? 1 : 0),
            countSdiNull:  acc.countSdiNull  + (r.alertaSdiNull  ? 1 : 0),
            countSbcZero:  acc.countSbcZero  + (r.alertaSbcZero  ? 1 : 0),
            countSdiZero:  acc.countSdiZero  + (r.alertaSdiZero  ? 1 : 0),
            countDesv:     acc.countDesv     + (r.alertaDesv3pct ? 1 : 0),
            maxPct:        Math.max(acc.maxPct, r.pctDesviacion ?? -1),
            sumPctVals:    r.pctDesviacion != null && Number.isFinite(r.pctDesviacion)
                               ? { s: acc.sumPctVals.s + r.pctDesviacion, n: acc.sumPctVals.n + 1 }
                               : acc.sumPctVals,
            totalFlags:    acc.totalFlags + r.tiposAlertaList.length,
        }), {
            countSbcNull:0, countSdiNull:0, countSbcZero:0, countSdiZero:0, countDesv:0,
            maxPct: -1, sumPctVals: { s:0, n:0 }, totalFlags: 0,
        });
        const empleadosAfect = new Set(filtered.map(r => (r.empleadoRfc || '').trim()).filter(Boolean)).size;
        const comprobantesAfect = new Set(filtered.map(r => (r.receiptId || r.invoiceId || '').trim()).filter(Boolean)).size;
        return {
            ...base,
            maxPct:      Math.max(0, base.maxPct),
            avgPct:      base.sumPctVals.n === 0 ? 0 : Number((base.sumPctVals.s / base.sumPctVals.n).toFixed(2)),
            empleadosAfect,
            comprobantesAfect,
        };
    }, [filtered]);

    function updateFilter<K extends keyof AlertasFilters>(k: K, v: string) {
        setFilters(prev => ({ ...prev, [k]: v || undefined }));
        setPage(1);
    }

    function handleExportCsv() {
        try {
            const headers = [
                'Tipos Alerta','SBC','SDI','% Desviación','RFC Empleado','Nombre Empleado','No. Empleado',
                'CURP','NSS','Departamento','Tipo Nómina','Fecha Pago','Fecha Emisión','Serie','Folio','UUID','Estatus SAT','Link PDF',
            ];
            const lines = [headers.join(',')];
            filtered.forEach(r => {
                const esc = (v: unknown) => {
                    let s = '';
                    switch (typeof v) {
                        case 'string':  s = v; break;
                        case 'number':
                        case 'bigint':
                        case 'boolean': s = String(v); break;
                        default:        s = '';
                    }
                    s = s.replace(/"/g, '""');
                    return /[",\n]/.test(s) ? `"${s}"` : s;
                };
                lines.push([
                    esc(r.tiposAlertaList.map(t => ALERTA_FLAG_META[t].label).join(' | ')),
                    esc(r.salarioBaseCotApor == null ? 'N/D' : fmtMxn(r.salarioBaseCotApor)),
                    esc(r.salarioDiarioIntegrado == null ? 'N/D' : fmtMxn(r.salarioDiarioIntegrado)),
                    esc(r.pctDesviacion == null ? '' : `${fmtNum(r.pctDesviacion, 2)}%`),
                    esc(r.empleadoRfc), esc(r.empleadoNombre), esc(r.empleadoNum),
                    esc(r.curp), esc(r.nss), esc(r.departamento),
                    esc(r.tipoNomina), esc(fmtDateEs(r.fechaPago)), esc(fmtDateEs(r.fechaEmision)),
                    esc(r.serie), esc(r.folio), esc(r.uuid), esc(r.satStatus), esc(r.pdfUrl),
                ].join(','));
            });
            const csv = '\uFEFF' + lines.join('\n');
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const suffix = props.companyRfc ? props.companyRfc : props.companyId;
            a.download = sanitizeDownloadFilename(
                `Reporte_Alertas_SBC_SDI_Nomina_${suffix}_${ts}`,
                'Reporte_Alertas_SBC_SDI_Nomina',
                'csv',
            );
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 2000);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error('[DrilldownDialogAlertasSbcSdiNom] CSV export error:', msg);
        }
    }

    const hayAlertasSeveras = (serverTotals?.countAlertas_SBC_NULL ?? 0) + (serverTotals?.countAlertas_SDI_NULL ?? 0) > 0;
    const highlight = hayAlertasSeveras || (serverTotals?.maxPctDesv ?? 0) >= 10;
    const companyRfcPart = props.companyRfc ? (
        <span className="font-semibold text-foreground">{props.companyRfc}</span>
    ) : (
        <span className="font-mono text-[11px]">{props.companyId}</span>
    );

    return (
        <Dialog open={props.open} onOpenChange={props.onOpenChange}>
            <DialogContent
                className={[
                    '!max-w-[100vw] !w-screen !max-h-screen !h-screen m-0 border-0 rounded-none sm:rounded-none',
                    'inset-0 translate-x-0 translate-y-0 flex flex-col p-4 sm:p-6 gap-4',
                ].join(' ')}
            >
                <DialogHeader className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 shrink-0 pr-8">
                    <div className="space-y-1 min-w-0">
                        <DialogTitle className="text-base sm:text-lg font-semibold flex items-center gap-2">
                            <AlertTriangle className={`h-5 w-5 ${highlight ? 'text-rose-500' : 'text-violet-500'}`} />
                            Reporte · Alertas SBC / SDI · Nómina
                        </DialogTitle>
                        <div className="text-xs sm:text-sm text-muted-foreground space-y-0.5">
                            <div>
                                <strong>Empresa:</strong>{' '}
                                {companyRfcPart}
                                {props.companyDisplayName && (
                                    <>
                                        <span className="mx-1 text-muted-foreground">·</span>
                                        <span className="text-foreground">{props.companyDisplayName}</span>
                                    </>
                                )}
                            </div>
                            <div>
                                <strong>Periodo:</strong>{' '}
                                {fmtDateEs(props.startDate)} — {fmtDateEs(props.endDate)}
                            </div>
                            {serverTotals && (
                                <div className="text-[11px] space-x-2">
                                    <span>
                                        Conteo servidor:{' '}
                                        <strong className={highlight ? 'text-rose-700 font-semibold' : 'font-semibold'}>
                                            {fmtNum(serverTotals.countAlertas)} comprobante(s) con alertas
                                        </strong>
                                        {' · total flags '}{fmtNum(serverTotals.countTotalFlags)}
                                    </span>
                                    <span className="text-rose-700 font-medium">
                                        Nulos (SBC {fmtNum(serverTotals.countAlertas_SBC_NULL)} · SDI {fmtNum(serverTotals.countAlertas_SDI_NULL)})
                                    </span>
                                    <span className="text-amber-700 font-medium">
                                        Ceros (SBC {fmtNum(serverTotals.countAlertas_SBC_ZERO)} · SDI {fmtNum(serverTotals.countAlertas_SDI_ZERO)})
                                    </span>
                                    <span className="text-violet-700 font-medium">
                                        {'Desv>3%'} {fmtNum(serverTotals.countAlertas_DESV_3PCT)}
                                    </span>
                                    <span>
                                        Peak % {fmtNum(serverTotals.maxPctDesv, 2)} · avg {fmtNum(serverTotals.avgPctDesv, 2)}
                                    </span>
                                    <span>
                                        · {fmtNum(serverTotals.countEmpleadosAfectados)} trabajador(es) · {fmtNum(serverTotals.countComprobantesAfectados)} CFDI
                                    </span>
                                </div>
                            )}
                            {errorMsg && (
                                <div className="text-destructive text-[11px] font-medium mt-1">
                                    Error: {errorMsg}
                                </div>
                            )}
                        </div>
                    </div>
                    {!loading && filtered.length > 0 && (
                        <Button type="button" variant="outline" size="sm" onClick={handleExportCsv} className="shrink-0">
                            <Download className="mr-2 h-4 w-4" />
                            Exportar CSV
                        </Button>
                    )}
                </DialogHeader>

                <div className={[
                    'flex-1 min-h-0 border rounded-md overflow-hidden flex flex-col',
                    '[&_div[data-slot=table-container]]:overflow-auto [&_div[data-slot=table-container]]:h-full',
                ].join(' ')}>
                    {renderMainContent(
                        { loading, errorMsg, rows, paginated, filtered },
                        { filters, filteredTotals, updateFilter },
                    )}
                </div>

                {!loading && filtered.length > 0 && (
                    <div className="mt-0 shrink-0 flex items-center justify-between gap-3 text-sm text-muted-foreground">
                        <div className="text-xs">
                            Mostrando{' '}
                            {((safePage - 1) * DRILLDOWN_ALERTAS_PAGE_SIZE) + 1}-
                            {Math.min(safePage * DRILLDOWN_ALERTAS_PAGE_SIZE, filtered.length)}{' '}
                            de {fmtNum(filtered.length)} registros filtrados
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={safePage <= 1}
                                onClick={() => setPage(p => Math.max(1, p - 1))}
                            >
                                Anterior
                            </Button>
                            <span className="text-xs">Página {fmtNum(safePage)} de {fmtNum(totalPages)}</span>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={safePage >= totalPages}
                                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                            >
                                Siguiente
                            </Button>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
