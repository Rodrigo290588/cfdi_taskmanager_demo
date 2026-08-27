import fs from 'fs'
import JSZip from 'jszip'
import { Prisma } from '@prisma/client'
import { randomUUID, createHash } from 'node:crypto'
import { encryptInvoiceXmlContent } from '@/lib/invoice-xml-storage'
import { prisma } from '@/lib/prisma'
import { getImportRunSummary } from '@/lib/external-cfdi-import-monitor'

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const ZIP_MAGIC = '504b'

export const CFDI_IMPORT_SOURCE = 'JAVA_M2M'
export const MAX_FILES_PER_REQUEST = 500
export const MAX_BYTES_PER_FILE = 50 * 1024 * 1024
export const MAX_REQUEST_BYTES = 250 * 1024 * 1024
export const MAX_ZIP_ENTRIES = 5000
export const MAX_XML_PER_ZIP = 500

type StagedSourceItem = {
  fileName: string
  contentBase64: string
  contentSha256?: string
}

type DirectoryControlPayload = {
  executionId: string
  totalXmlFiles: number
  skippedByProgressFiles: number
  newXmlFiles: number
}

type ExpandedXmlCandidate = {
  sourceFileName: string
  fileName: string
  xmlContent: string
}

type LightXmlMetadata = {
  uuid: string | null
  issuerRfc: string | null
  receiverRfc: string | null
}

type RejectedSourceFile = {
  fileName: string
  code: string
  message: string
}

type ImportDirectorySessionRow = {
  id: string
  totalXmlFiles: number
  skippedByProgressFiles: number
  newXmlFiles: number
}

type StageResult = {
  importRunId: string
  status: string
  receivedFiles: number
  acceptedFiles: number
  rejectedFiles: number
  logicalItems: number
  rejections: RejectedSourceFile[]
  idempotent: boolean
}

// #region debug-point D:report-import-staging
async function reportImportStagingDebug(params: {
  hypothesisId: 'A' | 'D'
  location: string
  msg: string
  traceId?: string | null
  data?: Record<string, unknown>
}) {
  let debugServerUrl = 'http://127.0.0.1:7777/event'
  let sessionId = 'import-batch-500'

  try {
    const envFile = fs.readFileSync('.dbg/import-batch-500.env', 'utf8')
    debugServerUrl = envFile.match(/DEBUG_SERVER_URL=(.+)/)?.[1]?.trim() || debugServerUrl
    sessionId = envFile.match(/DEBUG_SESSION_ID=(.+)/)?.[1]?.trim() || sessionId
  } catch {}

  try {
    await fetch(debugServerUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        sessionId,
        runId: 'pre-fix',
        hypothesisId: params.hypothesisId,
        location: params.location,
        traceId: params.traceId || undefined,
        msg: `[DEBUG] ${params.msg}`,
        data: params.data || {},
        ts: Date.now()
      })
    })
  } catch {}
}
// #endregion

function sha256Hex(value: Buffer | string) {
  return createHash('sha256').update(value).digest('hex')
}

function isLikelyZip(buffer: Buffer) {
  return buffer.subarray(0, 2).toString('hex').toLowerCase() === ZIP_MAGIC
}

function normalizeXmlText(value: string) {
  return value.replace(/^\uFEFF/, '').trim()
}

function decodeBase64(base64: string) {
  const normalized = base64.replace(/\s+/g, '')

  if (!normalized || normalized.length % 4 !== 0 || !BASE64_PATTERN.test(normalized)) {
    throw new Error('contenido base64 inválido')
  }

  return Buffer.from(normalized, 'base64')
}

function attrNs(xml: string, tagNs: string, attrName: string): string | null {
  const re = new RegExp(`<${tagNs}[^>]*\\b${attrName}\\s*=\\s*"([^"]+)"`, 'i')
  const match = xml.match(re)
  return match ? match[1].trim() : null
}

function extractLightXmlMetadata(xml: string): LightXmlMetadata {
  const comprobanteTag = xml.includes('<cfdi:Comprobante') ? 'cfdi:Comprobante' : 'Comprobante'
  const emisorTag = xml.includes('<cfdi:Emisor') ? 'cfdi:Emisor' : 'Emisor'
  const receptorTag = xml.includes('<cfdi:Receptor') ? 'cfdi:Receptor' : 'Receptor'
  const timbreTag = xml.includes('<tfd:TimbreFiscalDigital') ? 'tfd:TimbreFiscalDigital' : 'TimbreFiscalDigital'

  const fallbackUuid =
    attrNs(xml, timbreTag, 'UUID')
    || attrNs(xml, '[^:>]*:?TimbreFiscalDigital', 'UUID')

  if (!xml.includes(`<${comprobanteTag}`) && !xml.includes('<cfdi:Comprobante') && !xml.includes('<Comprobante')) {
    return {
      uuid: fallbackUuid ? fallbackUuid.toUpperCase() : null,
      issuerRfc: null,
      receiverRfc: null
    }
  }

  return {
    uuid: fallbackUuid ? fallbackUuid.toUpperCase() : null,
    issuerRfc: (attrNs(xml, emisorTag, 'Rfc') || attrNs(xml, '[^:>]*:?Emisor', 'Rfc') || null)?.toUpperCase() || null,
    receiverRfc: (attrNs(xml, receptorTag, 'Rfc') || attrNs(xml, '[^:>]*:?Receptor', 'Rfc') || null)?.toUpperCase() || null
  }
}

async function expandSourceItem(item: StagedSourceItem): Promise<ExpandedXmlCandidate[]> {
  const decodedBuffer = decodeBase64(item.contentBase64)

  if (decodedBuffer.byteLength > MAX_BYTES_PER_FILE) {
    throw new Error(`el archivo excede el límite permitido de ${MAX_BYTES_PER_FILE} bytes`)
  }

  const providedSha = item.contentSha256?.trim().toLowerCase()
  const actualSha = sha256Hex(decodedBuffer)

  if (providedSha && providedSha !== actualSha) {
    throw new Error('contentSha256 no coincide con el archivo recibido')
  }

  const isZip = item.fileName.toLowerCase().endsWith('.zip') || isLikelyZip(decodedBuffer)

  if (isZip) {
    const zip = await JSZip.loadAsync(decodedBuffer)
    const entries = Object.values(zip.files)

    if (entries.length > MAX_ZIP_ENTRIES) {
      throw new Error(`el ZIP excede el límite de ${MAX_ZIP_ENTRIES} entradas`)
    }

    const xmlEntries = entries.filter(entry => !entry.dir && entry.name.toLowerCase().endsWith('.xml'))

    if (xmlEntries.length === 0) {
      throw new Error('el archivo ZIP no contiene XML válidos')
    }

    if (xmlEntries.length > MAX_XML_PER_ZIP) {
      throw new Error(`el ZIP excede el límite de ${MAX_XML_PER_ZIP} XML por archivo`)
    }

    const candidates: ExpandedXmlCandidate[] = []

    for (const entry of xmlEntries) {
      const xmlText = normalizeXmlText(await entry.async('string'))

      if (!xmlText.startsWith('<')) {
        throw new Error(`el ZIP contiene XML inválido en ${entry.name}`)
      }

      candidates.push({
        sourceFileName: item.fileName,
        fileName: `${item.fileName}::${entry.name}`,
        xmlContent: xmlText
      })
    }

    return candidates
  }

  const xmlText = normalizeXmlText(decodedBuffer.toString('utf8'))

  if (!xmlText.startsWith('<')) {
    throw new Error('el archivo no contiene un XML válido')
  }

  return [
    {
      sourceFileName: item.fileName,
      fileName: item.fileName,
      xmlContent: xmlText
    }
  ]
}

async function resolveMachineClientRecordId(clientId: string, organizationId: string) {
  const machineClient = await prisma.machineClient.findFirst({
    where: {
      clientId,
      organizationId,
      isActive: true
    },
    select: {
      id: true
    }
  })

  return machineClient?.id || null
}

async function findExistingRunByBatchId(batchId: string, organizationId: string) {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id
    FROM import_runs
    WHERE organization_id = ${organizationId}
      AND source = CAST(${CFDI_IMPORT_SOURCE} AS "import_run_source")
      AND batch_id = ${batchId}
    LIMIT 1
  `)

  return rows[0]?.id || null
}

async function findDirectorySessionByExecutionId(params: {
  organizationId: string
  executionId: string
}) {
  const rows = await prisma.$queryRaw<ImportDirectorySessionRow[]>(Prisma.sql`
    SELECT
      id,
      total_xml_files AS "totalXmlFiles",
      skipped_by_progress_files AS "skippedByProgressFiles",
      new_xml_files AS "newXmlFiles"
    FROM import_directory_sessions
    WHERE organization_id = ${params.organizationId}
      AND source = CAST(${CFDI_IMPORT_SOURCE} AS "import_run_source")
      AND execution_id = ${params.executionId}
    LIMIT 1
  `)

  return rows[0] || null
}

function validateDirectoryControlConsistency(
  existingSession: ImportDirectorySessionRow,
  directoryControl: DirectoryControlPayload
) {
  return existingSession.totalXmlFiles === directoryControl.totalXmlFiles
    && existingSession.skippedByProgressFiles === directoryControl.skippedByProgressFiles
    && existingSession.newXmlFiles === directoryControl.newXmlFiles
}

export async function stageExternalCfdiImport(params: {
  organizationId: string
  clientId: string
  batchId?: string | null
  directoryControl?: DirectoryControlPayload
  items: StagedSourceItem[]
}): Promise<StageResult> {
  const { organizationId, clientId, batchId, directoryControl, items } = params
  const traceId = batchId || directoryControl?.executionId || null

  if (items.length === 0) {
    throw new Error('items debe contener al menos un archivo')
  }

  if (items.length > MAX_FILES_PER_REQUEST) {
    throw new Error(`el request excede el límite de ${MAX_FILES_PER_REQUEST} archivos`)
  }

  if (batchId) {
    const existingRunId = await findExistingRunByBatchId(batchId, organizationId)

    if (existingRunId) {
      const existingRun = await getImportRunSummary(existingRunId, organizationId)

      if (!existingRun) {
        throw new Error('la corrida idempotente existe pero no fue posible leerla')
      }

      return {
        importRunId: existingRun.id,
        status: existingRun.status,
        receivedFiles: items.length,
        acceptedFiles: items.length,
        rejectedFiles: 0,
        logicalItems: existingRun.totalItems,
        rejections: [],
        idempotent: true
      }
    }
  }

  let totalRequestBytes = 0
  const acceptedCandidates: ExpandedXmlCandidate[] = []
  const rejections: RejectedSourceFile[] = []

  for (const item of items) {
    try {
      const decodedBuffer = decodeBase64(item.contentBase64)
      totalRequestBytes += decodedBuffer.byteLength

      if (totalRequestBytes > MAX_REQUEST_BYTES) {
        throw new Error(`el request excede el límite total de ${MAX_REQUEST_BYTES} bytes`)
      }

      const expanded = await expandSourceItem(item)
      acceptedCandidates.push(...expanded)
    } catch (error) {
      rejections.push({
        fileName: item.fileName,
        code: 'INVALID_SOURCE_FILE',
        message: error instanceof Error ? error.message : 'no fue posible preparar el archivo'
      })
    }
  }

  if (acceptedCandidates.length === 0) {
    const error = new Error('ningún archivo válido fue aceptado para staging')
    ;(error as Error & { rejections?: RejectedSourceFile[] }).rejections = rejections
    throw error
  }

  const machineClientRecordId = await resolveMachineClientRecordId(clientId, organizationId)
  const importRunId = randomUUID()
  let directorySessionId: string | null = null

  if (directoryControl) {
    // #region debug-point A:staging-directory-control
    await reportImportStagingDebug({
      hypothesisId: 'A',
      location: 'src/lib/external-cfdi-import-staging.ts:directory-control',
      traceId,
      msg: 'Resolviendo sesión de directorio para staging CFDI',
      data: {
        organizationId,
        clientId,
        executionId: directoryControl.executionId,
        totalXmlFiles: directoryControl.totalXmlFiles,
        skippedByProgressFiles: directoryControl.skippedByProgressFiles,
        newXmlFiles: directoryControl.newXmlFiles
      }
    })
    // #endregion

    const existingDirectorySession = await findDirectorySessionByExecutionId({
      organizationId,
      executionId: directoryControl.executionId
    })

    if (existingDirectorySession) {
      if (!validateDirectoryControlConsistency(existingDirectorySession, directoryControl)) {
        throw new Error('directoryControl no coincide con la sesión ya registrada')
      }

      directorySessionId = existingDirectorySession.id
    } else {
      directorySessionId = randomUUID()
    }
  }

  const preparedCandidates = acceptedCandidates.map(candidate => {
    const itemId = randomUUID()
    const encryptedXml = encryptInvoiceXmlContent(candidate.xmlContent)
    const metadata = extractLightXmlMetadata(candidate.xmlContent)

    return {
      itemId,
      fileName: candidate.fileName,
      encryptedXml,
      metadata
    }
  })

  try {
    const now = new Date()

    await prisma.$transaction(async (tx) => {
      if (directoryControl && directorySessionId) {
        await tx.$executeRaw(Prisma.sql`
        INSERT INTO import_directory_sessions (
          id,
          organization_id,
          source,
          execution_id,
          total_xml_files,
          skipped_by_progress_files,
          new_xml_files,
          created_by_machine_client_id,
          created_at,
          updated_at
        )
        VALUES (
          ${directorySessionId},
          ${organizationId},
          CAST(${CFDI_IMPORT_SOURCE} AS "import_run_source"),
          ${directoryControl.executionId},
          ${directoryControl.totalXmlFiles},
          ${directoryControl.skippedByProgressFiles},
          ${directoryControl.newXmlFiles},
          ${machineClientRecordId},
          NOW(),
          NOW()
        )
        ON CONFLICT ("organization_id", "source", "execution_id")
        DO UPDATE SET
          updated_at = NOW()
      `)
      }

      await tx.$executeRaw(Prisma.sql`
      INSERT INTO import_runs (
        id,
        organization_id,
        source,
        batch_id,
        directory_session_id,
        status,
        total_items,
        processed_items,
        created_emitted,
        created_received,
        skipped_items,
        error_items,
        waiting_external_validation_items,
        created_by_machine_client_id,
        created_at,
        updated_at
      )
      VALUES (
        ${importRunId},
        ${organizationId},
        CAST(${CFDI_IMPORT_SOURCE} AS "import_run_source"),
        ${batchId ?? null},
        ${directorySessionId},
        CAST('QUEUED' AS "import_run_status"),
        ${acceptedCandidates.length},
        0,
        0,
        0,
        0,
        0,
        0,
        ${machineClientRecordId},
        NOW(),
        NOW()
      )
    `)

      if (preparedCandidates.length > 0) {
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO import_run_items (
            id,
            import_run_id,
            organization_id,
            file_name,
            xml_sha256,
            uuid,
            issuer_rfc,
            receiver_rfc,
            classification_result,
            status,
            created_at,
            updated_at
          )
          VALUES ${Prisma.join(preparedCandidates.map(candidate => Prisma.sql`
            (
              ${candidate.itemId},
              ${importRunId},
              ${organizationId},
              ${candidate.fileName},
              ${candidate.encryptedXml.sha256},
              ${candidate.metadata.uuid},
              ${candidate.metadata.issuerRfc},
              ${candidate.metadata.receiverRfc},
              CAST('NONE' AS "import_run_classification_result"),
              CAST('QUEUED' AS "import_run_item_status"),
              ${now},
              ${now}
            )
          `))}
        `)

        await tx.$executeRaw(Prisma.sql`
          INSERT INTO import_run_item_blobs (
            import_run_item_id,
            xml_ciphertext,
            xml_iv,
            xml_auth_tag,
            xml_encryption_alg,
            xml_key_version,
            created_at,
            updated_at
          )
          VALUES ${Prisma.join(preparedCandidates.map(candidate => Prisma.sql`
            (
              ${candidate.itemId},
              ${candidate.encryptedXml.ciphertext},
              ${candidate.encryptedXml.iv},
              ${candidate.encryptedXml.authTag},
              ${candidate.encryptedXml.algorithm},
              ${candidate.encryptedXml.keyVersion},
              ${now},
              ${now}
            )
          `))}
        `)
      }
    })
  } catch (error) {
    // #region debug-point D:staging-transaction-error
    await reportImportStagingDebug({
      hypothesisId: 'D',
      location: 'src/lib/external-cfdi-import-staging.ts:transaction',
      traceId,
      msg: 'Error dentro de la transacción de staging CFDI',
      data: {
        importRunId,
        directorySessionId,
        hasDirectoryControl: Boolean(directoryControl),
        errorName: error instanceof Error ? error.name : 'UnknownError',
        errorMessage: error instanceof Error ? error.message : String(error)
      }
    })
    // #endregion
    throw error
  }

  return {
    importRunId,
    status: 'QUEUED',
    receivedFiles: items.length,
    acceptedFiles: items.length - rejections.length,
    rejectedFiles: rejections.length,
    logicalItems: acceptedCandidates.length,
    rejections,
    idempotent: false
  }
}
