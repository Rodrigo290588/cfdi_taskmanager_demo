import { describe, expect, it } from '@jest/globals'
import {
  CreateRoutineSchema,
  RoutineActionSchema,
} from '@/lib/validations/mass-download-routine.schema'

const COMPANY_ID = 'c123456789012345678901234'

function buildRoutinePayload(): Record<string, unknown> {
  return {
    companyId: COMPANY_ID,
    name: 'Descarga diaria de CFDI',
    requestType: 'CFDI',
    retrievalType: 'EMITIDOS',
    filters: {
      status: 'Vigente',
      voucherType: 'I',
    },
    periodPreset: 'CURRENT_DAY',
    schedule: {
      frequency: 'DAILY',
      scheduledHour: 7,
      timezone: 'America/Mexico_City',
    },
  }
}

describe('Rutinas de descarga · validación Zod', () => {
  it('acepta una rutina diaria válida y aplica valores predeterminados seguros', () => {
    const result = CreateRoutineSchema.safeParse(buildRoutinePayload())

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.schedule.scheduledMinute).toBe(0)
      expect(result.data.storageOptions.enabled).toBe(false)
      expect(result.data.filters.status).toBe('Vigente')
    }
  })

  it('rechaza campos no declarados para bloquear sobrepublicación', () => {
    const result = CreateRoutineSchema.safeParse({
      ...buildRoutinePayload(),
      organizationId: 'attacker-organization',
      createdByUserId: 'attacker-user',
      nextRunAt: '2099-01-01T00:00:00.000Z',
    })

    expect(result.success).toBe(false)
  })

  it('requiere días para la programación semanal', () => {
    const payload = buildRoutinePayload()
    payload.schedule = {
      frequency: 'WEEKLY',
      scheduledHour: 7,
      scheduledMinute: 0,
      timezone: 'America/Mexico_City',
      weekDays: [],
    }

    const result = CreateRoutineSchema.safeParse(payload)
    expect(result.success).toBe(false)
  })

  it('requiere un periodo personalizado completo y ordenado', () => {
    const payload = buildRoutinePayload()
    payload.periodPreset = 'CUSTOM'
    payload.customStartDate = '2026-11-10'
    payload.customEndDate = '2026-11-01'

    const result = CreateRoutineSchema.safeParse(payload)
    expect(result.success).toBe(false)
  })

  it('acepta periodos dinámicos diarios y semanales', () => {
    for (const periodPreset of ['CURRENT_DAY', 'PREVIOUS_DAY', 'CURRENT_WEEK', 'PREVIOUS_WEEK', 'LAST_SEVEN_DAYS']) {
      const result = CreateRoutineSchema.safeParse({
        ...buildRoutinePayload(),
        periodPreset,
      })
      expect(result.success).toBe(true)
    }
  })

  it('rechaza rutas físicas y exige un destino lógico cuando se habilita almacenamiento', () => {
    const physicalPathResult = CreateRoutineSchema.safeParse({
      ...buildRoutinePayload(),
      storageOptions: {
        enabled: true,
        extractionDestinationId: 'C:\\descargas',
      },
    })
    const missingDestinationResult = CreateRoutineSchema.safeParse({
      ...buildRoutinePayload(),
      storageOptions: {
        enabled: true,
      },
    })

    expect(physicalPathResult.success).toBe(false)
    expect(missingDestinationResult.success).toBe(false)
  })

  it('solo permite las acciones de ciclo de vida esperadas', () => {
    expect(RoutineActionSchema.safeParse({ action: 'pause' }).success).toBe(true)
    expect(RoutineActionSchema.safeParse({ action: 'resume' }).success).toBe(true)
    expect(RoutineActionSchema.safeParse({ action: 'delete' }).success).toBe(false)
  })
})
