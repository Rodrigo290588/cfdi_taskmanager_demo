/**
 * [DASHBOARD RH FASE 4 · RH-008]
 * Tests unitarios rh-dashboard-url.ts.
 *
 * Cubrimiento:
 *   · parseRhSearchParams fail-closed (valores inválidos → defaults)
 *   · RH_URL_ALLOW_DEPARTAMENTO regex sanitización
 *   · view allow-list monthly/quarterly/yearly
 *   · rango invertido startDate > endDate → swap (no crash)
 *   · buildRhDashboardUrl (URLSearchParams · DASH-SAST-006 · XSS injection null)
 *   · rhCacheKey determinista :: separado
 *
 * Ejecutar: npm run test -- tests/dashboard_rh/RH-008-rh-url.test.ts --runInBand
 */

jest.mock('next-auth', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('@/lib/prisma', () => ({ prisma: {} }));

import {
  parseRhSearchParams,
  buildRhDashboardUrl,
  rhCacheKey,
  RH_URL_ALLOW_DEPARTAMENTO,
  RH_VIEW_MODES,
  RH_DEFAULT_REVALIDATE_SECONDS,
} from '@/lib/rh-dashboard-url';
import { parseISO, formatISO, startOfMonth, subMonths, endOfMonth } from 'date-fns';

describe('[RH-008·A] parseRhSearchParams · default values & fail-closed', () => {
  it('null / undefined raw params → default 6 meses rango + departamento=null + view=monthly', () => {
    const out = parseRhSearchParams(undefined);
    expect(out.view).toBe('monthly');
    expect(out.departamento).toBeNull();
    expect(out.startDate.length).toBe(10); // fecha ISO YYYY-MM-DD
    expect(out.endDate.length).toBe(10);
    // startDate = 6 meses antes inicio mes actual
    const expectedStart = formatISO(subMonths(startOfMonth(new Date()), 6), { representation: 'date' });
    expect(out.startDate).toBe(expectedStart);
    expect(out.endDate).toBe(formatISO(endOfMonth(new Date()), { representation: 'date' }));
  });

  it('startDate > endDate → SWAP (fail-safe, no crash)', () => {
    const out = parseRhSearchParams({ startDate: '2026-12-01', endDate: '2026-01-01' });
    expect(parseISO(out.startDate).getTime()).toBeLessThan(parseISO(out.endDate).getTime());
  });

  it('startDate garbage "not-a-date" → default safe', () => {
    const out = parseRhSearchParams({ startDate: 'not-a-date' });
    expect(parseISO(out.startDate).getTime()).toBeGreaterThan(0);
  });

  it('departamento regex allow 1-80 chars alfanum+acentosÑ+punct allowlisted', () => {
    // Regla allowlist: [A-Za-z0-9 ÑñáéíóúÁÉÍÓÚÜü.,_/-]
    const validos = [
      'Ventas CDMX',
      'Recursos_Humanos-2',
      'Dirección Jurídica Ñoño',
      'Planta.Producción/Norte_01',
      'A',
      'a'.repeat(80),
    ];
    for (const v of validos) {
      expect(RH_URL_ALLOW_DEPARTAMENTO.test(v)).toBe(true);
      const out = parseRhSearchParams({ departamento: v });
      expect(out.departamento).toBe(v);
    }
  });

  it('departamento regex BLOCK empty / >80 chars / peligrosos XSS SQL / null-byte', () => {
    const invalidos = [
      { v: '', why: 'empty length 0' },
      { v: 'a'.repeat(81), why: 'length 81 > 80' },
      { v: 'Ventas; DROP TABLE', why: 'semicolon SQL injection' },
      { v: 'Ventas<script>alert(1)</script>', why: 'angle brackets HTML/XSS' },
      { v: 'Ventas<IFRAME SRC=x>', why: 'iframe HTML injection' },
      { v: "Ventas' OR 1=1 --", why: 'single-quote SQLi' },
      { v: "Ventas\x00NullByte", why: 'null-byte poison' },
      { v: 'Ventas$%&', why: '$%& symbols fuera allowlist' },
      { v: 'Ventas{jndi:ldap}', why: 'curlies Log4j-style' },
      { v: 'Ventas\\foo\\bar', why: 'backslash not in allowlist' },
      { v: 'Ventas|pipe|separador', why: 'pipe not in allowlist' },
    ];
    for (const { v } of invalidos) {
      const pass = RH_URL_ALLOW_DEPARTAMENTO.test(v) && v.length <= 80 && v.length >= 1;
      expect(pass).toBe(false);
      const out = parseRhSearchParams({ departamento: v });
      expect(out.departamento).toBeNull();
    }
  });

  it('view allow-list monthly|quarterly|yearly · invalido → monthly', () => {
    expect(RH_VIEW_MODES).toEqual(['monthly','quarterly','yearly']);
    for (const v of RH_VIEW_MODES) {
      expect(parseRhSearchParams({ view: v }).view).toBe(v);
    }
    // invalidas:
    for (const bad of ['weekly', 'pentayearly', '1;DROP', 'monthly1', '']) {
      expect(parseRhSearchParams({ view: bad }).view).toBe('monthly');
    }
  });

  it('arrays en search params → read primer valor (fail-closed)', () => {
    // Next.js a veces pasa string[]
    const out = parseRhSearchParams({ departamento: ['Ventas', 'Operaciones'] as any });
    expect(out.departamento).toBe('Ventas');
  });
});

describe('[RH-008·B] buildRhDashboardUrl · DASH-SAST-006 URLSearchParams safe', () => {
  it('base sin params = retorna base misma (no ? vacío)', () => {
    expect(buildRhDashboardUrl('/dashboard/rh')).toBe('/dashboard/rh');
  });
  it('null/undefined/empty string no se agregan', () => {
    const s = buildRhDashboardUrl('/a', { x: null, y: undefined, z: '' });
    expect(s).not.toContain('?');
  });
  it('boolean true=1 false=0', () => {
    const s = buildRhDashboardUrl('/r', { ok: true, nope: false });
    expect(s).toContain('ok=1');
    expect(s).toContain('nope=0');
  });
  it('encodea especial: espacio → + o %20 (URLSearchParams standard)', () => {
    const s = buildRhDashboardUrl('/d', { departamento: 'Ventas CDMX' });
    expect(s).toContain('departamento=Ventas');
    expect(s).toMatch(/Ventas(?:\+|%20)CDMX/);
  });
  it('NO permite XSS a través de params (URLSearchParams encodea <script>)', () => {
    const s = buildRhDashboardUrl('/r', { view: '<script>alert(1)</script>' });
    expect(s).not.toContain('<script>');
    expect(s).toContain('%3Cscript%3E');
  });
  it('números se convierten a String sin error', () => {
    const s = buildRhDashboardUrl('/r', { page: 3, limit: 100 });
    expect(s).toContain('page=3&limit=100');
  });
});

describe('[RH-008·C] rhCacheKey determinista', () => {
  it('keys identicas → mismo cacheKey (idempotencia)', () => {
    const p = {
      organizationId: 'org-1', companyId: 'co-2', fiscalEntityId: 'fe-3',
      departamento: 'Ventas', startDate: '2026-01-01', endDate: '2026-06-30',
    };
    const a = rhCacheKey(p); const b = rhCacheKey(p);
    expect(a).toBe(b);
    expect(a.startsWith('rh-dashboard::')).toBe(true);
    expect(a.split('::').length).toBe(7);
  });
  it('fiscalEntityId/departamento null → wildcard *', () => {
    const a = rhCacheKey({
      organizationId: 'o', companyId: 'c', startDate: '2026-01-01', endDate: '2026-06-30',
      fiscalEntityId: null, departamento: null,
    });
    expect(a).toContain('::*::*::');
  });
  it('keys cambian → cacheKey distinta', () => {
    const base = { organizationId:'o', companyId:'c', startDate:'2026-01-01', endDate:'2026-06-30' };
    const a = rhCacheKey({...base, departamento: 'Ventas'});
    const b = rhCacheKey({...base, departamento: 'Operaciones'});
    expect(a).not.toBe(b);
  });
});

describe('[RH-008·D] constantes revalidate', () => {
  it('RH_DEFAULT_REVALIDATE_SECONDS = 60 (1 min SWR edge)', () => {
    expect(RH_DEFAULT_REVALIDATE_SECONDS).toBe(60);
  });
});
