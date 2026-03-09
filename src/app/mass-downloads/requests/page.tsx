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
      <div className="container mx-auto py-10 px-4">
        <div className="flex flex-col space-y-8">
          <div className="flex flex-col space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">Solicitud de Descargas</h1>
            <p className="text-muted-foreground">
              Solicita nuevas descargas masivas de CFDI.
            </p>
          </div>
          
          <MassDownloadRequestForm />
        </div>
      </div>
    </ProtectedRoute>
  )
}
