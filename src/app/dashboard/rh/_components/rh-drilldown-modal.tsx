'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Download, Loader2 } from 'lucide-react';
import { format } from 'date-fns';

const DRILLDOWN_PAGE_SIZE = 200;

function formatMXN(val: number) {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(val);
}

export type RhDrilldownType = 
    | 'empleados_pagados'
    | 'percepciones_totales'
    | 'deducciones_totales'
    | 'otros_pagos'
    | 'dias_pagados'
    | 'costo_promedio'
    | 'altas'
    | 'bajas'
    | 'reingresos'
    | 'dias_incapacidad'
    | 'eventos_incapacidad'
    | 'empleados_incapacidad'
    | 'horas_extra_totales'
    | 'horas_dobles'
    | 'horas_triples'
    | 'costo_extra_total'
    | 'plantilla_vigente'
    | 'antiguedad_promedio'
    | 'sdi_promedio'
    | 'tipos_contrato'
    | 'vales_despensa'
    | 'fondo_ahorro'
    | 'premios_puntualidad'
    | 'premios_asistencia'
    | null;

export type RhDrilldownRow = {
    id: string;
    uuid: string;
    fechaPago: string;
    tipoNomina: string;
    departamento: string;
    diasPagados: number;
    percepciones: number;
    deducciones: number;
    otrosPagos: number;
    neto: number;
    receptorRfc: string;
    receptorNombre: string;
    receptorCurp: string;
    tipoIncapacidad?: string;
    tipoHorasExtra?: string;
    horasExtraPagadas?: number;
    puesto?: string;
    antiguedadAnios?: number;
    sdi?: number;
    tipoContrato?: string;
    tipoJornada?: string;
    sindicalizado?: string;
    tipoBeneficio?: string;
    importeBeneficio?: number;
};

interface RhDrilldownModalProps {
    readonly open: boolean;
    readonly onOpenChange: (open: boolean) => void;
    readonly type: RhDrilldownType;
    readonly filters: Record<string, string | null | undefined>;
    readonly summaryValue?: string | null;
}

export function RhDrilldownModal({ open, onOpenChange, type, filters, summaryValue }: RhDrilldownModalProps) {
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState<RhDrilldownRow[]>([]);
    const [page, setPage] = useState(1);
    const [localFilters, setLocalFilters] = useState<Record<string, string>>({});

    const isIncapacidades = type === 'dias_incapacidad' || type === 'eventos_incapacidad' || type === 'empleados_incapacidad';
    const isHorasExtra = type === 'horas_extra_totales' || type === 'horas_dobles' || type === 'horas_triples' || type === 'costo_extra_total';
    const isPlantilla = type === 'plantilla_vigente' || type === 'antiguedad_promedio' || type === 'sdi_promedio' || type === 'tipos_contrato';
    const isBeneficios = type === 'vales_despensa' || type === 'fondo_ahorro' || type === 'premios_puntualidad' || type === 'premios_asistencia';

    const getColSpan = () => {
        if (isIncapacidades) return 11;
        if (isHorasExtra) return 12;
        if (isPlantilla) return 16;
        if (isBeneficios) return 12;
        return 10;
    };

    useEffect(() => {
        if (!open || !type || !filters.companyId || !filters.startDate || !filters.endDate) return;

        let isMounted = true;
        const fetchData = async () => {
            setLoading(true);
            setData([]);
            setPage(1);
            setLocalFilters({});

            try {
                const params = new URLSearchParams();
                Object.entries(filters).forEach(([key, val]) => {
                    if (val) params.append(key, val as string);
                });
                params.set('limit', '2000');
                params.append('kpiType', type);

                let endpoint = '/api/dashboard/rh/drilldown/kpis';
                if (type === 'altas' || type === 'bajas' || type === 'reingresos') {
                    endpoint = '/api/dashboard/rh/drilldown/turnover';
                } else if (type === 'dias_incapacidad' || type === 'eventos_incapacidad' || type === 'empleados_incapacidad') {
                    endpoint = '/api/dashboard/rh/drilldown/incapacidades';
                } else if (type === 'horas_extra_totales' || type === 'horas_dobles' || type === 'horas_triples' || type === 'costo_extra_total') {
                    endpoint = '/api/dashboard/rh/drilldown/horas_extra';
                } else if (type === 'plantilla_vigente' || type === 'antiguedad_promedio' || type === 'sdi_promedio' || type === 'tipos_contrato') {
                    endpoint = '/api/dashboard/rh/drilldown/plantilla';
                } else if (type === 'vales_despensa' || type === 'fondo_ahorro' || type === 'premios_puntualidad' || type === 'premios_asistencia') {
                    endpoint = '/api/dashboard/rh/drilldown/beneficios';
                }

                const res = await fetch(`${endpoint}?${params.toString()}`);
                if (!res.ok) throw new Error('Network error');
                const json = await res.json();
                
                if (isMounted) {
                    if (json.ok && json.data) {
                        setData(json.data);
                    } else {
                        setData([]);
                    }
                }
            } catch (err) {
                console.error('Failed to fetch drilldown', err);
                if (isMounted) setData([]);
            } finally {
                if (isMounted) setLoading(false);
            }
        };

        fetchData();

        return () => {
            isMounted = false;
        };
    }, [open, type, filters]);

    const updateFilter = (key: string, value: string) => {
        setPage(1);
        setLocalFilters(prev => ({ ...prev, [key]: value }));
    };

    const applyFilters = (row: RhDrilldownRow, f: Record<string, string>) => {
        const match = (field: string | undefined, filterVal: string | undefined) => {
            if (!filterVal) return true;
            return field?.toLowerCase().includes(filterVal.toLowerCase()) ?? false;
        };

        return Boolean(
            (!f.fecha || row.fechaPago?.includes(f.fecha)) &&
            match(row.uuid, f.uuid) &&
            match(row.receptorRfc, f.rfc) &&
            match(row.receptorNombre, f.nombre) &&
            match(row.departamento, f.departamento) &&
            match(row.tipoIncapacidad, f.tipoIncapacidad) &&
            match(row.tipoHorasExtra, f.tipoHorasExtra) &&
            match(row.puesto, f.puesto) &&
            match(row.tipoContrato, f.tipoContrato) &&
            match(row.tipoJornada, f.tipoJornada) &&
            match(row.tipoBeneficio, f.tipoBeneficio)
        );
    };

    const filteredData = useMemo(() => {
        return data.filter(row => applyFilters(row, localFilters));
    }, [data, localFilters]);

    const totalPages = Math.max(1, Math.ceil(filteredData.length / DRILLDOWN_PAGE_SIZE));
    const paginatedData = useMemo(() => {
        const start = (page - 1) * DRILLDOWN_PAGE_SIZE;
        return filteredData.slice(start, start + DRILLDOWN_PAGE_SIZE);
    }, [filteredData, page]);

    const handleExport = () => {
        if (!filteredData || filteredData.length === 0) return;
        const headers = [
            'Fecha Pago', 'UUID', 'Tipo Nómina', 'Departamento', 'RFC Empleado', 'Nombre Empleado',
            ...(isIncapacidades ? ['Tipo Incapacidad'] : []),
            ...(isHorasExtra ? ['Tipo Horas', 'Horas Extra Pagadas'] : []),
            ...(isPlantilla ? ['Puesto', 'Antigüedad (Años)', 'SDI', 'Tipo Contrato', 'Tipo Jornada', 'Sindicalizado'] : []),
            ...(isBeneficios ? ['Tipo Beneficio', 'Importe Beneficio'] : []),
            'Días Pagados', 'Percepciones', 'Deducciones', 'Otros Pagos', 'Neto'
        ];
        const rows = filteredData.map(r => [
            r.fechaPago ? format(new Date(r.fechaPago), 'dd/MM/yyyy') : '',
            r.uuid || '',
            r.tipoNomina || '',
            r.departamento || '',
            r.receptorRfc || '',
            r.receptorNombre || '',
            ...(isIncapacidades ? [r.tipoIncapacidad || ''] : []),
            ...(isHorasExtra ? [r.tipoHorasExtra || '', r.horasExtraPagadas || 0] : []),
            ...(isPlantilla ? [r.puesto || '', r.antiguedadAnios || 0, r.sdi || 0, r.tipoContrato || '', r.tipoJornada || '', r.sindicalizado || ''] : []),
            ...(isBeneficios ? [r.tipoBeneficio || '', r.importeBeneficio || 0] : []),
            r.diasPagados || 0,
            r.percepciones || 0,
            r.deducciones || 0,
            r.otrosPagos || 0,
            r.neto || 0
        ]);

        const escapeCsvSafe = (val: unknown) => {
            if (val == null) return '';
            const str = typeof val === 'string' ? val : (val as { toString(): string }).toString();
            if (/^[=+\-@]/.test(str)) return `'${str}`;
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return `"${str.replaceAll('"', '""')}"`;
            }
            return str;
        };

        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.map(escapeCsvSafe).join(','))
        ].join('\n');

        const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const typeName = type?.toUpperCase() || 'KPI';
        const dateStr = format(new Date(), 'yyyy-MM-dd_HH-mm-ss');
        link.setAttribute('download', `Evidencia_Resultados_RH_${typeName}_${dateStr}.csv`);
        document.body.appendChild(link);
        link.click();
        link.remove();
    };

    const titleMap: Record<string, string> = {
        'empleados_pagados': 'Reporte de Empleados Pagados',
        'percepciones_totales': 'Reporte de Percepciones Totales',
        'deducciones_totales': 'Reporte de Deducciones Totales',
        'otros_pagos': 'Reporte de Otros Pagos',
        'dias_pagados': 'Reporte de Días Pagados',
        'costo_promedio': 'Reporte de Costo Promedio / Empleado',
        'altas': 'Reporte de Altas de Personal',
        'bajas': 'Reporte de Bajas de Personal',
        'reingresos': 'Reporte de Reingresos de Personal',
        'dias_incapacidad': 'Reporte de Días de Incapacidad',
        'eventos_incapacidad': 'Reporte de Eventos de Incapacidad Registrados',
        'empleados_incapacidad': 'Reporte de Empleados Afectados (Incapacidad)',
        'horas_extra_totales': 'Reporte de Horas Extra Totales',
        'horas_dobles': 'Reporte de Horas Dobles',
        'horas_triples': 'Reporte de Horas Triples',
        'costo_extra_total': 'Reporte de Costo Extra Total',
        'plantilla_vigente': 'Reporte de Plantilla Vigente',
        'antiguedad_promedio': 'Reporte de Antigüedad Promedio',
        'sdi_promedio': 'Reporte de SDI Promedio',
        'tipos_contrato': 'Reporte de Tipos de Contrato',
        'vales_despensa': 'Reporte de Vales de Despensa',
        'fondo_ahorro': 'Reporte de Fondo / Caja de Ahorro',
        'premios_puntualidad': 'Reporte de Premios de Puntualidad',
        'premios_asistencia': 'Reporte de Premios de Asistencia'
    };

    const summaryLabelMap: Record<string, string> = {
        'empleados_pagados': 'Cantidad de Empleados',
        'percepciones_totales': 'Total Percepciones',
        'deducciones_totales': 'Total Deducciones',
        'otros_pagos': 'Total Otros Pagos',
        'dias_pagados': 'Total Días Pagados',
        'costo_promedio': 'Costo Prom. / Empleado',
        'altas': 'Total Altas',
        'bajas': 'Total Bajas',
        'reingresos': 'Total Reingresos',
        'dias_incapacidad': 'Total Días de Incapacidad',
        'eventos_incapacidad': 'Total Eventos Registrados',
        'empleados_incapacidad': 'Total Empleados Afectados',
        'horas_extra_totales': 'Total Horas Extra',
        'horas_dobles': 'Total Horas Dobles',
        'horas_triples': 'Total Horas Triples',
        'costo_extra_total': 'Costo Extra Total',
        'plantilla_vigente': 'Plantilla Vigente',
        'antiguedad_promedio': 'Antigüedad Promedio (Años)',
        'sdi_promedio': 'SDI Promedio',
        'tipos_contrato': 'Tipos de Contrato',
        'vales_despensa': 'Total Importe',
        'fondo_ahorro': 'Total Importe',
        'premios_puntualidad': 'Total Importe',
        'premios_asistencia': 'Total Importe'
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="!max-w-[100vw] !w-screen !max-h-screen !h-screen flex flex-col p-6 m-0 border-0 rounded-none sm:rounded-none inset-0 translate-x-0 translate-y-0 data-[state=open]:slide-in-from-left-0 data-[state=open]:slide-in-from-top-0">
                <DialogHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                    <div>
                        <DialogTitle className="text-xl text-emerald-800 bg-emerald-100/50 inline-block px-2 py-1 rounded">
                            {type ? titleMap[type] : 'Reporte Detallado'}
                        </DialogTitle>
                        <DialogDescription asChild>
                            <div className="mt-2 text-sm text-slate-600">
                                Resumen de consulta:
                                <ul className="list-disc pl-5 mt-1 space-y-0.5">
                                    <li>Empresa: {filters.companyRfc || filters.companyId}</li>
                                    {filters.startDate && filters.endDate && (
                                        <li>Fecha: {format(new Date(filters.startDate as string), 'yyyy-MM-dd')} - {format(new Date(filters.endDate as string), 'yyyy-MM-dd')}</li>
                                    )}
                                    {type && summaryValue && (
                                        <li>{summaryLabelMap[type]}: {summaryValue}</li>
                                    )}
                                </ul>
                            </div>
                        </DialogDescription>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button onClick={handleExport} variant="outline" size="sm" className="shrink-0 text-blue-700 border-blue-200 hover:bg-blue-50">
                            <Download className="w-4 h-4 mr-2" />
                            Exportar Excel (CSV)
                        </Button>
                    </div>
                </DialogHeader>

                <div className="flex-1 overflow-auto border rounded-md mt-4 relative bg-white">
                    {loading ? (
                        <div className="absolute inset-0 flex items-center justify-center bg-white/50 z-10">
                            <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
                        </div>
                    ) : null}
                    
                    <Table className="relative w-full text-xs">
                        <TableHeader className="sticky top-0 bg-slate-50 z-20 shadow-sm">
                            <TableRow className="hover:bg-transparent">
                                <TableHead className="font-semibold text-slate-700 w-[100px]">Fecha Pago</TableHead>
                                <TableHead className="font-semibold text-slate-700 w-[220px]">UUID</TableHead>
                                <TableHead className="font-semibold text-slate-700 w-[120px]">RFC Empleado</TableHead>
                                <TableHead className="font-semibold text-slate-700 w-[200px]">Nombre Empleado</TableHead>
                                <TableHead className="font-semibold text-slate-700 w-[150px]">Departamento</TableHead>
                                {isIncapacidades && <TableHead className="font-semibold text-slate-700 w-[180px]">Tipo Incapacidad</TableHead>}
                                {isHorasExtra && (
                                    <>
                                        <TableHead className="font-semibold text-slate-700 w-[120px]">Tipo Horas</TableHead>
                                        <TableHead className="font-semibold text-slate-700 text-right w-[100px]">Horas Extra</TableHead>
                                    </>
                                )}
                                {isPlantilla && (
                                    <>
                                        <TableHead className="font-semibold text-slate-700 w-[150px]">Puesto</TableHead>
                                        <TableHead className="font-semibold text-slate-700 text-right w-[100px]">Antigüedad (Años)</TableHead>
                                        <TableHead className="font-semibold text-slate-700 text-right w-[100px]">SDI</TableHead>
                                        <TableHead className="font-semibold text-slate-700 w-[150px]">Tipo Contrato</TableHead>
                                        <TableHead className="font-semibold text-slate-700 w-[120px]">Tipo Jornada</TableHead>
                                        <TableHead className="font-semibold text-slate-700 w-[100px]">Sindicalizado</TableHead>
                                    </>
                                )}
                                {isBeneficios && (
                                    <>
                                        <TableHead className="font-semibold text-slate-700 w-[180px]">Tipo Beneficio</TableHead>
                                        <TableHead className="font-semibold text-slate-700 text-right w-[120px]">Importe Beneficio</TableHead>
                                    </>
                                )}
                                <TableHead className="font-semibold text-slate-700 text-right w-[80px]">Días</TableHead>
                                <TableHead className="font-semibold text-slate-700 text-right w-[100px]">Percepciones</TableHead>
                                <TableHead className="font-semibold text-slate-700 text-right w-[100px]">Deducciones</TableHead>
                                <TableHead className="font-semibold text-slate-700 text-right w-[100px]">Otros Pagos</TableHead>
                                <TableHead className="font-semibold text-slate-700 text-right w-[100px]">Neto</TableHead>
                            </TableRow>
                            <TableRow className="bg-slate-50 hover:bg-transparent border-b">
                                <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background" value={localFilters.fecha || ''} onChange={e => updateFilter('fecha', e.target.value)}/></TableHead>
                                <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background font-mono" value={localFilters.uuid || ''} onChange={e => updateFilter('uuid', e.target.value)}/></TableHead>
                                <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background font-mono" value={localFilters.rfc || ''} onChange={e => updateFilter('rfc', e.target.value)}/></TableHead>
                                <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background" value={localFilters.nombre || ''} onChange={e => updateFilter('nombre', e.target.value)}/></TableHead>
                                <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background" value={localFilters.departamento || ''} onChange={e => updateFilter('departamento', e.target.value)}/></TableHead>
                                {isIncapacidades && <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background" value={localFilters.tipoIncapacidad || ''} onChange={e => updateFilter('tipoIncapacidad', e.target.value)}/></TableHead>}
                                {isHorasExtra && (
                                    <>
                                        <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background" value={localFilters.tipoHorasExtra || ''} onChange={e => updateFilter('tipoHorasExtra', e.target.value)}/></TableHead>
                                        <TableHead className="p-1 px-2 align-top"></TableHead>
                                    </>
                                )}
                                {isPlantilla && (
                                    <>
                                        <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background" value={localFilters.puesto || ''} onChange={e => updateFilter('puesto', e.target.value)}/></TableHead>
                                        <TableHead className="p-1 px-2 align-top"></TableHead>
                                        <TableHead className="p-1 px-2 align-top"></TableHead>
                                        <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background" value={localFilters.tipoContrato || ''} onChange={e => updateFilter('tipoContrato', e.target.value)}/></TableHead>
                                        <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background" value={localFilters.tipoJornada || ''} onChange={e => updateFilter('tipoJornada', e.target.value)}/></TableHead>
                                        <TableHead className="p-1 px-2 align-top"></TableHead>
                                    </>
                                )}
                                {isBeneficios && (
                                    <>
                                        <TableHead className="p-1 px-2 align-top"><Input placeholder="Buscar..." className="h-7 text-xs bg-background" value={localFilters.tipoBeneficio || ''} onChange={e => updateFilter('tipoBeneficio', e.target.value)}/></TableHead>
                                        <TableHead className="p-1 px-2 align-top"></TableHead>
                                    </>
                                )}
                                <TableHead className="p-1 px-2 align-top"></TableHead>
                                <TableHead className="p-1 px-2 align-top"></TableHead>
                                <TableHead className="p-1 px-2 align-top"></TableHead>
                                <TableHead className="p-1 px-2 align-top"></TableHead>
                                <TableHead className="p-1 px-2 align-top"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {!loading && paginatedData.map((row, idx) => (
                                <TableRow key={row.id || idx} className="hover:bg-slate-50/80 transition-colors">
                                    <TableCell className="whitespace-nowrap py-2">{row.fechaPago ? format(new Date(row.fechaPago), 'dd/MM/yyyy') : ''}</TableCell>
                                    <TableCell className="font-mono text-[10px] text-slate-500 py-2">{row.uuid}</TableCell>
                                    <TableCell className="font-mono text-[11px] py-2">{row.receptorRfc}</TableCell>
                                    <TableCell className="truncate max-w-[200px] py-2" title={row.receptorNombre}>{row.receptorNombre}</TableCell>
                                    <TableCell className="truncate max-w-[150px] py-2" title={row.departamento}>{row.departamento}</TableCell>
                                    {isIncapacidades && <TableCell className="truncate max-w-[180px] py-2" title={row.tipoIncapacidad}>{row.tipoIncapacidad}</TableCell>}
                                    {isHorasExtra && (
                                        <>
                                            <TableCell className="truncate max-w-[120px] py-2" title={row.tipoHorasExtra}>{row.tipoHorasExtra}</TableCell>
                                            <TableCell className="text-right py-2">{row.horasExtraPagadas}</TableCell>
                                        </>
                                    )}
                                    {isPlantilla && (
                                        <>
                                            <TableCell className="truncate max-w-[150px] py-2" title={row.puesto}>{row.puesto}</TableCell>
                                            <TableCell className="text-right py-2">{row.antiguedadAnios}</TableCell>
                                            <TableCell className="text-right py-2">{formatMXN(row.sdi || 0)}</TableCell>
                                            <TableCell className="truncate max-w-[150px] py-2" title={row.tipoContrato}>{row.tipoContrato}</TableCell>
                                            <TableCell className="truncate max-w-[120px] py-2" title={row.tipoJornada}>{row.tipoJornada}</TableCell>
                                            <TableCell className="py-2">{row.sindicalizado}</TableCell>
                                        </>
                                    )}
                                    {isBeneficios && (
                                        <>
                                            <TableCell className="truncate max-w-[180px] py-2" title={row.tipoBeneficio}>{row.tipoBeneficio}</TableCell>
                                            <TableCell className="text-right py-2 font-medium text-emerald-600">{formatMXN(row.importeBeneficio || 0)}</TableCell>
                                        </>
                                    )}
                                    <TableCell className="text-right py-2">{row.diasPagados}</TableCell>
                                    <TableCell className="text-right py-2 text-blue-600">{formatMXN(row.percepciones)}</TableCell>
                                    <TableCell className="text-right py-2 text-rose-600">{formatMXN(row.deducciones)}</TableCell>
                                    <TableCell className="text-right py-2 text-amber-600">{formatMXN(row.otrosPagos)}</TableCell>
                                    <TableCell className="text-right font-medium py-2 text-emerald-600">{formatMXN(row.neto)}</TableCell>
                                </TableRow>
                            ))}
                            {!loading && filteredData.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={getColSpan()} className="h-32 text-center text-slate-500">
                                        No se encontraron registros que coincidan con los filtros.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>

                <div className="flex items-center justify-between pt-4 mt-auto border-t text-sm">
                    <div className="text-slate-500 flex flex-col gap-1">
                        {!loading && filteredData.length > 0 && (
                            <span>
                                Mostrando {((page - 1) * DRILLDOWN_PAGE_SIZE) + 1}-{Math.min(page * DRILLDOWN_PAGE_SIZE, filteredData.length)} de {filteredData.length} registros filtrados
                            </span>
                        )}
                        {type === 'sdi_promedio' && (
                            <span className="text-xs text-blue-600 font-medium">
                                * Cálculo de SDI Promedio: Se obtiene al tomar el SalarioDiarioIntegrado de todos los XMLs emitidos multiplicándolo por la cantidad de personas que ganan ese salario para darle su peso justo, y finalmente dividiéndolo entre el total de tu headcount (plantilla) en ese periodo.
                            </span>
                        )}
                    </div>
                    <div className="flex items-center space-x-2">
                        <Button 
                            variant="outline" 
                            size="sm" 
                            disabled={page <= 1 || loading}
                            onClick={() => setPage(current => Math.max(1, current - 1))}
                            className="h-8 rounded-full px-4"
                        >
                            Anterior
                        </Button>
                        <span className="text-slate-600 min-w-[80px] text-center text-xs">
                            Página {page} de {totalPages}
                        </span>
                        <Button 
                            variant="outline" 
                            size="sm" 
                            disabled={page >= totalPages || loading}
                            onClick={() => setPage(current => Math.min(totalPages, current + 1))}
                            className="h-8 rounded-full px-4 text-blue-600 border-blue-200"
                        >
                            Siguiente
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
