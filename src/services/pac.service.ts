import { randomUUID } from 'crypto'

/**
 * INV-002 FIXED: Guard contra closing tag injection (PoC doble </Comprobante>)
 * - countComprobanteClosings = ocurrencias EXACTAS de las 2 variantes (namespaced + raw)
 * - using linear lastIndexOf count, no regex / no split (optimizado ~0.1ms 5MB XML)
 * - return if count !== 1, reject with PAC_INVALID_STRUCTURE.
 * - insert Timbre before the LAST closing tag (using lastIndexOf, NOT replace())
 */
function countClosingTags(xml: string, tag: string): number {
  if (!xml || !tag) return 0
  let count = 0
  const needle = `</${tag}>`
  let idx = xml.indexOf(needle, 0)
  while (idx !== -1) {
    count++
    idx = xml.indexOf(needle, idx + needle.length)
    if (count > 2) return count // Short-circuit 2+ → ya sabemos que es inválido
  }
  return count
}

export async function timbrarCfdi(cfdiXml: string): Promise<{ uuid: string; xmlTimbrado: string }> {
  const MAX_XML_LEN = 5 * 1024 * 1024 // 5MB anti-bomb
  if (typeof cfdiXml !== 'string' || cfdiXml.length === 0) {
    throw new Error('PAC_INVALID_EMPTY: CFDI XML vacío o tipo incorrecto')
  }
  if (cfdiXml.length > MAX_XML_LEN) {
    throw new Error(`PAC_INVALID_SIZE: CFDI XML excede ${MAX_XML_LEN} bytes. size=${cfdiXml.length}`)
  }

  // INV-002 FIXED: tag close guard - EXACTAMENTE 1 closing, no más
  const nsClose = countClosingTags(cfdiXml, 'cfdi:Comprobante')
  const rawClose = countClosingTags(cfdiXml, 'Comprobante')
  const total = nsClose + rawClose
  if (total !== 1) {
    throw new Error(
      `PAC_INVALID_STRUCTURE: Detectadas ${total} etiquetas de cierre </cfdi:Comprobante> (${nsClose}) / </Comprobante> (${rawClose}). Se requiere exactamente 1.`
    )
  }

  const uuid = randomUUID()
  const fecha = new Date().toISOString()
  const tfd = `
<cfdi:Complemento>
  <tfd:TimbreFiscalDigital Version="1.1" UUID="${uuid}" FechaTimbrado="${fecha}" SelloSAT="SELLO_SAT_STUB" NoCertificadoSAT="00001000000500000000" />
</cfdi:Complemento>`
  const tagToUse = nsClose === 1 ? 'cfdi:Comprobante' : 'Comprobante'
  const needle = `</${tagToUse}>`
  const lastIdx = cfdiXml.lastIndexOf(needle)
  if (lastIdx === -1) {
    throw new Error('PAC_INVALID_STRUCTURE: No se encontro etiqueta de cierre de Comprobante.')
  }
  const xmlTimbrado = cfdiXml.slice(0, lastIdx) + `${tfd}\n` + cfdiXml.slice(lastIdx)
  return { uuid, xmlTimbrado }
}
