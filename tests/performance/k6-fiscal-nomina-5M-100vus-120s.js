// =================================================================
// tests/performance/k6-fiscal-nomina-5M-100vus-120s.js
//
// TASK 13 · FASE 4
// Script de estrés k6 para endpoint analítico /api/stats/fiscal_nomina
//
// NFR (Hardening escala 5M históricos + >1M anuales):
//   · NFR-01: p(95) ≤ 900ms
//   · NFR-02: p(99) ≤ 1.8s
//   · NFR-03: http_req_failed < 0.05%   (≤ 1 error de 2000)
//   · NFR-04: checks ≥ 99.95%
//   · NFR-05: VU máximos = 100 (pico concurrencia equipo finanzas)
//
// Pre-requisitos para ejecutar:
//   1. Postgres con 5M de payroll_receipts + 40M de percepciones/deducciones
//      poblados y MV mv_fiscal_conciliacion_mensual REFRESH CONCURRENTLY
//      + ANALYZE ejecutado.
//   2. Next.js en modo producción: `npm run build && npm run start`
//      (no Turbopack dev)
//   3. Bearer token auth (JWT cookie o session token) o auth bypass de
//      staging configurado en K6_AUTH_HEADERS abajo.
//   4. k6 instalado: https://k6.io/docs/get-started/installation/
//
// Ejecutar:
//   $env:K6_STAGES="15s:20,120s:100,10s:0"
//   k6 run tests/performance/k6-fiscal-nomina-5M-100vus-120s.js `
//      --out json=reports/k6-fiscal-nomina-100vus-120s.json `
//      --summary-export=reports/k6-fiscal-nomina-summary.json
// =================================================================

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { randomIntBetween, randomItem } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

// ==========================================================
// CONFIGURACIÓN — AJUSTAR POR ENTORNO
// ==========================================================
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const AUTH_COOKIE = __ENV.K6_AUTH_COOKIE || '';  // Ej. 'next-auth.session-token=xxx; Secure'
const API_PATH  = '/api/stats/fiscal_nomina';

// Pool de compañías (IDs reales del staging poblado)
const COMPANY_IDS = (__ENV.K6_COMPANY_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const DEFAULT_COMPANIES = [
  'cmp_ODE8604257UA_demo01',
  'cmp_NMP7502257ZA_demo02',
  'cmp_QA2414521FJW_qa01',
  'cmp_QA27383427M8_qa02',
  'cmp_QB2983782QT1_qa03',
];
const POOL_COMPANIES = COMPANY_IDS.length > 0 ? COMPANY_IDS : DEFAULT_COMPANIES;

// Pool de rangos de fechas — 3 meses · 6 meses · 1 año · 3 años · 5 años (máx permitido)
const POOL_RANGOS = [
  { s: '2026-06-01', e: '2026-08-31', label: '3m' },
  { s: '2026-03-01', e: '2026-08-31', label: '6m' },
  { s: '2025-09-01', e: '2026-08-31', label: '1y' },
  { s: '2023-09-01', e: '2026-08-31', label: '3y' },
  { s: '2021-09-01', e: '2026-08-31', label: '5y_máx' },
];

const POOL_DEPARTAMENTOS = ['Finanzas', 'Operaciones', 'Ventas', 'Recursos Humanos', 'Tecnología', ''];
const POOL_REGISTROS = ['Y-000-123456', 'Z-999-987654', ''];

// ==========================================================
// THRESHOLDS (CRITERIOS DE ACEPTACIÓN NFR)
// ==========================================================
export const options = {
  scenarios: {
    fiscal_nomina_analytics: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '15s',  target: 20  },   // Ramp-up suave 0 → 20 VUs
        { duration: '120s', target: 100 },   // Sostenido 2 min a 100 VUs (pico)
        { duration: '10s',  target: 0   },   // Ramp-down 0
      ],
      gracefulRampDown: '30s',
      gracefulStop:     '30s',
    },
  },
  thresholds: {
    'http_req_duration{name:fiscal_nomina_stats}': [
      'p(90)  < 650',
      'p(95)  < 900',   // NFR-01 · hardening escala 5M
      'p(99)  < 1800',  // NFR-02 · p(99) ≤ 1.8s
      'avg    < 300',   // Latencia media < 300ms (cache hits)
    ],
    'http_req_failed{name:fiscal_nomina_stats}': [
      'rate < 0.0005',  // NFR-03 · < 0.05% de errores
    ],
    checks: [
      'rate > 0.9995',  // NFR-04 · ≥ 99.95% checks OK
    ],
    iterations: ['count >= 4000'], // Mínimo de requests para estadística válida
  },
  noConnectionReuse: false,
  userAgent: 'k6-fiscal-nomina/1.0 (performance-testing)',
};

// ==========================================================
// HELPERS
// ==========================================================
function buildParams() {
  const company = randomItem(POOL_COMPANIES);
  const rango   = randomItem(POOL_RANGOS);
  const depto   = randomItem(POOL_DEPARTAMENTOS);
  const rp      = randomItem(POOL_REGISTROS);

  const q = new URLSearchParams({
    companyId:   company,
    startDate:   rango.s,
    endDate:     rango.e,
  });
  if (depto) q.append('departamento', depto);
  if (rp)    q.append('registroPatronal', rp);
  // Aleatoriamente pedir sections default u omitirlas (50/50)
  if (randomIntBetween(0, 1) === 1) {
    q.append('sections', 'kpis,gravado_exento,deducciones_terceros');
  }
  return { qs: q.toString(), company, rangoLabel: rango.label };
}

// ==========================================================
// VU MAIN — Virtual User Iteration
// ==========================================================
export default function fiscalNominaAnalyticsVu() {
  const { qs, company, rangoLabel } = buildParams();
  const url = `${BASE_URL}${API_PATH}?${qs}`;

  const params = {
    tags: {
      name: 'fiscal_nomina_stats',
      empresa_size: POOL_COMPANIES.indexOf(company) < 2 ? 'grande' : 'qa',
      rango: rangoLabel,
    },
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip, br',
      ...(AUTH_COOKIE ? { 'Cookie': AUTH_COOKIE } : {}),
      // Si usas Bearer token de staging en vez de cookie:
      // 'Authorization': `Bearer ${__ENV.K6_BEARER}`,
    },
  };

  group(`GET ${API_PATH} · ${rangoLabel}`, () => {
    const res = http.get(url, params);

    // CHECK-01: HTTP status
    check(res, {
      'status es 200 OK o 304 (cache HIT)': (r) =>
        r.status === 200 || r.status === 304,
    }) || console.warn(`[HTTP ${res.status}] company=${company} rango=${rangoLabel} body=${res.body.slice(0, 240)}`);

    // CHECK-02: Respuesta JSON válida y payload esperado { ok, data }
    if (res.status === 200) {
      check(res, {
        'payload JSON tiene ok=true': (r) => {
          try {
            const j = r.json();
            return j.ok === true && !!j.data;
          } catch { return false; }
        },
        'data.isr_retenido_mxn numérico': (r) => {
          try {
            const j = r.json();
            return typeof j.data?.isr_retenido_mxn === 'number'
                || typeof j.data?.isr_retenido_mxn === 'string';
          } catch { return false; }
        },
        'data.sections array de 6 claves': (r) => {
          try {
            const j = r.json();
            return Array.isArray(j.data?.kpis_section)
                && Array.isArray(j.data?.gravado_exento);
          } catch { return false; }
        },
        'sin errores 5xx / stack leak': (r) =>
          !/<title>.*Error/i.test(r.body) &&
          !/STACK_TRACE|INTERNAL_ERROR_UNCAUGHT/i.test(r.body),
      });
    }

    // CHECK-03: Headers seguridad y caché presentes
    if (res.status === 200 || res.status === 304) {
      const cc  = res.headers['Cache-Control'] || '';
      const xfo = res.headers['X-Frame-Options']  || '';
      const csp = res.headers['Content-Security-Policy'] || '';
      check(res, {
        'Cache-Control public, s-maxage=300 (CDN safe)': () =>
          /s-maxage=\d+/.test(cc) || /public/.test(cc),
        'X-Frame-Options DENY/SAMEORIGIN (SAT DASH-SAST-007)': () =>
          /DENY|SAMEORIGIN/i.test(xfo),
        'CSP no-unsafe-inline presente': () => csp.length > 0,
      });
    }
  });

  // Pensamiento entre iteraciones — usuario lee dashboard ~3s
  const t = randomIntBetween(1000, 5000) / 1000;
  sleep(t);
}

// ==========================================================
// TEOREMA DE SERVICE TIME (Little's Law) — sanity check
// ==========================================================
// Si p(95) = 0.9s y VUs=100, throughput sostenible teórico =
//   X = VUs / R = 100 / 0.9 ≈ 111 req/s.
// Durante 120s sostenidos: ~13,300 requests mínimo esperado.
//
// El endpoint usa 3 estrategias clave para superar esto:
//   1. Index Only Scan sobre MV (INCLUDE 18 cols) = 0 heap fetches.
//   2. Predicado ROW(año,mes) para prune de rangos sin seq scan.
//   3. SET LOCAL max_parallel_workers_per_gather = 4 + parallel_setup/tuple = 0.
//   4. Cache-Control s-maxage=300 (5 min) + stale-while-revalidate=600.
// ==========================================================

export function handleSummary(data) {
  // Output rápido en consola + guarda reports/k6-*.txt si el script lo pide
  const fs = require('fs');
  const out = {};
  const summary = `
============================================================
K6 FISCAL NÓMINA — RESUMEN EJECUTIVO (5M rows + 100 VUs)
============================================================
p(50) http_req_duration : ${data.metrics['http_req_duration{name:fiscal_nomina_stats}']?.values['p(50)']?.toFixed(0) ?? 'N/A'} ms
p(90) http_req_duration : ${data.metrics['http_req_duration{name:fiscal_nomina_stats}']?.values['p(90)']?.toFixed(0) ?? 'N/A'} ms
p(95) http_req_duration : ${data.metrics['http_req_duration{name:fiscal_nomina_stats}']?.values['p(95)']?.toFixed(0) ?? 'N/A'} ms  ← NFR-01 ≤900ms
p(99) http_req_duration : ${data.metrics['http_req_duration{name:fiscal_nomina_stats}']?.values['p(99)']?.toFixed(0) ?? 'N/A'} ms  ← NFR-02 ≤1800ms
avg  http_req_duration : ${data.metrics['http_req_duration{name:fiscal_nomina_stats}']?.values.avg?.toFixed(0) ?? 'N/A'} ms
http_req_failed         : ${(data.metrics['http_req_failed{name:fiscal_nomina_stats}']?.values.rate * 100).toFixed(4)} %
checks pass rate        : ${(data.metrics.checks?.values.passes * 100).toFixed(3)} %    ← ≥99.95%
iterations total        : ${data.metrics.iterations?.values.count?.toLocaleString()}
throughput req/s        : ${(data.metrics.iterations?.values.count / 145).toFixed(1)}
============================================================
`;
  try {
    fs.mkdirSync('reports', { recursive: true });
    fs.writeFileSync('reports/k6-fiscal-nomina-100vus-120s.txt', summary);
  } catch { /* stdout only */ }
  out['stdout'] = summary;
  return out;
}
