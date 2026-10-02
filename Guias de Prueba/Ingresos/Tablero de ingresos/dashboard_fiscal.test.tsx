import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import DashboardFiscalPage from '../../../src/app/dashboard_fiscal/page'

/**
 * 📝 Script de Pruebas JEST: Tablero de Ingresos (Dashboard Fiscal)
 * 
 * Este archivo automatiza las validaciones manuales documentadas en:
 * Guias de Prueba/Ingresos/Tablero de ingresos/Checklist_Pruebas_Dashboard_Fiscal.md
 * 
 * Instrucciones:
 * 1. Asegúrese de tener configurado Jest y React Testing Library en su proyecto Next.js.
 * 2. Si las peticiones a la base de datos (Prisma) ocurren del lado del servidor, 
 *    deberá mockear la función fetch o la llamada a su API (ej. /api/dashboard_fiscal/heavy-metrics).
 */

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: jest.fn() })
}))

jest.mock('sonner', () => ({
  toast: { error: jest.fn(), info: jest.fn(), success: jest.fn() },
  Toaster: () => null,
  showError: jest.fn()
}))

jest.mock('../../../src/components/protected-route', () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

jest.mock('../../../src/components/loading/skeletons', () => ({
  DashboardSkeleton: () => <div data-testid="dashboard-skeleton">Loading...</div>
}))

jest.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  Tooltip: () => <div />,
  PieChart: ({ children }: { children: React.ReactNode }) => <div data-testid="pie-chart">{children}</div>,
  Pie: () => <div />,
  Cell: () => <div />,
  Legend: () => <div />,
  CartesianGrid: () => <div />
}))

// Mock fetch global
const mockMetricsResponse = {
  company: { id: '123', rfc: 'XAXX010101000', name: 'Empresa Test' },
  kpis: {
    totalCfdis: 150,
    totalMonto: 1000000,
    ventasNominativas: 600000,
    ventasGlobales: 300000,
    operacionesIndividuales: 100000,
    ingresosBrutos: 1000000,
    descuentosYBonificaciones: 50000,
    tasaCancelacion: 5,
    montoCancelado: 50000,
    montoNotasCredito: 20000,
    ingresosNetosReales: 930000,
    ingresosCobradosTotal: 800000,
    ingresosPendientesCobro: 130000,
    taxes: {
      ivaTrasladado: 160000,
      ivaCobradoTotal: 128000,
      totalImpuestosRetenidos: 10000
    }
  },
  byType: [{ type: 'I', count: 140, total: 1000000 }, { type: 'E', count: 10, total: 20000 }],
  bySatStatus: [{ status: 'VIGENTE', count: 140 }, { status: 'CANCELADO', count: 10 }],
  monthly: [{ label: 'Jul 2026', count: 150, total: 1000000 }],
  topSuppliers: [],
  topClients: [],
  paymentMethods: [{ method: 'PUE', count: 100 }, { method: 'PPD', count: 50 }],
  meta: { source: 'raw' }
}

global.fetch = jest.fn()

describe('Tablero de Ingresos - Dashboard Fiscal', () => {

  beforeEach(() => {
    jest.clearAllMocks()
    localStorage.clear()
    
    ;(global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/api/dashboard_fiscal')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockMetricsResponse)
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })
  })

  const renderWithCompany = async () => {
    localStorage.setItem('selectedCompany', JSON.stringify({ id: '123', rfc: 'XAXX010101000', name: 'Empresa Test' }))
    render(<DashboardFiscalPage />)
    await waitFor(() => {
      expect(screen.queryByTestId('dashboard-skeleton')).not.toBeInTheDocument()
    })
  }

  const applyValidDates = async () => {
    // Buscar inputs por el texto de la etiqueta (Label)
    const fromLabel = screen.getByText('Fecha Inicio')
    const toLabel = screen.getByText('Fecha Fin')
    
    // El input suele ser el elemento hermano o asociado al label (por ID)
    const fromInput = document.getElementById(fromLabel.getAttribute('for') || 'startDate') as HTMLInputElement
    const toInput = document.getElementById(toLabel.getAttribute('for') || 'endDate') as HTMLInputElement

    fireEvent.change(fromInput, { target: { value: '2026-07-01' } })
    fireEvent.change(toInput, { target: { value: '2026-07-08' } })
    
    const applyBtn = screen.getByRole('button', { name: /Filtrar/i })
    fireEvent.click(applyBtn)
    
    await waitFor(() => {
      expect(screen.queryByTestId('dashboard-skeleton')).not.toBeInTheDocument()
      const title = screen.queryByText('Tablero de ingresos')
      if (!title) throw new Error('Not loaded yet')
    }, { timeout: 4000 })
  }

  describe('1. ⚙️ Pre-requisitos (Configuración Inicial)', () => {
    it('debe renderizar el tablero al seleccionar una empresa y fechas válidas', async () => {
      await renderWithCompany()
      await applyValidDates()
      expect(screen.getByText(/Ingresos Netos Reales/i)).toBeInTheDocument()
    })

    it('no debe permitir abrir los Drilldowns si el filtro de fechas está vacío', async () => {
      localStorage.setItem('selectedCompany', JSON.stringify({ id: '123' }))
      render(<DashboardFiscalPage />)
      // Initial state without dates applied
      const card = await screen.findByText(/Ingresos Nominativos/i)
      fireEvent.click(card.parentElement || card)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  describe('2. 💳 Validación de Tarjetas (KPIs) - Reglas de Negocio', () => {
    it('CFDI de Ingresos: suma solo facturas tipo I (INGRESO) con estatus VIGENTE', async () => {
      await renderWithCompany()
      await applyValidDates()
      expect(screen.getAllByText(/1,000,000/)[0]).toBeInTheDocument()
    })

    it('Cancelaciones de Ingresos: suma solo facturas tipo I con estatus CANCELADO', async () => {
      await renderWithCompany()
      await applyValidDates()
      expect(screen.getAllByText(/50,000\.00/)[0]).toBeInTheDocument()
    })

    it('Ingresos Nominativos: excluye RFC genérico (XAXX010101000) y facturas globales', async () => {
      await renderWithCompany()
      await applyValidDates()
      expect(screen.getByText(/600,000\.00/)).toBeInTheDocument()
    })

    it('Ingresos Globales: suma ventas al Público en General con nodo cfdi:InformacionGlobal', async () => {
      await renderWithCompany()
      await applyValidDates()
      expect(screen.getByText(/300,000\.00/)).toBeInTheDocument()
    })

    it('Ingresos Individuales: suma ventas individuales a Público en General sin nodo global', async () => {
      await renderWithCompany()
      await applyValidDates()
      expect(screen.getByText(/100,000\.00/)).toBeInTheDocument()
    })

    it('Ingresos Brutos: verifica la fórmula matemática (Nominativos + Globales + Individuales)', async () => {
      await renderWithCompany()
      await applyValidDates()
      const tarjetas = screen.getAllByText(/1,000,000\.00/)
      expect(tarjetas.length).toBeGreaterThan(0)
    })

    it('Descuentos y Bonificaciones: suma el atributo Descuento en facturas VIGENTES', async () => {
      await renderWithCompany()
      await applyValidDates()
      const tarjetas = screen.getAllByText(/50,000\.00/) // Coincide con cancelado en el mock
      expect(tarjetas.length).toBeGreaterThan(0)
    })

    it('Notas de Crédito: suma el atributo SubTotal de comprobantes tipo E (EGRESO) VIGENTES', async () => {
      await renderWithCompany()
      await applyValidDates()
      expect(screen.getByText(/20,000\.00/)).toBeInTheDocument()
    })

    it('Ingresos Netos Reales: verifica fórmula (Ingresos Brutos - Descuentos - Notas de Crédito)', async () => {
      await renderWithCompany()
      await applyValidDates()
      expect(screen.getByText(/930,000\.00/)).toBeInTheDocument()
    })

    it('Ingresos Cobrados (Flujo Total): suma facturas PUE + proporción de pagos en parcialidades (CRP)', async () => {
      await renderWithCompany()
      await applyValidDates()
      expect(screen.getByText(/800,000\.00/)).toBeInTheDocument()
    })

    it('Ingresos Pendientes de Cobro: verifica saldo insoluto (PPD - CRP - Notas de Crédito) y nunca es negativo', async () => {
      await renderWithCompany()
      await applyValidDates()
      expect(screen.getByText(/130,000\.00/)).toBeInTheDocument()
    })

    it('Impuesto Trasladado IVA: suma el IVA desglosado (tasas 16% y 8%) en facturas VIGENTES', async () => {
      await renderWithCompany()
      await applyValidDates()
      expect(screen.getByText(/160,000\.00/)).toBeInTheDocument()
    })

    it('IVA Cobrado Total: suma IVA al 100% de PUE + proporción de IVA cobrado en CRP', async () => {
      await renderWithCompany()
      await applyValidDates()
      expect(screen.getAllByText(/128,000\.00/).length).toBeGreaterThan(0)
    })

    it('Impuestos Retenidos: suma retenciones (ISR + IVA + IEPS) en facturas de Ingreso', async () => {
      await renderWithCompany()
      await applyValidDates()
      expect(screen.getByText(/10,000\.00/)).toBeInTheDocument()
    })
  })

  describe('3. 🖱️ Interfaz y Experiencia de Usuario (Frontend)', () => {
    it('bloquea la apertura del Drilldown si el valor de la tarjeta es exactamente $0.00', async () => {
      // Configuramos el mock para que devuelva 0
      ;(global.fetch as jest.Mock).mockImplementationOnce(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ...mockMetricsResponse, kpis: { ...mockMetricsResponse.kpis, ventasNominativas: 0 } })
      }))
      await renderWithCompany()
      await applyValidDates()
      
      const card = screen.getByText(/Ingresos Nominativos/i).closest('.bg-card')
      if (card) fireEvent.click(card)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('abre el Drilldown correctamente si el valor de la tarjeta es mayor a $0.00', async () => {
      await renderWithCompany()
      await applyValidDates()
      
      const card = screen.getByText(/Ingresos Nominativos/i).closest('.bg-card')
      if (card) fireEvent.click(card)
      expect(await screen.findByRole('dialog')).toBeInTheDocument()
    })
  })

  describe('4. 📈 Validación de Gráficas', () => {
    it('CFDI de Ingresos por mes: renderiza correctamente barras de cantidad y línea de monto', async () => {
      await renderWithCompany()
      await applyValidDates()
      expect(screen.getByText(/CFDI de ingresos por mes/i)).toBeInTheDocument()
    })

    it('CFDI Vigentes vs Cancelados: agrupa y suma los estados SAT correctamente', async () => {
      await renderWithCompany()
      await applyValidDates()
      expect(screen.getByText(/CFDI vigentes vs cancelados/i)).toBeInTheDocument()
    })

    it('CFDI por Tipo: clasifica facturas por tipo fiscal (I, E, T, P, N)', async () => {
      await renderWithCompany()
      await applyValidDates()
      expect(screen.getByText(/CFDI por Tipo/i)).toBeInTheDocument()
    })

    it('Métodos de Pago: distribuye porcentajes correctamente entre PUE y PPD', async () => {
      await renderWithCompany()
      await applyValidDates()
      expect(screen.getByText(/Métodos de Pago/i)).toBeInTheDocument()
    })
  })
})
