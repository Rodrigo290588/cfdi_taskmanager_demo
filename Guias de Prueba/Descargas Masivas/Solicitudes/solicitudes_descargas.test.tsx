import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { MassDownloadRequestForm } from '../../../src/components/mass-downloads/request-form'

// Mock de Notificaciones
const mockToastError = jest.fn()
const mockToastSuccess = jest.fn()
jest.mock('sonner', () => ({
  toast: {
    error: (msg: string, opts?: unknown) => mockToastError(msg, opts),
    success: (msg: string, opts?: unknown) => mockToastSuccess(msg, opts)
  }
}))

// Mock de localStorage
const mockLocalStorage = {
  getItem: jest.fn((key) => {
    if (key === 'selectedCompany') return JSON.stringify({ id: 'org-1', rfc: 'AAA010101AAA' })
    return null
  }),
  setItem: jest.fn(),
  clear: jest.fn()
}
Object.defineProperty(window, 'localStorage', { value: mockLocalStorage })

// Mock de Select de Radix UI para pruebas en JSDOM
jest.mock('../../../src/components/ui/select', () => ({
  Select: ({ onValueChange, children, defaultValue }: { onValueChange: (v: string) => void, children: React.ReactNode, defaultValue?: string }) => (
    <select 
      data-testid="mock-select" 
      onChange={(e) => onValueChange(e.target.value)}
      defaultValue={defaultValue}
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => <option value="">{placeholder}</option>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string, children: React.ReactNode }) => <option value={value}>{children}</option>,
}))

global.fetch = jest.fn()

describe('Solicitudes de Descargas Masivas (MassDownloadRequestForm)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('1. Renderizado y Dinamismo de UI (Cambio de Tipo de Solicitud)', async () => {
    render(<MassDownloadRequestForm />)
    
    expect(screen.getByText('Nueva Solicitud de Descarga')).toBeInTheDocument()
    
    // Por defecto es "Emitidos", la fecha inicial debe existir
    expect(screen.getByLabelText(/Fecha Inicial de Emisión/i)).toBeInTheDocument()
    
    // Cambiamos a "Por Folio"
    const selects = screen.getAllByTestId('mock-select')
    // El select de Tipo de Solicitud suele ser el primero en el grid
    fireEvent.change(selects[0], { target: { value: 'folio' } })
    
    await waitFor(() => {
      // Al cambiar a folio, aparece el campo UUID y las fechas se ocultan
      expect(screen.getByLabelText(/Folio UUID/i)).toBeInTheDocument()
      expect(screen.queryByLabelText(/Fecha Inicial de Emisión/i)).not.toBeInTheDocument()
    })
  })

  it('2. Escenario de Error: Fechas Faltantes y Año Inválido', async () => {
    render(<MassDownloadRequestForm />)
    
    const selects = screen.getAllByTestId('mock-select')
    fireEvent.change(selects[0], { target: { value: 'emitidos' } })
    
    const submitBtn = screen.getByRole('button', { name: /Enviar Solicitud/i })
    
    fireEvent.submit(submitBtn.closest('form') as HTMLFormElement)
    
    await waitFor(() => {
      expect(screen.getByText('La fecha inicial es requerida')).toBeInTheDocument()
      expect(screen.getByText('La fecha final es requerida')).toBeInTheDocument()
    })

    const fechaInicial = screen.getAllByLabelText(/Fecha Inicial de Emisión/i)[0]
    fireEvent.change(fechaInicial, { target: { value: '2010-05-05' } })
    
    fireEvent.submit(submitBtn.closest('form') as HTMLFormElement)

    await waitFor(() => {
      expect(screen.getByText('La fecha debe ser a partir del año 2011')).toBeInTheDocument()
    })
  })

  it('3. Escenario de Error: UUID Incompleto', async () => {
    render(<MassDownloadRequestForm />)
    
    const selects = screen.getAllByTestId('mock-select')
    fireEvent.change(selects[0], { target: { value: 'folio' } })
    
    await waitFor(() => {
      expect(screen.getByLabelText(/Folio UUID/i)).toBeInTheDocument()
    })
    
    const folioInput = screen.getByLabelText(/Folio UUID/i)
    fireEvent.change(folioInput, { target: { value: '123456781234' } })
    
    const submitBtn = screen.getByRole('button', { name: /Enviar Solicitud/i })
    
    fireEvent.submit(submitBtn.closest('form') as HTMLFormElement)
    
    await waitFor(() => {
      expect(screen.getByText('El folio debe tener un formato UUID válido')).toBeInTheDocument()
    })
  })

  it('4. Escenario de Error: Rechazo del Backend (SAT)', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ details: 'Límite de peticiones alcanzado en el SAT' })
    })

    render(<MassDownloadRequestForm />)
    
    const selects = screen.getAllByTestId('mock-select')
    fireEvent.change(selects[0], { target: { value: 'folio' } })
    
    const folioInput = screen.getByLabelText(/Folio UUID/i)
    fireEvent.change(folioInput, { target: { value: '11111111-2222-3333-4444-555555555555' } })
    
    const submitBtn = screen.getByRole('button', { name: /Enviar Solicitud/i })
    
    fireEvent.submit(submitBtn.closest('form') as HTMLFormElement)
    
    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('Límite de peticiones alcanzado en el SAT', expect.any(Object))
    })
  })

  it('5. Escenario de Éxito Total (Happy Path)', async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([{ id: 'INT-999', satPackageId: 'SAT-XYZ-123' }])
    })

    render(<MassDownloadRequestForm />)
    
    const selects = screen.getAllByTestId('mock-select')
    fireEvent.change(selects[0], { target: { value: 'folio' } })
    
    const folioInput = screen.getByLabelText(/Folio UUID/i)
    fireEvent.change(folioInput, { target: { value: '11111111-2222-3333-4444-555555555555' } })
    
    const submitBtn = screen.getByRole('button', { name: /Enviar Solicitud/i })
    
    fireEvent.submit(submitBtn.closest('form') as HTMLFormElement)
    
    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith(
        expect.stringContaining('Solicitud registrada correctamente'),
        expect.any(Object)
      )
    })
  })
})