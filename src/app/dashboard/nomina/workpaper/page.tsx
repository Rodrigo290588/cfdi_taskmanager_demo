'use client'

import { useEffect, useState, useCallback, useMemo, Fragment } from 'react'
import { ProtectedRoute } from '@/components/protected-route'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Calendar, Eye, FileText, FileCode, ChevronRight, ChevronDown } from 'lucide-react'
import JSZip from 'jszip'
import { toast } from 'sonner'
import type { WorkpaperProjectionMap } from '@/lib/cfdi-workpaper-projection'

type SelectedCompany = { id: string; rfc?: string; businessName?: string; name?: string }

const formatMXN = (value: number) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 }).format(Number(value || 0))

const formatCfdiDate = (value: string | Date | null | undefined) => {
  if (!value) return ''

  try {
    return new Intl.DateTimeFormat('es-MX', {
      timeZone: 'UTC'
    }).format(new Date(value))
  } catch { /* ignored */ 
    return String(value)
  }
}

type InvoiceRow = {
  id: string
  userId: string
  issuerFiscalEntityId: string
  uuid: string
  cfdiType: string
  series: string | null
  folio: string | null
  currency: string
  exchangeRate: number | null
  status: string
  satStatus: string
  issuerRfc: string
  issuerName: string
  receiverRfc: string
  receiverName: string
  subtotal: number
  discount: number
  total: number
  ivaTransferred: number
  ivaWithheld: number
  isrWithheld: number
  iepsWithheld: number
  xmlContent: string
  pdfUrl: string | null
  issuanceDate: string | Date
  certificationDate: string | Date | null
  certificationPac: string
  paymentMethod: string
  paymentForm: string
  cfdiUsage: string
  placeOfExpedition: string
  exportKey: string
  objectTaxComprobante: string | null
  paymentConditions: string | null
  createdAt: string | Date
  updatedAt: string | Date
  projection?: WorkpaperProjectionMap
}

function getXmlAttribute(xml: string, attr: string): string {
  if (!xml) return ''
  const comprobanteMatch = /<(?:[a-zA-Z0-9_-]+:)?Comprobante([^>]+)>/.exec(xml)
  if (comprobanteMatch) {
    const attrs = comprobanteMatch[1]
    const regex = new RegExp(`${attr}="([^"]+)"`)
    const match = regex.exec(attrs)
    if (match) return match[1]
  }
  return ''
}

function getReceptorAttribute(xml: string, attr: string): string {
  if (!xml) return ''
  const receptorMatch = /<(?:[a-zA-Z0-9_-]+:)?Receptor([^>]+)>/.exec(xml)
  if (receptorMatch) {
    const attrs = receptorMatch[1]
    const regex = new RegExp(`${attr}="([^"]+)"`)
    const match = regex.exec(attrs)
    if (match) return match[1]
  }
  return ''
}

function getGlobalImpuestosAttribute(xml: string, attr: string): string {
  if (!xml) return ''
  const regex = new RegExp(String.raw`<(?:[a-zA-Z0-9_-]+:)?Impuestos[^>]*?\b${attr}="([^"]+)"`)
  const match = regex.exec(xml)
  if (match) return match[1]
  return ''
}

function getCfdiRelacionadosAttribute(xml: string, type: 'TipoRelacion' | 'UUID'): string {
  if (!xml) return ''
  if (type === 'TipoRelacion') {
    const matches = Array.from(xml.matchAll(/<(?:[a-zA-Z0-9_-]+:)?CfdiRelacionados[^>]*?\bTipoRelacion="([^"]+)"/g))
    return matches.map(m => m[1]).join(', ')
  } else {
    const matches = Array.from(xml.matchAll(/<(?:[a-zA-Z0-9_-]+:)?CfdiRelacionado[^>]*?\bUUID="([^"]+)"/g))
    return matches.map(m => m[1]).join(', ')
  }
}

function getNominaSpecificNodeAttribute(xml: string, nodeName: string, attr: string): string {
  if (!xml) return ''
  // Busca el atributo dentro del nodo especificado (puede tener prefijos como nomina12:)
  // Para evitar colisiones con nodos cfdi, asumimos que los atributos solicitados no se repiten
  // de la misma forma en cfdi:Receptor/Emisor o buscamos explícitamente en el complemento.
  // Una forma robusta es buscar el nodo completo.
  const regexNode = new RegExp(String.raw`<(?:[a-zA-Z0-9_-]+:)?${nodeName}(?:\s[^>]*?)?>`, 'g')
  let matchNode
  while ((matchNode = regexNode.exec(xml)) !== null) {
    const attrs = matchNode[1] || matchNode[0]
    const regexAttr = new RegExp(String.raw`\b${attr}="([^"]+)"`)
    const matchAttr = regexAttr.exec(attrs)
    if (matchAttr) return matchAttr[1]
  }
  return ''
}

const attributeExtractors: Record<string, (xml: string) => string | null> = {
  version: (xml) => getXmlAttribute(xml, 'Version'),
  noCertificado: (xml) => getXmlAttribute(xml, 'NoCertificado'),
  certificado: (xml) => getXmlAttribute(xml, 'Certificado'),
  domicilioFiscalReceptor: (xml) => getReceptorAttribute(xml, 'DomicilioFiscalReceptor'),
  residenciaFiscal: (xml) => getReceptorAttribute(xml, 'ResidenciaFiscal'),
  numRegIdTrib: (xml) => getReceptorAttribute(xml, 'NumRegIdTrib'),
  regimenFiscalReceptor: (xml) => getReceptorAttribute(xml, 'RegimenFiscalReceptor'),
  tipoRelacion: (xml) => getCfdiRelacionadosAttribute(xml, 'TipoRelacion'),
  cfdiRelacionado: (xml) => getCfdiRelacionadosAttribute(xml, 'UUID'),
  totalImpuestosTrasladados: (xml) => getGlobalImpuestosAttribute(xml, 'TotalImpuestosTrasladados') || null,
  totalImpuestosRetenidos: (xml) => getGlobalImpuestosAttribute(xml, 'TotalImpuestosRetenidos') || null,
}

function parseNominaNodeAttribute(xml: string, attr: string) {
  if (attr === 'NumEmpleado' || attr === 'Departamento') {
    return getNominaSpecificNodeAttribute(xml, 'Receptor', attr) || null
  }
  const regex = new RegExp(String.raw`<(?:[a-zA-Z0-9_-]+:)?Nomina[^>]*?\b${attr}="([^"]+)"`)
  const match = regex.exec(xml || '')
  if (match) {
    if (['TotalPercepciones', 'TotalDeducciones', 'TotalOtrosPagos'].includes(attr)) {
      return Number(match[1]) || null
    }
    return match[1] || null
  }
  return null
}

function parseNominaAttribute(key: string, xmlContent: string) {
  if (key.startsWith('nominaReceptor')) {
    return getNominaSpecificNodeAttribute(xmlContent, 'Receptor', key.replace('nominaReceptor', '')) || null
  }
  if (key.startsWith('nominaEmisor')) {
    return getNominaSpecificNodeAttribute(xmlContent, 'Emisor', key.replace('nominaEmisor', '')) || null
  }
  if (key.startsWith('nominaSubContratacion')) {
    return getNominaSpecificNodeAttribute(xmlContent, 'SubContratacion', key.replace('nominaSubContratacion', '')) || null
  }
  return parseNominaNodeAttribute(xmlContent, key.replace('nomina', ''))
}

function getProjectedValue(row: InvoiceRow, key: string) {
  const projectedValue = row.projection?.[key]
  if (projectedValue !== null && projectedValue !== undefined && projectedValue !== '') {
    return projectedValue
  }

  const extractor = attributeExtractors[key]
  if (extractor) {
    return extractor(row.xmlContent)
  }

  if (key.startsWith('nomina')) {
    return parseNominaAttribute(key, row.xmlContent)
  }

  return null
}


const getCfdiElements = (n: Element | Document, name: string) => {
  const withCfdiPrefix = n.getElementsByTagName(`cfdi:${name}`)
  if (withCfdiPrefix.length > 0) return Array.from(withCfdiPrefix)
  const withNominaPrefix = n.getElementsByTagName(`nomina12:${name}`)
  if (withNominaPrefix.length > 0) return Array.from(withNominaPrefix)
  const withNs = n.getElementsByTagNameNS('*', name)
  if (withNs.length > 0) return Array.from(withNs)
  return Array.from(n.getElementsByTagName(name))
}

const extractConceptoData = (node: Element) => {
  const concepto = {
    ClaveProdServ: node.getAttribute('ClaveProdServ') || '',
    NoIdentificacion: node.getAttribute('NoIdentificacion') || '',
    Cantidad: node.getAttribute('Cantidad') || '',
    Unidad: node.getAttribute('Unidad') || '',
    ClaveUnidad: node.getAttribute('ClaveUnidad') || '',
    Descripcion: node.getAttribute('Descripcion') || '',
    ValorUnitario: node.getAttribute('ValorUnitario') || '',
    Descuento: node.getAttribute('Descuento') || '',
    Importe: node.getAttribute('Importe') || '',
    ObjetoImp: node.getAttribute('ObjetoImp') || '',
    Traslados: [] as Array<{ Base: string; Impuesto: string; TipoFactor: string; TasaOCuota: string; Importe: string }>,
    Retenciones: [] as Array<{ Base: string; Impuesto: string; TipoFactor: string; TasaOCuota: string; Importe: string }>
  }
  
  const impuestosNode = getCfdiElements(node, 'Impuestos')[0]
  if (impuestosNode) {
    const trasladosNode = getCfdiElements(impuestosNode, 'Traslados')[0]
    if (trasladosNode) {
      concepto.Traslados = getCfdiElements(trasladosNode, 'Traslado').map(t => ({
        Base: t.getAttribute('Base') || '',
        Impuesto: t.getAttribute('Impuesto') || '',
        TipoFactor: t.getAttribute('TipoFactor') || '',
        TasaOCuota: t.getAttribute('TasaOCuota') || '',
        Importe: t.getAttribute('Importe') || ''
      }))
    }
    const retencionesNode = getCfdiElements(impuestosNode, 'Retenciones')[0]
    if (retencionesNode) {
      concepto.Retenciones = getCfdiElements(retencionesNode, 'Retencion').map(r => ({
        Base: r.getAttribute('Base') || '',
        Impuesto: r.getAttribute('Impuesto') || '',
        TipoFactor: r.getAttribute('TipoFactor') || '',
        TasaOCuota: r.getAttribute('TasaOCuota') || '',
        Importe: r.getAttribute('Importe') || ''
      }))
    }
  }
  return concepto
}

function NominaPercepcionesTable({ xml }: Readonly<{ xml: string }>) {
  const { items, jubilacion, separacion } = useMemo(() => {
    if (!xml) return { items: [], jubilacion: null, separacion: null }
    try {
      const parser = new DOMParser()
      const doc = parser.parseFromString(xml, 'text/xml')
      const percepcionesNode = getCfdiElements(doc, 'Percepciones')[0]
      if (!percepcionesNode) return { items: [], jubilacion: null, separacion: null }
      
      const items = getCfdiElements(percepcionesNode, 'Percepcion').map(node => {
        const perc = {
          TipoPercepcion: node.getAttribute('TipoPercepcion') || '',
          Clave: node.getAttribute('Clave') || '',
          Concepto: node.getAttribute('Concepto') || '',
          ImporteGravado: node.getAttribute('ImporteGravado') || '',
          ImporteExento: node.getAttribute('ImporteExento') || '',
          HorasExtra: [] as Array<{ Dias: string; TipoHoras: string; HorasExtra: string; ImportePagado: string }>,
          AccionesOTitulos: null as { ValorMercado: string; PrecioAlOtorgarse: string } | null
        }
        
        const horasExtraNodes = getCfdiElements(node, 'HorasExtra')
        perc.HorasExtra = horasExtraNodes.map(h => ({
          Dias: h.getAttribute('Dias') || '',
          TipoHoras: h.getAttribute('TipoHoras') || '',
          HorasExtra: h.getAttribute('HorasExtra') || '',
          ImportePagado: h.getAttribute('ImportePagado') || ''
        }))
        
        const accionesNode = getCfdiElements(node, 'AccionesOTitulos')[0]
        if (accionesNode) {
          perc.AccionesOTitulos = {
            ValorMercado: accionesNode.getAttribute('ValorMercado') || '',
            PrecioAlOtorgarse: accionesNode.getAttribute('PrecioAlOtorgarse') || ''
          }
        }
        
        return perc
      })

      const jubNode = getCfdiElements(percepcionesNode, 'JubilacionPensionRetiro')[0]
      const jubilacion = jubNode ? {
        TotalUnaExhibicion: jubNode.getAttribute('TotalUnaExhibicion') || '',
        TotalParcialidad: jubNode.getAttribute('TotalParcialidad') || '',
        MontoDiario: jubNode.getAttribute('MontoDiario') || '',
        IngresoAcumulable: jubNode.getAttribute('IngresoAcumulable') || '',
        IngresoNoAcumulable: jubNode.getAttribute('IngresoNoAcumulable') || ''
      } : null

      const sepNode = getCfdiElements(percepcionesNode, 'SeparacionIndemnizacion')[0]
      const separacion = sepNode ? {
        TotalPagado: sepNode.getAttribute('TotalPagado') || '',
        NumAñosServicio: sepNode.getAttribute('NumAñosServicio') || '',
        UltimoSueldoMensOrd: sepNode.getAttribute('UltimoSueldoMensOrd') || '',
        IngresoAcumulable: sepNode.getAttribute('IngresoAcumulable') || '',
        IngresoNoAcumulable: sepNode.getAttribute('IngresoNoAcumulable') || ''
      } : null

      return { items, jubilacion, separacion }
    } catch { return { items: [], jubilacion: null, separacion: null } }
  }, [xml])

  if (items.length === 0 && !jubilacion && !separacion) return null

  return (
    <div className="p-4 bg-muted/30 border rounded-md">
      <h5 className="font-semibold text-sm mb-2 text-primary">Detalle de Percepciones</h5>
      
      {jubilacion && (
        <div className="mb-4 bg-background p-3 rounded-md shadow-sm border text-xs">
          <h6 className="font-semibold text-primary mb-2">Jubilación / Pensión / Retiro</h6>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div><span className="font-medium block text-muted-foreground">Total Una Exhibición</span>{jubilacion.TotalUnaExhibicion ? `$${Number(jubilacion.TotalUnaExhibicion).toFixed(2)}` : '-'}</div>
            <div><span className="font-medium block text-muted-foreground">Total Parcialidad</span>{jubilacion.TotalParcialidad ? `$${Number(jubilacion.TotalParcialidad).toFixed(2)}` : '-'}</div>
            <div><span className="font-medium block text-muted-foreground">Monto Diario</span>{jubilacion.MontoDiario ? `$${Number(jubilacion.MontoDiario).toFixed(2)}` : '-'}</div>
            <div><span className="font-medium block text-muted-foreground">Ingreso Acumulable</span>{jubilacion.IngresoAcumulable ? `$${Number(jubilacion.IngresoAcumulable).toFixed(2)}` : '-'}</div>
            <div><span className="font-medium block text-muted-foreground">Ingreso No Acumulable</span>{jubilacion.IngresoNoAcumulable ? `$${Number(jubilacion.IngresoNoAcumulable).toFixed(2)}` : '-'}</div>
          </div>
        </div>
      )}

      {separacion && (
        <div className="mb-4 bg-background p-3 rounded-md shadow-sm border text-xs">
          <h6 className="font-semibold text-primary mb-2">Separación / Indemnización</h6>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div><span className="font-medium block text-muted-foreground">Total Pagado</span>{separacion.TotalPagado ? `$${Number(separacion.TotalPagado).toFixed(2)}` : '-'}</div>
            <div><span className="font-medium block text-muted-foreground">Años Servicio</span>{separacion.NumAñosServicio || '-'}</div>
            <div><span className="font-medium block text-muted-foreground">Último Sueldo Mens.</span>{separacion.UltimoSueldoMensOrd ? `$${Number(separacion.UltimoSueldoMensOrd).toFixed(2)}` : '-'}</div>
            <div><span className="font-medium block text-muted-foreground">Ingreso Acumulable</span>{separacion.IngresoAcumulable ? `$${Number(separacion.IngresoAcumulable).toFixed(2)}` : '-'}</div>
            <div><span className="font-medium block text-muted-foreground">Ingreso No Acumulable</span>{separacion.IngresoNoAcumulable ? `$${Number(separacion.IngresoNoAcumulable).toFixed(2)}` : '-'}</div>
          </div>
        </div>
      )}

      {items.length > 0 && (
      <div className="overflow-x-auto scrollbar-visible">
        <table className="w-max text-xs text-left border-collapse bg-background shadow-sm rounded-md overflow-hidden">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="p-2 font-medium">TipoPercepcion</th>
              <th className="p-2 font-medium">Clave</th>
              <th className="p-2 font-medium">Concepto</th>
              <th className="p-2 font-medium text-right">Gravado</th>
              <th className="p-2 font-medium text-right">Exento</th>
            </tr>
          </thead>
          <tbody>
            {items.map((c, i) => {
              const uniqueKey = `percepcion-${i}`
              return (
              <Fragment key={uniqueKey}>
                <tr className="border-b hover:bg-muted/20">
                  <td className="p-2">{c.TipoPercepcion}</td>
                  <td className="p-2">{c.Clave}</td>
                  <td className="p-2 truncate max-w-xs xl:max-w-md 2xl:max-w-xl" title={c.Concepto}>{c.Concepto}</td>
                  <td className="p-2 text-right">{c.ImporteGravado ? `$${Number(c.ImporteGravado).toFixed(2)}` : ''}</td>
                  <td className="p-2 text-right">{c.ImporteExento ? `$${Number(c.ImporteExento).toFixed(2)}` : ''}</td>
                </tr>
                {c.HorasExtra.length > 0 && (
                  <tr className="border-b bg-muted/10">
                    <td colSpan={5} className="p-2 pl-6">
                      <div className="text-[11px] text-muted-foreground">
                        <span className="font-semibold text-primary block mb-1">Horas Extra:</span>
                        {c.HorasExtra.map((h, j) => (
                          <div key={`${uniqueKey}-horas-${j}`} className="flex gap-4">
                            <span><span className="font-medium">Días:</span> {h.Dias}</span>
                            <span><span className="font-medium">Tipo:</span> {h.TipoHoras}</span>
                            <span><span className="font-medium">Horas:</span> {h.HorasExtra}</span>
                            <span><span className="font-medium">Importe:</span> {h.ImportePagado ? `$${Number(h.ImportePagado).toFixed(2)}` : ''}</span>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
                {c.AccionesOTitulos && (
                  <tr className="border-b bg-muted/10">
                    <td colSpan={5} className="p-2 pl-6">
                      <div className="text-[11px] text-muted-foreground flex gap-4">
                        <span className="font-semibold text-primary block mb-1">Acciones o Títulos:</span>
                        <span><span className="font-medium">Valor Mercado:</span> {c.AccionesOTitulos.ValorMercado ? `$${Number(c.AccionesOTitulos.ValorMercado).toFixed(2)}` : ''}</span>
                        <span><span className="font-medium">Precio al Otorgarse:</span> {c.AccionesOTitulos.PrecioAlOtorgarse ? `$${Number(c.AccionesOTitulos.PrecioAlOtorgarse).toFixed(2)}` : ''}</span>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            )})}
          </tbody>
        </table>
      </div>
      )}
    </div>
  )
}

function NominaDeduccionesTable({ xml }: Readonly<{ xml: string }>) {
  const items = useMemo(() => {
    if (!xml) return []
    try {
      const parser = new DOMParser()
      const doc = parser.parseFromString(xml, 'text/xml')
      const deduccionesNode = getCfdiElements(doc, 'Deducciones')[0]
      if (!deduccionesNode) return []
      
      return getCfdiElements(deduccionesNode, 'Deduccion').map(node => ({
        TipoDeduccion: node.getAttribute('TipoDeduccion') || '',
        Clave: node.getAttribute('Clave') || '',
        Concepto: node.getAttribute('Concepto') || '',
        Importe: node.getAttribute('Importe') || ''
      }))
    } catch { return [] }
  }, [xml])

  if (items.length === 0) return null

  return (
    <div className="p-4 bg-muted/30 border rounded-md">
      <h5 className="font-semibold text-sm mb-2 text-primary">Detalle de Deducciones</h5>
      <div className="overflow-x-auto scrollbar-visible">
        <table className="w-max text-xs text-left border-collapse bg-background shadow-sm rounded-md overflow-hidden">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="p-2 font-medium">TipoDeduccion</th>
              <th className="p-2 font-medium">Clave</th>
              <th className="p-2 font-medium">Concepto</th>
              <th className="p-2 font-medium text-right">Importe</th>
            </tr>
          </thead>
          <tbody>
            {items.map((c, i) => {
              const key = c.Clave ? `${c.Clave}-${i}` : `deduccion-${i}`
              return (
              <tr key={key} className="border-b hover:bg-muted/20">
                <td className="p-2">{c.TipoDeduccion}</td>
                <td className="p-2">{c.Clave}</td>
                <td className="p-2 truncate max-w-xs xl:max-w-md 2xl:max-w-xl" title={c.Concepto}>{c.Concepto}</td>
                <td className="p-2 text-right">{c.Importe ? `$${Number(c.Importe).toFixed(2)}` : ''}</td>
              </tr>
            )})}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function NominaOtrosPagosTable({ xml }: Readonly<{ xml: string }>) {
  const items = useMemo(() => {
    if (!xml) return []
    try {
      const parser = new DOMParser()
      const doc = parser.parseFromString(xml, 'text/xml')
      const otrosPagosNode = getCfdiElements(doc, 'OtrosPagos')[0]
      if (!otrosPagosNode) return []
      
      return getCfdiElements(otrosPagosNode, 'OtroPago').map(node => {
        const op = {
          TipoOtroPago: node.getAttribute('TipoOtroPago') || '',
          Clave: node.getAttribute('Clave') || '',
          Concepto: node.getAttribute('Concepto') || '',
          Importe: node.getAttribute('Importe') || '',
          SubsidioAlEmpleo: null as { SubsidioCausado: string } | null
        }
        
        const subsidioNode = getCfdiElements(node, 'SubsidioAlEmpleo')[0]
        if (subsidioNode) {
          op.SubsidioAlEmpleo = {
            SubsidioCausado: subsidioNode.getAttribute('SubsidioCausado') || ''
          }
        }
        return op
      })
    } catch { return [] }
  }, [xml])

  if (items.length === 0) return null

  return (
    <div className="p-4 bg-muted/30 border rounded-md">
      <h5 className="font-semibold text-sm mb-2 text-primary">Detalle de Otros Pagos</h5>
      <div className="overflow-x-auto scrollbar-visible">
        <table className="w-max text-xs text-left border-collapse bg-background shadow-sm rounded-md overflow-hidden">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="p-2 font-medium">TipoOtroPago</th>
              <th className="p-2 font-medium">Clave</th>
              <th className="p-2 font-medium">Concepto</th>
              <th className="p-2 font-medium text-right">Importe</th>
            </tr>
          </thead>
          <tbody>
            {items.map((c, i) => {
              const uniqueKey = `otropago-${i}`
              return (
              <Fragment key={uniqueKey}>
                <tr className="border-b hover:bg-muted/20">
                  <td className="p-2">{c.TipoOtroPago}</td>
                  <td className="p-2">{c.Clave}</td>
                  <td className="p-2 truncate max-w-xs xl:max-w-md 2xl:max-w-xl" title={c.Concepto}>{c.Concepto}</td>
                  <td className="p-2 text-right">{c.Importe ? `$${Number(c.Importe).toFixed(2)}` : ''}</td>
                </tr>
                {c.SubsidioAlEmpleo && (
                  <tr className="border-b bg-muted/10">
                    <td colSpan={4} className="p-2 pl-6">
                      <div className="text-[11px] text-muted-foreground flex gap-4">
                        <span className="font-semibold text-primary block mb-1">Subsidio Al Empleo:</span>
                        <span><span className="font-medium">Subsidio Causado:</span> {c.SubsidioAlEmpleo.SubsidioCausado ? `$${Number(c.SubsidioAlEmpleo.SubsidioCausado).toFixed(2)}` : ''}</span>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            )})}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function NominaIncapacidadesTable({ xml }: Readonly<{ xml: string }>) {
  const items = useMemo(() => {
    if (!xml) return []
    try {
      const parser = new DOMParser()
      const doc = parser.parseFromString(xml, 'text/xml')
      const incapacidadesNode = getCfdiElements(doc, 'Incapacidades')[0]
      if (!incapacidadesNode) return []
      
      return getCfdiElements(incapacidadesNode, 'Incapacidad').map(node => ({
        DiasIncapacidad: node.getAttribute('DiasIncapacidad') || '',
        TipoIncapacidad: node.getAttribute('TipoIncapacidad') || '',
        ImporteMonetario: node.getAttribute('ImporteMonetario') || ''
      }))
    } catch { return [] }
  }, [xml])

  if (items.length === 0) return null

  return (
    <div className="p-4 bg-muted/30 border rounded-md">
      <h5 className="font-semibold text-sm mb-2 text-primary">Detalle de Incapacidades</h5>
      <div className="overflow-x-auto scrollbar-visible">
        <table className="w-max text-xs text-left border-collapse bg-background shadow-sm rounded-md overflow-hidden">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="p-2 font-medium">Dias Incapacidad</th>
              <th className="p-2 font-medium">Tipo Incapacidad</th>
              <th className="p-2 font-medium text-right">Importe Monetario</th>
            </tr>
          </thead>
          <tbody>
            {items.map((c, i) => {
              const key = c.TipoIncapacidad ? `${c.TipoIncapacidad}-${i}` : `incapacidad-${i}`
              return (
              <tr key={key} className="border-b hover:bg-muted/20">
                <td className="p-2">{c.DiasIncapacidad}</td>
                <td className="p-2">{c.TipoIncapacidad}</td>
                <td className="p-2 text-right">{c.ImporteMonetario ? `$${Number(c.ImporteMonetario).toFixed(2)}` : ''}</td>
              </tr>
            )})}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ConceptosTable({ xml }: Readonly<{ xml: string }>) {
  const conceptos = useMemo(() => {
    if (!xml) return []
    try {
      const parser = new DOMParser()
      const doc = parser.parseFromString(xml, 'text/xml')
      const conceptosNode = getCfdiElements(doc, 'Conceptos')[0]
      if (!conceptosNode) return []
      
      return getCfdiElements(conceptosNode, 'Concepto').map(extractConceptoData)
    } catch { /* ignored */ 
      return []
    }
  }, [xml])

  if (conceptos.length === 0) return <div className="text-sm text-muted-foreground p-4">No se encontraron conceptos.</div>

  return (
    <div className="p-4 bg-muted/30">
      <h5 className="font-semibold text-sm mb-2 text-primary">Detalle de Conceptos</h5>
      <div className="overflow-x-auto scrollbar-visible">
        <table className="w-max text-xs text-left border-collapse bg-background shadow-sm rounded-md overflow-hidden">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="p-2 font-medium">ClaveProdServ</th>
              <th className="p-2 font-medium">NoIdentificacion</th>
              <th className="p-2 font-medium">Cantidad</th>
              <th className="p-2 font-medium">ClaveUnidad</th>
              <th className="p-2 font-medium">Unidad</th>
              <th className="p-2 font-medium">Descripción</th>
              <th className="p-2 font-medium">ValorUnitario</th>
              <th className="p-2 font-medium">Descuento</th>
              <th className="p-2 font-medium">Importe</th>
              <th className="p-2 font-medium">ObjetoImp</th>
            </tr>
          </thead>
          <tbody>
            {conceptos.map((c, i) => {
              const uniqueKey = c.NoIdentificacion ? `${c.NoIdentificacion}-${i}` : `concepto-${i}`
              return (
              <Fragment key={uniqueKey}>
                <tr className="border-b hover:bg-muted/20">
                  <td className="p-2">{c.ClaveProdServ}</td>
                  <td className="p-2">{c.NoIdentificacion}</td>
                  <td className="p-2">{c.Cantidad}</td>
                  <td className="p-2">{c.ClaveUnidad}</td>
                  <td className="p-2">{c.Unidad}</td>
                  <td className="p-2 truncate max-w-xs xl:max-w-md 2xl:max-w-xl" title={c.Descripcion}>{c.Descripcion}</td>
                  <td className="p-2">{c.ValorUnitario ? `$${Number(c.ValorUnitario).toFixed(2)}` : ''}</td>
                  <td className="p-2">{c.Descuento ? `$${Number(c.Descuento).toFixed(2)}` : ''}</td>
                  <td className="p-2">{c.Importe ? `$${Number(c.Importe).toFixed(2)}` : ''}</td>
                  <td className="p-2">{c.ObjetoImp}</td>
                </tr>
                {(c.Traslados.length > 0 || c.Retenciones.length > 0) && (
                  <tr className="border-b bg-muted/10">
                    <td colSpan={10} className="p-2 pl-6">
                      <div className="flex gap-6">
                        {c.Traslados.length > 0 && (
                          <div>
                            <span className="font-semibold text-[11px] text-primary block mb-1">Traslados:</span>
                            <div className="flex flex-col gap-1">
                              {c.Traslados.map((t, j) => (
                                <div key={`${t.Impuesto}-${t.TipoFactor}-${j}`} className="text-[11px] text-muted-foreground flex gap-3">
                                  <span><span className="font-medium">Imp:</span> {t.Impuesto}</span>
                                  <span><span className="font-medium">Base:</span> {t.Base ? `$${Number(t.Base).toFixed(2)}` : ''}</span>
                                  <span><span className="font-medium">Tasa:</span> {t.TasaOCuota}</span>
                                  <span><span className="font-medium">Importe:</span> {t.Importe ? `$${Number(t.Importe).toFixed(2)}` : ''}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {c.Retenciones.length > 0 && (
                          <div>
                            <span className="font-semibold text-[11px] text-primary block mb-1">Retenciones:</span>
                            <div className="flex flex-col gap-1">
                              {c.Retenciones.map((r, j) => (
                                <div key={`${r.Impuesto}-${r.TipoFactor}-${j}`} className="text-[11px] text-muted-foreground flex gap-3">
                                  <span><span className="font-medium">Imp:</span> {r.Impuesto}</span>
                                  <span><span className="font-medium">Base:</span> {r.Base ? `$${Number(r.Base).toFixed(2)}` : ''}</span>
                                  <span><span className="font-medium">Tasa:</span> {r.TasaOCuota}</span>
                                  <span><span className="font-medium">Importe:</span> {r.Importe ? `$${Number(r.Importe).toFixed(2)}` : ''}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            )})}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const columnDefs = [

    { key: 'uuid', label: 'UUID', group: '<tfd:TimbreFiscalDigital>', render: (r: InvoiceRow) => <span className="whitespace-nowrap">{r.uuid}</span> },
    { key: 'version', label: 'Versión', group: '<cfdi:Comprobante>', render: (r: InvoiceRow) => String(getProjectedValue(r, 'version') ?? '') },
    { key: 'noCertificado', label: 'No. Certificado', group: '<cfdi:Comprobante>', render: (r: InvoiceRow) => String(getProjectedValue(r, 'noCertificado') ?? '') },
    { key: 'certificado', label: 'Certificado', group: '<cfdi:Comprobante>', render: (r: InvoiceRow) => {
      const val = String(getProjectedValue(r, 'certificado') ?? '')
      return <div className="max-w-[150px] truncate" title={val}>{val}</div>
    } },
    { key: 'cfdiType', label: 'Tipo De Comprobante', group: '<cfdi:Comprobante>', render: (r: InvoiceRow) => r.cfdiType },
    { key: 'series', label: 'Serie', group: '<cfdi:Comprobante>', render: (r: InvoiceRow) => r.series ?? '' },
    { key: 'folio', label: 'Folio', group: '<cfdi:Comprobante>', render: (r: InvoiceRow) => r.folio ?? '' },
    { key: 'currency', label: 'Moneda', group: '<cfdi:Comprobante>', render: (r: InvoiceRow) => r.currency ?? '' },
    { key: 'hasNomina', label: 'Tiene Nómina', group: '<nomina12:Nomina>', render: (r: InvoiceRow) => getProjectedValue(r, 'hasNomina') ? 'Sí' : 'No' },
    { key: 'nominaVersion', label: 'Versión Nómina', group: '<nomina12:Nomina>', render: (r: InvoiceRow) => String(getProjectedValue(r, 'nominaVersion') ?? '') },
    { key: 'nominaTipoNomina', label: 'Tipo Nómina', group: '<nomina12:Nomina>', render: (r: InvoiceRow) => String(getProjectedValue(r, 'nominaTipoNomina') ?? '') },
    { key: 'nominaFechaPago', label: 'Fecha Pago', group: '<nomina12:Nomina>', render: (r: InvoiceRow) => formatCfdiDate(String(getProjectedValue(r, 'nominaFechaPago') ?? '')) },
    { key: 'nominaFechaInicialPago', label: 'Fecha Inicial Pago', group: '<nomina12:Nomina>', render: (r: InvoiceRow) => formatCfdiDate(String(getProjectedValue(r, 'nominaFechaInicialPago') ?? '')) },
    { key: 'nominaFechaFinalPago', label: 'Fecha Final Pago', group: '<nomina12:Nomina>', render: (r: InvoiceRow) => formatCfdiDate(String(getProjectedValue(r, 'nominaFechaFinalPago') ?? '')) },
    { key: 'nominaNumDiasPagados', label: 'Núm Días Pagados', group: '<nomina12:Nomina>', render: (r: InvoiceRow) => String(getProjectedValue(r, 'nominaNumDiasPagados') ?? '') },
    { key: 'nominaTotalPercepciones', label: 'Total Percepciones', group: '<nomina12:Nomina>', render: (r: InvoiceRow) => formatMXN(Number(getProjectedValue(r, 'nominaTotalPercepciones') ?? 0)) },
    { key: 'nominaTotalDeducciones', label: 'Total Deducciones', group: '<nomina12:Nomina>', render: (r: InvoiceRow) => formatMXN(Number(getProjectedValue(r, 'nominaTotalDeducciones') ?? 0)) },
    { key: 'nominaTotalOtrosPagos', label: 'Total Otros Pagos', group: '<nomina12:Nomina>', render: (r: InvoiceRow) => formatMXN(Number(getProjectedValue(r, 'nominaTotalOtrosPagos') ?? 0)) },
    
    // nomina12:Receptor
    { key: 'nominaReceptorCurp', label: 'CURP', group: '<nomina12:Receptor>', render: (r: InvoiceRow) => String(getProjectedValue(r, 'nominaReceptorCurp') ?? '') },
    { key: 'nominaReceptorNumSeguridadSocial', label: 'NSS', group: '<nomina12:Receptor>', render: (r: InvoiceRow) => String(getProjectedValue(r, 'nominaReceptorNumSeguridadSocial') ?? '') },
    { key: 'nominaReceptorFechaInicioRelLaboral', label: 'Inicio Rel. Laboral', group: '<nomina12:Receptor>', render: (r: InvoiceRow) => formatCfdiDate(String(getProjectedValue(r, 'nominaReceptorFechaInicioRelLaboral') ?? '')) },
    { key: 'nominaReceptorAntigüedad', label: 'Antigüedad', group: '<nomina12:Receptor>', render: (r: InvoiceRow) => String(getProjectedValue(r, 'nominaReceptorAntigüedad') ?? '') },
    { key: 'nominaReceptorTipoContrato', label: 'Tipo Contrato', group: '<nomina12:Receptor>', render: (r: InvoiceRow) => String(getProjectedValue(r, 'nominaReceptorTipoContrato') ?? '') },
    { key: 'nominaReceptorSindicalizado', label: 'Sindicalizado', group: '<nomina12:Receptor>', render: (r: InvoiceRow) => String(getProjectedValue(r, 'nominaReceptorSindicalizado') ?? '') },
    { key: 'nominaReceptorTipoJornada', label: 'Tipo Jornada', group: '<nomina12:Receptor>', render: (r: InvoiceRow) => String(getProjectedValue(r, 'nominaReceptorTipoJornada') ?? '') },
    { key: 'nominaReceptorTipoRegimen', label: 'Tipo Régimen', group: '<nomina12:Receptor>', render: (r: InvoiceRow) => String(getProjectedValue(r, 'nominaReceptorTipoRegimen') ?? '') },
    { key: 'nominaNumEmpleado', label: 'Núm Empleado', group: '<nomina12:Receptor>', render: (r: InvoiceRow) => String(getProjectedValue(r, 'nominaNumEmpleado') ?? '') },
    { key: 'nominaDepartamento', label: 'Departamento', group: '<nomina12:Receptor>', render: (r: InvoiceRow) => String(getProjectedValue(r, 'nominaDepartamento') ?? '') },
    { key: 'nominaReceptorPuesto', label: 'Puesto', group: '<nomina12:Receptor>', render: (r: InvoiceRow) => String(getProjectedValue(r, 'nominaReceptorPuesto') ?? '') },
    { key: 'nominaReceptorRiesgoPuesto', label: 'Riesgo Puesto', group: '<nomina12:Receptor>', render: (r: InvoiceRow) => String(getProjectedValue(r, 'nominaReceptorRiesgoPuesto') ?? '') },
    { key: 'nominaReceptorPeriodicidadPago', label: 'Periodicidad Pago', group: '<nomina12:Receptor>', render: (r: InvoiceRow) => String(getProjectedValue(r, 'nominaReceptorPeriodicidadPago') ?? '') },
    { key: 'nominaReceptorBanco', label: 'Banco', group: '<nomina12:Receptor>', render: (r: InvoiceRow) => String(getProjectedValue(r, 'nominaReceptorBanco') ?? '') },
    { key: 'nominaReceptorCuentaBancaria', label: 'Cuenta Bancaria', group: '<nomina12:Receptor>', render: (r: InvoiceRow) => String(getProjectedValue(r, 'nominaReceptorCuentaBancaria') ?? '') },
    { key: 'nominaReceptorSalarioBaseCotApor', label: 'SBC', group: '<nomina12:Receptor>', render: (r: InvoiceRow) => formatMXN(Number(getProjectedValue(r, 'nominaReceptorSalarioBaseCotApor') ?? 0)) },
    { key: 'nominaReceptorSalarioDiarioIntegrado', label: 'SDI', group: '<nomina12:Receptor>', render: (r: InvoiceRow) => formatMXN(Number(getProjectedValue(r, 'nominaReceptorSalarioDiarioIntegrado') ?? 0)) },
    { key: 'nominaReceptorClaveEntFed', label: 'Clave Ent. Fed.', group: '<nomina12:Receptor>', render: (r: InvoiceRow) => String(getProjectedValue(r, 'nominaReceptorClaveEntFed') ?? '') },

    // nomina12:Emisor
    { key: 'nominaEmisorCurp', label: 'CURP Emisor', group: '<nomina12:Emisor>', render: (r: InvoiceRow) => String(getProjectedValue(r, 'nominaEmisorCurp') ?? '') },
    { key: 'nominaEmisorRegistroPatronal', label: 'Registro Patronal', group: '<nomina12:Emisor>', render: (r: InvoiceRow) => String(getProjectedValue(r, 'nominaEmisorRegistroPatronal') ?? '') },
    { key: 'nominaEmisorRfcPatronOrigen', label: 'RFC Patrón Origen', group: '<nomina12:Emisor>', render: (r: InvoiceRow) => String(getProjectedValue(r, 'nominaEmisorRfcPatronOrigen') ?? '') },

    // nomina12:SubContratacion
    { key: 'nominaSubContratacionRfcLabora', label: 'RFC Labora', group: '<nomina12:SubContratacion>', render: (r: InvoiceRow) => String(getProjectedValue(r, 'nominaSubContratacionRfcLabora') ?? '') },
    { key: 'nominaSubContratacionPorcentajeTiempo', label: '% Tiempo Subcontratación', group: '<nomina12:SubContratacion>', render: (r: InvoiceRow) => String(getProjectedValue(r, 'nominaSubContratacionPorcentajeTiempo') ?? '') },

    { key: 'status', label: 'Estatus', group: 'Sistema / Metadatos', render: (r: InvoiceRow) => r.status },
    { key: 'satStatus', label: 'SAT', group: 'Sistema / Metadatos', render: (r: InvoiceRow) => r.satStatus },
    { key: 'tipoRelacion', label: 'Tipo Relación', group: '<cfdi:CfdiRelacionados>', render: (r: InvoiceRow) => String(getProjectedValue(r, 'tipoRelacion') ?? '') },
    { key: 'cfdiRelacionado', label: 'CFDIRelacionado', group: '<cfdi:CfdiRelacionados>', render: (r: InvoiceRow) => String(getProjectedValue(r, 'cfdiRelacionado') ?? '') },
    { key: 'issuerRfc', label: 'RFC Emisor', group: '<cfdi:Emisor>', render: (r: InvoiceRow) => r.issuerRfc },
    { key: 'issuerName', label: 'Emisor', group: '<cfdi:Emisor>', render: (r: InvoiceRow) => r.issuerName },
    { key: 'receiverRfc', label: 'RFC Receptor', group: '<cfdi:Receptor>', render: (r: InvoiceRow) => r.receiverRfc },
    { key: 'receiverName', label: 'Receptor', group: '<cfdi:Receptor>', render: (r: InvoiceRow) => r.receiverName },
    { key: 'domicilioFiscalReceptor', label: 'Domicilio Fiscal Receptor', group: '<cfdi:Receptor>', render: (r: InvoiceRow) => String(getProjectedValue(r, 'domicilioFiscalReceptor') ?? '') },
    { key: 'residenciaFiscal', label: 'Residencia Fiscal', group: '<cfdi:Receptor>', render: (r: InvoiceRow) => String(getProjectedValue(r, 'residenciaFiscal') ?? '') },
    { key: 'numRegIdTrib', label: 'Num Reg Id Trib', group: '<cfdi:Receptor>', render: (r: InvoiceRow) => String(getProjectedValue(r, 'numRegIdTrib') ?? '') },
    { key: 'regimenFiscalReceptor', label: 'Régimen Fiscal Receptor', group: '<cfdi:Receptor>', render: (r: InvoiceRow) => String(getProjectedValue(r, 'regimenFiscalReceptor') ?? '') },
    { key: 'subtotal', label: 'SubTotal', group: '<cfdi:Comprobante>', render: (r: InvoiceRow) => formatMXN(r.subtotal) },
    { key: 'discount', label: 'Descuento', group: '<cfdi:Comprobante>', render: (r: InvoiceRow) => formatMXN(r.discount) },
    { key: 'total', label: 'Total', group: '<cfdi:Comprobante>', render: (r: InvoiceRow) => formatMXN(r.total) },
    { key: 'totalImpuestosTrasladados', label: 'Total Impuestos Trasladados', group: '<cfdi:Impuestos>', render: (r: InvoiceRow) => {
      const val = getProjectedValue(r, 'totalImpuestosTrasladados')
      return val ? formatMXN(Number(val)) : ''
    } },
    { key: 'totalImpuestosRetenidos', label: 'Total Impuestos Retenidos', group: '<cfdi:Impuestos>', render: (r: InvoiceRow) => {
      const val = getProjectedValue(r, 'totalImpuestosRetenidos')
      return val ? formatMXN(Number(val)) : ''
    } },
    { key: 'issuanceDate', label: 'Fecha Timbrado', group: '<cfdi:Comprobante>', render: (r: InvoiceRow) => formatCfdiDate(r.issuanceDate) },
    { key: 'certificationDate', label: 'Fecha Certificación', group: '<tfd:TimbreFiscalDigital>', render: (r: InvoiceRow) => formatCfdiDate(r.certificationDate) },
    { key: 'certificationPac', label: 'PAC', group: '<tfd:TimbreFiscalDigital>', render: (r: InvoiceRow) => r.certificationPac },
    { key: 'paymentMethod', label: 'Método Pago', group: '<cfdi:Comprobante>', render: (r: InvoiceRow) => r.paymentMethod ?? '' },
    { key: 'paymentForm', label: 'Forma Pago', group: '<cfdi:Comprobante>', render: (r: InvoiceRow) => r.paymentForm ?? '' },
    { key: 'cfdiUsage', label: 'Uso CFDI', group: '<cfdi:Receptor>', render: (r: InvoiceRow) => r.cfdiUsage ?? '' },
    { key: 'placeOfExpedition', label: 'Lugar Expedición', group: '<cfdi:Comprobante>', render: (r: InvoiceRow) => r.placeOfExpedition ?? '' },
    { key: 'exportKey', label: 'Exportación', group: '<cfdi:Comprobante>', render: (r: InvoiceRow) => r.exportKey ?? '' },
    { key: 'objectTaxComprobante', label: 'Objeto Impuesto Comp.', group: '<cfdi:Comprobante>', render: (r: InvoiceRow) => r.objectTaxComprobante ?? '' },
    { key: 'paymentConditions', label: 'Condiciones de Pago', group: '<cfdi:Comprobante>', render: (r: InvoiceRow) => r.paymentConditions ?? '' },
  ] as const;

const NUM_COLS_EXPORT = new Set(['subtotal', 'discount', 'total', 'totalImpuestosTrasladados', 'totalImpuestosRetenidos', 'nominaTotalPercepciones', 'nominaTotalDeducciones', 'nominaTotalOtrosPagos', 'nominaReceptorSalarioBaseCotApor', 'nominaReceptorSalarioDiarioIntegrado'])

const groupedColumns = (() => {
    const groups: Record<string, typeof columnDefs[number][]> = {}
    groups['<cfdi:Conceptos>'] = []
    groups['<nomina12:Percepciones>'] = []
    groups['<nomina12:Deducciones>'] = []
    groups['<nomina12:OtrosPagos>'] = []
    groups['<nomina12:Incapacidades>'] = []
    columnDefs.forEach(c => {
      const g = c.group || 'Otros'
      if (!groups[g]) groups[g] = []
      groups[g].push(c)
    })
    return groups
  })();

const fetchAndAddXmlToZip = async (zip: JSZip, id: string, uuid: string, initialXml: string) => {
  try {
    let xmlToZip = initialXml
    if (!xmlToZip) {
      const xmlRes = await fetch(`/api/invoices/${id}/xml`)
      if (xmlRes.ok) xmlToZip = await xmlRes.text()
    }
    if (xmlToZip) {
      zip.file(`cfdi_${uuid}.xml`, xmlToZip)
    }
  } catch {
    console.error(`Error al obtener XML para UUID ${uuid}`)
  }
}

const fetchAndAddPdfToZip = async (zip: JSZip, id: string, uuid: string) => {
  try {
    const pdfRes = await fetch(`/api/dashboard/nomina/invoices/${id}/pdf`)
    if (pdfRes.ok) {
      const pdfBlob = await pdfRes.blob()
      zip.file(`cfdi_${uuid}.pdf`, pdfBlob)
    } else {
      console.error(`Error al descargar PDF para UUID ${uuid}`)
    }
  } catch {
    console.error(`Excepción al descargar PDF para UUID ${uuid}`)
  }
}

const triggerZipDownload = async (zip: JSZip, rfc: string) => {
  const content = await zip.generateAsync({ type: 'blob' })
  const url = URL.createObjectURL(content)
  const a = document.createElement('a')
  a.href = url
  a.download = `cfdis_seleccionados_${rfc}.zip`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

const formatProjectedValue = (val: unknown): string | number => {
  if (typeof val === 'boolean') return val ? 'SI' : 'NO'
  if (typeof val === 'number') return val
  if (typeof val === 'string') return val
  return ''
}

export default function NominaWorkpaperPage() {
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null)
  const [selectedCompany, setSelectedCompany] = useState<SelectedCompany | null>(null)

  const [invQuery, setInvQuery] = useState('')
  const [invSatStatus, setInvSatStatus] = useState<string>('')
  const [invDateFrom, setInvDateFrom] = useState<string>('')
  const [invDateTo, setInvDateTo] = useState<string>('')
  const [nominaDepto, setNominaDepto] = useState<string>('')
  const [nominaTipo, setNominaTipo] = useState<string>('')
  const [appliedInvDateFrom, setAppliedInvDateFrom] = useState<string>('')
  const [appliedInvDateTo, setAppliedInvDateTo] = useState<string>('')
  const [appliedNominaDepto, setAppliedNominaDepto] = useState<string>('')
  const [appliedNominaTipo, setAppliedNominaTipo] = useState<string>('')
  const [invPage, setInvPage] = useState(1)
  const [invLimit, setInvLimit] = useState(20)
  const [invLoading, setInvLoading] = useState(false)
  const [invRows, setInvRows] = useState<InvoiceRow[]>([])
  const [invTotalPages, setInvTotalPages] = useState(0)
  const [invTotal, setInvTotal] = useState(0)
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({})
  const [selectedInvoices, setSelectedInvoices] = useState<Map<string, { uuid: string, xmlContent: string }>>(new Map())
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [isZipLoading, setIsZipLoading] = useState(false)

  
  const handleApplyFilters = () => {
    if (!invDateFrom || !invDateTo) {
      toast.error('Selecciona Timbrado desde y hasta antes de consultar')
      return
    }
    if (invDateFrom > invDateTo) {
      toast.error('La fecha de inicio no puede ser mayor que la fecha final')
      return
    }
    setInvPage(1)
    setAppliedInvDateFrom(invDateFrom)
    setAppliedInvDateTo(invDateTo)
    setAppliedNominaDepto(nominaDepto)
    setAppliedNominaTipo(nominaTipo)
  }

  const handleClearFilters = () => {
    setInvQuery('')
    setInvSatStatus('')
    setInvDateFrom('')
    setInvDateTo('')
    setNominaDepto('')
    setNominaTipo('')
    setAppliedInvDateFrom('')
    setAppliedInvDateTo('')
    setAppliedNominaDepto('')
    setAppliedNominaTipo('')
    setColumnFilters({})
    setInvLimit(20)
    setInvPage(1)
  }

  const handleExportCsv = async () => {
    const selectedCols = columnDefs
      .filter(c => visibleCols.has(c.key))
      .sort((a, b) => columnOrder.indexOf(a.key) - columnOrder.indexOf(b.key))
    const headers = selectedCols.map(c => c.label)
    
    const allData = await fetchAllInvoicesForExport()
    const rows = allData.map((r: InvoiceRow) =>
      selectedCols.map(c => exportValue(r, c.key))
    )
    
    const totalsRow = selectedCols.map((c, idx) => {
      if (idx === 0) return 'TOTAL'
      if (NUM_COLS_EXPORT.has(c.key)) {
        const sum = allData.reduce((acc: number, curr: InvoiceRow) => {
          const val = exportValue(curr, c.key)
          return acc + (typeof val === 'number' ? val : 0)
        }, 0)
        return sum
      }
      return ''
    })

    const escape = (val: string) => {
      const needsQuotes = /[",\n]/.test(val)
      const v = val.replaceAll('"', '""')
      return needsQuotes ? `"${v}"` : v
    }
    const csv = [headers, ...rows, totalsRow].map(r => r.map((x: unknown) => {
      if (x === null || x === undefined) return escape('')
      if (typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean') return escape(String(x))
      return escape('')
    }).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `cfdis_emitidos_${selectedCompany?.rfc || 'empresa'}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const handleExportExcel = async () => {
    const selectedCols = columnDefs
      .filter(c => visibleCols.has(c.key))
      .sort((a, b) => columnOrder.indexOf(a.key) - columnOrder.indexOf(b.key))
    const headers = selectedCols.map(c => c.label)
    
    const allData = await fetchAllInvoicesForExport()
    
    const escapeXml = (s: string) =>
      s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
    const toCell = (value: string, type: 'String' | 'Number' = 'String') =>
      `<Cell><Data ss:Type="${type}">${escapeXml(value)}</Data></Cell>`
    const headerRow = `<Row>${headers.map(h => toCell(h, 'String')).join('')}</Row>`
    
    const dataRows = allData.map((r: InvoiceRow) => {
      const cells = selectedCols.map(c => {
        const val = exportValue(r, c.key)
        const type = typeof val === 'number' ? 'Number' : 'String'
        return toCell(String(val), type)
      })
      return `<Row>${cells.join('')}</Row>`
    }).join('')
    
    const totalsCells = selectedCols.map((c, idx) => {
      if (idx === 0) return toCell('TOTAL', 'String')
      if (NUM_COLS_EXPORT.has(c.key)) {
        const sum = allData.reduce((acc: number, curr: InvoiceRow) => {
          const val = exportValue(curr, c.key)
          return acc + (typeof val === 'number' ? val : 0)
        }, 0)
        return toCell(String(sum), 'Number')
      }
      return toCell('', 'String')
    }).join('')
    const totalsRowXml = `<Row>${totalsCells}</Row>`

    const xml =
      `<?xml version="1.0"?>` +
      `<?mso-application progid="Excel.Sheet"?>` +
      `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" ` +
      `xmlns:o="urn:schemas-microsoft-com:office:office" ` +
      `xmlns:x="urn:schemas-microsoft-com:office:excel" ` +
      `xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">` +
      `<Worksheet ss:Name="CFDIs Emitidos">` +
      `<Table>` +
      `  <Column ss:Width="100"/>`.repeat(headers.length) +
      headerRow +
      dataRows +
      totalsRowXml +
      `</Table>` +
      `</Worksheet>` +
      `</Workbook>`
    const blob = new Blob([xml], { type: 'application/vnd.ms-excel' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `cfdis_emitidos_${selectedCompany?.rfc || 'empresa'}.xls`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const handleDownloadZip = async () => {
    if (selectedInvoices.size === 0) return
    setIsZipLoading(true)
    try {
      const zip = new JSZip()
      for (const [id, data] of Array.from(selectedInvoices.entries())) {
        await fetchAndAddXmlToZip(zip, id, data.uuid, data.xmlContent)
        await fetchAndAddPdfToZip(zip, id, data.uuid)
      }
      await triggerZipDownload(zip, selectedCompany?.rfc || 'empresa')
    } finally {
      setIsZipLoading(false)
    }
  }

  const columnsTotals = useMemo(() => {
    if (invRows.length === 0 || invLoading) return {}
    const totals: Record<string, number> = {}
    const sumKeys = ['subtotal', 'discount', 'total', 'totalImpuestosTrasladados', 'totalImpuestosRetenidos', 'nominaTotalPercepciones', 'nominaTotalDeducciones', 'nominaTotalOtrosPagos']
    sumKeys.forEach(k => totals[k] = 0)
    
    for (const r of invRows) {
      totals['totalImpuestosTrasladados'] += Number(getGlobalImpuestosAttribute(r.xmlContent, 'TotalImpuestosTrasladados')) || 0
      totals['totalImpuestosRetenidos'] += Number(getGlobalImpuestosAttribute(r.xmlContent, 'TotalImpuestosRetenidos')) || 0
      
      const numKeys = ['subtotal', 'discount', 'total']
      numKeys.forEach(k => {
        totals[k] += Number(r[k as keyof InvoiceRow]) || 0
      })
      
      const nomKeys = ['nominaTotalPercepciones', 'nominaTotalDeducciones', 'nominaTotalOtrosPagos']
      nomKeys.forEach(k => {
        totals[k] += Number(getProjectedValue(r, k)) || 0
      })
    }
    return totals
  }, [invRows, invLoading])


  const toggleRow = async (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })

    const row = invRows.find(r => r.id === id)
    if (!row?.xmlContent) {
      try {
        const res = await fetch(`/api/invoices/${id}/xml`)
        if (res.ok) {
          const xml = await res.text()
          setInvRows(prev => prev.map(r => r.id === id ? { ...r, xmlContent: xml } : r))
          // Also update selectedInvoices if it's there
          setSelectedInvoices(prev => {
            const next = new Map(prev)
            if (next.has(id) && row?.uuid) {
              next.set(id, { uuid: row.uuid, xmlContent: xml })
            }
            return next
          })
        }
      } catch (err) {
        console.error('Error fetching XML for row expansion:', err)
      }
    }
  }

  

  

  const basicColumnsKeys = ['issuerRfc', 'receiverRfc', 'receiverName', 'series', 'folio', 'uuid', 'nominaNumEmpleado', 'nominaFechaPago', 'nominaTotalPercepciones', 'nominaTotalDeducciones', 'nominaTotalOtrosPagos', 'subtotal', 'discount', 'total']

  const [visibleCols, setVisibleCols] = useState<Set<string>>(new Set(basicColumnsKeys))
  const [columnOrder, setColumnOrder] = useState<string[]>(() => {
    const known = columnDefs.map(c => c.key)
    const missing = known.filter(k => !basicColumnsKeys.includes(k))
    return [...basicColumnsKeys, ...missing]
  })
  const [dragCol, setDragCol] = useState<string | null>(null)
  const persistVisibleColumns = useCallback(async (cols: string[]) => {
    try {
      await fetch('/api/user/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preferences: {
            tables: {
              workpaperEmitidos: { visibleColumns: cols }
            }
          }
        })
      })
    } catch { /* ignored */ }
  }, [])
  const persistColumnOrder = useCallback(async (order: string[]) => {
    try {
      await fetch('/api/user/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preferences: {
            tables: {
              workpaperEmitidos: { columnOrder: order }
            }
          }
        })
      })
    } catch { /* ignored */ }
  }, [])
  useEffect(() => {
    const loadPrefs = async () => {
      try {
        const res = await fetch('/api/user/profile')
        const data = await res.json()
        const cols = data?.user?.preferences?.tables?.workpaperEmitidos?.visibleColumns
        const order = data?.user?.preferences?.tables?.workpaperEmitidos?.columnOrder
        if (Array.isArray(cols) && cols.length > 0) {
          setVisibleCols(new Set(cols))
        }
        if (Array.isArray(order) && order.length > 0) {
          const known = columnDefs.map(c => c.key)
          const cleanOrder = order.filter(k => known.includes(k))
          const missing = known.filter(k => !cleanOrder.includes(k))
          setColumnOrder([...cleanOrder, ...missing])
        }
      } catch { /* ignored */ }
    }
    loadPrefs()
  }, [])

  const [showColumnPanel, setShowColumnPanel] = useState(false)

  const isInvalidDateRange = useMemo(() => {
    return Boolean(invDateFrom && invDateTo && invDateFrom > invDateTo)
  }, [invDateFrom, invDateTo])

  const hasCompleteDateRange = useMemo(() => {
    return Boolean(invDateFrom && invDateTo)
  }, [invDateFrom, invDateTo])

  const hasAppliedDateRange = useMemo(() => {
    return Boolean(appliedInvDateFrom && appliedInvDateTo)
  }, [appliedInvDateFrom, appliedInvDateTo])

  const exportValue = (r: InvoiceRow, key: string): string | number => {
    if (key.startsWith('has')) return getProjectedValue(r, key) ? 'SI' : 'NO'

    const projectedValue = getProjectedValue(r, key)
    if (projectedValue !== null && projectedValue !== undefined && projectedValue !== '') {
      return formatProjectedValue(projectedValue)
    }
    
    const v = r[key as keyof InvoiceRow] as unknown
    const dateKeys = new Set(['issuanceDate', 'certificationDate', 'createdAt', 'updatedAt', 'nominaFechaPago', 'nominaFechaInicialPago', 'nominaFechaFinalPago'])
    if (v === null || v === undefined) return ''
    if (dateKeys.has(key)) {
      return formatCfdiDate(v as string | Date)
    }
    if (typeof v === 'number') return v
    if (typeof v === 'string' || typeof v === 'boolean') return String(v)
    return ''
  }

  const fetchInvoices = useCallback(async () => {
    if (!selectedCompanyId || !hasAppliedDateRange) {
      setInvRows([])
      setInvTotalPages(0)
      setInvTotal(0)
      setInvLoading(false)
      return
    }

    setInvLoading(true)
    const params = new URLSearchParams({
      companyId: selectedCompanyId,
      page: String(invPage),
      limit: String(invLimit),
      cfdiType: 'NOMINA',
      origin: 'issued'
    })
    if (invQuery) params.set('query', invQuery)
    if (invSatStatus) params.set('satStatus', invSatStatus)
    if (appliedInvDateFrom) params.set('dateFrom', appliedInvDateFrom)
    if (appliedInvDateTo) params.set('dateTo', appliedInvDateTo)
    if (appliedNominaDepto) params.set('attr.nominaDepartamento', appliedNominaDepto)
    if (appliedNominaTipo) params.set('attr.nominaTipoNomina', appliedNominaTipo)
    Object.entries(columnFilters).forEach(([key, value]) => {
      if (value) params.set(key, value)
    })
    const res = await fetch(`/api/dashboard_fiscal/invoices?${params.toString()}`)
    const data = await res.json()
    setInvRows(data?.invoices || [])
    setInvTotalPages(data?.pagination?.totalPages || 0)
    setInvTotal(data?.pagination?.total || 0)
    setInvLoading(false)
  }, [selectedCompanyId, hasAppliedDateRange, invPage, invLimit, invQuery, invSatStatus, appliedInvDateFrom, appliedInvDateTo, appliedNominaDepto, appliedNominaTipo, columnFilters])

  const fetchAllInvoicesForExport = async () => {
    if (!selectedCompanyId || !hasAppliedDateRange) return []
    const params = new URLSearchParams({
      companyId: selectedCompanyId,
      page: '1',
      limit: '999999',
      export: 'true',
      cfdiType: 'NOMINA',
      origin: 'issued'
    })
    if (invQuery) params.set('query', invQuery)
    if (invSatStatus) params.set('satStatus', invSatStatus)
    if (appliedInvDateFrom) params.set('dateFrom', appliedInvDateFrom)
    if (appliedInvDateTo) params.set('dateTo', appliedInvDateTo)
    if (appliedNominaDepto) params.set('attr.nominaDepartamento', appliedNominaDepto)
    if (appliedNominaTipo) params.set('attr.nominaTipoNomina', appliedNominaTipo)
    Object.entries(columnFilters).forEach(([key, value]) => {
      if (value) params.set(key, value)
    })
    try {
      const res = await fetch(`/api/dashboard_fiscal/invoices?${params.toString()}`)
      const data = await res.json()
      return data?.invoices || []
    } catch (err) {
      console.error('Error fetching all invoices for export', err)
      return []
    }
  }

  useEffect(() => {
    const id = setTimeout(() => {
      fetchInvoices()
    }, 500)
    return () => clearTimeout(id)
  }, [fetchInvoices])

  useEffect(() => {
    const readSelected = () => {
      try {
        const raw = localStorage.getItem('selectedCompany')
        if (raw) {
          const parsed = JSON.parse(raw) as SelectedCompany
          setSelectedCompanyId(parsed?.id || null)
          setSelectedCompany(parsed || null)
        }
      } catch { /* ignored */ }
    }
    readSelected()
    const listener = () => readSelected()
    window.addEventListener('company-selected', listener as EventListener)
    return () => window.removeEventListener('company-selected', listener as EventListener)
  }, [])

  const rangeLabel =
    appliedInvDateFrom && appliedInvDateTo
      ? `Del ${appliedInvDateFrom} al ${appliedInvDateTo}`
      : 'Sin periodo aplicado'
  const countLabel = ` — ${invTotal} registros`

  if (!selectedCompanyId) {
    return (
      <ProtectedRoute>
        <div className="flex-1 space-y-4 p-4 md:p-6 pt-6">
          <Card>
            <CardHeader>
              <CardTitle>Selecciona una empresa</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Usa el combobox del sidebar para elegir la empresa y cargar la Hoja de Trabajo de CFDIs Emitidos.
              </p>
            </CardContent>
          </Card>
        </div>
      </ProtectedRoute>
    )
  }

  const renderTableRows = () => {
    if (invLoading) {
      return <tr><td className="px-2 py-3 text-center" colSpan={visibleCols.size + 2}>Cargando...</td></tr>
    }
    if (!hasAppliedDateRange) {
      return <tr><td className="px-2 py-3 text-center" colSpan={visibleCols.size + 2}>Selecciona Fecha Inicio y Fecha Fin y pulsa Aplicar para consultar.</td></tr>
    }
    if (invRows.length === 0) {
      return <tr><td className="px-2 py-3 text-center" colSpan={visibleCols.size + 2}>Sin resultados</td></tr>
    }
    return invRows.map((r) => {
      const hasExpandableContent = ['show_conceptos', 'show_percepciones', 'show_deducciones', 'show_otros_pagos', 'show_incapacidades'].some(k => visibleCols.has(k))
      return (
      <Fragment key={r.id}>
        <tr className="border-t">
          <td className="px-2 py-2 text-center align-middle whitespace-nowrap">
            <input 
              type="checkbox"
              checked={selectedInvoices.has(r.id)}
              onChange={(e) => {
                const next = new Map(selectedInvoices)
                if (e.target.checked) {
                  next.set(r.id, { uuid: r.uuid, xmlContent: r.xmlContent })
                } else {
                  next.delete(r.id)
                }
                setSelectedInvoices(next)
              }}
            />
            {hasExpandableContent && (
              <Button variant="ghost" size="sm" onClick={() => toggleRow(r.id)} className="h-6 w-6 p-0 ml-2">
                {expandedRows.has(r.id) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </Button>
            )}
          </td>
          {columnDefs
            .filter(c => visibleCols.has(c.key))
            .sort((a, b) => columnOrder.indexOf(a.key) - columnOrder.indexOf(b.key))
            .map((c) => (
              <td key={c.key} className="px-2 py-2">{c.render(r)}</td>
            ))}
          <td className="px-2 py-2 text-center align-middle whitespace-nowrap sticky right-0 bg-background z-10 border-l shadow-[-5px_0_5px_-5px_rgba(0,0,0,0.1)]">
            <div className="flex justify-center gap-2">
              <Button
                variant="outline"
                size="icon"
                title="XML"
                onClick={() => {
                  const a = document.createElement('a')
                  a.href = `/api/invoices/${r.id}/xml`
                  a.download = `cfdi_${r.uuid || 'cfdi'}.xml`
                  document.body.appendChild(a)
                  a.click()
                  a.remove()
                }}
              >
                <FileCode className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                title="PDF"
                onClick={() => {
                  try {
                    toast.info('Generando PDF...')
                    const a = document.createElement('a')
                    a.href = `/api/dashboard/nomina/invoices/${r.id}/pdf`
                    a.target = '_blank'
                    document.body.appendChild(a)
                    a.click()
                    a.remove()
                  } catch (error) {
                    console.error('Error generating PDF:', error)
                    toast.error('Ocurrió un error al generar el PDF')
                  }
                }}
                className="text-primary bg-transparent hover:bg-primary hover:text-white shadow-sm size-10"
              >
                <FileText className="h-4 w-4" />
              </Button>
            </div>
          </td>
        </tr>
        {expandedRows.has(r.id) && hasExpandableContent && (
          <tr className="bg-muted/10 border-b">
            <td colSpan={Array.from(visibleCols).filter(k => !['show_conceptos', 'show_percepciones', 'show_deducciones', 'show_otros_pagos', 'show_incapacidades'].includes(k)).length + 2}>
              <div className="flex flex-col gap-4">
                {visibleCols.has('show_conceptos') && <ConceptosTable xml={r.xmlContent} />}
                {visibleCols.has('show_percepciones') && <NominaPercepcionesTable xml={r.xmlContent} />}
                {visibleCols.has('show_deducciones') && <NominaDeduccionesTable xml={r.xmlContent} />}
                {visibleCols.has('show_otros_pagos') && <NominaOtrosPagosTable xml={r.xmlContent} />}
                {visibleCols.has('show_incapacidades') && <NominaIncapacidadesTable xml={r.xmlContent} />}
              </div>
            </td>
          </tr>
        )}
      </Fragment>
    )})}

  return (
    <ProtectedRoute>
      <div className="flex-1 space-y-4 p-4 md:p-6 pt-6">
        <div className="flex items-center space-x-2">
          <h2 className="text-3xl font-bold tracking-tight">Reporte de Nómina</h2>
          <div className="flex items-center space-x-2">
            <span className="text-sm text-muted-foreground">
              {selectedCompany?.rfc || 'N/A'} · {selectedCompany?.businessName || selectedCompany?.name || 'Empresa'}
            </span>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>CFDIs analizados</CardTitle>
            <CardDescription>Visualización con filtros y paginación</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-4 lg:grid-cols-6 items-end">
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">Estatus SAT</span>
                <Select value={invSatStatus} onValueChange={(v) => setInvSatStatus(v === 'ALL' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="Estatus" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Todos</SelectItem>
                    <SelectItem value="VIGENTE">Vigente</SelectItem>
                    <SelectItem value="CANCELADO">Cancelado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">Timbrado desde</span>
                <Input type="date" placeholder="Fecha desde" value={invDateFrom} onChange={(e) => setInvDateFrom(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">Timbrado hasta</span>
                <Input type="date" placeholder="Fecha hasta" value={invDateTo} onChange={(e) => setInvDateTo(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">Departamento</span>
                <Input type="text" placeholder="Departamento" value={nominaDepto} onChange={(e) => setNominaDepto(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">Tipo Nómina</span>
                <Select value={nominaTipo} onValueChange={(v) => setNominaTipo(v === 'ALL' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="Tipo Nómina" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Todos</SelectItem>
                    <SelectItem value="O">O - Ordinaria</SelectItem>
                    <SelectItem value="E">E - Extraordinaria</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Button 
                  onClick={handleApplyFilters}
                  disabled={isInvalidDateRange || !hasCompleteDateRange}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-md hover:shadow-lg rounded-full px-6 flex-1"
                >
                  Aplicar
                </Button>
                <Button 
                  onClick={handleClearFilters}
                  disabled={!invDateFrom && !invDateTo && !hasAppliedDateRange && !invSatStatus && !nominaDepto && !nominaTipo && Object.keys(columnFilters).length === 0}
                  className="bg-secondary text-secondary-foreground hover:bg-secondary/90 shadow-md hover:shadow-lg rounded-full px-6 flex-1"
                >
                  Limpiar
                </Button>
              </div>
            </div>
            {isInvalidDateRange && (
              <p className="text-sm text-destructive mt-3">
                La fecha de inicio no puede ser mayor que la fecha final.
              </p>
            )}
            {!isInvalidDateRange && !hasAppliedDateRange && (
              <p className="text-sm text-muted-foreground mt-3">
                Selecciona un periodo con Fecha Inicio y Fecha Fin para consultar la hoja de trabajo.
              </p>
            )}
            <div className="flex gap-3 mt-3 flex-wrap">
              <Button 
                variant="outline" 
                disabled={!hasAppliedDateRange}
                onClick={handleExportCsv}
                className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-md hover:shadow-lg rounded-full px-6"
              >
                Exportar CSV
              </Button>
              <Button 
                variant="outline" 
                disabled={!hasAppliedDateRange}
                onClick={handleExportExcel}
                className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-md hover:shadow-lg rounded-full px-6"
              >
                Exportar Excel
              </Button>
              <Button 
                variant="outline" 
                disabled={selectedInvoices.size === 0 || isZipLoading}
                onClick={handleDownloadZip}
                className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-md hover:shadow-lg rounded-full px-6"
              >
                {isZipLoading ? `Preparando Zip...` : `Descarga Zip (${selectedInvoices.size})`}
              </Button>
            </div>
            <div className="flex items-center justify-between mt-1">
              <div className="text-xs text-muted-foreground flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                <span>Rango aplicado: {rangeLabel}{countLabel}</span>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" onClick={() => setShowColumnPanel(v => !v)}>
                  <Eye className="h-4 w-4 mr-2" />
                  Columnas
                </Button>
              </div>
            </div>

            {showColumnPanel && (
              <div className="mt-3 border rounded-md p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Columnas visibles</span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const all = new Set(columnDefs.map(c => c.key))
                        setVisibleCols(all)
                        persistVisibleColumns(Array.from(all))
                      }}
                    >
                      Mostrar todo
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const basic = new Set(['issuerRfc', 'receiverRfc', 'receiverName', 'series', 'folio', 'uuid', 'nominaNumEmpleado', 'nominaFechaPago', 'nominaTotalPercepciones', 'nominaTotalDeducciones', 'nominaTotalOtrosPagos', 'subtotal', 'discount', 'total'])
                        setVisibleCols(basic)
                        persistVisibleColumns(Array.from(basic))
                        
                        const orderKeys = ['issuerRfc', 'receiverRfc', 'receiverName', 'series', 'folio', 'uuid', 'nominaNumEmpleado', 'nominaFechaPago', 'nominaTotalPercepciones', 'nominaTotalDeducciones', 'nominaTotalOtrosPagos', 'subtotal', 'discount', 'total']
                        const orderSet = new Set(orderKeys)
                        const known = columnDefs.map(c => c.key)
                        const missing = known.filter(k => !orderSet.has(k))
                        const newOrder = [...orderKeys, ...missing]
                        setColumnOrder(newOrder)
                        persistColumnOrder(newOrder)
                      }}
                    >
                      Vista básica
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const def = columnDefs.map(c => c.key)
                        setColumnOrder(def)
                        persistColumnOrder(def)
                      }}
                    >
                      Orden por defecto
                    </Button>
                  </div>
                </div>
                <div className="flex flex-col gap-4">
                  {Object.entries(groupedColumns)
                    .sort(([a], [b]) => {
                      const order = ['<cfdi:Comprobante>', '<cfdi:CfdiRelacionados>', '<cfdi:Emisor>', '<cfdi:Receptor>', '<nomina12:Nomina>', '<nomina12:Receptor>', '<nomina12:Emisor>', '<nomina12:SubContratacion>', '<cfdi:Conceptos>', '<nomina12:Percepciones>', '<nomina12:Deducciones>', '<nomina12:OtrosPagos>', '<nomina12:Incapacidades>', '<cfdi:Impuestos>', '<tfd:TimbreFiscalDigital>', 'Sistema / Metadatos']
                      const posA = order.indexOf(a)
                      const posB = order.indexOf(b)
                      return (posA === -1 ? 999 : posA) - (posB === -1 ? 999 : posB)
                    })
                    .map(([groupName, cols]) => {
                      const specialGroups: Record<string, string> = {
                        '<cfdi:Conceptos>': 'show_conceptos',
                        '<nomina12:Percepciones>': 'show_percepciones',
                        '<nomina12:Deducciones>': 'show_deducciones',
                        '<nomina12:OtrosPagos>': 'show_otros_pagos',
                        '<nomina12:Incapacidades>': 'show_incapacidades'
                      }
                      
                      if (specialGroups[groupName]) {
                        const toggleKey = specialGroups[groupName]
                        const isChecked = visibleCols.has(toggleKey)
                        return (
                          <div key={groupName} className="space-y-2">
                            <h4 className="text-xs font-semibold text-primary tracking-wider border-b pb-1 flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={(e) => {
                                  const next = new Set(visibleCols)
                                  if (e.target.checked) {
                                    next.add(toggleKey)
                                  } else {
                                    next.delete(toggleKey)
                                  }
                                  const arr = Array.from(next)
                                  setVisibleCols(next)
                                  persistVisibleColumns(arr)
                                }}
                              />
                              {groupName}
                            </h4>
                          </div>
                        )
                      }
                      return (
                      <div key={groupName} className="space-y-2">
                        <h4 className="text-xs font-semibold text-primary tracking-wider border-b pb-1">{groupName}</h4>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                        {cols.map(col => {
                          const checked = visibleCols.has(col.key)
                          return (
                            <label key={col.key} className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  const next = new Set(visibleCols)
                                  if (e.target.checked) next.add(col.key)
                                  else next.delete(col.key)
                                  const arr = Array.from(next)
                                  setVisibleCols(next)
                                  persistVisibleColumns(arr)
                                }}
                              />
                              {col.label}
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  )})}
                </div>
              </div>
            )}

            <div className="overflow-x-auto scrollbar-visible mt-4">
              <div className="min-w-[1000px]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left">
                      <th className="px-2 py-2 align-top w-10 text-center">
                        <input 
                          type="checkbox" 
                          className="mt-2"
                          checked={invRows.length > 0 && invRows.every(r => selectedInvoices.has(r.id))}
                          onChange={(e) => {
                            const next = new Map(selectedInvoices)
                            if (e.target.checked) {
                              invRows.forEach(r => next.set(r.id, { uuid: r.uuid, xmlContent: r.xmlContent }))
                            } else {
                              invRows.forEach(r => next.delete(r.id))
                            }
                            setSelectedInvoices(next)
                          }}
                        />
                      </th>
                      {columnDefs
                        .filter(c => visibleCols.has(c.key))
                        .sort((a, b) => columnOrder.indexOf(a.key) - columnOrder.indexOf(b.key))
                        .map((c) => (
                          <th
                            key={c.key}
                            className="px-2 py-2 align-top min-w-[150px]"
                          >
                            <div className="flex flex-col gap-2">
                              <span 
                                className="cursor-move select-none font-semibold text-xs uppercase text-muted-foreground whitespace-nowrap"
                                draggable
                                onDragStart={() => setDragCol(c.key)}
                                onDragOver={(e) => e.preventDefault()}
                                onDrop={() => {
                                  if (!dragCol || dragCol === c.key) return
                                  const order = [...columnOrder]
                                  const from = order.indexOf(dragCol)
                                  const to = order.indexOf(c.key)
                                  if (from < 0 || to < 0) return
                                  order.splice(from, 1)
                                  order.splice(to, 0, dragCol)
                                  setColumnOrder(order)
                                  persistColumnOrder(order)
                                  setDragCol(null)
                                }}
                              >
                                {c.label}
                              </span>
                              <Input
                                className="h-7 text-xs px-2 w-full min-w-[100px]"
                                placeholder={`Buscar...`}
                                value={columnFilters[c.key] || ''}
                                onChange={(e) => {
                                  setColumnFilters(prev => ({ ...prev, [c.key]: e.target.value }))
                                  setInvPage(1)
                                }}
                              />
                            </div>
                          </th>
                        ))}
                      <th className="px-2 py-2 align-top text-center w-24 sticky right-0 bg-background z-10 border-l shadow-[-5px_0_5px_-5px_rgba(0,0,0,0.1)]">
                        <div className="flex flex-col gap-2">
                          <span className="font-semibold text-xs uppercase text-muted-foreground whitespace-nowrap">
                            Acciones
                          </span>
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {renderTableRows()}
                  </tbody>
                  {invRows.length > 0 && !invLoading && (
                    <tfoot className="bg-muted/50 border-t font-bold">
                      <tr>
                        <td></td>
                        {columnDefs
                          .filter(c => visibleCols.has(c.key))
                          .sort((a, b) => columnOrder.indexOf(a.key) - columnOrder.indexOf(b.key))
                          .map((c, idx) => {
                            const sumKeys = ['subtotal', 'discount', 'total', 'totalImpuestosTrasladados', 'totalImpuestosRetenidos', 'nominaTotalPercepciones', 'nominaTotalDeducciones', 'nominaTotalOtrosPagos']
                            if (sumKeys.includes(c.key)) {
                              const sum = columnsTotals[c.key] || 0
                              return (
                                <td key={c.key} className="px-2 py-2">
                                  {formatMXN(sum)}
                                </td>
                              )
                            }
                            if (idx === 0) {
                              return (
                                <td key={c.key} className="px-2 py-2">
                                  Totales:
                                </td>
                              )
                            }
                            return <td key={c.key} className="px-2 py-2" />
                          })}
                        <td className="px-2 py-2 sticky right-0 bg-background z-10 border-l shadow-[-5px_0_5px_-5px_rgba(0,0,0,0.1)]"></td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>

            <div className="flex items-center justify-between mt-4">
              <div className="text-xs text-muted-foreground">Página {invPage} de {Math.max(invTotalPages, 1)}</div>
              <div className="flex items-center gap-2">
                <Select value={String(invLimit)} onValueChange={(v) => { setInvLimit(Number(v)); setInvPage(1) }}>
                  <SelectTrigger className="w-[120px]"><SelectValue placeholder="Por página" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="10">10</SelectItem>
                    <SelectItem value="20">20</SelectItem>
                    <SelectItem value="50">50</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="outline" onClick={() => setInvPage(Math.max(invPage - 1, 1))} disabled={invPage === 1}>Anterior</Button>
                <Button variant="outline" onClick={() => setInvPage(invPage + 1)} disabled={invPage >= invTotalPages}>Siguiente</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </ProtectedRoute>
  )
}
