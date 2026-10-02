import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
import PreferencesPage from '../../src/app/preferences/page'

import { showSuccess } from '../../src/lib/toast'

// 1. Mock de navegación
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

// 2. Mock de temas (next-themes)
const mockSetTheme = jest.fn()
jest.mock('next-themes', () => ({
  useTheme: () => ({
    setTheme: mockSetTheme,
    theme: 'light'
  })
}))

// 3. Mock de notificaciones (toast)
jest.mock('../../src/lib/toast', () => ({
  showSuccess: jest.fn(),
  showError: jest.fn()
}))

// 4. Mock de Tabs de Radix UI para evitar problemas en el DOM virtual de Jest
jest.mock('../../src/components/ui/tabs', () => ({
  Tabs: ({ children, value, onValueChange }: { children: React.ReactNode, value: string, onValueChange: (v: string) => void }) => (
    <div data-testid="tabs" data-value={value} onClick={() => onValueChange('theme')}>
      {children}
    </div>
  ),
  TabsList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children, value }: { children: React.ReactNode, value: string }) => (
    <button data-testid={`tab-${value}`}>{children}</button>
  ),
  TabsContent: ({ children, value }: { children: React.ReactNode, value: string }) => (
    <div data-testid={`content-${value}`}>{children}</div>
  )
}))

// 5. Mock de Datos del API
const mockTenantData = {
  tenant: {
    id: 'TENANT-1',
    name: 'Mi Empresa',
    systemSettings: {
      theme: 'light',
      preferences: {
        locale: 'es-MX',
        timezone: 'America/Mexico_City',
        sessionTimeoutMinutes: 60,
        currency: 'MXN'
      }
    }
  }
}

describe('Módulo de Preferencias (/preferences)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    
    // Interceptar llamadas a la API (fetch)
    global.fetch = jest.fn((url: string | Request | URL, options?: RequestInit) => {
      if (options?.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockTenantData) })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(mockTenantData) })
    }) as jest.Mock
  })

  it('CP01: Carga la pantalla de preferencias exitosamente (Acceso)', async () => {
    render(<PreferencesPage />)
    
    // Espera a que el loader termine y muestre el título principal
    await waitFor(() => {
      expect(screen.getByText('Preferencias del Sistema')).toBeInTheDocument()
    })
  })

  it('CP02: Cambia la apariencia (Modo Oscuro/Claro)', async () => {
    render(<PreferencesPage />)
    await waitFor(() => {
      expect(screen.getByText('Preferencia de tema')).toBeInTheDocument()
    })

    // Simular clic en botón Oscuro
    const btnOscuro = screen.getByRole('button', { name: /Oscuro/i })
    fireEvent.click(btnOscuro)
    expect(mockSetTheme).toHaveBeenCalledWith('dark')

    // Simular clic en botón Claro
    const btnClaro = screen.getByRole('button', { name: /Claro/i })
    fireEvent.click(btnClaro)
    expect(mockSetTheme).toHaveBeenCalledWith('light')
  })

  it('CP03: Permite modificar la configuración regional (Idioma, Moneda, Zona horaria)', async () => {
    render(<PreferencesPage />)
    await waitFor(() => {
      expect(screen.getByText('Preferencias del Sistema')).toBeInTheDocument()
    })

    // Como los TabsContent siempre se renderizan en el mock, buscamos los inputs por su valor cargado
    const inputLocale = screen.getByDisplayValue('es-MX')
    fireEvent.change(inputLocale, { target: { value: 'en-US' } })
    expect(inputLocale).toHaveValue('en-US')

    const inputCurrency = screen.getByDisplayValue('MXN')
    fireEvent.change(inputCurrency, { target: { value: 'usd' } }) // el onChange hace toUpperCase automáticamente
    expect(inputCurrency).toHaveValue('USD')

    const inputTimezone = screen.getByDisplayValue('America/Mexico_City')
    fireEvent.change(inputTimezone, { target: { value: 'UTC' } })
    expect(inputTimezone).toHaveValue('UTC')
  })

  it('CP04: Permite ajustar la seguridad de sesión', async () => {
    render(<PreferencesPage />)
    await waitFor(() => {
      expect(screen.getByText('Preferencias del Sistema')).toBeInTheDocument()
    })

    // Modificar el tiempo de sesión
    const inputSession = screen.getByDisplayValue('60')
    fireEvent.change(inputSession, { target: { value: '30' } })
    expect(inputSession).toHaveValue(30)
  })

  it('CP05 y CP06: Guarda los cambios, muestra notificaciones de éxito y simula persistencia', async () => {
    render(<PreferencesPage />)
    await waitFor(() => {
      expect(screen.getByText('Preferencias del Sistema')).toBeInTheDocument()
    })

    // Al haber múltiples botones "Guardar" (uno por cada TabContent), seleccionamos el primero
    const btnGuardar = screen.getAllByRole('button', { name: /Guardar/i })[0]
    
    // Hacemos clic en Guardar
    fireEvent.click(btnGuardar)

    await waitFor(() => {
      // 1. Verifica que hizo la llamada POST para guardar en BD
      expect(global.fetch).toHaveBeenCalledWith('/api/tenant', expect.objectContaining({ method: 'POST' }))
      
      // 2. Verifica que llamó a la notificación (toast) verde de éxito
      expect(showSuccess).toHaveBeenCalledWith('Preferencias guardadas', 'Los cambios se aplicaron correctamente')
      
      // 3. Verifica que volvió a llamar a fetch GET para recargar datos (persistencia)
      expect(global.fetch).toHaveBeenCalledWith('/api/tenant')
    })
  })
})
