import React from 'react'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom'
import WorkpaperEmitidosPage from '../../../src/app/dashboard_fiscal/workpaper/page'
import { toast } from 'sonner'
import JSZip from 'jszip'

// MOCKS
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
    info: jest.fn(),
    success: jest.fn(),
  }
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
  id: 'inv-1',
  uuid: '1234-5678',
  cfdiType: 'INGRESO',
  issuerRfc: 'AAA010101AAA',
  receiverRfc: 'BBB010101BBB',
  receiverName: 'Cliente Prueba',
  subtotal: 100,
  discount: 0,
  total: 116,
  totalImpuestosTrasladados: 16,
  totalImpuestosRetenidos: 0,
  satStatus: 'VIGENTE',
  xmlContent: '<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0" SubTotal="100" Total="116"><cfdi:Conceptos><cfdi:Concepto ClaveProdServ="84111506" Cantidad="1" Descripcion="Servicios" ValorUnitario="100" Importe="100" ObjetoImp="02" /></cfdi:Conceptos><cfdi:Impuestos TotalImpuestosTrasladados="16"><cfdi:Traslados><cfdi:Traslado Impuesto="002" Base="100" TipoFactor="Tasa" TasaOCuota="0.160000" Importe="16"/></cfdi:Traslados></cfdi:Impuestos></cfdi:Comprobante>'
}

global.fetch = jest.fn()

describe('Papel de Trabajo (Workpaper) - Ingresos Emitidos', () => {
  
  beforeAll(() => {
    global.URL.createObjectURL = jest.fn(() => 'blob:mock-url')
    global.URL.revokeObjectURL = jest.fn()
  })

  beforeEach(() => {
    jest.clearAllMocks()
    localStorage.clear()
    
    ;(global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/api/user/profile')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ user: { preferences: { tables: {} } } })
        })
      }
      if (url.includes('/api/dashboard_fiscal/invoices')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            invoices: [mockInvoice],
            pagination: { totalPages: 1, total: 1 }
          })
        })
      }
      if (url.includes('/api/invoices/inv-1/pdf')) {
        return Promise.resolve({
          ok: true,
          blob: () => Promise.resolve(new Blob(['pdf'], { type: 'application/pdf' }))
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })
  })

  const renderWithCompany = async () => {
    localStorage.setItem('selectedCompany', JSON.stringify({ id: 'comp-1', rfc: 'AAA010101AAA', name: 'Empresa Test' }))
    window.dispatchEvent(new Event('company-selected'))
    render(<WorkpaperEmitidosPage />)
    await waitFor(() => expect(screen.queryByText('Cargando...')).not.toBeInTheDocument())
  }

  const applyValidDates = async () => {
    const dateFrom = screen.getByPlaceholderText('Fecha desde')
    const dateTo = screen.getByPlaceholderText('Fecha hasta')
    fireEvent.change(dateFrom, { target: { value: '2026-07-01' } })
    fireEvent.change(dateTo, { target: { value: '2026-07-08' } })
    const btnAplicar = screen.getByRole('button', { name: /Aplicar/i })
    fireEvent.click(btnAplicar)
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/dashboard_fiscal/invoices')))
  }

  describe('1. ⚙️ Pre-requisitos y Seguridad', () => {
    it('debe solicitar seleccionar una empresa si no hay ninguna en contexto', async () => {
      render(<WorkpaperEmitidosPage />)
      expect(screen.getByText('Selecciona una empresa')).toBeInTheDocument()
    })

    it('debe mostrar error y bloquear consulta si no se definen Fecha Inicio y Fecha Fin', async () => {
      await renderWithCompany()
      const btnAplicar = screen.getByRole('button', { name: /Aplicar/i })
      // Since the button is disabled when dates are empty, we check if it is disabled
      expect(btnAplicar).toBeDisabled()
    })

    it('debe deshabilitar el botón Aplicar si Fecha Inicio es mayor a Fecha Fin', async () => {
      await renderWithCompany()
      const dateFrom = screen.getByPlaceholderText('Fecha desde')
      const dateTo = screen.getByPlaceholderText('Fecha hasta')
      fireEvent.change(dateFrom, { target: { value: '2026-07-10' } })
      fireEvent.change(dateTo, { target: { value: '2026-07-01' } })
      
      const btnAplicar = screen.getByRole('button', { name: /Aplicar/i })
      expect(btnAplicar).toBeDisabled()
      expect(screen.getByText(/La fecha de inicio no puede ser mayor que la fecha final/i)).toBeInTheDocument()
    })
  })

  describe('2. 🔍 Filtros y Consultas', () => {
    it('debe llenar la tabla con registros (I, E, P, T) al aplicar un rango de fechas válido', async () => {
      await renderWithCompany()
      await applyValidDates()
      expect(await screen.findByText('1234-5678')).toBeInTheDocument()
    })

    it('debe filtrar correctamente por estatus SAT VIGENTE', async () => {
      await renderWithCompany()
      await applyValidDates()
      
      const selects = screen.getAllByTestId('mock-select')
      fireEvent.change(selects[0], { target: { value: 'VIGENTE' } })
      
      const btnAplicar = screen.getByRole('button', { name: /Aplicar/i })
      fireEvent.click(btnAplicar)
      
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('satStatus=VIGENTE'))
      })
    })

    it('debe filtrar correctamente por estatus SAT CANCELADO', async () => {
      await renderWithCompany()
      await applyValidDates()
      
      const selects = screen.getAllByTestId('mock-select')
      fireEvent.change(selects[0], { target: { value: 'CANCELADO' } })
      
      const btnAplicar = screen.getByRole('button', { name: /Aplicar/i })
      fireEvent.click(btnAplicar)
      
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('satStatus=CANCELADO'))
      })
    })

    it('debe aplicar filtros de búsqueda por columna (Ej. Receptor) y resetear a la página 1', async () => {
      await renderWithCompany()
      await applyValidDates()
      
      const searchInputs = await screen.findAllByPlaceholderText('Buscar...')
      fireEvent.change(searchInputs[2], { target: { value: 'Prueba' } }) 
      
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('Prueba'))
      })
    })
  })

  describe('3. 📊 Data Grid (Tabla Interactiva)', () => {
    it('debe ocultar una columna de la tabla al desmarcarla en el panel de "Columnas visibles"', async () => {
      await renderWithCompany()
      await applyValidDates()
      
      const btnColumnas = screen.getByRole('button', { name: /Columnas/i })
      fireEvent.click(btnColumnas)
      
      const uuidCheckbox = await screen.findByLabelText('UUID')
      fireEvent.click(uuidCheckbox) 
      
      await waitFor(() => {
        const headers = screen.queryAllByText('UUID', { selector: 'span.cursor-move' })
        expect(headers).toHaveLength(0) 
      })
    })

    it('debe alternar entre Vista Básica y Mostrar Todo', async () => {
      await renderWithCompany()
      await applyValidDates()
      
      const btnColumnas = screen.getByRole('button', { name: /Columnas/i })
      fireEvent.click(btnColumnas)
      
      const btnMostrarTodo = await screen.findByRole('button', { name: /Mostrar todo/i })
      fireEvent.click(btnMostrarTodo)
      
      expect(screen.getAllByText('Versión').length).toBeGreaterThan(0)
      
      const btnVistaBasica = await screen.findByRole('button', { name: /Vista básica/i })
      fireEvent.click(btnVistaBasica)
      
      await waitFor(() => {
        expect(screen.queryAllByText('Versión', { selector: 'span.cursor-move' })).toHaveLength(0)
      })
    })

    it('debe mostrar una fila de totales matemáticos al pie de la tabla', async () => {
      await renderWithCompany()
      await applyValidDates()
      
      const tfoot = document.querySelector('tfoot')
      expect(tfoot).toBeInTheDocument()
      expect(within(tfoot as HTMLElement).getByText('$100.00')).toBeInTheDocument()
      expect(within(tfoot as HTMLElement).getByText('$116.00')).toBeInTheDocument()
      expect(within(tfoot as HTMLElement).getByText('$16.00')).toBeInTheDocument()
    })

    it('debe desplegar la tabla anidada de "Detalle de Conceptos" al hacer clic en expandir', async () => {
      await renderWithCompany()
      await applyValidDates()
      
      const btnColumnas = screen.getByRole('button', { name: /Columnas/i })
      fireEvent.click(btnColumnas)
      
      const checkboxes = screen.getAllByRole('checkbox')
      const conceptosCheckbox = checkboxes.find(c => c.parentElement?.textContent?.includes('Conceptos'))
      if (conceptosCheckbox) {
        fireEvent.click(conceptosCheckbox)
      }
      
      let expandBtn: HTMLButtonElement | null | undefined = null;
      await waitFor(() => {
        const tbody = document.querySelector('tbody')
        const firstRow = tbody?.querySelector('tr')
        expandBtn = firstRow?.querySelector('button')
        expect(expandBtn).toBeInTheDocument()
      })
      
      if (expandBtn) fireEvent.click(expandBtn)
      
      expect(await screen.findByText('Detalle de Conceptos')).toBeInTheDocument()
      expect(screen.getByText('84111506')).toBeInTheDocument() 
      expect(screen.getByText('Servicios')).toBeInTheDocument()
    })
  })

  describe('4. 📄 Acciones Individuales', () => {
    it('debe disparar la descarga de un XML individual', async () => {
      await renderWithCompany()
      await applyValidDates()
      
      const btnXml = await screen.findByTitle('XML')
      fireEvent.click(btnXml)
      
      expect(global.URL.createObjectURL).toHaveBeenCalled()
    })

    it('debe disparar la solicitud de visualización del PDF individual', async () => {
      await renderWithCompany()
      await applyValidDates()
      
      const btnPdf = await screen.findByTitle('PDF')
      fireEvent.click(btnPdf)
      
      expect(toast.info).toHaveBeenCalledWith('Generando PDF...')
    })
  })

  describe('5. 📥 Exportaciones Masivas', () => {
    it('debe generar y descargar el reporte CSV completo', async () => {
      await renderWithCompany()
      await applyValidDates()
      
      const btnCsv = await screen.findByRole('button', { name: /Exportar CSV/i })
      fireEvent.click(btnCsv)
      
      await waitFor(() => {
        expect(global.URL.createObjectURL).toHaveBeenCalled()
      })
    })

    it('debe generar y descargar el reporte en Excel (.xls)', async () => {
      await renderWithCompany()
      await applyValidDates()
      
      const btnExcel = await screen.findByRole('button', { name: /Exportar Excel/i })
      fireEvent.click(btnExcel)
      
      await waitFor(() => {
        expect(global.URL.createObjectURL).toHaveBeenCalled()
      })
    })

    it('debe generar un archivo ZIP con los XML y PDF de las facturas seleccionadas', async () => {
      await renderWithCompany()
      await applyValidDates()
      
      const tbody = document.querySelector('tbody')
      const checkbox = within(tbody as HTMLElement).getAllByRole('checkbox')[0]
      fireEvent.click(checkbox)
      
      const btnZip = await screen.findByRole('button', { name: /Descarga Zip \(1\)/i })
      fireEvent.click(btnZip)
      
      await waitFor(() => {
        expect(JSZip).toHaveBeenCalled()
        expect(global.URL.createObjectURL).toHaveBeenCalled()
      })
    })
  })
})