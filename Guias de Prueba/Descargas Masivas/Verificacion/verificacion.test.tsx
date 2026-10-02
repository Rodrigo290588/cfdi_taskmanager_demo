import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import VerificationMonitorPage from '../../../src/app/mass-downloads/verification/page'

// Mock next-auth
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

// Mock de localStorage
let mockStorageData: Record<string, string> = {}
const mockLocalStorage = {
  getItem: jest.fn((key) => mockStorageData[key] || null),
  setItem: jest.fn((key, val) => { mockStorageData[key] = val }),
  clear: jest.fn(() => { mockStorageData = {} })
}
Object.defineProperty(window, 'localStorage', { value: mockLocalStorage })

// Mock fetch
global.fetch = jest.fn()

describe('Verificación de Solicitudes SAT (VerificationMonitorPage)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockStorageData = {}
  })

  it('1. Renderizado Sin Empresa: Tabla y filtros ocultos', () => {
    render(<VerificationMonitorPage />)
    
    expect(screen.getByText(/Selecciona una empresa en el menú lateral para ver la información/i)).toBeInTheDocument()
    expect(screen.queryByText('Estatus')).not.toBeInTheDocument()
    expect(screen.queryByText('ID Paquete SAT')).not.toBeInTheDocument()
  })

  it('2. Carga Inicial con Empresa y Filtrado de peticiones sin ID', async () => {
    mockStorageData['selectedCompany'] = JSON.stringify({ id: 'org-1', rfc: 'AAA010101AAA' })
    
    const mockData = [
      {
        id: 'req-1',
        createdAt: '2023-10-10T10:00:00Z',
        requestingRfc: 'AAA010101AAA',
        requestType: 'cfdi',
        satPackageId: 'SAT-12345',
        requestStatus: 'EN_PROCESO',
        verificationAttempts: 5,
        nextCheck: '2023-10-10T11:00:00Z',
        packageIds: []
      },
      {
        id: 'req-2',
        createdAt: '2023-10-10T10:00:00Z',
        requestingRfc: 'AAA010101AAA',
        requestType: 'metadata',
        satPackageId: null, // Deberia ser filtrado
        requestStatus: 'SOLICITADO',
        verificationAttempts: 0,
        nextCheck: null,
        packageIds: []
      },
      {
        id: 'req-3',
        createdAt: '2023-10-10T10:00:00Z',
        requestingRfc: 'AAA010101AAA',
        requestType: 'cfdi',
        satPackageId: 'SAT-99999',
        requestStatus: 'TERMINADO',
        updatedAt: '2023-10-10T12:00:00Z',
        verificationAttempts: 2,
        nextCheck: null,
        packageIds: ['zip-1', 'zip-2']
      }
    ]

    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockData)
    })

    render(<VerificationMonitorPage />)
    
    await waitFor(() => {
      // Debe renderizar req-1
      expect(screen.getByText('SAT-12345')).toBeInTheDocument()
      // Debe renderizar req-3
      expect(screen.getByText('SAT-99999')).toBeInTheDocument()
      
      // NO debe renderizar req-2
      expect(screen.queryByText('SOLICITADO')).not.toBeInTheDocument()

      // Validar datos técnicos de req-1
      expect(screen.getByText('5')).toBeInTheDocument() // intentos
      expect(screen.getByText('EN PROCESO')).toBeInTheDocument() // badge
      
      // Validar datos técnicos de req-3
      expect(screen.getByText('TERMINADO')).toBeInTheDocument()
      expect(screen.getByText('2 Paquetes')).toBeInTheDocument()
    })
  })

  it('3. Funcionamiento del Filtro de Estatus por el Usuario', async () => {
    mockStorageData['selectedCompany'] = JSON.stringify({ id: 'org-1', rfc: 'AAA010101AAA' })
    
    const mockData = [
      {
        id: 'req-1',
        createdAt: '2023-10-10T10:00:00Z',
        requestingRfc: 'AAA010101AAA',
        requestType: 'cfdi',
        satPackageId: 'SAT-111',
        requestStatus: 'EN_PROCESO',
        verificationAttempts: 1,
        nextCheck: null,
        packageIds: []
      },
      {
        id: 'req-2',
        createdAt: '2023-10-10T10:00:00Z',
        requestingRfc: 'AAA010101AAA',
        requestType: 'cfdi',
        satPackageId: 'SAT-222',
        requestStatus: 'ERROR',
        verificationAttempts: 10,
        nextCheck: null,
        packageIds: []
      }
    ]

    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData)
    })

    render(<VerificationMonitorPage />)
    
    await waitFor(() => {
      expect(screen.getByText('SAT-111')).toBeInTheDocument()
      expect(screen.getByText('SAT-222')).toBeInTheDocument()
    })

    // Aplicar Filtro "ERROR"
    const selects = screen.getAllByTestId('mock-select')
    fireEvent.change(selects[0], { target: { value: 'ERROR' } })

    await waitFor(() => {
      expect(screen.getByText('SAT-222')).toBeInTheDocument()
      expect(screen.queryByText('SAT-111')).not.toBeInTheDocument()
    })

    // Aplicar Filtro "VENCIDO" donde no hay resultados
    fireEvent.change(selects[0], { target: { value: 'VENCIDO' } })
    
    await waitFor(() => {
      expect(screen.getByText('No hay solicitudes para verificar')).toBeInTheDocument()
    })
  })

  it('4. Manejo de Errores de API (500)', async () => {
    mockStorageData['selectedCompany'] = JSON.stringify({ id: 'org-1', rfc: 'AAA010101AAA' })
    
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false
    })

    render(<VerificationMonitorPage />)
    
    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('Error al cargar la información')
    })
  })
})