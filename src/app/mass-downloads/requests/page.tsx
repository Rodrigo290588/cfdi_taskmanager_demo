import { Metadata } from "next"
import { ProtectedRoute } from "@/components/auth/protected-route"
import { MassDownloadRequestForm } from "@/components/mass-downloads/request-form"

export const metadata: Metadata = {
  title: "Solicitud de Descargas - PlatFi Intelligence",
  description: "Solicita y gestiona tus descargas masivas de CFDI",
}

export default function MassDownloadsRequestsPage() {
  return (
    <ProtectedRoute>
      <div className="flex-1 space-y-4 p-4 md:p-6 pt-6">
        <div className="flex items-center justify-between space-y-2">
          <div className="flex flex-col space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">Solicitud de Descargas</h1>
            <p className="text-sm text-muted-foreground">
              Solicita nuevas descargas masivas de CFDI.
            </p>
          </div>
        </div>
        <div className="mt-4">
          <MassDownloadRequestForm />
        </div>
      </div>
    </ProtectedRoute>
  )
}
