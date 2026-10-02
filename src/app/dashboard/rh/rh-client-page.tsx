'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { DashboardSkeleton } from '@/components/loading/skeletons'
import { buildRhDashboardUrl, parseRhSearchParams } from '@/lib/rh-dashboard-url'

type SelectedCompanyShape = { id?: string; rfc?: string; businessName?: string; name?: string } | null

function readSelectedCompanyFromStorage(): SelectedCompanyShape {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem('selectedCompany')
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && 'id' in (parsed as Record<string, unknown>)) {
      return parsed as SelectedCompanyShape
    }
    return null
  } catch {
    return null
  }
}

export function RhDashboardClientPage(props: {
  initialSearchParams: Record<string, string | string[] | undefined>
  children: ReactNode
}) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const initialFilters = useMemo(
    () => parseRhSearchParams(props.initialSearchParams),
    [props.initialSearchParams],
  )

  const [mounted, setMounted] = useState(false)
  const [selectedCompany, setSelectedCompany] = useState<SelectedCompanyShape>(null)

  const urlCompanyId = searchParams.get('companyId') ?? initialFilters.companyId ?? ''
  const hasCompanyInUrl = urlCompanyId.length > 0

  const populateFromStorage = useCallback(({ force }: { force: boolean }) => {
    const stored = readSelectedCompanyFromStorage()
    const storedId = stored?.id
    if (!storedId) return

    if (force || !urlCompanyId || urlCompanyId !== storedId) {
      const preserved: Record<string, string> = {}
      const sd = searchParams.get('startDate')
      const ed = searchParams.get('endDate')
      const d = searchParams.get('departamento')
      const v = searchParams.get('view')
      const sec = searchParams.get('sections')
      const org = searchParams.get('organizationId')
      const fe = searchParams.get('fiscalEntityId')
      if (sd) preserved.startDate = sd
      if (ed) preserved.endDate = ed
      if (d && d.length > 0) preserved.departamento = d
      if (v) preserved.view = v
      if (sec && sec.length > 0) preserved.sections = sec
      if (org) preserved.organizationId = org
      if (fe) preserved.fiscalEntityId = fe

      const nextUrl = buildRhDashboardUrl('/dashboard/rh', {
        companyId: storedId,
        ...preserved,
      })
      window.history.replaceState(window.history.state, '', nextUrl)
      router.replace(nextUrl, { scroll: false })
    }
  }, [urlCompanyId, searchParams, router])

  useEffect(() => {
    const t = window.setTimeout(() => {
      setMounted(true)
      setSelectedCompany(readSelectedCompanyFromStorage())
    }, 0)

    const handler = () => {
      setSelectedCompany(readSelectedCompanyFromStorage())
      populateFromStorage({ force: true })
    }
    window.addEventListener('company-selected', handler as EventListener)
    document.addEventListener('company-selected', handler as EventListener)
    window.addEventListener('storage', handler as EventListener)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('company-selected', handler as EventListener)
      document.removeEventListener('company-selected', handler as EventListener)
      window.removeEventListener('storage', handler as EventListener)
    }
  }, [populateFromStorage])

  useEffect(() => {
    if (!mounted) return
    populateFromStorage({ force: false })
  }, [mounted, populateFromStorage])

  if (!mounted) {
    return <DashboardSkeleton />
  }

  if (!hasCompanyInUrl && !selectedCompany?.id) {
    return (
      <div className="flex-1 space-y-4 p-4 md:p-6 pt-6">
        <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-widest text-slate-500 mb-1">
              Tablero de Recursos Humanos
            </p>
            <h1 className="text-3xl font-bold tracking-tight">KPIs de Nómina 1.2 — Complemento SAT</h1>
          </div>
        </header>
        <Card>
          <CardHeader>
            <div className="text-lg font-semibold">Selecciona una empresa</div>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-3">
            <p>
              Usa el selector de empresas del sidebar para elegir una RFC, o agrega
              <code className="inline-block mx-1 px-1 rounded bg-slate-100">?companyId=...</code>
              a la URL para visualizar los KPIs de RH.
            </p>
            <p className="text-xs text-slate-500">
              Elige una empresa desde el botón del tenant en la parte superior del menú lateral.
            </p>
            <div>
              <Link href="/dashboard" passHref legacyBehavior>
                <Button asChild variant="outline" size="sm">
                  <a>Ir al inicio del dashboard</a>
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return <>{props.children}</>
}
