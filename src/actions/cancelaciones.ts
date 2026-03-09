'use server'

import { prisma } from '@/lib/prisma'
import { SatStatus, StatusCancelacion, Prisma } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { randomUUID } from 'crypto'

// Helper function to build the where clause for reuse
function buildWhereClause(
  search?: string,
  fechaEmisionInicio?: string | null,
  fechaEmisionFin?: string | null,
  fechaCancelacionInicio?: string | null,
  fechaCancelacionFin?: string | null,
  uuid?: string,
  montoTotal?: number,
  impuestos?: number,
  statusSat?: SatStatus,
  statusCancelacion?: StatusCancelacion,
  companyRfc?: string,
  rfcReceptorFilter?: string,
  nombreReceptorFilter?: string,
  classification: string = 'issued'
): Prisma.CfdiWhereInput {
  const where: Prisma.CfdiWhereInput = {}
  
  const andConditions: Prisma.CfdiWhereInput[] = []

  // Classification Logic (Company Context)
  if (companyRfc) {
    if (classification === 'issued') {
      andConditions.push({ rfcEmisor: companyRfc })
    } else if (classification === 'received') {
      andConditions.push({ rfcReceptor: companyRfc })
    } else if (classification === 'both') {
      andConditions.push({
        OR: [
          { rfcEmisor: companyRfc },
          { rfcReceptor: companyRfc }
        ]
      })
    }
  }

  // Global Search
  if (search) {
    andConditions.push({
      OR: [
        { uuid: { contains: search, mode: 'insensitive' } },
        { rfcReceptor: { contains: search, mode: 'insensitive' } },
        { nombreReceptor: { contains: search, mode: 'insensitive' } },
        { rfcEmisor: { contains: search, mode: 'insensitive' } },
      ]
    })
  }

  // Column specific filters
  if (uuid) {
    andConditions.push({ uuid: { contains: uuid, mode: 'insensitive' } })
  }

  if (rfcReceptorFilter) {
    andConditions.push({ rfcReceptor: { contains: rfcReceptorFilter, mode: 'insensitive' } })
  }

  if (nombreReceptorFilter) {
    andConditions.push({ nombreReceptor: { contains: nombreReceptorFilter, mode: 'insensitive' } })
  }

  if (montoTotal !== undefined) {
    andConditions.push({ montoTotal: { equals: montoTotal } })
  }

  if (impuestos !== undefined) {
    andConditions.push({ impuestos: { equals: impuestos } })
  }

  if (statusSat) {
    andConditions.push({ statusSat })
  }

  if (statusCancelacion) {
    andConditions.push({ statusCancelacion })
  }

  if (fechaEmisionInicio || fechaEmisionFin) {
    const dateFilter: Prisma.DateTimeFilter = {}
    if (fechaEmisionInicio) dateFilter.gte = new Date(fechaEmisionInicio)
    if (fechaEmisionFin) {
        const endDate = new Date(fechaEmisionFin)
        endDate.setHours(23, 59, 59, 999)
        dateFilter.lte = endDate
    }
    andConditions.push({ fechaEmision: dateFilter })
  }

  if (fechaCancelacionInicio || fechaCancelacionFin) {
    const dateFilter: Prisma.DateTimeNullableFilter = {}
    if (fechaCancelacionInicio) dateFilter.gte = new Date(fechaCancelacionInicio)
    if (fechaCancelacionFin) {
        const endDate = new Date(fechaCancelacionFin)
        endDate.setHours(23, 59, 59, 999)
        dateFilter.lte = endDate
    }
    andConditions.push({ fechaCancelacion: dateFilter })
  }

  if (andConditions.length > 0) {
    where.AND = andConditions
  }

  return where
}

export async function getCfdisCancelados(
  page: number = 1,
  limit: number = 10,
  search?: string,
  fechaEmisionInicio?: string | null,
  fechaEmisionFin?: string | null,
  fechaCancelacionInicio?: string | null,
  fechaCancelacionFin?: string | null,
  uuid?: string,
  montoTotal?: number,
  impuestos?: number,
  statusSat?: SatStatus,
  statusCancelacion?: StatusCancelacion,
  companyRfc?: string,
  rfcReceptorFilter?: string,
  nombreReceptorFilter?: string,
  classification: string = 'issued'
) {
  const skip = (page - 1) * limit
  const where = buildWhereClause(
    search,
    fechaEmisionInicio,
    fechaEmisionFin,
    fechaCancelacionInicio,
    fechaCancelacionFin,
    uuid,
    montoTotal,
    impuestos,
    statusSat,
    statusCancelacion,
    companyRfc,
    rfcReceptorFilter,
    nombreReceptorFilter,
    classification
  )
  
  try {
    const [cfdis, total] = await Promise.all([
      prisma.cfdi.findMany({
        where,
        skip,
        take: limit,
        orderBy: { fechaEmision: 'desc' }
      }),
      prisma.cfdi.count({ where })
    ])

    return {
      cfdis: cfdis.map(c => ({
        ...c,
        montoTotal: c.montoTotal.toNumber(),
        impuestos: c.impuestos.toNumber()
      })),
      totalPages: Math.ceil(total / limit),
      total
    }
  } catch (error) {
    console.error('Error fetching CFDIs:', error)
    return { cfdis: [], totalPages: 0, total: 0 }
  }
}

export async function getCfdisSummary(
  search?: string,
  fechaEmisionInicio?: string | null,
  fechaEmisionFin?: string | null,
  fechaCancelacionInicio?: string | null,
  fechaCancelacionFin?: string | null,
  companyRfc?: string,
  classification: string = 'issued'
) {
  // Summary should respect filters, but maybe not ALL column filters (like uuid specific).
  // Usually KPIs reflect the "dashboard context" (Date range + Company).
  // The user said: "deben de actualizarse de acuerdo a las fechas seleccionadas en los filtros de busqueda"
  // AND "de acuerdo al RFC y compañia seleccionado".
  // It implies the global filters (dates, company) apply.
  // Column filters (like filtering for a specific UUID) might be debatable, but let's apply them if passed to be consistent.
  // However, usually Summary is "Overview of the dataset", so maybe just Dates + Company.
  // I'll stick to Dates + Company + Search (if global search).
  
  const where = buildWhereClause(
    search,
    fechaEmisionInicio,
    fechaEmisionFin,
    fechaCancelacionInicio,
    fechaCancelacionFin,
    undefined, // uuid
    undefined, // montoTotal
    undefined, // impuestos
    undefined, // statusSat
    undefined, // statusCancelacion
    companyRfc,
    undefined,
    undefined,
    classification
  )

  try {
    // 1. Basic Aggregation for Totals
    const summary = await prisma.cfdi.groupBy({
      by: ['statusSat', 'statusCancelacion'],
      where,
      _sum: {
        montoTotal: true
      },
      _count: true
    })

    let totalVigente = 0
    let totalCancelado = 0
    let totalEnProceso = 0
    let countEmitidos = 0
    let countCancelados = 0

    summary.forEach(item => {
      const monto = item._sum.montoTotal?.toNumber() || 0
      const count = item._count
      
      countEmitidos += count

      if (item.statusSat === SatStatus.VIGENTE) {
        if (item.statusCancelacion === StatusCancelacion.EN_PROCESO) {
          totalEnProceso += monto
        } else {
          totalVigente += monto
        }
      } else {
        totalCancelado += monto
        countCancelados += count
      }
    })

    // 2. Efecto Fiscal Neto: Ingresos vigentes (Active) - Cancelaciones (Cancelled)
    // Assuming 'Vigente' means Active revenue.
    const efectoFiscalNeto = totalVigente - totalCancelado

    // 3. Tasa de Error en Facturación: (Cancelados / Total Emitidos)
    const tasaErrorFacturacion = countEmitidos > 0 ? (countCancelados / countEmitidos) * 100 : 0

    // 4. Aging de Cancelación: Días transcurridos entre la fecha de emisión y la fecha de cancelación efectiva.
    // We need to fetch the dates for cancelled items to calculate this.
    // Since we can't aggregate date diffs directly easily in Prisma without raw query, we'll fetch fields.
    // Optimization: limit fields.
    const cancelledItems = await prisma.cfdi.findMany({
        where: {
            ...where,
            statusSat: SatStatus.CANCELADO,
            fechaCancelacion: { not: null }
        },
        select: {
            fechaEmision: true,
            fechaCancelacion: true
        }
    })

    let totalDays = 0
    let countForAging = 0
    
    cancelledItems.forEach(item => {
        if (item.fechaCancelacion && item.fechaEmision) {
            const diffTime = Math.abs(item.fechaCancelacion.getTime() - item.fechaEmision.getTime())
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
            totalDays += diffDays
            countForAging++
        }
    })

    const agingCancelacion = countForAging > 0 ? totalDays / countForAging : 0

    // 5. Monto en Riesgo: 'Vigente' en ERP pero 'Cancelados' en SAT.
    // Using the new statusErp field.
    const montoEnRiesgoResult = await prisma.cfdi.aggregate({
        where: {
            ...where,
            statusSat: SatStatus.CANCELADO,
            statusErp: 'Vigente' // Using the string literal default I added
        },
        _sum: {
            montoTotal: true
        }
    })
    
    const montoEnRiesgo = montoEnRiesgoResult._sum.montoTotal?.toNumber() || 0

    return {
      totalVigente,
      totalCancelado,
      totalEnProceso,
      efectoFiscalNeto,
      tasaErrorFacturacion,
      agingCancelacion,
      montoEnRiesgo
    }
  } catch (error) {
    console.error('Error fetching summary:', error)
    return { 
        totalVigente: 0, 
        totalCancelado: 0, 
        totalEnProceso: 0,
        efectoFiscalNeto: 0,
        tasaErrorFacturacion: 0,
        agingCancelacion: 0,
        montoEnRiesgo: 0
    }
  }
}

export async function updateCfdiStatus(uuid: string, statusCancelacion: StatusCancelacion) {
  try {
    await prisma.cfdi.update({
      where: { uuid },
      data: { statusCancelacion }
    })
    revalidatePath('/dashboard_fiscal/cancelaciones')
    return { success: true }
  } catch (error) {
    console.error('Error updating CFDI status:', error)
    return { success: false, error: 'Failed to update status' }
  }
}

export async function seedDummyCfdis() {
  const count = await prisma.cfdi.count()
  if (count > 0) return { success: true, message: 'Data already exists' }

  const dummies = Array.from({ length: 50 }).map((_, i) => {
    const isCancelled = i % 3 === 0
    const fechaEmision = new Date()
    fechaEmision.setDate(fechaEmision.getDate() - Math.floor(Math.random() * 30))
    
    let fechaCancelacion = null
    if (isCancelled) {
        fechaCancelacion = new Date(fechaEmision)
        fechaCancelacion.setDate(fechaCancelacion.getDate() + Math.floor(Math.random() * 5) + 1)
    }

    // Simulate Monto en Riesgo: Cancelled in SAT but Vigente in ERP
    // Say 1 in 10 cancelled invoices is "Monto en Riesgo"
    const statusSat = isCancelled ? SatStatus.CANCELADO : SatStatus.VIGENTE
    const statusErp = isCancelled && Math.random() > 0.8 ? 'Vigente' : (isCancelled ? 'Cancelado' : 'Vigente')

    return {
        uuid: randomUUID(),
        statusSat,
        statusCancelacion: isCancelled ? StatusCancelacion.CON_ACEPTACION : StatusCancelacion.EN_PROCESO,
        fechaEmision,
        fechaCancelacion,
        montoTotal: (Math.random() * 10000).toFixed(2),
        impuestos: (Math.random() * 1600).toFixed(2),
        motivoCancelacion: '02',
        rfcEmisor: 'ABC123456T1' + (i % 2), // Randomize between 2 RFCs
        rfcReceptor: 'XYZ987654R' + (i % 3),
        statusErp
    }
  })

  try {
    // We use createMany if possible, but schema changes might make types tricky before gen.
    // Loop is safer.
    for (const d of dummies) {
      await prisma.cfdi.create({
        data: d
      })
    }
    
    revalidatePath('/dashboard_fiscal/cancelaciones')
    return { success: true, message: 'Dummy data created' }
  } catch (error) {
    console.error('Error seeding data:', error)
    return { success: false, message: error instanceof Error ? error.message : 'Unknown error seeding data' }
  }
}

export async function exportCfdisCancelados(
  search?: string,
  fechaEmisionInicio?: string | null,
  fechaEmisionFin?: string | null,
  fechaCancelacionInicio?: string | null,
  fechaCancelacionFin?: string | null,
  uuid?: string,
  montoTotal?: number,
  impuestos?: number,
  statusSat?: SatStatus,
  statusCancelacion?: StatusCancelacion,
  companyRfc?: string,
  rfcReceptorFilter?: string,
  nombreReceptorFilter?: string,
  classification: string = 'issued'
) {
  const where = buildWhereClause(
    search,
    fechaEmisionInicio,
    fechaEmisionFin,
    fechaCancelacionInicio,
    fechaCancelacionFin,
    uuid,
    montoTotal,
    impuestos,
    statusSat,
    statusCancelacion,
    companyRfc,
    rfcReceptorFilter,
    nombreReceptorFilter,
    classification
  )

  try {
    const cfdis = await prisma.cfdi.findMany({
      where,
      orderBy: { fechaEmision: 'desc' }
    })

    return cfdis.map(c => ({
      ...c,
      montoTotal: c.montoTotal.toNumber(),
      impuestos: c.impuestos.toNumber()
    }))
  } catch (error) {
    console.error('Error exporting CFDIs:', error)
    return []
  }
}
