import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { JsonValue } from '@prisma/client/runtime/library'

export interface TenantState {
  organizationId: string
  organizationName: string
  ownerId: string
  isOwner: boolean
  status: {
    onboardingCompleted: boolean
    operationalAccessEnabled: boolean
    setupProgress: number
    requirements: {
      minUsers: number
      minCompanies: number
      requiredSteps: string[]
    }
    currentState: {
      totalUsers: number
      totalApprovedUsers: number
      totalInvitations: number
      totalCompanies: number
      completedSteps: string[]
    }
  }
  hasOperationalAccess: boolean
  onboardingSteps: Array<{
    key: string
    title: string
    description: string
    order: number
  }>
  userOnboarding: {
    step: string | null
    data: JsonValue
  }
  loading: boolean
  error: string | null
}

export function useTenant() {
  const { data: session } = useSession()
  const [tenantState, setTenantState] = useState<TenantState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (session?.user) {
      fetchTenantStatus()
    } else {
      setLoading(false)
    }
  }, [session])

  const fetchTenantStatus = async () => {
    try {
      setLoading(true)
      setError(null)

      const response = await fetch('/api/tenant/status')
      
      if (!response.ok) {
        throw new Error('Error al obtener estado del tenant')
      }

      const data = await response.json()
      setTenantState(data.tenant)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido')
      setTenantState(null)
    } finally {
      setLoading(false)
    }
  }

  const refreshTenantStatus = () => {
    fetchTenantStatus()
  }

  const canAccessOperationalFeatures = (): boolean => {
    return tenantState?.hasOperationalAccess ?? false
  }

  const isTenantOwner = (): boolean => {
    return tenantState?.isOwner ?? false
  }

  const getOnboardingProgress = (): number => {
    return tenantState?.status.setupProgress ?? 0
  }

  const getNextOnboardingStep = (): string | null => {
    if (!tenantState) return null

    const completedSteps = tenantState.status.currentState.completedSteps
    const allSteps = tenantState.onboardingSteps

    // Find the next incomplete step
    for (const step of allSteps) {
      if (!completedSteps.includes(step.key)) {
        return step.key
      }
    }

    return null
  }

  return {
    tenantState,
    loading,
    error,
    refreshTenantStatus,
    canAccessOperationalFeatures,
    isTenantOwner,
    getOnboardingProgress,
    getNextOnboardingStep
  }
}
