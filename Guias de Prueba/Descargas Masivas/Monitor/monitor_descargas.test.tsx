import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import MonitorPage from '../../../src/app/mass-downloads/requests/monitor/page'

// Mock next-auth and next/navigation for ProtectedRoute
jest.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { name: 'Test User' } },
    status: 'authenticated',
  }),
  SessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    refresh: jest.fn(),
  }),
}))

// Mock de Notificaciones
const mockToastError = jest.fn()
jest.mock('sonner', () => ({
  toast: {
    error: (msg: string) => mockToastError(msg),
    success: jest.fn()
  }
}))

// Mock de localStorage
let mockStorageData: Record<string, string> = {}
const mockLocalStorage = {
  getItem: jest.fn((key) => mockStorageData[key] || null),
  setItem: jest.fn((key, val) => { mockStorageData[key] = val }),
  clear: jest.fn(() => { mockStorageData = {} })
}
Object.defineProperty(window, 'localStorage', { value: mockLocalStorage })

// Mock de Select de Radix UI
jest.mock('../../../src/components/ui/select', () => ({
  Select: ({ onValueChange, children, value }: { onValueChange: (v: string) => void, children: React.ReactNode, value?: string }) => (
    <select 
      data-testid="mock-select" 
      onChange={(e) => onValueChange(e.target.value)}
      value={value}
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => <option value="">{placeholder}</option>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string, children: React.ReactNode }) => <option value={value}>{children}</option>,
}))

// Mock fetch
global.fetch = jest.fn()

describe('Monitor de Solicitudes (MonitorPage)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockStorageData = {}
  })

  it('1. Renderizado Sin Empresa: Botones bloqueados y advertencia visible', () => {
    render(<MonitorPage />)
    
    expect(screen.getByText('Selecciona una empresa en el menú principal para comenzar')).toBeInTheDocument()
    
    const btnActualizar = screen.getByRole('button', { name: /Actualizar/i })
    const btnBuscar = screen.getByRole('button', { name: /Buscar/i })
    
    expect(btnActualizar).toBeDisabled()
    expect(btnBuscar).toBeDisabled()
  })

  it('2. Carga Inicial con Empresa Activa y Renderizado de Badges', async () => {
    mockStorageData['selectedCompany'] = JSON.stringify({ id: 'org-1', rfc: 'AAA010101AAA', businessName: 'Empresa Test' })
    
    const mockData = [
      {
        id: '1',
        createdAt: '2023-10-10T10:00:00Z',
        retrievalType: 'emitidos',
        startDate: '2023-10-01T00:00:00Z',
        endDate: '2023-10-05T00:00:00Z',
        requestType: 'metadata',
        receiverRfc: 'BBB010101BBB',
        satPackageId: 'SAT-123',
        requestStatus: 'ACEPTADO',
        satMessage: 'Exito'
      },
      {
        id: '2',
        createdAt: '2023-10-11T10:00:00Z',
        retrievalType: 'folio',
        folio: '11111111-2222-3333-4444-555555555555',
        requestType: 'cfdi',
        issuerRfc: 'AAA010101AAA',
        satPackageId: null,
        requestStatus: 'ERROR',
        satMessage: 'Límite alcanzado'
      }
    ]

    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockData)
    })

    render(<MonitorPage />)
    
    expect(screen.getByText('Consultando para:')).toBeInTheDocument()
    expect(screen.getByText('Empresa Test')).toBeInTheDocument()

    await waitFor(() => {
      // Validar renderizado condicional de Fechas
      expect(screen.getByText(/Del:/)).toBeInTheDocument() 
      expect(screen.getByText(/Al:/)).toBeInTheDocument() 
      // Validar renderizado condicional de Folio UUID
      expect(screen.getByText('11111111-2222-3333-4444-555555555555')).toBeInTheDocument()
      
      // Validar Badges Visuales
      expect(screen.getByText('Completado')).toBeInTheDocument() // ACEPTADO
      expect(screen.getByText('Error')).toBeInTheDocument() // ERROR
    })
  })

  it('3. Ejecución de Filtros y Botón Buscar', async () => {
    mockStorageData['selectedCompany'] = JSON.stringify({ id: 'org-1', rfc: 'AAA010101AAA' })
    
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([])
    })

    render(<MonitorPage />)
    
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/mass-downloads/requests?rfc=AAA010101AAA')
    })
    
    // Cambiar folio y buscar
    const inputFolio = screen.getByPlaceholderText('Buscar por UUID...')
    fireEvent.change(inputFolio, { target: { value: 'uuid-test-123' } })
    
    const btnBuscar = screen.getByRole('button', { name: /Buscar/i })
    fireEvent.click(btnBuscar)
    
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/mass-downloads/requests?rfc=AAA010101AAA&folio=uuid-test-123')
    })
  })

  it('4. Manejo de Errores de API (500)', async () => {
    mockStorageData['selectedCompany'] = JSON.stringify({ id: 'org-1', rfc: 'AAA010101AAA' })
    
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false
    })

    render(<MonitorPage />)
    
    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('Error al cargar la información')
    })
  })
})