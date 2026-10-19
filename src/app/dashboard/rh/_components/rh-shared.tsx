// ============================================================
// src/app/dashboard/rh/_components/rh-shared.tsx
// Client Components reutilizados en el Tablero RH:
//   - KpiCardRh (homologado visualmente a dashboard_fiscal:
//     barra de título color arriba + icono 12x12 centrado +
//     CardContent p-6 flex-col items-center justify-center).
//   - TrendBadge, ChartPlaceholder.
//   - ChartCard, RhEmptyState (compatibilidad con los ejes:
//     Turnover / Incapacidades / Horas Extra / Plantilla / Beneficios).
// ============================================================
'use client';

import { memo, type ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowDownRight, ArrowUpRight, Minus, AlertTriangle, Info } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export type KpiTone =
  | 'blue' | 'emerald' | 'amber' | 'rose' | 'violet' | 'indigo'
  | 'sky'  | 'teal'    | 'cyan'  | 'pink' | 'fuchsia' | 'slate';

const TONE_CLASSES: Record<KpiTone, { bar: string; text: string; icon: string }> = {
  blue:    { bar: 'bg-blue-600/10',     text: 'text-blue-600',  icon: 'text-blue-500' },
  emerald: { bar: 'bg-emerald-600/10',  text: 'text-emerald-600', icon: 'text-emerald-500' },
  amber:   { bar: 'bg-amber-600/10',    text: 'text-amber-600',   icon: 'text-amber-500' },
  rose:    { bar: 'bg-rose-600/10',     text: 'text-rose-600',    icon: 'text-rose-500' },
  violet:  { bar: 'bg-violet-600/10',   text: 'text-violet-600',  icon: 'text-violet-500' },
  indigo:  { bar: 'bg-indigo-600/10',   text: 'text-indigo-600',  icon: 'text-indigo-500' },
  sky:     { bar: 'bg-sky-600/10',      text: 'text-sky-600',     icon: 'text-sky-500' },
  teal:    { bar: 'bg-teal-600/10',     text: 'text-teal-600',    icon: 'text-teal-500' },
  cyan:    { bar: 'bg-cyan-600/10',     text: 'text-cyan-600',    icon: 'text-cyan-500' },
  pink:    { bar: 'bg-pink-600/10',     text: 'text-pink-600',    icon: 'text-pink-500' },
  fuchsia: { bar: 'bg-fuchsia-600/10',  text: 'text-fuchsia-600', icon: 'text-fuchsia-500' },
  slate:   { bar: 'bg-slate-600/10',    text: 'text-slate-600',   icon: 'text-slate-500' },
};

export type TrendDirection = 'up' | 'down' | 'flat';

export type TrendBadgeProps = {
  direction?: TrendDirection;
  delta?: string | null;
  label?: string | null;
  value?: number | null;
  previous?: number | null;
  mode?: 'default' | 'reversed';
  format?: 'percent' | 'numeric' | 'currency';
  dateRange?: { from: string; to: string };
};

function getTrendDirection(change: number, mode?: 'default' | 'reversed'): TrendDirection {
  if (change === 0) return 'flat';
  
  const isUp = change > 0;
  if (mode === 'reversed') {
    return isUp ? 'down' : 'up';
  }
  return isUp ? 'up' : 'down';
}

function calculateTrendState(props: TrendBadgeProps) {
  let direction: TrendDirection = props.direction ?? 'flat';
  let delta: string | null | undefined = props.delta;
  let label: string | null | undefined = props.label;

  if (typeof props.value === 'number') {
    const v = Number(props.value || 0);
    const p = Number(props.previous || 0);
    
    if (p > 0) {
      const change = ((v - p) / p) * 100;
      direction = getTrendDirection(change, props.mode);
      
      const sign = change >= 0 ? '+' : '';
      delta = delta ?? `${sign}${change.toFixed(1)}%`;
      label = label ?? `vs ${Math.round(p)} ref`;
    } else if (v > 0) {
      direction = 'up';
      delta = delta ?? `+${v.toFixed(1)}`;
      label = label ?? 'Sin referencia previa';
    }
  }

  return { direction, delta, label };
}

export const TrendBadge = memo(function TrendBadge(props: TrendBadgeProps) {
  const { direction, delta, label } = calculateTrendState(props);

  let icon = <Minus className="h-3.5 w-3.5" />;
  let toneClass = 'bg-slate-50 text-slate-700 border-slate-200';

  if (direction === 'up') {
    icon = <ArrowUpRight className="h-3.5 w-3.5" />;
    toneClass = 'bg-emerald-50 text-emerald-700 border-emerald-200';
  } else if (direction === 'down') {
    icon = <ArrowDownRight className="h-3.5 w-3.5" />;
    toneClass = 'bg-rose-50 text-rose-700 border-rose-200';
  }

  const badgeContent = (
    <div className="flex flex-col items-center gap-1">
      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${toneClass}`}>
        {icon}
        <span>{delta ?? 'Sin tendencia'}</span>
      </span>
      {label && <span className="text-[10px] text-muted-foreground">{label}</span>}
    </div>
  );

  if (props.dateRange) {
    return (
      <TooltipProvider>
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <div className="cursor-help">
              {badgeContent}
            </div>
          </TooltipTrigger>
          <TooltipContent className="text-xs p-3">
            <p className="font-semibold mb-1">Comparación vs periodo anterior</p>
            <p className="text-muted-foreground">
              Del {props.dateRange.from} al {props.dateRange.to}
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return badgeContent;
});

export interface KpiCardRhProps {
  readonly title: string;
  readonly value: string | number;
  readonly icon: ReactNode;
  readonly tone?: KpiTone;
  readonly subtext?: string;
  readonly trend?: ReactNode;
  readonly trendDirection?: 'up' | 'down' | 'flat';
  readonly trendDelta?: string;
  readonly trendLabel?: string;
  readonly tooltipText?: string;
  readonly onClick?: () => void;
}

export const KpiCardRh = memo(function KpiCardRh({
  title,
  value,
  tone = 'blue',
  icon,
  subtext,
  trendDirection,
  trendDelta,
  trendLabel,
  onClick,
  trend,
  tooltipText,
}: KpiCardRhProps) {
  const classes = TONE_CLASSES[tone];
  return (
    <Card
      className={`overflow-hidden border border-border bg-card ${onClick ? 'cursor-pointer hover:shadow-md transition-shadow trae-browser-inspect-draggable' : 'shadow-md transition-shadow hover:shadow-lg trae-browser-inspect-draggable'}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className={`${classes.bar} p-2 text-center border-b border-border relative`}>
        <h3 className={`${classes.text} font-bold text-base leading-tight min-h-[28px] flex items-center justify-center gap-1.5`}>
          {title}
          {tooltipText && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" onClick={(e) => e.stopPropagation()} className="cursor-help hover:opacity-80 border-none bg-transparent p-0 flex items-center justify-center">
                    <Info className="h-4 w-4 opacity-70" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" align="center" className="max-w-[260px] text-xs font-normal text-center">
                  <p>{tooltipText}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </h3>
      </div>
      <CardContent className="p-6 flex flex-col items-center justify-center space-y-2">
        <div className={classes.icon}>
          {icon}
        </div>
        <div className="text-2xl font-bold text-foreground">{value}</div>
        {((trendDirection || trendLabel) && !trend) && (
          <div className="flex items-center gap-2">
            {trendDirection && (
              <TrendBadge direction={trendDirection} delta={trendDelta} label={trendLabel} />
            )}
            {subtext && (
              <span className="text-xs text-muted-foreground leading-tight">{subtext}</span>
            )}
          </div>
        )}
        {(!trendDirection && !trendLabel) && subtext && (
          <span className="text-xs text-muted-foreground leading-tight">{subtext}</span>
        )}
        {trend}
      </CardContent>
    </Card>
  );
});

export const ChartPlaceholder = memo(function ChartPlaceholder({
  label,
  subtitle,
}: {
  label: string;
  subtitle?: string;
}) {
  return (
    <Card className="border border-border bg-card">
      <CardContent className="p-4">
        <div className="text-sm font-semibold text-slate-700">{label}</div>
        {subtitle && <div className="text-xs text-slate-500 mt-0.5">{subtitle}</div>}
        <div className="mt-4 grid grid-cols-12 gap-2 items-end h-40">
          {Array.from({ length: 12 }).map((_, i) => {
            const h = 20 + (((i * 37) % 80));
            return (
              <div key={i} className="flex flex-col items-center gap-1">
                <div
                  className="w-full rounded-t bg-indigo-500/20 border border-indigo-300/30"
                  style={{ height: `${h}%` }}
                />
                <span className="text-[10px] text-slate-400 font-mono">M{i + 1}</span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
});

export interface ChartCardProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly right?: ReactNode;
  readonly badge?: ReactNode;
  readonly footer?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
  readonly minHeight?: number | string;
  readonly style?: React.CSSProperties;
}

export function ChartCard({
  title,
  subtitle,
  right,
  badge,
  footer,
  children,
  className,
  minHeight,
  style,
}: ChartCardProps) {
  const rootStyle: React.CSSProperties = {
    ...style,
    ...(minHeight ? { minHeight } : {})
  };
  return (
    <Card style={Object.keys(rootStyle).length ? rootStyle : undefined}
      className={`border border-border bg-card ${className ?? ''}`}>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base font-semibold leading-tight">
              {title}
            </CardTitle>
            {badge}
          </div>
          {subtitle && (
            <div className="text-xs text-muted-foreground mt-1 leading-relaxed">
              {subtitle}
            </div>
          )}
        </div>
        {right && <div className="ml-3 shrink-0">{right}</div>}
      </CardHeader>
      <CardContent className={`p-4 ${footer ? 'pb-2 pt-1' : 'pt-1'}`}>
        {children}
      </CardContent>
      {footer && (
        <div className="border-t border-slate-200 px-4 py-2 text-[11px] text-slate-500 leading-relaxed">
          {footer}
        </div>
      )}
    </Card>
  );
}

export interface RhEmptyStateProps {
  readonly icon?: ReactNode;
  readonly title: string;
  readonly subtitle?: string;
  readonly message?: string;
  readonly hint?: string;
}

export function RhEmptyState({
  icon,
  title,
  subtitle,
  message,
  hint,
}: RhEmptyStateProps) {
  const bodyText = subtitle ?? message;
  return (
    <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/60 p-6 text-center">
      <div className="mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-500">
        {icon ?? <AlertTriangle className="h-5 w-5" />}
      </div>
      <div className="text-sm font-semibold text-slate-800">{title}</div>
      {bodyText && <div className="text-xs text-slate-600 mt-1 leading-relaxed">{bodyText}</div>}
      {hint && <div className="text-[11px] text-slate-500 mt-2 leading-relaxed">{hint}</div>}
    </div>
  );
}

export { fmtMxn, fmtNum, fmtPct, fmtDateEs } from '@/lib/rh-formatters';
export { RH_PALETTE } from '@/lib/payroll-analytics-ui-helpers';
