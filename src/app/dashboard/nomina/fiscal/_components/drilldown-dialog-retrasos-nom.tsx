// ============================================================
// DrilldownDialogRetrasosNom.tsx · FASE C KPI#5
// Client Boundary Drilldown KPI #5 "Retrasos Timbrado > 5 d"
//
// Patrón 100% Cancelados/UUIDdup: fullscreen, 13 columnas,
// filtros sticky, pag 200, Totales Σ, CSV BOM, 3 EmptyStates.
//
// Diferencias clave KPI específico:
// · Col 1 Badge color por # días: 6-7 secondary / ≥8 amber outline / ≥10 destructive rose
// · Fila bg-rose-50 / dark:rose-950/20 si diasRetraso >= 10
// · Header totales: maxDiasRetraso (caso peor) · avgDiasRetraso · empleados afectados
// · Title icon Clock12 text-indigo-500 / rose cuando max≥10
// · Filtrado incluye diasRetraso búsqueda numérica
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
    Download, FileWarning, Loader2, Clock12,
} from 'lucide-react';
import { FiscalNomEmptyState } from './fiscal-nomina-shared';
import {
    fmtMxn, fmtNum, fmtDateEs,
} from '@/lib/fiscal-nomina-formatters';
import { sanitizeDownloadFilename } from '@/lib/dashboard-fiscal-route-utils';

export const DRILLDOWN_RETRASOS_PAGE_SIZE = 200;

export type DrilldownRetrasoRow = {
    receiptId: string | null;
    invoiceId: string;
    uuid: string;
    diasRetraso: number;
    fechaEmision: string | null;
    fechaPago: string | null;
    tipoNomina: string;
    serie: string | null;
    folio: string | null;
    empleadoRfc: string;
    empleadoNombre: string;
    empleadoNum: string | null;
    departamento: string | null;
    totalPercepciones: number;
    totalDeducciones: number;
    totalOtrosPagos: number;
    totalNeto: number;
    satStatus: string;
    pdfUrl: string | null;
};

export type DrilldownRetrasosResponse = {
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
        countRetrasos: number;
        maxDiasRetraso: number;
        avgDiasRetraso: number;
        countEmpleadosAfectados: number;
        sumaPercepcionesMxN: number;
        sumaDeduccionesMxN: number;
        sumaOtrosPagosMxN: number;
        sumaNetoMxN: number;
    };
    data?: DrilldownRetrasoRow[];
    error?: string;
    correlationId?: string;
    helpText?: string;
};

export type RetrasoDrilldownFilters = Partial<Record<
    | 'diasRetraso'
    | 'fechaEmision'
    | 'fechaPago'
    | 'tipoNomina'
    | 'uuid'
    | 'folio'
    | 'empleadoRfc'
    | 'empleadoNombre'
    | 'empleadoNum'
    | 'departamento'
    | 'totalPercepciones'
    | 'totalDeducciones'
    | 'totalNeto'
    | 'satStatus',
    string
>>;

function _s(v: unknown): string {
    let s = '';
    switch (typeof v) {
        case 'string':  s = v; break;
        case 'number':
        case 'bigint':
        case 'boolean': s = String(v); break;
    }
    return s.normalize('NFD').toLowerCase();
}

function _match(row: DrilldownRetrasoRow, f: RetrasoDrilldownFilters): boolean {
    const checks: Array<[unknown, string | undefined]> = [
        [String(row.diasRetraso), f.diasRetraso],
        [fmtDateEs(row.fechaEmision) ?? '', f.fechaEmision],
        [fmtDateEs(row.fechaPago) ?? '', f.fechaPago],
        [row.tipoNomina, f.tipoNomina],
        [row.uuid, f.uuid],
        [[row.serie, row.folio].filter(Boolean).join('/'), f.folio],
        [row.empleadoRfc, f.empleadoRfc],
        [row.empleadoNombre, f.empleadoNombre],
        [row.empleadoNum, f.empleadoNum],
        [row.departamento, f.departamento],
        [fmtMxn(row.totalPercepciones), f.totalPercepciones],
        [fmtMxn(row.totalDeducciones), f.totalDeducciones],
        [fmtMxn(row.totalNeto), f.totalNeto],
        [row.satStatus, f.satStatus],
    ];
    for (const [val, q] of checks) {
        if (!q) continue;
        if (!_s(val).includes(_s(q))) return false;
    }
    return true;
}

function variantBadgeDias(d: number): 'secondary' | 'outline' | 'destructive' {
    if (d >= 10) return 'destructive';
    if (d >= 8)  return 'outline';
    return 'secondary';
}

type DrilldownDialogRetrasosNomProps = Readonly<{
    open: boolean;
    onOpenChange: (open: boolean) => void;
    companyId: string;
    companyRfc?: string | null;
    companyDisplayName?: string | null;
    startDate: string;
    endDate: string;
}>;

export function DrilldownDialogRetrasosNom(props: DrilldownDialogRetrasosNomProps) {
    const [loading, setLoading] = useState(false);
    const [rows, setRows] = useState<DrilldownRetrasoRow[]>([]);
    const [serverTotals, setServerTotals] = useState<DrilldownRetrasosResponse['totals'] | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [filters, setFilters] = useState<RetrasoDrilldownFilters>({});
    const [page, setPage] = useState(1);

    useEffect(() => {
        if (!props.open) return;
        let cancelled = false;
        (async () => {
            setLoading(true);
            setErrorMsg(null);
            try {
                const url = new URL('/api/dashboard/nomina/fiscal/drilldown/retrasos_timbrado', window.location.origin);
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
                        const j = await res.json() as DrilldownRetrasosResponse;
                        throw new Error(j.error || `HTTP ${res.status}`);
                    } catch (error_) {
                        if (error_ instanceof Error && error_.message.startsWith('Error: ')) throw error_;
                        throw new Error(`HTTP ${res.status}`);
                    }
                }
                const json = await res.json() as DrilldownRetrasosResponse;
                if (!json.ok || !Array.isArray(json.data)) {
                    throw new Error(json.error || 'Respuesta inválida del servidor');
                }
                if (cancelled) return;
                setRows(json.data);
                setServerTotals(json.totals ?? null);
                setPage(1);
                setFilters({});
            } catch (error_) {
                if (cancelled) return;
                const msg = error_ instanceof Error ? error_.message : String(error_);
                setErrorMsg(msg);
                setRows([]);
                setServerTotals(null);
                console.error('[DrilldownDialogRetrasosNom] fetch error:', msg);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [props.open, props.companyId, props.startDate, props.endDate]);

    const filtered = useMemo(() => rows.filter(r => _match(r, filters)), [rows, filters]);
    const totalPages = Math.max(1, Math.ceil(filtered.length / DRILLDOWN_RETRASOS_PAGE_SIZE));
    const safePage = Math.min(Math.max(1, page), totalPages);
    const paginated = useMemo(
        () => filtered.slice((safePage - 1) * DRILLDOWN_RETRASOS_PAGE_SIZE, safePage * DRILLDOWN_RETRASOS_PAGE_SIZE),
        [filtered, safePage],
    );
    const filteredTotals = useMemo(() => {
        const base = filtered.reduce((acc, r) => ({
            percepciones: acc.percepciones + r.totalPercepciones,
            deducciones:  acc.deducciones  + r.totalDeducciones,
            otros:        acc.otros        + r.totalOtrosPagos,
            neto:         acc.neto         + r.totalNeto,
            maxDias:      Math.max(acc.maxDias, r.diasRetraso),
            sumDias:      acc.sumDias + r.diasRetraso,
        }), { percepciones:0, deducciones:0, otros:0, neto:0, maxDias:0, sumDias:0 });
        const empleadosDistinct = new Set(filtered.map(r => (r.empleadoRfc || '').trim()).filter(Boolean)).size;
        return {
            ...base,
            avgDias: filtered.length === 0 ? 0 : Number((base.sumDias / filtered.length).toFixed(2)),
            empleadosAfectados: empleadosDistinct,
        };
    }, [filtered]);

    function updateFilter<K extends keyof RetrasoDrilldownFilters>(k: K, v: string) {
        setFilters(prev => ({ ...prev, [k]: v || undefined }));
        setPage(1);
    }

    function handleExportCsv() {
        try {
            const headers = [
                '#Días Retraso','Fecha Emisión CFDI','Fecha Pago Nómina','Tipo Nómina','UUID','Serie','Folio','Estatus SAT',
                'RFC Empleado','Nombre Empleado','No. Empleado','Departamento',
                'Percepciones','Deducciones','Otros Pagos','Total Neto','Link PDF',
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
                    }
                    s = s.replace(/"/g, '""');
                    return /[",\n]/.test(s) ? `"${s}"` : s;
                };
                lines.push([
                    esc(r.diasRetraso),
                    esc(fmtDateEs(r.fechaEmision)),
                    esc(fmtDateEs(r.fechaPago)),
                    esc(r.tipoNomina),
                    esc(r.uuid),
                    esc(r.serie),
                    esc(r.folio),
                    esc(r.satStatus),
                    esc(r.empleadoRfc),
                    esc(r.empleadoNombre),
                    esc(r.empleadoNum),
                    esc(r.departamento),
                    esc(fmtMxn(r.totalPercepciones)),
                    esc(fmtMxn(r.totalDeducciones)),
                    esc(fmtMxn(r.totalOtrosPagos)),
                    esc(fmtMxn(r.totalNeto)),
                    esc(r.pdfUrl),
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
                `Reporte_Retrasos_Timbrado_Nomina_${suffix}_${ts}`,
                'Reporte_Retrasos_Timbrado_Nomina',
                'csv',
            );
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 2000);
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            console.error('[DrilldownDialogRetrasosNom] CSV export error:', msg);
        }
    }

    type _RetrasosUIState = Readonly<{
        loading: boolean;
        errorMsg: string | null;
        rows: DrilldownRetrasoRow[];
        paginated: DrilldownRetrasoRow[];
        filtered: DrilldownRetrasoRow[];
    }>;
    type _RetrasosUIControls = Readonly<{
        filters: RetrasoDrilldownFilters;
        filteredTotals: typeof filteredTotals;
        updateFilter: <K extends keyof RetrasoDrilldownFilters>(k: K, v: string) => void;
    }>;

    function _retrasRenderLoading() {
        return (
            <div className="flex-1 flex justify-center items-center gap-2 text-muted-foreground p-8">
                <Loader2 className="h-6 w-6 animate-spin" />
                <span className="text-sm">Cargando reporte de retrasos de timbrado...</span>
            </div>
        );
    }
    function _retrasRenderErrorState(errorMsg: string) {
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
    function _retrasRenderEmptyState() {
        return (
            <div className="flex-1 flex justify-center items-center p-8">
                <FiscalNomEmptyState
                    icon={<Clock12 className="h-10 w-10 text-indigo-500" />}
                    title="Sin retrasos de timbrado en el periodo"
                    subtitle="Todos los CFDIs de nómina fueron emitidos dentro de los 5 días naturales posteriores a la fecha de pago."
                    hint="Cambia el rango de fechas para explorar lotes históricos."
                />
            </div>
        );
    }
    function _retrasRenderTable(ui: _RetrasosUIState, c: _RetrasosUIControls) {
        const { paginated, filtered } = ui;
        const { filters, filteredTotals, updateFilter } = c;
        return (
            <Table className="w-full min-w-max">
                <TableHeader className="sticky top-0 bg-muted z-10 shadow-sm">
                    <TableRow>
                        <TableHead className="w-[110px] text-center">#Días Retraso</TableHead>
                        <TableHead className="w-[120px]">Fecha Emisión</TableHead>
                        <TableHead className="w-[120px]">Fecha Pago</TableHead>
                        <TableHead className="w-[80px]">Tipo</TableHead>
                        <TableHead className="w-[300px]">UUID</TableHead>
                        <TableHead className="w-[120px]">Folio/Serie</TableHead>
                        <TableHead className="w-[130px]">RFC Empleado</TableHead>
                        <TableHead className="max-w-[420px]">Nombre Empleado</TableHead>
                        <TableHead className="w-[90px]">No. Emp.</TableHead>
                        <TableHead className="w-[160px]">Departamento</TableHead>
                        <TableHead className="w-[110px]">Estatus SAT</TableHead>
                        <TableHead className="text-right w-[150px]">Percepciones</TableHead>
                        <TableHead className="text-right w-[150px]">Deducciones</TableHead>
                        <TableHead className="text-right w-[150px]">Total Neto</TableHead>
                    </TableRow>
                    <TableRow className="bg-muted/50 border-b shadow-sm">
                        <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background text-center" value={filters.diasRetraso || ''} onChange={e => updateFilter('diasRetraso', e.target.value)}/></TableHead>
                        <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background" value={filters.fechaEmision || ''} onChange={e => updateFilter('fechaEmision', e.target.value)}/></TableHead>
                        <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background" value={filters.fechaPago || ''} onChange={e => updateFilter('fechaPago', e.target.value)}/></TableHead>
                        <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background" value={filters.tipoNomina || ''} onChange={e => updateFilter('tipoNomina', e.target.value)}/></TableHead>
                        <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar UUID..." className="h-7 text-xs bg-background font-mono" value={filters.uuid || ''} onChange={e => updateFilter('uuid', e.target.value)}/></TableHead>
                        <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background" value={filters.folio || ''} onChange={e => updateFilter('folio', e.target.value)}/></TableHead>
                        <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background font-mono" value={filters.empleadoRfc || ''} onChange={e => updateFilter('empleadoRfc', e.target.value)}/></TableHead>
                        <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background" value={filters.empleadoNombre || ''} onChange={e => updateFilter('empleadoNombre', e.target.value)}/></TableHead>
                        <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background font-mono" value={filters.empleadoNum || ''} onChange={e => updateFilter('empleadoNum', e.target.value)}/></TableHead>
                        <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background" value={filters.departamento || ''} onChange={e => updateFilter('departamento', e.target.value)}/></TableHead>
                        <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background" value={filters.satStatus || ''} onChange={e => updateFilter('satStatus', e.target.value)}/></TableHead>
                        <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background text-right" value={filters.totalPercepciones || ''} onChange={e => updateFilter('totalPercepciones', e.target.value)}/></TableHead>
                        <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background text-right" value={filters.totalDeducciones || ''} onChange={e => updateFilter('totalDeducciones', e.target.value)}/></TableHead>
                        <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background text-right" value={filters.totalNeto || ''} onChange={e => updateFilter('totalNeto', e.target.value)}/></TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {paginated.map((r, i) => {
                        const highlightFila = r.diasRetraso >= 10;
                        return (
                            <TableRow
                                key={`${r.receiptId || r.invoiceId}-${i}`}
                                className={highlightFila ? 'bg-rose-50 hover:bg-rose-50 dark:bg-rose-950/20' : undefined}
                            >
                                <TableCell className="whitespace-nowrap text-center">
                                    <Badge variant={variantBadgeDias(r.diasRetraso)} className="font-bold text-xs px-2 py-0.5">
                                        {fmtNum(r.diasRetraso, 0)} d
                                    </Badge>
                                </TableCell>
                                <TableCell className="whitespace-nowrap">{fmtDateEs(r.fechaEmision)}</TableCell>
                                <TableCell className="whitespace-nowrap">{fmtDateEs(r.fechaPago)}</TableCell>
                                <TableCell className="whitespace-nowrap font-semibold text-[11px]">{r.tipoNomina}</TableCell>
                                <TableCell className="whitespace-nowrap text-[11px] font-mono truncate max-w-[280px]" title={r.uuid}>
                                    {r.uuid}
                                    {r.pdfUrl ? (
                                        <>
                                            {' · '}
                                            <a className="text-blue-600 hover:underline" target="_blank" rel="noreferrer noopener" href={r.pdfUrl}>PDF↗</a>
                                        </>
                                    ) : null}
                                </TableCell>
                                <TableCell className="whitespace-nowrap font-medium text-[12px]">
                                    {[r.serie, r.folio].filter(Boolean).join(' / ') || '-'}
                                </TableCell>
                                <TableCell className="whitespace-nowrap font-mono text-[11px]">{r.empleadoRfc}</TableCell>
                                <TableCell className="max-w-[400px] truncate" title={r.empleadoNombre}>{r.empleadoNombre}</TableCell>
                                <TableCell className="whitespace-nowrap font-mono text-[11px]">{r.empleadoNum || '-'}</TableCell>
                                <TableCell className="whitespace-nowrap text-[12px]">{r.departamento || '-'}</TableCell>
                                <TableCell className="whitespace-nowrap text-[11px]">{r.satStatus}</TableCell>
                                <TableCell className="whitespace-nowrap text-right font-medium">{fmtMxn(r.totalPercepciones)}</TableCell>
                                <TableCell className="whitespace-nowrap text-right font-medium">{fmtMxn(r.totalDeducciones)}</TableCell>
                                <TableCell className="whitespace-nowrap text-right font-bold">{fmtMxn(r.totalNeto)}</TableCell>
                            </TableRow>
                        );
                    })}
                    {filtered.length === 0 && (
                        <TableRow>
                            <TableCell colSpan={14} className="h-24 text-center text-muted-foreground text-sm">
                                No se encontraron resultados para tu búsqueda.
                            </TableCell>
                        </TableRow>
                    )}
                    {filtered.length > 0 && (
                        <TableRow className="bg-muted/50 font-bold hover:bg-muted/50">
                            <TableCell colSpan={11} className="text-right text-xs">
                                Total Filtrado · {fmtNum(filtered.length)} recibo(s) ·{' '}
                                Peor caso {fmtNum(filteredTotals.maxDias)} d ·{' '}
                                Promedio {fmtNum(filteredTotals.avgDias, 2)} d ·{' '}
                                {fmtNum(filteredTotals.empleadosAfectados)} trabajador(es)
                            </TableCell>
                            <TableCell className="text-right">{fmtMxn(filteredTotals.percepciones)}</TableCell>
                            <TableCell className="text-right">{fmtMxn(filteredTotals.deducciones)}</TableCell>
                            <TableCell className="text-right">{fmtMxn(filteredTotals.neto)}</TableCell>
                        </TableRow>
                    )}
                </TableBody>
            </Table>
        );
    }

    function renderMainContent(
        ui: _RetrasosUIState,
        c: _RetrasosUIControls,
    ) {
        if (ui.loading) return _retrasRenderLoading();
        if (ui.errorMsg) return _retrasRenderErrorState(ui.errorMsg);
        if (ui.rows.length === 0) return _retrasRenderEmptyState();
        return _retrasRenderTable(ui, c);
    }

    const highlight = (serverTotals?.maxDiasRetraso ?? 0) >= 10;
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
                            <Clock12 className={`h-5 w-5 ${highlight ? 'text-rose-500' : 'text-indigo-500'}`} />
                            Reporte · Retrasos de Timbrado Nómina
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
                                <div className="text-[11px]">
                                    Conteo servidor:{' '}
                                    <strong className={highlight ? 'text-rose-700 font-semibold' : 'font-semibold'}>
                                        {fmtNum(serverTotals.countRetrasos)} recibos fuera de plazo
                                    </strong>
                                    {' · Peor caso '}
                                    <strong className="text-rose-700 font-semibold">
                                        {fmtNum(serverTotals.maxDiasRetraso)} días
                                    </strong>
                                    {' · Promedio '}{fmtNum(serverTotals.avgDiasRetraso, 2)} días
                                    {' · '}{fmtNum(serverTotals.countEmpleadosAfectados)} trabajadores afectados
                                    {' · Σ Percepciones '}{fmtMxn(serverTotals.sumaPercepcionesMxN)}
                                    {' · Σ Deducciones '}{fmtMxn(serverTotals.sumaDeduccionesMxN)}
                                    {' · Σ Neto '}{fmtMxn(serverTotals.sumaNetoMxN)}
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
                            {((safePage - 1) * DRILLDOWN_RETRASOS_PAGE_SIZE) + 1}-
                            {Math.min(safePage * DRILLDOWN_RETRASOS_PAGE_SIZE, filtered.length)}{' '}
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
