'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { Loader2, CheckCircle2, ShieldCheck, ShieldAlert } from 'lucide-react'

interface ValidationResult {
  valida: boolean
  nivel_fuerza: "Debil" | "Media" | "Fuerte"
  errores: string[]
  sugerencia: string
}

export default function CompleteRegistrationPage() {
  const router = useRouter()
  
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  
  const [validation, setValidation] = useState<ValidationResult | null>(null)
  const [validating, setValidating] = useState(false)

  // Real-time validation
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (!password) {
        setValidation(null)
        return
      }
      setValidating(true)
      try {
        const res = await fetch('/api/auth/validate-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        })
        const data = await res.json()
        setValidation(data)
      } catch (e) {
        console.error("Error validating password", e)
      } finally {
        setValidating(false)
      }
    }, 500)

    return () => clearTimeout(timer)
  }, [password])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!validation?.valida) {
      toast.error('La contraseña no cumple con los requisitos de seguridad.')
      return
    }
    
    if (password !== confirmPassword) {
      toast.error('Las contraseñas no coinciden')
      return
    }

    setSubmitting(true)

    try {
      const res = await fetch('/api/auth/complete-registration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      })

      const data = await res.json()

      if (!res.ok) {
        if (data.errores && data.errores.length > 0) {
          // If the backend returns our strict JSON validation format
          throw new Error(data.errores[0])
        }
        throw new Error(data.error || 'Error al completar el registro')
      }

      setSuccess(true)
      toast.success('Cuenta configurada exitosamente')
      
      // Redirect to sign in after 1.5 seconds
      setTimeout(() => {
        router.push('/auth/signin')
      }, 1500)

    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ocurrió un error')
    } finally {
      setSubmitting(false)
    }
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-white dark:from-gray-950 dark:to-gray-900 px-4">
        <Card className="w-full max-w-md mx-auto shadow-xl border-green-500/20">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto bg-green-500/10 w-12 h-12 rounded-full flex items-center justify-center mb-4">
              <CheckCircle2 className="h-6 w-6 text-green-600" />
            </div>
            <CardTitle className="text-2xl font-bold">¡Cuenta Lista!</CardTitle>
          </CardHeader>
          <CardContent className="text-center pt-4">
            <p className="text-muted-foreground">
              Tu contraseña ha sido guardada. Redirigiendo al inicio de sesión...
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-white dark:from-gray-950 dark:to-gray-900 px-4 py-12">
      <Card className="w-full max-w-md mx-auto shadow-xl">
        <CardHeader className="text-center space-y-2">
          <CardTitle className="text-2xl font-bold tracking-tight">Completar Registro</CardTitle>
          <CardDescription className="text-base">
            Crea una contraseña segura para tu nueva cuenta.
          </CardDescription>
        </CardHeader>
        
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Nueva Contraseña</Label>
              <Input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
              />
              {validating && <p className="text-xs text-muted-foreground animate-pulse">Validando seguridad...</p>}
              {validation && !validating && (
                <div className={`p-3 rounded-md border text-sm space-y-2 ${validation.valida ? 'bg-green-500/10 border-green-500/20 text-green-700 dark:text-green-400' : 'bg-red-500/10 border-red-500/20 text-red-700 dark:text-red-400'}`}>
                  <div className="flex items-center gap-2 font-medium">
                    {validation.valida ? <ShieldCheck className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
                    <span>Seguridad: {validation.nivel_fuerza}</span>
                  </div>
                  {!validation.valida && validation.errores.length > 0 && (
                    <ul className="list-disc pl-5 space-y-1 text-xs opacity-90">
                      {validation.errores.map((err, i) => <li key={i}>{err}</li>)}
                    </ul>
                  )}
                  <p className="text-xs italic opacity-80 border-t pt-1 border-current/10">
                    💡 Sugerencia: {validation.sugerencia}
                  </p>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirmar Contraseña</Label>
              <Input
                id="confirmPassword"
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
              />
            </div>
          </CardContent>

          <CardFooter>
            <Button 
              type="submit" 
              className="w-full" 
              disabled={submitting}
            >
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Guardar y Finalizar
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}
