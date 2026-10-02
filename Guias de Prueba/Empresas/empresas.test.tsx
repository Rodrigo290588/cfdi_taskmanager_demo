import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

// 1. Mock de next/navigation ANTES de importar los componentes
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    refresh: jest.fn(),
  }),
  useParams: () => ({
    id: 'COMP-123',
  }),
}))

// 2. Mock de next-auth/react para simular sesión de usuario
jest.mock('next-auth/react', () => ({
  useSession: () => ({
    data: {
      user: { id: 'USER-1', name: 'Test User', email: 'test@example.com' },
    },
    status: 'authenticated',
  }),
}))

// Mock de Permissions (PermissionRequired Guard)
jest.mock('../../src/components/auth/permission-guard', () => ({
  PermissionRequired: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

jest.mock('../../src/components/auth/protected-route', () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

// 3. Mock de ResizeObserver (requerido por Radix UI / Shadcn)
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// 4. Importar componentes
import CompaniesSearchPage from '../../src/app/companies/search/page'
import CompanyApprovalPage from '../../src/app/companies/[id]/approve/page'
import CompanyRegistrationForm from '../../src/components/companies/company-registration-form'

// ==========================================
// MOCKS DE DATOS (API Responses)
// ==========================================
const mockCompanyDetails = {
  company: {
    id: 'COMP-123',
    name: 'Empresa Test SA',
    rfc: 'TES010203XX1',
    businessName: 'Empresa Test SA de CV',
    taxRegime: 'General de Ley Personas Morales',
    status: 'PENDING',
    createdAt: '2026-09-30T10:00:00Z',
    createdBy: 'test@example.com',
    website: 'https://www.seguro.com',
  },
  auditLogs: [
    {
      id: 'LOG-1',
      description: 'Empresa registrada',
      userEmail: 'test@example.com',
      timestamp: '2026-09-30T10:00:00Z'
    }
  ]
}

const mockSearchResponse = {
  companies: [
    {
      id: 'COMP-123',
      name: 'Empresa Test SA',
      rfc: 'TES010203XX1',
      status: 'PENDING',
      createdAt: '2026-09-30T10:00:00Z',
    }
  ],
  pagination: { total: 1, page: 1, limit: 20, totalPages: 1 },
  filters: { taxRegimes: [], industries: [], states: [] }
}

describe('Modulo de Empresas (/companies)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    
    // Interceptar fetch
    global.fetch = jest.fn((url: string, options?: RequestInit) => {
      if (url.includes('/api/companies/search')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockSearchResponse) })
      }
      if (url.includes('/api/companies/COMP-123')) {
        if (options?.method === 'POST') {
          return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) })
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockCompanyDetails) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    }) as jest.Mock
  })

  // ---------------------------------------------------------
  // CP01: Búsqueda y Filtros
  // ---------------------------------------------------------
  it('CP01: Renderiza la tabla de búsqueda y permite filtrar', async () => {
    render(<CompaniesSearchPage />)
    
    // Esperar que cargue la tabla inicial
    await waitFor(() => {
      expect(screen.getByText('Empresa Test SA')).toBeInTheDocument()
    })
    
    // Abrir filtros avanzados
    const btnFiltros = screen.getByRole('button', { name: /Filtros/i })
    fireEvent.click(btnFiltros)
    
    // Buscar
    const searchInput = screen.getByPlaceholderText(/Buscar por nombre, RFC/i)
    fireEvent.change(searchInput, { target: { value: 'TES010203XX1' } })
    
    // Aplicar
    const btnBuscar = screen.getByRole('button', { name: /Buscar/i })
    fireEvent.click(btnBuscar)
    
    await waitFor(() => {
      const fetchCalls = (global.fetch as jest.Mock).mock.calls
      const searchCalls = fetchCalls.filter(c => c[0].includes('/api/companies/search?'))
      const lastCallUrl = searchCalls[searchCalls.length - 1][0]
      expect(lastCallUrl).toContain('query=TES010203XX1')
    })
  })

  // ---------------------------------------------------------
  // CP02 & CP03: Registro y Validación de Errores (Campos obligatorios)
  // ---------------------------------------------------------
  it('CP02/CP03: Valida campos obligatorios al registrar una empresa', async () => {
    // Renderizamos el formulario directamente para facilitar las pruebas de JSDOM
    render(<CompanyRegistrationForm mode="create" onSaved={jest.fn()} onClose={jest.fn()} />)
    
    // Intentar guardar en blanco (el formulario usa type="submit")
    const btnGuardar = screen.getByRole('button', { name: /Registrar Empresa/i })
    fireEvent.click(btnGuardar)
    
    // El formulario usa Zod/react-hook-form, esperamos los mensajes de error
    await waitFor(() => {
      // Shadcn/React-Hook-Form normalmente pinta textos descriptivos
      expect(screen.getAllByText(/requerido|obligatorio|debe contener|requerida/i).length).toBeGreaterThan(0)
    })
    
    // Llenar RFC incorrecto (muy corto)
    const inputs = screen.getAllByRole('textbox')
    // El RFC es el segundo input (0: nombre, 1: RFC)
    const inputRfc = inputs[1]
    fireEvent.change(inputRfc, { target: { value: 'CORTO' } })
    fireEvent.click(btnGuardar)
    
    await waitFor(() => {
      // Zod RFC regex/length validation (puede ser RFC inválido o error de caracteres dependiendo del regex)
      expect(screen.getAllByText(/inválido|caracteres/i).length).toBeGreaterThan(0)
    })
  })

  // ---------------------------------------------------------
  // CP04 & CP05: Flujo de Aprobación y Rechazo
  // ---------------------------------------------------------
  it('CP04: Permite aprobar una empresa pendiente', async () => {
    render(<CompanyApprovalPage />)
    
    // Esperar a que carguen los detalles
    await waitFor(() => {
      expect(screen.getByText('Empresa Test SA')).toBeInTheDocument()
      expect(screen.getByText('General de Ley Personas Morales')).toBeInTheDocument()
    })
    
    // Clic en Aprobar
    const btnAprobar = screen.getByRole('button', { name: /Aprobar Empresa/i })
    fireEvent.click(btnAprobar)
    
    // Validar petición POST al backend
    await waitFor(() => {
      const fetchCalls = (global.fetch as jest.Mock).mock.calls
      const postCalls = fetchCalls.filter(c => c[0].includes('COMP-123') && c[1]?.method === 'POST')
      expect(postCalls.length).toBeGreaterThan(0)
      
      const body = JSON.parse(postCalls[0][1].body)
      expect(body.action).toBe('approve')
    })
  })

  it('CP05: Bloquea rechazo sin motivo y permite rechazar con motivo', async () => {
    render(<CompanyApprovalPage />)
    
    await waitFor(() => {
      expect(screen.getByText('Empresa Test SA')).toBeInTheDocument()
    })
    
    // Mostrar formulario de rechazo
    const btnRechazarInit = screen.getByRole('button', { name: /Rechazar Empresa/i })
    fireEvent.click(btnRechazarInit)
    
    // Intentar confirmar sin escribir motivo (el botón debe estar deshabilitado)
    const btnConfirmarRechazo = screen.getByRole('button', { name: /Confirmar Rechazo/i })
    expect(btnConfirmarRechazo).toBeDisabled()
    
    // Escribir motivo
    const txtMotivo = screen.getByPlaceholderText(/Describe el motivo/i)
    fireEvent.change(txtMotivo, { target: { value: 'RFC Invalido' } })
    
    // Ahora el botón debe estar habilitado
    expect(btnConfirmarRechazo).not.toBeDisabled()
    fireEvent.click(btnConfirmarRechazo)
    
    // Validar petición POST al backend
    await waitFor(() => {
      const fetchCalls = (global.fetch as jest.Mock).mock.calls
      const postCalls = fetchCalls.filter(c => c[0].includes('COMP-123') && c[1]?.method === 'POST')
      expect(postCalls.length).toBeGreaterThan(0)
      
      const body = JSON.parse(postCalls[postCalls.length - 1][1].body)
      expect(body.action).toBe('reject')
      expect(body.rejectionReason).toBe('RFC Invalido')
    })
  })

  // ---------------------------------------------------------
  // CP06: Ciberseguridad (Protección de Sitio Web malicioso)
  // ---------------------------------------------------------
  it('CP06: Protege contra enlaces maliciosos en el sitio web', async () => {
    // Sobrescribimos el mock para devolver una empresa con link malicioso
    const mockMaliciousCompany = {
      ...mockCompanyDetails,
      company: {
        ...mockCompanyDetails.company,
        website: 'javascript:alert("hacked")'
      }
    }
    
    ;(global.fetch as jest.Mock).mockImplementationOnce((url: string) => {
      if (url.includes('/api/companies/COMP-123')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockMaliciousCompany) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })

    render(<CompanyApprovalPage />)
    
    await waitFor(() => {
      expect(screen.getByText('Empresa Test SA')).toBeInTheDocument()
    })
    
    // Validar que NO exista un enlace a pesar de que la empresa lo tenga registrado
    // La función safeWebsiteMeta en el componente debe retornar null
    const enlaces = screen.queryAllByRole('link')
    expect(enlaces).toHaveLength(0)
  })
})