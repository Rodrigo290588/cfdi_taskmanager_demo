import { GET as getFiscalControl } from '../route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const url = new URL(request.url)
  url.pathname = url.pathname.replace(/\/summary$/, '')
  url.searchParams.set('summaryOnly', 'true')
  return getFiscalControl(new Request(url, { headers: request.headers }))
}
