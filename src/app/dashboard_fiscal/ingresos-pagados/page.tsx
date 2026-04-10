'use client'

import React, { useEffect, useState, useCallback, useMemo } from 'react'
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
// Removed date-fns imports

// Dummy utility to format dates
const format = (date: string | Date, formatStr?: string) => {
  try {
    const d = new Date(date)
    if (formatStr === 'yyyyMMdd') {
      const year = d.getFullYear()
      const month = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      return `${year}${month}${day}`
    }
    return d.toLocaleDateString('es-MX')
  } catch {
    return String(date)
  }
}
import { Loader2, ChevronDown, ChevronRight, FileText, Download, AlertTriangle, CheckCircle, XCircle, TrendingUp } from 'lucide-react'

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
  paymentXml?: string | null
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
  xmlContent?: string
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
  totalCollectedMXN: number
  totalExcessMXN: number
  morosidadPercentage: number
  repsConciliationPercentage: number
}

type SelectedCompany = { id: string; rfc?: string; businessName?: string; name?: string }

const formatCurrency = (value: number, currency: string = 'MXN') => {
  try {
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: currency || 'MXN',
      minimumFractionDigits: 2
    }).format(value)
  } catch {
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: 'MXN',
      minimumFractionDigits: 2
    }).format(value)
  }
}

const formatPercentage = (value: number) => {
  return new Intl.NumberFormat('es-MX', {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  }).format(value / 100)
}

const safeFormatDate = (date: string | Date | null | undefined, formatStr: string = 'dd/MM/yyyy') => {
  if (!date) return ''
  try {
    const d = new Date(date)
    if (isNaN(d.getTime())) return ''
    return format(d, formatStr)
  } catch {
    return ''
  }
}

export default function PaidIncomePage() {
  const [selectedCompany, setSelectedCompany] = useState<SelectedCompany | null>(null)
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  
  const [paymentDateFrom, setPaymentDateFrom] = useState<string>('')
  const [paymentDateTo, setPaymentDateTo] = useState<string>('')
  const [incomeCurrency, setIncomeCurrency] = useState<string>('ALL')
  const [paymentCurrency, setPaymentCurrency] = useState<string>('ALL')

  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<PartialIncomeInvoice[]>([])
  // const [kpis, setKpis] = useState<KPIs | null>(null) // We derive KPIs from data
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

  const filteredData = data.filter(invoice => {
    // Force filtering for only PAID invoices in the table view
    if (!invoice.isPaid) return false

    const match = (val: unknown, filter: string) => {
      if (!filter) return true
      return String(val).toLowerCase().includes(filter.toLowerCase())
    }
    
    const formattedDate = safeFormatDate(invoice.issuanceDate)
    const fullSeries = `${invoice.series || ''}-${invoice.folio || ''}`
    const statusText = invoice.isPaid ? "Pagado" : "Pendiente"

    return (
      match(formattedDate, filters.date) &&
      match(fullSeries, filters.series) &&
      match(invoice.uuid, filters.uuid) &&
      match(invoice.receiverRfc, filters.rfc) &&
      match(invoice.receiverName, filters.client) &&
      match(invoice.total, filters.total) &&
      match(invoice.totalPaid, filters.paid) &&
      match(invoice.saldoInsoluto, filters.balance) &&
      match(invoice.currency, filters.currency) &&
      match(statusText, filters.status)
    )
  })

  // Calculate KPIs based on ALL loaded data (not just paid)
  const kpis: KPIs = useMemo(() => {
    let totalSaldoInsolutoMXN = 0
    let totalPorCobrarMXN = 0
    let totalCollectedMXN = 0
    let totalExcessMXN = 0
    
    let countLateNoRep = 0
    let countWithRep = 0
    
    const now = new Date()

    data.forEach(r => {
      const rate = r.exchangeRate ? Number(r.exchangeRate) : 1
      const saldoMXN = r.saldoInsoluto * rate
      
      totalSaldoInsolutoMXN += saldoMXN
      
      if (!r.isPaid) {
        totalPorCobrarMXN += (r.total * rate)
      }

      // Ingresos Cobrados Calculation
      // Validate that totalPaid does not exceed total
      const validPaid = Math.min(r.totalPaid, r.total)
      const excessPaid = Math.max(0, r.totalPaid - r.total)
      
      totalCollectedMXN += (validPaid * rate)
      totalExcessMXN += (excessPaid * rate)

      // Morosidad Calculation
      // Deadline: 5th day of the next month after issuance
      const issuance = new Date(r.issuanceDate)
      const deadline = new Date(issuance.getFullYear(), issuance.getMonth() + 1, 5)
      
      // Check if late and no payments (assuming no REP means no payments recorded)
      if (now > deadline && r.payments.length === 0) {
        countLateNoRep++
      }

      // Conciliación Calculation
      if (r.payments.length > 0) {
        countWithRep++
      }
    })

    const totalCount = data.length || 1 // Avoid division by zero

    return {
      totalSaldoInsolutoMXN,
      totalPorCobrarMXN,
      count: data.length,
      countPaid: data.filter(r => r.isPaid).length,
      countPending: data.filter(r => !r.isPaid).length,
      totalCollectedMXN,
      totalExcessMXN,
      morosidadPercentage: (countLateNoRep / totalCount) * 100,
      repsConciliationPercentage: (countWithRep / totalCount) * 100
    }
  }, [data])

  // Initialize dates to current month if empty
  useEffect(() => {
    const now = new Date()
    // Set to 2 months ago to include recent history by default
    const firstDay = new Date(now.getFullYear(), now.getMonth() - 2, 1)
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    setDateFrom(firstDay.toISOString().split('T')[0])
    setDateTo(lastDay.toISOString().split('T')[0])
  }, [])

  // Load selected company from localStorage
  useEffect(() => {
    const stored = localStorage.getItem('selectedCompany')
    if (stored) {
      try {
        setSelectedCompany(JSON.parse(stored))
      } catch (e) {
        console.error('Error parsing selectedCompany', e)
      }
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
        paymentCurrency
      })
      
      const res = await fetch(`/api/dashboard_fiscal/ingresos-parciales?${params}`)
      if (!res.ok) throw new Error('Error fetching data')
      
      const result = await res.json()
      
      // Store all data to calculate global KPIs (Morosidad, Conciliación)
      // The table will filter only paid invoices via filteredData
      setData(result.data as PartialIncomeInvoice[])
    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
    }
  }, [selectedCompany, dateFrom, dateTo, paymentDateFrom, paymentDateTo, incomeCurrency, paymentCurrency])

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
    // Check if we can find the invoice in the loaded data first
    const invoice = data.find(i => i.uuid === uuid)
    
    if (invoice && invoice.xmlContent) {
      // Local zip generation is much faster
      try {
        import('jszip').then(JSZipModule => {
          const JSZip = JSZipModule.default
          const zip = new JSZip()
          const sanitizeName = (name: string) => name.replace(/_+/g, '_').replace(/^_|_$/g, '')

          // XML Factura original
          const invFileName = sanitizeName(`${invoice.uuid}_${invoice.series || ''}_${invoice.folio || ''}_Ingreso.xml`)
          zip.file(invFileName, invoice.xmlContent!)

          // XMLs de Pagos
          if (invoice.payments && invoice.payments.length > 0) {
            invoice.payments.forEach(p => {
              if (p.paymentXml) {
                const payFileName = sanitizeName(`${p.paymentUuid}_${p.paymentSeries || ''}_${p.paymentFolio || ''}_${p.numParcialidad || 1}_Pago.xml`)
                zip.file(payFileName, p.paymentXml)
              }
            })
          }

          zip.generateAsync({ type: 'blob' }).then(content => {
            const url = URL.createObjectURL(content)
            const a = document.createElement('a')
            a.href = url
            a.download = `CFDIs_Pagados_${invoice.uuid.substring(0,8)}.zip`
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)
            URL.revokeObjectURL(url)
          })
        })
        return
      } catch (err) {
        console.error('Error generating local zip, falling back to server', err)
      }
    }
    
    // Fallback to server endpoint
    window.open(`/api/dashboard_fiscal/ingresos-parciales/download?uuid=${uuid}`, '_blank')
  }

  const handleExportCSV = () => {
    if (data.length === 0) return
  
    const headers = [
      'UUID Factura', 'Fecha', 'Serie', 'Folio', 'RFC Receptor', 'Cliente', 'Total Original', 'Total Pagado', 'Saldo Insoluto', 'Moneda', 'Estatus',
      'UUID Pago', 'Fecha Pago', 'Monto Pagado', 'Moneda Pago', 'Tipo Cambio', 'Saldo Anterior', 'Saldo Insoluto Pago', 'Parcialidad', 'Metodo Pago'
    ]
  
    const rows: string[][] = []
    
    data.forEach(inv => {
      const invData = [
        inv.uuid,
        safeFormatDate(inv.issuanceDate),
        inv.series || '',
        inv.folio || '',
        inv.receiverRfc,
        inv.receiverName,
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
            safeFormatDate(pay.paymentDate),
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
    link.setAttribute('download', `reporte_pagados_${format(new Date(), 'yyyyMMdd')}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Ingresos Pagados</h2>
            <p className="text-muted-foreground">
              Consulta de facturas PPD liquidadas
              {selectedCompany && ` · ${selectedCompany.businessName || selectedCompany.name}`}
            </p>
          </div>
          
          <Button onClick={fetchData} disabled={loading} size="sm">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Actualizar'}
          </Button>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 p-4 border rounded-lg bg-card shadow-sm">
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
        {/* New KPI: Ingresos Cobrados */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ingresos Cobrados (MXN)</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {formatCurrency(kpis.totalCollectedMXN)}
            </div>
            <p className="text-xs text-muted-foreground">
              Total pagado validado en el periodo
            </p>
          </CardContent>
        </Card>

        {/* New KPI: Excedente (Conditional) */}
        {kpis.totalExcessMXN > 0 && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-red-600">Excedente (MXN)</CardTitle>
              <AlertTriangle className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">
                {formatCurrency(kpis.totalExcessMXN)}
              </div>
              <p className="text-xs text-muted-foreground">
                Pagos que exceden el total de la factura
              </p>
            </CardContent>
          </Card>
        )}

        {/* New KPI: Morosidad REP */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Morosidad REP</CardTitle>
            <AlertTriangle className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">
              {formatPercentage(kpis.morosidadPercentage)}
            </div>
            <p className="text-xs text-muted-foreground">
              Facturas vencidas sin REP (&gt;5 días mes sig.)
            </p>
          </CardContent>
        </Card>

        {/* New KPI: Eficacia Conciliación */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Eficacia Conciliación</CardTitle>
            <CheckCircle className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              {formatPercentage(kpis.repsConciliationPercentage)}
            </div>
            <p className="text-xs text-muted-foreground">
              % Facturas con al menos un REP
            </p>
          </CardContent>
        </Card>

        {/* Existing KPIs */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Saldo Insoluto (MXN)</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-500">
              {formatCurrency(kpis.totalSaldoInsolutoMXN)}
            </div>
            <p className="text-xs text-muted-foreground">
              Suma de saldos pendientes
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Facturas Liquidadas</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{kpis.countPaid}</div>
            <p className="text-xs text-muted-foreground">
              Pagadas al 100%
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Facturas Pendientes</CardTitle>
            <XCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{kpis.countPending}</div>
            <p className="text-xs text-muted-foreground">
              Con saldo pendiente
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Facturas</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {kpis.count}
            </div>
            <p className="text-xs text-muted-foreground">
              Total en el periodo seleccionado
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Detalle de Facturas Pagadas</CardTitle>
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
                  <TableHead>RFC Receptor</TableHead>
                  <TableHead>Cliente</TableHead>
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
                        <TableCell>{safeFormatDate(invoice.issuanceDate)}</TableCell>
                        <TableCell>{invoice.series}-{invoice.folio}</TableCell>
                        <TableCell className="font-mono text-xs whitespace-nowrap" title={invoice.uuid}>
                          {invoice.uuid}
                        </TableCell>
                        <TableCell className="text-xs font-mono">
                          {invoice.receiverRfc}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate" title={invoice.receiverName}>
                          {invoice.receiverName}
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
                                          {safeFormatDate(payment.paymentDate)}
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
