import { OnboardingDashboard } from '@/components/tenant/onboarding-dashboard'
import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'

export default async function TenantDashboardPage() {
  const session = await auth()

  if (!session?.user) {
    redirect('/login')
  }

  return (
    <div className="container mx-auto py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">
          Bienvenido a Fiscal Vault Intelligence
        </h1>
        <p className="text-muted-foreground mt-2">
          Complete la configuración de su organización para comenzar a utilizar todas las funcionalidades del sistema.
        </p>
      </div>

      <OnboardingDashboard />
    </div>
  )
}
