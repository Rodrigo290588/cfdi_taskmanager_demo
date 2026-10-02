export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

import { Suspense } from 'react'
import { DashboardSkeleton } from '@/components/loading/skeletons'
import { DireccionDashboardClientPage } from './direccion-client-page'
import { DireccionDashboardServerPage } from './direccion-server-page'
import { parseDireccionSearchParams } from '@/lib/direccion-dashboard-url'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function DireccionDashboardPage(props: Readonly<{
  searchParams: SearchParams
}>) {
  const awaited = await props.searchParams
  const initialFilters = parseDireccionSearchParams(awaited)

  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DireccionDashboardClientPage initialSearchParams={awaited}>
        <DireccionDashboardServerPage initialFilters={initialFilters} />
      </DireccionDashboardClientPage>
    </Suspense>
  )
}
