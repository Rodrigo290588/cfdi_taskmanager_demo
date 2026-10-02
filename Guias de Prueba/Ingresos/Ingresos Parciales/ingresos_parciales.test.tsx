import React from 'react'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom'
import IngresosParcialesPage from '../../../src/app/dashboard_fiscal/ingresos-parciales/page'
import JSZip from 'jszip'

/**
 * 📝 Script de Pruebas JEST: Ingresos Parciales (Pagos PPD)
 * 
 * Este archivo automatiza las validaciones manuales documentadas en:
 * Guias de Prueba/Ingresos/Ingresos Parciales/Checklist_Pruebas_Ingresos_Parciales.md
 */

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: jest.fn() })
}))

jest.mock('sonner', () => ({
  toast: { error: jest.fn(), info: jest.fn(), success: jest.fn() },
  Toaster: () => null
}))

jest.mock('jszip', () => {
  return jest.fn().mockImplementation(() => ({
    file: jest.fn(),
    generateAsync: jest.fn().mockResolvedValue(new Blob(['dummy zip'], { type: 'application/zip' }))
  }))
})

jest.mock('../../../src/components/protected-route', () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

jest.mock('../../../src/components/ui/select', () => ({
  Select: ({ onValueChange, children, value }: { onValueChange: (v: string) => void, children: React.ReactNode, value?: string }) => (
    <select data-testid="mock-select" value={value} onChange={(e) => onValueChange(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string, children: React.ReactNode }) => <option value={value}>{children}</option>,
}))

const mockInvoice = {
  id: 'inv-ppd-1',
  uuid: '1234-PPD-5678',
  series: 'A',
  folio: '100',
  issuerRfc: 'XAXX010101000',
  issuerName: 'Empresa Test',
  receiverRfc: 'CLI010101ABC',
  receiverName: 'Cliente Prueba PPD',
  total: 50000,
  currency: 'MXN',
  issuanceDate: '2026-07-01T12:00:00Z',
  satStatus: 'VIGENTE',
  cfdiType: 'INGRESO',
  isPaid: false,
  totalPaid: 20000,
  saldoInsoluto: 30000,
  payments: [
    {
      paymentUuid: 'REP-1234',
      paymentDate: '2026-07-05T12:00:00Z',
      paymentSeries: 'REP',
      paymentFolio: '1',
      impPagado: 20000,
      monedaP: 'MXN',
      monedaDR: 'MXN',
      equivalenciaDR: 1,
      numParcialidad: 1,
      impSaldoAnt: 50000,
      impSaldoInsoluto: 30000,
      paymentXml: '<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4">Mock REP</cfdi:Comprobante>'
    }
  ],
  xmlContent: '<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4">Mock PPD</cfdi:Comprobante>'
}

const mockResponse = {
  data: [mockInvoice],
  kpis: {
    ingresosPendientesCobro: 30000,
    ingresosCobradosCrp: 20000,
    ingresosCobradosTotal: 20000,
    montoPorCobrarBruto: 50000,
    sumNotasCreditoAplicadas: 5000,
    totalSaldoInsolutoMXN: 30000,
    totalPorCobrarMXN: 50000,
    count: 1,
    countPaid: 0,
    countPending: 1
  }
}

global.fetch = jest.fn()

describe('Ingresos Parciales (Pagos PPD)', () => {
  beforeAll(() => {
    global.URL.createObjectURL = jest.fn(() => 'blob:mock-url')
    global.URL.revokeObjectURL = jest.fn()
  })

  beforeEach(() => {
    jest.clearAllMocks()
    localStorage.clear()
    
    ;(global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/api/user/profile')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ user: { preferences: { tables: {} } } }) })
      }
      if (url.includes('/api/dashboard_fiscal/ingresos-parciales')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockResponse) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })
  })

  const renderWithCompany = async () => {
    localStorage.setItem('selectedCompany', JSON.stringify({ id: 'comp-1', rfc: 'XAXX010101000', name: 'Empresa Test' }))
    window.dispatchEvent(new Event('company-selected'))
    render(<IngresosParcialesPage />)
    // Wait for initial render
    await waitFor(() => {
      expect(screen.getByText(/Ingresos Cobrados \/ No Cobrados/i)).toBeInTheDocument()
    })
  }

  const applyValidDates = async () => {
    // Select the date inputs for Fecha Emisión
    const dateInputs = document.querySelectorAll('input[type="date"]')
    fireEvent.change(dateInputs[0], { target: { value: '2026-07-01' } })
    fireEvent.change(dateInputs[1], { target: { value: '2026-07-31' } })
    
    const btn = screen.getByRole('button', { name: /Aplicar filtros/i })
    fireEvent.click(btn)
    
    // Esperar a que se quite el skeleton/loading y aparezcan las tarjetas
    await waitFor(() => {
      expect(screen.getByText('1234-PPD-5678')).toBeInTheDocument()
    }, { timeout: 3000 })
  }

  describe('1. ⚙️ Pre-requisitos y Configuración Inicial', () => {
    it('bloquea la carga de datos si no se seleccionan fechas (botón deshabilitado)', async () => {
      await renderWithCompany()
      const btn = screen.getByRole('button', { name: /Aplicar filtros/i })
      expect(btn).toBeDisabled()
    })

    it('ejecuta la búsqueda y renderiza los datos al proporcionar fechas válidas', async () => {
      await renderWithCompany()
      await applyValidDates()
      expect(screen.getByText(/Monto por Cobrar \(Bruto\)/i)).toBeInTheDocument()
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/dashboard_fiscal/ingresos-parciales'))
    })
  })

  describe('2. 💳 Validación de Tarjetas (KPIs)', () => {
    it('Ingresos Pendientes de Cobro: refleja el Saldo Insoluto real', async () => {
      await renderWithCompany()
      await applyValidDates()
      // 30,000
      expect(screen.getAllByText(/30,000/)[0]).toBeInTheDocument()
    })

    it('Ingresos Cobrados (CRP): muestra la sumatoria de abonos', async () => {
      await renderWithCompany()
      await applyValidDates()
      // 20,000
      expect(screen.getAllByText(/20,000/)[0]).toBeInTheDocument()
    })

    it('Notas de Crédito Aplicadas: refleja montos de Egreso', async () => {
      await renderWithCompany()
      await applyValidDates()
      // 5,000
      expect(screen.getByText(/5,000/)).toBeInTheDocument()
    })

    it('Monto por Cobrar (Bruto): suma el Total histórico', async () => {
      await renderWithCompany()
      await applyValidDates()
      // 50,000
      expect(screen.getAllByText(/50,000/)[0]).toBeInTheDocument()
    })

    it('Métricas Secundarias: conteos tienen sentido lógico', async () => {
      await renderWithCompany()
      await applyValidDates()
      // Facturas PPD = 1
      expect(screen.getAllByText('1')[0]).toBeInTheDocument()
    })
  })

  describe('3. 🔍 Interactividad y Filtros de la Tabla (Data Grid)', () => {
    it('Filtro Fecha Pago (REP): refleja facturas que tuvieron abonos en ese lapso', async () => {
      await renderWithCompany()
      await applyValidDates()
      const dateInputs = document.querySelectorAll('input[type="date"]')
      // dateInputs[2] y [3] son fechas de pago
      fireEvent.change(dateInputs[2], { target: { value: '2026-07-05' } })
      fireEvent.change(dateInputs[3], { target: { value: '2026-07-10' } })
      const btn = screen.getByRole('button', { name: /Aplicar filtros/i })
      fireEvent.click(btn)
      
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('paymentDateStart=2026-07-05'))
      })
    })

    it('Filtro Monedas y Escenarios: aplica los filtros en la consulta', async () => {
      await renderWithCompany()
      await applyValidDates()
      const selects = screen.getAllByTestId('mock-select')
      // selects[0] = Moneda Emisión
      fireEvent.change(selects[0], { target: { value: 'USD' } })
      const btn = screen.getByRole('button', { name: /Aplicar filtros/i })
      fireEvent.click(btn)
      
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('incomeCurrency=USD'))
      })
    })

    it('Buscador UUID / RFC (En Columna): filtra en tiempo real', async () => {
      await renderWithCompany()
      await applyValidDates()
      
      // La tabla renderiza "1234-PPD-5678"
      expect(screen.getByText('1234-PPD-5678')).toBeInTheDocument()
      
      // Si tecleamos otro, debería desaparecer (filtro de JSDOM manual o interno del componente)
      // Como el filtrado de columnas es interno (generalmente), probamos que el componente responda.
      const searchInputs = screen.getAllByPlaceholderText(/Filtrar.../i)
      // searchInputs[0] es para Fecha, searchInputs[2] para UUID...
      fireEvent.change(searchInputs[2], { target: { value: '9999' } })
      
      await waitFor(() => {
        expect(screen.queryByText('1234-PPD-5678')).not.toBeInTheDocument()
      })
    })
  })

  describe('4. 🗂️ Desglose de Pagos (Drilldown)', () => {
    it('Al hacer clic en la flecha, se expande la sub-tabla de "Desglose de Pagos (REPs)"', async () => {
      await renderWithCompany()
      await applyValidDates()
      
      // Buscar botón de expandir (normalmente el primer td tiene un chevron)
      const rows = screen.getAllByRole('row')
      // rows[0] = header, rows[1] = filters, rows[2] = first data row
      const firstCell = within(rows[2]).getAllByRole('cell')[0]
      const expandBtn = within(firstCell).getByRole('button')
      fireEvent.click(expandBtn)
      
      await waitFor(() => {
        expect(screen.getByText(/REP-1234/i)).toBeInTheDocument()
      })
    })

    it('Al hacer clic en el botón XML de un REP, despliega el modal', async () => {
      await renderWithCompany()
      await applyValidDates()
      
      // Expand
      const rows = screen.getAllByRole('row')
      const firstCell = within(rows[2]).getAllByRole('cell')[0]
      const expandBtn = within(firstCell).getByRole('button')
      fireEvent.click(expandBtn)
      
      await waitFor(() => {
        expect(screen.getByText(/REP-1234/i)).toBeInTheDocument()
      })

      // Clic XML (botón con title Ver XML del pago)
      const xmlBtn = screen.getByRole('button', { name: /Ver XML del pago/i })
      fireEvent.click(xmlBtn)

      await waitFor(() => {
        expect(screen.getByText(/Mock REP/i)).toBeInTheDocument()
      })
    })
  })

  describe('5. 💾 Exportaciones y Descargas Masivas', () => {
    it('Descargar ZIP: genera un .zip con los XML', async () => {
      await renderWithCompany()
      await applyValidDates()
      
      // En la columna de acciones (última), hay un botón de descarga
      const rows = screen.getAllByRole('row')
      const cells = within(rows[2]).getAllByRole('cell')
      const actionCell = cells[cells.length - 1]
      const downloadBtn = within(actionCell).getByRole('button')
      fireEvent.click(downloadBtn)

      await waitFor(() => {
        expect(JSZip).toHaveBeenCalled()
        expect(global.URL.createObjectURL).toHaveBeenCalled()
      })
    })

    it('Descarga Masiva a Excel: genera reporte xls', async () => {
      await renderWithCompany()
      await applyValidDates()
      
      const exportBtn = screen.getByRole('button', { name: /Descargar Reporte/i })
      fireEvent.click(exportBtn)

      await waitFor(() => {
        expect(global.URL.createObjectURL).toHaveBeenCalled()
      })
    })
  })
})
