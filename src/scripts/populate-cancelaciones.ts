
import { PrismaClient, SatStatus, StatusCancelacion, Prisma } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Starting population of Cfdi table from Invoices...')

  try {
    // 0. Clean existing data to ensure clean state and no zero-amount records from previous bad seeds
    console.log('Cleaning existing Cfdi records...')
    await prisma.cfdi.deleteMany({})
    console.log('Cfdi table cleaned.')

    // 1. Fetch Invoices from source table
    // We take a reasonable amount to populate the report
    const invoices = await prisma.invoice.findMany({
      take: 100,
      orderBy: { issuanceDate: 'desc' }
    })

    console.log(`Found ${invoices.length} invoices in database.`)

    if (invoices.length === 0) {
      console.log('No invoices found in database to populate from.')
      return
    }

    let processedCount = 0
    
    // We want to simulate ~35 records in "En Proceso de Cancelación" state
    // as per user request if no cancelled CFDIs exist.
    // We'll just force the first 35 to be in various cancellation states.
    const targetCancellationCount = 35

    for (let i = 0; i < invoices.length; i++) {
      const inv = invoices[i]
      
      // Determine simulated status
      const isTargetForCancellation = i < targetCancellationCount
      
      let statusSat = inv.satStatus
      let statusCancelacion: StatusCancelacion | null = null
      let fechaCancelacion: Date | null = null
      let statusErp = 'Vigente'
      let motivoCancelacion: string | null = null

      // Calculate Impuestos: Sum of transferred and withheld taxes
      // Note: In Prisma Decimal operations, we use .plus()
      // We need to handle potential nulls if schema allowed them, but here they are required with defaults
      let impuestos = inv.ivaTransferred
        .plus(inv.ivaWithheld)
        .plus(inv.isrWithheld)
        .plus(inv.iepsWithheld)
      
      let montoTotal = inv.total

      // If amounts are zero (e.g. from invalid invoice data), simulate realistic amounts
      if (montoTotal.toNumber() === 0) {
        montoTotal = new Prisma.Decimal(Math.floor(Math.random() * 49000) + 1000)
        impuestos = montoTotal.mul(0.16) // Assume 16% VAT
      }

      if (isTargetForCancellation) {
        // Simulate cancellation process
        // Mix of different states to show variety in dashboard
        const variant = i % 5

        if (variant === 0) {
          // Solicitud enviada, esperando aceptación
          statusSat = SatStatus.VIGENTE
          statusCancelacion = StatusCancelacion.EN_PROCESO
          statusErp = 'Solicitud Cancelacion'
          motivoCancelacion = '02' // Comprobante emitido con errores sin relación
        } else if (variant === 1) {
          // Requiere aceptación
          statusSat = SatStatus.VIGENTE
          statusCancelacion = StatusCancelacion.SIN_ACEPTACION // O "En proceso" dependiendo de cómo se interprete
          statusErp = 'En Proceso'
          motivoCancelacion = '01' // Comprobante emitido con errores con relación
        } else if (variant === 2) {
          // Cancelado pero reciente
          statusSat = SatStatus.CANCELADO
          statusCancelacion = StatusCancelacion.PLAZO_VENCIDO // Cancelado por plazo vencido
          fechaCancelacion = new Date() // Today
          statusErp = 'Cancelado'
          motivoCancelacion = '03' // No se llevó a cabo la operación
        } else if (variant === 3) {
           // Rechazado
           statusSat = SatStatus.VIGENTE
           statusCancelacion = StatusCancelacion.RECHAZADO
           statusErp = 'Rechazado'
           motivoCancelacion = '02'
        } else {
           // Con Aceptación (En proceso)
           statusSat = SatStatus.VIGENTE
           statusCancelacion = StatusCancelacion.CON_ACEPTACION
           statusErp = 'En Proceso'
           motivoCancelacion = '01'
        }
      } else {
        // Keep original status for the rest
        if (statusSat === SatStatus.CANCELADO) {
           fechaCancelacion = inv.updatedAt // Best guess
           statusErp = 'Cancelado'
        }
      }

      // Upsert into Cfdi table
      await prisma.cfdi.upsert({
        where: { uuid: inv.uuid },
        update: {
          statusSat,
          statusCancelacion,
          motivoCancelacion,
          fechaEmision: inv.issuanceDate,
          fechaCancelacion,
          montoTotal,
          impuestos,
          rfcEmisor: inv.issuerRfc,
          rfcReceptor: inv.receiverRfc,
          nombreReceptor: inv.receiverName,
          statusErp
        },
        create: {
          uuid: inv.uuid,
          statusSat,
          statusCancelacion,
          motivoCancelacion,
          fechaEmision: inv.issuanceDate,
          fechaCancelacion,
          montoTotal,
          impuestos,
          rfcEmisor: inv.issuerRfc,
          rfcReceptor: inv.receiverRfc,
          nombreReceptor: inv.receiverName,
          statusErp
        }
      })
      
      processedCount++
    }

    console.log(`Successfully populated/updated ${processedCount} records in Cfdi table.`)
    console.log(`- ${Math.min(targetCancellationCount, invoices.length)} records marked as 'In Process' or similar for demo purposes.`)

  } catch (error) {
    console.error('Error in population script:', error)
    throw error
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
