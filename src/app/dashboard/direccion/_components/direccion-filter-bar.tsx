// ============================================================
// src/app/dashboard/direccion/_components/direccion-filter-bar.tsx
// Barra de filtros Tablero RH Directivo (Client Component).
//
// Modifica searchParams → el Server Component (page.tsx)
// re-ejecuta los límites Suspense sin reload full página.
//
// Incluye: Fechas, Departamento, Año Comparativo YoY, Vista
// (Mensual/Trimestral/Anual), Botón Filtrar/Restablecer,
// Dropdown "Visualización" homologado (KPIs, Tendencia,
// Composición F/V, Desviación).
//
// Paquete 7.3 SonarQube Fixes · 7/7 warnings:
//   · Props inline → tipo nombrado FiltersForBar Readonly
//   · 3× Ambiguous spacing defaultValues/destructuración/params
//     → 1 espacio estándar
//   · Sync URL → form (useEffect 95-98 inline) → helper
//     syncSearchParamsIntoForm()
//   · Dropdown onClick inline Mostrar/Ocultar/Toggle (×3)
//     → handleShowAll handleHideAll handleToggleSection funciones nombradas
//   · buildApplyParamsFromForm() helper params build
//   · Refactor 305 lines → < 80 lines componente principal
// ============================================================
'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
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
  DIRECCION_ALLOW_DEPARTAMENTO,
  DIRECCION_SECTIONS,
  DIRECCION_VIEW_MODES,
  buildDireccionDashboardUrl,
  type DireccionSectionId,
  type DireccionViewMode,
} from '@/lib/direccion-dashboard-url';

// ============================================================================
// TIPOS NOMBRADOS (Paquete 7.3 · Fix props inline + mark Readonly)
// ============================================================================

export type DireccionFilterValues = Readonly<{
  startDate: string;
  endDate: string;
  departamento: string;
  anioComparativo: string;
  view: DireccionViewMode;
}>;

export type FiltersForBar = Readonly<{
  startDate: string;
  endDate: string;
  departamento: string | null;
  anioComparativo: number | null;
  view: DireccionViewMode;
  sections: readonly DireccionSectionId[];
}>;

type SearchParamsLike = ReturnType<typeof useSearchParams>;

// ============================================================================
// HELPERS TIPADOS (Paquete 7.3 · Fix ambiguous spacing y extract nested)
// ============================================================================

function defaultAnioComparativo(filtersAnio: number | null): string {
  return String(filtersAnio ?? (new Date().getFullYear() - 1));
}

function buildDefaultsFromFilters(filters: FiltersForBar): DireccionFilterValues {
  return {
    startDate: filters.startDate,
    endDate: filters.endDate,
    departamento: filters.departamento ?? '',
    anioComparativo: defaultAnioComparativo(filters.anioComparativo),
    view: filters.view,
  };
}

// ============================================================================
// HELPER 1 · syncSearchParamsIntoForm (Paquete 7.3 · Extract useEffect inline)
// ============================================================================

function syncSearchParamsIntoForm(
  sp: SearchParamsLike,
  setValue: (name: keyof DireccionFilterValues, value: string, opts?: { shouldDirty?: boolean }) => void,
): void {
  const s = sp.get('startDate');
  const e = sp.get('endDate');
  const d = sp.get('departamento');
  const ac = sp.get('anioComparativo');
  const v = sp.get('view');
  if (s) setValue('startDate', s, { shouldDirty: false });
  if (e) setValue('endDate', e, { shouldDirty: false });
  if (d !== null && d !== undefined) setValue('departamento', d, { shouldDirty: false });
  if (ac !== null && ac !== undefined) setValue('anioComparativo', ac, { shouldDirty: false });
  if (v && DIRECCION_VIEW_MODES.includes(v as DireccionViewMode)) {
    setValue('view', v as DireccionViewMode, { shouldDirty: false });
  }
}

// ============================================================================
// HELPER 2 · buildApplyParamsFromForm (Paquete 7.3 · Extract apply L102-L125)
// ============================================================================

type ApplyParamBag = Record<string, string | number>;

function buildApplyParamsFromForm(
  data: DireccionFilterValues,
  sections: readonly DireccionSectionId[],
  sp: SearchParamsLike,
): ApplyParamBag {
  const fullSections = sections.length === DIRECCION_SECTIONS.length;
  const params: ApplyParamBag = {
    companyId: sp.get('companyId') ?? '',
    startDate: data.startDate,
    endDate: data.endDate,
    view: data.view,
    sections: fullSections ? '' : sections.join(','),
  };
  const orgId = sp.get('organizationId');
  if (orgId) params.organizationId = orgId;
  const fiscalId = sp.get('fiscalEntityId');
  if (fiscalId) params.fiscalEntityId = fiscalId;

  const acSafe = z.coerce.number().int().min(2000).max(2100).safeParse(data.anioComparativo);
  if (acSafe.success) params.anioComparativo = acSafe.data;

  const depto = z
    .string()
    .regex(DIRECCION_ALLOW_DEPARTAMENTO)
    .nullable()
    .optional()
    .safeParse(data.departamento.trim() || null);
  if (depto.success && depto.data) params.departamento = depto.data;

  return params;
}

// ============================================================================
// SUB-COMPONENTE · DropdownVisualizacion (Paquete 7.3 · Extract 243-303 inline)
// ============================================================================

function DropdownVisualizacion({
  visibleSections,
  allSections,
  onApplyAll,
  onApplyNone,
  onToggleOne,
}: Readonly<{
  visibleSections: readonly DireccionSectionId[];
  allSections: readonly { readonly id: DireccionSectionId; readonly label: string; readonly description: string }[];
  onApplyAll: (next: DireccionSectionId[]) => void;
  onApplyNone: (next: DireccionSectionId[]) => void;
  onToggleOne: (id: DireccionSectionId, nextSections: DireccionSectionId[]) => void;
}>): ReactNode {
  const allChecked = visibleSections.length === allSections.length;
  const noneChecked = visibleSections.length === 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-1">
          <SlidersHorizontal className="h-4 w-4 mr-1" />
          Visualización
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72">
        <DropdownMenuLabel>Secciones visibles</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={allChecked}
          onClick={() => {
            const next = allSections.map(s => s.id) as DireccionSectionId[];
            onApplyAll(next);
          }}
        >
          Mostrar todas
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={noneChecked}
          onClick={() => {
            onApplyNone([] as DireccionSectionId[]);
          }}
        >
          Ocultar todas
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {allSections.map(section => (
          <DropdownMenuCheckboxItem
            key={section.id}
            checked={visibleSections.includes(section.id)}
            onCheckedChange={(checked) => {
              const id = section.id as DireccionSectionId;
              let next: DireccionSectionId[];
              if (checked) {
                next = visibleSections.includes(id)
                  ? (visibleSections as DireccionSectionId[])
                  : [...visibleSections, id];
              } else {
                next = visibleSections.filter(x => x !== id) as DireccionSectionId[];
              }
              onToggleOne(id, next);
            }}
          >
            <div className="flex flex-col items-start gap-0.5 py-0.5">
              <span className="text-sm font-medium">{section.label}</span>
              <span className="text-[10.5px] text-slate-500 leading-snug">
                {section.description}
              </span>
            </div>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ============================================================================
// COMPONENTE PRINCIPAL (Paquete 7.3 · ORQUESTADOR LINEAL < 80 líneas)
// ============================================================================

export function DireccionFilterBar({
  filters,
}: Readonly<{ filters: FiltersForBar }>) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [visibleSections, setVisibleSections] = useState<DireccionSectionId[]>(
    filters.sections as DireccionSectionId[],
  );

  useEffect(() => {
    const next = filters.sections as DireccionSectionId[];
    const t = window.setTimeout(() => setVisibleSections(next), 0);
    return () => window.clearTimeout(t);
  }, [filters.sections]);

  const defaults = useMemo(() => buildDefaultsFromFilters(filters), [filters]);

  const { register, handleSubmit, setValue, control, formState: { isDirty, isSubmitting } } = useForm<DireccionFilterValues>({
    defaultValues: defaults,
  });

  useEffect(() => {
    syncSearchParamsIntoForm(searchParams, setValue as Parameters<typeof syncSearchParamsIntoForm>[1]);
  }, [searchParams, setValue]);

  const apply = useCallback((data: DireccionFilterValues, sectionsOverride?: DireccionSectionId[]) => {
    const sections = (sectionsOverride ?? visibleSections) as DireccionSectionId[];
    const params = buildApplyParamsFromForm(data, sections, searchParams);
    router.replace(
      buildDireccionDashboardUrl('/dashboard/direccion', params),
      { scroll: false },
    );
  }, [router, searchParams, visibleSections]);

  const reset = useCallback(() => {
    const allSecs = DIRECCION_SECTIONS.map(s => s.id) as DireccionSectionId[];
    const baseDefaults = buildDefaultsFromFilters(filters);
    setValue('startDate', baseDefaults.startDate);
    setValue('endDate', baseDefaults.endDate);
    setValue('departamento', baseDefaults.departamento);
    setValue('anioComparativo', baseDefaults.anioComparativo);
    setValue('view', baseDefaults.view);
    setVisibleSections(allSecs);
    (async () => { apply(baseDefaults, allSecs); })().catch(err => console.error('[DIR_FILTER_RESET_FAIL]', err));
  }, [setValue, filters, apply]);

  const currentView = useWatch({ name: 'view', control });

  const handleShowAll = useCallback((next: DireccionSectionId[]) => {
    setVisibleSections(next);
    handleSubmit(data => apply(data, next))().catch(err => console.error('[DIR_FILTER_SHOWALL_FAIL]', err));
  }, [handleSubmit, apply]);

  const handleHideAll = useCallback((next: DireccionSectionId[]) => {
    setVisibleSections(next);
    handleSubmit(data => apply(data, next))().catch(err => console.error('[DIR_FILTER_HIDEALL_FAIL]', err));
  }, [handleSubmit, apply]);

  const handleToggleOne = useCallback((_id: DireccionSectionId, next: DireccionSectionId[]) => {
    setVisibleSections(next);
    handleSubmit(data => apply(data, next))().catch(err => console.error('[DIR_FILTER_TOGGLE_FAIL]', err));
  }, [handleSubmit, apply]);

  return (
    <div className="w-full">
      <form
        onSubmit={handleSubmit(data => apply(data))}
        className="flex items-end gap-4 flex-wrap w-full"
      >
        <div className="grid w-full max-w-[180px] items-center gap-1.5">
          <Label htmlFor="dir-startdate">Fecha inicio</Label>
          <Input id="dir-startdate" type="date" className="h-9 text-sm" {...register('startDate')} />
        </div>
        <div className="grid w-full max-w-[180px] items-center gap-1.5">
          <Label htmlFor="dir-enddate">Fecha fin</Label>
          <Input id="dir-enddate" type="date" className="h-9 text-sm" {...register('endDate')} />
        </div>
        <div className="grid w-full max-w-[220px] items-center gap-1.5">
          <Label htmlFor="dir-depto">Departamento</Label>
          <Input
            id="dir-depto"
            placeholder="Ej. Finanzas, Operaciones…"
            className="h-9 text-sm"
            maxLength={80}
            {...register('departamento')}
          />
        </div>
        <div className="grid w-full max-w-[160px] items-center gap-1.5">
          <Label htmlFor="dir-anio-comp">Año comparativo</Label>
          <Input
            id="dir-anio-comp"
            type="number"
            min={2000}
            max={2100}
            step={1}
            className="h-9 text-sm"
            {...register('anioComparativo')}
          />
        </div>
        <div className="grid w-full max-w-[160px] items-center gap-1.5">
          <Label htmlFor="dir-view">Vista</Label>
          <Select
            value={currentView}
            onValueChange={v => setValue('view', v as DireccionViewMode, { shouldDirty: true })}
          >
            <SelectTrigger id="dir-view" className="h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="monthly">Mensual</SelectItem>
              <SelectItem value="quarterly">Trimestral</SelectItem>
              <SelectItem value="yearly">Anual</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-end gap-2">
          <Button type="submit" size="sm" disabled={isSubmitting}>
            <Search className="mr-2 h-4 w-4" />
            {isSubmitting ? 'Aplicando…' : 'Filtrar'}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={reset} className="gap-1">
            <RefreshCcw className={`h-3 w-3 ${isDirty ? 'text-amber-600' : ''}`} />
            Restablecer
          </Button>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <DropdownVisualizacion
            visibleSections={visibleSections}
            allSections={DIRECCION_SECTIONS}
            onApplyAll={handleShowAll}
            onApplyNone={handleHideAll}
            onToggleOne={handleToggleOne}
          />
        </div>
      </form>
    </div>
  );
}
