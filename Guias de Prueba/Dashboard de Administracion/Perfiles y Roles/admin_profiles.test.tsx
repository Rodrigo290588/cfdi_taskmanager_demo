import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import ProfilesManagementPage from '@/app/admin/profiles/page'
import { useSession } from 'next-auth/react'
import { usePermission } from '@/hooks/use-permissions'
import { showSuccess } from '@/lib/toast'

// --- Mocks Básicos ---
jest.mock('next-auth/react', () => ({
  useSession: jest.fn()
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() })
}))

jest.mock('@/hooks/use-permissions', () => ({
  usePermission: jest.fn()
}))

jest.mock('@/lib/toast', () => ({
  showSuccess: jest.fn(),
  showError: jest.fn()
}))

// Mock Simplificado de Select de Radix UI para evitar problemas con JSDOM
jest.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: { value?: string, onValueChange: (val: string) => void, children: React.ReactNode }) => (
    <select 
      data-testid="mock-select" 
      value={value || ""} 
      onChange={(e) => onValueChange(e.target.value)}
    >
      <option value="" disabled>Seleccionar</option>
      <option value="ADMIN">Administrador</option>
      <option value="VIEWER">Usuario</option>
      <option value="AUDITOR">Auditor</option>
      <option value="NONE">Sin acceso</option>
      <option value="CUSTOM1">Rol Personalizado</option>
      {children}
    </select>
  ),
  SelectContent: () => null,
  SelectItem: () => null,
  SelectTrigger: () => null,
  SelectValue: () => null,
}))

// Mock Global de Fetch
global.fetch = jest.fn()

describe('Módulo: Perfiles y Roles (/admin/profiles)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    
    // Simular que el usuario tiene sesión y permiso de ADMIN_ORGANIZATIONS
    ;(useSession as jest.Mock).mockReturnValue({
      data: { user: { role: 'ADMIN', email: 'admin@empresa.com' } },
      status: 'authenticated'
    })
    ;(usePermission as jest.Mock).mockReturnValue(true)

    // Simular respuestas de la API
    ;(global.fetch as jest.Mock).mockImplementation((url: string, options?: { method?: string }) => {
      if (url.includes('/api/admin/roles')) {
        return Promise.resolve({ ok: true, json: async () => ({ roles: [{ id: 'CUSTOM1', name: 'Rol Personalizado' }] }) })
      }
      if (url.includes('/api/admin/members') && !url.includes('/access') && (!options || options.method === 'GET' || options.method === undefined)) {
        return Promise.resolve({ ok: true, json: async () => ({ members: [{ id: 'm1', name: 'Juan Perez', email: 'juan@test.com', role: 'VIEWER', status: 'APPROVED' }] }) })
      }
      if (url.includes('/api/companies/tenant')) {
        return Promise.resolve({ ok: true, json: async () => ({ companies: [{ id: 'c1', rfc: 'RFC123', businessName: 'Empresa A' }] }) })
      }
      if (url.includes('/access') && (!options || options.method === 'GET' || options.method === undefined)) {
        return Promise.resolve({ ok: true, json: async () => ({ access: [{ companyId: 'c1', role: 'VIEWER' }] }) })
      }
      if (url.includes('/api/admin/members/m1') && options?.method === 'PATCH' && !url.includes('/access')) {
        return Promise.resolve({ ok: true, json: async () => ({ member: { id: 'm1', role: 'ADMIN' } }) })
      }
      if (url.includes('/access') && options?.method === 'PATCH') {
        return Promise.resolve({ ok: true, json: async () => ({ success: true }) })
      }
      return Promise.resolve({ ok: false, json: async () => ({ error: 'Not found' }) })
    })
  })

  it('Prueba 1: Cambiar el Rol General de un Usuario', async () => {
    render(<ProfilesManagementPage />)
    
    // Esperar a que cargue el usuario
    await waitFor(() => expect(screen.getByText('Juan Perez')).toBeInTheDocument())
    
    // Buscar el select general (es el primero)
    const selects = screen.getAllByTestId('mock-select')
    const generalRoleSelect = selects[0]

    // Cambiar a Administrador
    fireEvent.change(generalRoleSelect, { target: { value: 'ADMIN' } })
    
    // Validar que se llamó al API con PATCH
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/admin/members/m1', expect.objectContaining({ method: 'PATCH' }))
    })

    // Validar que se mostró el mensaje de éxito
    expect(showSuccess).toHaveBeenCalledWith('Rol actualizado', expect.any(String))
  })

  it('Prueba 2: Administrar Accesos por Empresa (Micro-Gestión)', async () => {
    render(<ProfilesManagementPage />)
    await waitFor(() => expect(screen.getByText('Juan Perez')).toBeInTheDocument())
    
    // Abrir el panel de empresas
    const btnEmpresas = screen.getByRole('button', { name: /Empresas/i })
    fireEvent.click(btnEmpresas)

    // Esperar a que se abra el panel inferior y cargue Empresa A
    await waitFor(() => expect(screen.getByText('Empresas asignadas')).toBeInTheDocument())
    await waitFor(() => expect(screen.getAllByText('Empresa A').length).toBeGreaterThan(0))

    // Buscar el select de la empresa (es el segundo select en la pantalla)
    const selects = screen.getAllByTestId('mock-select')
    const companyRoleSelect = selects[1]

    // Cambiar a Auditor
    fireEvent.change(companyRoleSelect, { target: { value: 'AUDITOR' } })
    
    // Clic en Actualizar
    const btnActualizar = screen.getByRole('button', { name: /Actualizar/i })
    fireEvent.click(btnActualizar)

    // Validar llamada API
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/admin/members/m1/access', expect.objectContaining({ method: 'PATCH' }))
    })

    // Validar mensaje de éxito
    expect(showSuccess).toHaveBeenCalledWith('Acceso actualizado', expect.any(String))
  })

  it('Prueba 3: Cierre del Panel de Empresas', async () => {
    render(<ProfilesManagementPage />)
    await waitFor(() => expect(screen.getByText('Juan Perez')).toBeInTheDocument())
    
    const btnEmpresas = screen.getByRole('button', { name: /Empresas/i })
    
    // Abrir
    fireEvent.click(btnEmpresas)
    await waitFor(() => expect(screen.getByText('Empresas asignadas')).toBeInTheDocument())
    
    // Cerrar
    fireEvent.click(btnEmpresas)
    await waitFor(() => expect(screen.queryByText('Empresas asignadas')).not.toBeInTheDocument())
  })

  it('Prueba 4: Seguridad y Privilegios (Blindaje Anti-Intrusos)', async () => {
    // Simular que NO tiene el permiso
    ;(usePermission as jest.Mock).mockReturnValue(false)

    render(<ProfilesManagementPage />)
    
    // Validar que se muestra Acceso Denegado
    expect(screen.getByText('Acceso Denegado')).toBeInTheDocument()
    expect(screen.queryByText('Perfiles y Roles')).not.toBeInTheDocument()
  })
})
