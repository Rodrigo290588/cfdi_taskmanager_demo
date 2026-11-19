import { describe, expect, it } from '@jest/globals'
import { createLogger } from '@/lib/logger'

describe('Rutinas de descarga · logger estructurado', () => {
  it('emite JSON correlacionable y redacta RFC, secretos y payloads sensibles', () => {
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined)
    const logger = createLogger({
      service: 'mass-download-routine-worker',
      correlationId: 'correlation-1',
      routineId: 'routine-1',
      runId: 'run-1',
      massDownloadRequestId: 'request-1',
      satRequestId: 'SAT-1',
      jobId: 'job-1',
    })

    logger.info('sat.request.started', {
      rfc: 'ODE8604257UA',
      token: 'should-never-appear',
      soapRequest: '<xml>should-never-appear</xml>',
      count: 3,
    })

    const raw = String(infoSpy.mock.calls[0]?.[0])
    const logged = JSON.parse(raw) as Record<string, unknown>
    expect(logged.event).toBe('sat.request.started')
    expect(logged.correlationId).toBe('correlation-1')
    expect(raw).not.toContain('ODE8604257UA')
    expect(raw).not.toContain('should-never-appear')
    expect(raw).toContain('[REDACTED]')
    infoSpy.mockRestore()
  })

  it('no interrumpe el flujo principal si la escritura del log falla', () => {
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {
      throw new Error('El destino de logs no está disponible')
    })
    const logger = createLogger({ service: 'mass-download-routine-worker' })

    expect(() => logger.info('routine.execution.queued')).not.toThrow()
    infoSpy.mockRestore()
  })
})
