import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

// 1. Mock de navegación
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}))

// 2. Mock de sesión
jest.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { id: 'USER-1', name: 'Test Admin', email: 'admin@example.com' } },
    status: 'authenticated',
  }),
}))

// 3. Mock de Permisos (Controlado por variable global en el test)
let mockIsAdmin = true
jest.mock('../../src/components/auth/permission-guard', () => ({
  PermissionRequired: ({ children }: { children: React.ReactNode }) => {
    if (!mockIsAdmin) return <div>Acceso Denegado</div>
    return <>{children}</>
  },
}))

jest.mock('../../src/components/auth/protected-route', () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

// 4. Mock ResizeObserver (requerido por componentes UI)
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// 5. Mock de Tabs para simplificar renderizado en JSDOM
jest.mock('../../src/components/ui/tabs', () => ({
  Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children, onClick }: { children: React.ReactNode, onClick?: () => void }) => <button onClick={onClick}>{children}</button>,
  TabsContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

import AdminDashboardPage from '../../src/app/admin/dashboard/page'

const mockDashboardData = {
  statistics: { 
    totalCompanies: 15, 
    pendingCompanies: 3, 
    approvedCompanies: 10, 
    rejectedCompanies: 2, 
    totalUsers: 42, 
    approvalRate: 66.6 
  },
  trends: { monthly: [], labels: [] },
  topIndustries: [{ industry: 'Tecnología', count: 8 }],
  topStates: [{ state: 'Jalisco', count: 5 }],
  recentCompanies: [
    { id: 'COMP-1', name: 'Pendiente SA', rfc: 'PEN123456789', status: 'PENDING', createdAt: '2026-09-30T10:00:00Z', createdBy: 'user1' },
    { id: 'COMP-2', name: 'Aprobada SA', rfc: 'APR123456789', status: 'APPROVED', createdAt: '2026-09-29T10:00:00Z', createdBy: 'user2' }
  ],
  recentAuditLogs: [
    { id: 'LOG-1', action: 'CREATE', description: 'Empresa registrada', userEmail: 'juan.perez@empresa.com', timestamp: '2026-09-30T10:00:00Z' }
  ]
}

describe('Panel de Administración (/admin/dashboard)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockIsAdmin = true // Reset para cada prueba
    
    // Interceptar llamadas al API
    global.fetch = jest.fn((url: string) => {
      if (url.includes('/api/admin/dashboard')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockDashboardData) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    }) as jest.Mock
  })

  it('CP01: Bloquea a usuarios sin privilegios y permite a administradores', async () => {
    // Prueba 1: Simular ser Usuario Normal (sin permisos)
    mockIsAdmin = false
    const { unmount } = render(<AdminDashboardPage />)
    
    // Esperar a que pase el estado de carga y muestre el acceso denegado
    await waitFor(() => {
      expect(screen.getByText('Acceso Denegado')).toBeInTheDocument()
    })
    unmount()

    // Prueba 2: Simular ser Administrador
    mockIsAdmin = true
    render(<AdminDashboardPage />)
    await waitFor(() => {
      expect(screen.getByText('Panel de Administración')).toBeInTheDocument()
    })
  })

  it('CP02: Muestra correctamente las tarjetas de indicadores (KPIs)', async () => {
    render(<AdminDashboardPage />)
    
    // Esperar a que cargue la información
    await waitFor(() => {
      expect(screen.getByText('Total Empresas')).toBeInTheDocument()
    })
    
    // Validar cifras exactas
    expect(screen.getByText('15')).toBeInTheDocument() // Total
    expect(screen.getByText(/66\.6% tasa de aprobación/i)).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument() // Pendientes
    expect(screen.getByText('10')).toBeInTheDocument() // Aprobadas
    expect(screen.getByText('42')).toBeInTheDocument() // Usuarios
  })

  it('CP03: Muestra correctamente el Top Industrias y Top Estados en la pestaña Resumen', async () => {
    render(<AdminDashboardPage />)
    await waitFor(() => {
      expect(screen.getByText('Panel de Administración')).toBeInTheDocument()
    })

    // Validar Top Industrias
    expect(screen.getByText('Top Industrias')).toBeInTheDocument()
    expect(screen.getByText('Tecnología')).toBeInTheDocument()
    expect(screen.getByText('8')).toBeInTheDocument()

    // Validar Top Estados
    expect(screen.getByText('Top Estados')).toBeInTheDocument()
    expect(screen.getByText('Jalisco')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('CP04: Permite navegar por la bandeja de empresas y valida estado de botones', async () => {
    render(<AdminDashboardPage />)
    await waitFor(() => {
      expect(screen.getByText('Panel de Administración')).toBeInTheDocument()
    })

    // Al estar mockeado el componente Tabs para mostrar todo, validamos directamente el contenido
    await waitFor(() => {
      expect(screen.getByText('Pendiente SA')).toBeInTheDocument()
      expect(screen.getByText('Aprobada SA')).toBeInTheDocument()
    })

    // Encontrar el botón (ojo) correspondiente a la empresa Pendiente
    const rowPendiente = screen.getByText('Pendiente SA').closest('div.flex.items-center.justify-between')
    const btnPendiente = rowPendiente?.querySelector('button')
    // El botón debe estar habilitado porque está pendiente
    expect(btnPendiente).not.toBeDisabled()

    // Encontrar el botón (ojo) correspondiente a la empresa Aprobada
    const rowAprobada = screen.getByText('Aprobada SA').closest('div.flex.items-center.justify-between')
    const btnAprobada = rowAprobada?.querySelector('button')
    // El botón debe estar bloqueado (disabled) porque ya se aprobó
    expect(btnAprobada).toBeDisabled()
  })

  it('CP05: Protege la privacidad ocultando correos electrónicos (PII) en Actividad', async () => {
    render(<AdminDashboardPage />)
    await waitFor(() => {
      expect(screen.getByText('Panel de Administración')).toBeInTheDocument()
    })

    await waitFor(() => {
      // El correo real (juan.perez@empresa.com) NO debe existir en el documento
      expect(screen.queryByText('juan.perez@empresa.com')).not.toBeInTheDocument()
      
      // Debe existir la versión censurada (ej. ju********@******a.com)
      // Usamos una expresión regular para encontrar el texto enmascarado
      const maskedEmail = screen.getByText(/ju.*@.*a\.com/i)
      expect(maskedEmail).toBeInTheDocument()
    })
  })

  it('CP06: Maneja errores de conexión y permite reintentar', async () => {
    // 1. Simular un error inicial (caída de red/servidor)
    ;(global.fetch as jest.Mock).mockImplementationOnce(() => 
      Promise.resolve({ ok: false, json: () => Promise.resolve({ error: 'Network Error' }) })
    )

    render(<AdminDashboardPage />)
    
    // Validar que aparezca la pantalla de error y el botón de reintento
    await waitFor(() => {
      expect(screen.getByText('Error al cargar el dashboard')).toBeInTheDocument()
    })
    const btnReintentar = screen.getByRole('button', { name: /Reintentar/i })
    expect(btnReintentar).toBeInTheDocument()

    // 2. Simular que el internet regresó y la llamada será exitosa
    ;(global.fetch as jest.Mock).mockImplementationOnce(() => 
      Promise.resolve({ ok: true, json: () => Promise.resolve(mockDashboardData) })
    )
    
    // Hacer clic en Reintentar
    fireEvent.click(btnReintentar)

    // Validar que el panel cargue correctamente
    await waitFor(() => {
      expect(screen.getByText('Panel de Administración')).toBeInTheDocument()
    })
  })
})