import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { PrivateKeyForm } from '../../../src/components/mass-downloads/private-key-form'

// Mock de la librería de notificaciones
const mockToastError = jest.fn()
const mockToastSuccess = jest.fn()
jest.mock('sonner', () => ({
  toast: {
    error: (msg: string) => mockToastError(msg),
    success: (msg: string) => mockToastSuccess(msg)
  }
}))

// Mock de componentes complejos de UI (Select) para facilitar la prueba de formularios en JSDOM
jest.mock('../../../src/components/ui/select', () => ({
  Select: ({ onValueChange, children }: { onValueChange: (value: string) => void, children: React.ReactNode }) => (
    <select data-testid="mock-select" onChange={(e) => onValueChange(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: () => <option value="">Selecciona un RFC</option>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string, children: React.ReactNode }) => <option value={value}>{children}</option>,
}))

// Mock de fetch global
global.fetch = jest.fn()

const mockCompanies = [
  { id: '1', rfc: 'AAA010101AAA', businessName: 'Empresa Test SA de CV' }
]

function createMockFile(name: string, content: string, type: string = 'text/plain') {
  return new File([content], name, { type })
}

describe('Configuración de Descargas Masivas (PrivateKeyForm)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('1. Renderizado Inicial y Botón de Ojo (UX)', async () => {
    render(<PrivateKeyForm companies={mockCompanies} organizationId="org-1" />)
    
    // Verificar que los elementos existan
    expect(screen.getByText('Configuración de Llaves Privadas')).toBeInTheDocument()
    expect(screen.getByText('Carga de llave privada (.key)')).toBeInTheDocument()
    expect(screen.getByText('Certificado (.cer)')).toBeInTheDocument()
    
    // Validar el campo de contraseña y su botón de visibilidad
    const passwordInput = screen.getByPlaceholderText('••••••••')
    expect(passwordInput).toHaveAttribute('type', 'password')
    
    const eyeButton = screen.getByRole('button', { name: /Mostrar contraseña/i })
    fireEvent.click(eyeButton)
    expect(passwordInput).toHaveAttribute('type', 'text')
  })

  it('2. Escenario de Error: Envío en Blanco', async () => {
    render(<PrivateKeyForm companies={mockCompanies} organizationId="org-1" />)
    
    const submitButton = screen.getByRole('button', { name: /Guardar Configuración/i })
    fireEvent.click(submitButton)
    
    await waitFor(() => {
      // El formulario debe lanzar un error porque faltan la llave, el cer y el password
      expect(mockToastError).toHaveBeenCalledWith(expect.stringContaining('Favor de cargar'))
    })
  })

  it('3. Escenario de Error: Archivo Inválido (.pdf en lugar de .key)', async () => {
    render(<PrivateKeyForm companies={mockCompanies} organizationId="org-1" />)
    
    // Encontramos los inputs tipo file (buscando en el documento ya que el label apunta a un div)
    const keyInput = document.querySelector('input[name="privateKey"]') as HTMLInputElement
    
    const invalidFile = createMockFile('documento.pdf', 'dummy content', 'application/pdf')
    fireEvent.change(keyInput, { target: { files: [invalidFile] } })
    
    await waitFor(() => {
      // La validación onChange manual debe rechazarlo y mostrar toast
      expect(mockToastError).toHaveBeenCalledWith('El archivo debe tener extensión .key')
    })
  })

  it('4. Escenario de Error: Rechazo del Servidor (Credenciales Inválidas)', async () => {
    // Simulamos que el backend rechaza la petición
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      text: () => Promise.resolve('Contraseña incorrecta para la FIEL')
    })

    render(<PrivateKeyForm companies={mockCompanies} organizationId="org-1" />)
    
    // Llenar datos válidos estructuralmente
    const select = screen.getByTestId('mock-select')
    fireEvent.change(select, { target: { value: 'AAA010101AAA' } })
    
    const keyInput = document.querySelector('input[name="privateKey"]') as HTMLInputElement
    fireEvent.change(keyInput, { target: { files: [createMockFile('llave.key', 'key content', '.key')] } })
    
    const cerInput = document.querySelector('input[name="certificate"]') as HTMLInputElement
    fireEvent.change(cerInput, { target: { files: [createMockFile('cert.cer', 'cer content', '.cer')] } })
    
    const passwordInput = screen.getByPlaceholderText('••••••••')
    fireEvent.change(passwordInput, { target: { value: 'passwordErroneo' } })
    
    // Enviar
    const submitButton = screen.getByRole('button', { name: /Guardar Configuración/i })
    fireEvent.click(submitButton)
    
    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('Contraseña incorrecta para la FIEL')
    })
  })

  it('5. Escenario de Éxito Total (Happy Path)', async () => {
    // Simulamos que el backend aprueba la petición
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true })
    })

    render(<PrivateKeyForm companies={mockCompanies} organizationId="org-1" />)
    
    // Llenar datos válidos
    const select = screen.getByTestId('mock-select')
    fireEvent.change(select, { target: { value: 'AAA010101AAA' } })
    
    const keyInput = document.querySelector('input[name="privateKey"]') as HTMLInputElement
    fireEvent.change(keyInput, { target: { files: [createMockFile('llave.key', 'key content', '.key')] } })
    
    const cerInput = document.querySelector('input[name="certificate"]') as HTMLInputElement
    fireEvent.change(cerInput, { target: { files: [createMockFile('cert.cer', 'cer content', '.cer')] } })
    
    const passwordInput = screen.getByPlaceholderText('••••••••')
    fireEvent.change(passwordInput, { target: { value: 'passwordCorrecto123' } })
    
    // Enviar
    const submitButton = screen.getByRole('button', { name: /Guardar Configuración/i })
    fireEvent.click(submitButton)
    
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/mass-downloads/credentials', expect.any(Object))
      expect(mockToastSuccess).toHaveBeenCalledWith('Configuración guardada exitosamente')
    })
  })
})