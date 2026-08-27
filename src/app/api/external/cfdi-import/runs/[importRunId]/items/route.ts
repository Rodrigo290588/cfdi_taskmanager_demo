import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { rateLimit } from '@/lib/rate-limit'
import { getM2MRateLimitConfig, getM2MRateLimitHeaders } from '@/lib/m2m-rate-limit'
import { withMachineScope, withNoCacheHeaders } from '@/lib/m2m-route'
import {
  getImportRunSummary,
  listImportRunItems
} from '@/lib/external-cfdi-import-monitor'
import { safeErrSummary } from '@/lib/security'
import {
  ExternalCfdiImportRunParamsSchema,
  ExternalCfdiImportItemsQuerySchema,
  CFDI_IMPORT_RUNS_READ_SCOPE,
  sanitizeZodIssues
} from '@/schemas/external'

export const runtime = 'nodejs'

// EXT-003 MEDIO · searchParams dedup: tomar SÓLO el primer valor de cada key, NO último valor gana
function dedupSearchParams(urlSearchParams: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {}
  const seen = new Set<string>()
  for (const [key, value] of urlSearchParams.entries()) {
    if (!seen.has(key)) {
      seen.add(key)
      out[key] = value
    }
  }
  return out
}

// EXT-006 · Scope granular CFDI_IMPORT_RUNS_READ_SCOPE (no scope único)
// EXT-010 · withNoCache headers private,no-store
export const GET = withMachineScope(CFDI_IMPORT_RUNS_READ_SCOPE, withNoCacheHeaders(async (
  request: NextRequest,
  authContext,
  routeContext
) => {
  try {
    const limiter = await rateLimit(
      `m2m:cfdi-import:run-items:${authContext.clientId}`,
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

    // EXT-003 · deduplicado searchParams (evita último valor gana por Object.fromEntries)
    const searchParams = dedupSearchParams(request.nextUrl.searchParams)
    const query = ExternalCfdiImportItemsQuerySchema.parse(searchParams)
    const result = await listImportRunItems({
      importRunId,
      organizationId: authContext.organizationId,
      page: query.page,
      pageSize: query.pageSize,
      filters: {
        status: query.status,
        direction: query.direction,
        validationBucket: query.validationBucket,
        hasErrors: query.hasErrors,
        waitingExternalValidation: query.waitingExternalValidation
      }
    })

    return NextResponse.json({
      success: true,
      importRunId,
      runStatus: run.status,
      pagination: result.pagination,
      items: result.items
    })
  } catch (error) {
    console.error('[EXT-CFDI-ITEMS] Handler failed:', safeErrSummary(error))

    // EXT-002 · sanitizeZodIssues whitelist
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
