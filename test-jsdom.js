/* eslint-disable @typescript-eslint/no-require-imports */
const { JSDOM } = require('jsdom');
const dom = new JSDOM();
const parser = new dom.window.DOMParser();
const xml = '<cfdi:Comprobante Version="4.0" SubTotal="100" Total="116"><cfdi:Conceptos><cfdi:Concepto ClaveProdServ="84111506" Cantidad="1" Descripcion="Servicios" ValorUnitario="100" Importe="100" ObjetoImp="02" /></cfdi:Conceptos><cfdi:Impuestos TotalImpuestosTrasladados="16"><cfdi:Traslados><cfdi:Traslado Impuesto="002" Base="100" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="16"/></cfdi:Traslados></cfdi:Impuestos></cfdi:Comprobante>';
const doc = parser.parseFromString(xml, 'text/xml');
console.log('tagName:', doc.documentElement.tagName);
console.log('parsererror:', doc.getElementsByTagName('parsererror').length);
