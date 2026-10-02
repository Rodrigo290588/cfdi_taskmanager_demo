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

const ERROR_CODE_TO_MESSAGE: Record<string, string> = {
  AuthCredentialError: 'Credenciales inválidas. Verifica tu correo y contraseña.',
  CredentialsInvalid: 'Credenciales inválidas. Verifica tu correo y contraseña.',
  CredentialsEmptyPassword: 'La cuenta no tiene contraseña configurada. Usa "Olvidé mi contraseña" para crear una.',
  CredentialsAccessPending: 'Tu cuenta está creada pero tu acceso a la organización aún no ha sido aprobado. Contacta al administrador.',
  CredentialsRateLimit: 'Demasiados intentos fallidos. Por seguridad, el acceso ha sido bloqueado temporalmente. Por favor, inténtelo de nuevo más tarde.',
  CredentialsConfiguration: 'No se pudo conectar con el servicio de autenticación. Intenta de nuevo.',
}

function messageFromErrorCode(code: string | undefined | null, fallbackRaw: string): string {
  if (!code) return fallbackRaw
  const known = ERROR_CODE_TO_MESSAGE[code]
  if (known) return known
  return code && code.length > 0 && code.length < 180 ? code : fallbackRaw
}

function parseErrorFromUrlString(urlOrRaw: string | null | undefined): {
  errorType: string | null
  errorCode: string | null
} {
  if (!urlOrRaw) return { errorType: null, errorCode: null }
  try {
    if (urlOrRaw.startsWith('http') || urlOrRaw.includes('?')) {
      const u = new URL(urlOrRaw, 'http://localhost')
      return {
        errorType: u.searchParams.get('error'),
        errorCode: u.searchParams.get('code'),
      }
    }
  } catch { /* ignore */ }
  return { errorType: urlOrRaw || null, errorCode: null }
}

function handleUrlError(
  parsed: { errorType: string | null; errorCode: string | null },
  resultError: string | null | undefined,
  isOk: boolean | undefined,
  setError: (msg: string) => void
): boolean {
  const { errorType, errorCode } = parsed
  if (errorType === 'Configuration' || errorType?.includes('Configuration')) {
    setError(messageFromErrorCode('CredentialsConfiguration', ''))
    return true
  }
  if (errorType === 'CredentialsSignin' || errorType?.startsWith('CredentialsSignin')) {
    const codeToUse = errorCode || (errorType.includes(':') ? errorType.split(':')[1].trim() : 'CredentialsInvalid')
    setError(messageFromErrorCode(codeToUse, 'Credenciales inválidas. Verifica tu correo y contraseña.'))
    return true
  }
  if (errorType && errorType.length > 0 && !isOk) {
    setError(messageFromErrorCode(errorCode || errorType, errorType))
    return true
  }
  if (resultError) {
    const raw = resultError.toString().trim()
    setError(messageFromErrorCode(raw, raw || 'No se pudo iniciar sesión. Intenta de nuevo.'))
    return true
  }
  return false
}

function handleRawError(raw: string, setError: (msg: string) => void) {
  if (!raw || raw === 'Configuration' || raw.includes('Configuration')) {
    setError(messageFromErrorCode('CredentialsConfiguration', ''))
    return
  }
  if (raw === 'CredentialsSignin' || raw.startsWith('CredentialsSignin')) {
    const rawMsg = raw.includes(':') 
      ? raw.split(':')[1].trim()
      : ''
    
    // Check if the message itself is a known error code (like CredentialsRateLimit)
    if (rawMsg && ERROR_CODE_TO_MESSAGE[rawMsg]) {
      setError(ERROR_CODE_TO_MESSAGE[rawMsg])
      return
    }

    setError(
      rawMsg && rawMsg.length > 0
        ? messageFromErrorCode(rawMsg, rawMsg)
        : 'Credenciales inválidas. Verifica tu correo y contraseña.'
    )
    return
  }
  setError(messageFromErrorCode(raw, raw))
}

function processSignInResult(
  result: { error?: string | null; url?: string | null; ok?: boolean } | undefined | null,
  searchParams: ReturnType<typeof useSearchParams>,
  router: ReturnType<typeof useRouter>,
  setError: (msg: string) => void
) {
  let hasError = false

  if (result?.url?.includes('error=')) {
    const parsed = parseErrorFromUrlString(result.url)
    hasError = handleUrlError(parsed, result.error, result.ok, setError)
  } else if (result?.error) {
    handleRawError((result.error ?? '').toString().trim(), setError)
    hasError = true
  }

  if (!hasError) {
    const callback = safeRedirectUrl(searchParams?.get('callbackUrl'))
    router.push(callback)
    router.refresh()
  }
}

export function SignInForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const derivedUrlError = (function parseInitialUrlError() {
    const qError = searchParams?.get('error')
    const qCode = searchParams?.get('code')
    if (!qError) return null
    if (qError === 'Configuration' || qError?.includes('Configuration')) {
      return messageFromErrorCode('CredentialsConfiguration', '')
    }
    if (qError === 'CredentialsSignin' || qError.startsWith('CredentialsSignin')) {
      return messageFromErrorCode(qCode, 'Credenciales inválidas. Verifica tu correo y contraseña.')
    }
    if (qError && qError.length > 0) {
      return messageFromErrorCode(qCode || qError, qError)
    }
    return null
  })()

  const [error, setError] = useState<string>(derivedUrlError || '')
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

      processSignInResult(result, searchParams, router, setError)
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
