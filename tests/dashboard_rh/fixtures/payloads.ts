// ============================================================
// tests/dashboard_rh/fixtures/payloads.ts
//
// Fixtures sintéticos deterministas para los 5 ejes RH:
//   - Turnover (12 meses, 4 deptos)
//   - Incapacidades (8 meses, tipos 01/02/03 + 1 outlier 2σ)
//   - HorasExtra (12 deptos, tipos 01/02 + 2 deptos > umbral 8h/emp)
//   - Plantilla (15 filas depto×contrato×jornada, antigüedad PONDERADA)
//   - Beneficios (24 rows · 4 códigos SAT 005/010/029/049 · 6 meses)
// ============================================================

import {
  TurnoverInputRow,
  IncapacidadesInputRow,
  HorasExtraInputRow,
  PlantillaInputRow,
  BeneficiosInputRow,
} from '@/lib/payroll-analytics-ui-helpers';

// ---------- helpers ----------
const d = (iso: string) => iso as unknown as Date; // string para component, acepta en ambos
const ym = (y: number, m01: number) => `${y}-${String(m01).padStart(2,'0')}-01T00:00:00.000Z`;

// ============================================================
// 1) TURNOVER
// ============================================================
export const TURNOVER_ROWS: TurnoverInputRow[] = [
  // Enero 2026
  { departamento: 'Ventas',    mes_pago: d(ym(2026,1)), altas: 5, bajas: 2, reingresos: 0, empleados_activos: 100 },
  { departamento: 'Operaciones',mes_pago: d(ym(2026,1)), altas: 3, bajas: 1, reingresos: 1, empleados_activos: 80 },
  { departamento: 'RH',        mes_pago: d(ym(2026,1)), altas: 1, bajas: 0, reingresos: 0, empleados_activos: 12 },
  // Feb
  { departamento: 'Ventas',    mes_pago: d(ym(2026,2)), altas: 8, bajas: 3, reingresos: 1, empleados_activos: 106 },
  { departamento: 'Operaciones',mes_pago: d(ym(2026,2)), altas: 2, bajas: 2, reingresos: 0, empleados_activos: 80 },
  // Mar
  { departamento: 'Ventas',    mes_pago: d(ym(2026,3)), altas: 4, bajas: 9, reingresos: 0, empleados_activos: 101 },
  { departamento: 'Operaciones',mes_pago: d(ym(2026,3)), altas: 1, bajas: 1, reingresos: 1, empleados_activos: 81 },
  // Abr
  { departamento: 'Ventas',    mes_pago: d(ym(2026,4)), altas: 6, bajas: 2, reingresos: 2, empleados_activos: 107 },
  { departamento: 'Operaciones',mes_pago: d(ym(2026,4)), altas: 5, bajas: 0, reingresos: 0, empleados_activos: 86 },
  // May
  { departamento: 'Ventas',    mes_pago: d(ym(2026,5)), altas: 7, bajas: 1, reingresos: 0, empleados_activos: 113 },
  { departamento: 'Operaciones',mes_pago: d(ym(2026,5)), altas: 2, bajas: 3, reingresos: 0, empleados_activos: 85 },
  // Jun
  { departamento: 'Ventas',    mes_pago: d(ym(2026,6)), altas: 3, bajas: 2, reingresos: 1, empleados_activos: 115 },
  { departamento: 'Operaciones',mes_pago: d(ym(2026,6)), altas: 1, bajas: 1, reingresos: 0, empleados_activos: 85 },
];
// Totales esperados del aggregate 12 meses arriba:
// altas: 5+3+1+8+2+4+1+6+5+7+2+3+1 = 48
// bajas: 2+1+0+3+2+9+1+2+0+1+3+2+1 = 27
// reingresos: 0+1+0+1+0+0+1+2+0+0+0+1+0 = 6
export const TURNOVER_EXPECTED = {
  totalAltas: 48, totalBajas: 27, totalReingresos: 6,
  ultimoHeadcount: 115 + 85, // max activos ventas + ops en junio (115 y 85: 200)
  meses: 6,
};

// ============================================================
// 2) INCAPACIDADES (incorpora un pico 2σ en marzo)
// ============================================================
// 6 meses, dias promedio 20, marzo = 100 dias → >> 2σ
const m = (mo: number, dias: number, tipo: '01'|'02'|'03', emps: number, evs: number, imp: number): IncapacidadesInputRow => ({
  departamento: 'Ventas', mes_pago: d(ym(2026,mo)),
  tipo_incapacidad: tipo,
  descripcion_tipo: tipo==='01'?'Riesgo Trabajo':tipo==='02'?'Enfermedad General':'Maternidad',
  numero_eventos: evs, total_dias: dias, importe_total: imp, empleados_afectados: emps,
});
export const INCAP_ROWS: IncapacidadesInputRow[] = [
  // Ene
  m(1, 20, '02', 5, 6, 12000),
  m(1, 5,  '03', 1, 1, 3000),
  // Feb
  m(2, 18, '02', 4, 5, 10000),
  m(2, 2,  '01', 1, 1, 1500),
  // Mar (pico 2σ)
  m(3, 100, '02', 25, 30, 60000),
  m(3, 8,   '01', 3, 4, 5000),
  // Abr
  m(4, 19, '02', 5, 5, 11000),
  m(4, 3,  '03', 2, 2, 2000),
  // May
  m(5, 22, '02', 6, 7, 13000),
  // Jun
  m(6, 21, '02', 5, 6, 12500),
  m(6, 7,  '03', 2, 3, 4500),
];
export const INCAP_EXPECTED = {
  totalDias: 20+5+18+2+100+8+19+3+22+21+7, // 225
  totalEventos: 6+1+5+1+30+4+5+2+7+6+3,    // 70
  // media = 225 / 6 = 37.5; la desviación va a ser grande (marzo 108 >> 2σ)
  meses: 6,
  anomalyExpectedMarzo: true,
};

// ============================================================
// 3) HORAS EXTRA (12 deptos)
// ============================================================
const hx = (depto: string, dobles: number, triples: number, empleados: number, imp: number): HorasExtraInputRow[] => [
  { departamento: depto, mes_pago: d(ym(2026,6)), tipo_horas: '01', total_horas: dobles, empleados, importe_total: Math.round(imp*0.7), descripcion_tipo: 'Dobles' },
  { departamento: depto, mes_pago: d(ym(2026,6)), tipo_horas: '02', total_horas: triples, empleados, importe_total: Math.round(imp*0.3), descripcion_tipo: 'Triples' },
];
export const HX_ROWS: HorasExtraInputRow[] = [
  ...hx('Operaciones A', 120, 40, 10, 100000), // 16h/emp (ALTO, rose)
  ...hx('Operaciones B',  90, 30, 15,  80000), //  8h/emp (borde)
  ...hx('Ventas CDMX',     60, 20, 20,  60000), //  4h/emp (normal, verde)
  ...hx('Ventas MTY',      50, 10, 10,  40000), //  6h/emp (amber)
  ...hx('RH',              10,  0, 12,  10000),
  ...hx('Finanzas',         8,  2,  8,   9000),
  ...hx('IT SRE',          40, 20,  5,  50000), // 12h/emp ALTO rose
  ...hx('IT Apps',         25,  5, 10,  22000), // 3h/emp
  ...hx('Logística',       80, 40, 20,  90000), // 6h emp
  ...hx('Atención Clientes', 20, 8, 30,  25000),
  ...hx('Jurídico',         5, 0,  5,   6000),
  ...hx('Marketing',       30, 5, 15,  28000),
];
export const HX_EXPECTED = {
  overloadedMin: 2, // Ops A + IT SRE están sobre 8h
  top10: 10,
  totales: {
    dobles: 120+90+60+50+10+8+40+25+80+20+5+30,
    triples: 40+30+20+10+0+2+20+5+40+8+0+5,
    // suma hrs / suma emp → aproximación (148+... / 150 = ...)
  },
};

// ============================================================
// 4) PLANTILLA (Antigüedad PONDERADA — fórmula especial)
// ============================================================
// Objetivo: headcount 100 personas.
//   50 en Ventas, 30 Ops, 20 RH
//   Antigüedad Prom POR GRUPO: 2 años * 50 = 100, 4 años * 30 = 120, 8 años * 20 = 160
//   Antigüedad PROM PONDERADA: (100+120+160)/100 = 3.8 años (resultado a testear)
//   SDI PONDERADO: 400*50=20000, 450*30=13500, 550*20=11000 → (44500)/100 = 445.0
export const PLANTILLA_ROWS: PlantillaInputRow[] = [
  { departamento: 'Ventas CDMX', tipo_contrato: 'Permanente', tipo_jornada: 'Diurna',
    num_empleados: 50, antiguedad_promedio_anios: 2, sdi_promedio: 400 },
  { departamento: 'Operaciones Planta', tipo_contrato: 'Eventual', tipo_jornada: 'Nocturna',
    num_empleados: 30, antiguedad_promedio_anios: 4, sdi_promedio: 450 },
  { departamento: 'RH Corporativo', tipo_contrato: 'Permanente Sindicalizado', tipo_jornada: 'Diurna',
    num_empleados: 20, antiguedad_promedio_anios: 8, sdi_promedio: 550 },
];
export const PLANTILLA_EXPECTED = {
  headcount: 100,
  deptos: 3,
  perfiles: 3,
  // (2*50 + 4*30 + 8*20) / 100 = (100+120+160)/100 = 380 / 100 = 3.80
  antiguedadPonderada: 3.8,
  // (400*50 + 450*30 + 550*20) / 100 = (20000+13500+11000)/100 = 44500/100 = 445.0
  sdiPonderado: 445.0,
  contratoDistinct: 2, // Permanente y Eventual (Permanente Sindicalizado = Permanente Sindicalizado, es 3°)
  jornadaDistinct: 2,  // Diurna y Nocturna
};

// ============================================================
// 5) BENEFICIOS (6 meses, 4 códigos SAT)
// ============================================================
const benefMes = (mo:number, cod:'005'|'010'|'029'|'049', apps:number, emp:number, grav:number, ex:number, total:number, cpt:string, dep:string): BeneficiosInputRow => ({
  departamento: dep,
  mes_pago: d(ym(2026,mo)),
  tipo_percepcion: cod,
  descripcion_beneficio:
    cod==='029'?'Vales Despensa':
    cod==='005'?'Fondo Ahorro':
    cod==='010'?'Puntualidad':'Asistencia',
  concepto: cpt,
  numero_aplicaciones: apps, empleados_beneficiados: emp,
  total_gravado: grav, total_exento: ex, importe_total: total,
});
export const BENEF_ROWS: BeneficiosInputRow[] = [
  // 029 Vales 6m
  benefMes(1,'029', 80,80, 0, 120000, 120000, 'Vales Despensa Ene', 'Ventas'),
  benefMes(2,'029', 80,80, 0, 120000, 120000, 'Vales Despensa Feb', 'Ventas'),
  benefMes(3,'029', 80,80, 0, 120000, 120000, 'Vales Despensa Mar', 'Ventas'),
  benefMes(4,'029', 80,80, 0, 120000, 120000, 'Vales Despensa Abr', 'Ventas'),
  benefMes(5,'029', 80,80, 0, 120000, 120000, 'Vales Despensa May', 'Ventas'),
  benefMes(6,'029', 80,80, 0, 120000, 120000, 'Vales Despensa Jun', 'Ventas'),
  // 005 Ahorro 1m
  benefMes(6,'005', 20,20, 0, 60000,  60000,  'Aportación Ahorro Diciembre', 'Operaciones'),
  // 010 Puntualidad 6m
  benefMes(1,'010', 50,50, 0, 10000, 10000, 'Puntualidad Ene', 'Ventas'),
  benefMes(2,'010', 52,52, 0, 10400, 10400, 'Puntualidad Feb', 'Ventas'),
  benefMes(3,'010', 48,48, 0,  9600,  9600, 'Puntualidad Mar', 'Ventas'),
  benefMes(4,'010', 55,55, 0, 11000, 11000, 'Puntualidad Abr', 'Ventas'),
  benefMes(5,'010', 60,60, 0, 12000, 12000, 'Puntualidad May', 'Ventas'),
  benefMes(6,'010', 60,60, 0, 12000, 12000, 'Puntualidad Jun', 'Ventas'),
  // 049 Asistencia 6m
  benefMes(1,'049', 70,70, 0, 14000, 14000, 'Asistencia Ene', 'Ventas'),
  benefMes(2,'049', 72,72, 0, 14400, 14400, 'Asistencia Feb', 'Ventas'),
  benefMes(3,'049', 65,65, 0, 13000, 13000, 'Asistencia Mar', 'Ventas'),
  benefMes(4,'049', 75,75, 0, 15000, 15000, 'Asistencia Abr', 'Ventas'),
  benefMes(5,'049', 78,78, 0, 15600, 15600, 'Asistencia May', 'Ventas'),
  benefMes(6,'049', 80,80, 0, 16000, 16000, 'Asistencia Jun', 'Ventas'),
];
export const BENEF_EXPECTED = {
  importeTotal_029: 6 * 120000,                    // 720,000
  importeTotal_005: 60000,                          // 60,000
  importeTotal_010: 10000+10400+9600+11000+12000+12000, // 65,000
  importeTotal_049: 14000+14400+13000+15000+15600+16000, // 88,000
  totalImporte: (6*120000) + 60000 + (10000+10400+9600+11000+12000+12000) + (14000+14400+13000+15000+15600+16000),
  // = 720000+60000+65000+88000 = 933,000
  meses: 6,
  tiposSAT_distintos: 4,
  detalleRows_length: BENEF_ROWS.length,
};
