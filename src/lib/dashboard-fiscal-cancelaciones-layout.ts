export type CancellationLayoutDecision = 'update' | 'ignore' | 'unhandled' | 'invalid' | 'header'

export type ParsedCancellationLayoutRow = {
  decision: CancellationLayoutDecision
  lineNumber: number
  rawLine: string
  normalizedColumns: string[]
  uuid: string
  statusCol9: string
  cancelableCol10: string
  processCol11: string
  reason: string
}

const CFDI_UUID_REGEX = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i

function sanitizeLayoutCell(value: string) {
  const trimmed = value.trim()

  if (/^[=\+\-@\t\r]/.test(trimmed)) {
    return `'${trimmed}`
  }

  return trimmed.replace(/[\u0000-\u001F\u007F]/g, '')
}

export function normalizeCancellationLayoutToken(value: string | null | undefined) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, '')
}

function normalizeCancellationLayoutColumns(rawLine: string) {
  const rawColumns = rawLine.split('|').map(sanitizeLayoutCell)
  const columns = rawColumns[0] === '' ? rawColumns.slice(1) : rawColumns

  return columns
}

function isHeaderRow(columns: string[]) {
  const uuidCol = normalizeCancellationLayoutToken(columns[7] || '')
  const statusCol = normalizeCancellationLayoutToken(columns[8] || '')
  return uuidCol === 'UUID' || statusCol === 'ESTADO' || statusCol === 'ESTATUS'
}

export function parseCancellationLayoutLine(line: string, lineNumber: number): ParsedCancellationLayoutRow {
  const rawLine = line.trim()

  if (!rawLine) {
    return {
      decision: 'header',
      lineNumber,
      rawLine,
      normalizedColumns: [],
      uuid: '',
      statusCol9: '',
      cancelableCol10: '',
      processCol11: '',
      reason: 'Línea vacía'
    }
  }

  const normalizedColumns = normalizeCancellationLayoutColumns(rawLine)

  if (normalizedColumns.length >= 9 && isHeaderRow(normalizedColumns)) {
    return {
      decision: 'header',
      lineNumber,
      rawLine,
      normalizedColumns,
      uuid: '',
      statusCol9: '',
      cancelableCol10: '',
      processCol11: '',
      reason: 'Cabecera'
    }
  }

  if (normalizedColumns.length < 11) {
    return {
      decision: 'invalid',
      lineNumber,
      rawLine,
      normalizedColumns,
      uuid: '',
      statusCol9: '',
      cancelableCol10: '',
      processCol11: '',
      reason: 'La línea no contiene las 11 columnas mínimas requeridas'
    }
  }

  const uuid = (normalizedColumns[7] || '').toUpperCase()
  const statusCol9 = normalizedColumns[8] || ''
  const cancelableCol10 = normalizedColumns[9] || ''
  const processCol11 = normalizedColumns[10] || ''

  if (!uuid || !CFDI_UUID_REGEX.test(uuid)) {
    return {
      decision: 'invalid',
      lineNumber,
      rawLine,
      normalizedColumns,
      uuid,
      statusCol9,
      cancelableCol10,
      processCol11,
      reason: 'El UUID de la columna 8 no tiene un formato válido'
    }
  }

  const normalizedStatus = normalizeCancellationLayoutToken(statusCol9)
  const normalizedCancelable = normalizeCancellationLayoutToken(cancelableCol10)
  const normalizedProcess = normalizeCancellationLayoutToken(processCol11)

  if (normalizedStatus === 'CANCELADO') {
    return {
      decision: 'update',
      lineNumber,
      rawLine,
      normalizedColumns,
      uuid,
      statusCol9,
      cancelableCol10,
      processCol11,
      reason: 'La columna 9 indica Cancelado'
    }
  }

  if (normalizedStatus === 'VIGENTE' && normalizedCancelable === 'NOCANCELABLE') {
    return {
      decision: 'ignore',
      lineNumber,
      rawLine,
      normalizedColumns,
      uuid,
      statusCol9,
      cancelableCol10,
      processCol11,
      reason: 'Vigente + No Cancelable'
    }
  }

  const isCancelableConAceptacion = normalizedCancelable.includes('CONACEPTAC')
  const isEnProceso = normalizedProcess === 'ENPROCESO'

  if (normalizedStatus === 'VIGENTE' && isCancelableConAceptacion && isEnProceso) {
    return {
      decision: 'ignore',
      lineNumber,
      rawLine,
      normalizedColumns,
      uuid,
      statusCol9,
      cancelableCol10,
      processCol11,
      reason: 'Vigente + Cancelable con aceptación + En proceso'
    }
  }

  return {
    decision: 'unhandled',
    lineNumber,
    rawLine,
    normalizedColumns,
    uuid,
    statusCol9,
    cancelableCol10,
    processCol11,
    reason: 'Caso no contemplado por las reglas configuradas'
  }
}
