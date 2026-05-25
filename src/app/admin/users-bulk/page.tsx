'use client'

import { useRef, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { showSuccess, showError } from '@/lib/toast'
import { Upload, FileText, AlertCircle, CheckCircle2, Loader2, Info } from 'lucide-react'

interface UploadError {
  rowNumber: number
  message: string
}

export default function BulkUsersPage() {
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUpload] = useState(false)
  const [errors, setErrors] = useState<UploadError[]>([])
  const [successCount, setSuccessCount] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    setErrors([])
    setSuccessCount(null)
    
    if (selected) {
      if (selected.type !== 'text/plain' && !selected.name.endsWith('.txt')) {
        toast.error('Solo se permiten archivos de texto plano (.txt)')
        setFile(null)
        e.target.value = ''
        return
      }
      setFile(selected)
    }
  }

  const openFilePicker = () => {
    // Reset the native input value so selecting the same corrected file
    // triggers a fresh onChange event and replaces the in-memory File object.
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
      fileInputRef.current.click()
    }
  }

  const handleUpload = async () => {
    if (!file) return

    setUpload(true)
    setErrors([])
    setSuccessCount(null)

    try {
      const formData = new FormData()
      formData.append('file', file)

      // Send actual file to API (multipart/form-data)
      const res = await fetch('/api/admin/users/bulk-invite', {
        method: 'POST',
        body: formData
      })

      const data = await res.json()

      if (!res.ok) {
        if (data.errors && data.errors.length > 0) {
          setErrors(data.errors)
          showError('Errores de Validación', 'Corrige los errores indicados en el archivo y vuelve a intentarlo.')
        } else {
          throw new Error(data.error || 'Error al procesar el archivo')
        }
      } else {
        setSuccessCount(data.invitedCount)
        showSuccess('¡Carga Exitosa!', data.message)
        setFile(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
      }

    } catch (error) {
      showError('Error', error instanceof Error ? error.message : 'Error desconocido al procesar el archivo')
    } finally {
      setUpload(false)
    }
  }

  return (
    <div className="container mx-auto py-8 px-4 md:px-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Alta de Usuarios Layout</h1>
        <p className="text-muted-foreground mt-2">
          Invita a múltiples usuarios simultáneamente subiendo un archivo de texto plano (.txt).
        </p>
      </div>

      <Card className="mb-6 border-blue-500/20 shadow-md">
        <CardHeader className="bg-blue-50/50 dark:bg-blue-950/20 border-b">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Info className="h-5 w-5 text-blue-500" />
            Estructura del Archivo
          </CardTitle>
          <CardDescription>
            El archivo debe ser texto plano separado por el símbolo <strong>|</strong> (pipe). Puedes omitir los últimos dos campos si el usuario no es Proveedor.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6 space-y-4">
          <div className="bg-muted/50 p-4 rounded-md font-mono text-sm overflow-x-auto whitespace-nowrap">
            Correo | Nombre | Rol | Empresas (RFCs separados por coma) | RFC Proveedor | Nombre Proveedor
          </div>
          <div className="space-y-2 text-sm">
            <p><strong>Ejemplo (Usuario Normal):</strong></p>
            <div className="bg-muted/50 p-2 rounded-md font-mono text-xs overflow-x-auto whitespace-nowrap">
              juan@ejemplo.com | Juan Pérez | Visualizador | ODE8604257UA
            </div>
            <p className="mt-4"><strong>Ejemplo (Proveedor):</strong></p>
            <div className="bg-muted/50 p-2 rounded-md font-mono text-xs overflow-x-auto whitespace-nowrap">
              prov@ejemplo.com | Pedro | Proveedor | ODE8604257UA, ABC123456T1 | XAXX010101000 | Mi Empresa SA de CV
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Subir Layout
          </CardTitle>
          <CardDescription>Selecciona el archivo .txt para comenzar el proceso</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center border-2 border-dashed border-muted-foreground/25 rounded-lg p-10 bg-muted/5 transition-colors hover:bg-muted/10">
            <input
              type="file"
              id="file-upload"
              accept=".txt, text/plain"
              className="hidden"
              ref={fileInputRef}
              onChange={handleFileChange}
              disabled={uploading}
            />
            <label 
              htmlFor="file-upload" 
              className="flex flex-col items-center justify-center cursor-pointer space-y-4"
            >
              <div className="p-4 bg-primary/10 text-primary rounded-full">
                <FileText className="h-8 w-8" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium">
                  {file ? file.name : 'Haz clic para seleccionar un archivo .txt'}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {file ? `${(file.size / 1024).toFixed(2)} KB` : 'Máximo 5MB'}
                </p>
              </div>
              <Button 
                type="button" 
                variant={file ? "secondary" : "default"} 
                className="mt-2"
                onClick={openFilePicker}
                disabled={uploading}
              >
                {file ? 'Cambiar Archivo' : 'Seleccionar Archivo'}
              </Button>
            </label>
          </div>
        </CardContent>
        <CardFooter className="border-t pt-6 flex justify-end">
          <Button 
            onClick={handleUpload} 
            disabled={!file || uploading}
            className="w-full sm:w-auto min-w-[200px]"
          >
            {uploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Procesando...
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                Cargar e Invitar Usuarios
              </>
            )}
          </Button>
        </CardFooter>
      </Card>

      {successCount !== null && (
        <div className="mt-6 p-4 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900 rounded-lg flex items-start gap-3">
          <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-500 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-medium text-green-800 dark:text-green-400">Proceso Completado</h3>
            <p className="text-sm text-green-700 dark:text-green-500 mt-1">
              Se han enviado exitosamente las invitaciones a {successCount} usuario{successCount !== 1 ? 's' : ''}.
            </p>
          </div>
        </div>
      )}

      {errors.length > 0 && (
        <Card className="mt-6 border-red-200 shadow-sm">
          <CardHeader className="bg-red-50 dark:bg-red-950/20 border-b border-red-100">
            <CardTitle className="flex items-center gap-2 text-red-600 dark:text-red-400 text-lg">
              <AlertCircle className="h-5 w-5" />
              Se encontraron errores en el Layout
            </CardTitle>
            <CardDescription className="text-red-600/80">
              Corrige los siguientes errores en tu archivo de texto e inténtalo de nuevo. Ningún usuario ha sido invitado.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[400px] overflow-y-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="px-4 py-3 font-medium text-muted-foreground w-24 text-center">Fila</th>
                    <th className="px-4 py-3 font-medium text-muted-foreground">Motivo del Rechazo</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {errors.map((error, idx) => (
                    <tr key={idx} className="hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium text-center">{error.rowNumber}</td>
                      <td className="px-4 py-3 text-red-600 dark:text-red-400">{error.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
