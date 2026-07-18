'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { Sidebar } from './sidebar'
import { Button } from '@/components/ui/button'
import { Menu, Bell } from 'lucide-react'

interface MainLayoutProps {
  children: React.ReactNode
}

const desktopSidebarQuery = '(min-width: 1024px)'

export function MainLayout({ children }: MainLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [isClient, setIsClient] = useState(false)
  const pathname = usePathname()

  // Asegurar que el componente esté montado en el cliente
  useEffect(() => {
    const mediaQuery = window.matchMedia(desktopSidebarQuery)
    const syncSidebarState = (matches: boolean) => {
      setSidebarOpen(matches)
    }

    const timeoutId = setTimeout(() => {
      syncSidebarState(mediaQuery.matches)
      setIsClient(true)
    }, 0)

    const handleViewportChange = (event: MediaQueryListEvent) => {
      syncSidebarState(event.matches)
    }

    mediaQuery.addEventListener('change', handleViewportChange)

    return () => {
      clearTimeout(timeoutId)
      mediaQuery.removeEventListener('change', handleViewportChange)
    }
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
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar */}
      <Sidebar isOpen={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} />

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
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
              <h1 className="ml-4 text-xl font-heading font-semibold text-white truncate">
                CFDI Task Manager
              </h1>
            </div>
            
            <div className="flex items-center space-x-4 shrink-0">
              <Button variant="ghost" size="icon" className="rounded-full text-white hover:bg-white/10 hover:text-white">
                <Bell className="h-5 w-5" />
              </Button>
            </div>
          </div>
        </header>

        {/* Main content area */}
        <main className="flex-1 overflow-y-auto bg-gray-50/30 relative">
          {children}
        </main>
      </div>
    </div>
  )
}
