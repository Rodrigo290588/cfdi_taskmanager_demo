import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { CfdiType, InvoiceStatus, SatStatus } from '@prisma/client'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const companyId = searchParams.get('companyId')

  if (!companyId) {
    return NextResponse.json({ error: 'Company ID required' }, { status: 400 })
  }

  try {
    const invoices = await prisma.satInvoice.findMany({
      where: {
        fiscalEntityId: companyId,
        cfdiType: CfdiType.NOMINA,
        status: InvoiceStatus.ACTIVE,
        satStatus: SatStatus.VIGENTE
      },
      select: {
        id: true,
        xmlContent: true,
        total: true,
        receiverName: true
      }
    })

    let totalDeducciones = 0
    let totalOtrosPagos = 0
    let totalPercepciones = 0
    let totalNomina = 0
    let totalDiasPagados = 0
    const empleadosSet = new Set<string>()
    
    const byDepartment: Record<string, {
      percepciones: number
      deducciones: number
      otrosPagos: number
      nomina: number
      count: number
    }> = {}

    for (const inv of invoices) {
      const xml = inv.xmlContent || ''
      
      // Basic Regex Extraction for Performance (XML parsing can be heavy for many files)
      // Percepciones
      const matchPercepciones = xml.match(/TotalPercepciones="([\d.]+)"/)
      const percepciones = matchPercepciones ? parseFloat(matchPercepciones[1]) : 0
      
      // Deducciones
      const matchDeducciones = xml.match(/TotalDeducciones="([\d.]+)"/)
      const deducciones = matchDeducciones ? parseFloat(matchDeducciones[1]) : 0
      
      // OtrosPagos
      const matchOtrosPagos = xml.match(/TotalOtrosPagos="([\d.]+)"/)
      const otrosPagos = matchOtrosPagos ? parseFloat(matchOtrosPagos[1]) : 0
      
      // DiasPagados
      const matchDias = xml.match(/NumDiasPagados="([\d.]+)"/)
      const dias = matchDias ? parseFloat(matchDias[1]) : 0

      // Departamento
      const matchDepto = xml.match(/Departamento="([^"]+)"/)
      const departamento = matchDepto ? matchDepto[1] : 'Sin Departamento'

      // Aggregates
      totalPercepciones += percepciones
      totalDeducciones += deducciones
      totalOtrosPagos += otrosPagos
      totalNomina += Number(inv.total) // Net from DB is reliable
      totalDiasPagados += dias
      empleadosSet.add(inv.receiverName)

      // Grouping
      if (!byDepartment[departamento]) {
        byDepartment[departamento] = { percepciones: 0, deducciones: 0, otrosPagos: 0, nomina: 0, count: 0 }
      }
      byDepartment[departamento].percepciones += percepciones
      byDepartment[departamento].deducciones += deducciones
      byDepartment[departamento].otrosPagos += otrosPagos
      byDepartment[departamento].nomina += Number(inv.total)
      byDepartment[departamento].count += 1
    }

    const empleadosPagados = empleadosSet.size
    const promedioNomina = empleadosPagados > 0 ? totalNomina / invoices.length : 0 // Promedio por recibo? Or per employee? Usually per receipt for "Promedio" in these dashboards
    const costoPorEmpleado = empleadosPagados > 0 ? totalNomina / empleadosPagados : 0
    const pctDeducciones = totalPercepciones > 0 ? (totalDeducciones / totalPercepciones) * 100 : 0
    
    // Sort departments by total nomina desc
    const departments = Object.entries(byDepartment)
      .map(([name, data]) => ({
        name,
        ...data
      }))
      .sort((a, b) => b.nomina - a.nomina)

    return NextResponse.json({
      kpis: {
        totalDeducciones,
        totalOtrosPagos,
        totalPercepciones,
        totalNomina,
        empleadosPagados,
        promedioNomina,
        totalDiasPagados,
        costoPorEmpleado,
        pctDeducciones,
        indiceAusentismo: 0 // Placeholder as it requires complex logic
      },
      departments
    })

  } catch (error) {
    console.error('Error fetching payroll metrics:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
