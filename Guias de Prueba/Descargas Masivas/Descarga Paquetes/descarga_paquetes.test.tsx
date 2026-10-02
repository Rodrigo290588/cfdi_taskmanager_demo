import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import PackageDownloadsPage from '../../../src/app/mass-downloads/package-downloads/page'

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
const mockToastSuccess = jest.fn()
jest.mock('sonner', () => ({
  toast: {
    error: (msg: string) => mockToastError(msg),
    success: (msg: string) => mockToastSuccess(msg)
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

// Mock fetch
global.fetch = jest.fn()

describe('Descarga de Paquetes (PackageDownloadsPage)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockStorageData = {}
  })

  it('1. Renderizado Sin Empresa: Tabla y tarjetas ocultas', () => {
    render(<PackageDownloadsPage />)
    
    expect(screen.getByText(/Selecciona una empresa en el menú lateral/i)).toBeInTheDocument()
    
    // No deben existir las tarjetas de KPIs
    expect(screen.queryByText('XML CFDI a descargar')).not.toBeInTheDocument()
    expect(screen.queryByText('Solicitudes de paquetes')).not.toBeInTheDocument()
  })

  it('2. Carga Inicial, KPIs y Tabla con Empresa Activa', async () => {
    mockStorageData['selectedCompany'] = JSON.stringify({ id: 'org-1', rfc: 'AAA010101AAA', businessName: 'Empresa Test' })
    
    const mockData = [
      {
        id_solicitud: 'REQ-001',
        rfc: 'AAA010101AAA',
        estado_code: 3,
        estado_texto: 'Finalizado',
        progreso: 100,
        paquetes: ['paquete_A_1.zip', 'paquete_A_2.zip'],
        fecha_vencimiento: '2023-10-31T00:00:00Z',
        fecha_peticion: '2023-10-01T00:00:00Z',
        periodoMes: 9,
        periodoAnio: 2023,
        totalXml: 1500,
        descargadosXml: 1000,
        requestType: 'cfdi'
      },
      {
        id_solicitud: 'REQ-002',
        rfc: 'AAA010101AAA',
        estado_code: 1,
        estado_texto: 'Pendiente',
        progreso: 10,
        paquetes: [],
        fecha_vencimiento: '2023-10-31T00:00:00Z',
        fecha_peticion: '2023-10-02T00:00:00Z',
        periodoMes: 10,
        periodoAnio: 2023,
        totalXml: 500,
        descargadosXml: 0,
        requestType: 'metadata'
      }
    ]

    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockData)
    })

    render(<PackageDownloadsPage />)
    
    await waitFor(() => {
      // Validar KPIs de CFDI
      expect(screen.getByText('XML CFDI a descargar')).toBeInTheDocument()
      expect(screen.getByText('1500')).toBeInTheDocument()
      expect(screen.getByText('1000')).toBeInTheDocument() // Descargados
      
      // Validar KPIs de Metadata
      expect(screen.getByText('500')).toBeInTheDocument()
      
      // Validar Tabla
      expect(screen.getByText('09/2023')).toBeInTheDocument() // Formateo de periodo
      expect(screen.getByText('10/2023')).toBeInTheDocument()
      
      // Validar Badges de Estado
      expect(screen.getByText('Finalizado')).toBeInTheDocument()
      expect(screen.getByText('Pendiente')).toBeInTheDocument()
    })
    
    // Validar visibilidad del botón Ver Paquetes
    const verPaquetesBtns = screen.getAllByRole('button', { name: /Ver paquetes/i })
    expect(verPaquetesBtns).toHaveLength(1) // Solo REQ-001 debe tenerlo porque es estatus 3
  })

  it('3. Interacción con Panel Lateral (Drawer) y Descarga de ZIP', async () => {
    mockStorageData['selectedCompany'] = JSON.stringify({ id: 'org-1', rfc: 'AAA010101AAA' })
    
    const mockData = [
      {
        id_solicitud: 'REQ-001',
        rfc: 'AAA010101AAA',
        estado_code: 3,
        estado_texto: 'Finalizado',
        progreso: 100,
        paquetes: ['paquete_A_1.zip'],
        fecha_vencimiento: '2023-10-31T00:00:00Z',
        fecha_peticion: '2023-10-01T00:00:00Z',
        periodoMes: 9,
        periodoAnio: 2023,
        totalXml: 150,
        descargadosXml: 150,
        requestType: 'cfdi'
      }
    ]

    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockData)
    })

    render(<PackageDownloadsPage />)
    
    await waitFor(() => {
      expect(screen.getByText('REQ-001')).toBeInTheDocument()
    })

    // Abrir Drawer
    const btnVerPaquetes = screen.getByRole('button', { name: /Ver paquetes/i })
    fireEvent.click(btnVerPaquetes)

    // Validar Drawer abierto
    expect(screen.getByText('Detalle de solicitud')).toBeInTheDocument()
    expect(screen.getByText('paquete_A_1.zip')).toBeInTheDocument()

    // Espiar creacion de elemento anchor
    const originalCreateElement = document.createElement
    let mockAnchor: HTMLAnchorElement | null = null
    document.createElement = jest.fn((tagName) => {
      if (tagName === 'a') {
        mockAnchor = originalCreateElement.call(document, 'a') as HTMLAnchorElement
        mockAnchor.click = jest.fn()
        return mockAnchor
      }
      return originalCreateElement.call(document, tagName)
    })

    // Simular Clic en descargar nube
    // El boton de descarga tiene el aria-label no definido, pero podemos buscar por el texto del paquete y su sibling, o usar getAllByRole
    // Como solo hay un botón en la fila del paquete, buscaremos los botones dentro del drawer. 
    // "✕" es un botón, y la nube es otro.
    const botonesDrawer = screen.getAllByRole('button')
    // El último botón es probablemente el de descarga de la nube
    const btnDescargar = botonesDrawer[botonesDrawer.length - 1]
    
    fireEvent.click(btnDescargar)

    await waitFor(() => {
      // Validar que se llamó la URL correcta
      expect(mockAnchor).not.toBeNull()
      if (mockAnchor) {
        expect(mockAnchor.href).toContain('/api/mass-downloads/download-zip?rfc=AAA010101AAA&idPaquete=paquete_A_1.zip')
        expect(mockAnchor.click).toHaveBeenCalled()
      }
      
      // Validar Toast
      expect(mockToastSuccess).toHaveBeenCalledWith('Descargando paquete paquete_A_1.zip...')
    })

    // Cerrar Drawer
    const btnCerrar = screen.getByRole('button', { name: /✕/i })
    fireEvent.click(btnCerrar)

    expect(screen.queryByText('Detalle de solicitud')).not.toBeInTheDocument()
    
    // Restore
    document.createElement = originalCreateElement
  })
})