import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import MassDownloadsFiscalControlPage from '../../../src/app/mass-downloads/fiscal-control/page'

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
jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
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

// Mock de Recharts
jest.mock('recharts', () => {
  const OriginalModule = jest.requireActual('recharts')
  return {
    ...OriginalModule,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="responsive-container">{children}</div>,
    BarChart: () => <div data-testid="bar-chart" />,
    PieChart: () => <div data-testid="pie-chart" />,
  }
})

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

describe('Control Fiscal (MassDownloadsFiscalControlPage)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockStorageData = {}
  })

  it('1. Renderizado Sin Empresa: Mensaje restrictivo', () => {
    render(<MassDownloadsFiscalControlPage />)
    
    expect(screen.getByText(/Selecciona una empresa/i)).toBeInTheDocument()
    expect(screen.queryByText('Panel de Control Fiscal CFDI')).not.toBeInTheDocument()
  })

  it('2. Carga Inicial, KPIs y Alerta de Discrepancia', async () => {
    mockStorageData['selectedCompany'] = JSON.stringify({ id: 'org-1', rfc: 'AAA010101AAA' })
    
    const mockData = {
      kpis: {
        metadataTotal: 1500,
        xmlTotal: 1400,
        completenessPercent: 93.333
      },
      cancelationStats: {
        vigentes: 1300,
        cancelados: 100,
        totalCanceladoAmount: 50000.50
      },
      monthly: [],
      discrepancyAlert: true,
      discrepancyPercent: 6.666,
      table: {
        rows: [],
        pagination: { page: 1, pageSize: 50, total: 0, totalPages: 1 }
      }
    }

    // Mock para las preferencias de usuario (columnas) y los datos
    ;(global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/api/user/profile')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
      }
      if (url.includes('/api/mass-downloads/fiscal-control')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockData) })
      }
      return Promise.resolve({ ok: false })
    })

    render(<MassDownloadsFiscalControlPage />)
    
    await waitFor(() => {
      expect(screen.getByText('1,500')).toBeInTheDocument() // metadata
      expect(screen.getByText('1,400')).toBeInTheDocument() // xml
      expect(screen.getByText('93.33%')).toBeInTheDocument() // completeness
      
      // Alerta de discrepancia
      expect(screen.getByText('Alerta de discrepancia: 6.67% de diferencia')).toBeInTheDocument()

      // Monto cancelado formateado
      expect(screen.getByText('$50,000.50')).toBeInTheDocument()
    })
  })

  it('3. Autocompletado de RFCs', async () => {
    mockStorageData['selectedCompany'] = JSON.stringify({ id: 'org-1', rfc: 'AAA010101AAA' })
    
    const mockData = {
      kpis: { metadataTotal: 0, xmlTotal: 0, completenessPercent: 0 },
      cancelationStats: { vigentes: 0, cancelados: 0, totalCanceladoAmount: 0 },
      monthly: [],
      discrepancyAlert: false,
      discrepancyPercent: 0,
      table: {
        rows: [
          { uuid: '111', issuerRfc: 'EMISOR123', receiverRfc: 'RECEPTOR123' },
          { uuid: '222', issuerRfc: 'EMISOR456', receiverRfc: 'RECEPTOR456' }
        ],
        pagination: { page: 1, pageSize: 50, total: 2, totalPages: 1 }
      }
    }

    ;(global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/api/user/profile')) return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
      if (url.includes('/api/mass-downloads/fiscal-control')) return Promise.resolve({ ok: true, json: () => Promise.resolve(mockData) })
      return Promise.resolve({ ok: false })
    })

    render(<MassDownloadsFiscalControlPage />)
    
    await waitFor(() => {
      expect(screen.getByPlaceholderText('RFC emisor o receptor')).toBeInTheDocument()
    })

    const inputRfc = screen.getByPlaceholderText('RFC emisor o receptor')
    fireEvent.change(inputRfc, { target: { value: 'EMI' } })

    // Debe mostrar las sugerencias
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'EMISOR123' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'EMISOR456' })).toBeInTheDocument()
    })

    // Hacer clic en sugerencia
    fireEvent.click(screen.getByRole('button', { name: 'EMISOR123' }))
    
    expect(inputRfc).toHaveValue('EMISOR123')
  })

  it('4. Interacción del Data Grid: Columnas y Footer Sumatorio', async () => {
    mockStorageData['selectedCompany'] = JSON.stringify({ id: 'org-1', rfc: 'AAA010101AAA' })
    
    const mockXml1 = `<cfdi:Comprobante Total="100.50" SubTotal="80.00" Descuento="0.00" Moneda="MXN" />`
    const mockXml2 = `<cfdi:Comprobante Total="200.25" SubTotal="160.00" Descuento="0.00" Moneda="MXN" />`
    
    const mockData = {
      kpis: { metadataTotal: 0, xmlTotal: 0, completenessPercent: 0 },
      cancelationStats: { vigentes: 0, cancelados: 0, totalCanceladoAmount: 0 },
      monthly: [],
      discrepancyAlert: false,
      discrepancyPercent: 0,
      table: {
        rows: [
          { uuid: '111', total: 0, subtotal: 0, discount: 0, xmlContent: mockXml1 },
          { uuid: '222', total: 0, subtotal: 0, discount: 0, xmlContent: mockXml2 }
        ],
        pagination: { page: 1, pageSize: 50, total: 2, totalPages: 1 }
      }
    }

    ;(global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/api/user/profile')) return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
      if (url.includes('/api/mass-downloads/fiscal-control')) return Promise.resolve({ ok: true, json: () => Promise.resolve(mockData) })
      return Promise.resolve({ ok: false })
    })

    render(<MassDownloadsFiscalControlPage />)
    
    await waitFor(() => {
      // Validar montos extraídos con regex (100.50 + 200.25 = 300.75)
      expect(screen.getByText('$100.50')).toBeInTheDocument()
      expect(screen.getByText('$200.25')).toBeInTheDocument()
    })

    // Validar sumatoria en footer (300.75)
    // El footer debe tener la sumatoria del Total
    expect(screen.getByText('$300.75')).toBeInTheDocument()

    // Abrir panel de columnas
    const btnColumnas = screen.getByRole('button', { name: /Columnas/i })
    fireEvent.click(btnColumnas)

    await waitFor(() => {
      expect(screen.getByText('Columnas visibles')).toBeInTheDocument()
    })

    // Encontrar checkbox de Total (asumiendo que tiene un label o podemos buscar por role)
    // Como las etiquetas están envueltas en <label>, podemos buscar el texto y encontrar el checkbox asociado
    const labelTotal = screen.getAllByText('Total').find(el => el.tagName.toLowerCase() === 'label')
    expect(labelTotal).toBeDefined()
    
    const checkboxTotal = labelTotal!.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(checkboxTotal).toBeChecked()

    // Desmarcar Total
    fireEvent.click(checkboxTotal)

    await waitFor(() => {
      // La columna Total debe desaparecer, por ende $300.75 no debería estar en el footer visible para la columna Total.
      // Sin embargo, todavía existen Subtotales.
      // Comprobemos que ya no está chequeado
      expect(checkboxTotal).not.toBeChecked()
    })
  })
})