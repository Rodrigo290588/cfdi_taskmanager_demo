import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'

// Mocks de Lucide
jest.mock('lucide-react', () => ({
  UserPlus: () => <span>UserPlus</span>,
  Mail: () => <span>Mail</span>,
  ShieldCheck: () => <span>ShieldCheck</span>,
  Trash2: () => <span>Trash2</span>,
  RefreshCw: () => <span>RefreshCw</span>,
  Building2: () => <span>Building2</span>,
  Loader2: () => <span>Loader2</span>,
  Search: () => <span>Search</span>,
  Edit2: () => <span>Edit2</span>,
  Clock: () => <span>Clock</span>,
  CheckCircle2: () => <span>CheckCircle2</span>,
  XCircle: () => <span>XCircle</span>,
}))

// 1. Mocks de Navegación y Sesión
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}))
jest.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'U1', name: 'Admin' } }, status: 'authenticated' }),
}))

// 2. Mock de Seguridad (Permisos)
let mockIsAdmin = true
jest.mock('../../../src/components/auth/permission-guard', () => ({
  PermissionRequired: ({ children }: { children: React.ReactNode }) => mockIsAdmin ? <>{children}</> : <div>Acceso Denegado</div>,
}))
jest.mock('../../../src/components/auth/protected-route', () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

// 3. Mocks de UI y Notificaciones
global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }

jest.mock('../../../src/lib/toast', () => ({
  showSuccess: jest.fn(),
  showError: jest.fn(),
}))

// Simulamos que al abrir un Toast de confirmación, el usuario siempre hace clic en "Confirmar/Eliminar"
jest.mock('sonner', () => ({
  toast: jest.fn((msg, opts) => {
    if (opts?.action?.onClick) {
      opts.action.onClick() // Auto-ejecutar confirmación
    }
  }),
}))

// Mock de UI complejos para evitar errores de Radix en JSDOM
jest.mock('../../../src/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode, open?: boolean }) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

// También mockeamos Select y DropdownMenu para que sean simples inputs HTML y faciliten el test
jest.mock('../../../src/components/ui/select', () => ({
  Select: ({ children, onValueChange }: { children: React.ReactNode, onValueChange: (val: string) => void }) => <div data-testid="mock-select" onClick={() => onValueChange('rol-2')}>{children}</div>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value }: { children: React.ReactNode, value: string }) => <option value={value}>{children}</option>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  SelectValue: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

jest.mock('../../../src/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, // Changed from button to div to avoid nested button errors
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuCheckboxItem: ({ children, onCheckedChange }: { children: React.ReactNode, onCheckedChange: (checked: boolean) => void }) => <div onClick={() => onCheckedChange(true)}>{children}</div>,
}))

jest.mock('../../../src/components/admin/user-invitation-form', () => ({
  UserInvitationForm: () => <div>Formulario de Invitación Mock</div>
}))

// 4. Importar el componente
import UsersManagementPage from '../../../src/app/admin/users/page'

// 5. Mock del API
const mockInvitations = [
  { id: 'inv-1', email: 'invitado@test.com', name: 'Usuario Invitado', role: 'VIEWER', status: 'PENDING' }
]
const mockUsers = [
  { id: 'usr-1', email: 'activo@test.com', name: 'Usuario Activo', role: 'ADMIN', status: 'APPROVED', roleId: 'rol-1', companyIds: [] }
]

describe('Gestión de Usuarios (/admin/users)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockIsAdmin = true

    global.fetch = jest.fn((url: string, options?: { method?: string }) => {
      if (url.includes('/api/admin/roles')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ roles: [{id:'rol-1', name:'Admin'}] }) })
      if (url.includes('/api/user/company-access')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ companies: [] }) })
      
      if (url.includes('/api/admin/users/invite')) {
        if (options?.method === 'DELETE') return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) })
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ invitations: mockInvitations }) })
      }
      
      if (url.includes('/api/admin/users')) {
        if (options?.method === 'PATCH' || options?.method === 'DELETE') return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) })
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ users: mockUsers }) })
      }
      
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    }) as jest.Mock
  })

  it('CP01: Cancela invitaciones pendientes correctamente', async () => {
    render(<UsersManagementPage />)
    
    // Esperar a que cargue el invitado
    await waitFor(() => {
      expect(screen.getByText('Usuario Invitado')).toBeInTheDocument()
    })

    // Buscar el botón de cancelar (Trash2)
    const deleteBtn = screen.getByTitle('Cancelar invitación')
    fireEvent.click(deleteBtn)

    // Verificar que se llamó al API DELETE
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/admin/users/invite/inv-1'), expect.objectContaining({ method: 'DELETE' }))
    })
  })

  it('CP02: Activa y suspende usuarios (Switch)', async () => {
    render(<UsersManagementPage />)
    
    await waitFor(() => {
      expect(screen.getByText('Usuario Activo')).toBeInTheDocument()
    })

    // Buscar el switch (role=switch)
    const switchBtn = screen.getByRole('switch')
    fireEvent.click(switchBtn)

    // Verificar que se llamó al API PATCH para cambiar estatus
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/admin/users/usr-1/status'), 
        expect.objectContaining({ method: 'PATCH' })
      )
    })
  })

  it('CP03: Abre modal de edición y permite guardar cambios', async () => {
    render(<UsersManagementPage />)
    
    await waitFor(() => {
      expect(screen.getByText('Usuario Activo')).toBeInTheDocument()
    })

    // Clic en editar
    const editBtn = screen.getByTitle('Editar permisos')
    fireEvent.click(editBtn)

    // Verificar que el modal se abre
    await waitFor(() => {
      expect(screen.getByText('Editar Permisos de Usuario')).toBeInTheDocument()
    })

    // Cambiar rol (interactuar con el mock select)
    const mockSelect = screen.getByTestId('mock-select')
    fireEvent.click(mockSelect)

    // Clic en Guardar Cambios
    const saveBtn = screen.getByText('Guardar Cambios')
    fireEvent.click(saveBtn)

    // Verificar llamada PATCH principal
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/admin/users/usr-1'), 
        expect.objectContaining({ method: 'PATCH' })
      )
    })
  })

  it('CP04: Elimina definitivamente a un usuario activo', async () => {
    render(<UsersManagementPage />)
    
    await waitFor(() => {
      expect(screen.getByText('Usuario Activo')).toBeInTheDocument()
    })

    // Clic en eliminar usuario
    const deleteBtn = screen.getByTitle('Eliminar usuario')
    fireEvent.click(deleteBtn)

    // Verificar llamada DELETE
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/admin/users/usr-1'), 
        expect.objectContaining({ method: 'DELETE' })
      )
    })
  })

  it('CP05: Bloquea el acceso a usuarios sin privilegios', async () => {
    mockIsAdmin = false
    render(<UsersManagementPage />)
    
    await waitFor(() => {
      expect(screen.getByText('Acceso Denegado')).toBeInTheDocument()
      expect(screen.queryByText('Gestión de Usuarios')).not.toBeInTheDocument()
    })
  })
})