'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import Link from 'next/link'
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react'

function AcceptInviteContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const token = searchParams.get('token')

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [inviteData, setInviteData] = useState<{
    organizationName: string
    userEmail: string
    userName: string
    needsPassword: boolean
  } | null>(null)

  useEffect(() => {
    if (!token) {
      setError('Enlace de invitación no válido o incompleto.')
      setLoading(false)
      return
    }

    const verifyToken = async () => {
      try {
        const res = await fetch(`/api/auth/invite/verify?token=${token}`)
        const data = await res.json()

        if (!res.ok) {
          throw new Error(data.error || 'Error al verificar la invitación')
        }

        setInviteData(data.data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error desconocido')
      } finally {
        setLoading(false)
      }
    }

    verifyToken()
  }, [token])

  const handleAccept = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)

    try {
      const res = await fetch('/api/auth/invite/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Error al procesar la invitación')
      }

      setSuccess(true)
      
      // Redireccionar según el flujo
      setTimeout(() => {
        if (data.redirect) {
          router.push(data.redirect)
        }
      }, 1500)

    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ocurrió un error')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
        <p className="text-muted-foreground">Verificando invitación...</p>
      </div>
    )
  }

  if (error) {
    return (
      <Card className="w-full max-w-md mx-auto shadow-xl border-destructive/20">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto bg-destructive/10 w-12 h-12 rounded-full flex items-center justify-center mb-4">
            <AlertCircle className="h-6 w-6 text-destructive" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Invitación Inválida</h1>
        </CardHeader>
        <CardContent className="text-center pt-4">
          <p className="text-muted-foreground">{error}</p>
        </CardContent>
        <CardFooter className="flex justify-center pt-6">
          <Button asChild variant="outline">
            <Link href="/auth/signin">Volver al Inicio de Sesión</Link>
          </Button>
        </CardFooter>
      </Card>
    )
  }

  if (success) {
    return (
      <Card className="w-full max-w-md mx-auto shadow-xl border-green-500/20">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto bg-green-500/10 w-12 h-12 rounded-full flex items-center justify-center mb-4">
            <CheckCircle2 className="h-6 w-6 text-green-600" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">¡Cuenta Lista!</h1>
        </CardHeader>
        <CardContent className="text-center pt-4">
          <p className="text-muted-foreground">
            Has aceptado la invitación exitosamente. Redirigiendo al inicio de sesión...
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="w-full max-w-md mx-auto shadow-xl">
      <CardHeader className="text-center space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Aceptar Invitación</h1>
        <CardDescription className="text-base">
          Has sido invitado a unirte a <strong className="text-foreground">{inviteData?.organizationName}</strong>
        </CardDescription>
      </CardHeader>
      
      <form onSubmit={handleAccept}>
        <CardContent className="space-y-4">
          <div className="bg-muted/50 p-4 rounded-lg text-sm space-y-2 mb-6">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Usuario:</span>
              <span className="font-medium">{inviteData?.userName || 'Usuario'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Correo:</span>
              <span className="font-medium">{inviteData?.userEmail}</span>
            </div>
          </div>

          {inviteData?.needsPassword && (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <p className="text-sm text-muted-foreground text-center">
                Para completar tu registro de forma segura, serás redirigido al panel de creación de contraseña.
              </p>
            </div>
          )}
        </CardContent>

        <CardFooter>
          <Button 
            type="submit" 
            className="w-full" 
            disabled={submitting}
          >
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {inviteData?.needsPassword ? 'Comenzar Registro Seguro' : 'Aceptar Invitación'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}

export default function AcceptInvitePage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-white dark:from-gray-950 dark:to-gray-900 px-4 py-12">
      <Suspense fallback={
        <div className="flex items-center justify-center min-h-screen">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      }>
        <AcceptInviteContent />
      </Suspense>
    </div>
  )
}
