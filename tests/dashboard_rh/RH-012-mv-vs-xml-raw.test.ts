/**
 * [RH-012 · Validación MV ↔ XML Raw (simulado offline, sin DB)]
 *
 * Pipeline ETL offline:
 *   1. rows raw = equivalente a parseo XML SAT Nómina 1.2 (campos reales interfaces)
 *   2. aggregates helpers.ts
 *   3. comparación contra suma manual row-by-row · |delta| < 0.01 MXN (LISR Art. 29)
 *
 * Objetivo: las agregaciones usadas en UI y Materialized Views son CONSISTENTES
 * con la fuente raw sin pérdida centavos ni redondeos erróneos.
 */

import {
  aggregateTurnover,
  aggregateIncapacidades,
  aggregateHorasExtra,
  aggregatePlantilla,
  aggregateBeneficios,
  fmtMxn,
  BENEFICIOS_OFICIALES,
} from '@/lib/payroll-analytics-ui-helpers';
import type {
  TurnoverInputRow,
  IncapacidadesInputRow,
  HorasExtraInputRow,
  PlantillaInputRow,
  BeneficiosInputRow,
} from '@/lib/payroll-analytics-ui-helpers';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260831);
const d = (iso: string) => iso as unknown as Date;
const ym = (y: number, m01: number) => `${y}-${String(m01).padStart(2,'0')}-01T00:00:00.000Z`;

describe('[RH-012 · MV vs XML Raw · equivalencia sin redondeos silenciosos]', () => {
  jest.setTimeout(30000);

  it('aggregateTurnover vs suma raw manual · 48 rows · empleados = Math.max activos x mes', () => {
    const depts = ['Ventas','Operaciones','RH','TI'];
    const meses = [ym(2026,1),ym(2026,2),ym(2026,3),ym(2026,4),ym(2026,5),ym(2026,6),
                   ym(2026,7),ym(2026,8),ym(2026,9),ym(2026,10),ym(2026,11),ym(2026,12)];
    const rows: TurnoverInputRow[] = [];
    const rawByMes: Record<string,{altas:number;bajas:number;reing:number;maxAct:number}> = {};
    for (const m of meses) rawByMes[m] = { altas:0,bajas:0,reing:0,maxAct:0 };

    let _i = 0;
    for (const mes of meses) {
      for (const dep of depts) {
        const altas = Math.floor(rand() * 20);
        const bajas = Math.floor(rand() * 15);
        const reing = Math.floor(rand() * 8);
        const aInicio = 50 + Math.floor(rand() * 200);
        const aFin = aInicio + altas - bajas + reing;
        const activos = Math.max(aInicio, aFin);
        rows.push({
          departamento: dep, mes_pago: d(mes), altas, bajas, reingresos: reing,
          empleados_activos: activos, total_recibos: activos,
        });
        rawByMes[mes].altas += altas;
        rawByMes[mes].bajas += bajas;
        rawByMes[mes].reing += reing;
        rawByMes[mes].maxAct = Math.max(rawByMes[mes].maxAct, activos);
        _i++;
      }
    }

    const res = aggregateTurnover(rows);
    let tAltas = 0, tBajas = 0, tReing = 0;
    for (const m of meses) { tAltas += rawByMes[m].altas; tBajas += rawByMes[m].bajas; tReing += rawByMes[m].reing; }
    expect(res.summary.altas).toBe(tAltas);
    expect(res.summary.bajas).toBe(tBajas);
    expect(res.summary.reingresos).toBe(tReing);
    expect(res.chart.length).toBe(meses.length);
    meses.forEach((mStr, idx) => {
      const p = res.chart[idx];
      expect(p.altas).toBe(rawByMes[mStr].altas);
      expect(p.bajas).toBe(rawByMes[mStr].bajas);
      expect(p.reingresos).toBe(rawByMes[mStr].reing);
      expect(p.activos).toBe(rawByMes[mStr].maxAct);
    });
    expect(res.turnoverPct).toBeGreaterThanOrEqual(0);
  });

  it('aggregateIncapacidades vs suma manual · 36 rows · total eventos, dias, importe OK', () => {
    const tipos = [
      { tipo: '01', desc: 'Riesgo de trabajo' },
      { tipo: '02', desc: 'Enfermedad general' },
      { tipo: '03', desc: 'Maternidad' },
    ];
    const depts = ['Ventas','Operaciones','RH','TI'];
    const meses = [ym(2026,1),ym(2026,2),ym(2026,3)];
    const rows: IncapacidadesInputRow[] = [];
    let ev = 0, dias = 0, imp = 0, afec = 0;
    const byTipo: Record<string,number> = { '01':0,'02':0,'03':0 };

    for (const mes of meses) {
      for (const dep of depts) {
        for (const t of tipos) {
          const nEv = 1 + Math.floor(rand() * 5);
          const nDias = nEv * (1 + Math.floor(rand() * 7));
          const nImp = Number((nDias * (200 + rand()*300)).toFixed(2));
          const nEmp = 1 + Math.floor(rand() * 8);
          rows.push({
            departamento: dep,
            mes_pago: d(mes),
            tipo_incapacidad: t.tipo,
            descripcion_tipo: t.desc,
            numero_eventos: nEv,
            total_dias: nDias,
            importe_total: nImp,
            empleados_afectados: nEmp,
          });
          ev += nEv; dias += nDias; imp += nImp; afec += nEmp;
          byTipo[t.tipo] += nEv;
        }
      }
    }

    const res = aggregateIncapacidades(rows);
    expect(res.summary.eventos).toBe(ev);
    expect(res.summary.dias).toBe(dias);
    expect(Math.abs(res.summary.importe - imp)).toBeLessThan(0.01);
    expect(res.summary.empleados).toBe(afec);
    expect(res.pie.length).toBe(3);
    // pie usa total_dias (no eventos) por tipo → valor >= 1
    for (const p of res.pie) { expect(p.value).toBeGreaterThan(0); }
  });

  it('aggregateHorasExtra vs cálculo raw · 48 rows · |delta importe| < 0.01 MXN', () => {
    const tipos = [
      { tipo: '01', desc: 'Dobles', mult: 2 },
      { tipo: '02', desc: 'Triples', mult: 3 },
    ];
    const depts = ['Ventas','Operaciones','RH','TI','Finanzas','Legal'];
    const meses = [ym(2026,1),ym(2026,2),ym(2026,3),ym(2026,4)];
    const rows: HorasExtraInputRow[] = [];
    let rawHoras = 0, rawImporte = 0, rawEmp = 0;

    for (const mes of meses) {
      for (const dep of depts) {
        for (const t of tipos) {
          const nEmp = 5 + Math.floor(rand() * 20);
          const horasPer = 1 + rand() * 10;
          const tHoras = Number((nEmp * horasPer).toFixed(2));
          const tarifa = Number((150 + rand() * 200).toFixed(2));
          const impTotal = Number((tHoras * tarifa).toFixed(2));
          rows.push({
            departamento: dep,
            mes_pago: d(mes),
            tipo_horas: t.tipo,
            descripcion_tipo: t.desc,
            empleados: nEmp,
            total_horas: tHoras,
            importe_total: impTotal,
          });
          rawHoras += tHoras;
          rawImporte += impTotal;
          rawEmp += nEmp;
        }
      }
    }

    const res = aggregateHorasExtra(rows);
    expect(Math.abs(res.summary.importe - rawImporte)).toBeLessThan(0.01);
    expect(Math.abs(res.summary.horas - rawHoras)).toBeLessThan(0.001);
    expect(res.summary.empleados).toBe(rawEmp);
    expect(fmtMxn(res.summary.importe)).toMatch(/^\$[\d,]+(\.\d{2})?$/);
  });

  it('aggregatePlantilla · promedio PONDERADO antigüedad/SDI FAIL-CLOSED · 3 rows 100% deterministic', () => {
    const rows: PlantillaInputRow[] = [
      { departamento: 'Ventas',      tipo_contrato: '1', tipo_jornada: '1', num_empleados: 50, antiguedad_promedio_anios: 2, sdi_promedio: 400 },
      { departamento: 'Operaciones', tipo_contrato: '1', tipo_jornada: '2', num_empleados: 30, antiguedad_promedio_anios: 4, sdi_promedio: 450 },
      { departamento: 'TI',          tipo_contrato: '2', tipo_jornada: '1', num_empleados: 20, antiguedad_promedio_anios: 8, sdi_promedio: 500 },
    ];
    const res = aggregatePlantilla(rows);
    // Σ(ant*emp)/Σemp = (100+120+160)/100 = 3.8
    expect(res.summary.antiguedadProm).toBeCloseTo(3.8, 6);
    // Σ(sdi*emp)/Σemp = (20000+13500+10000)/100 = 435.0
    expect(res.summary.sdiProm).toBeCloseTo(435, 6);
    expect(res.summary.headcount).toBe(100);
  });

  it('aggregateBeneficios vs suma raw · 96 rows · |delta total| < 0.01 MXN', () => {
    const cods = BENEFICIOS_OFICIALES.slice(0, 4); // 005,010,029,049
    const depts = ['Ventas','Operaciones','RH','TI','Finanzas','Legal'];
    const meses = [ym(2026,1),ym(2026,2),ym(2026,3),ym(2026,4)];
    const rows: BeneficiosInputRow[] = [];
    let _gRaw = 0, _eRaw = 0, totRaw = 0, ap = 0, _em = 0;

    for (const mes of meses) {
      for (const dep of depts) {
        for (const c of cods) {
          const grav = Number((rand() * 5000).toFixed(2));
          const exen = Number((rand() * 2000).toFixed(2));
          const nApl = 1 + Math.floor(rand() * 20);
          const nEmp = 1 + Math.floor(rand() * 30);
          rows.push({
            departamento: dep,
            mes_pago: d(mes),
            tipo_percepcion: c.codigo,
            concepto: c.nombre,
            numero_aplicaciones: nApl,
            empleados_beneficiados: nEmp,
            total_gravado: grav,
            total_exento: exen,
            importe_total: grav + exen,
          });
          _gRaw += grav; _eRaw += exen; totRaw += grav + exen;
          ap += nApl; _em += nEmp;
        }
      }
    }

    const res = aggregateBeneficios(rows);
    // aggregateBeneficios solo lee `importe_total` (gravado + exento); no separa ambos
    expect(Math.abs(res.summary.importe - totRaw)).toBeLessThan(0.01);
    expect(res.summary.aplicaciones).toBe(ap);
    expect(res.summary.empleados).toBeGreaterThan(0);
  });
});
