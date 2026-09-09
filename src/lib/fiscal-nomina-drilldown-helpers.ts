import type { RefinementCtx } from 'zod';

export const DRILLDOWN_DEFAULT_PAGE_SIZE = 500;
export const DRILLDOWN_MAX_PAGE_SIZE = 2000;
export const DRILLDOWN_MAX_RANGO_DIAS = 366 * 5;
export const DRILLDOWN_ID_REGEX = /^[A-Za-z\d_-]{8,40}$/;

function _safeNumCore(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function safeNum(v: unknown, fb = 0): number {
  return _safeNumCore(v) ?? fb;
}

export function safeNumOrNull(v: unknown, fb: number | null = null): number | null {
  return _safeNumCore(v) ?? fb;
}

function _safeStrCore(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  switch (typeof v) {
    case 'string': return v;
    case 'bigint':
    case 'number':
    case 'boolean': return String(v);
    default: return null;
  }
}

export function safeStr(v: unknown): string {
  return _safeStrCore(v) ?? '';
}

export function safeStrOrNull(v: unknown): string | null {
  return _safeStrCore(v) ?? null;
}

export function safeIso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  let ds: string | null = null;
  if (v instanceof Date) ds = safeStr(v.getTime());
  else {
    const t = typeof v;
    if (t === 'string' || t === 'number' || t === 'bigint') ds = safeStr(v);
  }
  if (ds == null) return null;
  try {
    const d = new Date(ds);
    if (!Number.isFinite(d.getTime())) return null;
    return d.toISOString();
  } catch { return null; }
}

export function refineFiscalNominaDateRange(
  v: { startDate: Date; endDate: Date },
  c: RefinementCtx,
  maxRangoDias = DRILLDOWN_MAX_RANGO_DIAS,
) {
  if (v.endDate.getTime() < v.startDate.getTime()) {
    c.addIssue({ code: 'custom', message: 'endDate debe ser >= startDate' });
  }
  const diff = (v.endDate.getTime() - v.startDate.getTime()) / 86_400_000;
  if (diff > maxRangoDias) {
    c.addIssue({ code: 'custom', message: `Rango máximo ${maxRangoDias} días (5 años)` });
  }
}

export function formatZodIssuesSafe<T>(parseResult: { success: false; error: { issues: Array<{ message: string; path: ReadonlyArray<string | number | symbol> }> } }): { fieldErrors: Partial<Record<keyof T, string[]>>; formErrors: string[] } {
  const fieldErrors: Partial<Record<keyof T, string[]>> = {};
  const formErrors: string[] = [];
  for (const issue of parseResult.error.issues) {
    if (issue.path.length === 0) {
      formErrors.push(issue.message);
    } else {
      const key = safeStr(issue.path[0]) as keyof T;
      if (!fieldErrors[key]) fieldErrors[key] = [];
      fieldErrors[key]!.push(issue.message);
    }
  }
  return { fieldErrors, formErrors };
}

export type FlattenLike<T> = ReturnType<typeof formatZodIssuesSafe<T>>;
