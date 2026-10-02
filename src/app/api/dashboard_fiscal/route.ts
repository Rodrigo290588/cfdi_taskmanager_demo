import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { SystemRole, CfdiType, Prisma } from '@prisma/client'
import { hasPermission, Permission, type User as PermissionUser } from '@/lib/permissions'
import { SECURITY_HEADERS } from '@/lib/org-dashboard-helpers'
import { fp32 } from '@/lib/monitor-security-helpers'
import { safeErrSummary, type SafeErrorSummary } from '@/lib/security'
import {
  buildDashboardScopedContext,
  dashboardJsonErrorResponse,
  DASHBOARD_MAX_MONTHS
} from '@/lib/dashboard-fiscal-route-utils'

// ============================================================
// DASH-SAST-010: Configuración Next.js segura App Router
//  · runtime nodejs  → Prisma requiere libs TCP, Edge no compatible.
//  · dynamic force  → Dashboard es transaccional, NUNCA cachear.
//  · maxDuration 30 → Saneado de lambdas Vercel/turbo 25-30s.
// ============================================================
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// DASH-SAST-008 · Whitelist estricta parámetro origin.
const DASH_FISCAL_ALLOWED_ORIGINS: ReadonlySet<string> = new Set(['issued', 'received', 'both']);

import { getDashboardHeavyMetricsResponse } from './heavy-metrics'
import { getDashboardSummaryResponse } from './summary-metrics'

export async function GET(request: NextRequest) { // NOSONAR
  try {
    // DASH-SAST-008: enrichedUser para hasPermission granular EMISSION vs RECEPTION.
    const { ctx, searchParams, enrichedUser } = await buildDashboardScopedContext(request, {
      routeKey: 'mainHeavy',
      requireCompanyId: true,
      // Default scoping permiso: DASHBOARD_FISCAL_VIEW. El gate granular se hace ABAJO por origin.
    })

    const startDateParam = searchParams.get('startDate')
    const endDateParam = searchParams.get('endDate')
    const originRaw = searchParams.get('origin') || 'issued'
    const originParam = String(originRaw).toLowerCase();
    // DASHBOARD-005 · Heavy metrics OPT-IN (default FALSE). Solo si usuario envía explicitamente "true".
    const includeHeavyMetrics = searchParams.get('includeHeavyMetrics') === 'true'

    // =================================================================
    // DASH-SAST-008 · Allow-list estricta parámetro origin + granular
    // permission check: EMISSION_VIEW para issued, RECEPTION_VIEW para received.
    // Fail-closed: sin permiso → 403. Para origin=both sin ambos → degradar
    // al único permiso que sí tenga (nunca exponer datos sin permiso).
    // =================================================================
    if (!DASH_FISCAL_ALLOWED_ORIGINS.has(originParam)) {
      return NextResponse.json(
        { error: 'Parámetro origin inválido. Valores permitidos: issued | received | both.', code: 'BAD_ORIGIN' },
        { status: 400, headers: SECURITY_HEADERS }
      )
    }

    const permissionUser: PermissionUser = { id: enrichedUser.id, systemRole: ctx.userSystemRole as SystemRole }
    const canViewIssued = hasPermission(
      permissionUser,
      Permission.MODULE_EMISSION_VIEW,
      ctx.organizationId
    )
    const canViewReceived = hasPermission(
      permissionUser,
      Permission.MODULE_RECEPTION_VIEW,
      ctx.organizationId
    )

    let effectiveOrigin: 'issued' | 'received' | 'both'
    if (originParam === 'received') {
      if (!canViewReceived) {
        return NextResponse.json(
          { error: 'Sin permiso para ver facturas recibidas (MODULE_RECEPTION_VIEW).', code: 'FORBIDDEN_RECEPTION' },
          { status: 403, headers: SECURITY_HEADERS }
        )
      }
      effectiveOrigin = 'received'
    } else if (originParam === 'both') {
      if (!canViewIssued && !canViewReceived) {
        return NextResponse.json(
          { error: 'Sin permiso para ver el dashboard fiscal (EMISSION ni RECEPTION).', code: 'FORBIDDEN_FISCAL' },
          { status: 403, headers: SECURITY_HEADERS }
        )
      }
      // Fail-closed degradación elegante: si solo tiene 1 permiso, mostramos ese scope.
      if (canViewIssued && canViewReceived) effectiveOrigin = 'both'
      else if (canViewIssued) effectiveOrigin = 'issued'
      else effectiveOrigin = 'received'
    } else {
      // issued default
      if (!canViewIssued) {
        return NextResponse.json(
          { error: 'Sin permiso para ver facturas emitidas (MODULE_EMISSION_VIEW).', code: 'FORBIDDEN_EMISSION' },
          { status: 403, headers: SECURITY_HEADERS }
        )
      }
      effectiveOrigin = 'issued'
    }

    const companyId = searchParams.get('companyId')!

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { rfc: true, businessName: true }
    })
    if (!company?.rfc) {
      return NextResponse.json(
        { error: 'Empresa no encontrada' },
        { status: 404, headers: SECURITY_HEADERS }
      )
    }

    const rfc = company.rfc

    // Find matching fiscal entity strictly within the scoped ORGANIZATION from ctx (DASHBOARD-003 RFC leak).
    const fiscalEntity = await prisma.fiscalEntity.findFirst({
      where: { rfc, organizationId: ctx.organizationId },
      select: {
        id: true,
        organizationId: true
      }
    })

    // Do not auto-create fiscal entities or demo invoices; show empty metrics when absent.

    if (!fiscalEntity) {
      return NextResponse.json({
        company: { id: companyId, rfc, name: company.businessName },
        kpis: {
          totalCfdis: 0,
          totalMonto: 0,
          tasaCancelacion: 0,
          taxes: {
            ivaTrasladado: 0,
            ivaRetenido: 0,
            isrRetenido: 0,
            iepsRetenido: 0,
            breakdown: {
              tasa16: { base: 0, tax: 0 },
              tasa8: { base: 0, tax: 0 },
              tasa0: { base: 0, tax: 0 },
              exento: { base: 0, tax: 0 }
            }
          }
        },
        byType: [],
        bySatStatus: [],
        monthly: [],
        topSuppliers: [],
        topClients: [],
        paymentMethods: [],
        _security: {
          originRequested: originParam,
          originEffective: effectiveOrigin,
          canViewIssued,
          canViewReceived
        },
        meta: {
          heavyMetricsIncluded: false
        }
      }, { headers: SECURITY_HEADERS })
    }

    const issuerFiscalEntityId = fiscalEntity.id

    const dateFilter: Prisma.InvoiceWhereInput = {}
    if (startDateParam && endDateParam) {
      // Adjust endDate to include the full day
      const end = new Date(endDateParam)
      end.setUTCHours(23, 59, 59, 999)
      
      dateFilter.issuanceDate = {
        gte: new Date(startDateParam),
        lte: end
      }
    }

    // =================================================================
    // DASH-SAST-008: filtro base ahora depende de effectiveOrigin.
    // =================================================================
    let baseWhere: Prisma.InvoiceWhereInput
    if (effectiveOrigin === 'received') {
      baseWhere = {
        receiverRfc: rfc,
        cfdiType: { in: [CfdiType.INGRESO, CfdiType.PAGO] },
        ...dateFilter
      }
    } else if (effectiveOrigin === 'both') {
      baseWhere = {
        OR: [
          { issuerFiscalEntityId, issuerRfc: rfc },
          { receiverRfc: rfc }
        ],
        cfdiType: { in: [CfdiType.INGRESO, CfdiType.PAGO] },
        ...dateFilter
      }
    } else {
      // issued default
      baseWhere = { 
        issuerFiscalEntityId, 
        issuerRfc: rfc, 
        cfdiType: { in: [CfdiType.INGRESO, CfdiType.PAGO] },
        ...dateFilter
      }
    }

    // Determine months for chart
    let monthsToQuery: Date[] = []
    if (startDateParam && endDateParam) {
      const start = new Date(startDateParam)
      const end = new Date(endDateParam)
      // Normalize to start of month
      const current = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1))
      const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1))

      // DASHBOARD-006 · Hard-cap MAX_MONTHS=36 para evitar 192 queries paralelas Promise.all.
      const diffMonthsRaw = (last.getUTCFullYear() - current.getUTCFullYear()) * 12 + (last.getUTCMonth() - current.getUTCMonth()) + 1
      if (diffMonthsRaw > DASHBOARD_MAX_MONTHS) {
        return NextResponse.json(
          { error: `Rango de fechas inválido. Máximo permitido ${DASHBOARD_MAX_MONTHS} meses (3 años).` },
          { status: 400, headers: SECURITY_HEADERS }
        )
      }

      while (current <= last) {
        monthsToQuery.push(new Date(current))
        current.setUTCMonth(current.getUTCMonth() + 1)
      }
    } else {
      // Default: last 12 months
      monthsToQuery = Array.from({ length: 12 }, (_, i) => {
        const d = new Date()
        d.setUTCMonth(d.getUTCMonth() - i)
        return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
      }).reverse() // Chronological order
    }

    if (!includeHeavyMetrics && effectiveOrigin === 'issued') {
      return await getDashboardSummaryResponse({
        startDateParam,
        endDateParam,
        companyId,
        companyName: company.businessName,
        rfc,
        monthsToQuery,
        effectiveOrigin,
        issuerFiscalEntityId: fiscalEntity.id,
        organizationId: fiscalEntity.organizationId
      })
    }

    return await getDashboardHeavyMetricsResponse({
      baseWhere,
      monthsToQuery,
      effectiveOrigin,
      rfc,
      issuerFiscalEntityId,
      dateFilter,
      companyId,
      companyName: company.businessName,
      includeHeavyMetrics,
      ctx,
      originParam,
      canViewIssued,
      canViewReceived
    })

  } catch (err) {
    // DASH-SAST-010 · fp32 fingerprint correlación de incidentes de seguridad
    const fingerprint = fp32(JSON.stringify({
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? (err.stack || '').slice(0, 512) : '',
      ts: Date.now()
    }))
    const safeSummary = safeErrSummary(err)
    // SafeErrorSummary es discriminated union; todas las variantes NO-Nil tienen
    // msgHash; las productivas tienen msg (string|null). El último catch-all
    // (name: string) también provee msg (string|null). Accedemos por narrowing
    // seguro sin `any`, y usamos coalescencia sobre campos declarados.
    type SafeUnionWithMsg = Exclude<SafeErrorSummary, { name: 'NilError' }>;
    const safeMsg: string | null =
      (safeSummary.name !== 'NilError' ? (safeSummary as SafeUnionWithMsg).msg : null)
      ?? safeSummary.msgHash
      ?? 'Error interno';
    console.error(`[DashboardFiscal fingerprint=${fingerprint}] ${safeSummary.name}: ${safeMsg ?? '-'}`)
    const resp = dashboardJsonErrorResponse(err)
    // Aplica SECURITY_HEADERS a todas las respuestas de error (incluidas 429/403/400)
    Object.entries(SECURITY_HEADERS).forEach(([k, v]) => {
      if (!resp.headers.has(k)) resp.headers.set(k, v)
    })
    if (!resp.headers.has('X-Security-Incident-Fp')) {
      resp.headers.set('X-Security-Incident-Fp', fingerprint)
    }
    return resp
  }
}

