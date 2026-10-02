import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import BulkUsersPage from '@/app/admin/users-bulk/page'
import { useSession } from 'next-auth/react'
import { usePermission } from '@/hooks/use-permissions'

// --- Mocks Básicos ---
jest.mock('next-auth/react', () => ({
  useSession: jest.fn()
}))

jest.mock('@/hooks/use-permissions', () => ({
  usePermission: jest.fn()
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() })
}))

// Mock de notificaciones (Sonner)
jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn()
  }
}))

// Mock global de fetch
global.fetch = jest.fn()

describe('Módulo: Alta Masiva de Usuarios (/admin/users-bulk)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Simulamos que el usuario logueado es Administrador y tiene los permisos
    ;(useSession as jest.Mock).mockReturnValue({
      data: { 
        user: { 
          role: 'ADMIN', 
          email: 'admin@empresa.com',
          permissions: ['ADMIN_USERS'] // Agregamos el permiso necesario
        } 
      },
      status: 'authenticated'
    })
    ;(usePermission as jest.Mock).mockReturnValue(true)
  })

  it('Prueba 1: Bloquea archivos con extensión incorrecta (.jpg)', async () => {
    const { container } = render(<BulkUsersPage />)
    
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    
    // Creamos un archivo real de tipo imagen (Evitando simulación básica, usamos la API nativa File)
    const badFile = new File(['fake-image-data'], 'foto.jpg', { type: 'image/jpeg' })
    
    fireEvent.change(fileInput, { target: { files: [badFile] } })
    
    // Validamos que el nombre del archivo NO se muestra en pantalla y la alerta se dispara
    await waitFor(() => {
      expect(screen.queryByText('foto.jpg')).not.toBeInTheDocument()
    })
  })

  it('Prueba 2: Muestra la tabla de errores si el backend detecta fallas de auditoría', async () => {
    // Simulamos que el backend rechaza el archivo por tener formato incorrecto
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        errors: [
          { rowNumber: 1, message: 'Falta el correo electrónico' },
          { rowNumber: 2, message: 'El RFC del proveedor es inválido' }
        ]
      })
    })

    const { container } = render(<BulkUsersPage />)
    
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    const txtFile = new File(['datos malos'], 'layout_error.txt', { type: 'text/plain' })
    fireEvent.change(fileInput, { target: { files: [txtFile] } })
    
    const submitButton = screen.getByRole('button', { name: /Cargar e Invitar Usuarios/i })
    fireEvent.click(submitButton)
    
    // Validamos que el botón cambie a Procesando
    expect(screen.getByText(/Procesando/i)).toBeInTheDocument()
    
    // Validamos que aparezca la tabla de errores
    await waitFor(() => {
      expect(screen.getByText('Se encontraron errores en el Layout')).toBeInTheDocument()
      expect(screen.getByText('Falta el correo electrónico')).toBeInTheDocument()
      expect(screen.getByText('El RFC del proveedor es inválido')).toBeInTheDocument()
    })
  })

  it('Prueba 3: Procesa la carga exitosamente y muestra confirmación verde', async () => {
    // Simulamos que el backend procesa correctamente a 5 usuarios
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        invitedCount: 5,
        message: 'Usuarios invitados con éxito'
      })
    })

    const { container } = render(<BulkUsersPage />)
    
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    const txtFile = new File(['correo|nombre|rol'], 'layout_bueno.txt', { type: 'text/plain' })
    fireEvent.change(fileInput, { target: { files: [txtFile] } })
    
    const submitButton = screen.getByRole('button', { name: /Cargar e Invitar Usuarios/i })
    fireEvent.click(submitButton)
    
    // Validamos que aparezca el mensaje de éxito y la cantidad
    await waitFor(() => {
      expect(screen.getByText('Proceso Completado')).toBeInTheDocument()
      expect(screen.getByText(/Se han enviado exitosamente las invitaciones a 5 usuarios/i)).toBeInTheDocument()
    })
    
    // Validamos que la caja se haya limpiado (el nombre del archivo desaparece)
    expect(screen.queryByText('layout_bueno.txt')).not.toBeInTheDocument()
  })

  it('Prueba 4: Bloquea el acceso a usuarios sin privilegios (Seguridad)', async () => {
    // Cambiamos la sesión para simular un usuario normal (sin permisos ADMIN_USERS)
    ;(useSession as jest.Mock).mockReturnValue({
      data: { 
        user: { role: 'USER', email: 'empleado@empresa.com' },
        permissions: [] // Sin permiso de admin
      },
      status: 'authenticated'
    })
    ;(usePermission as jest.Mock).mockReturnValue(false)

    render(<BulkUsersPage />)
    
    // En lugar de ver la interfaz de carga, el componente ProtectedRoute o PermissionGuard debe bloquearlo.
    // Como estamos renderizando el componente envuelto, buscamos que no exista el botón de subir.
    expect(screen.queryByText('Alta de Usuarios Layout')).not.toBeInTheDocument()
    expect(screen.getByText('Acceso Denegado')).toBeInTheDocument()
  })
})
