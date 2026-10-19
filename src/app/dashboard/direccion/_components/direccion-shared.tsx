// ============================================================
// src/app/dashboard/direccion/_components/direccion-shared.tsx
// Client Components reutilizados Tablero RH Directivo:
//   - KpiCardDireccion (tone-bar + icon + trend indicator)
//   - TrendIndicatorBadge · DireccionEmptyState · ChartCardDireccion
//
// Paquete 7.4 SonarQube Fixes · 3/3 warnings:
//   1) TONE_CLASSES_DIRECCION L22-L31 alineación vertical anti-pattern
//      (5 tones × 7 props = 35 espacios ambiguos) → limpiados 1 espacio.
//   2) TrendIndicatorBadge L55-L63 3 nested ternarios inline icon/tone/labelDelta
//      → 3 helpers nombrados: trendIconOf / trendToneOf / trendDeltaLabel
//   3) StatusDesviacionBadge × 4 if inline + EmptyState tone nested →
//      helpers statusBadgeClassOf + emptyToneBgClassOf + emptyToneCircleClassOf
// ============================================================
'use client';

import { memo, type ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  ArrowUpRight, ArrowDownRight, Minus, AlertTriangle, Info, HelpCircle,
} from 'lucide-react';
import {
  fmtPct,
} from '@/lib/direccion-formatters';

export type KpiToneDireccion =
  | 'slate' | 'blue' | 'amber' | 'emerald' | 'rose';

// ============================================================================
// TONE_CLASSES (Paquete 7.4 Fix #1 · 1 espacio después de ":" todas props)
// ============================================================================

type ToneClassBag = Readonly<{
  bar: string;
  textBar: string;
  accent: string;
  iconBg: string;
  iconColor: string;
  progressFrom: string;
  progressTo: string;
}>;

const TONE_CLASSES_DIRECCION: Record<KpiToneDireccion, ToneClassBag> = {
  slate: {
    bar: 'bg-slate-50 border-slate-200',
    textBar: 'text-slate-700',
    accent: 'text-slate-600',
    iconBg: 'bg-slate-100',
    iconColor: 'text-slate-600',
    progressFrom: 'from-slate-200',
    progressTo: 'to-slate-500',
  },
  blue: {
    bar: 'bg-blue-50 border-blue-200',
    textBar: 'text-blue-700',
    accent: 'text-blue-700',
    iconBg: 'bg-blue-100',
    iconColor: 'text-blue-700',
    progressFrom: 'from-blue-200',
    progressTo: 'to-blue-600',
  },
  amber: {
    bar: 'bg-amber-50 border-amber-200',
    textBar: 'text-amber-700',
    accent: 'text-amber-700',
    iconBg: 'bg-amber-100',
    iconColor: 'text-amber-700',
    progressFrom: 'from-amber-200',
    progressTo: 'to-amber-600',
  },
  emerald: {
    bar: 'bg-emerald-50 border-emerald-200',
    textBar: 'text-emerald-700',
    accent: 'text-emerald-700',
    iconBg: 'bg-emerald-100',
    iconColor: 'text-emerald-700',
    progressFrom: 'from-emerald-200',
    progressTo: 'to-emerald-600',
  },
  rose: {
    bar: 'bg-rose-50 border-rose-200',
    textBar: 'text-rose-700',
    accent: 'text-rose-700',
    iconBg: 'bg-rose-100',
    iconColor: 'text-rose-700',
    progressFrom: 'from-rose-200',
    progressTo: 'to-rose-600',
  },
};

export type TrendDirectionDireccion = 'up' | 'down' | 'flat';
export type TrendIndicatorProps = Readonly<{
  direction?: TrendDirectionDireccion;
  deltaPct?: number | null;
  absDelta?: number | string | null;
  labelPrev?: string | null;
  mode?: 'default' | 'reversed';
}>;

// ============================================================================
// HELPERS TREND INDICATOR (Paquete 7.4 Fix #2 · 3 ternarios nested L55-L63)
// ============================================================================

function resolveTrendDirection(props: TrendIndicatorProps): TrendDirectionDireccion {
  let dir: TrendDirectionDireccion = props.direction ?? 'flat';
  const deltaPct = props.deltaPct;
  if (typeof deltaPct === 'number' && dir === 'flat') {
    if (deltaPct > 0) dir = 'up';
    else if (deltaPct < 0) dir = 'down';
  }
  if (props.mode === 'reversed') {
    switch (dir) {
      case 'up':
        dir = 'down';
        break;
      case 'down':
        dir = 'up';
        break;
      default:
        dir = 'flat';
    }
  }
  return dir;
}

function trendIconOf(dir: TrendDirectionDireccion): ReactNode {
  if (dir === 'up') return <ArrowUpRight className="h-3.5 w-3.5" />;
  if (dir === 'down') return <ArrowDownRight className="h-3.5 w-3.5" />;
  return <Minus className="h-3.5 w-3.5" />;
}

function trendToneOf(dir: TrendDirectionDireccion): string {
  if (dir === 'up') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (dir === 'down') return 'bg-rose-50 text-rose-700 border-rose-200';
  return 'bg-slate-50 text-slate-700 border-slate-200';
}

function trendDeltaLabel(props: TrendIndicatorProps): string {
  const deltaPct = props.deltaPct;
  if (typeof deltaPct === 'number') return fmtPct(deltaPct, 1);
  if (props.absDelta) return String(props.absDelta);
  return 'Sin referencia';
}

// ============================================================================
// TrendIndicatorBadge (memo)
// ============================================================================

export const TrendIndicatorBadge = memo(function TrendIndicatorBadge(
  props: TrendIndicatorProps,
) {
  const dir = resolveTrendDirection(props);
  const icon = trendIconOf(dir);
  const tone = trendToneOf(dir);
  const labelDelta = trendDeltaLabel(props);
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone}`}>
      {icon}
      <span className="font-semibold">{labelDelta}</span>
      {props.labelPrev && (
        <span className="text-[10px] opacity-70 ml-0.5">· {props.labelPrev}</span>
      )}
    </span>
  );
});

// ============================================================================
// KpiCardDireccion
// ============================================================================

export type KpiCardDireccionProps = Readonly<{
  title: string;
  value: string;
  tone: KpiToneDireccion;
  icon?: ReactNode;
  description?: string;
  progressRatio?: number | null;
  trend?: ReactNode;
  footer?: ReactNode;
  tooltipText?: string;
  onClick?: () => void;
}>;

export const KpiCardDireccion = memo(function KpiCardDireccion(
  props: KpiCardDireccionProps,
) {
  const c = TONE_CLASSES_DIRECCION[props.tone];
  const prog = typeof props.progressRatio === 'number'
    ? Math.max(0, Math.min(1, props.progressRatio)) * 100
    : null;
  const cardClass = [
    'overflow-hidden border-border bg-card shadow-sm',
    props.onClick ? 'cursor-pointer hover:shadow-md transition-shadow' : '',
  ].filter(Boolean).join(' ');
  return (
    <Card
      className={cardClass}
      onClick={props.onClick}
      role={props.onClick ? 'button' : undefined}
    >
      <div className={`border-b ${c.bar} px-5 py-2.5 flex items-center justify-between`}>
        <div className={`text-[13px] font-semibold tracking-tight flex items-center gap-1.5 ${c.textBar}`}>
          {props.title}
          {props.tooltipText && (
            <div className="relative z-20">
              <TooltipProvider>
                <Tooltip delayDuration={300}>
                  <TooltipTrigger asChild>
                    <HelpCircle className="h-4 w-4 cursor-help opacity-70 hover:opacity-100 transition-opacity" />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[280px] bg-slate-800 text-white text-xs p-2 font-normal text-left">
                    <p>{props.tooltipText}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          )}
        </div>
      </div>
      <CardContent className="p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${c.iconBg} ${c.iconColor}`}>
            {props.icon ?? <Info className="h-5 w-5" />}
          </div>
          {props.trend}
        </div>
        <div className={`text-3xl font-extrabold tracking-tight ${c.accent}`}>
          {props.value}
        </div>
        {props.description && (
          <p className="text-[11.5px] text-muted-foreground leading-relaxed">
            {props.description}
          </p>
        )}
        {prog !== null && (
          <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
            <div
              className={`h-full rounded-full bg-gradient-to-r ${c.progressFrom} ${c.progressTo}`}
              style={{ width: `${prog}%` }}
            />
          </div>
        )}
        {props.footer}
      </CardContent>
    </Card>
  );
});

// ============================================================================
// HELPERS CHART CARD + EMPTY STATE (Paquete 7.4 Fix #3 · nested tone ternario)
// ============================================================================

type EmptyTone = 'amber' | 'slate' | 'blue' | 'rose' | 'emerald';

function emptyToneBgClassOf(tone: EmptyTone): string {
  if (tone === 'rose') return 'bg-rose-50 text-rose-700 border-rose-200';
  if (tone === 'amber') return 'bg-amber-50 text-amber-700 border-amber-200';
  if (tone === 'blue') return 'bg-blue-50 text-blue-700 border-blue-200';
  if (tone === 'emerald') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  return 'bg-slate-50 text-slate-700 border-slate-200';
}

function emptyToneCircleClassOf(tone: EmptyTone): string {
  if (tone === 'rose') return 'bg-rose-100 text-rose-600';
  if (tone === 'amber') return 'bg-amber-100 text-amber-600';
  if (tone === 'blue') return 'bg-blue-100 text-blue-600';
  if (tone === 'emerald') return 'bg-emerald-100 text-emerald-600';
  return 'bg-slate-100 text-slate-600';
}

// ============================================================================
// ChartCardDireccion
// ============================================================================

export function ChartCardDireccion({
  title,
  subtitle,
  right,
  badge,
  footer,
  children,
  className,
  minHeight,
}: Readonly<{
  title: string;
  subtitle?: string;
  right?: ReactNode;
  badge?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  minHeight?: number | string;
}>) {
  return (
    <Card
      className={`border-border bg-card shadow-sm ${className ?? ''}`}
      style={minHeight ? { minHeight } : undefined}
    >
      <div className="px-5 pt-4 pb-3 flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold leading-tight tracking-tight">
              {title}
            </h3>
            {badge}
          </div>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              {subtitle}
            </p>
          )}
        </div>
        {right && <div className="shrink-0">{right}</div>}
      </div>
      <div className="px-5 pb-4">
        {children}
      </div>
      {footer && (
        <div className="border-t border-slate-200 px-5 py-2.5 text-[11px] text-slate-500 leading-relaxed bg-slate-50/50">
          {footer}
        </div>
      )}
    </Card>
  );
}

// ============================================================================
// DireccionEmptyState
// ============================================================================

export function DireccionEmptyState({
  title,
  subtitle,
  hint,
  tone = 'amber',
}: Readonly<{
  title: string;
  subtitle?: string;
  hint?: string;
  tone?: EmptyTone;
}>) {
  const toneBg = emptyToneBgClassOf(tone);
  const toneCircle = emptyToneCircleClassOf(tone);
  return (
    <div className={`rounded-lg border border-dashed bg-white/60 p-6 text-center ${toneBg}`}>
      <div className={`mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full ${toneCircle}`}>
        <AlertTriangle className="h-5 w-5" />
      </div>
      <div className="text-sm font-semibold">{title}</div>
      {subtitle && <p className="text-xs mt-1 opacity-90 leading-relaxed">{subtitle}</p>}
      {hint && <p className="text-[11px] mt-2 opacity-80 leading-relaxed">{hint}</p>}
    </div>
  );
}

// ============================================================================
// Badge Status Desviación (Paquete 7.4 Fix #3 · Helper statusBadgeClassOf)
// ============================================================================

export type BadgeStatusDesviacion = 'EN_LINEA' | 'ATENCION' | 'FUERA_DE_PRESUPUESTO' | 'SIN_PRESUPUESTO';

function statusBadgeClassOf(status: BadgeStatusDesviacion): string {
  if (status === 'EN_LINEA') {
    return 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-50 font-semibold';
  }
  if (status === 'ATENCION') {
    return 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-50 font-semibold';
  }
  if (status === 'FUERA_DE_PRESUPUESTO') {
    return 'bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-50 font-semibold';
  }
  return 'text-slate-600 border-slate-300 font-semibold';
}

export function StatusDesviacionBadge({ status }: Readonly<{ status: BadgeStatusDesviacion }>) {
  if (status === 'EN_LINEA') {
    return <Badge className={statusBadgeClassOf(status)}>En línea</Badge>;
  }
  if (status === 'ATENCION') {
    return <Badge className={statusBadgeClassOf(status)}>Atención</Badge>;
  }
  if (status === 'FUERA_DE_PRESUPUESTO') {
    return <Badge className={statusBadgeClassOf(status)}>Fuera de presupuesto</Badge>;
  }
  return <Badge variant="outline" className={statusBadgeClassOf(status)}>Sin presupuesto</Badge>;
}

// Paleta movida a direccion-formatters.ts

export { fmtPct };
