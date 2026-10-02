const xml = '<cfdi:Comprobante Version="4.0" SubTotal="100" Total="116"><cfdi:Conceptos><cfdi:Concepto ClaveProdServ="84111506" Cantidad="1" Descripcion="Servicios" ValorUnitario="100" Importe="100" ObjetoImp="02" /></cfdi:Conceptos><cfdi:Impuestos TotalImpuestosTrasladados="16"><cfdi:Traslados><cfdi:Traslado Impuesto="002" Base="100" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="16"/></cfdi:Traslados></cfdi:Impuestos></cfdi:Comprobante>';
const matches = Array.from(xml.matchAll(/<[^:>]+:Concepto[^>]*>/g));
console.log('Matches length:', matches.length);
if (matches.length > 0) console.log('Match:', matches[0][0]);
