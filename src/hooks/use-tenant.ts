import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { JsonValue } from '@prisma/client/runtime/library'

let tenantStatusRequest: Promise<TenantState | null> | null = null

async function requestTenantStatus() {
  if (!tenantStatusRequest) {
    tenantStatusRequest = fetch('/api/tenant/status')
      .then(async response => {
        if (!response.ok) {
          throw new Error('Error al obtener estado del tenant')
        }

        const data = await response.json()
        return data.tenant as TenantState
      })
      .finally(() => {
        tenantStatusRequest = null
      })
  }

  return tenantStatusRequest
}

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
  const { data: session, status } = useSession()
  const [tenantState, setTenantState] = useState<TenantState | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function fetchTenantStatus() {
    try {
      setLoading(true)
      setError(null)

      const tenant = await requestTenantStatus()
      setTenantState(tenant)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido')
      setTenantState(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (session?.user) {
      let isDisposed = false
      const timeoutId = setTimeout(() => {
        void (async () => {
          try {
            setLoading(true)
            setError(null)
            const tenant = await requestTenantStatus()
            if (!isDisposed) {
              setTenantState(tenant)
            }
          } catch (err) {
            if (!isDisposed) {
              setError(err instanceof Error ? err.message : 'Error desconocido')
              setTenantState(null)
            }
          } finally {
            if (!isDisposed) {
              setLoading(false)
            }
          }
        })()
      }, 0)

      return () => {
        isDisposed = true
        clearTimeout(timeoutId)
      }
    }
  }, [session])

  const refreshTenantStatus = () => {
    void fetchTenantStatus()
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

  const effectiveTenantState = session?.user ? tenantState : null
  const effectiveError = session?.user ? error : null
  const effectiveLoading = status === 'loading' || (Boolean(session?.user) && loading)

  return {
    tenantState: effectiveTenantState,
    loading: effectiveLoading,
    error: effectiveError,
    refreshTenantStatus,
    canAccessOperationalFeatures,
    isTenantOwner,
    getOnboardingProgress,
    getNextOnboardingStep
  }
}
