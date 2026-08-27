import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { rateLimit } from '@/lib/rate-limit'
import { getM2MRateLimitConfig, getM2MRateLimitHeaders } from '@/lib/m2m-rate-limit'
import { withMachineScope, withNoCacheHeaders } from '@/lib/m2m-route'
import { getImportRunSummary } from '@/lib/external-cfdi-import-monitor'
import { safeErrSummary } from '@/lib/security'
import {
  ExternalCfdiImportRunParamsSchema,
  CFDI_IMPORT_RUNS_READ_SCOPE,
  sanitizeZodIssues
} from '@/schemas/external'

export const runtime = 'nodejs'

// EXT-006 · Scope granular CFDI_IMPORT_RUNS_READ_SCOPE (no scope único genérico)
// EXT-010 · withNoCache headers Cache-Control private,no-store + HSTS
export const GET = withMachineScope(CFDI_IMPORT_RUNS_READ_SCOPE, withNoCacheHeaders(async (
  request: NextRequest,
  authContext,
  routeContext
) => {
  try {
    const limiter = await rateLimit(
      `m2m:cfdi-import:runs:${authContext.clientId}`,
      getM2MRateLimitConfig()
    )

    if (!limiter.success) {
      return NextResponse.json(
        { error: 'Demasiadas peticiones para este cliente' },
        {
          status: 429,
          headers: getM2MRateLimitHeaders(limiter)
        }
      )
    }

    const rawParams = routeContext?.params ? await routeContext.params : {}
    const { importRunId } = ExternalCfdiImportRunParamsSchema.parse(rawParams)
    const run = await getImportRunSummary(importRunId, authContext.organizationId)

    if (!run) {
      return NextResponse.json(
        { error: 'Corrida de importación no encontrada' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      importRun: run
    })
  } catch (error) {
    // EXT-008 · safeErrSummary NO PII
    console.error('[EXT-CFDI-RUNS] Handler failed:', safeErrSummary(error))

    // EXT-002 · sanitizeZodIssues
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: 'Datos inválidos',
          details: sanitizeZodIssues(error.issues)
        },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
}))
