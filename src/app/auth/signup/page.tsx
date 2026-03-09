'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from '@/components/ui/card'
import Link from 'next/link'
import NextImage from 'next/image'
import { SignUpForm } from '@/components/auth/signup-form'

export default function SignUp() {
  const [isClient, setIsClient] = useState(false)

  // Asegurar que el componente esté montado en el cliente
  useEffect(() => {
    setIsClient(true) // eslint-disable-line react-hooks/set-state-in-effect
  }, [])

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
              <div className="w-full aspect-[400/220] my-8">
                <svg viewBox="0 0 400 220" preserveAspectRatio="xMidYMid meet" className="w-full h-full drop-shadow-lg">
                  <defs>
                    <linearGradient id="lineGrad" x1="0" x2="1" y1="0" y2="0">
                      <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
                      <stop offset="100%" stopColor="#ffffff" stopOpacity="0.5" />
                    </linearGradient>
                  </defs>
                  <rect x="0" y="0" width="400" height="220" fill="transparent" />
                  <rect x="30" y="120" width="24" height="70" rx="4" fill="#ffffff" opacity="0.3" />
                  <rect x="90" y="80" width="24" height="110" rx="4" fill="#ffffff" opacity="0.4" />
                  <rect x="150" y="100" width="24" height="90" rx="4" fill="#ffffff" opacity="0.3" />
                  <rect x="210" y="60" width="24" height="130" rx="4" fill="#ffffff" opacity="0.5" />
                  <rect x="270" y="90" width="24" height="100" rx="4" fill="#ffffff" opacity="0.4" />
                  <rect x="330" y="50" width="24" height="140" rx="4" fill="#ffffff" opacity="0.6" />
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

        {/* Columna de registro */}
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
              <h1 className="text-2xl font-heading font-semibold text-foreground">Crear Cuenta</h1>
              <CardDescription className="text-center text-muted-foreground text-base">
                Regístrate para acceder al sistema
              </CardDescription>
            </CardHeader>
            
            <CardContent className="space-y-6 px-8 md:px-12">
              <SignUpForm />
            </CardContent>
            
            <CardFooter className="pb-8">
              <p className="text-center text-sm text-muted-foreground w-full">
                ¿Ya tienes una cuenta?{' '}
                <Link href="/auth/signin" className="text-primary hover:text-primary/80 font-semibold transition-colors">
                  Inicia sesión aquí
                </Link>
              </p>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  )
}
