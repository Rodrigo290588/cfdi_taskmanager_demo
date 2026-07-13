'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, FileCode, FileText, Loader2, RefreshCw, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { ProtectedRoute } from '@/components/protected-route'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useTenant } from '@/hooks/use-tenant'
import { MAX_PROVIDER_CFDI_UPLOAD } from '@/lib/provider-cfdi-report.constants'

type ProviderReportPaymentDetail = {
  paymentUuid: string
  paymentDate: string
  paymentSeries: string | null
  paymentFolio: string | null
  montoPagado: number
  montoTotalPagos: number
  monedaPago: string
  equivalenciaDR: number
  numParcialidad: number
  impSaldoAnt: number
  impSaldoInsoluto: number
}

type ProviderReportRow = {
  id: string
  storageId: string
  fileName: string
  receptorRfc: string
  providerId: string
  emisorRfc: string
  emisorNombre: string
  tipoComprobante: string
  serie: string
  folio: string
  uuid: string
  fechaComprobante: string
  fechaRecepcion: string
  metodoPago: string
  estatusPago: string
  fechaPago: string
  subtotal: number
  totalImpuestosTrasladados: number
  totalImpuestosRetenidos: number
  descuento: number
  total: number
  montoPago: number
  monedaPago: string
  totalOriginal: number
  totalPagado: number
  saldoPorCobrar: number
  moneda: string
  estatus: string
  satCodigoEstatus: string
  satEstado: string
  satEsCancelable: string
  satEstatusCancelacion: string
  satValidacionEFOS: string
  payments: ProviderReportPaymentDetail[]
}

type ProviderContext = {
  memberId: string
  organizationId: string
  providerRfc: string
  providerName: string | null
  allowedCompanies: Array<{
    id: string
    rfc: string
    businessName: string
  }>
}

type MemberModuleFlags = {
  granularPermissions?: Record<string, boolean>
}

type ProviderColumnKey =
  | 'receptorRfc'
  | 'providerId'
  | 'emisorRfc'
  | 'emisorNombre'
  | 'tipoComprobante'
  | 'serie'
  | 'folio'
  | 'uuid'
  | 'fechaComprobante'
  | 'fechaRecepcion'
  | 'metodoPago'
  | 'estatusPago'
  | 'fechaPago'
  | 'subtotal'
  | 'totalImpuestosTrasladados'
  | 'totalImpuestosRetenidos'
  | 'descuento'
  | 'total'
  | 'totalOriginal'
  | 'totalPagado'
  | 'saldoPorCobrar'
  | 'moneda'
  | 'estatus'
  | 'satCodigoEstatus'
  | 'satEstado'
  | 'satEsCancelable'
  | 'satEstatusCancelacion'
  | 'satValidacionEFOS'

const providerColumnDefinitions: Array<{
  key: ProviderColumnKey
  label: string
  align?: 'left' | 'center' | 'right'
}> = [
  { key: 'receptorRfc', label: 'RFC del receptor' },
  { key: 'providerId', label: 'ID Proveedor' },
  { key: 'emisorRfc', label: 'RFC del Emisor' },
  { key: 'emisorNombre', label: 'Nombre Emisor' },
  { key: 'tipoComprobante', label: 'Tipo de comprobante' },
  { key: 'serie', label: 'Serie' },
  { key: 'folio', label: 'Folio' },
  { key: 'uuid', label: 'UUID' },
  { key: 'fechaComprobante', label: 'Fecha de Comprobante' },
  { key: 'fechaRecepcion', label: 'Fecha de recepción del comprobante' },
  { key: 'metodoPago', label: 'Método de Pago' },
  { key: 'estatusPago', label: 'Estatus de Pago' },
  { key: 'fechaPago', label: 'Fecha de pago' },
  { key: 'subtotal', label: 'Subtotal', align: 'right' },
  { key: 'totalImpuestosTrasladados', label: 'Total de impuestos trasladados', align: 'right' },
  { key: 'totalImpuestosRetenidos', label: 'Total Impuestos Retenidos', align: 'right' },
  { key: 'descuento', label: 'Descuento', align: 'right' },
  { key: 'total', label: 'Total', align: 'right' },
  { key: 'totalOriginal', label: 'Total Original', align: 'right' },
  { key: 'totalPagado', label: 'Total Pagado', align: 'right' },
  { key: 'saldoPorCobrar', label: 'Saldo por cobrar', align: 'right' },
  { key: 'moneda', label: 'Moneda' },
  { key: 'estatus', label: 'Estatus' },
  { key: 'satCodigoEstatus', label: 'SAT CodigoEstatus' },
  { key: 'satEstado', label: 'SAT Estado' },
  { key: 'satEsCancelable', label: 'SAT EsCancelable' },
  { key: 'satEstatusCancelacion', label: 'SAT EstatusCancelacion' },
  { key: 'satValidacionEFOS', label: 'SAT ValidacionEFOS' }
]

const formatCurrency = (value: number, currency: string = 'MXN') =>
  new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: currency || 'MXN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(value || 0))

const formatDateTime = (value: string) => {
  if (!value) return ''

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('es-MX', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(parsed)
}

function formatErrorSectionValue(lines: string[]) {
  return lines.join('\n').trim()
}

function parseRejectedError(error: string) {
  const lines = error
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

  const firstLine = lines[0] || ''
  const separatorIndex = firstLine.indexOf(':')
  const fileName = separatorIndex >= 0 ? firstLine.slice(0, separatorIndex).trim() : ''
  const firstContentLine = separatorIndex >= 0 ? firstLine.slice(separatorIndex + 1).trim() : firstLine
  const contentLines = [firstContentLine, ...lines.slice(1)].filter(Boolean)

  const sections = {
    codigoDetectado: '',
    mensajeHumano: '',
    accionCorrectiva: '',
    responsable: '',
    detalleTecnico: ''
  }
  const genericLines: string[] = []

  let currentSection: keyof typeof sections | null = null

  contentLines.forEach(line => {
    if (line.startsWith('Codigo detectado:')) {
      sections.codigoDetectado = line.replace('Codigo detectado:', '').trim()
      currentSection = 'codigoDetectado'
      return
    }

    if (line.startsWith('Como solucionarlo:')) {
      sections.accionCorrectiva = line.replace('Como solucionarlo:', '').trim()
      currentSection = 'accionCorrectiva'
      return
    }

    if (line.startsWith('Responsable:')) {
      sections.responsable = line.replace('Responsable:', '').trim()
      currentSection = 'responsable'
      return
    }

    if (line.startsWith('Detalle tecnico:')) {
      sections.detalleTecnico = line.replace('Detalle tecnico:', '').trim()
      currentSection = 'detalleTecnico'
      return
    }

    if (currentSection === 'accionCorrectiva') {
      sections.accionCorrectiva = formatErrorSectionValue([sections.accionCorrectiva, line].filter(Boolean))
      return
    }

    if (currentSection === 'detalleTecnico') {
      sections.detalleTecnico = formatErrorSectionValue([sections.detalleTecnico, line].filter(Boolean))
      return
    }

    if (currentSection === 'codigoDetectado') {
      sections.mensajeHumano = formatErrorSectionValue([sections.mensajeHumano, line].filter(Boolean))
      currentSection = 'mensajeHumano'
      return
    }

    if (currentSection === 'mensajeHumano') {
      sections.mensajeHumano = formatErrorSectionValue([sections.mensajeHumano, line].filter(Boolean))
      return
    }

    genericLines.push(line)
  })

  if (!sections.mensajeHumano && genericLines.length > 0) {
    sections.mensajeHumano = formatErrorSectionValue(genericLines)
  }

  return {
    fileName: fileName || 'Archivo rechazado',
    ...sections
  }
}

function getRowFilterValue(row: ProviderReportRow, key: ProviderColumnKey) {
  const value = row[key]

  if (typeof value === 'number') {
    return String(value)
  }

  return value || ''
}

function getStatusBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  const normalized = status.trim().toLowerCase()

  if (normalized === 'pagado') return 'default'
  if (normalized === 'parcialmente cobrado') return 'secondary'
  if (normalized === 'pendiente') return 'destructive'

  return 'outline'
}

export default function ProviderCfdisReportPage() {
  const { tenantState, loading: tenantLoading } = useTenant()
  const [providerContext, setProviderContext] = useState<ProviderContext | null>(null)
  const [memberModuleFlags, setMemberModuleFlags] = useState<MemberModuleFlags | null>(null)
  const [contextLoading, setContextLoading] = useState(true)
  const [contextError, setContextError] = useState('')
  const [rows, setRows] = useState<ProviderReportRow[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [columnFilters, setColumnFilters] = useState<Partial<Record<ProviderColumnKey, string>>>({})
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({})
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const loadProviderContext = useCallback(async () => {
    if (tenantLoading) return

    setContextLoading(true)
    setContextError('')

    try {
      const params = new URLSearchParams()
      if (tenantState?.organizationId) {
        params.set('orgId', tenantState.organizationId)
      }

      const response = await fetch(`/api/provider/cfdis-report${params.toString() ? `?${params.toString()}` : ''}`, {
        cache: 'no-store'
      })
      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'No fue posible obtener el contexto del proveedor')
      }

      setProviderContext(result.provider)
      setRows(Array.isArray(result.rows) ? result.rows : [])
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No fue posible obtener el contexto del proveedor'
      setContextError(message)
    } finally {
      setContextLoading(false)
    }
  }, [tenantLoading, tenantState?.organizationId])

  useEffect(() => {
    loadProviderContext()
  }, [loadProviderContext])

  useEffect(() => {
    const loadMemberFlags = async () => {
      try {
        const params = new URLSearchParams()
        if (tenantState?.organizationId) {
          params.set('orgId', tenantState.organizationId)
        }

        const response = await fetch(`/api/user/member${params.toString() ? `?${params.toString()}` : ''}`, {
          cache: 'no-store'
        })
        const result = await response.json()

        if (!response.ok) {
          return
        }

        setMemberModuleFlags({
          granularPermissions: result.member?.granularPermissions || {}
        })
      } catch {}
    }

    if (!tenantLoading) {
      loadMemberFlags()
    }
  }, [tenantLoading, tenantState?.organizationId])

  const filteredRows = useMemo(() => {
    return rows.filter(row =>
      providerColumnDefinitions.every(column => {
        const filterValue = (columnFilters[column.key] || '').trim().toLowerCase()

        if (!filterValue) {
          return true
        }

        return getRowFilterValue(row, column.key).toLowerCase().includes(filterValue)
      })
    )
  }, [rows, columnFilters])

  const totals = useMemo(() => {
    return filteredRows.reduce(
      (acc, row) => {
        acc.totalOriginal += row.totalOriginal
        acc.totalPagado += row.totalPagado
        acc.saldoPorCobrar += row.saldoPorCobrar
        return acc
      },
      { totalOriginal: 0, totalPagado: 0, saldoPorCobrar: 0 }
    )
  }, [filteredRows])

  const canViewProviderBusinessRules = memberModuleFlags?.granularPermissions?.providerBusinessRules !== false
  const canViewProviderBusinessRulePueForma99 = canViewProviderBusinessRules
    && memberModuleFlags?.granularPermissions?.providerBusinessRulePueForma99 !== false
  const canViewProviderBusinessRuleResicoRetention = canViewProviderBusinessRules
    && memberModuleFlags?.granularPermissions?.providerBusinessRuleResicoRetention !== false
  const canViewProviderBusinessRuleObjetoImpVsIva = canViewProviderBusinessRules
    && memberModuleFlags?.granularPermissions?.providerBusinessRuleObjetoImpVsIva !== false

  const openFilePicker = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
      fileInputRef.current.click()
    }
  }

  const toggleRow = (uuid: string) => {
    setExpandedRows(prev => ({
      ...prev,
      [uuid]: !prev[uuid]
    }))
  }

  const downloadXml = (row: ProviderReportRow) => {
    if (!row.storageId) {
      toast.error('No se encontró el XML de la factura')
      return
    }

    const params = new URLSearchParams({ id: row.storageId })
    if (tenantState?.organizationId) {
      params.set('orgId', tenantState.organizationId)
    }
    window.open(`/api/provider/cfdis-report/xml?${params.toString()}`, '_blank', 'noopener,noreferrer')
  }

  const downloadPdf = (row: ProviderReportRow) => {
    try {
      if (!row.storageId) {
        toast.error('No se encontró el CFDI para generar el PDF')
        return
      }

      toast.info('Generando PDF...')
      const params = new URLSearchParams({ id: row.storageId })
      if (tenantState?.organizationId) {
        params.set('orgId', tenantState.organizationId)
      }
      window.open(`/api/provider/cfdis-report/pdf?${params.toString()}`, '_blank', 'noopener,noreferrer')
    } catch (error) {
      console.error('Error generating PDF:', error)
      toast.error('Ocurrió un error al generar el PDF')
    }
  }

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    if (!providerContext) {
      toast.error('Primero se debe cargar el contexto del proveedor')
      return
    }

    setUploading(true)

    try {
      const formData = new FormData()
      if (tenantState?.organizationId) {
        formData.append('orgId', tenantState.organizationId)
      }

      Array.from(files).forEach(file => {
        formData.append('files', file)
      })

      const response = await fetch('/api/provider/cfdis-report', {
        method: 'POST',
        body: formData
      })
      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Error al procesar los CFDI del proveedor')
      }

      setRows(result.rows || [])
      setErrors(result.errors || [])
      setExpandedRows({})

      const validationMessages: string[] = Array.isArray(result.validationMessages)
        ? result.validationMessages.filter((message: unknown): message is string => typeof message === 'string' && message.trim().length > 0)
        : []

      validationMessages.forEach(message => {
        toast.success(message)
      })

      if ((result.summary?.acceptedInvoices || 0) > 0) {
        toast.success(`Se cargaron ${result.summary.acceptedInvoices} factura(s) para el proveedor`)
      }

      if ((result.errors || []).length > 0) {
        const acceptedInvoices = result.summary?.acceptedInvoices || 0
        const rejectedFiles = (result.errors || []).length

        if (acceptedInvoices > 0) {
          toast.error(`Se cargaron ${acceptedInvoices} CFDI, pero ${rejectedFiles} archivo(s) fueron rechazados. Revisa el detalle en "Archivos rechazados".`)
        } else {
          toast.error('No se pudo cargar ningun XML. Revisa el detalle en "Archivos rechazados".')
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error al procesar los CFDI del proveedor')
    } finally {
      setUploading(false)
    }
  }

  return (
    <ProtectedRoute>
      <div className="flex-1 space-y-4 p-4 md:p-6 pt-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex-1 space-y-3">
            {!contextLoading && !contextError && providerContext ? (
              <div className="flex justify-end gap-6 text-sm">
                <div className="text-right">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">RFC del proveedor</p>
                  <p className="font-mono font-semibold text-foreground">{providerContext.providerRfc || 'Sin RFC'}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Nombre del proveedor</p>
                  <p className="font-medium text-foreground">{providerContext.providerName || 'Sin nombre configurado'}</p>
                </div>
              </div>
            ) : null}
            {contextLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Cargando configuración del proveedor...
              </div>
            ) : contextError ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
                {contextError}
              </div>
            ) : null}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Card className="border border-border bg-card">
            <CardHeader className="pb-2">
              <CardDescription>Facturas visibles</CardDescription>
              <CardTitle className="text-2xl">{filteredRows.length}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              Facturas válidas ligadas al RFC del proveedor dentro de la vista actual.
            </CardContent>
          </Card>
          <Card className="border border-border bg-card">
            <CardHeader className="pb-2">
              <CardDescription>Total pagado</CardDescription>
              <CardTitle className="text-2xl">{formatCurrency(totals.totalPagado)}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              Sumatoria de pagos aplicados a las facturas visibles.
            </CardContent>
          </Card>
          <Card className="border border-border bg-card">
            <CardHeader className="pb-2">
              <CardDescription>Saldo por cobrar</CardDescription>
              <CardTitle className="text-2xl">{formatCurrency(totals.saldoPorCobrar)}</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              Resultado de total original menos pagos aplicados en la vista filtrada.
            </CardContent>
          </Card>
        </div>

        {canViewProviderBusinessRules && (
          <Card className="border border-indigo-200 bg-indigo-50/40">
            <CardHeader>
              <CardTitle className="text-base">Coherencia de Datos / Reglas de Negocio</CardTitle>
              <CardDescription>
                Este apartado concentrará las validaciones configurables por cliente para revisar consistencia y reglas de negocio antes o durante la carga de CFDI.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="rounded-md border border-indigo-200/70 bg-background px-4 py-3">
                <p className="font-medium text-foreground">Próximamente</p>
                <p className="mt-1 text-muted-foreground">
                  Aquí aparecerán las reglas activas para tu cliente, su resultado y las acciones correctivas asociadas a cada validación.
                </p>
              </div>
              <div className="rounded-md border border-indigo-200/70 bg-background px-4 py-3">
                <p className="font-medium text-foreground">Reglas hijas activas</p>
                <div className="mt-3 ml-4 space-y-3 border-l border-indigo-200 pl-4">
                  <div className="rounded-md border border-border bg-card px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium text-foreground">Validación del método de pago vs Forma de pago</p>
                        <p className="text-xs text-muted-foreground">
                          Rechaza el CFDI cuando `MetodoPago = PUE` y `FormaPago = 99`, si esta regla hija está habilitada para el proveedor.
                        </p>
                      </div>
                      <Badge variant={canViewProviderBusinessRulePueForma99 ? 'default' : 'outline'}>
                        {canViewProviderBusinessRulePueForma99 ? 'Activa' : 'Inactiva'}
                      </Badge>
                    </div>
                  </div>
                  <div className="rounded-md border border-border bg-card px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium text-foreground">Validación de proveedores del RESICO</p>
                        <p className="text-xs text-muted-foreground">
                          Rechaza el CFDI si el emisor es RESICO (`626`), el receptor es Persona Moral y no se localiza la retención ISR `0.012500`.
                        </p>
                      </div>
                      <Badge variant={canViewProviderBusinessRuleResicoRetention ? 'default' : 'outline'}>
                        {canViewProviderBusinessRuleResicoRetention ? 'Activa' : 'Inactiva'}
                      </Badge>
                    </div>
                  </div>
                  <div className="rounded-md border border-border bg-card px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium text-foreground">Validación de Objeto de Impuesto vs Traslados IVA</p>
                        <p className="text-xs text-muted-foreground">
                          Rechaza el CFDI si `ObjetoImp=02` no trae traslado IVA desglosado, o si `ObjetoImp=01/03` sí trae traslado IVA.
                        </p>
                      </div>
                      <Badge variant={canViewProviderBusinessRuleObjetoImpVsIva ? 'default' : 'outline'}>
                        {canViewProviderBusinessRuleObjetoImpVsIva ? 'Activa' : 'Inactiva'}
                      </Badge>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">Configuración por cliente</Badge>
                <Badge variant="outline">Validaciones antes de carga</Badge>
                <Badge variant="outline">Resultado por regla</Badge>
              </div>
            </CardContent>
          </Card>
        )}

        {errors.length > 0 && (
          <Card className="border-destructive/30">
            <CardHeader>
              <CardTitle className="text-base">Archivos rechazados</CardTitle>
              <CardDescription>
                El sistema muestra los motivos de rechazo detectados durante la validación de XML o ZIP.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {errors.slice(0, 10).map((error, index) => (
                (() => {
                  const parsedError = parseRejectedError(error)

                  return (
                    <div key={`${error}-${index}`} className="rounded-md border border-destructive/20 bg-destructive/5 px-4 py-3 break-words">
                      <div className="space-y-3">
                        <div className="flex flex-col gap-1 md:flex-row md:items-start md:justify-between">
                          <div>
                            <p className="text-xs uppercase tracking-wide text-destructive/80">Archivo</p>
                            <p className="font-medium text-foreground">{parsedError.fileName}</p>
                          </div>
                          {parsedError.codigoDetectado ? (
                            <Badge variant="destructive" className="w-fit font-mono">
                              {parsedError.codigoDetectado}
                            </Badge>
                          ) : null}
                        </div>

                        {parsedError.mensajeHumano ? (
                          <div className="space-y-1">
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">Diagnóstico</p>
                            <p className="leading-6 text-foreground">{parsedError.mensajeHumano}</p>
                          </div>
                        ) : null}

                        {parsedError.accionCorrectiva ? (
                          <div className="space-y-1 rounded-md border border-amber-200/60 bg-amber-50/70 px-3 py-2 text-amber-950">
                            <p className="text-xs uppercase tracking-wide text-amber-800">Cómo solucionarlo</p>
                            <p className="leading-6">{parsedError.accionCorrectiva}</p>
                          </div>
                        ) : null}

                        <div className="flex flex-wrap gap-2">
                          {parsedError.responsable ? (
                            <Badge variant="outline">
                              Responsable: {parsedError.responsable}
                            </Badge>
                          ) : null}
                        </div>

                        {parsedError.detalleTecnico ? (
                          <details className="rounded-md border border-border/70 bg-background/70 px-3 py-2">
                            <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              Ver detalle técnico
                            </summary>
                            <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs leading-5 text-muted-foreground">
                              {parsedError.detalleTecnico}
                            </pre>
                          </details>
                        ) : null}
                      </div>
                    </div>
                  )
                })()
              ))}
              {errors.length > 10 && (
                <p className="text-xs text-muted-foreground">Se muestran los primeros 10 errores de {errors.length} detectados.</p>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="space-y-1">
              <CardTitle>CFDI del proveedor</CardTitle>
              <CardDescription>
                Carga hasta {MAX_PROVIDER_CFDI_UPLOAD} CFDI por operación en formato XML o ZIP
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={openFilePicker}
                disabled={uploading || contextLoading || !providerContext}
                className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-md hover:shadow-lg rounded-full px-6"
              >
                {uploading ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    Procesando...
                  </>
                ) : (
                  <>
                    <Upload className="mr-2 h-4 w-4" />
                    Cargar XML / ZIP
                  </>
                )}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xml,.zip"
                multiple
                className="hidden"
                onChange={(event) => {
                  handleFiles(event.target.files)
                  event.target.value = ''
                }}
              />
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table className="min-w-[4100px]">
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="w-[50px]"></TableHead>
                    {providerColumnDefinitions.map(column => (
                      <TableHead
                        key={`${column.key}-filter`}
                        className={column.align === 'right' ? 'text-right px-2 py-1 align-top' : 'px-2 py-1 align-top'}
                      >
                        <div className="flex flex-col gap-2">
                          <span className={`select-none font-semibold text-[11px] uppercase text-muted-foreground whitespace-nowrap ${column.align === 'right' ? 'text-right' : 'text-left'}`}>
                            {column.label}
                          </span>
                          <Input
                            placeholder="Filtrar..."
                            className={`h-8 min-w-[120px] border-2 text-xs ${column.align === 'right' ? 'text-right' : ''}`}
                            value={columnFilters[column.key] || ''}
                            onChange={event =>
                              setColumnFilters(prev => ({
                                ...prev,
                                [column.key]: event.target.value
                              }))
                            }
                          />
                        </div>
                      </TableHead>
                    ))}
                    <TableHead className="px-2 py-1 align-top text-center w-24 sticky right-0 bg-background z-10 border-l shadow-[-5px_0_5px_-5px_rgba(0,0,0,0.1)]">
                      <div className="flex flex-col gap-2">
                        <span className="select-none font-semibold text-[11px] uppercase text-muted-foreground whitespace-nowrap">
                          Acciones
                        </span>
                      </div>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contextLoading ? (
                    <TableRow>
                      <TableCell colSpan={providerColumnDefinitions.length + 2} className="h-24 text-center">
                        <Loader2 className="mx-auto h-6 w-6 animate-spin" />
                      </TableCell>
                    </TableRow>
                  ) : filteredRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={providerColumnDefinitions.length + 2} className="h-24 text-center">
                        Carga CFDI válidos del proveedor para visualizar el reporte.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredRows.map(row => (
                      <Fragment key={row.id}>
                        <TableRow key={row.id} className={expandedRows[row.uuid] ? 'bg-muted/50' : ''}>
                          <TableCell>
                            {row.payments.length > 0 ? (
                              <Button variant="ghost" size="sm" onClick={() => toggleRow(row.uuid)}>
                                {expandedRows[row.uuid] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              </Button>
                            ) : null}
                          </TableCell>
                          <TableCell className="font-mono text-xs">{row.receptorRfc}</TableCell>
                          <TableCell className="font-mono text-xs">{row.providerId}</TableCell>
                          <TableCell className="font-mono text-xs">{row.emisorRfc}</TableCell>
                          <TableCell className="max-w-[220px] truncate" title={row.emisorNombre}>{row.emisorNombre || '-'}</TableCell>
                          <TableCell>{row.tipoComprobante}</TableCell>
                          <TableCell>{row.serie || '-'}</TableCell>
                          <TableCell>{row.folio || '-'}</TableCell>
                          <TableCell className="font-mono text-xs" title={row.uuid}>{row.uuid}</TableCell>
                          <TableCell>{formatDateTime(row.fechaComprobante)}</TableCell>
                          <TableCell>{formatDateTime(row.fechaRecepcion)}</TableCell>
                          <TableCell>{row.metodoPago || '-'}</TableCell>
                          <TableCell>{row.estatusPago || '-'}</TableCell>
                          <TableCell>{row.fechaPago ? formatDateTime(row.fechaPago) : '-'}</TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(row.subtotal, row.moneda)}</TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(row.totalImpuestosTrasladados, row.moneda)}</TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(row.totalImpuestosRetenidos, row.moneda)}</TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(row.descuento, row.moneda)}</TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(row.total, row.moneda)}</TableCell>
                          <TableCell className="text-right font-medium">{formatCurrency(row.totalOriginal, row.moneda)}</TableCell>
                          <TableCell className="text-right font-medium text-green-600">{formatCurrency(row.totalPagado, row.moneda)}</TableCell>
                          <TableCell className={`text-right font-bold ${row.saldoPorCobrar > 0.01 ? 'text-red-500' : 'text-gray-500'}`}>
                            {formatCurrency(row.saldoPorCobrar, row.moneda)}
                          </TableCell>
                          <TableCell>{row.moneda || '-'}</TableCell>
                          <TableCell>
                            <Badge variant={getStatusBadgeVariant(row.estatus)}>
                              {row.estatus || 'Sin estatus'}
                            </Badge>
                          </TableCell>
                          <TableCell className="max-w-[260px] whitespace-pre-wrap break-words">{row.satCodigoEstatus || '-'}</TableCell>
                          <TableCell>{row.satEstado || '-'}</TableCell>
                          <TableCell className="max-w-[220px] whitespace-pre-wrap break-words">{row.satEsCancelable || '-'}</TableCell>
                          <TableCell className="max-w-[220px] whitespace-pre-wrap break-words">{row.satEstatusCancelacion || '-'}</TableCell>
                          <TableCell>{row.satValidacionEFOS || '-'}</TableCell>
                          <TableCell className="px-2 py-2 text-center align-middle whitespace-nowrap sticky right-0 bg-background z-10 border-l shadow-[-5px_0_5px_-5px_rgba(0,0,0,0.1)]">
                            <div className="flex justify-center gap-2">
                              <Button
                                variant="outline"
                                size="icon"
                                title="XML"
                                onClick={() => downloadXml(row)}
                              >
                                <FileCode className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="outline"
                                size="icon"
                                title="PDF"
                                onClick={() => downloadPdf(row)}
                                className="text-primary bg-transparent hover:bg-primary hover:text-white shadow-sm size-10"
                              >
                                <FileText className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                        {expandedRows[row.uuid] && (
                          <TableRow className="bg-muted/30 hover:bg-muted/30">
                            <TableCell colSpan={providerColumnDefinitions.length + 2} className="p-0">
                              <div className="p-4 pl-12 space-y-2">
                                <h4 className="text-sm font-semibold mb-2">Desglose de Pagos (REPs)</h4>
                                {row.payments.length > 0 ? (
                                  <Table className="w-auto min-w-0">
                                    <TableHeader>
                                      <TableRow className="h-8">
                                        <TableHead className="text-xs px-2 py-1 w-[120px]">Fecha Pago</TableHead>
                                        <TableHead className="text-xs px-2 py-1 w-[250px]">UUID Pago</TableHead>
                                        <TableHead className="text-xs px-2 py-1 w-[110px] text-right">Monto Pagado</TableHead>
                                        <TableHead className="text-xs px-2 py-1 w-[80px]">Moneda Pago</TableHead>
                                        <TableHead className="text-xs px-2 py-1 w-[90px] text-right">T. Cambio (DR)</TableHead>
                                        <TableHead className="text-xs px-2 py-1 w-[110px] text-right">Saldo Anterior</TableHead>
                                        <TableHead className="text-xs px-2 py-1 w-[130px] text-right">Saldo Insoluto (REP)</TableHead>
                                        <TableHead className="text-xs px-2 py-1 w-[70px] text-center">Parcialidad</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {row.payments.map((payment, index) => (
                                        <TableRow key={`${row.uuid}-payment-${index}`} className="h-8">
                                          <TableCell className="text-xs px-2 py-1 whitespace-nowrap">{formatDateTime(payment.paymentDate)}</TableCell>
                                          <TableCell className="text-xs px-2 py-1 font-mono whitespace-nowrap">{payment.paymentUuid}</TableCell>
                                          <TableCell className="text-xs px-2 py-1 text-right font-medium whitespace-nowrap">
                                            {formatCurrency(payment.montoPagado, payment.monedaPago)}
                                          </TableCell>
                                          <TableCell className="text-xs px-2 py-1 whitespace-nowrap">{payment.monedaPago}</TableCell>
                                          <TableCell className="text-xs px-2 py-1 text-right whitespace-nowrap">{payment.equivalenciaDR}</TableCell>
                                          <TableCell className="text-xs px-2 py-1 text-right text-muted-foreground whitespace-nowrap">
                                            {formatCurrency(payment.impSaldoAnt, row.moneda)}
                                          </TableCell>
                                          <TableCell className="text-xs px-2 py-1 text-right text-muted-foreground whitespace-nowrap">
                                            {formatCurrency(payment.impSaldoInsoluto, row.moneda)}
                                          </TableCell>
                                          <TableCell className="text-xs px-2 py-1 text-center whitespace-nowrap">{payment.numParcialidad}</TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                ) : (
                                  <p className="text-sm text-muted-foreground italic">No hay pagos registrados asociados a esta factura.</p>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </ProtectedRoute>
  )
}
