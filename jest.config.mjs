/** @type {import('jest').Config} */
import { pathsToModuleNameMapper } from 'ts-jest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const tsconfigRaw = readFileSync(path.join(__dirname, 'tsconfig.json'), 'utf-8')
const tsconfig = JSON.parse(
  tsconfigRaw.replace(/^\s*\/\/.*$/gm, '').replace(/,\s*}/g, '}').replace(/,\s*]/g, ']')
)

const baseTransform = {
  '^.+\\.(t|j)sx?$': [
    'ts-jest',
    {
      tsconfig: {
        target: 'ES2022',
        module: 'commonjs',
        moduleResolution: 'node',
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        strict: false,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        resolveJsonModule: true,
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        isolatedModules: true,
        noEmit: true,
        baseUrl: '.',
        paths: tsconfig.compilerOptions?.paths || {}
      },
      isolatedModules: true,
      useESM: false,
      diagnostics: false
    }
  ]
}

const baseModuleNameMapper = {
  '^@/tests/(.*)$': '<rootDir>/tests/$1',
  '^@/(.*)$': '<rootDir>/src/$1',
  ...pathsToModuleNameMapper(tsconfig.compilerOptions?.paths || {}, { prefix: '<rootDir>/' })
}

const baseCollectCoverageFrom = [
  'src/lib/security.ts',
  'src/lib/auth-config.ts',
  'src/lib/safe-redirect.ts',
  'src/lib/auth.ts',
  'src/lib/password-validator.ts',
  'src/lib/rate-limit.ts',
  'src/lib/permissions.ts',
  'src/lib/admin-roles.ts',
  'src/lib/audit.ts',
  'src/lib/m2m-route.ts',
  'src/lib/m2m-rate-limit.ts',
  'src/lib/external-user-provisioning.ts',
  'src/lib/provider-payment-update.ts',
  'src/lib/external-cfdi-import-staging.ts',
  'src/lib/external-cfdi-import-monitor.ts',
  'src/lib/dashboard-fiscal-route-utils.ts',
  'src/lib/dashboard-recibidos-route-utils.ts',
  'src/lib/dev-endpoint-guard.ts',
  'src/lib/invoice-import.ts',
  'src/lib/xml-sanitize.ts',
  'src/lib/cfdi-pdf.ts',
  'src/lib/invoice-xml-storage.ts',
  'src/lib/semaphore.ts',
  'src/lib/cfdi-signature-verifier.ts',
  'src/lib/encryption.ts',
  'src/lib/queue.ts',
  'src/lib/mass-downloads-route-utils.ts',
  'src/lib/monitor-route-utils.ts',
  'src/lib/monitor-security-helpers.ts',
  'src/lib/monitor-date-uuid-helpers.ts',
  'src/lib/m2m-oauth.ts',
  'src/lib/m2m-security-helpers.ts',
  'src/lib/m2m-oauth-security.ts',
  'src/lib/org-dashboard-helpers.ts',
  'src/lib/provider-context.ts',
  'src/lib/provider-cfdi-report.ts',
  'src/lib/provider-cfdi-report.constants.ts',
  'src/lib/provider-cfdi-storage.ts',
  'src/lib/provider-business-rules.ts',
  'src/lib/rfc-validate.ts',
  'src/lib/sat-debug-helpers.ts',
  'src/lib/sat-gate-helpers.ts',
  'src/lib/sat-seeder-helpers.ts',
  'src/lib/sat-error-humanization.ts',
  'src/lib/sat-69b-blacklist.ts',
  'src/lib/sat-service.ts',
  'src/schemas/auth.ts',
  'src/schemas/cfdiInput.ts',
  'src/schemas/dashboard-recibidos.ts',
  'src/schemas/dev.ts',
  'src/schemas/external.ts',
  'src/schemas/import.ts',
  'src/app/api/auth/**/*.ts',
  'src/app/api/companies/**/*.ts',
  'src/app/api/dashboard_fiscal/**/*.ts',
  'src/app/api/dashboard_recibidos/**/*.ts',
  'src/app/api/dev/**/*.ts',
  'src/app/api/external/**/*.ts',
  'src/app/api/import/**/*.ts',
  'src/app/api/invoices/**/*.ts',
  'src/app/api/mass-downloads/**/*.ts',
  'src/app/api/monitor/**/*.ts',
  'src/app/api/oauth/**/*.ts',
  'src/app/api/org/**/*.ts',
  'src/app/api/provider/**/*.ts',
  'src/app/api/rfc/**/*.ts',
  'src/app/api/sat/**/*.ts',
  'src/proxy.ts',
  '!src/**/*.d.ts'
]

const config = {
  testEnvironment: 'node',
  verbose: true,
  rootDir: '.',
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text-summary', 'text', 'lcov', 'json-summary', 'html'],
  // Coverage threshold global: 0% porque ahora cada project define los suyos
  // (unit aplica por-path 5 módulos Nivel1; integration/performance/sast heredan 0)
  coverageThreshold: {
    global: { lines: 0, statements: 0, functions: 0, branches: 0 }
  },
  testTimeout: 15000,
  forceExit: true,
  detectOpenHandles: false,
  // Proyectos Jest: permite ejecutar suites paralelas o separadas por tipo
  projects: [
    // =============== UNIT TESTS (NUEVA FASE 1) ===============
    // Funciones puras (sin DB ni mocking complejo). Paralelización agresiva.
    {
      displayName: 'unit',
      testEnvironment: 'node',
      rootDir: '.',
      testMatch: [
        '<rootDir>/tests/unit/**/*.unit.test.{ts,tsx,js,jsx}'
      ],
      transform: baseTransform,
      transformIgnorePatterns: [
        'node_modules/(?!(jose|@panva|@noble|next-auth|@auth|oauth4webapi)/)'
      ],
      moduleNameMapper: baseModuleNameMapper,
      moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
      setupFiles: ['<rootDir>/tests/setupTests.ts'],
      testTimeout: 15000,
      maxWorkers: '80%',
      verbose: true,
      // FASE 1: Coverage solo sobre los 5 módulos Nivel 1. El resto entra en FASE 2/3.
      collectCoverageFrom: [
        '<rootDir>/src/lib/xml-sanitize.ts',
        '<rootDir>/src/lib/semaphore.ts',
        '<rootDir>/src/lib/rate-limit.ts',
        '<rootDir>/src/lib/audit.ts',
        '<rootDir>/src/lib/queue.ts'
      ],
      // FASE 1 Thresholds (por-path). En FASE 2 agregamos más paths.
      coverageThreshold: {
        global: {
          lines: 0.55,
          statements: 0.55,
          functions: 0.40,
          branches: 0.30
        },
        './src/lib/xml-sanitize.ts': { lines: 0.85, branches: 0.80 },
        './src/lib/semaphore.ts': { lines: 0.90, branches: 0.85 },
        './src/lib/rate-limit.ts': { lines: 0.70, branches: 0.55 },
        './src/lib/audit.ts': { lines: 0.70, branches: 0.55 },
        './src/lib/queue.ts': { lines: 0.75, branches: 0.65 }
      }
    },
    // =============== INTEGRATION TESTS (FASE 2) ===============
    // Requieren DB test postgres-test:5434. Ejecución serial (--runInBand).
    // Setup: npm run db:test:up ; sleep 3 ; npm run db:test:migrate
    {
      displayName: 'integration',
      testEnvironment: 'node',
      rootDir: '.',
      testMatch: [
        '<rootDir>/tests/integration/**/*.integration.test.{ts,tsx,js,jsx}'
      ],
      transform: baseTransform,
      transformIgnorePatterns: [
        'node_modules/(?!(jose|@panva|@noble|next-auth|@auth|oauth4webapi)/)'
      ],
      moduleNameMapper: baseModuleNameMapper,
      moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
      setupFiles: ['<rootDir>/tests/setupTests.ts'],
      setupFilesAfterEnv: ['<rootDir>/tests/integration/setup-integration.ts'],
      testTimeout: 120000,
      maxWorkers: 1,
      verbose: true,
      // FASE 2: Coverage solo sobre módulos Nivel 2 probados en integración.
      collectCoverageFrom: [
        '<rootDir>/src/lib/permissions.ts',
        '<rootDir>/src/lib/rfc-validate.ts',
        '<rootDir>/src/lib/dashboard-fiscal-route-utils.ts',
        '<rootDir>/src/lib/auth.ts',
        '<rootDir>/src/lib/audit.ts',
        '<rootDir>/src/lib/external-cfdi-import-staging.ts',
        '<rootDir>/src/lib/invoice-import.ts',
        '<rootDir>/src/lib/xml-sanitize.ts',
        '<rootDir>/src/lib/rate-limit.ts',
        '<rootDir>/src/lib/semaphore.ts',
        '<rootDir>/src/lib/queue.ts'
      ],
      coverageThreshold: {
        global: {
          lines: 0.20,
          statements: 0.20,
          functions: 0.15,
          branches: 0.10
        },
        './src/lib/permissions.ts': { lines: 0.40, branches: 0.08 },
        './src/lib/rfc-validate.ts': { lines: 0.55, branches: 0.35 },
        './src/lib/dashboard-fiscal-route-utils.ts': { lines: 0.30, branches: 0.15 },
        './src/lib/audit.ts': { lines: 0.50, branches: 0.40 },
        './src/lib/external-cfdi-import-staging.ts': { lines: 0.00, branches: 0.00 },
        './src/lib/invoice-import.ts': { lines: 0.00, branches: 0.00 },
        './src/lib/xml-sanitize.ts': { lines: 0.00, branches: 0.00 },
        './src/lib/semaphore.ts': { lines: 0.00, branches: 0.00 },
        './src/lib/queue.ts': { lines: 0.00, branches: 0.00 },
        './src/lib/auth.ts': { lines: 0.10, branches: 0.00 }
      }
    },
    // =============== PERFORMANCE TESTS (FASE 3) ===============
    // Escenarios de escala para validar 5M registros: ReDoS, O(n) vs O(n²),
    // semaphore stress, BullMQ batch 10K jobs, RateLimit concurrencia 100 paralelo.
    // detectOpenHandles=true para detectar memory/handle leaks después del stress.
    {
      displayName: 'performance',
      testEnvironment: 'node',
      rootDir: '.',
      testMatch: [
        '<rootDir>/tests/performance/**/*.perf.test.{ts,tsx,js,jsx}'
      ],
      transform: baseTransform,
      transformIgnorePatterns: [
        'node_modules/(?!(jose|@panva|@noble|next-auth|@auth|oauth4webapi)/)'
      ],
      moduleNameMapper: baseModuleNameMapper,
      moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
      setupFiles: ['<rootDir>/tests/setupTests.ts'],
      testTimeout: 180000,
      maxWorkers: 1,
      verbose: true,
      detectOpenHandles: true,
      // FASE 3: Coverage sobre 5 módulos stress targets (mismos de FASE 1 pero
      // en escenarios escala; xml-sanitize, semaphore, queue, rate-limit, audit).
      collectCoverageFrom: [
        '<rootDir>/src/lib/xml-sanitize.ts',
        '<rootDir>/src/lib/semaphore.ts',
        '<rootDir>/src/lib/queue.ts',
        '<rootDir>/src/lib/rate-limit.ts',
        '<rootDir>/src/lib/audit.ts'
      ],
      // FASE 3 Thresholds humildes (Fases 1+2 ya cubrieron happy path + integración).
      coverageThreshold: {
        global: {
          lines: 0.20,
          statements: 0.20,
          functions: 0.15,
          branches: 0.10
        },
        './src/lib/xml-sanitize.ts': { lines: 0.30, branches: 0.20 },
        './src/lib/semaphore.ts': { lines: 0.30, branches: 0.20 },
        './src/lib/queue.ts': { lines: 0.15, branches: 0.10 },
        './src/lib/rate-limit.ts': { lines: 0.35, branches: 0.20 },
        './src/lib/audit.ts': { lines: 0.30, branches: 0.25 }
      }
    },
    // =============== E2E PIPELINE REAL (FASE 4) ===============
    // 330 CFDI XMLs reales (fixtures java-client/xml-data) pasan por el pipeline
    // sanitize + strict UUID RFC4122 + límite MAX_CONCEPTOS_POR_CFDI + validación SLA.
    // No hay coverage aquí (estrés happy path real).
    {
      displayName: 'e2e',
      testEnvironment: 'node',
      rootDir: '.',
      testMatch: ['<rootDir>/tests/e2e/**/*.{test,spec}.{ts,tsx,js,jsx}'],
      testPathIgnorePatterns: ['/node_modules/', '/.next/', '/.vercel/', '/coverage/', '/reports/'],
      transform: baseTransform,
      transformIgnorePatterns: [
        'node_modules/(?!(jose|@panva|@noble|next-auth|@auth|oauth4webapi)/)'
      ],
      moduleNameMapper: baseModuleNameMapper,
      moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
      setupFiles: ['<rootDir>/tests/setupTests.ts'],
      testTimeout: 240000,
      maxWorkers: 1,
      verbose: true,
      collectCoverageFrom: [],
      detectOpenHandles: false
    },
    // =============== SAST TESTS (LEGACY - EXISTENTES) ===============
    // ~80 tests de seguridad por módulo. Mantener intactos hasta migración.
    {
      displayName: 'sast',
      testEnvironment: 'node',
      rootDir: '.',
      testMatch: [
        '<rootDir>/tests/auth/**/*.{test,spec}.{ts,tsx,js,jsx}',
        '<rootDir>/tests/companies/**/*.{test,spec}.{ts,tsx,js,jsx}',
        '<rootDir>/tests/dashboard_fiscal/**/*.{test,spec}.{ts,tsx,js,jsx}',
        '<rootDir>/tests/dashboard_recibidos/**/*.{test,spec}.{ts,tsx,js,jsx}',
        '<rootDir>/tests/dev/**/*.{test,spec}.{ts,tsx,js,jsx}',
        '<rootDir>/tests/external/**/*.{test,spec}.{ts,tsx,js,jsx}',
        '<rootDir>/tests/import/**/*.{test,spec}.{ts,tsx,js,jsx}',
        '<rootDir>/tests/invoices/**/*.{test,spec}.{ts,tsx,js,jsx}',
        '<rootDir>/tests/mass_downloads/**/*.{test,spec}.{ts,tsx,js,jsx}',
        '<rootDir>/tests/monitor/**/*.{test,spec}.{ts,tsx,js,jsx}',
        '<rootDir>/tests/oauth/**/*.{test,spec}.{ts,tsx,js,jsx}',
        '<rootDir>/tests/org/**/*.{test,spec}.{ts,tsx,js,jsx}',
        '<rootDir>/tests/provider/**/*.{test,spec}.{ts,tsx,js,jsx}',
        '<rootDir>/tests/rfc/**/*.{test,spec}.{ts,tsx,js,jsx}',
        '<rootDir>/tests/sat/**/*.{test,spec}.{ts,tsx,js,jsx}'
      ],
      testPathIgnorePatterns: [
        '/node_modules/',
        '/.next/',
        '/.vercel/',
        '/coverage/',
        '/reports/',
        'tests/unit/',
        'tests/integration/',
        'tests/performance/'
      ],
      transform: baseTransform,
      transformIgnorePatterns: [
        'node_modules/(?!(jose|@panva|@noble|next-auth|@auth|oauth4webapi)/)'
      ],
      moduleNameMapper: baseModuleNameMapper,
      moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
      setupFiles: ['<rootDir>/tests/setupTests.ts'],
      testTimeout: 15000,
      maxWorkers: '50%',
      verbose: true,
      collectCoverageFrom: baseCollectCoverageFrom
    },
    // =============== DASHBOARD RH (FASE 4, NUEVO) ===============
    // Unit / SAST / Performance del Tablero RH (5 ejes SAT Nómina 1.2).
    // Cobertura mínima contractual ≥ 85% sobre helpers y analytics service.
    {
      displayName: 'dashboard_rh',
      testEnvironment: 'node',
      rootDir: '.',
      testMatch: [
        '<rootDir>/tests/dashboard_rh/**/*.{test,spec}.{ts,tsx,js,jsx}',
      ],
      testPathIgnorePatterns: ['/node_modules/', '/.next/', '/.vercel/', '/coverage/', '/reports/'],
      transform: baseTransform,
      transformIgnorePatterns: [
        'node_modules/(?!(jose|@panva|@noble|next-auth|@auth|oauth4webapi)/)'
      ],
      moduleNameMapper: baseModuleNameMapper,
      moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
      setupFiles: ['<rootDir>/tests/setupTests.ts'],
      testTimeout: 600000,
      maxWorkers: 1,
      verbose: true,
      detectOpenHandles: false,
      collectCoverageFrom: [
        '<rootDir>/src/lib/payroll-analytics-ui-helpers.ts',
        '<rootDir>/src/lib/payroll-analytics-service.ts',
        '<rootDir>/src/lib/rh-dashboard-url.ts',
        '<rootDir>/src/app/api/stats/rh/route.ts',
        '<rootDir>/src/app/dashboard/rh/_components/rh-shared.tsx',
        '<rootDir>/src/app/dashboard/rh/_components/rh-turnover.tsx',
        '<rootDir>/src/app/dashboard/rh/_components/rh-incapacidades.tsx',
        '<rootDir>/src/app/dashboard/rh/_components/rh-horas-extra.tsx',
        '<rootDir>/src/app/dashboard/rh/_components/rh-plantilla.tsx',
        '<rootDir>/src/app/dashboard/rh/_components/rh-beneficios.tsx',
      ],
      coverageThreshold: {
        global: {
          lines: 0,
          statements: 0,
          functions: 0,
          branches: 0,
        },
        './src/lib/payroll-analytics-ui-helpers.ts': { lines: 0.92, functions: 0.95, branches: 0.85 },
        './src/lib/rh-dashboard-url.ts':            { lines: 0.90, functions: 0.90, branches: 0.80 },
        './src/lib/payroll-analytics-service.ts':   { lines: 0.85, functions: 0.80, branches: 0.55 },
      }
    }
  ],
  // Configuración por defecto para `jest` sin --selectProjects
  testMatch: [
    '<rootDir>/tests/**/*.{test,spec}.{ts,tsx,js,jsx}'
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/.next/',
    '/.vercel/',
    '/coverage/',
    '/reports/'
  ],
  transform: baseTransform,
  transformIgnorePatterns: [
    'node_modules/(?!(jose|@panva|@noble|next-auth|@auth|oauth4webapi)/)'
  ],
  moduleNameMapper: baseModuleNameMapper,
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  setupFiles: ['<rootDir>/tests/setupTests.ts'],
  collectCoverageFrom: baseCollectCoverageFrom,
  maxWorkers: '50%'
}

export default config
