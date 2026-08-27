import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateCfdiPdfFromXml } from '@/lib/cfdi-pdf'
import { getStoredProviderXmlRecordForCompany } from '@/lib/provider-cfdi-storage'
import { buildDashboardScopedContext, dashboardJsonErrorResponse, sanitizeDownloadFilename, buildRfc5987ContentDisposition } from '@/lib/dashboard-fiscal-route-utils'
import { DashboardRecibidosDownloadQuerySchema } from '@/schemas/dashboard-recibidos'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(request: NextRequest) {
  try {
    const scoped = await buildDashboardScopedContext(request, { routeKey: 'drilldownPdf', requireCompanyId: true })
    const { ctx, sessionUserId } = scoped
    const companyId = ctx.companyId!

    const rawQuery = Object.fromEntries(scoped.searchParams.entries())
    const parsed = DashboardRecibidosDownloadQuerySchema.safeParse(rawQuery)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Parámetros inválidos', issues: parsed.error.flatten().fieldErrors }, { status: 400 })
    }
    const recordId = parsed.data.id

    const member = (await prisma.member.findFirst({
      where: { userId: sessionUserId, status: 'APPROVED', organizationId: ctx.organizationId }
    }))!

    ;(await prisma.companyAccess.findUnique({
      where: { memberId_companyId: { memberId: ctx.memberId, companyId } }
    }))!

    const preCheck = await prisma.providerUploadedCfdi.findFirst({
      where: {
        uuid: recordId,
        organizationId: member.organizationId,
        receiverCompanyId: companyId
      },
      select: { id: true, uuid: true, satEstado: true }
    })
    if (!preCheck) {
      return NextResponse.json({ error: 'No se encontró el CFDI solicitado' }, { status: 404 })
    }

    const storedRecord = await getStoredProviderXmlRecordForCompany({
      recordId,
      organizationId: member.organizationId,
      companyId
    })
    if (!storedRecord) {
      return NextResponse.json({ error: 'No se encontró el CFDI solicitado' }, { status: 404 })
    }

    const { pdfBuffer, uuid: resolvedUuid } = await generateCfdiPdfFromXml({
      xmlRaw: storedRecord.xmlContent,
      invoiceIdForFallback: storedRecord.uuid,
      isCancelled: preCheck.satEstado === 'CANCELADO'
    })

    const safeBasename = sanitizeDownloadFilename('cfdi_' + resolvedUuid, 'download', 'pdf')
    const contentDisposition = buildRfc5987ContentDisposition(safeBasename, 'attachment')

    const securityHeaders = {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'self'; script-src 'none'; frame-ancestors 'none'",
      'Strict-Transport-Security': 'max-age=63072000; includeSubDomains'
    }

    return new NextResponse(Uint8Array.from(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': contentDisposition,
        'Cache-Control': 'private, no-store, max-age=0',
        ...securityHeaders
      }
    })
  } catch (error) {
    return dashboardJsonErrorResponse(error)
  }
}
