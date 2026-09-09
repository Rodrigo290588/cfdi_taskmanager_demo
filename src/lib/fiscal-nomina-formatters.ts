// ============================================================
// src/lib/fiscal-nomina-formatters.ts
//
// TASK 2 — Helpers puros, SIN 'use client'. Invocables desde
// Server Components async + Client Components vía re-exports.
// ============================================================

export type NominaNullableNumber = number | string | null | undefined;

function _fmtCoreParseNumber(n: NominaNullableNumber): number {
    if (n === null || n === undefined) return 0;
    const value = typeof n === 'string' ? Number.parseFloat(n) : Number(n);
    return Number.isFinite(value) ? value : 0;
}

export function fmtMxn(n: NominaNullableNumber, maxDigits = 2): string {
    const value = _fmtCoreParseNumber(n);
    return new Intl.NumberFormat('es-MX', {
        style: 'currency',
        currency: 'MXN',
        maximumFractionDigits: maxDigits,
    }).format(value);
}

export function fmtNum(n: NominaNullableNumber, digits = 0): string {
    const value = _fmtCoreParseNumber(n);
    return new Intl.NumberFormat('es-MX', { maximumFractionDigits: digits }).format(value);
}

export function fmtPct(n: NominaNullableNumber, digits = 1): string {
    const value = _fmtCoreParseNumber(n);
    return `${value.toFixed(digits)}%`;
}

export function fmtDateEs(date: Date | string | null | undefined): string {
    if (date === null || date === undefined) return '';
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString('es-MX', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
    });
}

export function fmtDiasDiferencia(dias: number | bigint | null | undefined): string {
    const value = Number(dias ?? 0);
    if (!Number.isFinite(value)) return '0 días';
    const rounded = Math.round(value);
    return `${rounded} ${rounded === 1 ? 'día' : 'días'}`;
}

export const FISCAL_NOM_PALETTE: readonly [string, string, string, string, string, string] = [
    '#0f766e', // emerald-700 (INFONAVIT)
    '#b45309', // amber-700 (FONACOT)
    '#7c3aed', // violet-600 (Pensión)
    '#be123c', // rose-700 (Sindicato)
    '#1d4ed8', // blue-700 (gravado)
    '#94a3b8', // slate-400 (exento)
] as const;
