export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

import { Suspense } from 'react'
import { DashboardSkeleton } from '@/components/loading/skeletons'
import { RhDashboardClientPage } from './rh-client-page'
import { RhDashboardServerPage } from './rh-server-page'
import { parseRhSearchParams } from '@/lib/rh-dashboard-url'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function RhDashboardPage(props: {
  searchParams: SearchParams
}) {
  const awaited = await props.searchParams
  const initialFilters = parseRhSearchParams(awaited)

  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <RhDashboardClientPage initialSearchParams={awaited}>
        <RhDashboardServerPage initialFilters={initialFilters} />
      </RhDashboardClientPage>
    </Suspense>
  )
}
