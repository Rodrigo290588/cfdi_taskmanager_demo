// ============================================================
// fiscal-nomina-filter-bar.tsx · TASK 5
// Filtros PERMANENTES (sin botón expandir) + Dropdown Visualización
// 6 secciones kpis · gravado_exento · deducciones_terceros ·
// alertas_sbc_sdi · alertas_timbrado · top_comprobantes.
// ============================================================
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, RefreshCcw, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
    DropdownMenuCheckboxItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { z } from 'zod';
import {
    FISCAL_NOMINA_SECTIONS,
    FISCAL_NOM_ALLOW_DEPARTAMENTO,
    FISCAL_NOM_ALLOW_REGISTRO_PATRONAL,
    buildFiscalNominaDashboardUrl,
    parseFiscalNominaSearchParams,
    type FiscalNominaSectionId,
} from '@/lib/fiscal-nomina-dashboard-url';

const ALL_SECTION_IDS = FISCAL_NOMINA_SECTIONS.map(s => s.id);

const filterSchema = z.object({
    startDate:        z.coerce.date().optional(),
    endDate:          z.coerce.date().optional(),
    departamento:     z.string().regex(FISCAL_NOM_ALLOW_DEPARTAMENTO).optional().or(z.literal('')),
    registroPatronal: z.string().regex(FISCAL_NOM_ALLOW_REGISTRO_PATRONAL).optional().or(z.literal('')),
});

export type FiscalNominaFilterBarProps = Readonly<{
    filters: Readonly<{
        startDate: string;
        endDate: string;
        departamento: string | null;
        registroPatronal: string | null;
        sections: Readonly<FiscalNominaSectionId[]>;
    }>;
}>;

export function FiscalNominaFilterBar({ filters }: FiscalNominaFilterBarProps) {
    const router = useRouter();
    const sp = useSearchParams();

    const [startDate,        setStartDate]        = useState(filters.startDate);
    const [endDate,          setEndDate]          = useState(filters.endDate);
    const [departamento,     setDepartamento]     = useState(filters.departamento ?? '');
    const [registroPatronal, setRegistroPatronal] = useState(filters.registroPatronal ?? '');

    useEffect(() => {
        const v = filters.startDate;
        const t = window.setTimeout(() => setStartDate(v), 0);
        return () => window.clearTimeout(t);
    }, [filters.startDate]);

    useEffect(() => {
        const v = filters.endDate;
        const t = window.setTimeout(() => setEndDate(v), 0);
        return () => window.clearTimeout(t);
    }, [filters.endDate]);

    useEffect(() => {
        const v = filters.departamento ?? '';
        const t = window.setTimeout(() => setDepartamento(v), 0);
        return () => window.clearTimeout(t);
    }, [filters.departamento]);

    useEffect(() => {
        const v = filters.registroPatronal ?? '';
        const t = window.setTimeout(() => setRegistroPatronal(v), 0);
        return () => window.clearTimeout(t);
    }, [filters.registroPatronal]);

    const currentSections = useMemo<FiscalNominaSectionId[]>(() => {
        const parsed = parseFiscalNominaSearchParams(Object.fromEntries(sp.entries()));
        return parsed.sections;
    }, [sp]);

    const navigateWithSections = useCallback((sections: Readonly<FiscalNominaSectionId[]>) => {
        const deptoOk = departamento === '' || FISCAL_NOM_ALLOW_DEPARTAMENTO.test(departamento);
        const rpOk    = registroPatronal === '' || FISCAL_NOM_ALLOW_REGISTRO_PATRONAL.test(registroPatronal);
        const next = buildFiscalNominaDashboardUrl(undefined, {
            companyId:        sp.get('companyId') ?? undefined,
            organizationId:   sp.get('organizationId') ?? undefined,
            fiscalEntityId:   sp.get('fiscalEntityId') ?? undefined,
            startDate:        deptoOk && rpOk ? startDate : filters.startDate,
            endDate:          deptoOk && rpOk ? endDate   : filters.endDate,
            departamento:     deptoOk ? departamento : filters.departamento ?? undefined,
            registroPatronal: rpOk    ? registroPatronal : filters.registroPatronal ?? undefined,
            sections:         sections.length === ALL_SECTION_IDS.length ? '' : sections.join(','),
        });
        router.replace(next, { scroll: false });
    }, [departamento, registroPatronal, startDate, endDate, filters, sp, router]);

    const toggleSection = useCallback((id: Readonly<FiscalNominaSectionId>) => {
        const has = currentSections.includes(id);
        const next = has ? currentSections.filter(s => s !== id) : Array.from(new Set([...currentSections, id]));
        navigateWithSections(next);
    }, [currentSections, navigateWithSections]);

    const showAllSections = useCallback(() => navigateWithSections([...ALL_SECTION_IDS]), [navigateWithSections]);
    const hideAllSections = useCallback(() => navigateWithSections([]), [navigateWithSections]);

    const onSubmit = (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const safe = filterSchema.safeParse({ startDate, endDate, departamento, registroPatronal });
        if (!safe.success) return;
        const next = buildFiscalNominaDashboardUrl(undefined, {
            companyId:        sp.get('companyId') ?? undefined,
            organizationId:   sp.get('organizationId') ?? undefined,
            fiscalEntityId:   sp.get('fiscalEntityId') ?? undefined,
            startDate:        startDate || undefined,
            endDate:          endDate   || undefined,
            departamento:     departamento     || undefined,
            registroPatronal: registroPatronal || undefined,
            sections:         currentSections.length === ALL_SECTION_IDS.length ? '' : currentSections.join(','),
        });
        router.replace(next, { scroll: false });
    };

    const onReset = () => {
        const next = buildFiscalNominaDashboardUrl(undefined, {
            companyId: sp.get('companyId') ?? undefined,
            sections:  currentSections.length === ALL_SECTION_IDS.length ? '' : currentSections.join(','),
        });
        router.replace(next, { scroll: false });
    };

    const checkedCount = currentSections.length;

    return (
        <form onSubmit={onSubmit} className="w-full flex flex-col gap-4 lg:flex-row lg:items-end justify-between">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 flex-1">
                <div className="flex flex-col gap-1.5">
                    <Label htmlFor="fn-startdate" className="text-xs font-medium text-slate-700">Fecha Inicio</Label>
                    <Input id="fn-startdate" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                    <Label htmlFor="fn-enddate" className="text-xs font-medium text-slate-700">Fecha Fin</Label>
                    <Input id="fn-enddate" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                    <Label htmlFor="fn-rp" className="text-xs font-medium text-slate-700">Registro Patronal</Label>
                    <Input
                        id="fn-rp"
                        placeholder="Y-AAA-999999"
                        value={registroPatronal}
                        onChange={e => setRegistroPatronal(e.target.value)}
                        maxLength={20}
                    />
                </div>
                <div className="flex flex-col gap-1.5">
                    <Label htmlFor="fn-depto" className="text-xs font-medium text-slate-700">Departamento</Label>
                    <Input
                        id="fn-depto"
                        placeholder="Ej. Finanzas"
                        value={departamento}
                        onChange={e => setDepartamento(e.target.value)}
                        maxLength={80}
                    />
                </div>
            </div>

            <div className="flex items-end gap-2 shrink-0 justify-start lg:justify-end">
                <Button type="submit" size="sm" className="gap-1.5">
                    <Search className="h-4 w-4" /> Filtrar
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={onReset} className="gap-1.5">
                    <RefreshCcw className="h-4 w-4" /> Restablecer
                </Button>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button type="button" variant="outline" size="sm" className="gap-1.5">
                            <SlidersHorizontal className="h-4 w-4" />
                            <span className="hidden sm:inline">Visualización</span>
                            <span className="inline-block text-xs font-mono text-slate-500">
                                {checkedCount}/{ALL_SECTION_IDS.length}
                            </span>
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-64">
                        <DropdownMenuItem onClick={showAllSections}>Mostrar todas</DropdownMenuItem>
                        <DropdownMenuItem onClick={hideAllSections}>Ocultar todas</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {FISCAL_NOMINA_SECTIONS.map(sec => (
                            <DropdownMenuCheckboxItem
                                key={sec.id}
                                checked={currentSections.includes(sec.id)}
                                onCheckedChange={() => toggleSection(sec.id)}
                                className={cn('text-sm')}
                            >
                                {sec.label}
                            </DropdownMenuCheckboxItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </form>
    );
}
