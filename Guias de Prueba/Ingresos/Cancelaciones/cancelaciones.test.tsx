import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import CancelacionesPage from '../../../src/app/dashboard_fiscal/cancelaciones/page'
import { toast } from 'sonner'

/**
 * 📝 Script de Pruebas JEST: Cancelaciones
 * 
 * Este archivo automatiza las validaciones manuales documentadas en:
 * Guias de Prueba/Ingresos/Cancelaciones/Checklist_Pruebas_Cancelaciones.md
 */

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: jest.fn() })
}))

jest.mock('sonner', () => ({
  toast: { error: jest.fn(), info: jest.fn(), success: jest.fn() },
  Toaster: () => null
}))

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

jest.mock('../../../src/components/ui/tabs', () => ({
  Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children, onClick }: { children: React.ReactNode, onClick?: () => void }) => <button onClick={onClick}>{children}</button>,
  TabsContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

const mockInvoice = {
  id: 'inv-can-1',
  uuid: '1234-CANC-5678',
  series: 'A',
  folio: '100',
  issuerRfc: 'XAXX010101000',
  issuerName: 'Empresa Test',
  receiverRfc: 'CLI010101ABC',
  receiverName: 'Cliente Cancelado',
  total: 50000,
  currency: 'MXN',
  issuanceDate: '2026-07-01T12:00:00Z',
  satStatus: 'CANCELADO',
  cfdiType: 'INGRESO',
  xmlContent: '<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4">Mock CANCELADO</cfdi:Comprobante>'
}

const mockResponse = {
  invoices: [mockInvoice],
  pagination: {
    total: 1,
    totalPages: 1,
    page: 1,
    limit: 50
  }
}

const mockLayoutResult = {
  success: true,
  fileName: 'layout_test.txt',
  summary: {
    processed: 10,
    updated: 5,
    ignored: 2,
    notFound: 1,
    invalid: 1,
    unhandled: 1
  },
  updatedRows: [{ lineNumber: 1, uuid: 'UP-123', previousSatStatus: 'VIGENTE', nextSatStatus: 'CANCELADO', reason: 'Actualizado' }],
  ignoredRows: [{ lineNumber: 2, uuid: 'IG-123', reason: 'No cancelable' }],
  notFoundRows: [{ lineNumber: 3, uuid: 'NF-123', reason: 'No existe' }],
  invalidRows: [{ lineNumber: 4, reason: 'Formato incorrecto', rawLine: 'uuid-malo|algo' }],
  unhandledRows: [{ lineNumber: 5, uuid: 'UN-123', reason: 'Estado extraño', rawLine: 'UN-123|RARO' }]
}

global.fetch = jest.fn()

describe('Módulo de Cancelaciones', () => {
  beforeAll(() => {
    global.URL.createObjectURL = jest.fn(() => 'blob:mock-url')
    global.URL.revokeObjectURL = jest.fn()
    Object.assign(navigator, {
      clipboard: {
        writeText: jest.fn().mockImplementation(() => Promise.resolve()),
      },
    })
  })

  beforeEach(() => {
    jest.clearAllMocks()
    localStorage.clear()
    
    ;(global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/api/user/profile')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ user: { preferences: { tables: {} } } }) })
      }
      if (url.includes('/api/dashboard_fiscal/invoices')) {
        if (url.includes('issuerRfc=OTRO-RFC')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ invoices: [], pagination: { total: 0, totalPages: 0, page: 1, limit: 50 } }) })
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockResponse) })
      }
      if (url.includes('/api/dashboard_fiscal/cancelaciones/import-layout')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockLayoutResult) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })
  })

  const renderWithCompany = async () => {
    localStorage.setItem('selectedCompany', JSON.stringify({ id: 'comp-1', rfc: 'XAXX010101000', name: 'Empresa Test' }))
    window.dispatchEvent(new Event('company-selected'))
    render(<CancelacionesPage />)
    
    // Esperar a que se renderice el título
    await waitFor(() => {
      expect(screen.getByText(/Facturas Canceladas/i)).toBeInTheDocument()
    })
  }

  const applyFilters = async () => {
    // Escribir fechas
    const dateInputs = document.querySelectorAll('input[type="date"]')
    fireEvent.change(dateInputs[0], { target: { value: '2026-07-01' } })
    fireEvent.change(dateInputs[1], { target: { value: '2026-07-31' } })
    
    const btn = screen.getByRole('button', { name: /Aplicar/i })
    fireEvent.click(btn)
    
    await waitFor(() => {
      expect(screen.getByText('1234-CANC-5678')).toBeInTheDocument()
    }, { timeout: 3000 })
  }

  describe('1. ⚙️ Pre-requisitos y Configuración Inicial', () => {
    it('CH-CAN-01: muestra aviso "Selecciona una empresa" si no hay empresa', () => {
      render(<CancelacionesPage />)
      expect(screen.getByText(/Selecciona una empresa/i)).toBeInTheDocument()
      expect(screen.queryByText(/Facturas Canceladas/i)).not.toBeInTheDocument()
    })

    it('CH-CAN-02: alerta si se da clic en "Aplicar" sin filtros', async () => {
      await renderWithCompany()
      const btn = screen.getByRole('button', { name: /Aplicar/i })
      fireEvent.click(btn)
      
      await waitFor(() => {
        expect(toast.info).toHaveBeenCalledWith('Selecciona al menos un filtro para consultar registros')
      })
    })
  })

  describe('2. 🔍 Filtros Principales y Búsqueda', () => {
    it('CH-CAN-03, CH-CAN-04, CH-CAN-05: envía parámetros correctos incluyendo satStatus=CANCELADO', async () => {
      await renderWithCompany()
      
      // Selectores (Tipo CFDI y Estatus interno)
      const selects = screen.getAllByTestId('mock-select')
      fireEvent.change(selects[0], { target: { value: 'INGRESO' } }) // Tipo CFDI
      fireEvent.change(selects[1], { target: { value: 'ACTIVE' } }) // Estatus interno

      const btn = screen.getByRole('button', { name: /Aplicar/i })
      fireEvent.click(btn)

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('cfdiType=INGRESO')
        )
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('status=ACTIVE')
        )
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('satStatus=CANCELADO')
        )
      })
    })

    it('CH-CAN-06: fechas limitan resultados', async () => {
      await renderWithCompany()
      await applyFilters()
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('dateFrom=2026-07-01')
      )
    })

    it('CH-CAN-07: limpiar filtros reinicia la tabla y los inputs', async () => {
      await renderWithCompany()
      await applyFilters()
      
      const cleanBtn = screen.getByRole('button', { name: /Limpiar filtros/i })
      fireEvent.click(cleanBtn)
      
      await waitFor(() => {
        // La tabla se limpia porque no hay filtros activos
        expect(screen.queryByText('1234-CANC-5678')).not.toBeInTheDocument()
      })
    })
  })

  describe('3. 📊 Interacción con la Tabla de Datos', () => {
    it('CH-CAN-08: filtro de columna oculta registros', async () => {
      await renderWithCompany()
      await applyFilters()
      
      expect(screen.getByText('1234-CANC-5678')).toBeInTheDocument()
      
      const searchInputs = screen.getAllByPlaceholderText(/Filtrar.../i)
      // Buscar en la columna RFC Emisor o similar
      fireEvent.change(searchInputs[0], { target: { value: 'OTRO-RFC' } })
      
      await waitFor(() => {
        expect(screen.queryByText('1234-CANC-5678')).not.toBeInTheDocument()
      })
    })

    it('CH-CAN-10: botón XML descarga el archivo original', async () => {
      await renderWithCompany()
      await applyFilters()
      
      const xmlBtn = screen.getByRole('button', { name: /XML/i })
      fireEvent.click(xmlBtn)

      await waitFor(() => {
        expect(global.URL.createObjectURL).toHaveBeenCalled()
      })
    })

    it('CH-CAN-11: botón PDF abre pestaña nueva', async () => {
      await renderWithCompany()
      await applyFilters()
      
      const pdfBtn = screen.getByRole('button', { name: /PDF/i })
      fireEvent.click(pdfBtn)

      await waitFor(() => {
        expect(toast.info).toHaveBeenCalledWith('Generando PDF...')
      })
    })

    it('CH-CAN-12: paginación está deshabilitada en extremos', async () => {
      await renderWithCompany()
      await applyFilters() // Devuelve page 1 of 1
      
      const prevBtn = screen.getByRole('button', { name: /Anterior/i })
      const nextBtn = screen.getByRole('button', { name: /Siguiente/i })
      
      expect(prevBtn).toBeDisabled()
      expect(nextBtn).toBeDisabled()
    })
  })

  describe('4. 🗂️ Importación de Layout (Masivo)', () => {
    it('CH-CAN-13, CH-CAN-14: Modal rechaza archivos no .txt', async () => {
      await renderWithCompany()
      
      const importBtn = screen.getByRole('button', { name: /Importación Layout/i })
      fireEvent.click(importBtn)
      
      await waitFor(() => {
        expect(screen.getByText(/Importar layout de cancelaciones/i)).toBeInTheDocument()
      })
      
      // Simulamos la entrada de un archivo .pdf
      // Como input type="file" no tiene name o aria-label específico, buscamos por selector tag
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      const file = new File(['dummy content'], 'archivo.pdf', { type: 'application/pdf' })
      
      fireEvent.change(fileInput, { target: { files: [file] } })
      
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Solo se permiten archivos .txt')
      })
    })

    it('CH-CAN-15, CH-CAN-16: Procesar .txt muestra KPIs y pestañas', async () => {
      await renderWithCompany()
      
      const importBtn = screen.getByRole('button', { name: /Importación Layout/i })
      fireEvent.click(importBtn)
      
      await waitFor(() => {
        expect(screen.getByText(/Importar layout de cancelaciones/i)).toBeInTheDocument()
      })
      
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      const file = new File(['1234|CANCELADO|...'], 'layout.txt', { type: 'text/plain' })
      fireEvent.change(fileInput, { target: { files: [file] } })
      
      const procesarBtn = screen.getByRole('button', { name: /Procesar layout/i })
      fireEvent.click(procesarBtn)
      
      await waitFor(() => {
        // Verificar que llamó al fetch de importación
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/import-layout'),
          expect.any(Object)
        )
        // Verificar que aparezcan los KPIs
        expect(screen.getAllByText('10')[0]).toBeInTheDocument() // Procesados
        expect(screen.getAllByText('5')[0]).toBeInTheDocument()  // Actualizados
      })
    })

    it('CH-CAN-17: Permite copiar registros no contemplados', async () => {
      await renderWithCompany()
      
      const importBtn = screen.getByRole('button', { name: /Importación Layout/i })
      fireEvent.click(importBtn)
      
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      const file = new File(['1234|CANCELADO|...'], 'layout.txt', { type: 'text/plain' })
      fireEvent.change(fileInput, { target: { files: [file] } })
      
      const procesarBtn = screen.getByRole('button', { name: /Procesar layout/i })
      fireEvent.click(procesarBtn)
      
      await waitFor(() => {
        expect(screen.getByText('10')).toBeInTheDocument()
      })

      // En nuestro mock de Tabs, todo se renderiza, no hace falta dar clic en el tab.
      const copyBtn = await screen.findByText(/Copiar registros no contemplados/i)
      fireEvent.click(copyBtn)

      await waitFor(() => {
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('UN-123|RARO')
        expect(toast.success).toHaveBeenCalledWith('Registros no contemplados copiados al portapapeles')
      })
    })
  })

  describe('5. 💾 Exportaciones', () => {
    it('CH-CAN-18: Exportar botones deshabilitados sin datos', async () => {
      await renderWithCompany()
      const csvBtn = screen.getByRole('button', { name: /Exportar CSV/i })
      const xlsBtn = screen.getByRole('button', { name: /Exportar Excel/i })
      
      expect(csvBtn).toBeDisabled()
      expect(xlsBtn).toBeDisabled()
    })

    it('CH-CAN-19: Exportar CSV genera archivo', async () => {
      await renderWithCompany()
      await applyFilters()
      
      const csvBtn = screen.getByRole('button', { name: /Exportar CSV/i })
      expect(csvBtn).not.toBeDisabled()
      fireEvent.click(csvBtn)
      
      await waitFor(() => {
        expect(global.URL.createObjectURL).toHaveBeenCalled()
      })
    })

    it('CH-CAN-20: Exportar Excel genera archivo', async () => {
      await renderWithCompany()
      await applyFilters()
      
      const xlsBtn = screen.getByRole('button', { name: /Exportar Excel/i })
      expect(xlsBtn).not.toBeDisabled()
      fireEvent.click(xlsBtn)
      
      await waitFor(() => {
        expect(global.URL.createObjectURL).toHaveBeenCalled()
      })
    })
  })
})