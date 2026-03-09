import { create } from 'xmlbuilder2'
import { CFDIInput, CFDINormalizado } from '@/schemas/cfdiInput'

function toStrDecimal(v: unknown, def = '0'): string {
  if (v == null) return def
  const s = typeof v === 'number' ? v.toFixed(2) : String(v)
  return s
}

export function normalizarJson(cfdi: CFDIInput): CFDINormalizado {
  const comp = cfdi.comprobante
  const trasladosComp = comp.impuestos?.traslados ?? []
  const retencionesComp = comp.impuestos?.retenciones ?? []

  const conceptos = cfdi.conceptos.map(c => ({
    claveProdServ: c.claveProdServ,
    noIdentificacion: c.noIdentificacion,
    cantidad: toStrDecimal(c.cantidad),
    claveUnidad: c.claveUnidad,
    unidad: c.unidad,
    descripcion: c.descripcion,
    valorUnitario: toStrDecimal(c.valorUnitario),
    importe: toStrDecimal(c.importe),
    descuento: c.descuento ? toStrDecimal(c.descuento) : undefined,
    objetoImp: c.objetoImp,
    impuestos: {
      traslados: (c.impuestos?.traslados ?? []).map(t => ({
        impuesto: t.impuesto,
        tipoFactor: t.tipoFactor,
        tasaOCuota: t.tasaOCuota,
        base: t.base,
        importe: toStrDecimal(t.importe)
      })),
      retenciones: (c.impuestos?.retenciones ?? []).map(r => ({
        impuesto: r.impuesto,
        importe: toStrDecimal(r.importe)
      }))
    },
    partes: (c.parte ?? []).map(p => ({
      claveProdServ: p.claveProdServ,
      noIdentificacion: p.noIdentificacion,
      cantidad: toStrDecimal(p.cantidad),
      unidad: p.unidad,
      descripcion: p.descripcion,
      valorUnitario: toStrDecimal(p.valorUnitario),
      importe: toStrDecimal(p.importe)
    }))
  }))

  const subtotal = toStrDecimal(comp.subtotal ?? conceptos.reduce((acc, c) => acc + Number(c.importe), 0), '0')
  const descuento = toStrDecimal(comp.descuento ?? conceptos.reduce((acc, c) => acc + Number(c.descuento ?? '0'), 0), '0')

  // Calcular totales de impuestos desde conceptos si no vienen en comprobante
  const allTraslados = [
    ...trasladosComp,
    ...conceptos.flatMap(c => c.impuestos.traslados)
  ]
  const allRetenciones = [
    ...retencionesComp,
    ...conceptos.flatMap(c => c.impuestos.retenciones)
  ]

  const totalTraslados = allTraslados.reduce((acc, t) => acc + Number(t.importe), 0)
  const totalRetenciones = allRetenciones.reduce((acc, r) => acc + Number(r.importe), 0)
  const total = toStrDecimal(Number(subtotal) - Number(descuento) + totalTraslados - totalRetenciones)

  return {
    comprobante: {
      serie: comp.serie,
      folio: comp.folio,
      moneda: comp.moneda ?? 'MXN',
      tipoCambio: comp.tipoCambio ? String(comp.tipoCambio) : undefined,
      exportacion: comp.exportacion ?? '01',
      lugarExpedicion: comp.lugarExpedicion,
      metodoPago: comp.metodoPago,
      formaPago: comp.formaPago,
      condicionesDePago: comp.condicionesDePago,
      fecha: comp.fecha,
      impuestos: {
        traslados: allTraslados.map(t => ({
          impuesto: t.impuesto,
          tipoFactor: t.tipoFactor,
          tasaOCuota: t.tasaOCuota,
          base: t.base,
          importe: toStrDecimal(t.importe)
        })),
        retenciones: allRetenciones.map(r => ({
          impuesto: r.impuesto,
          importe: toStrDecimal(r.importe)
        }))
      },
      objetoImp: comp.objetoImp,
      subtotal,
      descuento,
      total
    },
    emisor: { rfc: cfdi.emisor.rfc, nombre: cfdi.emisor.nombre },
    receptor: { rfc: cfdi.receptor.rfc, nombre: cfdi.receptor.nombre, usoCfdi: cfdi.receptor.usoCfdi },
    conceptos,
    cfdiRelacionados: (cfdi.cfdiRelacionados ?? []).map(r => ({ tipoRelacion: r.tipoRelacion, uuids: r.uuids }))
  }
}

function generarCadenaOriginal(xml: string): string {
  // Stub usando contenido para evitar warning de lint
  return 'CADENA_ORIGINAL_STUB_' + String(xml.length)
}

function firmarSello(cadenaOriginal: string): string {
  // Stub: simula un sello digital
  return 'SELLO_DIGITAL_STUB_' + Buffer.from(cadenaOriginal).toString('base64').slice(0, 16)
}

export function generarXml(cfdi: CFDINormalizado): string {
  const doc = create({ version: '1.0', encoding: 'UTF-8' })
    .ele('cfdi:Comprobante', {
      'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
      'xmlns:cfdi': 'http://www.sat.gob.mx/cfd/4',
      'xmlns:tfd': 'http://www.sat.gob.mx/TimbreFiscalDigital',
      Version: '4.0',
      Serie: cfdi.comprobante.serie,
      Folio: cfdi.comprobante.folio,
      Fecha: cfdi.comprobante.fecha,
      Moneda: cfdi.comprobante.moneda,
      TipoCambio: cfdi.comprobante.tipoCambio,
      Exportacion: cfdi.comprobante.exportacion,
      LugarExpedicion: cfdi.comprobante.lugarExpedicion,
      FormaPago: cfdi.comprobante.formaPago,
      MetodoPago: cfdi.comprobante.metodoPago,
      SubTotal: cfdi.comprobante.subtotal,
      Descuento: cfdi.comprobante.descuento,
      Total: cfdi.comprobante.total
    })
    .ele('cfdi:Emisor', { Rfc: cfdi.emisor.rfc, Nombre: cfdi.emisor.nombre })
    .up()
    .ele('cfdi:Receptor', { Rfc: cfdi.receptor.rfc, Nombre: cfdi.receptor.nombre, UsoCFDI: cfdi.receptor.usoCfdi })
    .up()
    .ele('cfdi:Conceptos')

  cfdi.conceptos.forEach(c => {
    const cEle = doc.ele('cfdi:Concepto', {
      ClaveProdServ: c.claveProdServ,
      NoIdentificacion: c.noIdentificacion,
      Cantidad: c.cantidad,
      ClaveUnidad: c.claveUnidad,
      Unidad: c.unidad,
      Descripcion: c.descripcion,
      ValorUnitario: c.valorUnitario,
      Importe: c.importe,
      ObjetoImp: c.objetoImp
    })
    if (c.partes && c.partes.length) {
      c.partes.forEach(p => {
        cEle.ele('cfdi:Parte', {
          ClaveProdServ: p.claveProdServ,
          NoIdentificacion: p.noIdentificacion,
          Cantidad: p.cantidad,
          Unidad: p.unidad,
          Descripcion: p.descripcion,
          ValorUnitario: p.valorUnitario,
          Importe: p.importe
        }).up()
      })
    }
    if (c.impuestos.traslados.length || c.impuestos.retenciones.length) {
      const imp = cEle.ele('cfdi:Impuestos')
      if (c.impuestos.traslados.length) {
        const tras = imp.ele('cfdi:Traslados')
        c.impuestos.traslados.forEach(t => {
          tras.ele('cfdi:Traslado', {
            Base: t.base,
            Impuesto: t.impuesto,
            TipoFactor: t.tipoFactor,
            TasaOCuota: t.tasaOCuota,
            Importe: t.importe
          })
        })
      }
      if (c.impuestos.retenciones.length) {
        const rets = imp.ele('cfdi:Retenciones')
        c.impuestos.retenciones.forEach(r => {
          rets.ele('cfdi:Retencion', {
            Impuesto: r.impuesto,
            Importe: r.importe
          })
        })
      }
      imp.up()
    }
    cEle.up()
  })

  doc.up()

  if (cfdi.cfdiRelacionados.length) {
    const rels = doc.ele('cfdi:CfdiRelacionados', { TipoRelacion: cfdi.cfdiRelacionados[0].tipoRelacion })
    cfdi.cfdiRelacionados[0].uuids.forEach(u => {
      rels.ele('cfdi:CfdiRelacionado', { UUID: u }).up()
    })
    rels.up()
  }

  if (cfdi.comprobante.impuestos.traslados.length || cfdi.comprobante.impuestos.retenciones.length) {
    const imp = doc.ele('cfdi:Impuestos')
    if (cfdi.comprobante.impuestos.traslados.length) {
      const tras = imp.ele('cfdi:Traslados')
      cfdi.comprobante.impuestos.traslados.forEach(t => {
        tras.ele('cfdi:Traslado', {
          Impuesto: t.impuesto,
          TipoFactor: t.tipoFactor,
          TasaOCuota: t.tasaOCuota,
          Importe: t.importe
        })
      })
    }
    if (cfdi.comprobante.impuestos.retenciones.length) {
      const rets = imp.ele('cfdi:Retenciones')
      cfdi.comprobante.impuestos.retenciones.forEach(r => {
        rets.ele('cfdi:Retencion', {
          Impuesto: r.impuesto,
          Importe: r.importe
        })
      })
    }
    imp.up()
  }

  // Sello (stub)
  const xmlSinTimbre = doc.end({ prettyPrint: true })
  const cadena = generarCadenaOriginal(xmlSinTimbre)
  const sello = firmarSello(cadena)
  // Nota: para simplificación no se inserta el atributo Sello en Comprobante en este stub

  return xmlSinTimbre + `\n<!-- SELLO:${sello} -->`
}
