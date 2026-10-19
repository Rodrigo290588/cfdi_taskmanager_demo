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
    Download, FileWarning, Loader2, Users2,
} from 'lucide-react';
import { FiscalNomEmptyState } from './fiscal-nomina-shared';
import {
    fmtMxn, fmtNum, fmtDateEs,
} from '@/lib/fiscal-nomina-formatters';
import { sanitizeDownloadFilename } from '@/lib/dashboard-fiscal-route-utils';

export const CUOTAS_TERCEROS_DRILLDOWN_PAGE_SIZE = 200;

export const CUOTA_TIPO_SAT = ['001', '006', '007', '010'] as const;
export type CuotaTipoSat = typeof CUOTA_TIPO_SAT[number];

export const CUOTA_TIPO_LABEL: Record<CuotaTipoSat, string> = {
    '001': 'Sindicato · SAT 001',
    '006': 'FONACOT · SAT 006',
    '007': 'Pensión Alimenticia · SAT 007',
    '010': 'INFONAVIT · SAT 010',
} as const;

export const CUOTA_TIPO_BADGE_CLASS: Record<CuotaTipoSat, string> = {
    '001': 'bg-amber-500/10 text-amber-800 border-transparent',
    '006': 'bg-violet-500/10 text-violet-800 border-transparent',
    '007': 'bg-rose-500/10 text-rose-800 border-transparent',
    '010': 'bg-indigo-500/10 text-indigo-800 border-transparent',
} as const;

function _isCuotaTipoSat(v: unknown): v is CuotaTipoSat {
    return typeof v === 'string' && (CUOTA_TIPO_SAT as readonly string[]).includes(v);
}

export type CuotasTercerosDrilldownRow = {
    deduccionId: string;
    tipoDeduccion: string;
    categoriaCuota: string;
    claveDeduccion: string | null;
    conceptoDeduccion: string | null;
    importeCuotaMxn: number;
    invoiceId: string | null;
    receiptId: string | null;
    fechaEmision: string | null;
    fechaPago: string | null;
    tipoNomina: string | null;
    uuid: string | null;
    serie: string | null;
    folio: string | null;
    empleadoRfc: string | null;
    empleadoNombre: string | null;
    empleadoCurp: string | null;
    empleadoNum: string | null;
    departamento: string | null;
    totalPercepciones: number;
    totalDeducciones: number;
    totalOtrosPagos: number;
    totalNeto: number;
    satStatus: string;
    pdfUrl: string | null;
};

export type CuotasTercerosDrilldownResponse = {
    ok: boolean;
    generatedAt?: string;
    scope?: {
        companyId: string;
        filters: { startDate: string; endDate: string };
        tiposDeduccionSat?: readonly string[];
        descripcionFiltro?: string;
    };
    totals?: {
        countCuotasTerceros: number;
        sumaImporteCuotaMxn: number;
        sumaNetoCfdiMxn: number;
        countCfdAfectados: number;
    };
    data?: CuotasTercerosDrilldownRow[];
    pageInfo?: {
        pageSize: number;
        returned: number;
        hasNextPage: boolean;
        nextCursor: string | null;
    };
    error?: string;
    correlationId?: string;
    helpText?: string;
};

export type CuotasTercerosDrilldownFilters = Partial<Record<
    | 'deduccionId'
    | 'tipoDeduccion'
    | 'categoriaCuota'
    | 'claveDeduccion'
    | 'conceptoDeduccion'
    | 'importeCuotaMxn'
    | 'fechaEmision'
    | 'fechaPago'
    | 'tipoNomina'
    | 'uuid'
    | 'serie'
    | 'folio'
    | 'empleadoRfc'
    | 'empleadoNombre'
    | 'empleadoCurp'
    | 'empleadoNum'
    | 'departamento'
    | 'totalPercepciones'
    | 'totalDeducciones'
    | 'totalOtrosPagos'
    | 'totalNeto'
    | 'satStatus'
    | 'fTipoCuotaSat',
    string
>>;

function _ctCoerceToString(v: unknown): string {
    switch (typeof v) {
        case 'string':  return v;
        case 'number':
        case 'bigint':
        case 'boolean': return String(v);
        default:        return '';
    }
}
function _ctNorm(v: unknown): string {
    return _ctCoerceToString(v).normalize('NFD').toLowerCase();
}

function _ctMatch(row: CuotasTercerosDrilldownRow, f: CuotasTercerosDrilldownFilters): boolean {
    if (f.fTipoCuotaSat && f.fTipoCuotaSat !== 'all') {
        if (row.tipoDeduccion !== f.fTipoCuotaSat) return false;
    }
    const checks: Array<[unknown, string | undefined]> = [
        [row.deduccionId,                       f.deduccionId],
        [row.tipoDeduccion,                     f.tipoDeduccion],
        [row.categoriaCuota,                    f.categoriaCuota],
        [row.claveDeduccion,                    f.claveDeduccion],
        [row.conceptoDeduccion,                 f.conceptoDeduccion],
        [fmtMxn(row.importeCuotaMxn),           f.importeCuotaMxn],
        [fmtDateEs(row.fechaEmision) ?? '',     f.fechaEmision],
        [fmtDateEs(row.fechaPago)     ?? '',     f.fechaPago],
        [row.tipoNomina,                         f.tipoNomina],
        [row.uuid,                               f.uuid],
        [row.serie,                              f.serie],
        [row.folio,                              f.folio],
        [row.empleadoRfc,                        f.empleadoRfc],
        [row.empleadoNombre,                     f.empleadoNombre],
        [row.empleadoCurp,                       f.empleadoCurp],
        [row.empleadoNum,                        f.empleadoNum],
        [row.departamento,                       f.departamento],
        [fmtMxn(row.totalPercepciones),          f.totalPercepciones],
        [fmtMxn(row.totalDeducciones),           f.totalDeducciones],
        [fmtMxn(row.totalOtrosPagos),            f.totalOtrosPagos],
        [fmtMxn(row.totalNeto),                  f.totalNeto],
        [row.satStatus,                          f.satStatus],
    ];
    for (const [val, q] of checks) {
        if (!q) continue;
        if (!_ctNorm(val).includes(_ctNorm(q))) return false;
    }
    return true;
}

export type DrilldownDialogCuotasTercerosNomProps = Readonly<{
    open: boolean;
    onOpenChange: (open: boolean) => void;
    companyId: string;
    companyRfc: string | null;
    companyDisplayName: string | null;
    startDate: string;
    endDate: string;
}>;

export function DrilldownDialogCuotasTercerosNom(props: DrilldownDialogCuotasTercerosNomProps) {
    const [loading, setLoading] = useState(false);
    const [rows, setRows] = useState<CuotasTercerosDrilldownRow[]>([]);
    const [serverTotals, setServerTotals] = useState<CuotasTercerosDrilldownResponse['totals'] | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [filters, setFilters] = useState<CuotasTercerosDrilldownFilters>({});
    const [page, setPage] = useState(1);

    useEffect(() => {
        if (!props.open) return;
        let cancelled = false;
        (async () => {
            setLoading(true);
            setErrorMsg(null);
            try {
                const url = new URL('/api/dashboard/nomina/fiscal/drilldown/cuotas_terceros', window.location.origin);
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
                        const j = await res.json() as CuotasTercerosDrilldownResponse;
                        throw new Error(j.error || `HTTP ${res.status}`);
                    } catch (error_) {
                        if (error_ instanceof Error && error_.message.startsWith('Error: ')) throw error_;
                        throw new Error(`HTTP ${res.status}`);
                    }
                }
                const json = await res.json() as CuotasTercerosDrilldownResponse;
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
                console.error('[DrilldownDialogCuotasTercerosNom] fetch error:', msg);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [props.open, props.companyId, props.startDate, props.endDate]);

    const filtered = useMemo(() => rows.filter(r => _ctMatch(r, filters)), [rows, filters]);
    const totalPages = Math.max(1, Math.ceil(filtered.length / CUOTAS_TERCEROS_DRILLDOWN_PAGE_SIZE));
    const safePage = Math.min(Math.max(1, page), totalPages);
    const paginated = useMemo(
        () => filtered.slice((safePage - 1) * CUOTAS_TERCEROS_DRILLDOWN_PAGE_SIZE, safePage * CUOTAS_TERCEROS_DRILLDOWN_PAGE_SIZE),
        [filtered, safePage],
    );
    const filteredTotals = useMemo(() => filtered.reduce((acc, r) => ({
        importeCuota:  acc.importeCuota  + r.importeCuotaMxn,
        percepciones:  acc.percepciones  + r.totalPercepciones,
        deducciones:   acc.deducciones   + r.totalDeducciones,
        otros:         acc.otros         + r.totalOtrosPagos,
        neto:          acc.neto          + r.totalNeto,
    }), { importeCuota:0, percepciones:0, deducciones:0, otros:0, neto:0 }), [filtered]);

    const subtotalesPorCategoria = useMemo(() => {
        const acc: Record<string, number> = { '001': 0, '006': 0, '007': 0, '010': 0 };
        for (const r of filtered) {
            const key = _isCuotaTipoSat(r.tipoDeduccion) ? r.tipoDeduccion : null;
            if (key) acc[key] += r.importeCuotaMxn;
        }
        return acc;
    }, [filtered]);

    function updateFilter<K extends keyof CuotasTercerosDrilldownFilters>(k: K, v: string) {
        setFilters(prev => ({ ...prev, [k]: v || undefined }));
        setPage(1);
    }

    function handleExportCsv() {
        try {
            const headers = [
                'Tipo Deducción','Categoría Cuota','Clave Deducción','Concepto Deducción','Importe Cuota MXN',
                'Fecha Emisión','Fecha Pago','Tipo Nómina','UUID','Serie','Folio',
                'RFC Empleado','Nombre Empleado','CURP','No. Empleado','Departamento',
                'Percepciones','Deducciones','Otros Pagos','Total Neto','Estatus SAT','Link PDF',
            ];
            const lines = [headers.join(',')];
            filtered.forEach(r => {
                const esc = (v: unknown) => {
                    let s = _ctCoerceToString(v);
                    s = s.replaceAll('"', '""');
                    return /[",\n]/.test(s) ? `"${s}"` : s;
                };
                lines.push([
                    esc(r.tipoDeduccion),
                    esc(r.categoriaCuota),
                    esc(r.claveDeduccion),
                    esc(r.conceptoDeduccion),
                    esc(fmtMxn(r.importeCuotaMxn)),
                    esc(fmtDateEs(r.fechaEmision)),
                    esc(fmtDateEs(r.fechaPago)),
                    esc(r.tipoNomina),
                    esc(r.uuid),
                    esc(r.serie),
                    esc(r.folio),
                    esc(r.empleadoRfc),
                    esc(r.empleadoNombre),
                    esc(r.empleadoCurp),
                    esc(r.empleadoNum),
                    esc(r.departamento),
                    esc(fmtMxn(r.totalPercepciones)),
                    esc(fmtMxn(r.totalDeducciones)),
                    esc(fmtMxn(r.totalOtrosPagos)),
                    esc(fmtMxn(r.totalNeto)),
                    esc(r.satStatus),
                    esc(r.pdfUrl),
                ].join(','));
            });
            const csv = '\uFEFF' + lines.join('\n');
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const rfc = (props.companyRfc ?? props.companyId).replace(/[^A-Z0-9_-]/gi, '_');
            a.download = sanitizeDownloadFilename(`Cuotas_Terceros_Nomina_${rfc}_${ts}`, 'Cuotas_Terceros_Nomina', 'csv');
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 2000);
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            console.error('[DrilldownDialogCuotasTercerosNom] CSV export error:', msg);
        }
    }

    type _CtUIState = Readonly<{
        loading: boolean;
        errorMsg: string | null;
        rows: CuotasTercerosDrilldownRow[];
        paginated: CuotasTercerosDrilldownRow[];
        filtered: CuotasTercerosDrilldownRow[];
    }>;
    type _CtUIControls = Readonly<{
        filters: CuotasTercerosDrilldownFilters;
        filteredTotals: typeof filteredTotals;
        subtotalesPorCategoria: Record<string, number>;
        updateFilter: <K extends keyof CuotasTercerosDrilldownFilters>(k: K, v: string) => void;
    }>;

    function _ctRenderLoading() {
        return (
            <div className="flex-1 flex justify-center items-center gap-2 text-muted-foreground p-8">
                <Loader2 className="h-6 w-6 animate-spin" />
                <span className="text-sm">Cargando cuotas a terceros de nómina...</span>
            </div>
        );
    }
    function _ctRenderErrorState(err: string) {
        return (
            <div className="flex-1 flex justify-center items-center p-8">
                <FiscalNomEmptyState
                    icon={<FileWarning className="h-10 w-10" />}
                    title="No se pudo cargar el reporte de cuotas a terceros"
                    subtitle={err}
                    hint="Revisa tu conexión o notifica a soporte con el código de correlación si aparece."
                />
            </div>
        );
    }
    function _ctRenderEmptyState() {
        return (
            <div className="flex-1 flex justify-center items-center p-8">
                <FiscalNomEmptyState
                    icon={<Users2 className="h-10 w-10" />}
                    title="Sin cuotas a terceros en el periodo"
                    subtitle="No se detectaron deducciones SAT tipos 001 (Sindicato), 006 (FONACOT), 007 (Pensión) o 010 (INFONAVIT) para el rango de fechas y empresa seleccionados."
                    hint="Cambia el rango de fechas o valida que las deducciones de nómina estén timbradas correctamente."
                />
            </div>
        );
    }
    function _ctRenderTable(ui: _CtUIState, c: _CtUIControls) {
        const { paginated, filtered } = ui;
        const { filters, filteredTotals, updateFilter } = c;
        return (
            <Table className="w-full min-w-max">
                <TableHeader className="sticky top-0 bg-muted z-10 shadow-sm">
                    <TableRow>
                        <TableHead className="w-[90px] whitespace-nowrap">Tipo SAT</TableHead>
                        <TableHead className="w-[210px] whitespace-nowrap">Categoría Cuota</TableHead>
                        <TableHead className="w-[120px] whitespace-nowrap">Clave SAT</TableHead>
                        <TableHead className="min-w-[260px]">Concepto Deducción</TableHead>
                        <TableHead className="text-right w-[150px] whitespace-nowrap">Importe Cuota MXN</TableHead>
                        <TableHead className="w-[120px] whitespace-nowrap">Fecha Emisión</TableHead>
                        <TableHead className="w-[120px] whitespace-nowrap">Fecha Pago</TableHead>
                        <TableHead className="w-[90px] whitespace-nowrap">Tipo Nóm</TableHead>
                        <TableHead className="w-[300px]">UUID CFDI</TableHead>
                        <TableHead className="w-[80px] whitespace-nowrap">Serie</TableHead>
                        <TableHead className="w-[120px] whitespace-nowrap">Folio</TableHead>
                        <TableHead className="w-[130px] whitespace-nowrap">RFC Emp.</TableHead>
                        <TableHead className="max-w-[360px]">Nombre Empleado</TableHead>
                        <TableHead className="w-[140px] whitespace-nowrap">CURP</TableHead>
                        <TableHead className="w-[90px] whitespace-nowrap">No. Emp.</TableHead>
                        <TableHead className="w-[160px] whitespace-nowrap">Departamento</TableHead>
                        <TableHead className="text-right w-[140px] whitespace-nowrap">Percep.</TableHead>
                        <TableHead className="text-right w-[140px] whitespace-nowrap">Deduc.</TableHead>
                        <TableHead className="text-right w-[140px] whitespace-nowrap">Otros Pag.</TableHead>
                        <TableHead className="text-right w-[140px] whitespace-nowrap">Total Neto</TableHead>
                        <TableHead className="w-[110px] whitespace-nowrap">Sat Status</TableHead>
                    </TableRow>
                    <TableRow className="bg-muted/50 border-b shadow-sm">
                        <TableHead className="p-1 px-2 align-top"><Input placeholder="001..." className="h-7 text-xs bg-background" value={filters.tipoDeduccion || ''} onChange={e => updateFilter('tipoDeduccion', e.target.value)}/></TableHead>
                        <TableHead className="p-1 px-2 align-top">
                            <select
                                className="h-7 text-xs bg-background border border-input rounded px-1 w-full"
                                value={filters.fTipoCuotaSat || 'all'}
                                onChange={e => updateFilter('fTipoCuotaSat', e.target.value)}
                                aria-label="Filtrar por categoría de cuota SAT"
                            >
                                <option value="all">Todas las categorías</option>
                                <option value="001">{CUOTA_TIPO_LABEL['001']}</option>
                                <option value="006">{CUOTA_TIPO_LABEL['006']}</option>
                                <option value="007">{CUOTA_TIPO_LABEL['007']}</option>
                                <option value="010">{CUOTA_TIPO_LABEL['010']}</option>
                            </select>
                        </TableHead>
                        <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background" value={filters.claveDeduccion || ''} onChange={e => updateFilter('claveDeduccion', e.target.value)}/></TableHead>
                        <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar concepto..." className="h-7 text-xs bg-background" value={filters.conceptoDeduccion || ''} onChange={e => updateFilter('conceptoDeduccion', e.target.value)}/></TableHead>
                        <TableHead className="p-1 px-2 align-top"><Input placeholder="$0.00..." className="h-7 text-xs bg-background text-right" value={filters.importeCuotaMxn || ''} onChange={e => updateFilter('importeCuotaMxn', e.target.value)}/></TableHead>
                        <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background" value={filters.fechaEmision || ''} onChange={e => updateFilter('fechaEmision', e.target.value)}/></TableHead>
                        <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background" value={filters.fechaPago || ''} onChange={e => updateFilter('fechaPago', e.target.value)}/></TableHead>
                        <TableHead className="p-1 px-2 align-top"><Input placeholder="O..." className="h-7 text-xs bg-background" value={filters.tipoNomina || ''} onChange={e => updateFilter('tipoNomina', e.target.value)}/></TableHead>
                        <TableHead className="p-1 px-2 align-top"><Input placeholder="UUID..." className="h-7 text-xs bg-background font-mono" value={filters.uuid || ''} onChange={e => updateFilter('uuid', e.target.value)}/></TableHead>
                        <TableHead className="p-1 px-2 align-top"><Input placeholder="..." className="h-7 text-xs bg-background" value={filters.serie || ''} onChange={e => updateFilter('serie', e.target.value)}/></TableHead>
                        <TableHead className="p-1 px-2 align-top"><Input placeholder="Folio..." className="h-7 text-xs bg-background" value={filters.folio || ''} onChange={e => updateFilter('folio', e.target.value)}/></TableHead>
                        <TableHead className="p-1 px-2 align-top"><Input placeholder="RFC..." className="h-7 text-xs bg-background font-mono" value={filters.empleadoRfc || ''} onChange={e => updateFilter('empleadoRfc', e.target.value)}/></TableHead>
                        <TableHead className="p-1 px-2 align-top"><Input placeholder="Empleado..." className="h-7 text-xs bg-background" value={filters.empleadoNombre || ''} onChange={e => updateFilter('empleadoNombre', e.target.value)}/></TableHead>
                        <TableHead className="p-1 px-2 align-top"><Input placeholder="CURP..." className="h-7 text-xs bg-background font-mono" value={filters.empleadoCurp || ''} onChange={e => updateFilter('empleadoCurp', e.target.value)}/></TableHead>
                        <TableHead className="p-1 px-2 align-top"><Input placeholder="No..." className="h-7 text-xs bg-background font-mono" value={filters.empleadoNum || ''} onChange={e => updateFilter('empleadoNum', e.target.value)}/></TableHead>
                        <TableHead className="p-1 px-2 align-top"><Input placeholder="Dpto..." className="h-7 text-xs bg-background" value={filters.departamento || ''} onChange={e => updateFilter('departamento', e.target.value)}/></TableHead>
                        <TableHead className="p-1 px-2 align-top"><Input placeholder="$..." className="h-7 text-xs bg-background text-right" value={filters.totalPercepciones || ''} onChange={e => updateFilter('totalPercepciones', e.target.value)}/></TableHead>
                        <TableHead className="p-1 px-2 align-top"><Input placeholder="$..." className="h-7 text-xs bg-background text-right" value={filters.totalDeducciones || ''} onChange={e => updateFilter('totalDeducciones', e.target.value)}/></TableHead>
                        <TableHead className="p-1 px-2 align-top"><Input placeholder="$..." className="h-7 text-xs bg-background text-right" value={filters.totalOtrosPagos || ''} onChange={e => updateFilter('totalOtrosPagos', e.target.value)}/></TableHead>
                        <TableHead className="p-1 px-2 align-top"><Input placeholder="$..." className="h-7 text-xs bg-background text-right" value={filters.totalNeto || ''} onChange={e => updateFilter('totalNeto', e.target.value)}/></TableHead>
                        <TableHead className="p-1 px-2 align-top"><Input placeholder="VIG..." className="h-7 text-xs bg-background" value={filters.satStatus || ''} onChange={e => updateFilter('satStatus', e.target.value)}/></TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {paginated.map((r, i) => {
                        const tip = _isCuotaTipoSat(r.tipoDeduccion) ? r.tipoDeduccion : null;
                        const badgeClass = tip ? CUOTA_TIPO_BADGE_CLASS[tip] : 'bg-slate-500/10 text-slate-700 border-transparent';
                        return (
                            <TableRow key={`${r.deduccionId}-${i}`}>
                                <TableCell className="whitespace-nowrap font-semibold text-[11px]">{r.tipoDeduccion || '-'}</TableCell>
                                <TableCell className="whitespace-nowrap">
                                    <Badge variant="outline" className={badgeClass} title={r.categoriaCuota}>
                                        {r.categoriaCuota || 'Sin clasificar'}
                                    </Badge>
                                </TableCell>
                                <TableCell className="whitespace-nowrap text-[11px]">{r.claveDeduccion || '-'}</TableCell>
                                <TableCell className="max-w-[320px] truncate" title={r.conceptoDeduccion ?? ''}>{r.conceptoDeduccion || '-'}</TableCell>
                                <TableCell className="whitespace-nowrap text-right font-bold text-slate-800">{fmtMxn(r.importeCuotaMxn)}</TableCell>
                                <TableCell className="whitespace-nowrap">{fmtDateEs(r.fechaEmision) || '-'}</TableCell>
                                <TableCell className="whitespace-nowrap">{fmtDateEs(r.fechaPago) || '-'}</TableCell>
                                <TableCell className="whitespace-nowrap font-semibold text-[11px]">{r.tipoNomina || '-'}</TableCell>
                                <TableCell className="whitespace-nowrap text-[11px] font-mono truncate max-w-[260px]" title={r.uuid ?? ''}>{r.uuid || '-'}{r.pdfUrl ? <> · <a className="text-blue-600 hover:underline whitespace-nowrap" target="_blank" rel="noreferrer" href={r.pdfUrl}>PDF↗</a></> : null}</TableCell>
                                <TableCell className="whitespace-nowrap font-medium">{r.serie || '-'}</TableCell>
                                <TableCell className="whitespace-nowrap font-medium">{r.folio || '-'}</TableCell>
                                <TableCell className="whitespace-nowrap font-mono text-[11px]">{r.empleadoRfc || '-'}</TableCell>
                                <TableCell className="max-w-[340px] truncate" title={r.empleadoNombre ?? ''}>{r.empleadoNombre || '-'}</TableCell>
                                <TableCell className="whitespace-nowrap font-mono text-[11px]">{r.empleadoCurp || '-'}</TableCell>
                                <TableCell className="whitespace-nowrap font-mono text-[11px]">{r.empleadoNum || '-'}</TableCell>
                                <TableCell className="whitespace-nowrap text-[12px]">{r.departamento || '-'}</TableCell>
                                <TableCell className="whitespace-nowrap text-right font-medium">{fmtMxn(r.totalPercepciones)}</TableCell>
                                <TableCell className="whitespace-nowrap text-right font-medium">{fmtMxn(r.totalDeducciones)}</TableCell>
                                <TableCell className="whitespace-nowrap text-right font-medium">{fmtMxn(r.totalOtrosPagos)}</TableCell>
                                <TableCell className="whitespace-nowrap text-right font-bold">{fmtMxn(r.totalNeto)}</TableCell>
                                <TableCell className="whitespace-nowrap font-semibold text-[11px]">{r.satStatus}</TableCell>
                            </TableRow>
                        );
                    })}
                    {filtered.length === 0 && (
                        <TableRow>
                            <TableCell colSpan={22} className="h-24 text-center text-muted-foreground text-sm">
                                No se encontraron resultados para tu búsqueda.
                            </TableCell>
                        </TableRow>
                    )}
                    {filtered.length > 0 && (
                        <TableRow className="bg-muted/50 font-bold hover:bg-muted/50">
                            <TableCell colSpan={5} className="text-right text-xs">
                                Total Filtrado · {fmtNum(filtered.length)} cuota(s) a terceros
                            </TableCell>
                            <TableCell className="text-right">{fmtMxn(filteredTotals.importeCuota)}</TableCell>
                            <TableCell colSpan={11} className="text-right text-xs">
                                Σ Percep {fmtMxn(filteredTotals.percepciones)} · Σ Deduc {fmtMxn(filteredTotals.deducciones)} · Σ Otros {fmtMxn(filteredTotals.otros)}
                            </TableCell>
                            <TableCell className="text-right">{fmtMxn(filteredTotals.neto)}</TableCell>
                            <TableCell className="text-right text-xs">—</TableCell>
                        </TableRow>
                    )}
                </TableBody>
            </Table>
        );
    }

    function renderMainContent(
        ui: _CtUIState,
        c: _CtUIControls,
    ) {
        if (ui.loading) return _ctRenderLoading();
        if (ui.errorMsg) return _ctRenderErrorState(ui.errorMsg);
        if (ui.rows.length === 0) return _ctRenderEmptyState();
        return _ctRenderTable(ui, c);
    }

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
                            <Users2 className="h-5 w-5 text-emerald-700" />
                            Reporte · Cuotas a Terceros de Nómina <span className="text-xs font-normal text-muted-foreground">(Tipos SAT · 001 / 006 / 007 / 010)</span>
                        </DialogTitle>
                        <div className="text-xs sm:text-sm text-muted-foreground space-y-0.5">
                            <div>
                                <strong>Empresa:</strong>{' '}
                                {props.companyRfc ? (
                                    <span className="font-semibold text-foreground">{props.companyRfc}</span>
                                ) : (
                                    <span className="font-mono text-[11px]">{props.companyId}</span>
                                )}
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
                                    Conteo servidor: {fmtNum(serverTotals.countCuotasTerceros)} cuota(s) ·{' '}
                                    <strong>Σ Importe Cuota {fmtMxn(serverTotals.sumaImporteCuotaMxn)}</strong> ·{' '}
                                    Σ Neto CFDI {fmtMxn(serverTotals.sumaNetoCfdiMxn)} ·{' '}
                                    CFDIs afectados {fmtNum(serverTotals.countCfdAfectados)}
                                </div>
                            )}
                            {filtered.length > 0 && (
                                <div className="text-[11px] flex flex-wrap items-center gap-1.5">
                                    <span className="font-medium">Subtotales por categoría (filtrado):</span>
                                    <Badge variant="outline" className={CUOTA_TIPO_BADGE_CLASS['001']}>Σ Sindicato {fmtMxn(subtotalesPorCategoria['001'])}</Badge>
                                    <Badge variant="outline" className={CUOTA_TIPO_BADGE_CLASS['006']}>Σ FONACOT {fmtMxn(subtotalesPorCategoria['006'])}</Badge>
                                    <Badge variant="outline" className={CUOTA_TIPO_BADGE_CLASS['007']}>Σ Pensión {fmtMxn(subtotalesPorCategoria['007'])}</Badge>
                                    <Badge variant="outline" className={CUOTA_TIPO_BADGE_CLASS['010']}>Σ INFONAVIT {fmtMxn(subtotalesPorCategoria['010'])}</Badge>
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
                        { filters, filteredTotals, subtotalesPorCategoria, updateFilter },
                    )}
                </div>

                {!loading && filtered.length > 0 && (
                    <div className="mt-0 shrink-0 flex items-center justify-between gap-3 text-sm text-muted-foreground">
                        <div className="text-xs">
                            Mostrando{' '}
                            {((safePage - 1) * CUOTAS_TERCEROS_DRILLDOWN_PAGE_SIZE) + 1}-
                            {Math.min(safePage * CUOTAS_TERCEROS_DRILLDOWN_PAGE_SIZE, filtered.length)}{' '}
                            de {fmtNum(filtered.length)} cuotas a terceros filtradas
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
                            <span className="text-xs">
                                Página {fmtNum(safePage)} de {fmtNum(totalPages)}
                            </span>
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
