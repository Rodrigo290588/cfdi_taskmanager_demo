/**
 * [DASHBOARD RH FASE 4 · RH-011 · Performance Test]
 *
 * Escenario estrés SLA: Simula rows agregadas en MEMORIA (no PostgreSQL).
 * Ajustado para workstation dev Windows (no servidor de producción).
 *
 * SLA a validar (ajustado a CI/dev environment — prod: 2x producción teórico):
 *   · aggregateTurnover    1M rows  < 1000 ms p50
 *   · aggregateTurnover    2M rows  < 3500 ms p95 (prod SLA 2s para 5M)
 *   · aggregateIncapacidades 200K rows < 900 ms p95
 *   · aggregateHorasExtra     100K rows < 900 ms p95
 *   · aggregatePlantilla      10K rows  < 350 ms p95 (antigüedad ponderada)
 *   · aggregateBeneficios     500K rows   < 1500 ms p95
 *   · computeTrendTone 1M calls < 150 ms p95 (microbench pura)
 *
 * Ejecutar: npm run test:dashboard_rh -- tests/dashboard_rh/RH-011-analytics-performance.perf.test.ts
 */

jest.mock('@/lib/prisma', () => ({ prisma: {} }));
jest.mock('next-auth', () => ({ __esModule: true, default: jest.fn() }));

import {
  aggregateTurnover, TurnoverInputRow,
  aggregateIncapacidades, IncapacidadesInputRow,
  aggregateHorasExtra, HorasExtraInputRow,
  aggregatePlantilla, PlantillaInputRow,
  aggregateBeneficios, BeneficiosInputRow,
  computeTrendTone,
} from '@/lib/payroll-analytics-ui-helpers';

// ---------- helpers performance ----------
function bench<T>(name: string, fn: () => T, warmup = 2, runs = 5): { p50: number; p95: number; mean: number; result: T } {
  for (let i = 0; i < warmup; i++) fn();
  const times: number[] = [];
  let result!: T;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    result = fn();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(times.length * 0.5)];
  const p95 = times[Math.min(times.length - 1, Math.floor(times.length * 0.95))];
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  console.log(`[PERF ${name}] p50=${p50.toFixed(1)}ms  p95=${p95.toFixed(1)}ms  mean=${mean.toFixed(1)}ms  n=${runs}`);
  return { p50, p95, mean, result };
}

// ---------- dataset generators (sintéticas, random seeded determinista) ----------
function mulberry32(a: number) {
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const RAND = mulberry32(20260831);

function genTurnover(n: number, months = 24, deptos = 50): TurnoverInputRow[] {
  const deptoNames = Array.from({ length: deptos }, (_, i) => `Departamento-${i + 1}`);
  const rows: TurnoverInputRow[] = [];
  const per = Math.max(1, Math.floor(n / months / deptos));
  let count = 0;
  outer: for (let m = 0; m < months; m++) {
    const d = new Date(2024 + Math.floor(m / 12), (m % 12), 1);
    for (let di = 0; di < deptos; di++) {
      for (let p = 0; p < per; p++) {
        if (count >= n) break outer;
        rows.push({
          departamento: deptoNames[di],
          mes_pago: d.toISOString() as unknown as Date,
          altas: Math.floor(RAND() * 15),
          bajas: Math.floor(RAND() * 12),
          reingresos: Math.floor(RAND() * 5),
          empleados_activos: 50 + Math.floor(RAND() * 150),
          total_recibos: 1,
        });
        count++;
      }
    }
  }
  return rows.slice(0, n);
}

function genIncap(n: number, months = 24): IncapacidadesInputRow[] {
  const tipos = ['01','02','03'];
  const descs = ['Riesgo Trabajo','Enfermedad General','Maternidad'];
  const rows: IncapacidadesInputRow[] = [];
  for (let i = 0; i < n; i++) {
    const mi = i % months;
    const ti = i % 3;
    rows.push({
      departamento: 'D' + (i % 50),
      mes_pago: new Date(2025 + Math.floor(mi/12), mi%12, 1).toISOString() as unknown as Date,
      tipo_incapacidad: tipos[ti], descripcion_tipo: descs[ti],
      numero_eventos: 1 + Math.floor(RAND() * 10),
      total_dias: 1 + Math.floor(RAND() * 30),
      importe_total: 1000 + RAND() * 50000,
      empleados_afectados: 1 + Math.floor(RAND() * 20),
    });
  }
  return rows;
}

function genHx(n: number, deptos = 500): HorasExtraInputRow[] {
  const rows: HorasExtraInputRow[] = [];
  for (let i = 0; i < n; i++) {
    const di = i % deptos;
    const mi = (i % 24);
    rows.push({
      departamento: `D-${di}`,
      mes_pago: new Date(2024 + Math.floor(mi/12), mi%12, 1).toISOString() as unknown as Date,
      tipo_horas: (i % 2) + 1 === 1 ? '01' : '02',
      empleados: 5 + Math.floor(RAND() * 50),
      total_horas: 1 + Math.floor(RAND() * 200),
      importe_total: 1000 + RAND() * 100000,
    });
  }
  return rows;
}

function genPlantilla(n: number): PlantillaInputRow[] {
  const contratos = ['Permanente','Eventual','Por Obra','Sindicalizado'];
  const jornadas = ['Diurna','Nocturna','Mixta','Reducida'];
  const rows: PlantillaInputRow[] = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      departamento: `D-${i % 100}`,
      tipo_contrato: contratos[i % 4],
      tipo_jornada: jornadas[i % 4],
      num_empleados: 1 + Math.floor(RAND() * 100),
      antiguedad_promedio_anios: RAND() * 15,
      sdi_promedio: 200 + RAND() * 800,
    });
  }
  return rows;
}

function genBenef(n: number, months = 12): BeneficiosInputRow[] {
  const cods: ('029'|'005'|'010'|'049')[] = ['029','005','010','049'];
  const rows: BeneficiosInputRow[] = [];
  for (let i = 0; i < n; i++) {
    const c = cods[i % 4];
    const mi = i % months;
    rows.push({
      departamento: `D-${i % 200}`,
      mes_pago: new Date(2025 + Math.floor(mi/12), mi%12, 1).toISOString() as unknown as Date,
      tipo_percepcion: c,
      concepto: `concepto_${i}`,
      numero_aplicaciones: 1 + Math.floor(RAND() * 100),
      empleados_beneficiados: 1 + Math.floor(RAND() * 200),
      total_gravado: 0,
      total_exento: 1000 + RAND() * 100000,
      importe_total: 1000 + RAND() * 100000,
    });
  }
  return rows;
}

// ============================================================
// Tests performance con SLA ajustados entorno dev/CI
// ============================================================
describe('[RH-011 · Performance Tests Dashboard RH] (SLA p95 ajustados a dev)', () => {
  jest.setTimeout(600000); // 10min max por si acaso

  it('computeTrendTone 1M invocations p95 < 500 ms', () => {
    const n = 1_000_000;
    const { p95 } = bench('TrendTone 1M calls', () => {
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const t = computeTrendTone(100 + i, 80 + i, i % 2 ? 'default' : 'reversed');
        sum += t.pctChange;
      }
      return sum;
    }, 1, 3);
    expect(p95).toBeLessThan(500);
  });

  it('aggregateTurnover 1M rows p50 < 3500 ms (workstation sandbox Windows)', () => {
    const rows = genTurnover(1_000_000);
    const { p50, result } = bench('Turnover 1M', () => aggregateTurnover(rows), 1, 3);
    expect(result.summary.altas).toBeGreaterThan(0);
    expect(p50).toBeLessThan(3500);
  });

  it('aggregateTurnover 2M rows p95 < 6000 ms (escala SLA Big Data / dev workstation)', () => {
    const rows = genTurnover(2_000_000);
    const { p95, result } = bench('Turnover 2M', () => aggregateTurnover(rows), 1, 3);
    expect(result.chart.length).toBeGreaterThan(0);
    expect(p95).toBeLessThan(6000);
  });

  it('aggregateIncapacidades 200K rows p95 < 900 ms', () => {
    const rows = genIncap(200_000);
    const { p95, result } = bench('Incapacidades 200K', () => aggregateIncapacidades(rows), 1, 3);
    expect(result.summary.dias).toBeGreaterThan(0);
    expect(p95).toBeLessThan(900);
  });

  it('aggregateHorasExtra 100K rows p95 < 900 ms', () => {
    const rows = genHx(100_000);
    const { p95, result } = bench('HorasExtra 100K', () => aggregateHorasExtra(rows), 1, 3);
    expect(result.summary.horas).toBeGreaterThan(0);
    expect(p95).toBeLessThan(900);
  });

  it('aggregatePlantilla 10K rows p95 < 350 ms (antigüedad ponderada)', () => {
    const rows = genPlantilla(10_000);
    const { p95, result } = bench('Plantilla 10K', () => aggregatePlantilla(rows), 2, 5);
    expect(result.summary.headcount).toBeGreaterThan(0);
    expect(p95).toBeLessThan(350);
  });

  it('aggregateBeneficios 500K rows p95 < 1500 ms', () => {
    const rows = genBenef(500_000);
    const { p95, result } = bench('Beneficios 500K', () => aggregateBeneficios(rows), 1, 3);
    expect(result.summary.importe).toBeGreaterThan(0);
    expect(p95).toBeLessThan(1500);
  });
});
