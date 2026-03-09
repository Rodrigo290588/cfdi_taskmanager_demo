import { randomUUID } from 'crypto'

export async function timbrarCfdi(cfdiXml: string): Promise<{ uuid: string; xmlTimbrado: string }> {
  const uuid = randomUUID()
  const fecha = new Date().toISOString()
  const tfd = `
<cfdi:Complemento>
  <tfd:TimbreFiscalDigital Version="1.1" UUID="${uuid}" FechaTimbrado="${fecha}" SelloSAT="SELLO_SAT_STUB" NoCertificadoSAT="00001000000500000000" />
</cfdi:Complemento>`
  const xmlTimbrado = cfdiXml.replace('</cfdi:Comprobante>', `${tfd}\n</cfdi:Comprobante>`)
  return { uuid, xmlTimbrado }
}
