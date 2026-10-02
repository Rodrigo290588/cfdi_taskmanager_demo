// ============================================================
// src/lib/direccion-formatters.ts
// Formateadores PUROS para el Tablero RH Directivo.
//
// Reglas:
//   • NO contienen 'use client' (ejecutables Server + Client).
//   • 100% idempotentes: mismos inputs → mismos outputs.
//   • NO acceden a window/document/localStorage.
//   • NO dependen de React / hooks.
//
// SonarQube compliance:
//   • S6759: los consumidores definen Readonly<> donde reciben props.
//   • S4144: no duplicados vs rh-formatters (parámetros distintos).
// ============================================================

import { format, parseISO, isDate } from 'date-fns';
import { es } from 'date-fns/locale/es';
import type { Decimal } from '@prisma/client/runtime/library';

// ============================================================================
// MONEDA (MXN)
// ============================================================================

type Numeric = number | string | Decimal | null | undefined;

const toNum = (n: Numeric): number => {
  if (n === null || n === undefined || n === '') return 0;
  if (typeof n === 'number') return Number.isFinite(n) ? n : 0;
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
};

/**
 * Formato compacto $1,250,890 (sin decimales) — ideal para KPIs C-Level.
 * Usa Intl.NumberFormat es-MX con style=currency.
 */
export function fmtMxn(n: Numeric): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(toNum(n));
}

/**
 * Formato extendido $1,250,890.45 (2 decimales) — ideal para tablas y auditoría.
 */
export function fmtMxnFull(n: Numeric): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toNum(n));
}

// ============================================================================
// NÚMEROS GENERALES
// ============================================================================

export function fmtNum(n: Numeric, decimals: number = 0): string {
  return new Intl.NumberFormat('es-MX', {
    maximumFractionDigits: decimals,
    minimumFractionDigits: 0,
  }).format(toNum(n));
}

// ============================================================================
// PORCENTAJES
// ============================================================================

/**
 * Maneja ambos formatos: 0.184 → 18.4% o 18.4 → 18.4%.
 * Detecta auto si 0 < |n| ≤ 1 (fracción) o n ≥ 1 (porcentaje literal).
 */
export function fmtPct(n: Numeric, decimals: number = 1): string {
  const v = toNum(n);
  const abs = Math.abs(v);
  const pctVal = abs > 0 && abs <= 1 ? v * 100 : v;
  return `${pctVal.toFixed(decimals)}%`;
}

// ============================================================================
// FECHAS (locale es-ES)
// ============================================================================

type DateFormat = 'short' | 'month' | 'full';

/**
 * Formatea fecha ISO (YYYY-MM-DD) o Date a formato español.
 *   short  → 15/08/2026
 *   month  → ago/26       (para ejes X de gráficas históricas)
 *   full   → agosto 2026
 */
export function fmtDateEs(isoDate: string | Date, style: DateFormat = 'short'): string {
  try {
    let d: Date;
    if (isoDate instanceof Date) {
      d = isoDate;
    } else if (isDate(isoDate)) {
      d = isoDate as Date;
    } else {
      d = parseISO(String(isoDate).slice(0, 10));
    }
    
    if (!Number.isFinite(d.getTime())) return '—';
    
    switch (style) {
      case 'month':
        return format(d, 'MMM/yy', { locale: es }).replace('.', '');
      case 'full':
        return format(d, 'MMMM yyyy', { locale: es });
      case 'short':
      default:
        return format(d, 'dd/MM/yyyy');
    }
  } catch {
    return '—';
  }
}

// ============================================================================
// TENDENCIAS / DELTAS
// ============================================================================

export type TrendDirection = 'up' | 'down' | 'flat';

/**
 * Retorna la dirección de la tendencia basada en delta porcentual.
 * Umbral de insensibilidad: ±0.1% (0.001) → flat.
 */
export function trendIcon(pct: number | null | undefined): TrendDirection {
  const v = Number(pct ?? 0);
  if (v > 0.001) return 'up';
  if (v < -0.001) return 'down';
  return 'flat';
}

/**
 * Calcula delta absoluto y porcentual entre valor actual y anterior.
 * Si anterior <= 0 (evita división por cero y casos sin dato anterior),
 * retorna direction null y pctDelta null para UI badge "Sin comparativo".
 */
export function trendDeltaPct(
  actual: number,
  anterior: number,
): {
  direction: TrendDirection;
  pctDelta: number | null;
  absDelta: number;
} {
  const a = toNum(actual);
  const b = toNum(anterior);
  const absDelta = a - b;
  if (b === 0) {
    return { direction: 'flat', pctDelta: null, absDelta };
  }
  const pctDelta = absDelta / Math.abs(b);
  return { direction: trendIcon(pctDelta), pctDelta, absDelta };
}

// ============================================================================
// Status Badges (Desviación Presupuestal)
// ============================================================================

export type DesviacionStatus = 'EN_LINEA' | 'ATENCION' | 'FUERA_DE_PRESUPUESTO';

/**
 * Umbrales según documento Prompt del Tablero Directivo:
 *   |%desviación| ≤ 5%  → EN LÍNEA    (verde)
 *   5% < … ≤ 10%        → ATENCIÓN    (ámbar)
 *   > 10%                → FUERA DE PRESUPUESTO (rojo)
 */
export function statusFromDesviacionPct(pctDesviacion: number): DesviacionStatus {
  const abs = Math.abs(toNum(pctDesviacion));
  if (abs <= 0.05) return 'EN_LINEA';
  if (abs <= 0.10) return 'ATENCION';
  return 'FUERA_DE_PRESUPUESTO';
}

// ============================================================================
// Paleta consistente con tableros vecinos
// ============================================================================

export const DIRECCION_PALETTE = {
  primary: '#1e3a8a',
  secondary: '#64748b',
  fixed: '#16a34a',
  variable: '#ea580c',
  yoYLine: '#94a3b8',
  donut: [
    '#16a34a', '#ea580c', '#ca8a04', '#0891b2',
    '#7c3aed', '#db2777', '#0f766e',
  ] as const,
  statusEnLinea: '#16a34a',
  statusAtencion: '#d97706',
  statusFueraPresupuesto: '#dc2626',
  statusSinPresupuesto: '#64748b',
} as const;
