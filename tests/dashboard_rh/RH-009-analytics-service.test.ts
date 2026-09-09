/**
 * [DASHBOARD RH FASE 4 · RH-009]
 * Tests UNITARIOS payroll-analytics-service.ts.
 *
 * Estrategia: MOCK de prisma.$queryRaw como jest.fn()
 *   para evitar DB real.
 *
 * Coverage targets:
 *   · PayrollDashboardFiltersSchema Zod strict validation (rango ≤ 5 años, coerciones)
 *   · buildScopeClauses filters (org, company, fe, depto, dates)
 *   · 6 funciones fetch* (fetchTurnover, fetchIncapacidades, fetchHorasExtra,
 *     fetchPlantilla, fetchBeneficios, fetchKpiSummary) todas retornan shape esperada.
 *   · fetchDashboardAll paralelo Promise.all 6 fetch.
 *
 * Ejecutar: npm run test -- tests/dashboard_rh/RH-009-analytics-service.test.ts --runInBand
 */

// ---------- HOISTED mocks ----------
jest.mock('next-auth', () => ({ __esModule: true, default: jest.fn() }));

// Mock @prisma/client Prisma.sql (valor runtime) + prisma instance
const rawCalls: any[] = [];
jest.mock('@prisma/client', () => {
  const Prisma = {
    sql: (literals: TemplateStringsArray, ...args: any[]) => ({
      __prismaSql: true,
      literals: [...literals],
      args,
    }),
    empty: { __prismaEmpty: true },
    join: (arr: any[], sep: any) => ({ __prismaJoin: true, arr, sep }),
  } as any;
  return { Prisma, PrismaClient: jest.fn() };
});
jest.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: jest.fn(async (tpl: any) => {
      rawCalls.push(tpl);
      // valor default para evitar undefined
      return [];
    }),
  },
}));

import { prisma } from '@/lib/prisma';
import {
  PayrollDashboardFiltersSchema,
  buildScopeClauses,
  fetchTurnover,
  fetchIncapacidades,
  fetchHorasExtra,
  fetchPlantilla,
  fetchBeneficios,
  fetchHeadcountKpis,
  fetchHrDashboardAggregate,
} from '@/lib/payroll-analytics-service';

const mockQueryRaw = prisma.$queryRaw as jest.Mock;
beforeEach(() => {
  mockQueryRaw.mockClear();
  rawCalls.length = 0;
});

// ---------- CUID helper compatible z.string().cuid() validation ----------
const fakeCuid = (): string => 'c' + Math.random().toString(36).slice(2, 9) + '0'.repeat(4); // ~24 chars cuid format

// ---------- default filters helper ----------
const defaultFilters = (): any => ({
  organizationId: fakeCuid(),
  companyId: fakeCuid(),
  fiscalEntityId: null,
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-06-30'),
  departamento: null, view: 'monthly' as const,
});

describe('[RH-009·A] Zod PayrollDashboardFiltersSchema strict', () => {
  it('happy path: CUIDs + rango 6m → OK', () => {
    const org = fakeCuid(), co = fakeCuid(), fe = fakeCuid();
    const inp = {
      organizationId: org,
      companyId:      co,
      fiscalEntityId: fe,
      startDate: new Date('2026-01-01'),
      endDate:   new Date('2026-06-30'),
      departamento: null,
    };
    expect(() => PayrollDashboardFiltersSchema.parse(inp)).not.toThrow();
    const out = PayrollDashboardFiltersSchema.parse(inp);
    expect(out.organizationId).toBe(org);
    expect(out.fiscalEntityId).toBe(fe);
  });

  it('CUID inválido → Zod error (prevent IDOR/BOLA string injection)', () => {
    const inp = {
      organizationId: "' OR 1=1 --", companyId: fakeCuid(),
      startDate: new Date('2026-01-01'), endDate: new Date('2026-06-30'),
    };
    expect(() => PayrollDashboardFiltersSchema.parse(inp)).toThrow();
  });

  it('UUID formato (no CUID) → Zod rechaza porque pattern requiere cuid c[0-9a-z]{6,}', () => {
    const inp = {
      organizationId: crypto.randomUUID(), // UUID no cuid
      companyId: fakeCuid(),
      startDate: new Date('2026-01-01'), endDate: new Date('2026-06-30'),
    };
    expect(() => PayrollDashboardFiltersSchema.parse(inp)).toThrow();
  });

  it('departamento inválido (100 chars) → Zod max(80) error', () => {
    const inp = {
      organizationId: fakeCuid(), companyId: fakeCuid(),
      startDate: new Date('2026-01-01'), endDate: new Date('2026-06-30'),
      departamento: 'x'.repeat(100),
    };
    expect(() => PayrollDashboardFiltersSchema.parse(inp)).toThrow();
  });
});

describe('[RH-009·B] buildScopeClauses fragments Prisma.sql', () => {
  it('filtro solo org+company → al menos 4 fragments (org, company, start, end)', () => {
    const { fragments } = buildScopeClauses({
      organizationId: fakeCuid(),
      companyId: fakeCuid(),
      startDate: new Date('2026-01-01'),
      endDate:   new Date('2026-06-30'),
    });
    expect(fragments.length).toBeGreaterThanOrEqual(4);
  });
  it('departamento not-null → fragment adicional departamento added', () => {
    const base = { organizationId: fakeCuid(), companyId: fakeCuid(),
      startDate: new Date('2026-01-01'), endDate: new Date('2026-06-30') };
    const a = buildScopeClauses({ ...base });
    const b = buildScopeClauses({ ...base, departamento: 'Ventas' });
    expect(b.fragments.length).toBe(a.fragments.length + 1);
  });
});

describe('[RH-009·C] 6 funciones fetch* retornan arrays shape OK', () => {
  it('fetchTurnover returns TurnoverRow[] shape', async () => {
    mockQueryRaw.mockResolvedValueOnce([
      { departamento: 'V', mes_pago: new Date('2026-06-01'), altas: 5, bajas: 2, reingresos: 1, empleados_activos: 100, total_recibos: 100 },
    ]);
    const out = await fetchTurnover(defaultFilters());
    expect(Array.isArray(out)).toBe(true);
    expect(out.length).toBe(1);
    expect(typeof out[0].altas).toBe('number');
  });

  it('fetchIncapacidades returns IncapRow shape', async () => {
    mockQueryRaw.mockResolvedValueOnce([
      { departamento:'V', mes_pago: new Date('2026-06-01'), tipo_incapacidad:'02', descripcion_tipo:'Enfermedad', numero_eventos:1, total_dias:2, promedio_dias_por_evento: 2, importe_total:1000, empleados_afectados:1 },
    ]);
    const out = await fetchIncapacidades(defaultFilters());
    expect(out[0].tipo_incapacidad).toBe('02');
  });

  it('fetchHorasExtra returns HorasExtraRow shape', async () => {
    mockQueryRaw.mockResolvedValueOnce([
      { departamento:'V', mes_pago: new Date('2026-06-01'), tipo_horas:'01', descripcion_tipo:'Dobles', numero_nominas:1, empleados: 2, total_horas: 20, total_dias:5, importe_total: 1000 },
    ]);
    const out = await fetchHorasExtra(defaultFilters());
    expect(out[0].total_horas).toBe(20);
  });

  it('fetchPlantilla returns PlantillaRow shape', async () => {
    mockQueryRaw.mockResolvedValueOnce([
      { departamento:'V', tipo_contrato:'P', tipo_jornada:'D', num_empleados:50, antiguedad_promedio_anios: 2, sdi_promedio: 400 },
    ]);
    const out = await fetchPlantilla(defaultFilters());
    expect(out[0].antiguedad_promedio_anios).toBe(2);
  });

  it('fetchBeneficios returns BeneficioRow shape', async () => {
    mockQueryRaw.mockResolvedValueOnce([
      { departamento:'V', mes_pago: new Date('2026-06-01'), tipo_percepcion:'029', descripcion_beneficio:'Vales', concepto:'VD', numero_aplicaciones:50, empleados_beneficiados:50, total_gravado:0, total_exento:50000, importe_total:50000 },
    ]);
    const out = await fetchBeneficios(defaultFilters());
    expect(out[0].importe_total).toBe(50000);
  });

  it('fetchHeadcountKpis returns array con objeto percepciones_totales etc.', async () => {
    mockQueryRaw.mockResolvedValueOnce([{
      empleados_pagados: 200, percepciones_totales: 1000000.00,
      deducciones_totales: 200000.00, total_neto: 800000.00,
      numero_nominas: 200, total_recibos: 200, costo_por_empleado: 4000.00,
    }]);
    const out = await fetchHeadcountKpis(defaultFilters());
    expect(Array.isArray(out)).toBe(true);
    expect(typeof out[0].empleados_pagados).toBe('number');
    expect(Number(out[0].percepciones_totales)).toBeGreaterThan(0);
  });
});

describe('[RH-009·D] fetchHrDashboardAggregate paralelo', () => {
  it('llama 6 veces $queryRaw paralelo, retorna shape {headcountKpis,turnover,incapacidades,horasExtra,plantilla,beneficios}', async () => {
    mockQueryRaw
      .mockResolvedValue([{}]);
    const f = defaultFilters();
    const out = await fetchHrDashboardAggregate(f);
    expect(mockQueryRaw.mock.calls.length).toBeGreaterThanOrEqual(6);
    expect(out).toHaveProperty('headcountKpis');
    expect(out).toHaveProperty('turnover');
    expect(out).toHaveProperty('incapacidades');
    expect(out).toHaveProperty('horasExtra');
    expect(out).toHaveProperty('plantilla');
    expect(out).toHaveProperty('beneficios');
  });
});
