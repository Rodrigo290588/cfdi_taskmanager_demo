// ============================================================
// src/app/dashboard/rh/_components/rh-filter-bar.tsx
// Barra de filtros del Tablero RH (Client Component)
//
// Modifica searchParams de Next.js → el Server Component padre
// (app/dashboard/rh/page.tsx) se re-ejecuta y re-hidrata los
// límites Suspense sin hacer reload full de la página.
//
// Incluye Dropdown "Visualización" homologado a /dashboard_fiscal
// para elegir qué secciones (KPIs, Turnover, gráficas) mostrar.
// ============================================================
'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { RefreshCcw, SlidersHorizontal, Search } from 'lucide-react';
import {
  RH_URL_ALLOW_DEPARTAMENTO,
  RH_SECTIONS,
  RH_VIEW_MODES,
  buildRhDashboardUrl,
  type RhSectionId,
} from '@/lib/rh-dashboard-url';

export type RhFilterValues = {
  startDate: string;
  endDate: string;
  departamento: string;
  tipoNomina: string;
  periodicidad: string;
  view: 'monthly' | 'quarterly' | 'yearly';
};

export function RhFilterBar({
  filters,
}: {
  filters: {
    startDate: string | null;
    endDate: string | null;
    departamento: string | null;
    tipoNomina: string | null;
    periodicidad: string | null;
    view: 'monthly' | 'quarterly' | 'yearly';
    sections: RhSectionId[];
  };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [visibleSections, setVisibleSections] = useState<RhSectionId[]>(filters.sections);

  useEffect(() => {
    const nextSections = filters.sections
    const t = window.setTimeout(() => {
      setVisibleSections(nextSections)
    }, 0)
    return () => window.clearTimeout(t)
  }, [filters.sections])

  const { register, handleSubmit, setValue, control, formState: { isDirty, isSubmitting } } = useForm<RhFilterValues>({
    defaultValues: {
      startDate:      filters.startDate ?? '',
      endDate:        filters.endDate ?? '',
      departamento:   filters.departamento ?? '',
      tipoNomina:     filters.tipoNomina ?? 'all',
      periodicidad:   filters.periodicidad ?? 'all',
      view:           filters.view,
    },
  });

  // Sync URL → form si el usuario navega hacia atrás/adelante
  useEffect(() => {
    const s = searchParams.get('startDate');
    const e = searchParams.get('endDate');
    const d = searchParams.get('departamento');
    const tN = searchParams.get('tipoNomina');
    const pP = searchParams.get('periodicidad');
    const v = searchParams.get('view');
    if (s) setValue('startDate', s, { shouldDirty: false });
    if (e) setValue('endDate',   e, { shouldDirty: false });
    if (d !== null && d !== undefined) setValue('departamento', d, { shouldDirty: false });
    if (tN !== null && tN !== undefined) setValue('tipoNomina', tN, { shouldDirty: false });
    if (pP !== null && pP !== undefined) setValue('periodicidad', pP, { shouldDirty: false });
    if (v && RH_VIEW_MODES.includes(v as never)) setValue('view', v as 'monthly', { shouldDirty: false });
  }, [searchParams, setValue]);

  const apply = useCallback((data: RhFilterValues, sectionsOverride?: RhSectionId[]) => {
    const sections = (sectionsOverride ?? visibleSections);
    const params: Record<string, string> = {
      companyId:  searchParams.get('companyId') ?? '',
      startDate:  data.startDate,
      endDate:    data.endDate,
      view:       data.view,
      sections:   sections.length === RH_SECTIONS.length ? '' : sections.join(','),
    };
    if (data.tipoNomina && data.tipoNomina !== 'all') {
      params.tipoNomina = data.tipoNomina;
    }
    if (data.periodicidad && data.periodicidad !== 'all') {
      params.periodicidad = data.periodicidad;
    }
    const orgId = searchParams.get('organizationId');
    if (orgId) params.organizationId = orgId;
    const fiscalId = searchParams.get('fiscalEntityId');
    if (fiscalId) params.fiscalEntityId = fiscalId;

    const depto = z
      .string()
      .regex(RH_URL_ALLOW_DEPARTAMENTO)
      .nullable()
      .optional()
      .safeParse(data.departamento.trim() || null);
    if (depto.success && depto.data) params.departamento = depto.data;

    // Navegación soft: Next.js re-ejecuta el Server Component padre con Suspense.
    router.replace(buildRhDashboardUrl('/dashboard/rh', params), { scroll: false });
  }, [router, searchParams, visibleSections]);

  const reset = useCallback(() => {
    setValue('startDate', filters.startDate ?? '');
    setValue('endDate',   filters.endDate ?? '');
    setValue('departamento', filters.departamento ?? '');
    setValue('tipoNomina', filters.tipoNomina ?? 'all');
    setValue('periodicidad', filters.periodicidad ?? 'all');
    setValue('view',      filters.view);
    setVisibleSections(RH_SECTIONS.map(s => s.id));
    void apply({
      startDate: filters.startDate ?? '',
      endDate:   filters.endDate ?? '',
      departamento: filters.departamento ?? '',
      tipoNomina: filters.tipoNomina ?? 'all',
      periodicidad: filters.periodicidad ?? 'all',
      view:      filters.view,
    }, RH_SECTIONS.map(s => s.id));
  }, [setValue, filters, apply]);

  const currentView = useWatch({ name: 'view', control });
  const currentTipoNomina = useWatch({ name: 'tipoNomina', control });
  const currentPeriodicidad = useWatch({ name: 'periodicidad', control });
  const allChecked = useMemo(() => visibleSections.length === RH_SECTIONS.length, [visibleSections]);
  const noneChecked = visibleSections.length === 0;

  return (
    <div className="w-full">
      <form onSubmit={handleSubmit(data => apply(data))} className="flex items-end gap-4 flex-wrap w-full">
          <div className="grid w-full max-w-sm items-center gap-1.5">
            <Label htmlFor="rh-startdate">Fecha inicio</Label>
            <Input id="rh-startdate" type="date" {...register('startDate')} className="h-9 text-sm"/>
          </div>
          <div className="grid w-full max-w-sm items-center gap-1.5">
            <Label htmlFor="rh-enddate">Fecha fin</Label>
            <Input id="rh-enddate" type="date" {...register('endDate')} className="h-9 text-sm"/>
          </div>
          <div className="grid w-full max-w-sm items-center gap-1.5">
            <Label htmlFor="rh-depto">Departamento</Label>
            <Input
              id="rh-depto"
              placeholder="Ventas, Operaciones, etc."
              className="h-9 text-sm"
              maxLength={80}
              {...register('departamento')} />
          </div>
          <div className="grid w-full max-w-sm items-center gap-1.5">
            <Label htmlFor="rh-tipo-nomina">Tipo de Nómina</Label>
            <Select
              value={currentTipoNomina}
              onValueChange={(v) => setValue('tipoNomina', v, { shouldDirty: true })}>
              <SelectTrigger id="rh-tipo-nomina" className="h-9 text-sm"><SelectValue/></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="O">O - Nómina Ordinaria</SelectItem>
                <SelectItem value="E">E - Nómina Extraordinaria</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid w-full max-w-sm items-center gap-1.5">
            <Label htmlFor="rh-periodicidad">Periodicidad</Label>
            <Select
              value={currentPeriodicidad}
              onValueChange={(v) => setValue('periodicidad', v, { shouldDirty: true })}>
              <SelectTrigger id="rh-periodicidad" className="h-9 text-sm"><SelectValue/></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="01">01 - Diario</SelectItem>
                <SelectItem value="02">02 - Semanal</SelectItem>
                <SelectItem value="03">03 - Catorcenal</SelectItem>
                <SelectItem value="04">04 - Quincenal</SelectItem>
                <SelectItem value="05">05 - Mensual</SelectItem>
                <SelectItem value="06">06 - Bimestral</SelectItem>
                <SelectItem value="07">07 - Unidad de obra</SelectItem>
                <SelectItem value="08">08 - Comisión</SelectItem>
                <SelectItem value="09">09 - Precio alzado</SelectItem>
                <SelectItem value="10">10 - Decenal</SelectItem>
                <SelectItem value="99">99 - Otra Periodicidad</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid w-full max-w-sm items-center gap-1.5">
            <Label htmlFor="rh-view">Vista</Label>
            <Select
              value={currentView}
              onValueChange={(v) => setValue('view', v as 'monthly', { shouldDirty: true })}>
              <SelectTrigger id="rh-view" className="h-9 text-sm"><SelectValue/></SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">Mensual</SelectItem>
                <SelectItem value="quarterly">Trimestral</SelectItem>
                <SelectItem value="yearly">Anual</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-end gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={isSubmitting}>
              <Search className="mr-2 h-4 w-4"/>
              {isSubmitting ? 'Aplicando…' : 'Filtrar'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={reset}
              className="gap-1">
              <RefreshCcw className={`h-3 w-3 ${isDirty ? 'text-amber-600' : ''}`}/>
              Restablecer
            </Button>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="gap-1">
                  <SlidersHorizontal className="h-4 w-4 mr-1"/>
                  Visualización
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-60">
                <DropdownMenuLabel>Secciones visibles</DropdownMenuLabel>
                <DropdownMenuSeparator/>
                <DropdownMenuItem
                  disabled={allChecked}
                  onClick={() => {
                    const next = RH_SECTIONS.map(s => s.id) as RhSectionId[];
                    setVisibleSections(next);
                    void handleSubmit(data => apply(data, next))();
                  }}>
                  Mostrar todas
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={noneChecked}
                  onClick={() => {
                    setVisibleSections([]);
                    void handleSubmit(data => apply(data, []))();
                  }}>
                  Ocultar todas
                </DropdownMenuItem>
                <DropdownMenuSeparator/>
                {RH_SECTIONS.map((section) => (
                  <DropdownMenuCheckboxItem
                    key={section.id}
                    checked={visibleSections.includes(section.id)}
                    onCheckedChange={(checked) => {
                      let next: RhSectionId[];
                      if (checked) {
                        next = visibleSections.includes(section.id as RhSectionId)
                          ? visibleSections
                          : [...visibleSections, section.id as RhSectionId];
                      } else {
                        next = visibleSections.filter(id => id !== section.id);
                      }
                      setVisibleSections(next);
                      void handleSubmit(data => apply(data, next))();
                    }}>
                    {section.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </form>
    </div>
  );
}
