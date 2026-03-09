'use client'

import { useState, useEffect } from 'react'
import { signIn } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import Link from 'next/link'
import NextImage from 'next/image'
import { SignInForm } from '@/components/auth/signin-form'

export default function SignIn() {
  const [isLoading, setIsLoading] = useState(false)
  const [isClient, setIsClient] = useState(false)

  // Asegurar que el componente esté montado en el cliente
  useEffect(() => {
    setIsClient(true) // eslint-disable-line react-hooks/set-state-in-effect
  }, [])

  const handleGoogleSignIn = async () => {
    setIsLoading(true)
    try {
      await signIn('google', { callbackUrl: '/dashboard' })
    } catch {
      setIsLoading(false)
    }
  }

  // Renderizar un placeholder simple mientras se hidrata
  if (!isClient) {
    return (
      <div className="min-h-screen bg-gray-50" suppressHydrationWarning>
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-pulse">
            <div className="h-12 w-12 bg-blue-200 rounded-full mb-4"></div>
            <div className="h-4 bg-gray-200 rounded w-32"></div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-white dark:from-gray-950 dark:to-gray-900 px-4 font-sans">
      <div className="w-full max-w-6xl grid grid-cols-1 md:grid-cols-2 gap-8 items-stretch">
        {/* Panel ilustrativo */}
        <div className="hidden md:block">
          <Card className="bg-gradient-to-b from-primary to-[#0f172a] text-primary-foreground shadow-2xl border-none h-full flex flex-col justify-between">
            <CardHeader>
              <div className="flex items-start mb-2">
                 <span className="text-3xl font-heading font-bold text-white">Factronica</span>
                 <div className="flex ml-1 mt-2 space-x-0.5">
                   <span className="w-2 h-2 rounded-full bg-secondary"></span>
                   <span className="w-2 h-2 rounded-full bg-secondary mt-1"></span>
                   <span className="w-2 h-2 rounded-full bg-secondary"></span>
                 </div>
              </div>
              <CardDescription className="text-blue-100 text-base">
                Automatiza tus procesos, optimiza tu gestión y mantén control total de tu cumplimiento fiscal.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* Ilustración SVG (proporcional) */}
              <div className="w-full aspect-[400/220] my-8">
                <svg viewBox="0 0 400 220" preserveAspectRatio="xMidYMid meet" className="w-full h-full drop-shadow-lg">
                  <defs>
                    <linearGradient id="lineGrad" x1="0" x2="1" y1="0" y2="0">
                      <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
                      <stop offset="100%" stopColor="#ffffff" stopOpacity="0.5" />
                    </linearGradient>
                  </defs>
                  <rect x="0" y="0" width="400" height="220" fill="transparent" />
                  {/* Barras - Updated Opacities for Blue Background */}
                  <rect x="30" y="120" width="24" height="70" rx="4" fill="#ffffff" opacity="0.3" />
                  <rect x="90" y="80" width="24" height="110" rx="4" fill="#ffffff" opacity="0.4" />
                  <rect x="150" y="100" width="24" height="90" rx="4" fill="#ffffff" opacity="0.3" />
                  <rect x="210" y="60" width="24" height="130" rx="4" fill="#ffffff" opacity="0.5" />
                  <rect x="270" y="90" width="24" height="100" rx="4" fill="#ffffff" opacity="0.4" />
                  <rect x="330" y="50" width="24" height="140" rx="4" fill="#ffffff" opacity="0.6" />
                  {/* Línea */}
                  <path d="M20 180 C 70 160, 110 120, 150 130 C 190 140, 230 100, 270 110 C 310 120, 350 70, 380 90" stroke="url(#lineGrad)" strokeWidth="4" fill="none" strokeLinecap="round" />
                </svg>
              </div>
              <div className="grid grid-cols-3 gap-4 text-center mt-auto">
                <div className="bg-white/10 rounded-lg p-3 backdrop-blur-sm flex flex-col items-center justify-center">
                  <div className="relative w-12 h-12 mb-2">
                    <NextImage 
                      src="/images/certifications/pac-sat.webp" 
                      alt="PAC SAT 10235" 
                      fill 
                      className="object-contain"
                    />
                  </div>
                  <p className="text-xs text-blue-100 uppercase tracking-wider">Autorizado SAT</p>
                </div>
                <div className="bg-white/10 rounded-lg p-3 backdrop-blur-sm flex flex-col items-center justify-center">
                  <div className="relative w-12 h-12 mb-2">
                    <NextImage 
                      src="/images/certifications/pci-dss.jpg" 
                      alt="PCI DSS" 
                      fill 
                      className="object-contain rounded-sm"
                    />
                  </div>
                  <p className="text-xs text-blue-100 uppercase tracking-wider">Certificado</p>
                </div>
                <div className="bg-white/10 rounded-lg p-3 backdrop-blur-sm flex flex-col items-center justify-center">
                  <p className="text-xl font-bold font-heading py-2">+15 Años</p>
                  <p className="text-xs text-blue-100 uppercase tracking-wider">Experiencia</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Columna de login */}
        <div className="w-full flex items-center">
          <Card className="shadow-xl flex flex-col w-full border-0 md:border">
            <CardHeader className="space-y-3 text-center pb-8">
              <div className="inline-flex items-center justify-center mx-auto mb-4">
                 {/* CFDI Task Manager Logo */}
                 <span className="text-2xl font-heading font-bold text-primary">CFDI Task Manager</span>
                 <div className="flex ml-1 mt-1.5 space-x-0.5">
                   <span className="w-1.5 h-1.5 rounded-full bg-secondary"></span>
                   <span className="w-1.5 h-1.5 rounded-full bg-secondary mt-1"></span>
                   <span className="w-1.5 h-1.5 rounded-full bg-secondary"></span>
                 </div>
              </div>
              <h1 className="text-2xl font-heading font-semibold text-foreground">Bienvenido de nuevo</h1>
              <CardDescription className="text-center text-muted-foreground text-base">
                Ingresa a tu portal de gestión fiscal
              </CardDescription>
            </CardHeader>
            
            <CardContent className="space-y-6 px-8 md:px-12">
              <SignInForm />

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <Separator className="w-full" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">O continúa con</span>
                </div>
              </div>

              <Button 
                variant="outline" 
                className="w-full"
                onClick={handleGoogleSignIn}
                disabled={isLoading}
              >
                <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Google
              </Button>
            </CardContent>
            
            <CardFooter className="pb-8">
              <p className="text-center text-base text-muted-foreground w-full">
                ¿No tienes una cuenta?{' '}
                <Link href="/auth/signup" className="text-primary hover:text-primary/80 font-semibold transition-colors hover:underline">
                  Regístrate aquí
                </Link>
              </p>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  )
}
