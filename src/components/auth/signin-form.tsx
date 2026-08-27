'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Mail, Lock, AlertCircle, Eye, EyeOff } from 'lucide-react'
import { signInSchema } from '@/schemas/auth'
import { safeRedirectUrl } from '@/lib/security'

export function SignInForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const validation = signInSchema.safeParse({
      email,
      password: password.trim()
    })
    if (!validation.success) {
      setError(validation.error.issues[0].message)
      return
    }

    setIsLoading(true)

    try {
      const result = await signIn('credentials', {
        email: validation.data.email,
        password: validation.data.password,
        redirect: false,
      })

      if (result?.error) {
        const message = (result?.error || '').toString()
        if (message?.includes('Configuration') || message === 'Configuration' || !message) {
          setError('No se pudo conectar con el servicio de autenticación. Intenta de nuevo.')
        } else {
          setError(message)
        }
      } else {
        const callback = safeRedirectUrl(searchParams?.get('callbackUrl'))
        router.push(callback)
        router.refresh()
      }
    } catch {
      setError('Ocurrió un error. Por favor, intenta de nuevo.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="email" className="text-sm font-medium">
          Correo Electrónico
        </Label>
        <div className="relative">
          <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            id="email"
            type="email"
            placeholder="tu@empresa.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="pl-10"
            required
            disabled={isLoading}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="password" className="text-sm font-medium">
          Contraseña
        </Label>
        <div className="relative">
          <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            id="password"
            type={showPassword ? "text" : "password"}
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="pl-10 pr-10"
            required
            disabled={isLoading}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent z-10"
            onClick={() => setShowPassword(!showPassword)}
          >
            {showPassword ? (
              <EyeOff className="h-4 w-4 text-muted-foreground" />
            ) : (
              <Eye className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="sr-only">
              {showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
            </span>
          </Button>
        </div>
        <div className="flex justify-end">
          <Button variant="link" className="px-0 h-auto text-xs text-muted-foreground" asChild>
            <a href="/auth/forgot-password">¿Olvidaste tu contraseña?</a>
          </Button>
        </div>
      </div>

      <Button
        type="submit"
        className="w-full"
        disabled={isLoading}
      >
        {isLoading ? 'Iniciando Sesión...' : 'Iniciar Sesión'}
      </Button>
    </form>
  )
}
