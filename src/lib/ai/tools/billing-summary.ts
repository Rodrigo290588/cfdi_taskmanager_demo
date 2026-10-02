import { tool } from 'ai'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

const billingSummaryParameters = z.object({
  rfc: z.string().describe('El RFC de la empresa para la cual obtener el resumen'),
  startDate: z.string().optional().describe('Fecha de inicio en formato YYYY-MM-DD'),
  endDate: z.string().optional().describe('Fecha de fin en formato YYYY-MM-DD')
})

export const createBillingSummaryTool = (allowedCompanyIds: string[] | null) => {
  return tool({
    description: 'Obtiene un resumen de facturación e impuestos (ingresos y egresos) para una empresa según su RFC en un periodo específico.',
    inputSchema: billingSummaryParameters,
    execute: async ({ rfc, startDate, endDate }) => {
      // 1. Obtener las compañías que coincidan con el RFC
      const companies = await prisma.company.findMany({
        where: { rfc },
        select: { id: true, rfc: true, name: true }
      })

      if (companies.length === 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return { error: `Empresa con RFC ${rfc} no encontrada.` } as any
      }

      // 2. Validar acceso filtrando las compañías permitidas (si es SUPER_ADMIN allowedCompanyIds es null y ve todo)
      const accessibleCompanies = allowedCompanyIds === null 
        ? companies 
        : companies.filter(c => allowedCompanyIds.includes(c.id))

      if (accessibleCompanies.length === 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return { error: `No fue posible obtener el reporte de ingresos para el RFC **${rfc}** correspondiente a ${startDate || 'el periodo solicitado'} debido a un problema de permisos: **Acceso denegado**. Por favor, verifica que cuentes con los permisos necesarios para consultar la información fiscal de esta empresa o confirma si el RFC ingresado es el correcto.` } as any
      }

      // Usar la primera compañía a la que se tiene acceso
      const company = accessibleCompanies[0]
      const companyId = company.id

      const dateFilter: { summaryDate?: { gte?: Date; lte?: Date } } = {}
    if (startDate && endDate) {
      dateFilter.summaryDate = {
        gte: new Date(startDate),
        lte: new Date(endDate)
      }
    } else if (startDate) {
      dateFilter.summaryDate = { gte: new Date(startDate) }
    } else if (endDate) {
      dateFilter.summaryDate = { lte: new Date(endDate) }
    }

    // 2. Obtener egresos (facturas recibidas) desde ProviderReceivedCfdiDailySummary
    const expensesAgg = await prisma.providerReceivedCfdiDailySummary.aggregate({
      where: {
        receiverCompanyId: companyId,
        ...dateFilter
      },
      _sum: {
        totalAmount: true,
        transferredTaxesTotal: true,
        withheldTaxesTotal: true,
        cfdiCount: true
      }
    })

    // 3. Obtener ingresos (facturas emitidas)
    // Buscamos la entidad fiscal que coincida con el RFC de la compañía
    const fiscalEntities = await prisma.fiscalEntity.findMany({
      where: { rfc: company.rfc },
      select: { id: true }
    })

    const fiscalEntityIds = fiscalEntities.map(fe => fe.id)
    
    let incomesAgg: {
      _sum: {
        totalAmount: Prisma.Decimal | null,
        ivaTransferredTotal: Prisma.Decimal | null,
        ivaWithheldTotal: Prisma.Decimal | null,
        isrWithheldTotal: Prisma.Decimal | null,
        cfdiCount: number | null
      }
    } = {
      _sum: {
        totalAmount: null,
        ivaTransferredTotal: null,
        ivaWithheldTotal: null,
        isrWithheldTotal: null,
        cfdiCount: null
      }
    }

    if (fiscalEntityIds.length > 0) {
      incomesAgg = await prisma.invoiceIssuedDailySummary.aggregate({
        where: {
          issuerFiscalEntityId: { in: fiscalEntityIds },
          ...dateFilter
        },
        _sum: {
          totalAmount: true,
          ivaTransferredTotal: true,
          ivaWithheldTotal: true,
          isrWithheldTotal: true,
          cfdiCount: true
        }
      })
    }

    return {
      company: {
        id: company.id,
        name: company.name,
        rfc: company.rfc
      },
      period: {
        startDate: startDate || 'Todos los tiempos',
        endDate: endDate || 'Todos los tiempos'
      },
      incomes: {
        total: Number(incomesAgg._sum.totalAmount || 0),
        taxesTransferred: Number(incomesAgg._sum.ivaTransferredTotal || 0),
        taxesWithheld: Number(incomesAgg._sum.ivaWithheldTotal || 0) + Number(incomesAgg._sum.isrWithheldTotal || 0),
        cfdiCount: Number(incomesAgg._sum.cfdiCount || 0)
      },
      expenses: {
        total: Number(expensesAgg._sum.totalAmount || 0),
        taxesTransferred: Number(expensesAgg._sum.transferredTaxesTotal || 0),
        taxesWithheld: Number(expensesAgg._sum.withheldTaxesTotal || 0),
        cfdiCount: Number(expensesAgg._sum.cfdiCount || 0)
      }
    }
  }
  })
}
