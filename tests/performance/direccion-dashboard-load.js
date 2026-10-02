import http from 'k6/http';
import { check } from 'k6';
import crypto from 'k6/crypto';
import { Trend } from 'k6/metrics';

// Métrica personalizada para medir el tiempo de consulta de los KPIs de dirección
const direccionKpiQueryMs = new Trend('direccion_kpi_duration');

export const options = {
  stages: [
    { duration: '10s', target: 10 }, // Ramp up a 10 VUs
    { duration: '60s', target: 50 }, // Carga sostenida a 50 VUs
    { duration: '10s', target: 0 },  // Ramp down a 0 VUs
  ],
  thresholds: {
    http_req_duration: [
      { threshold: 'p(95)<1500', abortOnFail: true },
      { threshold: 'p(99)<3000', abortOnFail: true },
    ],
    http_req_failed: ['rate<0.001'], // Menos del 0.1% de errores
    checks: ['rate==1.00'],          // 100% de los checks deben pasar
  },
};

// Datos simulados para la prueba (se iterarán para distribuir la carga)
const EMPRESAS = [
  'cmtm8jg7j00002qdwcvbvztgh',
  'cmtm8jg7r00012qdwca083613',
  'cmtm8jg7v00022qdwa7dhjv39',
  'cmtm8jg7y00032qdw3rtnkds3',
  'cmtm8jg8100042qdwll6nfck9',
  'cmtm8jg8400052qdwnrau9y8k',
  'cmtm8jg8900062qdw7jon7dnl'
];

const RANGOS_FECHAS = [
  { start: '2023-01-01', end: '2026-08-31', comparativo: 2022 }, // 5 años
  { start: '2025-01-01', end: '2026-08-31', comparativo: 2024 }, // 20 meses
  { start: '2026-01-01', end: '2026-06-30', comparativo: 2025 }  // 6 meses
];

const DEPARTAMENTOS = [null, 'Ventas', 'Administración'];

const BASE_URL = __ENV.API_BASE_URL || 'http://localhost:3000';
const MOCK_TOKEN = __ENV.API_TOKEN || 'service-token-staging-test-123'; // Token de servicio para bypass auth en staging

export function setup() {
  // Podríamos hacer un login real aquí si es necesario
  // En este caso, usaremos el token inyectado o por defecto para simplificar
  return { token: MOCK_TOKEN };
}

// Helper seguro para métricas de k6 en lugar de Math.random() (evita alerta de SonarQube)
const secureRandom = (max) => {
  const bytes = crypto.randomBytes(4);
  const num = (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];
  return Math.abs(num) % max;
};

export default function test(data) {
  // Seleccionar aleatoriamente una empresa, rango de fechas y departamento
  const empresa = EMPRESAS[secureRandom(EMPRESAS.length)];
  const rango = RANGOS_FECHAS[secureRandom(RANGOS_FECHAS.length)];
  const departamento = DEPARTAMENTOS[secureRandom(DEPARTAMENTOS.length)];
  
  // Construir la URL con los parámetros
  let url = `${BASE_URL}/api/stats/direccion?companyId=${empresa}&startDate=${rango.start}&endDate=${rango.end}&anioComparativo=${rango.comparativo}`;
  if (departamento) {
    url += `&departamento=${encodeURIComponent(departamento)}`;
  }

  // Headers de la petición
  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${data.token}`,
      'Cookie': `__Secure-next-auth.session-token=${data.token}` // Alternativa si usa cookies
    },
  };

  // Realizar la petición HTTP GET
  const res = http.get(url, params);
  
  // Registrar la métrica personalizada
  direccionKpiQueryMs.add(res.timings.duration);

  // Intentar parsear el JSON de respuesta de forma segura
  let body;
  try {
    body = res.json();
  } catch (_e) {
    body = {};
  }

  // Validaciones
  check(res, {
    'status es 200': (r) => r.status === 200,
    'ok es true': () => body.ok === true,
    'costoTotalNominaMxn es un número': () => typeof body?.kpis?.costoTotalNominaMxn === 'number',
    'payload no vacío (> 500 bytes)': (r) => Number(r.headers['Content-Length'] || r.body.length) > 500,
  });
}

export function teardown(_data) {
  // Limpieza si es necesaria
}
