import { describe, expect, it } from '@jest/globals'

const RoutinePeriodPreset = {
  CURRENT_DAY: 'CURRENT_DAY',
  CURRENT_WEEK: 'CURRENT_WEEK',
  CUSTOM: 'CUSTOM',
  LAST_SEVEN_DAYS: 'LAST_SEVEN_DAYS',
} as const

const RoutineScheduleFrequency = {
  WEEKLY: 'WEEKLY',
} as const

jest.mock('@/lib/prisma', () => ({
  prisma: {
    downloadLog: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    downloadLogEvent: { create: jest.fn() },
    massDownloadRequest: { findUnique: jest.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import {
  buildMassDownloadRequestData,
  createOrGetRoutineOccurrence,
  getNextScheduledRun,
  resolveRoutinePeriod,
  syncRoutineDownloadLog,
} from '@/services/mass-download-routine.service'

type AsyncMock = {
  mockResolvedValue(value: unknown): void
}

const prismaMock = prisma as unknown as {
  downloadLog: {
    findUnique: AsyncMock
    create: AsyncMock
    update: AsyncMock
  }
  downloadLogEvent: { create: AsyncMock }
  massDownloadRequest: { findUnique: AsyncMock }
}

describe('Rutinas de descarga · calendario y ejecución idempotente', () => {
  it('resuelve periodos diarios, semanales y de últimos siete días en la zona configurada', () => {
    const reference = new Date('2026-11-09T18:00:00.000Z')
    const common = {
      customStartDate: null,
      customEndDate: null,
      timezone: 'America/Mexico_City',
    }

    const currentDay = resolveRoutinePeriod({ ...common, periodPreset: RoutinePeriodPreset.CURRENT_DAY }, reference)
    const currentWeek = resolveRoutinePeriod({ ...common, periodPreset: RoutinePeriodPreset.CURRENT_WEEK }, reference)
    const lastSevenDays = resolveRoutinePeriod({ ...common, periodPreset: RoutinePeriodPreset.LAST_SEVEN_DAYS }, reference)

    expect(currentDay.startDate.toISOString()).toBe('2026-11-09T06:00:00.000Z')
    expect(currentDay.endDate.toISOString()).toBe('2026-11-10T05:59:59.999Z')
    expect(currentWeek.startDate.toISOString()).toBe('2026-11-09T06:00:00.000Z')
    expect(lastSevenDays.startDate.toISOString()).toBe('2026-11-03T06:00:00.000Z')
  })

  it('resuelve un periodo personalizado conservando los límites inclusivos', () => {
    const period = resolveRoutinePeriod({
      periodPreset: RoutinePeriodPreset.CUSTOM,
      customStartDate: new Date('2026-02-01T00:00:00.000Z'),
      customEndDate: new Date('2026-02-28T00:00:00.000Z'),
      timezone: 'UTC',
    })

    expect(period.startDate.toISOString()).toBe('2026-02-01T00:00:00.000Z')
    expect(period.endDate.toISOString()).toBe('2026-02-28T23:59:59.999Z')
  })

  it('calcula el siguiente horario semanal sin ejecutar días no configurados', () => {
    const nextRun = getNextScheduledRun({
      scheduleFrequency: RoutineScheduleFrequency.WEEKLY,
      scheduledHour: 9,
      scheduledMinute: 30,
      weekDays: [1, 3],
      monthDays: [],
      timezone: 'UTC',
    }, new Date('2026-11-09T10:00:00.000Z'))

    expect(nextRun.toISOString()).toBe('2026-11-11T09:30:00.000Z')
  })

  it('normaliza RFC y filtros al crear la solicitud existente del SAT', () => {
    const data = buildMassDownloadRequestData({
      routine: {
        companyId: 'c123456789012345678901234',
        requestingRfc: 'ODE8604257UA',
        requestType: 'CFDI',
        retrievalType: 'EMITIDOS',
        filters: {
          issuerRfc: 'UNAUTHORIZED123',
          receiverRfc: 'XAXX010101000',
          status: 'Vigente',
        },
      },
      period: {
        startDate: new Date('2026-11-09T06:00:00.000Z'),
        endDate: new Date('2026-11-10T05:59:59.999Z'),
      },
    })

    expect(data.requestingRfc).toBe('ODE8604257UA')
    expect(data.issuerRfc).toBe('ODE8604257UA')
    expect(data.receiverRfc).toBe('XAXX010101000')
    expect(data.requestStatus).toBe('SOLICITADO')
  })

  it('reutiliza una ocurrencia existente y no crea una segunda descarga lógica', async () => {
    const scheduledFor = new Date('2026-11-09T09:30:00.000Z')
    const existing = {
      id: 'c123456789012345678901299',
      routineId: 'c123456789012345678901234',
      scheduledFor,
    }
    prismaMock.downloadLog.findUnique.mockResolvedValue(existing)

    const occurrence = await createOrGetRoutineOccurrence(
      {
        id: 'c123456789012345678901234',
        organizationId: 'c123456789012345678901233',
        companyId: 'c123456789012345678901232',
      },
      scheduledFor,
      {
        startDate: new Date('2026-11-09T00:00:00.000Z'),
        endDate: new Date('2026-11-09T23:59:59.999Z'),
      },
    )

    expect(occurrence).toBe(existing)
    expect(prismaMock.downloadLog.create).not.toHaveBeenCalled()
  })

  it('vincula el fallo terminal de la solicitud existente con la ejecución de rutina', async () => {
    prismaMock.massDownloadRequest.findUnique.mockResolvedValue({
      id: 'request-1',
      requestStatus: 'ERROR',
      satPackageId: 'SAT-1',
      packageIds: [],
      satMessage: 'Fallo temporal agotó reintentos',
      errorLog: { code: 'SAT_TIMEOUT', token: 'no-debe-guardarse' },
      downloadLog: { id: 'run-1' },
    })
    prismaMock.downloadLog.update.mockResolvedValue({ id: 'run-1' })
    prismaMock.downloadLogEvent.create.mockResolvedValue({ id: 'event-1' })

    await syncRoutineDownloadLog('request-1')

    expect(prismaMock.downloadLog.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'run-1' },
      data: expect.objectContaining({
        status: 'FAILED',
        errorCode: 'ERROR',
        satRequestId: 'SAT-1',
      }),
    }))
  })
})
