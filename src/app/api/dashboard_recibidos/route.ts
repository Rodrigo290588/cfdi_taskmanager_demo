import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { auth } from '@/lib/auth'
import {
  getObjetoImpTaxRuleSummary,
  getPaymentMethodVsPaymentFormRuleSummary,
  getResicoRetentionRuleSummary
} from '@/lib/provider-business-rules'
import { prisma } from '@/lib/prisma'
import { getPostLoadCancellationSummary } from '@/lib/provider-post-load-cancellation-alerts'
import { getPaymentBalancePeriodSummary } from '@/lib/provider-payment-balance-period-summary'
import { getTaxPeriodSummary } from '@/lib/provider-tax-period-summary'
import { getEfosRiskSummary } from '@/lib/sat-69b-blacklist'

function formatMonthlyLabel(date: Date) {
  return `${date.toLocaleString('es-MX', { month: 'short' })} ${date.getFullYear()}`
}

function mapProviderCfdiTypeLabel(cfdiType: string) {
  switch (cfdiType) {
    case 'I':
      return 'INGRESO'
    case 'E':
      return 'EGRESO'
    case 'T':
      return 'TRASLADO'
    case 'P':
      return 'PAGO'
    default:
      return cfdiType || 'SIN_TIPO'
  }
}

type ProviderReceivedCfdiDailySummaryRow = {
  summary_date: Date | string
  cfdi_type: string
  sat_estado: string
  issuer_rfc: string
  issuer_name: string
  payment_method: string
  payment_status_bucket: string
  cfdi_count: number
  total_amount: unknown
  transferred_taxes_total: unknown
  withheld_taxes_total: unknown
}

function toNumber(value: unknown) {
  const parsed = Number(String(value ?? '').replace(/,/g, '').trim())
  return Number.isFinite(parsed) ? parsed : 0
}

function parseDateFilter(value: string | null, bound: 'start' | 'end') {
  if (!value) return null

  const normalized = bound === 'start'
    ? new Date(`${value}T00:00:00.000Z`)
    : new Date(`${value}T23:59:59.999Z`)

  return Number.isNaN(normalized.getTime()) ? null : normalized
}

function canAccessReceptionFiscalAudit(access: {
  customRole?: {
    canViewReception: boolean
    granularPermissions: Prisma.JsonValue | null
  } | null
}) {
  if (!access.customRole) {
    return true
  }

  if (access.customRole.canViewReception === false) {
    return false
  }

  const granularPermissions = (access.customRole.granularPermissions || {}) as Record<string, boolean>
  return granularPermissions.receptionFiscalAudit !== false
}

function canAccessReceptionCancellationAlerts(access: {
  customRole?: {
    canViewReception: boolean
    granularPermissions: Prisma.JsonValue | null
  } | null
}) {
  if (!canAccessReceptionFiscalAudit(access)) {
    return false
  }

  if (!access.customRole) {
    return true
  }

  const granularPermissions = (access.customRole.granularPermissions || {}) as Record<string, boolean>
  return granularPermissions.receptionCancellationAlerts !== false
}

function canAccessReceptionBusinessRules(access: {
  customRole?: {
    canViewReception: boolean
    granularPermissions: Prisma.JsonValue | null
  } | null
}) {
  if (!access.customRole) {
    return true
  }

  if (access.customRole.canViewReception === false) {
    return false
  }

  const granularPermissions = (access.customRole.granularPermissions || {}) as Record<string, boolean>
  return granularPermissions.receptionBusinessRules !== false
}

function canAccessReceptionBusinessRulePueForma99(access: {
  customRole?: {
    canViewReception: boolean
    granularPermissions: Prisma.JsonValue | null
  } | null
}) {
  if (!canAccessReceptionBusinessRules(access)) {
    return false
  }

  if (!access.customRole) {
    return true
  }

  const granularPermissions = (access.customRole.granularPermissions || {}) as Record<string, boolean>
  return granularPermissions.receptionBusinessRulePueForma99 !== false
}

function canAccessReceptionBusinessRuleResicoRetention(access: {
  customRole?: {
    canViewReception: boolean
    granularPermissions: Prisma.JsonValue | null
  } | null
}) {
  if (!canAccessReceptionBusinessRules(access)) {
    return false
  }

  if (!access.customRole) {
    return true
  }

  const granularPermissions = (access.customRole.granularPermissions || {}) as Record<string, boolean>
  return granularPermissions.receptionBusinessRuleResicoRetention !== false
}

function canAccessReceptionBusinessRuleObjetoImpVsIva(access: {
  customRole?: {
    canViewReception: boolean
    granularPermissions: Prisma.JsonValue | null
  } | null
}) {
  if (!canAccessReceptionBusinessRules(access)) {
    return false
  }

  if (!access.customRole) {
    return true
  }

  const granularPermissions = (access.customRole.granularPermissions || {}) as Record<string, boolean>
  return granularPermissions.receptionBusinessRuleObjetoImpVsIva !== false
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const companyId = searchParams.get('companyId')
    const startDate = parseDateFilter(searchParams.get('startDate'), 'start')
    const endDate = parseDateFilter(searchParams.get('endDate'), 'end')
    if (!companyId) {
      return NextResponse.json({ error: 'companyId requerido' }, { status: 400 })
    }

    // const userId = session.user!.id

    const member = await prisma.member.findFirst({
      where: { userId: session.user.id, status: 'APPROVED' },
      include: { organization: true }
    })
    if (!member) {
      return NextResponse.json({ error: 'Membresía no encontrada' }, { status: 404 })
    }

    const access = await prisma.companyAccess.findUnique({
      where: { memberId_companyId: { memberId: member.id, companyId } },
      include: {
        customRole: {
          select: {
            canViewReception: true,
            granularPermissions: true
          }
        }
      }
    })
    if (!access) {
      return NextResponse.json({ error: 'Sin acceso a la empresa' }, { status: 403 })
    }

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { rfc: true, businessName: true }
    })
    if (!company?.rfc) {
      return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 })
    }

    if (searchParams.get('startDate') && !startDate) {
      return NextResponse.json({ error: 'startDate inválida' }, { status: 400 })
    }

    if (searchParams.get('endDate') && !endDate) {
      return NextResponse.json({ error: 'endDate inválida' }, { status: 400 })
    }

    if (startDate && endDate && startDate > endDate) {
      return NextResponse.json({ error: 'La fecha inicial no puede ser mayor a la fecha final' }, { status: 400 })
    }

    const rows = await prisma.$queryRaw<ProviderReceivedCfdiDailySummaryRow[]>(
      Prisma.sql`
        SELECT
          summary_date,
          cfdi_type,
          sat_estado,
          issuer_rfc,
          issuer_name,
          payment_method,
          payment_status_bucket,
          SUM(cfdi_count)::int AS cfdi_count,
          SUM(total_amount) AS total_amount,
          SUM(transferred_taxes_total) AS transferred_taxes_total,
          SUM(withheld_taxes_total) AS withheld_taxes_total
        FROM provider_received_cfdi_daily_summary
        WHERE organization_id = ${member.organizationId}
          AND receiver_company_id = ${companyId}
          ${startDate ? Prisma.sql`AND summary_date >= ${startDate}` : Prisma.empty}
          ${endDate ? Prisma.sql`AND summary_date <= ${endDate}` : Prisma.empty}
        GROUP BY
          summary_date,
          cfdi_type,
          sat_estado,
          issuer_rfc,
          issuer_name,
          payment_method,
          payment_status_bucket
        ORDER BY summary_date ASC
      `
    )

    const efosRiskSummary = canAccessReceptionFiscalAudit(access)
      ? await getEfosRiskSummary({
        organizationId: member.organizationId,
        companyId,
        startDate,
        endDate
      })
      : {
        riskAmount: 0,
        supplierCount: 0,
        cfdiCount: 0,
        lastBlacklistSyncAt: null
      }

    const postLoadCancellationSummary = canAccessReceptionCancellationAlerts(access)
      ? await getPostLoadCancellationSummary({
        organizationId: member.organizationId,
        companyId
      })
      : {
        cancellationCount: 0,
        cancellationAmount: 0,
        supplierCount: 0
      }

    const paymentMethodVsPaymentFormSummary = canAccessReceptionBusinessRulePueForma99(access)
      ? await getPaymentMethodVsPaymentFormRuleSummary({
        organizationId: member.organizationId,
        companyId,
        startDate,
        endDate
      })
      : {
        cfdiCount: 0,
        amount: 0,
        supplierCount: 0
      }

    const resicoRetentionSummary = canAccessReceptionBusinessRuleResicoRetention(access)
      ? await getResicoRetentionRuleSummary({
        organizationId: member.organizationId,
        companyId,
        startDate,
        endDate
      })
      : {
        cfdiCount: 0,
        amount: 0,
        supplierCount: 0
      }

    const objetoImpTaxSummary = canAccessReceptionBusinessRuleObjetoImpVsIva(access)
      ? await getObjetoImpTaxRuleSummary({
        organizationId: member.organizationId,
        companyId,
        startDate,
        endDate
      })
      : {
        cfdiCount: 0,
        amount: 0,
        supplierCount: 0
      }

    const issuanceDateFilter = startDate || endDate
      ? {
        issuanceDate: {
          ...(startDate ? { gte: startDate } : {}),
          ...(endDate ? { lte: endDate } : {})
        }
      }
      : {}

    const [grossCommercialExpenseResult, creditNotesSubtotalResult] = await Promise.all([
      prisma.providerUploadedCfdi.aggregate({
        _sum: {
          subtotal: true
        },
        where: {
          organizationId: member.organizationId,
          receiverCompanyId: companyId,
          validationStatus: 'APPROVED',
          cfdiType: 'I',
          OR: [
            { satEstado: null },
            { satEstado: { not: 'CANCELADO' } }
          ],
          ...issuanceDateFilter
        }
      }),
      prisma.providerUploadedCfdi.aggregate({
        _sum: {
          subtotal: true
        },
        where: {
          organizationId: member.organizationId,
          receiverCompanyId: companyId,
          validationStatus: 'APPROVED',
          cfdiType: 'E',
          OR: [
            { satEstado: null },
            { satEstado: { not: 'CANCELADO' } }
          ],
          ...issuanceDateFilter
        }
      })
    ])
    const grossCommercialExpense = Number(grossCommercialExpenseResult._sum.subtotal || 0)
    const creditNotesSubtotal = Number(creditNotesSubtotalResult._sum.subtotal || 0)
    const netExpensesTotal = grossCommercialExpense - creditNotesSubtotal
    const taxPeriodSummary = await getTaxPeriodSummary({
      organizationId: member.organizationId,
      companyId,
      startDate,
      endDate
    })
    const paymentBalancePeriodSummary = await getPaymentBalancePeriodSummary({
      organizationId: member.organizationId,
      companyId,
      startDate,
      endDate
    })

    if (rows.length === 0) {
      return NextResponse.json({
        company: { id: companyId, rfc: company.rfc, name: company.businessName },
        kpis: {
          totalCfdis: 0,
          totalMonto: 0,
          tasaCancelacion: 0,
          totalGastos: grossCommercialExpense,
          totalNotasCredito: 0,
          totalEgresos: 0,
          pagado: 0,
          pendiente: 0,
          cancelaciones: 0,
          taxes: {
            ivaTrasladado: 0,
            ivaRetenido: 0,
            isrRetenido: 0,
            iepsRetenido: 0
          }
        },
        expensePeriodSummary: {
          grossCommercialExpense,
          creditNotesSubtotal,
          netExpensesTotal
        },
        taxPeriodSummary: {
          ...taxPeriodSummary
        },
        paymentBalancePeriodSummary: {
          ...paymentBalancePeriodSummary
        },
        fiscalAudit: {
          efosRiskAmount: efosRiskSummary.riskAmount,
          efosSupplierCount: efosRiskSummary.supplierCount,
          efosCfdiCount: efosRiskSummary.cfdiCount,
          last69BSyncAt: efosRiskSummary.lastBlacklistSyncAt,
          postLoadCancellationCount: postLoadCancellationSummary.cancellationCount,
          postLoadCancellationAmount: postLoadCancellationSummary.cancellationAmount,
          postLoadCancellationSupplierCount: postLoadCancellationSummary.supplierCount
        },
        businessRules: {
          paymentMethodPueForma99Count: paymentMethodVsPaymentFormSummary.cfdiCount,
          paymentMethodPueForma99Amount: paymentMethodVsPaymentFormSummary.amount,
          paymentMethodPueForma99SupplierCount: paymentMethodVsPaymentFormSummary.supplierCount,
          resicoRetentionCount: resicoRetentionSummary.cfdiCount,
          resicoRetentionAmount: resicoRetentionSummary.amount,
          resicoRetentionSupplierCount: resicoRetentionSummary.supplierCount,
          objetoImpVsIvaCount: objetoImpTaxSummary.cfdiCount,
          objetoImpVsIvaAmount: objetoImpTaxSummary.amount,
          objetoImpVsIvaSupplierCount: objetoImpTaxSummary.supplierCount
        },
        byType: [],
        bySatStatus: [],
        monthly: [],
        topSuppliers: [],
        topClients: [],
        paymentMethods: []
      })
    }

    const now = new Date()
    const monthKeys = Array.from({ length: 12 }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - (11 - index), 1)
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`

      return {
        key,
        label: formatMonthlyLabel(date),
        count: 0,
        total: 0
      }
    })

    const monthlyMap = new Map(monthKeys.map(entry => [entry.key, entry]))
    const byTypeMap = new Map<string, { type: string; count: number; total: number }>()
    const bySatStatusMap = new Map<string, { status: string; count: number }>()
    const topSuppliersMap = new Map<string, { rfc: string | null; name: string | null; total: number }>()
    const paymentMethodsMap = new Map<string, { method: string | null; count: number; total: number }>()

    let totalMonto = 0
    let totalGastos = 0
    let totalNotasCredito = 0
    let pagado = 0
    let pendiente = 0
    let cancelaciones = 0
    let ivaTrasladado = 0
    let impuestosRetenidos = 0

    for (const row of rows) {
      const count = Number(row.cfdi_count || 0)
      const total = toNumber(row.total_amount)
      const cfdiTypeLabel = mapProviderCfdiTypeLabel(row.cfdi_type)
      const satStatus = row.sat_estado || 'SIN_ESTATUS'
      const supplierKey = row.issuer_rfc || row.issuer_name || `${row.summary_date}-${row.cfdi_type}`
      const paymentMethodKey = row.payment_method || 'SIN_METODO'

      totalMonto += total

      const currentByType = byTypeMap.get(cfdiTypeLabel) || { type: cfdiTypeLabel, count: 0, total: 0 }
      currentByType.count += count
      currentByType.total += total
      byTypeMap.set(cfdiTypeLabel, currentByType)

      const currentBySatStatus = bySatStatusMap.get(satStatus) || { status: satStatus, count: 0 }
      currentBySatStatus.count += count
      bySatStatusMap.set(satStatus, currentBySatStatus)

      const currentSupplier = topSuppliersMap.get(supplierKey) || {
        rfc: row.issuer_rfc,
        name: row.issuer_name || row.issuer_rfc,
        total: 0
      }
      currentSupplier.total += total
      topSuppliersMap.set(supplierKey, currentSupplier)

      const currentPaymentMethod = paymentMethodsMap.get(paymentMethodKey) || {
        method: row.payment_method,
        count: 0,
        total: 0
      }
      currentPaymentMethod.count += count
      currentPaymentMethod.total += total
      paymentMethodsMap.set(paymentMethodKey, currentPaymentMethod)

      if (row.summary_date) {
        const summaryDate = row.summary_date instanceof Date ? row.summary_date : new Date(row.summary_date)
        const monthKey = `${summaryDate.getUTCFullYear()}-${String(summaryDate.getUTCMonth() + 1).padStart(2, '0')}`
        const currentMonth = monthlyMap.get(monthKey)

        if (currentMonth) {
          currentMonth.count += count
          currentMonth.total += total
        }
      }

      if (row.cfdi_type === 'I') {
        totalGastos += total

        if (row.payment_status_bucket === 'PAGADO') {
          pagado += total
        } else {
          pendiente += total
        }
      }

      if (row.cfdi_type === 'E') {
        totalNotasCredito += total
      }

      if (satStatus === 'CANCELADO') {
        cancelaciones += total
      }

      if (row.cfdi_type !== 'P') {
        ivaTrasladado += toNumber(row.transferred_taxes_total)
        impuestosRetenidos += toNumber(row.withheld_taxes_total)
      }
    }

    const totalCfdis = Array.from(byTypeMap.values()).reduce((acc, entry) => acc + entry.count, 0)
    const totalEgresos = totalGastos - totalNotasCredito
    const totalCancelados = bySatStatusMap.get('CANCELADO')?.count || 0

    return NextResponse.json({
      company: { id: companyId, rfc: company.rfc, name: company.businessName },
      kpis: {
        totalCfdis,
        totalMonto,
        tasaCancelacion: totalCfdis ? Math.round((totalCancelados / totalCfdis) * 100) : 0,
        totalGastos: grossCommercialExpense,
        totalNotasCredito,
        totalEgresos,
        pagado,
        pendiente,
        cancelaciones,
        taxes: {
          ivaTrasladado,
          // En provider_uploaded_cfdis hoy solo se persiste el total retenido agregado.
          ivaRetenido: impuestosRetenidos,
          isrRetenido: 0,
          iepsRetenido: 0
        }
      },
      expensePeriodSummary: {
        grossCommercialExpense,
        creditNotesSubtotal,
        netExpensesTotal
      },
      taxPeriodSummary: {
        ...taxPeriodSummary
      },
      paymentBalancePeriodSummary: {
        ...paymentBalancePeriodSummary
      },
      fiscalAudit: {
        efosRiskAmount: efosRiskSummary.riskAmount,
        efosSupplierCount: efosRiskSummary.supplierCount,
        efosCfdiCount: efosRiskSummary.cfdiCount,
        last69BSyncAt: efosRiskSummary.lastBlacklistSyncAt,
        postLoadCancellationCount: postLoadCancellationSummary.cancellationCount,
        postLoadCancellationAmount: postLoadCancellationSummary.cancellationAmount,
        postLoadCancellationSupplierCount: postLoadCancellationSummary.supplierCount
      },
      businessRules: {
        paymentMethodPueForma99Count: paymentMethodVsPaymentFormSummary.cfdiCount,
        paymentMethodPueForma99Amount: paymentMethodVsPaymentFormSummary.amount,
        paymentMethodPueForma99SupplierCount: paymentMethodVsPaymentFormSummary.supplierCount,
        resicoRetentionCount: resicoRetentionSummary.cfdiCount,
        resicoRetentionAmount: resicoRetentionSummary.amount,
        resicoRetentionSupplierCount: resicoRetentionSummary.supplierCount,
        objetoImpVsIvaCount: objetoImpTaxSummary.cfdiCount,
        objetoImpVsIvaAmount: objetoImpTaxSummary.amount,
        objetoImpVsIvaSupplierCount: objetoImpTaxSummary.supplierCount
      },
      byType: Array.from(byTypeMap.values()).sort((left, right) => right.total - left.total),
      bySatStatus: Array.from(bySatStatusMap.values()).sort((left, right) => right.count - left.count),
      monthly: monthKeys,
      topSuppliers: Array.from(topSuppliersMap.values())
        .sort((left, right) => right.total - left.total)
        .slice(0, 10),
      topClients: [],
      paymentMethods: Array.from(paymentMethodsMap.values()).sort((left, right) => right.count - left.count),
    })
  } catch (error) {
    console.error('Dashboard recibidos API error:', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
