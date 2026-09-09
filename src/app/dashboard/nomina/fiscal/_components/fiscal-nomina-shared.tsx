// ============================================================
// fiscal-nomina-shared.tsx · TASK 6
// Re-exports + KpiCardFiscal + ChartCard · Estilo fiscal =
// barra TONE/10 arriba + icon h-12 w-12 + value text-2xl bold.
// ============================================================
'use client';

import { useCallback, useState, useContext, createContext, type ReactNode, useMemo, type KeyboardEvent } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter, Badge };
export { fmtMxn, fmtNum, fmtPct, fmtDateEs, fmtDiasDiferencia, FISCAL_NOM_PALETTE } from '@/lib/fiscal-nomina-formatters';

import { DrilldownDialogCanceladosNom } from './drilldown-dialog-cancelados-nom';
import { DrilldownDialogUuidDuplicadosNom } from './drilldown-dialog-uuid-duplicados-nom';
import { DrilldownDialogRetrasosNom } from './drilldown-dialog-retrasos-nom';
import { DrilldownDialogAlertasSbcSdiNom } from './drilldown-dialog-alertas-sbcsdi-nom';
import { DrilldownDialogIsrRetenidoNom } from './drilldown-dialog-isr-retenido-nom';

export type ToneId = 'slate' | 'emerald' | 'rose' | 'amber' | 'indigo' | 'violet';
const TONE_CLASSES: Record<ToneId, { bar: string; text: string; icon: string; border: string }> = {
    slate:   { bar: 'bg-slate-500/10',   text: 'text-slate-800',    icon: 'text-slate-500',    border: 'border-slate-200'   },
    emerald: { bar: 'bg-emerald-500/10', text: 'text-emerald-800',  icon: 'text-emerald-500',  border: 'border-emerald-200' },
    rose:    { bar: 'bg-rose-500/10',    text: 'text-rose-800',     icon: 'text-rose-500',     border: 'border-rose-200'    },
    amber:   { bar: 'bg-amber-500/10',   text: 'text-amber-800',    icon: 'text-amber-500',    border: 'border-amber-200'   },
    indigo:  { bar: 'bg-indigo-500/10',  text: 'text-indigo-800',   icon: 'text-indigo-500',   border: 'border-indigo-200'  },
    violet:  { bar: 'bg-violet-500/10',  text: 'text-violet-800',   icon: 'text-violet-500',   border: 'border-violet-200'  },
};

const KPI_TRIGGER_BTN_BASE_CLASS = 'absolute inset-0 z-10 m-0 border-0 bg-transparent p-0';
const KPI_TRIGGER_BTN_INTERACTIVE_CLASS = 'cursor-pointer hover:brightness-[1.01] active:brightness-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-md';
const KPI_CARD_INTERACTIVE_CLASS = 'cursor-pointer hover:brightness-[1.02] active:brightness-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

type KpiDrilldownOpenFn = () => void;

function _onKeyDownEnterSpace(fn: KpiDrilldownOpenFn) {
    return (e: KeyboardEvent<HTMLElement>) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fn();
        }
    };
}

export type KpiCardFiscalProps = Readonly<{
    title: string;
    tone: ToneId;
    icon: ReactNode;
    value: ReactNode;
    sublabel?: ReactNode;
    badge?: ReactNode;
    className?: string;
    onClick?: KpiDrilldownOpenFn;
}>;

export function KpiCardFiscal(props: KpiCardFiscalProps) {
    const tone = TONE_CLASSES[props.tone];
    const interactive = typeof props.onClick === 'function';
    return (
        <Card
            onClick={interactive ? props.onClick : undefined}
            role={interactive ? 'button' : undefined}
            tabIndex={interactive ? 0 : undefined}
            onKeyDown={interactive ? _onKeyDownEnterSpace(props.onClick) : undefined}
            className={cn(
                'overflow-hidden border border-border hover:shadow-md transition-shadow',
                interactive && KPI_CARD_INTERACTIVE_CLASS,
                props.className,
            )}
        >
            <div className={cn(tone.bar, 'p-2 text-center border-b border-border')}>
                <h3 className={cn('font-bold text-base leading-tight flex items-center justify-center gap-2', tone.text)}>
                    {props.title}
                    {props.badge}
                </h3>
            </div>
            <CardContent className="p-6 flex flex-col items-center justify-center space-y-2">
                <div className={cn(tone.icon, 'h-12 w-12 flex items-center justify-center')}>
                    {props.icon}
                </div>
                <div className="text-2xl font-bold text-foreground text-center">{props.value}</div>
                {props.sublabel && (
                    <div className="text-xs text-muted-foreground text-center">{props.sublabel}</div>
                )}
            </CardContent>
        </Card>
    );
}

export type ChartCardProps = Readonly<{
    title: ReactNode;
    subtitle?: ReactNode;
    right?: ReactNode;
    children: ReactNode;
    className?: string;
    minHeight?: number;
    badge?: ReactNode;
    footer?: ReactNode;
}>;

export function ChartCard(props: ChartCardProps) {
    return (
        <Card className={cn('overflow-hidden border border-border', props.className)}>
            {(props.title || props.right) && (
                <CardHeader className="p-4 pb-3 flex flex-row items-start justify-between space-y-0 gap-2">
                    <div className="space-y-0.5 min-w-0 flex-1">
                        {props.title && <CardTitle className="text-base font-semibold leading-tight">{props.title}</CardTitle>}
                        {props.subtitle && <CardDescription className="text-xs">{props.subtitle}</CardDescription>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        {props.badge}
                        {props.right}
                    </div>
                </CardHeader>
            )}
            <CardContent className="p-4 pt-1" style={{ minHeight: props.minHeight ?? 340 }}>
                {props.children}
            </CardContent>
            {props.footer && (
                <CardFooter className="p-4 pt-2 text-xs text-muted-foreground border-t border-border bg-slate-50/40">
                    {props.footer}
                </CardFooter>
            )}
        </Card>
    );
}

export type FiscalNomEmptyStateProps = Readonly<{
    icon: ReactNode;
    title: string;
    subtitle?: string;
    hint?: string;
}>;

export function FiscalNomEmptyState(props: FiscalNomEmptyStateProps) {
    return (
        <Card>
            <CardContent className="p-8 flex flex-col items-center justify-center text-center space-y-3">
                <div className="h-12 w-12 text-slate-400">{props.icon}</div>
                <div className="text-base font-semibold">{props.title}</div>
                {props.subtitle && <div className="text-sm text-muted-foreground max-w-md">{props.subtitle}</div>}
                {props.hint && <div className="text-xs text-muted-foreground">{props.hint}</div>}
            </CardContent>
        </Card>
    );
}

export type TrendBadgeProps = Readonly<{
    kind: 'up' | 'down' | 'flat';
    label?: string;
    delta?: string;
}>;

type TrendBadgeKind = TrendBadgeProps['kind'];

function _trendTone(kind: TrendBadgeKind): string {
    switch (kind) {
        case 'up':   return 'bg-emerald-500/10 text-emerald-700';
        case 'down': return 'bg-rose-500/10 text-rose-700';
        case 'flat': return 'bg-slate-500/10 text-slate-700';
    }
}

function _trendGlyph(kind: TrendBadgeKind): '▲' | '▼' | '■' {
    switch (kind) {
        case 'up':   return '▲';
        case 'down': return '▼';
        case 'flat': return '■';
    }
}

export function TrendBadge(props: TrendBadgeProps) {
    const tone = _trendTone(props.kind);
    const primary = props.delta ?? props.label ?? _trendGlyph(props.kind);
    const suffix = props.delta && props.label ? ` · ${props.label}` : '';
    return (
        <Badge variant="outline" className={cn(tone, 'border-transparent font-normal')}>
            {primary}
            {suffix}
        </Badge>
    );
}

const CanceladosDrilldownCtx = createContext<{ open: KpiDrilldownOpenFn } | null>(null);
const UuidDuplicadosDrilldownCtx = createContext<{ open: KpiDrilldownOpenFn } | null>(null);
const RetrasosTimbradoDrilldownCtx = createContext<{ open: KpiDrilldownOpenFn } | null>(null);
const AlertasSbcSdiDrilldownCtx = createContext<{ open: KpiDrilldownOpenFn } | null>(null);
const IsrRetenidoDrilldownCtx = createContext<{ open: KpiDrilldownOpenFn } | null>(null);

export type KpiDrilldownShellNominaProps = Readonly<{
    companyId: string;
    companyRfc?: string | null;
    companyDisplayName?: string | null;
    startDate: string;
    endDate: string;
    children: ReactNode;
}>;

export function KpiDrilldownShellNomina(props: KpiDrilldownShellNominaProps) {
    const [drilldownCanceladosOpen, setDrilldownCanceladosOpen] = useState(false);
    const [drilldownUuidDuplicadosOpen, setDrilldownUuidDuplicadosOpen] = useState(false);
    const [drilldownRetrasosOpen, setDrilldownRetrasosOpen] = useState(false);
    const [drilldownAlertasOpen, setDrilldownAlertasOpen] = useState(false);
    const [drilldownIsrRetenidoOpen, setDrilldownIsrRetenidoOpen] = useState(false);
    const openCancelados = useCallback<KpiDrilldownOpenFn>(() => setDrilldownCanceladosOpen(true), []);
    const openUuidDuplicados = useCallback<KpiDrilldownOpenFn>(() => setDrilldownUuidDuplicadosOpen(true), []);
    const openRetrasos = useCallback<KpiDrilldownOpenFn>(() => setDrilldownRetrasosOpen(true), []);
    const openAlertas = useCallback<KpiDrilldownOpenFn>(() => setDrilldownAlertasOpen(true), []);
    const openIsrRetenido = useCallback<KpiDrilldownOpenFn>(() => setDrilldownIsrRetenidoOpen(true), []);
    const ctxValueCancelados = useMemo(() => ({ open: openCancelados }), [openCancelados]);
    const ctxValueUuidDuplicados = useMemo(() => ({ open: openUuidDuplicados }), [openUuidDuplicados]);
    const ctxValueRetrasos = useMemo(() => ({ open: openRetrasos }), [openRetrasos]);
    const ctxValueAlertas = useMemo(() => ({ open: openAlertas }), [openAlertas]);
    const ctxValueIsrRetenido = useMemo(() => ({ open: openIsrRetenido }), [openIsrRetenido]);
    return (
        <CanceladosDrilldownCtx.Provider value={ctxValueCancelados}>
            <UuidDuplicadosDrilldownCtx.Provider value={ctxValueUuidDuplicados}>
                <RetrasosTimbradoDrilldownCtx.Provider value={ctxValueRetrasos}>
                    <AlertasSbcSdiDrilldownCtx.Provider value={ctxValueAlertas}>
                        <IsrRetenidoDrilldownCtx.Provider value={ctxValueIsrRetenido}>
                            {props.children}
                            <DrilldownDialogCanceladosNom
                                open={drilldownCanceladosOpen}
                                onOpenChange={setDrilldownCanceladosOpen}
                                companyId={props.companyId}
                                companyRfc={props.companyRfc ?? null}
                                companyDisplayName={props.companyDisplayName ?? null}
                                startDate={props.startDate}
                                endDate={props.endDate}
                            />
                            <DrilldownDialogUuidDuplicadosNom
                                open={drilldownUuidDuplicadosOpen}
                                onOpenChange={setDrilldownUuidDuplicadosOpen}
                                companyId={props.companyId}
                                companyRfc={props.companyRfc ?? null}
                                companyDisplayName={props.companyDisplayName ?? null}
                                startDate={props.startDate}
                                endDate={props.endDate}
                            />
                            <DrilldownDialogRetrasosNom
                                open={drilldownRetrasosOpen}
                                onOpenChange={setDrilldownRetrasosOpen}
                                companyId={props.companyId}
                                companyRfc={props.companyRfc ?? null}
                                companyDisplayName={props.companyDisplayName ?? null}
                                startDate={props.startDate}
                                endDate={props.endDate}
                            />
                            <DrilldownDialogAlertasSbcSdiNom
                                open={drilldownAlertasOpen}
                                onOpenChange={setDrilldownAlertasOpen}
                                companyId={props.companyId}
                                companyRfc={props.companyRfc ?? null}
                                companyDisplayName={props.companyDisplayName ?? null}
                                startDate={props.startDate}
                                endDate={props.endDate}
                            />
                            <DrilldownDialogIsrRetenidoNom
                                open={drilldownIsrRetenidoOpen}
                                onOpenChange={setDrilldownIsrRetenidoOpen}
                                companyId={props.companyId}
                                companyRfc={props.companyRfc ?? null}
                                companyDisplayName={props.companyDisplayName ?? null}
                                startDate={props.startDate}
                                endDate={props.endDate}
                            />
                        </IsrRetenidoDrilldownCtx.Provider>
                    </AlertasSbcSdiDrilldownCtx.Provider>
                </RetrasosTimbradoDrilldownCtx.Provider>
            </UuidDuplicadosDrilldownCtx.Provider>
        </CanceladosDrilldownCtx.Provider>
    );
}

export type KpiTriggerClientBaseProps = Readonly<{
    className?: string;
    label?: string;
}>;

function _makeTriggerClassList(canInteract: boolean, customClassName?: string): string {
    return cn(
        KPI_TRIGGER_BTN_BASE_CLASS,
        canInteract && KPI_TRIGGER_BTN_INTERACTIVE_CLASS,
        customClassName,
    );
}

function _KpiDrilldownTriggerBase(
    ctx: { open: KpiDrilldownOpenFn } | null,
    props: KpiTriggerClientBaseProps & { defaultAriaLabel: string },
) {
    const canInteract = typeof ctx?.open === 'function';
    const openFn = canInteract ? ctx.open : undefined;
    return (
        <button
            type="button"
            aria-label={props.label ?? props.defaultAriaLabel}
            onClick={canInteract ? openFn : undefined}
            onKeyDown={canInteract && openFn ? _onKeyDownEnterSpace(openFn) : undefined}
            role={canInteract ? 'button' : undefined}
            tabIndex={canInteract ? 0 : undefined}
            disabled={!canInteract}
            className={_makeTriggerClassList(canInteract, props.className)}
        />
    );
}

export function KpiCanceladosTriggerClient(props: KpiTriggerClientBaseProps) {
    const ctx = useContext(CanceladosDrilldownCtx);
    return _KpiDrilldownTriggerBase(ctx, { ...props, defaultAriaLabel: 'Abrir reporte de CFDIs de nómina cancelados' });
}

export function KpiUuidDuplicadosTriggerClient(props: KpiTriggerClientBaseProps) {
    const ctx = useContext(UuidDuplicadosDrilldownCtx);
    return _KpiDrilldownTriggerBase(ctx, { ...props, defaultAriaLabel: 'Abrir reporte de UUIDs de nómina duplicados' });
}

export function KpiRetrasosTimbradoTriggerClient(props: KpiTriggerClientBaseProps) {
    const ctx = useContext(RetrasosTimbradoDrilldownCtx);
    return _KpiDrilldownTriggerBase(ctx, { ...props, defaultAriaLabel: 'Abrir reporte de retrasos de timbrado de nómina' });
}

export function KpiAlertasSbcSdiTriggerClient(props: KpiTriggerClientBaseProps) {
    const ctx = useContext(AlertasSbcSdiDrilldownCtx);
    return _KpiDrilldownTriggerBase(ctx, { ...props, defaultAriaLabel: 'Abrir reporte de alertas SBC / SDI de nómina' });
}

export function KpiIsrRetenidoTriggerClient(props: KpiTriggerClientBaseProps) {
    const ctx = useContext(IsrRetenidoDrilldownCtx);
    return _KpiDrilldownTriggerBase(ctx, { ...props, defaultAriaLabel: 'Abrir reporte de ISR retenido de nómina' });
}
