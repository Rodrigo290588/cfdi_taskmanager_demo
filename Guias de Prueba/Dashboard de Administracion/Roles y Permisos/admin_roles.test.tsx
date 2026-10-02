import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import RolesManagementPage from '@/app/admin/roles/page'
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

// Mock de window.confirm para la eliminación
window.confirm = jest.fn(() => true)

// Mock Global de Fetch
global.fetch = jest.fn()

describe('Módulo: Roles y Permisos (/admin/roles)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    
    // Simular sesión de Administrador
    ;(useSession as jest.Mock).mockReturnValue({
      data: { user: { role: 'ADMIN', email: 'admin@empresa.com' } },
      status: 'authenticated'
    })
    ;(usePermission as jest.Mock).mockReturnValue(true)

    // Simular respuestas de la API
    ;(global.fetch as jest.Mock).mockImplementation((url: string, options?: { method?: string }) => {
      if (url.includes('/api/admin/roles') && (!options || options.method === 'GET')) {
        return Promise.resolve({ 
          ok: true, 
          json: async () => ({ 
            roles: [
              { 
                id: 'VIEWER', 
                name: 'Visualizador', 
                isSystemRole: true, 
                canViewEmission: true, 
                canViewReception: true,
                granularPermissions: { receptionFiscalAudit: true } 
              },
              { 
                id: 'CUSTOM1', 
                name: 'Auditor Jr.', 
                isSystemRole: false, 
                canViewEmission: false, 
                canViewReception: true 
              }
            ] 
          }) 
        })
      }
      
      // Simular POST (Crear Rol)
      if (url.includes('/api/admin/roles') && options?.method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => ({ success: true }) })
      }
      
      // Simular PUT (Editar Rol)
      if (url.includes('/api/admin/roles/') && options?.method === 'PUT') {
        return Promise.resolve({ ok: true, json: async () => ({ success: true }) })
      }
      
      // Simular DELETE (Eliminar Rol)
      if (url.includes('/api/admin/roles/') && options?.method === 'DELETE') {
        return Promise.resolve({ ok: true, json: async () => ({ success: true }) })
      }

      return Promise.resolve({ ok: false, json: async () => ({ error: 'Not found' }) })
    })
  })

  it('Prueba 1: Crear un Nuevo Rol Personalizado', async () => {
    render(<RolesManagementPage />)
    await waitFor(() => expect(screen.getByText('Roles y Permisos')).toBeInTheDocument())
    
    // Clic en Nuevo Rol
    const btnNuevo = screen.getByRole('button', { name: /Nuevo Rol/i })
    fireEvent.click(btnNuevo)

    // Llenar formulario
    await waitFor(() => expect(screen.getByText('Crear Nuevo Rol')).toBeInTheDocument())
    
    const inputNombre = screen.getByLabelText(/Nombre del Rol/i)
    fireEvent.change(inputNombre, { target: { value: 'Auditor Jr.' } })

    // Simular clic en el switch de CFDI Emitidos (usamos el checkbox subyacente que Radix expone al DOM)
    const labelEmision = screen.getByText('CFDI Emitidos (Ingresos)')
    const switchEmisionContainer = labelEmision.parentElement?.parentElement
    const switchEmision = switchEmisionContainer?.querySelector('button[role="switch"]')
    if (switchEmision) {
      fireEvent.click(switchEmision)
    }

    // Guardar
    const btnGuardar = screen.getByRole('button', { name: 'Crear Rol' })
    fireEvent.click(btnGuardar)

    // Validar POST
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/admin/roles', expect.objectContaining({ method: 'POST' }))
    })
    expect(showSuccess).toHaveBeenCalledWith('Éxito', 'Rol creado correctamente')
  })

  it('Prueba 2: Editar un Rol de Sistema (Permisos Granulares)', async () => {
    render(<RolesManagementPage />)
    await waitFor(() => expect(screen.getByText('Visualizador')).toBeInTheDocument())
    
    // Buscar el botón de configurar del rol Visualizador
    const btnConfigurar = screen.getByRole('button', { name: /Configurar Permisos/i })
    fireEvent.click(btnConfigurar)

    // Validar que se abre el modal
    await waitFor(() => expect(screen.getByText('Editar Rol')).toBeInTheDocument())

    // En Radix/Shadcn, a menudo getByRole('switch') falla porque los aria-labels no están asociados directamente
    // al botón que funciona como switch si están separados estructuralmente. 
    // Usaremos un enfoque más robusto: buscar el contenedor o label y luego el switch.
    
    const labelAuditoria = screen.getByText('Auditoría fiscal y detección de riesgos')
    // El switch suele ser el siguiente elemento o estar dentro del mismo contenedor padre
    const switchAuditoriaContainer = labelAuditoria.parentElement
    const switchAuditoria = switchAuditoriaContainer?.querySelector('button[role="switch"]')
    
    if (switchAuditoria) {
      fireEvent.click(switchAuditoria)
    }

    // Guardar
    const btnActualizar = screen.getByRole('button', { name: 'Actualizar Rol' })
    fireEvent.click(btnActualizar)

    // Validar PUT
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/admin/roles/VIEWER'), expect.objectContaining({ method: 'PUT' }))
    })
    expect(showSuccess).toHaveBeenCalledWith('Éxito', 'Rol actualizado correctamente')
  })

  it('Prueba 3: Eliminar un Rol Personalizado', async () => {
    render(<RolesManagementPage />)
    await waitFor(() => expect(screen.getByText('Auditor Jr.')).toBeInTheDocument())
    
    // Buscar el botón de eliminar
    const btnEliminar = screen.getByRole('button', { name: /Eliminar/i })
    fireEvent.click(btnEliminar)

    // window.confirm ya fue mockeado para devolver true arriba
    
    // Validar DELETE
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/admin/roles/CUSTOM1'), expect.objectContaining({ method: 'DELETE' }))
    })
    expect(showSuccess).toHaveBeenCalledWith('Éxito', 'Rol eliminado correctamente')
  })

  it('Prueba 4: Seguridad y Bloqueo Anti-Intrusos', async () => {
    // Simular que NO tiene el permiso
    ;(usePermission as jest.Mock).mockReturnValue(false)

    render(<RolesManagementPage />)
    
    // Validar que se muestra Acceso Denegado
    expect(screen.getByText('Acceso Denegado')).toBeInTheDocument()
    expect(screen.queryByText('Roles y Permisos')).not.toBeInTheDocument()
  })
})
