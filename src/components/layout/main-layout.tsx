'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { Sidebar } from './sidebar'
import { Button } from '@/components/ui/button'
import { Menu, Bell } from 'lucide-react'

interface MainLayoutProps {
  children: React.ReactNode
}

export function MainLayout({ children }: MainLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [isClient, setIsClient] = useState(false)
  const pathname = usePathname()

  // Asegurar que el componente esté montado en el cliente
  useEffect(() => {
    setIsClient(true) // eslint-disable-line react-hooks/set-state-in-effect
  }, [])
  
  // No mostrar sidebar en páginas de autenticación
  const isAuthPage = pathname?.startsWith('/auth/')

  if (!isClient) {
    // Renderizar un placeholder mientras se hidrata
    return <div className="min-h-screen bg-gray-50">{children}</div>
  }

  if (isAuthPage) {
    return <>{children}</>
  }

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <Sidebar isOpen={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} />

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top header */}
        <header className="bg-gradient-to-r from-primary to-[#0f172a] shadow-md border-b border-white/10 h-16 shrink-0">
          <div className="flex items-center justify-between px-4 h-full">
            <div className="flex items-center">
              <Button
                variant="ghost"
                size="icon"
                className="rounded-full text-white hover:bg-white/10 hover:text-white"
                onClick={() => setSidebarOpen(!sidebarOpen)}
              >
                <Menu className="h-5 w-5" />
              </Button>
              <h1 className="ml-4 text-xl font-heading font-semibold text-white">
                Plataforma de Inteligencia Fiscal Mexicana
              </h1>
            </div>
            
            <div className="flex items-center space-x-4">
              <Button variant="ghost" size="icon" className="rounded-full text-white hover:bg-white/10 hover:text-white">
                <Bell className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </header>

        {/* Main content area */}
        <main className="flex-1 overflow-auto bg-gray-50/30">
          {children}
        </main>
      </div>
    </div>
  )
}
