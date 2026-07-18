import { useCallback, useEffect, useState } from 'react'
import { useTenant } from '@/hooks/use-tenant'

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

export function useCompanyAccess() {
  const { tenantState } = useTenant()
  const [loading, setLoading] = useState(false)
  const [hasAccess, setHasAccess] = useState<boolean>(false)
  const orgId = tenantState?.organizationId

  const fetchAccess = useCallback(async (signal?: AbortSignal) => {
    if (!orgId) {
      setHasAccess(false)
      return
    }
    try {
      setLoading(true)
      const res = await fetch(`/api/user/company-access?orgId=${orgId}`, { cache: 'no-store', signal })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al cargar accesos')
      setHasAccess(Boolean(data.hasAccess))
    } catch (error) {
      if (isAbortError(error)) {
        return
      }
      setHasAccess(false)
    } finally {
      if (!signal?.aborted) {
        setLoading(false)
      }
    }
  }, [orgId])

  useEffect(() => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => {
      void fetchAccess(controller.signal)
    }, 0)

    return () => {
      clearTimeout(timeoutId)
      controller.abort()
    }
  }, [orgId, fetchAccess])

  useEffect(() => {
    const handleRefresh = () => {
      void fetchAccess()
    }
    const handleFocus = () => {
      void fetchAccess()
    }
    document.addEventListener('company-access-changed', handleRefresh)
    window.addEventListener('company-access-changed', handleRefresh as EventListener)
    window.addEventListener('focus', handleFocus)
    return () => {
      document.removeEventListener('company-access-changed', handleRefresh)
      window.removeEventListener('company-access-changed', handleRefresh as EventListener)
      window.removeEventListener('focus', handleFocus)
    }
  }, [orgId, fetchAccess])

  return { loading, hasAccess, refresh: fetchAccess }
}
