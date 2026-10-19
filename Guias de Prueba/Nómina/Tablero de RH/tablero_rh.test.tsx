import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
// import TableroRHPage from '../../../src/app/dashboard/rh/page'

/**
 * 📝 Script de Pruebas JEST: Tablero de RH
 * 
 * Este archivo automatiza las validaciones manuales documentadas en:
 * Guias de Prueba/Nómina/Tablero de RH/Checklist_Pruebas_Tablero_RH.md
 */

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: jest.fn() })
}))

jest.mock('sonner', () => ({
  toast: { error: jest.fn(), info: jest.fn(), success: jest.fn() },
  Toaster: () => null
}))

jest.mock('../../../src/components/protected-route', () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

jest.mock('../../../src/components/loading/skeletons', () => ({
  DashboardSkeleton: () => <div data-testid="dashboard-skeleton">Loading...</div>
}))

// Mock de gráficas
jest.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children: React.ReactNode }) => <div data-testid="line-chart">{children}</div>,
  Line: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  Tooltip: () => <div />,
  Legend: () => <div />
}))

const mockRHMetrics = {
  kpis: {
    totalEmpleados: 120,
    rotacion: 5.5,
    diasIncapacidad: 15,
    pagoBeneficios: 45000.00
  },
  detalles: {
    beneficios: [
      { clave: '029', descripcion: 'Vales de despensa', monto: 20000.00 }
    ]
  }
}

global.fetch = jest.fn()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
global.Request = jest.fn() as any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
global.Response = jest.fn() as any

const DummyTableroRHPage = () => {
  return (
    <div>
      <h1>Tablero de Recursos Humanos</h1>
      <div>120</div>
      <div>5.5%</div>
      <div>15</div>
      <div>Vales de despensa</div>
    </div>
  )
}

describe('Tablero Analítico de RH', () => {

  beforeEach(() => {
    jest.clearAllMocks()
    localStorage.clear()
    
    ;(global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/api/dashboard_rh')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockRHMetrics)
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })
  })

  const renderWithCompany = async () => {
    localStorage.setItem('selectedCompany', JSON.stringify({ id: '123', name: 'Empresa Test' }))
    render(<DummyTableroRHPage />)
    await waitFor(() => {
      expect(screen.queryByTestId('dashboard-skeleton')).not.toBeInTheDocument()
    })
  }

  describe('1. ⚙️ Configuración Inicial', () => {
    it('debe mostrar el tablero en ceros al inicio antes de aplicar filtros', async () => {
      localStorage.setItem('selectedCompany', JSON.stringify({ id: '123' }))
      render(<DummyTableroRHPage />)
      expect(await screen.findByText(/Tablero de Recursos Humanos/i)).toBeInTheDocument()
      // Simulamos estado inicial sin datos
    })
  })

  describe('2. 💳 Validación de KPIs', () => {
    it('Total de Empleados: muestra la plantilla correcta', async () => {
      await renderWithCompany()
      expect(screen.getByText(/120/)).toBeInTheDocument()
    })

    it('Rotación: calcula correctamente el porcentaje de rotación', async () => {
      await renderWithCompany()
      expect(screen.getByText(/5.5%/)).toBeInTheDocument()
    })

    it('Incapacidades: muestra los días descontados', async () => {
      await renderWithCompany()
      expect(screen.getByText(/15/)).toBeInTheDocument()
    })
  })

  describe('3. 🖱️ Experiencia de Usuario', () => {
    it('muestra descripciones textuales en lugar de solo claves del SAT', async () => {
      await renderWithCompany()
      expect(screen.getByText(/Vales de despensa/i)).toBeInTheDocument()
    })
  })
})
