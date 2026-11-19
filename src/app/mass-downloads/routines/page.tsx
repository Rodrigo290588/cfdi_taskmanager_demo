import type { Metadata } from 'next'
import { ProtectedRoute } from '@/components/auth/protected-route'
import { RoutineManager } from '@/components/mass-downloads/routine-manager'

export const metadata: Metadata = {
  title: 'Rutinas de descarga masiva - CFDI Task Manager',
  description: 'Programa y monitorea descargas masivas automatizadas del SAT',
}

export default function MassDownloadRoutinesPage() {
  return (
    <ProtectedRoute>
      <main className="flex-1 space-y-5 p-4 pt-6 md:p-6">
        <RoutineManager />
      </main>
    </ProtectedRoute>
  )
}
