'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from '@/components/ui/badge'
import { format } from 'date-fns'
import { Loader2, ChevronDown, ChevronRight, FileText, Download } from 'lucide-react'

type PaymentDetail = {
  paymentUuid: string
  paymentDate: string
  paymentSeries: string | null
  paymentFolio: string | null
  impPagado: number
  monedaDR: string
  equivalenciaDR: number
  numParcialidad: number
  impSaldoAnt: number
  impSaldoInsoluto: number
  formaDePagoP: string
  monedaP: string
}

type PartialIncomeInvoice = {
  id: string
  uuid: string
  series: string | null
  folio: string | null
  issuerRfc: string
  issuerName: string
  receiverRfc: string
  receiverName: string
  total: number
  currency: string
  exchangeRate: number | null
  issuanceDate: string
  totalPaid: number
  saldoInsoluto: number
  isPaid: boolean
  payments: PaymentDetail[]
}

type KPIs = {
  totalSaldoInsolutoMXN: number
  totalPorCobrarMXN: number
  count: number
  countPaid: number
  countPending: number
}

type SelectedCompany = { id: string; rfc?: string; businessName?: string; name?: string }

const formatCurrency = (value: number, currency: string = 'MXN') => {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2
  }).format(value)
}

export default function PartialIncomePage() {
  const [selectedCompany, setSelectedCompany] = useState<SelectedCompany | null>(null)
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  
  const [paymentDateFrom, setPaymentDateFrom] = useState<string>('')
  const [paymentDateTo, setPaymentDateTo] = useState<string>('')
  const [incomeCurrency, setIncomeCurrency] = useState<string>('ALL')
  const [paymentCurrency, setPaymentCurrency] = useState<string>('ALL')
  const [cfdiClassification, setCfdiClassification] = useState<string>('issued')

  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<PartialIncomeInvoice[]>([])
  const [kpis, setKpis] = useState<KPIs | null>(null)
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({})
  const [filters, setFilters] = useState({
    date: '',
    series: '',
    uuid: '',
    rfc: '',
    client: '',
    total: '',
    paid: '',
    balance: '',
    currency: '',
    status: ''
  })

  const handleFilterChange = (key: string, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }))
  }

  const getCounterparty = (invoice: PartialIncomeInvoice) => {
    if (cfdiClassification === 'received') {
      return { rfc: invoice.issuerRfc, name: invoice.issuerName }
    }
    if (cfdiClassification === 'issued') {
      return { rfc: invoice.receiverRfc, name: invoice.receiverName }
    }
    // For both, if I am the issuer, show receiver. Else show issuer.
    if (selectedCompany?.rfc === invoice.issuerRfc) {
       return { rfc: invoice.receiverRfc, name: invoice.receiverName }
    }
    return { rfc: invoice.issuerRfc, name: invoice.issuerName }
  }

  const filteredData = data.filter(invoice => {
    const match = (val: unknown, filter: string) => {
      if (!filter) return true
      return String(val).toLowerCase().includes(filter.toLowerCase())
    }
    
    const formattedDate = format(new Date(invoice.issuanceDate), 'dd/MM/yyyy')
    const fullSeries = `${invoice.series || ''}-${invoice.folio || ''}`
    const statusText = invoice.isPaid ? "Pagado" : "Pendiente"
    const counterparty = getCounterparty(invoice)

    return (
      match(formattedDate, filters.date) &&
      match(fullSeries, filters.series) &&
      match(invoice.uuid, filters.uuid) &&
      match(counterparty.rfc, filters.rfc) &&
      match(counterparty.name, filters.client) &&
      match(invoice.total, filters.total) &&
      match(invoice.totalPaid, filters.paid) &&
      match(invoice.saldoInsoluto, filters.balance) &&
      match(invoice.currency, filters.currency) &&
      match(statusText, filters.status)
    )
  })

  // Initialize dates to current month if empty
  useEffect(() => {
    const now = new Date()
    // Set to 2 months ago to include recent history by default
    const firstDay = new Date(now.getFullYear(), now.getMonth() - 2, 1)
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    setDateFrom(firstDay.toISOString().split('T')[0])
    setDateTo(lastDay.toISOString().split('T')[0])
  }, [])

  // Load selected company from localStorage and listen for changes
  useEffect(() => {
    const loadCompany = () => {
      const stored = localStorage.getItem('selectedCompany')
      if (stored) {
        try {
          const company = JSON.parse(stored)
          setSelectedCompany(company)
        } catch (e) {
          console.error('Error parsing selectedCompany', e)
        }
      }
    }

    loadCompany()

    const handleCompanyChange = () => {
      loadCompany()
    }

    window.addEventListener('company-selected', handleCompanyChange)
    document.addEventListener('company-selected', handleCompanyChange)

    return () => {
      window.removeEventListener('company-selected', handleCompanyChange)
      document.removeEventListener('company-selected', handleCompanyChange)
    }
  }, [])

  const fetchData = useCallback(async () => {
    if (!selectedCompany?.rfc || !dateFrom || !dateTo) return

    setLoading(true)
    try {
      const params = new URLSearchParams({
        startDate: dateFrom,
        endDate: dateTo,
        rfc: selectedCompany.rfc,
        paymentDateStart: paymentDateFrom,
        paymentDateEnd: paymentDateTo,
        incomeCurrency,
        paymentCurrency,
        classification: cfdiClassification
      })
      
      const res = await fetch(`/api/dashboard_fiscal/ingresos-parciales?${params}`)
      if (!res.ok) throw new Error('Error fetching data')
      
      const result = await res.json()
      setData(result.data)
      setKpis(result.kpis)
    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
    }
  }, [selectedCompany, dateFrom, dateTo, paymentDateFrom, paymentDateTo, incomeCurrency, paymentCurrency, cfdiClassification])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const toggleRow = (uuid: string) => {
    setExpandedRows(prev => ({
      ...prev,
      [uuid]: !prev[uuid]
    }))
  }

  const handleDownload = (uuid: string) => {
    window.open(`/api/dashboard_fiscal/ingresos-parciales/download?uuid=${uuid}`, '_blank')
  }

  const handleExportCSV = () => {
    if (data.length === 0) return
  
    const headers = [
      'UUID Factura', 'Fecha', 'Serie', 'Folio', 
      cfdiClassification === 'received' ? 'RFC Emisor' : (cfdiClassification === 'both' ? 'RFC Contraparte' : 'RFC Receptor'),
      cfdiClassification === 'received' ? 'Proveedor' : (cfdiClassification === 'both' ? 'Contraparte' : 'Cliente'),
      'Total Original', 'Total Pagado', 'Saldo Insoluto', 'Moneda', 'Estatus',
      'UUID Pago', 'Fecha Pago', 'Monto Pagado', 'Moneda Pago', 'Tipo Cambio', 'Saldo Anterior', 'Saldo Insoluto Pago', 'Parcialidad', 'Metodo Pago'
    ]
  
    const rows: string[][] = []
    
    data.forEach(inv => {
      const counterparty = getCounterparty(inv)
      const invData = [
        inv.uuid,
        format(new Date(inv.issuanceDate), 'dd/MM/yyyy'),
        inv.series || '',
        inv.folio || '',
        counterparty.rfc,
        counterparty.name,
        inv.total.toFixed(2),
        inv.totalPaid.toFixed(2),
        inv.saldoInsoluto.toFixed(2),
        inv.currency,
        inv.isPaid ? 'Pagado' : 'Pendiente'
      ]
  
      if (inv.payments.length === 0) {
        rows.push([...invData, '', '', '', '', '', '', '', '', ''])
      } else {
        inv.payments.forEach(pay => {
          const payData = [
            pay.paymentUuid,
            format(new Date(pay.paymentDate), 'dd/MM/yyyy'),
            pay.impPagado.toFixed(2),
            pay.monedaP || pay.monedaDR, // Fallback if missing
            pay.equivalenciaDR.toString(),
            pay.impSaldoAnt.toFixed(2),
            pay.impSaldoInsoluto.toFixed(2),
            pay.numParcialidad.toString(),
            pay.formaDePagoP || ''
          ]
          rows.push([...invData, ...payData])
        })
      }
    })
  
    const csvContent = [
      headers.join(','),
      ...rows.map(r => r.map(c => `"${c}"`).join(','))
    ].join('\n')
  
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `reporte_ppd_${format(new Date(), 'yyyyMMdd')}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Ingresos parcialmente pagados</h2>
            <p className="text-muted-foreground">
              Gestión de facturas PPD y saldos pendientes
              {selectedCompany && ` · ${selectedCompany.businessName || selectedCompany.name}`}
            </p>
          </div>
          
          <Button onClick={fetchData} disabled={loading} size="sm">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Actualizar'}
          </Button>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 p-4 border rounded-lg bg-card shadow-sm">
          {/* CFDI Classification */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Clasificación de CFDI</label>
            <Select value={cfdiClassification} onValueChange={setCfdiClassification}>
              <SelectTrigger className="h-8 w-full">
                <SelectValue placeholder="Seleccionar" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="issued">Emitidos</SelectItem>
                <SelectItem value="received">Recibidos</SelectItem>
                <SelectItem value="both">Ambos</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Invoice Date */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Fecha Emisión (Factura)</label>
            <div className="flex items-center gap-2">
              <Input 
                type="date" 
                value={dateFrom} 
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-8 text-xs"
              />
              <span className="text-muted-foreground">-</span>
              <Input 
                type="date" 
                value={dateTo} 
                onChange={(e) => setDateTo(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          </div>

          {/* Payment Date */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Fecha Pago (REP)</label>
            <div className="flex items-center gap-2">
              <Input 
                type="date" 
                value={paymentDateFrom} 
                onChange={(e) => setPaymentDateFrom(e.target.value)}
                className="h-8 text-xs"
                placeholder="Inicio"
              />
              <span className="text-muted-foreground">-</span>
              <Input 
                type="date" 
                value={paymentDateTo} 
                onChange={(e) => setPaymentDateTo(e.target.value)}
                className="h-8 text-xs"
                placeholder="Fin"
              />
            </div>
          </div>

          {/* Income Currency */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Moneda Factura</label>
            <Select value={incomeCurrency} onValueChange={setIncomeCurrency}>
              <SelectTrigger className="h-8 w-full">
                <SelectValue placeholder="Todas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todas</SelectItem>
                <SelectItem value="MXN">MXN - Peso Mexicano</SelectItem>
                <SelectItem value="USD">USD - Dólar Americano</SelectItem>
                <SelectItem value="EUR">EUR - Euro</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Payment Currency */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Moneda Pago</label>
            <Select value={paymentCurrency} onValueChange={setPaymentCurrency}>
              <SelectTrigger className="h-8 w-full">
                <SelectValue placeholder="Todas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todas</SelectItem>
                <SelectItem value="MXN">MXN - Peso Mexicano</SelectItem>
                <SelectItem value="USD">USD - Dólar Americano</SelectItem>
                <SelectItem value="EUR">EUR - Euro</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Saldo Insoluto (MXN)</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-500">
              {kpis ? formatCurrency(kpis.totalSaldoInsolutoMXN) : '$0.00'}
            </div>
            <p className="text-xs text-muted-foreground">
              Suma de saldos pendientes convertidos a MXN
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total por Cobrar (Bruto)</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {kpis ? formatCurrency(kpis.totalPorCobrarMXN) : '$0.00'}
            </div>
            <p className="text-xs text-muted-foreground">
              Valor total de facturas no liquidadas
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Facturas Pendientes</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{kpis?.countPending || 0}</div>
            <p className="text-xs text-muted-foreground">
              De un total de {kpis?.count || 0} facturas PPD
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Facturas Liquidadas</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{kpis?.countPaid || 0}</div>
            <p className="text-xs text-muted-foreground">
              Pagadas al 100%
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Detalle de Facturas PPD</CardTitle>
          <Button onClick={handleExportCSV} variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            Descargar reporte
          </Button>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px]"></TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Serie/Folio</TableHead>
                  <TableHead>UUID</TableHead>
                  <TableHead>{cfdiClassification === 'received' ? 'RFC Emisor' : (cfdiClassification === 'both' ? 'RFC Contraparte' : 'RFC Receptor')}</TableHead>
                  <TableHead>{cfdiClassification === 'received' ? 'Proveedor' : (cfdiClassification === 'both' ? 'Contraparte' : 'Cliente')}</TableHead>
                  <TableHead className="text-right">Total Original</TableHead>
                  <TableHead className="text-right">Total Pagado</TableHead>
                  <TableHead className="text-right">Saldo Insoluto</TableHead>
                  <TableHead>Moneda</TableHead>
                  <TableHead>Estatus</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
                <TableRow>
                  <TableHead></TableHead>
                  <TableHead><Input placeholder="Filtrar..." value={filters.date} onChange={e => handleFilterChange('date', e.target.value)} className="h-8 w-full min-w-[80px]" /></TableHead>
                  <TableHead><Input placeholder="Filtrar..." value={filters.series} onChange={e => handleFilterChange('series', e.target.value)} className="h-8 w-full min-w-[80px]" /></TableHead>
                  <TableHead><Input placeholder="Filtrar..." value={filters.uuid} onChange={e => handleFilterChange('uuid', e.target.value)} className="h-8 w-full min-w-[80px]" /></TableHead>
                  <TableHead><Input placeholder="Filtrar..." value={filters.rfc} onChange={e => handleFilterChange('rfc', e.target.value)} className="h-8 w-full min-w-[80px]" /></TableHead>
                  <TableHead><Input placeholder="Filtrar..." value={filters.client} onChange={e => handleFilterChange('client', e.target.value)} className="h-8 w-full min-w-[80px]" /></TableHead>
                  <TableHead><Input placeholder="Filtrar..." value={filters.total} onChange={e => handleFilterChange('total', e.target.value)} className="h-8 w-full min-w-[80px]" /></TableHead>
                  <TableHead><Input placeholder="Filtrar..." value={filters.paid} onChange={e => handleFilterChange('paid', e.target.value)} className="h-8 w-full min-w-[80px]" /></TableHead>
                  <TableHead><Input placeholder="Filtrar..." value={filters.balance} onChange={e => handleFilterChange('balance', e.target.value)} className="h-8 w-full min-w-[80px]" /></TableHead>
                  <TableHead><Input placeholder="Filtrar..." value={filters.currency} onChange={e => handleFilterChange('currency', e.target.value)} className="h-8 w-full min-w-[60px]" /></TableHead>
                  <TableHead><Input placeholder="Filtrar..." value={filters.status} onChange={e => handleFilterChange('status', e.target.value)} className="h-8 w-full min-w-[80px]" /></TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={12} className="h-24 text-center">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                    </TableCell>
                  </TableRow>
                ) : filteredData.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={12} className="h-24 text-center">
                      No se encontraron resultados
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredData.map((invoice) => (
                    <React.Fragment key={invoice.uuid}>
                      <TableRow className={expandedRows[invoice.uuid] ? "bg-muted/50" : ""}>
                        <TableCell>
                          <Button variant="ghost" size="sm" onClick={() => toggleRow(invoice.uuid)}>
                            {expandedRows[invoice.uuid] ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </Button>
                        </TableCell>
                        <TableCell>{format(new Date(invoice.issuanceDate), 'dd/MM/yyyy')}</TableCell>
                        <TableCell>{invoice.series}-{invoice.folio}</TableCell>
                        <TableCell className="font-mono text-xs whitespace-nowrap" title={invoice.uuid}>
                          {invoice.uuid}
                        </TableCell>
                        <TableCell className="text-xs font-mono">
                          {getCounterparty(invoice).rfc}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate" title={getCounterparty(invoice).name}>
                          {getCounterparty(invoice).name}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(invoice.total, invoice.currency)}
                        </TableCell>
                        <TableCell className="text-right text-green-600">
                          {formatCurrency(invoice.totalPaid, invoice.currency)}
                        </TableCell>
                        <TableCell className={`text-right font-bold ${invoice.saldoInsoluto > 0.01 ? 'text-red-500' : 'text-gray-500'}`}>
                          {formatCurrency(invoice.saldoInsoluto, invoice.currency)}
                        </TableCell>
                        <TableCell>{invoice.currency}</TableCell>
                        <TableCell>
                          <Badge variant={invoice.isPaid ? "default" : "destructive"}>
                            {invoice.isPaid ? "Pagado" : "Pendiente"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" title="Descargar XMLs" onClick={() => handleDownload(invoice.uuid)}>
                            <Download className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                      {expandedRows[invoice.uuid] && (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={12} className="p-0">
                            <div className="p-4 pl-12 space-y-2 overflow-x-auto">
                              <h4 className="text-sm font-semibold mb-2">Desglose de Pagos (REPs)</h4>
                              {invoice.payments.length > 0 ? (
                                <Table>
                                  <TableHeader>
                                    <TableRow className="h-8">
                                      <TableHead className="text-xs whitespace-nowrap">Fecha Pago</TableHead>
                                      <TableHead className="text-xs whitespace-nowrap">UUID Pago</TableHead>
                                      <TableHead className="text-xs whitespace-nowrap">Método Pago</TableHead>
                                      <TableHead className="text-xs text-right whitespace-nowrap">Monto Pagado</TableHead>
                                      <TableHead className="text-xs whitespace-nowrap">Moneda Pago</TableHead>
                                      <TableHead className="text-xs text-right whitespace-nowrap">T. Cambio (DR)</TableHead>
                                      <TableHead className="text-xs text-right whitespace-nowrap">Saldo Anterior</TableHead>
                                      <TableHead className="text-xs text-right whitespace-nowrap">Saldo Insoluto (REP)</TableHead>
                                      <TableHead className="text-xs text-center whitespace-nowrap">Parcialidad</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {invoice.payments.map((payment, idx) => (
                                      <TableRow key={`${invoice.uuid}-pay-${idx}`} className="h-8">
                                        <TableCell className="text-xs py-1 whitespace-nowrap">
                                          {format(new Date(payment.paymentDate), 'dd/MM/yyyy')}
                                        </TableCell>
                                        <TableCell className="text-xs py-1 font-mono whitespace-nowrap">
                                          {payment.paymentUuid}
                                        </TableCell>
                                        <TableCell className="text-xs py-1 text-center">
                                          {payment.formaDePagoP}
                                        </TableCell>
                                        <TableCell className="text-xs py-1 text-right font-medium">
                                          {formatCurrency(payment.impPagado, payment.monedaDR)}
                                        </TableCell>
                                        <TableCell className="text-xs py-1">{payment.monedaDR}</TableCell>
                                        <TableCell className="text-xs py-1 text-right">
                                          {payment.equivalenciaDR}
                                        </TableCell>
                                        <TableCell className="text-xs py-1 text-right text-muted-foreground">
                                          {formatCurrency(payment.impSaldoAnt, payment.monedaDR)}
                                        </TableCell>
                                        <TableCell className="text-xs py-1 text-right text-muted-foreground">
                                          {formatCurrency(payment.impSaldoInsoluto, payment.monedaDR)}
                                        </TableCell>
                                        <TableCell className="text-xs py-1 text-center">
                                          {payment.numParcialidad}
                                        </TableCell>
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
                    </React.Fragment>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
