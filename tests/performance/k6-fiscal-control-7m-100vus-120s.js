// Fiscal Control scalability test: 7M historical records + 2M annual growth.
// Run only against a prepared non-production database.
import http from 'k6/http'
import { check, sleep } from 'k6'

export const options = {
  stages: [
    { duration: '15s', target: 20 },
    { duration: '120s', target: 100 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    'http_req_duration{name:fiscal_control_page}': ['p(95)<900', 'p(99)<1800'],
    'http_req_failed{name:fiscal_control_page}': ['rate<0.0005'],
  },
}

const baseUrl = __ENV.BASE_URL || 'http://localhost:3000'
const authCookie = __ENV.K6_AUTH_COOKIE || ''
const companies = (__ENV.K6_COMPANY_IDS || '').split(',').filter(Boolean)
const authCookies = authCookie
  .split(';')
  .map(cookie => cookie.trim())
  .filter(Boolean)
  .map(cookie => {
    const separator = cookie.indexOf('=')
    return separator < 1
      ? null
      : { name: cookie.slice(0, separator), value: cookie.slice(separator + 1) }
  })
  .filter(Boolean)

if (!companies.length) {
  throw new Error('K6_COMPANY_IDS must contain prepared company IDs')
}

export function fiscalControlLoadScenario() {
  const companyId = companies[__VU % companies.length]
  const url = `${baseUrl}/api/mass-downloads/fiscal-control?companyId=${encodeURIComponent(companyId)}&startDate=2024-01-01&endDate=2024-12-31&pageSize=100`
  const jar = http.cookieJar()
  for (const cookie of authCookies) {
    jar.set(baseUrl, cookie.name, cookie.value)
  }
  const response = http.get(url, {
    tags: { name: 'fiscal_control_page' },
  })
  check(response, {
    'respuesta correcta': result => result.status === 200,
    'pagina limitada': result => {
      if (result.status !== 200) return false
      const payload = result.json()
      return Boolean(
        payload &&
          payload.table &&
          Array.isArray(payload.table.rows) &&
          payload.table.rows.length <= 100,
      )
    },
  })
  sleep(0.2)
}

export default fiscalControlLoadScenario
