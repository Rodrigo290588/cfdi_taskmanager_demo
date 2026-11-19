import { CSV_BOM, buildCsvRow } from '@/lib/mass-downloads-route-utils'
import {
  readFiscalControlConciliationPage,
} from '@/lib/fiscal-control-conciliation-service'
import type { FiscalControlReconciliationFilters } from '@/lib/fiscal-control-conciliation-types'

export const FISCAL_CONTROL_CSV_HEADERS = [
  'UUID CFDI', 'RFC Emisor', 'Nombre Emisor', 'RFC Receptor', 'Nombre Receptor',
  'Fecha emisión', 'Fecha pago nómina', 'Tipo CFDI', 'Monto CFDI',
  'Monto metadato SAT', 'Monto XML', 'Estado SAT', 'Origen', 'Estado conciliación',
  'XML disponible',
] as const

const ORIGIN_LABELS: Record<string, string> = {
  EMITIDO: 'Emitido', RECIBIDO: 'Recibido', NOMINA: 'Nómina',
}

const STATUS_LABELS: Record<string, string> = {
  CONCILIADO: 'Conciliado',
  METADATO_SIN_XML: 'Metadato sin XML',
  XML_SIN_METADATO: 'XML sin metadato SAT',
  XML_NO_DISPONIBLE: 'XML no disponible',
  CONFLICTO: 'Conflicto de conciliación',
}

function date(value: Date | null): string {
  return value ? value.toISOString() : ''
}

export async function* iterateFiscalControlCsv(
  filters: FiscalControlReconciliationFilters,
): AsyncGenerator<string> {
  yield CSV_BOM + buildCsvRow([...FISCAL_CONTROL_CSV_HEADERS])
  let cursor: string | null = null

  do {
    const page = await readFiscalControlConciliationPage({
      filters,
      cursor,
      pageSize: 100,
    })
    for (const row of page.rows) {
      yield buildCsvRow([
        row.uuid, row.issuerRfc, row.issuerName, row.receiverRfc, row.receiverName,
        date(row.issuanceDate), date(row.payrollPaymentDate), row.cfdiType,
        row.total ?? '', row.metadataTotal ?? '', row.xmlTotal ?? '', row.satStatus,
        row.origins.map(origin => ORIGIN_LABELS[origin] ?? origin).join(' + '),
        STATUS_LABELS[row.reconciliationStatus] ?? row.reconciliationStatus,
        row.hasXml ? 'Sí' : 'No',
      ])
    }
    cursor = page.nextCursor
  } while (cursor)
}

export async function exceedsFiscalControlExportThreshold(
  filters: FiscalControlReconciliationFilters,
  threshold: number,
): Promise<boolean> {
  let count = 0
  let cursor: string | null = null
  do {
    const page = await readFiscalControlConciliationPage({ filters, cursor, pageSize: 100 })
    count += page.rows.length
    if (count > threshold) return true
    cursor = page.nextCursor
  } while (cursor)
  return false
}

export function createFiscalControlCsvStream(
  filters: FiscalControlReconciliationFilters,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const iterator = iterateFiscalControlCsv(filters)
  return new ReadableStream({
    async pull(controller) {
      const next = await iterator.next()
      if (next.done) {
        controller.close()
        return
      }
      controller.enqueue(encoder.encode(next.value))
    },
    async cancel() {
      await iterator.return?.(undefined)
    },
  })
}

export async function createFiscalControlCsvContent(
  filters: FiscalControlReconciliationFilters,
): Promise<string> {
  const chunks: string[] = []
  for await (const chunk of iterateFiscalControlCsv(filters)) {
    chunks.push(chunk)
  }
  return chunks.join('')
}
