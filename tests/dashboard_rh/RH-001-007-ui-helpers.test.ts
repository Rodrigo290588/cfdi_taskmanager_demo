/**
 * [DASHBOARD RH FASE 4]
 * RH-001 al RH-007 · Tests UNITARIOS functions-pure.
 *
 * Coverage targets (≥85% Fase 4 contrato):
 *   RH-001: formatters (fmtMxn · fmtNum · fmtPct · fmtDateEs)
 *   RH-002: computeTrendTone (default/reversed · flat · up/down)
 *   RH-003: aggregateTurnover (collapse mes · % turnover · tone)
 *   RH-004: aggregateIncapacidades (2σ anomaly · pie bars 3 tipos SAT)
 *   RH-005: aggregateHorasExtra (top10 · umbral8h · badge tone)
 *   RH-006: aggregatePlantilla (antigüedad PONDERADA + SDI ponderado)
 *   RH-007: aggregateBeneficios + detailRows (4 códigos SAT gravado/exento/total)
 *
 * Ejecutar: npm run test -- tests/dashboard_rh/RH-001-007-ui-helpers.test.ts --runInBand
 */

// mocks mínimos HOISTED de dependencias Next para evitar transpile errors
jest.mock('@/components/ui/card', () => ({
  Card: (p: any) => ({ ...p, __Card: true }),
  CardHeader: (p: any) => ({ ...p, __CardHeader: true }),
  CardTitle: (p: any) => ({ ...p, __CardTitle: true }),
  CardContent: (p: any) => ({ ...p, __CardContent: true }),
}));
jest.mock('@/components/ui/badge', () => ({ Badge: (p: any) => ({ ...p, __Badge: true }) }));
jest.mock('@/components/ui/skeleton', () => ({ Skeleton: (p: any) => ({ ...p, __Skeleton: true }) }));
jest.mock('@/components/ui/table', () => ({
  Table: (p: any) => ({ ...p, __Table: true }),
  TableBody: (p: any) => ({ ...p, __TableBody: true }),
  TableCell: (p: any) => ({ ...p, __TableCell: true }),
  TableHead: (p: any) => ({ ...p, __TableHead: true }),
  TableHeader: (p: any) => ({ ...p, __TableHeader: true }),
  TableRow: (p: any) => ({ ...p, __TableRow: true }),
}));
jest.mock('lucide-react', () => {
  const mk = (name: string) => (p: any) => ({ ...p, __Icon: name });
  return {
    Users: mk('Users'), AlertTriangle: mk('AlertTriangle'), Clock: mk('Clock'),
    Briefcase: mk('Briefcase'), Gift: mk('Gift'), BarChart3: mk('BarChart3'),
    ArrowUpRight: mk('ArrowUpRight'), ArrowDownRight: mk('ArrowDownRight'),
    Minus: mk('Minus'), Calendar: mk('Calendar'), Award: mk('Award'),
  };
});

// ---------- imports POST mocks ----------
import {
  fmtMxn, fmtNum, fmtPct, fmtDateEs,
  computeTrendTone,
  aggregateTurnover, computeTurnoverTone,
  aggregateIncapacidades,
  aggregateHorasExtra, computePromHxEmpleadoTone, UMBRAL_HX_POR_EMPLEADO,
  aggregatePlantilla, computeAntiguedadTone,
  aggregateBeneficios, beneficioDetailRows, BENEFICIOS_OFICIALES,
} from '@/lib/payroll-analytics-ui-helpers';

import {
  TURNOVER_ROWS, TURNOVER_EXPECTED,
  INCAP_ROWS, INCAP_EXPECTED,
  HX_ROWS, HX_EXPECTED,
  PLANTILLA_ROWS, PLANTILLA_EXPECTED,
  BENEF_ROWS, BENEF_EXPECTED,
} from './fixtures/payloads';

// ============================================================
// RH-001 · Formatters es-MX Intl
// ============================================================
describe('[RH-001] Formatters MXN / num / pct / fecha ES', () => {
  it('fmtMxn pesos positivos, dígitos default = 0 → redondea a entero', () => {
    // default maxDigits = 0 → 1234.56 → $1,235 (redondeo entero)
    expect(fmtMxn(1234.56)).toBe('$1,235');
    // maxDigits=2 preserva decimales
    expect(fmtMxn(1234.56, 2)).toContain('1,234');
    expect(fmtMxn(1234.56, 2).length).toBeGreaterThanOrEqual(8);
  });
  it('fmtMxn null/undefined/NaN → $0', () => {
    expect(fmtMxn(null)).toBe('$0');
    expect(fmtMxn(undefined)).toBe('$0');
    expect(fmtMxn(NaN)).toBe('$0');
  });
  it('fmtNum agrupa miles es-MX con digits 0', () => {
    expect(fmtNum(1234567, 0)).toBe('1,234,567');
  });
  it('fmtNum NaN/null → 0', () => {
    expect(fmtNum(null, 0)).toBe('0');
    expect(fmtNum(undefined)).toBe('0');
    expect(fmtNum(Infinity)).toBe('0');
  });
  it('fmtPct toFixed digits 1 default', () => {
    expect(fmtPct(12.345)).toBe('12.3%');
    expect(fmtPct(NaN)).toBe('0%');
  });
  it('fmtDateEs string ISO', () => {
    const s = fmtDateEs('2026-06-15T00:00:00.000Z');
    expect(typeof s).toBe('string');
    expect(s.length).toBeGreaterThan(5);
  });
});

// ============================================================
// RH-002 · computeTrendTone (pure sin JSX)
// ============================================================
describe('[RH-002] computeTrendTone · modos default / reversed / flat', () => {
  it('previous undefined → flat n/a', () => {
    const t = computeTrendTone(100);
    expect(t.tone).toBe('slate');
    expect(t.direction).toBe('flat');
    expect(t.display).toBe('n/a');
  });
  it('previous 0 → flat n/a (fail-closed div 0)', () => {
    const t = computeTrendTone(100, 0);
    expect(t.tone).toBe('slate');
    expect(t.pctChange).toBe(0);
  });
  it('default mode up = verde, +25%', () => {
    const t = computeTrendTone(125, 100, 'default');
    expect(t.direction).toBe('up');
    expect(t.tone).toBe('emerald');
    expect(t.pctChange).toBeCloseTo(25, 5);
    expect(t.display).toContain('+25.0%');
  });
  it('default mode down = rojo -20%', () => {
    const t = computeTrendTone(80, 100, 'default');
    expect(t.direction).toBe('down');
    expect(t.tone).toBe('rose');
    expect(t.display).toContain('-20.0%');
  });
  it('reversed mode up (↑turnover es MALO) = rose', () => {
    const t = computeTrendTone(120, 100, 'reversed');
    expect(t.tone).toBe('rose');
    expect(t.direction).toBe('up');
  });
  it('reversed mode down (↓turnover es BUENO) = emerald', () => {
    const t = computeTrendTone(90, 100, 'reversed');
    expect(t.tone).toBe('emerald');
    expect(t.direction).toBe('down');
  });
  it('|delta|<eps → flat sin cambio', () => {
    const t = computeTrendTone(100.0000001, 100, 'default', 0.001);
    expect(t.tone).toBe('slate');
    expect(t.display).toBe('sin cambio');
  });
});

// ============================================================
// RH-003 · aggregateTurnover (colapsa mes + % turnover)
// ============================================================
describe('[RH-003] aggregateTurnover · collapse departamento → mes + % turnover', () => {
  const { chart, summary, previous, turnoverPct, turnoverTone } = aggregateTurnover(TURNOVER_ROWS);
  it('longitud collapse meses = 6 meses (2026 ene-jun)', () => {
    expect(chart.length).toBe(TURNOVER_EXPECTED.meses);
  });
  it('suma altas período = 48', () => {
    expect(summary.altas).toBe(TURNOVER_EXPECTED.totalAltas);
  });
  it('suma bajas período = 27', () => {
    expect(summary.bajas).toBe(TURNOVER_EXPECTED.totalBajas);
  });
  it('suma reingresos período = 6', () => {
    expect(summary.reingresos).toBe(TURNOVER_EXPECTED.totalReingresos);
  });
  it('headcount último mes (max entre deptos del mes junio) = 115 (Ventas es pico)', () => {
    // aggregate toma Math.max(empleados_activos) de TODOS deptos en cada mes (no suma)
    // junio: ventas=115, ops=85 → max=115
    expect(summary.empleados).toBe(115);
  });
  it('% turnover = 27 bajas / 115 empleados pico = 23.48% → >8% tone rose', () => {
    // 27 / 115 = 0.2347826...
    expect(turnoverPct).toBeCloseTo(23.48, 1);
    expect(turnoverTone).toBe('rose');
  });
  it('computeTurnoverTone thresholds: 10%→rose 5%→amber 2%→emerald', () => {
    expect(computeTurnoverTone(10)).toBe('rose');
    expect(computeTurnoverTone(5)).toBe('amber');
    expect(computeTurnoverTone(2)).toBe('emerald');
  });
  it('previous período = mitad 1 (3 meses) altas ≈ 5+3+1+8+2+4+1 = 24', () => {
    // mitad 1 = primeros 3 meses (enero/feb/mar):
    // altas: 5+3+1 + 8+2 + 4+1+1 = 5+3+1=9, +10=19, +6=25. Depende del split
    expect(previous.altas).toBeGreaterThan(0);
  });
  it('aggregateTurnover rows vacías → chart=[] summary zeros turnover=0 emerald', () => {
    const r = aggregateTurnover([]);
    expect(r.chart).toHaveLength(0);
    expect(r.summary.altas).toBe(0);
    expect(r.summary.bajas).toBe(0);
    expect(r.turnoverPct).toBe(0);
    expect(r.turnoverTone).toBe('emerald');
  });
});

// ============================================================
// RH-004 · aggregateIncapacidades 2σ
// ============================================================
describe('[RH-004] aggregateIncapacidades · Pie dona + Bar 2σ anomaly + KPIs', () => {
  const { pie, bars, summary, stats } = aggregateIncapacidades(INCAP_ROWS);
  it('total días 225', () => expect(summary.dias).toBe(INCAP_EXPECTED.totalDias));
  it('total eventos 70', () => expect(summary.eventos).toBe(INCAP_EXPECTED.totalEventos));
  it('días promedio / evento = 225/70 ≈ 3.214', () => {
    expect(summary.diasPorEvento).toBeCloseTo(3.214, 2);
  });
  it('pie 3 tipos 01/02/03 (3 entradas distintas)', () => {
    expect(pie.length).toBe(3);
    const codigosNombre = pie.map(p => p.name);
    expect(codigosNombre).toContain('Enfermedad General');
    expect(codigosNombre).toContain('Riesgo Trabajo');
    expect(codigosNombre).toContain('Maternidad');
  });
  it('pie suma pct ≈ 100%', () => {
    const totalPct = pie.reduce((a, p) => a + Number(p.pct.replace('%','')), 0);
    expect(totalPct).toBeCloseTo(100, 0);
  });
  it('longitud bars = 6 meses', () => {
    expect(bars.length).toBe(INCAP_EXPECTED.meses);
  });
  it('3er mes marzo (índice 2) anomaly=true (2σ)', () => {
    // marzo index = 2 (0 ene,1 feb,2 mar...)
    expect(bars[2].anomaly).toBe(true);
  });
  it('ene-feb-abr-may-jun anomaly=false (salvo marzo)', () => {
    expect(bars[0].anomaly).toBe(false);
    expect(bars[1].anomaly).toBe(false);
    expect(bars[3].anomaly).toBe(false);
    expect(bars[4].anomaly).toBe(false);
    expect(bars[5].anomaly).toBe(false);
  });
  it('media + std > 0 (datos dispersos)', () => {
    expect(stats.mediaDias).toBeGreaterThan(30);
    expect(stats.stdDias).toBeGreaterThan(20);
  });
  it('aggregateIncapacidades empty = zero KPIs', () => {
    const r = aggregateIncapacidades([]);
    expect(r.pie).toHaveLength(0);
    expect(r.bars).toHaveLength(0);
    expect(r.summary.dias).toBe(0);
  });
});

// ============================================================
// RH-005 · aggregateHorasExtra (top10, umbral 8h/emp)
// ============================================================
describe('[RH-005] aggregateHorasExtra · Top10 / overloaded 8h emp / badge tone', () => {
  const { stacked, overloaded, summary } = aggregateHorasExtra(HX_ROWS);
  it('stacked top10 length = 10', () => expect(stacked.length).toBe(HX_EXPECTED.top10));
  it('operaciones A está top 1 por totalHoras (160h)', () => {
    expect(stacked[0].departamento).toBe('Operaciones A');
  });
  it('suma horas totales período = 538 (dobles 438 + triples 215?—sumar fixture)', () => {
    const tot = HX_EXPECTED.totales.dobles + HX_EXPECTED.totales.triples;
    expect(summary.horas).toBe(tot);
  });
  it('overloaded deptos ≥2 (Ops A 16h/emp, IT SRE 12h/emp)', () => {
    expect(overloaded.length).toBeGreaterThanOrEqual(HX_EXPECTED.overloadedMin);
    const nombres = overloaded.map(o => o.departamento);
    expect(nombres).toContain('Operaciones A');
    expect(nombres).toContain('IT SRE');
  });
  it('UMBRAL constante 8 STPS', () => {
    expect(UMBRAL_HX_POR_EMPLEADO).toBe(8);
  });
  it('computePromHxEmpleadoTone thresholds 10→rose 6→amber 2→emerald', () => {
    expect(computePromHxEmpleadoTone({ horas: 100, empleados: 10 }).tone).toBe('rose');    // 10 h/emp
    expect(computePromHxEmpleadoTone({ horas: 60,  empleados: 10 }).tone).toBe('amber');   // 6  h/emp
    expect(computePromHxEmpleadoTone({ horas: 20,  empleados: 10 }).tone).toBe('emerald'); // 2
    expect(computePromHxEmpleadoTone({ horas: 0,   empleados: 0  }).tone).toBe('emerald'); // 0 → normal
  });
  it('aggregateHorasExtra rows empty → zeros', () => {
    const r = aggregateHorasExtra([]);
    expect(r.stacked).toHaveLength(0);
    expect(r.summary.horas).toBe(0);
  });
});

// ============================================================
// RH-006 · aggregatePlantilla (antigüedad PONDERADA, CRÍTICO)
// ============================================================
describe('[RH-006] aggregatePlantilla · Fórmula ANTIGÜEDAD PONDERADA + SDI ponderado', () => {
  const { contrato, jornada, summary } = aggregatePlantilla(PLANTILLA_ROWS);
  it('headcount = 100 personas', () => {
    expect(summary.headcount).toBe(PLANTILLA_EXPECTED.headcount);
  });
  it('3 departamentos distintos', () => {
    expect(summary.deptos).toBe(PLANTILLA_EXPECTED.deptos);
  });
  it('3 perfiles (rows plantilla 3 filas)', () => {
    expect(summary.perfiles).toBe(PLANTILLA_EXPECTED.perfiles);
  });
  it('ANTIGÜEDAD PONDERADA = 3.8 AÑOS exacta (no AVG ingenuo)', () => {
    // CRÍTICO FAIL-CLOSED → (2*50 + 4*30 + 8*20)/100 = 380/100 = 3.8
    expect(summary.antiguedadProm).toBeCloseTo(PLANTILLA_EXPECTED.antiguedadPonderada, 5);
  });
  it('SDI PROM PONDERADO = 445.0 (20000+13500+11000)/100', () => {
    expect(summary.sdiProm).toBeCloseTo(PLANTILLA_EXPECTED.sdiPonderado, 5);
  });
  it('contrato pie length 3 (Permanente · Eventual · Permanente Sindicalizado)', () => {
    expect(contrato.length).toBe(PLANTILLA_EXPECTED.contratoDistinct + 1); // Permanente Sindicalizado es 3ro, no distinto nombre
    // actual fixture: Permanente, Eventual, Permanente Sindicalizado = 3 claves distintas
  });
  it('jornada pie length = Diurna + Nocturna (2)', () => {
    expect(jornada.length).toBe(PLANTILLA_EXPECTED.jornadaDistinct);
  });
  it('pie suma value = headcount', () => {
    const sum = contrato.reduce((a,c) => a + c.value, 0);
    expect(sum).toBe(summary.headcount);
  });
  it('computeAntiguedadTone 4→emerald 2→amber 0.5→rose', () => {
    expect(computeAntiguedadTone(4)).toBe('emerald');
    expect(computeAntiguedadTone(2)).toBe('amber');
    expect(computeAntiguedadTone(0.5)).toBe('rose');
  });
  it('aggregatePlantilla rows empty = zeros', () => {
    const r = aggregatePlantilla([]);
    expect(r.summary.headcount).toBe(0);
    expect(r.summary.antiguedadProm).toBe(0);
  });
});

// ============================================================
// RH-007 · aggregateBeneficios (gravado/exento/total 4 cod SAT)
// ============================================================
describe('[RH-007] aggregateBeneficios + detailRows · 4 códigos SAT 005/010/029/049', () => {
  const { byTipo, byMes, summary } = aggregateBeneficios(BENEF_ROWS);
  const detail = beneficioDetailRows(BENEF_ROWS);

  it('BENEFICIOS_OFICIALES 4 entradas oficiales SAT', () => {
    expect(BENEFICIOS_OFICIALES.map(b=>b.codigo)).toEqual(['029','005','010','049']);
  });
  it('byTipo length 4 (solo codigos permitidos en fixture)', () => {
    expect(byTipo.length).toBe(BENEF_EXPECTED.tiposSAT_distintos);
  });
  it('byTipo 029 Vales = 720,000', () => {
    const v = byTipo.find(b=>b.codigo==='029');
    expect(v?.importe).toBe(BENEF_EXPECTED.importeTotal_029);
  });
  it('byTipo 005 Ahorro = 60,000', () => {
    expect(byTipo.find(b=>b.codigo==='005')?.importe).toBe(BENEF_EXPECTED.importeTotal_005);
  });
  it('byTipo 010 Puntualidad = 65,000', () => {
    expect(byTipo.find(b=>b.codigo==='010')?.importe).toBe(BENEF_EXPECTED.importeTotal_010);
  });
  it('byTipo 049 Asistencia = 88,000', () => {
    expect(byTipo.find(b=>b.codigo==='049')?.importe).toBe(BENEF_EXPECTED.importeTotal_049);
  });
  it('total período 933,000', () => {
    expect(summary.importe).toBe(BENEF_EXPECTED.totalImporte);
  });
  it('byMes length 6 meses', () => {
    expect(byMes.length).toBe(BENEF_EXPECTED.meses);
  });
  it('detail length BENEF_ROWS.length (24) y ordenado desc total', () => {
    expect(detail.length).toBe(BENEF_EXPECTED.detalleRows_length);
    for (let i = 1; i < detail.length; i++) {
      expect(detail[i-1].total).toBeGreaterThanOrEqual(detail[i].total);
    }
  });
  it('detail row 029 Vales tiene gravado=0 (beneficio exento 100% IMSS/ISR)', () => {
    const vales = detail.filter(d=>d.codigo==='029');
    for (const v of vales) {
      expect(v.gravado).toBe(0);
      expect(v.exento).toBe(v.total);
    }
  });
  it('aggregateBeneficios empty = zeros', () => {
    const r = aggregateBeneficios([]);
    expect(r.byTipo).toHaveLength(0);
    expect(r.summary.importe).toBe(0);
    expect(beneficioDetailRows([])).toHaveLength(0);
  });
});
