import fs from 'fs'
import path from 'path'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { rateLimit } from '@/lib/rate-limit'
import { getM2MRateLimitConfig, getM2MRateLimitHeaders } from '@/lib/m2m-rate-limit'
import { withMachineScope } from '@/lib/m2m-route'
import { isInternalHostname, safeErrSummary, fingerprint } from '@/lib/security'
import {
  ExternalCfdiImportCreateSchema,
  CFDI_IMPORT_CREATE_SCOPE,
  MAX_EXTERNAL_PAYLOAD_BYTES,
  sanitizeZodIssues,
  MAX_EXTERNAL_CFDI_IMPORT_FILES
} from '@/schemas/external'
import { enqueueImportRunDispatch } from '@/lib/external-cfdi-import-processing'
import {
  MAX_BYTES_PER_FILE,
  stageExternalCfdiImport
} from '@/lib/external-cfdi-import-staging'

export const runtime = 'nodejs'

const IS_DEBUG_SAFE_ENV =
  process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test'
const IS_DEBUG_EXPLICITLY_ENABLED =
  process.env.EXTERNAL_CFDI_IMPORT_DEBUG_ENABLED === 'true'
const IS_DEBUG_ACTIVE = IS_DEBUG_SAFE_ENV && IS_DEBUG_EXPLICITLY_ENABLED

const MAX_PREPARSE_PAYLOAD_THRESHOLD_BYTES = Math.ceil(MAX_EXTERNAL_PAYLOAD_BYTES * 1.35)

function isPayloadTooLargeError(error: unknown) {
  return error instanceof Error
    && (
      error.message.includes('excede el límite')
      || error.message.includes('excede el límite total')
    )
}

function isLikelyJsonBodyLimitError(error: unknown) {
  return error instanceof SyntaxError
    && (
      error.message.includes('Unterminated string in JSON')
      || error.message.includes('Unexpected end of JSON input')
      || error.message.includes('position 10485760')
    )
}

// EXT-004 CRÍTICO · Gate producción debug-points
// EXT-005 CRÍTICO · SSRF allowlist isInternalHostname
// EXT-011 CRÍTICO · fs path absoluto cwd check
async function reportImportRouteDebug(params: {
  hypothesisId: 'A' | 'B' | 'C' | 'D' | 'E'
  location: string
  msg: string
  traceId?: string | null
  data?: Record<string, unknown>
}) {
  if (!IS_DEBUG_ACTIVE) return

  let debugServerUrl = 'http://127.0.0.1:7777/event'
  let sessionId = 'import-batch-500'

  try {
    const projectRoot = process.cwd()
    const dbgDir = path.join(projectRoot, '.dbg')
    const envPath = path.join(dbgDir, 'import-batch-500.env')

    const resolvedDbg = path.resolve(dbgDir)
    const resolvedRoot = path.resolve(projectRoot)
    if (!resolvedDbg.startsWith(resolvedRoot + path.sep) && resolvedDbg !== resolvedRoot) {
      return
    }

    if (fs.existsSync(envPath)) {
      const envFile = fs.readFileSync(envPath, 'utf8')
      const rawDebugUrl = envFile.match(/DEBUG_SERVER_URL=(.+)/)?.[1]?.trim()
      const rawSessionId = envFile.match(/DEBUG_SESSION_ID=(.+)/)?.[1]?.trim()

      if (rawDebugUrl) {
        try {
          const parsedUrl = new URL(rawDebugUrl)
          if (!isInternalHostname(parsedUrl.hostname)) {
            debugServerUrl = rawDebugUrl
          }
        } catch {}
      }
      if (rawSessionId) sessionId = rawSessionId
    }
  } catch {}

  try {
    const parsedTarget = new URL(debugServerUrl)
    if (isInternalHostname(parsedTarget.hostname)) {
      return
    }

    await fetch(debugServerUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        sessionId,
        runId: fingerprint(sessionId + '|' + Date.now()),
        hypothesisId: params.hypothesisId,
        location: params.location,
        msg: `[DEBUG] ${params.msg}`,
        ts: Date.now()
      }),
      signal: AbortSignal.timeout(1500)
    })
  } catch {}
}

// EXT-001 ALTO · Strict schemas + MAX_REQUEST_BYTES pre-check Content-Length
// EXT-006 MEDIO · Scope granular CFDI_IMPORT_CREATE_SCOPE (no scope único)
// EXT-013 ALTO · Pre-parse Content-Length threshold 1.35x MAX
export const POST = withMachineScope(CFDI_IMPORT_CREATE_SCOPE, async (request: NextRequest, authContext) => {
  try {
    // EXT-013 · Early size check ANTES de request.json() alloc memory
    const contentLengthRaw = request.headers.get('content-length')
    const contentLength = contentLengthRaw ? Number(contentLengthRaw) : NaN
    if (Number.isFinite(contentLength) && contentLength > MAX_PREPARSE_PAYLOAD_THRESHOLD_BYTES) {
      return NextResponse.json(
        { error: 'El payload excede el tamaño máximo permitido por el endpoint M2M.' },
        { status: 413 }
      )
    }

    const limiter = await rateLimit(
      `m2m:cfdi-import:create:${authContext.clientId}`,
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

    const body = await request.json()
    const payload = ExternalCfdiImportCreateSchema.parse(body)
    const traceId = payload.batchId || payload.directoryControl?.executionId || null

    await reportImportRouteDebug({
      hypothesisId: 'C',
      location: 'src/app/api/external/cfdi-import/route.ts:payload',
      traceId,
      msg: 'Payload validado en endpoint externo CFDI',
      data: {
        itemCount: payload.items.length,
        hasDirectoryControl: Boolean(payload.directoryControl)
      }
    })

    const result = await stageExternalCfdiImport({
      organizationId: authContext.organizationId,
      clientId: authContext.clientId,
      batchId: payload.batchId,
      directoryControl: payload.directoryControl,
      items: payload.items
    })

    await reportImportRouteDebug({
      hypothesisId: 'A',
      location: 'src/app/api/external/cfdi-import/route.ts:stage-result',
      traceId,
      msg: 'Staging completado en endpoint externo CFDI',
      data: {
        acceptedFiles: result.acceptedFiles,
        rejectedFiles: result.rejectedFiles,
        logicalItems: result.logicalItems,
        idempotent: result.idempotent
      }
    })

    try {
      await enqueueImportRunDispatch(result.importRunId)
    } catch (queueError) {
      await reportImportRouteDebug({
        hypothesisId: 'B',
        location: 'src/app/api/external/cfdi-import/route.ts:queue-error',
        traceId,
        msg: 'Fallo en enqueueImportRunDispatch',
        data: {
          errorName: queueError instanceof Error ? queueError.name : 'UnknownError'
        }
      })
      // EXT-008 · safeErrSummary NO PII
      console.error('[EXT-CFDI-IMPORT] Queue dispatch failed:', safeErrSummary(queueError))
    }

    return NextResponse.json(
      {
        success: true,
        importRunId: result.importRunId,
        status: result.status,
        receivedFiles: result.receivedFiles,
        acceptedFiles: result.acceptedFiles,
        rejectedFiles: result.rejectedFiles,
        logicalItems: result.logicalItems,
        idempotent: result.idempotent,
        rejections: result.rejections,
        limits: {
          maxFilesPerRequest: MAX_EXTERNAL_CFDI_IMPORT_FILES,
          maxBytesPerFile: MAX_BYTES_PER_FILE,
          maxRequestBytes: MAX_EXTERNAL_PAYLOAD_BYTES
        }
      },
      { status: 202 }
    )
  } catch (error) {
    await reportImportRouteDebug({
      hypothesisId: error instanceof z.ZodError ? 'C' : 'E',
      location: 'src/app/api/external/cfdi-import/route.ts:catch',
      msg: 'Error atrapado en endpoint externo CFDI'
    })

    // EXT-008 ALTO · safeErrSummary typed NO emails/RFC en logs
    console.error('[EXT-CFDI-IMPORT] Handler failed:', safeErrSummary(error))

    // EXT-002 ALTO · sanitizeZodIssues whitelist fields
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: 'Datos inválidos',
          details: sanitizeZodIssues(error.issues)
        },
        { status: 400 }
      )
    }

    if (
      error instanceof Error
      && error.message === 'ningún archivo válido fue aceptado para staging'
    ) {
      const rejections = (error as Error & { rejections?: unknown }).rejections ?? []

      return NextResponse.json(
        {
          error: 'No se aceptó ningún archivo para importación',
          details: rejections
        },
        { status: 400 }
      )
    }

    if (
      error instanceof Error
      && error.message === 'directoryControl no coincide con la sesión ya registrada'
    ) {
      return NextResponse.json(
        { error: 'Las cifras de control del directorio no coinciden con la sesión ya registrada' },
        { status: 400 }
      )
    }

    if (isPayloadTooLargeError(error)) {
      return NextResponse.json(
        { error: 'El payload excede los límites permitidos' },
        { status: 413 }
      )
    }

    if (isLikelyJsonBodyLimitError(error)) {
      return NextResponse.json(
        { error: 'El payload JSON excede el tamaño procesable por el endpoint. Reduce el tamaño del lote e inténtalo nuevamente.' },
        { status: 413 }
      )
    }

    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
})
