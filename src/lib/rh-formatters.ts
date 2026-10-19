// ============================================================
// src/lib/rh-formatters.ts
// Formateadores puros (no UI) reutilizables en Client + Server.
// NO tienen 'use client' — invocables desde Server Async Components.
// Son idénticos a los helpers de rh-shared.tsx pero extraídos para
// respetar los boundaries de Next.js 16 (no llamar funciones cliente
// desde Server Components).
// ============================================================

export function fmtMxn(n: number | null | undefined, maxDigits = 0): string {
  const value = Number(n ?? 0);
  if (!Number.isFinite(value)) return '$0.00';
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: maxDigits,
    maximumFractionDigits: maxDigits,
  }).format(value);
}

export function fmtNum(n: number | null | undefined, digits = 1): string {
  const value = Number(n ?? 0);
  if (!Number.isFinite(value)) return '0';
  return new Intl.NumberFormat('es-MX', { maximumFractionDigits: digits }).format(value);
}

export function fmtPct(n: number | null | undefined, digits = 1): string {
  const value = Number(n ?? 0);
  if (!Number.isFinite(value)) return '0%';
  return `${value.toFixed(digits)}%`;
}

export function fmtDateEs(date: Date | string | null | undefined): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('es-MX', { timeZone: 'UTC', year: 'numeric', month: 'short', day: '2-digit' });
}
