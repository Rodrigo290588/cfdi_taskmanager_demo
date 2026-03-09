import { useCallback, useEffect, useState } from 'react'
import { useTenant } from '@/hooks/use-tenant'

export function useCompanyAccess() {
  const { tenantState } = useTenant()
  const [loading, setLoading] = useState(false)
  const [hasAccess, setHasAccess] = useState<boolean>(false)
  const orgId = tenantState?.organizationId

  const fetchAccess = useCallback(async () => {
    if (!orgId) {
      setHasAccess(false)
      return
    }
    try {
      setLoading(true)
      const res = await fetch(`/api/user/company-access?orgId=${orgId}`, { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al cargar accesos')
      setHasAccess(Boolean(data.hasAccess))
    } catch {
      setHasAccess(false)
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    fetchAccess()
  }, [orgId, fetchAccess])

  useEffect(() => {
    const handleRefresh = () => fetchAccess()
    const handleFocus = () => fetchAccess()
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
