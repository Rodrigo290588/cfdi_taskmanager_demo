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

type SelectedCompany = { id: string; rfc?: string; businessName?: string; name?: string }

const formatMXN = (value: number) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 }).format(Number(value || 0))

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
}

function getXmlAttribute(xml: string, attr: string): string {
  if (!xml) return ''
  const comprobanteMatch = xml.match(/<[^:]+:Comprobante([^>]+)>/)
  if (comprobanteMatch) {
    const attrs = comprobanteMatch[1]
    const regex = new RegExp(`${attr}="([^"]+)"`)
    const match = attrs.match(regex)
    if (match) return match[1]
  }
  return ''
}

function getReceptorAttribute(xml: string, attr: string): string {
  if (!xml) return ''
  const receptorMatch = xml.match(/<[^:]+:Receptor([^>]+)>/)
  if (receptorMatch) {
    const attrs = receptorMatch[1]
    const regex = new RegExp(`${attr}="([^"]+)"`)
    const match = attrs.match(regex)
    if (match) return match[1]
  }
  return ''
}

function getGlobalImpuestosAttribute(xml: string, attr: string): string {
  if (!xml) return ''
  const regex = new RegExp(`<[^:]+:Impuestos[^>]*?\\b${attr}="([^"]+)"`)
  const match = xml.match(regex)
  if (match) return match[1]
  return ''
}

function getCfdiRelacionadosAttribute(xml: string, type: 'TipoRelacion' | 'UUID'): string {
  if (!xml) return ''
  if (type === 'TipoRelacion') {
    const matches = Array.from(xml.matchAll(/<(?:[^:]+:)?CfdiRelacionados[^>]*?\bTipoRelacion="([^"]+)"/g))
    return matches.map(m => m[1]).join(', ')
  } else {
    const matches = Array.from(xml.matchAll(/<(?:[^:]+:)?CfdiRelacionado[^>]*?\bUUID="([^"]+)"/g))
    return matches.map(m => m[1]).join(', ')
  }
}

function ConceptosTable({ xml }: { xml: string }) {
  const conceptos = useMemo(() => {
    if (!xml) return []
    try {
      const parser = new DOMParser()
      const doc = parser.parseFromString(xml, 'text/xml')
      
      const getElementsByTagName = (node: Element | Document, name: string) => {
        const withPrefix = node.getElementsByTagName(`cfdi:${name}`)
        if (withPrefix.length > 0) return Array.from(withPrefix)
        const withoutPrefix = node.getElementsByTagName(name)
        return Array.from(withoutPrefix)
      }
      
      const conceptosNode = getElementsByTagName(doc, 'Conceptos')[0]
      if (!conceptosNode) return []
      
      const conceptoNodes = getElementsByTagName(conceptosNode, 'Concepto')
      
      return conceptoNodes.map(node => {
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
        
        const impuestosNode = getElementsByTagName(node, 'Impuestos')[0]
        if (impuestosNode) {
          const trasladosNode = getElementsByTagName(impuestosNode, 'Traslados')[0]
          if (trasladosNode) {
            const traslados = getElementsByTagName(trasladosNode, 'Traslado')
            concepto.Traslados = traslados.map(t => ({
              Base: t.getAttribute('Base') || '',
              Impuesto: t.getAttribute('Impuesto') || '',
              TipoFactor: t.getAttribute('TipoFactor') || '',
              TasaOCuota: t.getAttribute('TasaOCuota') || '',
              Importe: t.getAttribute('Importe') || ''
            }))
          }
          const retencionesNode = getElementsByTagName(impuestosNode, 'Retenciones')[0]
          if (retencionesNode) {
            const retenciones = getElementsByTagName(retencionesNode, 'Retencion')
            concepto.Retenciones = retenciones.map(r => ({
              Base: r.getAttribute('Base') || '',
              Impuesto: r.getAttribute('Impuesto') || '',
              TipoFactor: r.getAttribute('TipoFactor') || '',
              TasaOCuota: r.getAttribute('TasaOCuota') || '',
              Importe: r.getAttribute('Importe') || ''
            }))
          }
        }
        return concepto
      })
    } catch {
      return []
    }
  }, [xml])

  if (conceptos.length === 0) return <div className="text-sm text-muted-foreground p-4">No se encontraron conceptos.</div>

  return (
    <div className="p-4 bg-muted/30">
      <h5 className="font-semibold text-sm mb-2 text-primary">Detalle de Conceptos</h5>
      <div className="overflow-x-auto scrollbar-visible">
        <table className="w-full text-xs text-left border-collapse bg-background shadow-sm rounded-md overflow-hidden">
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
            {conceptos.map((c, i) => (
              <Fragment key={i}>
                <tr className="border-b hover:bg-muted/20">
                  <td className="p-2">{c.ClaveProdServ}</td>
                  <td className="p-2">{c.NoIdentificacion}</td>
                  <td className="p-2">{c.Cantidad}</td>
                  <td className="p-2">{c.ClaveUnidad}</td>
                  <td className="p-2">{c.Unidad}</td>
                  <td className="p-2 max-w-[200px] truncate" title={c.Descripcion}>{c.Descripcion}</td>
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
                                <div key={j} className="text-[11px] text-muted-foreground flex gap-3">
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
                                <div key={j} className="text-[11px] text-muted-foreground flex gap-3">
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
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function WorkpaperEmitidosPage() {
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null)
  const [selectedCompany, setSelectedCompany] = useState<SelectedCompany | null>(null)

  const [invQuery, setInvQuery] = useState('')
  const [invSatStatus, setInvSatStatus] = useState<string>('')
  const [invDateFrom, setInvDateFrom] = useState<string>('')
  const [invDateTo, setInvDateTo] = useState<string>('')
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

  const toggleRow = (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const columnDefs = useMemo(() => [
    { key: 'uuid', label: 'UUID', group: '<tfd:TimbreFiscalDigital>', render: (r: InvoiceRow) => <span className="whitespace-nowrap">{r.uuid}</span> },
    { key: 'version', label: 'Versión', group: '<cfdi:Comprobante>', render: (r: InvoiceRow) => getXmlAttribute(r.xmlContent, 'Version') },
    { key: 'noCertificado', label: 'No. Certificado', group: '<cfdi:Comprobante>', render: (r: InvoiceRow) => getXmlAttribute(r.xmlContent, 'NoCertificado') },
    { key: 'certificado', label: 'Certificado', group: '<cfdi:Comprobante>', render: (r: InvoiceRow) => {
      const val = getXmlAttribute(r.xmlContent, 'Certificado')
      return <div className="max-w-[150px] truncate" title={val}>{val}</div>
    } },
    { key: 'cfdiType', label: 'Tipo De Comprobante', group: '<cfdi:Comprobante>', render: (r: InvoiceRow) => r.cfdiType },
    { key: 'series', label: 'Serie', group: '<cfdi:Comprobante>', render: (r: InvoiceRow) => r.series ?? '' },
    { key: 'folio', label: 'Folio', group: '<cfdi:Comprobante>', render: (r: InvoiceRow) => r.folio ?? '' },
    { key: 'currency', label: 'Moneda', group: '<cfdi:Comprobante>', render: (r: InvoiceRow) => r.currency ?? '' },
    { key: 'exchangeRate', label: 'Tipo Cambio', group: '<cfdi:Comprobante>', render: (r: InvoiceRow) => r.exchangeRate ?? '' },
    { key: 'status', label: 'Estatus', group: 'Sistema / Metadatos', render: (r: InvoiceRow) => r.status },
    { key: 'satStatus', label: 'SAT', group: 'Sistema / Metadatos', render: (r: InvoiceRow) => r.satStatus },
    { key: 'tipoRelacion', label: 'Tipo Relación', group: '<cfdi:CfdiRelacionados>', render: (r: InvoiceRow) => getCfdiRelacionadosAttribute(r.xmlContent, 'TipoRelacion') },
    { key: 'cfdiRelacionado', label: 'CFDIRelacionado', group: '<cfdi:CfdiRelacionados>', render: (r: InvoiceRow) => getCfdiRelacionadosAttribute(r.xmlContent, 'UUID') },
    { key: 'issuerRfc', label: 'RFC Emisor', group: '<cfdi:Emisor>', render: (r: InvoiceRow) => r.issuerRfc },
    { key: 'issuerName', label: 'Emisor', group: '<cfdi:Emisor>', render: (r: InvoiceRow) => r.issuerName },
    { key: 'receiverRfc', label: 'RFC Receptor', group: '<cfdi:Receptor>', render: (r: InvoiceRow) => r.receiverRfc },
    { key: 'receiverName', label: 'Receptor', group: '<cfdi:Receptor>', render: (r: InvoiceRow) => r.receiverName },
    { key: 'domicilioFiscalReceptor', label: 'Domicilio Fiscal Receptor', group: '<cfdi:Receptor>', render: (r: InvoiceRow) => getReceptorAttribute(r.xmlContent, 'DomicilioFiscalReceptor') },
    { key: 'residenciaFiscal', label: 'Residencia Fiscal', group: '<cfdi:Receptor>', render: (r: InvoiceRow) => getReceptorAttribute(r.xmlContent, 'ResidenciaFiscal') },
    { key: 'numRegIdTrib', label: 'Num Reg Id Trib', group: '<cfdi:Receptor>', render: (r: InvoiceRow) => getReceptorAttribute(r.xmlContent, 'NumRegIdTrib') },
    { key: 'regimenFiscalReceptor', label: 'Régimen Fiscal Receptor', group: '<cfdi:Receptor>', render: (r: InvoiceRow) => getReceptorAttribute(r.xmlContent, 'RegimenFiscalReceptor') },
    { key: 'subtotal', label: 'SubTotal', group: '<cfdi:Comprobante>', render: (r: InvoiceRow) => formatMXN(r.subtotal) },
    { key: 'discount', label: 'Descuento', group: '<cfdi:Comprobante>', render: (r: InvoiceRow) => formatMXN(r.discount) },
    { key: 'total', label: 'Total', group: '<cfdi:Comprobante>', render: (r: InvoiceRow) => formatMXN(r.total) },
    { key: 'totalImpuestosTrasladados', label: 'Total Impuestos Trasladados', group: '<cfdi:Impuestos>', render: (r: InvoiceRow) => {
      const val = getGlobalImpuestosAttribute(r.xmlContent, 'TotalImpuestosTrasladados')
      return val ? formatMXN(Number(val)) : ''
    } },
    { key: 'totalImpuestosRetenidos', label: 'Total Impuestos Retenidos', group: '<cfdi:Impuestos>', render: (r: InvoiceRow) => {
      const val = getGlobalImpuestosAttribute(r.xmlContent, 'TotalImpuestosRetenidos')
      return val ? formatMXN(Number(val)) : ''
    } },
    { key: 'issuanceDate', label: 'Fecha', group: '<cfdi:Comprobante>', render: (r: InvoiceRow) => new Date(r.issuanceDate).toLocaleDateString('es-MX') },
    { key: 'certificationDate', label: 'Fecha Certificación', group: '<tfd:TimbreFiscalDigital>', render: (r: InvoiceRow) => r.certificationDate ? new Date(r.certificationDate).toLocaleDateString('es-MX') : '' },
    { key: 'certificationPac', label: 'PAC', group: '<tfd:TimbreFiscalDigital>', render: (r: InvoiceRow) => r.certificationPac },
    { key: 'paymentMethod', label: 'Método Pago', group: '<cfdi:Comprobante>', render: (r: InvoiceRow) => r.paymentMethod ?? '' },
    { key: 'paymentForm', label: 'Forma Pago', group: '<cfdi:Comprobante>', render: (r: InvoiceRow) => r.paymentForm ?? '' },
    { key: 'cfdiUsage', label: 'Uso CFDI', group: '<cfdi:Receptor>', render: (r: InvoiceRow) => r.cfdiUsage ?? '' },
    { key: 'placeOfExpedition', label: 'Lugar Expedición', group: '<cfdi:Comprobante>', render: (r: InvoiceRow) => r.placeOfExpedition ?? '' },
    { key: 'exportKey', label: 'Exportación', group: '<cfdi:Comprobante>', render: (r: InvoiceRow) => r.exportKey ?? '' },
    { key: 'objectTaxComprobante', label: 'Objeto Impuesto Comp.', group: '<cfdi:Comprobante>', render: (r: InvoiceRow) => r.objectTaxComprobante ?? '' },
    { key: 'paymentConditions', label: 'Condiciones de Pago', group: '<cfdi:Comprobante>', render: (r: InvoiceRow) => r.paymentConditions ?? '' },
  ] as const, [])

  const groupedColumns = useMemo(() => {
    const groups: Record<string, typeof columnDefs[number][]> = {}
    groups['<cfdi:Conceptos>'] = []
    columnDefs.forEach(c => {
      const g = c.group || 'Otros'
      if (!groups[g]) groups[g] = []
      groups[g].push(c)
    })
    return groups
  }, [columnDefs])

  const basicColumnsKeys = ['issuerRfc', 'receiverRfc', 'receiverName', 'series', 'folio', 'uuid', 'subtotal', 'totalImpuestosTrasladados', 'totalImpuestosRetenidos', 'discount', 'total']

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
    } catch {}
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
    } catch {}
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
      } catch {}
    }
    loadPrefs()
  }, [columnDefs])

  const [showColumnPanel, setShowColumnPanel] = useState(false)

  const exportValue = (r: InvoiceRow, key: string): string | number => {
    if (key === 'version') return getXmlAttribute(r.xmlContent, 'Version')
    if (key === 'noCertificado') return getXmlAttribute(r.xmlContent, 'NoCertificado')
    if (key === 'certificado') return getXmlAttribute(r.xmlContent, 'Certificado')
    if (key === 'domicilioFiscalReceptor') return getReceptorAttribute(r.xmlContent, 'DomicilioFiscalReceptor')
    if (key === 'residenciaFiscal') return getReceptorAttribute(r.xmlContent, 'ResidenciaFiscal')
    if (key === 'numRegIdTrib') return getReceptorAttribute(r.xmlContent, 'NumRegIdTrib')
    if (key === 'regimenFiscalReceptor') return getReceptorAttribute(r.xmlContent, 'RegimenFiscalReceptor')
    if (key === 'tipoRelacion') return getCfdiRelacionadosAttribute(r.xmlContent, 'TipoRelacion')
    if (key === 'cfdiRelacionado') return getCfdiRelacionadosAttribute(r.xmlContent, 'UUID')
    if (key === 'totalImpuestosTrasladados') return getGlobalImpuestosAttribute(r.xmlContent, 'TotalImpuestosTrasladados') || '0'
    if (key === 'totalImpuestosRetenidos') return getGlobalImpuestosAttribute(r.xmlContent, 'TotalImpuestosRetenidos') || '0'
    
    const v = r[key as keyof InvoiceRow] as unknown
    const dateKeys = ['issuanceDate', 'certificationDate', 'createdAt', 'updatedAt']
    if (v === null || v === undefined) return ''
    if (dateKeys.includes(key)) {
      try {
        return new Date(v as string | Date).toLocaleDateString('es-MX')
      } catch {
        return String(v)
      }
    }
    if (typeof v === 'number') return v
    return String(v)
  }

  const fetchInvoices = useCallback(async () => {
    if (!selectedCompanyId) return
    setInvLoading(true)
    const params = new URLSearchParams({
      companyId: selectedCompanyId,
      page: String(invPage),
      limit: String(invLimit),
      cfdiType: 'INGRESO,PAGO,EGRESO,TRASLADO', // Modificado para incluir múltiples tipos
      origin: 'issued' // Only show Emitidos
    })
    if (invQuery) params.set('query', invQuery)
    if (invSatStatus) params.set('satStatus', invSatStatus)
    if (invDateFrom) params.set('dateFrom', invDateFrom)
    if (invDateTo) params.set('dateTo', invDateTo)
    Object.entries(columnFilters).forEach(([key, value]) => {
      if (value) params.set(key, value)
    })
    const res = await fetch(`/api/dashboard_fiscal/invoices?${params.toString()}`)
    const data = await res.json()
    setInvRows(data?.invoices || [])
    setInvTotalPages(data?.pagination?.totalPages || 0)
    setInvTotal(data?.pagination?.total || 0)
    setInvLoading(false)
  }, [selectedCompanyId, invPage, invLimit, invQuery, invSatStatus, invDateFrom, invDateTo, columnFilters])

  const fetchAllInvoicesForExport = async () => {
    if (!selectedCompanyId) return []
    const params = new URLSearchParams({
      companyId: selectedCompanyId,
      page: '1',
      limit: '999999',
      export: 'true',
      cfdiType: 'INGRESO,PAGO,EGRESO,TRASLADO',
      origin: 'issued'
    })
    if (invQuery) params.set('query', invQuery)
    if (invSatStatus) params.set('satStatus', invSatStatus)
    if (invDateFrom) params.set('dateFrom', invDateFrom)
    if (invDateTo) params.set('dateTo', invDateTo)
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
      } catch {}
    }
    readSelected()
    const listener = () => readSelected()
    window.addEventListener('company-selected', listener as EventListener)
    return () => window.removeEventListener('company-selected', listener as EventListener)
  }, [])

  const rangeLabel =
    invDateFrom && invDateTo
      ? `Del ${invDateFrom} al ${invDateTo}`
      : invDateFrom
      ? `Desde ${invDateFrom}`
      : invDateTo
      ? `Hasta ${invDateTo}`
      : 'Todos'
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

  return (
    <ProtectedRoute>
      <div className="flex-1 space-y-4 p-4 md:p-6 pt-6">
        <div className="flex items-center space-x-2">
          <h2 className="text-3xl font-bold tracking-tight">Reporte de Ingresos</h2>
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
            <div className="grid gap-3 md:grid-cols-5 items-end">
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">Estatus</span>
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
                <span className="text-xs font-medium text-muted-foreground">Fecha desde</span>
                <Input type="date" placeholder="Fecha desde" value={invDateFrom} onChange={(e) => setInvDateFrom(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">Fecha hasta</span>
                <Input type="date" placeholder="Fecha hasta" value={invDateTo} onChange={(e) => setInvDateTo(e.target.value)} />
              </div>
              <Button 
                onClick={() => { setInvPage(1); fetchInvoices() }}
                className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-md hover:shadow-lg rounded-full px-6"
              >
                Aplicar
              </Button>
              <Button 
                onClick={() => {
                  setInvQuery('')
                  setInvSatStatus('')
                  setInvDateFrom('')
                  setInvDateTo('')
                  setColumnFilters({})
                  setInvLimit(20)
                  setInvPage(1)
                  fetchInvoices()
                }}
                className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-md hover:shadow-lg rounded-full px-6"
              >
                Limpiar filtros
              </Button>
            </div>
            <div className="flex gap-3 mt-3 flex-wrap">
              <Button 
                variant="outline" 
                onClick={async () => {
                  const selectedCols = columnDefs
                    .filter(c => visibleCols.has(c.key))
                    .sort((a, b) => columnOrder.indexOf(a.key) - columnOrder.indexOf(b.key))
                  const headers = selectedCols.map(c => c.label)
                  
                  const allData = await fetchAllInvoicesForExport()
                  const rows = allData.map((r: InvoiceRow) =>
                    selectedCols.map(c => exportValue(r, c.key))
                  )
                  
                  // Totales
                  const numCols = ['subtotal', 'discount', 'total', 'totalImpuestosTrasladados', 'totalImpuestosRetenidos']
                  const totalsRow = selectedCols.map((c, idx) => {
                    if (idx === 0) return 'TOTAL'
                    if (numCols.includes(c.key)) {
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
                    const v = val.replace(/"/g, '""')
                    return needsQuotes ? `"${v}"` : v
                  }
                  const csv = [headers, ...rows, totalsRow].map(r => r.map((x: unknown) => escape(String(x))).join(',')).join('\n')
                  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `cfdis_emitidos_${selectedCompany?.rfc || 'empresa'}.csv`
                  document.body.appendChild(a)
                  a.click()
                  document.body.removeChild(a)
                  URL.revokeObjectURL(url)
                }}
                className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-md hover:shadow-lg rounded-full px-6"
              >
                Exportar CSV
              </Button>
              <Button 
                variant="outline" 
                onClick={async () => {
                  const selectedCols = columnDefs
                    .filter(c => visibleCols.has(c.key))
                    .sort((a, b) => columnOrder.indexOf(a.key) - columnOrder.indexOf(b.key))
                  const headers = selectedCols.map(c => c.label)
                  
                  const allData = await fetchAllInvoicesForExport()
                  
                  const escapeXml = (s: string) =>
                    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;')
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
                  
                  // Totales
                  const numCols = ['subtotal', 'discount', 'total', 'totalImpuestosTrasladados', 'totalImpuestosRetenidos']
                  const totalsCells = selectedCols.map((c, idx) => {
                    if (idx === 0) return toCell('TOTAL', 'String')
                    if (numCols.includes(c.key)) {
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
                  document.body.removeChild(a)
                  URL.revokeObjectURL(url)
                }}
                className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-md hover:shadow-lg rounded-full px-6"
              >
                Exportar Excel
              </Button>
              <Button 
                variant="outline" 
                disabled={selectedInvoices.size === 0 || isZipLoading}
                onClick={async () => {
                  if (selectedInvoices.size === 0) return
                  setIsZipLoading(true)
                  try {
                    const zip = new JSZip()
                    for (const [id, data] of Array.from(selectedInvoices.entries())) {
                      // Agregar XML
                      if (data.xmlContent) {
                        zip.file(`cfdi_${data.uuid}.xml`, data.xmlContent)
                      }
                      // Fetch y agregar PDF
                      try {
                        const pdfRes = await fetch(`/api/invoices/${id}/pdf`)
                        if (pdfRes.ok) {
                          const pdfBlob = await pdfRes.blob()
                          zip.file(`cfdi_${data.uuid}.pdf`, pdfBlob)
                        } else {
                          console.error(`Error al descargar PDF para UUID ${data.uuid}`)
                        }
                      } catch (err) {
                        console.error(`Excepción al descargar PDF para UUID ${data.uuid}`, err)
                      }
                    }
                    const content = await zip.generateAsync({ type: 'blob' })
                    const url = URL.createObjectURL(content)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = `cfdis_seleccionados_${selectedCompany?.rfc || 'empresa'}.zip`
                    document.body.appendChild(a)
                    a.click()
                    document.body.removeChild(a)
                    URL.revokeObjectURL(url)
                  } finally {
                    setIsZipLoading(false)
                  }
                }}
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
                        const basic = new Set(['issuerRfc', 'receiverRfc', 'receiverName', 'series', 'folio', 'uuid', 'subtotal', 'totalImpuestosTrasladados', 'totalImpuestosRetenidos', 'discount', 'total'])
                        setVisibleCols(basic)
                        persistVisibleColumns(Array.from(basic))
                        
                        const order = ['issuerRfc', 'receiverRfc', 'receiverName', 'series', 'folio', 'uuid', 'subtotal', 'totalImpuestosTrasladados', 'totalImpuestosRetenidos', 'discount', 'total']
                        const known = columnDefs.map(c => c.key)
                        const missing = known.filter(k => !order.includes(k))
                        const newOrder = [...order, ...missing]
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
                      const order = ['<cfdi:Comprobante>', '<cfdi:CfdiRelacionados>', '<cfdi:Emisor>', '<cfdi:Receptor>', '<cfdi:Conceptos>', '<cfdi:Impuestos>', '<tfd:TimbreFiscalDigital>', 'Sistema / Metadatos']
                      const posA = order.indexOf(a)
                      const posB = order.indexOf(b)
                      return (posA === -1 ? 999 : posA) - (posB === -1 ? 999 : posB)
                    })
                    .map(([groupName, cols]) => {
                      if (groupName === '<cfdi:Conceptos>') {
                        const isChecked = visibleCols.has('show_conceptos')
                        return (
                          <div key={groupName} className="space-y-2">
                            <h4 className="text-xs font-semibold text-primary tracking-wider border-b pb-1 flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={(e) => {
                                  const next = new Set(visibleCols)
                                  if (e.target.checked) {
                                    next.add('show_conceptos')
                                  } else {
                                    next.delete('show_conceptos')
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
                    {invLoading ? (
                      <tr><td className="px-2 py-3 text-center" colSpan={visibleCols.size + 2}>Cargando...</td></tr>
                    ) : invRows.length === 0 ? (
                      <tr><td className="px-2 py-3 text-center" colSpan={visibleCols.size + 2}>Sin resultados</td></tr>
                    ) : (
                      invRows.map((r) => (
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
                              {visibleCols.has('show_conceptos') && (
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
                                    const xml = String(r.xmlContent || '')
                                    if (!xml) return
                                    const blob = new Blob([xml], { type: 'application/xml;charset=utf-8;' })
                                    const url = URL.createObjectURL(blob)
                                    const a = document.createElement('a')
                                    a.href = url
                                    a.download = `cfdi_${r.uuid || 'cfdi'}.xml`
                                    document.body.appendChild(a)
                                    a.click()
                                    document.body.removeChild(a)
                                    URL.revokeObjectURL(url)
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
                                      a.href = `/api/invoices/${r.id}/pdf`
                                      a.target = '_blank'
                                      document.body.appendChild(a)
                                      a.click()
                                      document.body.removeChild(a)
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
                          {expandedRows.has(r.id) && visibleCols.has('show_conceptos') && (
                            <tr className="bg-muted/10 border-b">
                              <td colSpan={Array.from(visibleCols).filter(k => k !== 'show_conceptos').length + 2}>
                                <ConceptosTable xml={r.xmlContent} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))
                    )}
                  </tbody>
                  {invRows.length > 0 && !invLoading && (
                    <tfoot className="bg-muted/50 border-t font-bold">
                      <tr>
                        <td></td>
                        {columnDefs
                          .filter(c => visibleCols.has(c.key))
                          .sort((a, b) => columnOrder.indexOf(a.key) - columnOrder.indexOf(b.key))
                          .map((c, idx) => {
                            const sumKeys = ['subtotal', 'discount', 'total', 'totalImpuestosTrasladados', 'totalImpuestosRetenidos']
                            if (sumKeys.includes(c.key)) {
                              const sum = invRows.reduce((acc, r) => {
                                let val = 0
                                if (c.key === 'totalImpuestosTrasladados') {
                                  val = Number(getGlobalImpuestosAttribute(r.xmlContent, 'TotalImpuestosTrasladados')) || 0
                                } else if (c.key === 'totalImpuestosRetenidos') {
                                  val = Number(getGlobalImpuestosAttribute(r.xmlContent, 'TotalImpuestosRetenidos')) || 0
                                } else {
                                  val = Number(r[c.key as keyof InvoiceRow]) || 0
                                }
                                return acc + val
                              }, 0)
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
