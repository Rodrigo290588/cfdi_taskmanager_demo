export interface KPIData {
  title: string
  value: string
  change: number
  trend: 'up' | 'down' | 'neutral'
}

export interface ChartData {
  month: string
  ingresos: number
  gastos: number
  ivaTrasladado: number
  ivaAcreditable: number
}

export interface InvoiceSummary {
  tipo: string
  count: number
  total: number
  percentage: number
}

export const mockKPIs: KPIData[] = [
  {
    title: "Ingresos del Mes",
    value: "$2,847,320.00",
    change: 12.5,
    trend: "up"
  },
  {
    title: "Gastos del Mes",
    value: "$1,234,567.00",
    change: -3.2,
    trend: "down"
  },
  {
    title: "IVA Trasladado",
    value: "$455,571.20",
    change: 8.7,
    trend: "up"
  },
  {
    title: "IVA Acreditable",
    value: "$197,530.72",
    change: -1.4,
    trend: "down"
  }
]

export const mockChartData: ChartData[] = [
  {
    month: "Ene",
    ingresos: 2100000,
    gastos: 950000,
    ivaTrasladado: 336000,
    ivaAcreditable: 152000
  },
  {
    month: "Feb",
    ingresos: 2350000,
    gastos: 1100000,
    ivaTrasladado: 376000,
    ivaAcreditable: 176000
  },
  {
    month: "Mar",
    ingresos: 2847320,
    gastos: 1234567,
    ivaTrasladado: 455571,
    ivaAcreditable: 197531
  },
  {
    month: "Abr",
    ingresos: 2650000,
    gastos: 1180000,
    ivaTrasladado: 424000,
    ivaAcreditable: 188800
  },
  {
    month: "May",
    ingresos: 2900000,
    gastos: 1300000,
    ivaTrasladado: 464000,
    ivaAcreditable: 208000
  },
  {
    month: "Jun",
    ingresos: 3100000,
    gastos: 1400000,
    ivaTrasladado: 496000,
    ivaAcreditable: 224000
  }
]

export const mockInvoiceSummary: InvoiceSummary[] = [
  {
    tipo: "Ingreso",
    count: 156,
    total: 2847320,
    percentage: 68.2
  },
  {
    tipo: "Egreso",
    count: 89,
    total: 1234567,
    percentage: 29.6
  },
  {
    tipo: "Nómina",
    count: 12,
    total: 85000,
    percentage: 2.0
  },
  {
    tipo: "Pago",
    count: 5,
    total: 7500,
    percentage: 0.2
  }
]

export const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2
  }).format(amount)
}

export const formatPercentage = (value: number): string => {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`
}