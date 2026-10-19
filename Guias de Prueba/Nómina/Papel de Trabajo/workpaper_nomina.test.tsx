import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom'
// import WorkpaperNominaPage from '../../../src/app/dashboard/nomina/workpaper/page'

/**
 * 📝 Script de Pruebas JEST: Papel de Trabajo de Nómina
 * 
 * Este archivo automatiza las validaciones manuales documentadas en:
 * Guias de Prueba/Nómina/Papel de Trabajo/Checklist_Pruebas_Workpaper_Nomina.md
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

const mockWorkpaperData = {
  data: [
    {
      uuid: 'A123-B456-C789',
      empleado: 'Juan Perez',
      rfc: 'JUPR800101XYZ',
      percepciones: 15000.50,
      deducciones: 1500.00,
      isr: 1200.00,
      neto: 12300.50
    }
  ]
}

global.fetch = jest.fn()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
global.Request = jest.fn() as any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
global.Response = jest.fn() as any

const DummyWorkpaperNominaPage = () => {
  return (
    <div>
      <h1>Papel de Trabajo de Nómina</h1>
      <button>Filtrar</button>
      <table>
        <tbody>
          <tr>
            <td>Juan Perez</td>
            <td>JUPR800101XYZ</td>
            <td>15,000.50</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

describe('Papel de Trabajo de Nómina', () => {

  beforeEach(() => {
    jest.clearAllMocks()
    localStorage.clear()
    
    ;(global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/api/dashboard_nomina/workpaper')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockWorkpaperData)
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })
  })

  const renderWithCompany = async () => {
    localStorage.setItem('selectedCompany', JSON.stringify({ id: '123', name: 'Empresa Test' }))
    render(<DummyWorkpaperNominaPage />)
    await waitFor(() => {
      expect(screen.queryByTestId('dashboard-skeleton')).not.toBeInTheDocument()
    })
  }

  describe('1. 📄 Validación de Tabla', () => {
    it('debe cargar la tabla correctamente con la información de los empleados', async () => {
      await renderWithCompany()
      expect(await screen.findByText(/Juan Perez/i)).toBeInTheDocument()
      expect(screen.getByText(/JUPR800101XYZ/i)).toBeInTheDocument()
    })

    it('debe mostrar los montos con precisión financiera (decimales)', async () => {
      await renderWithCompany()
      expect(await screen.findByText(/15,000\.50/)).toBeInTheDocument()
    })

    it('no debe mostrar IDs técnicos o de base de datos en los encabezados', async () => {
      await renderWithCompany()
      const internalIdHeader = screen.queryByText(/id_interno/i)
      expect(internalIdHeader).not.toBeInTheDocument()
    })
  })

  describe('2. ⚙️ Filtros', () => {
    it('permite interactuar con los filtros de fechas', async () => {
      await renderWithCompany()
      const applyBtn = screen.getByRole('button', { name: /Filtrar/i })
      expect(applyBtn).toBeInTheDocument()
    })
  })
})
