import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { CfdiType, InvoiceStatus, SatStatus } from '@prisma/client'

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const companyId = searchParams.get('companyId')
    if (!companyId) {
      return NextResponse.json({ error: 'companyId requerido' }, { status: 400 })
    }

    const member = await prisma.member.findFirst({
      where: { userId: session.user.id, status: 'APPROVED' },
      include: { organization: true }
    })
    if (!member) {
      return NextResponse.json({ error: 'Membresía no encontrada' }, { status: 404 })
    }

    const access = await prisma.companyAccess.findUnique({
      where: { memberId_companyId: { memberId: member.id, companyId } }
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

    let fiscalEntity = await prisma.fiscalEntity.findFirst({ where: { rfc: company.rfc } })
    if (!fiscalEntity && member.organization) {
      fiscalEntity = await prisma.fiscalEntity.create({
        data: {
          organizationId: member.organization.id,
          rfc: company.rfc,
          businessName: company.businessName,
          taxRegime: '601',
          postalCode: '04120',
          isActive: true
        }
      })
    }

    if (!fiscalEntity) {
      return NextResponse.json({ error: 'Entidad fiscal no disponible' }, { status: 400 })
    }

    const userId = session.user.id

    const rand = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min
    const suppliers = [
      { rfc: 'PROV001234AB1', name: 'Proveedor Uno SA de CV' },
      { rfc: 'PROV00DEF5678', name: 'Servicios Globales MX SA de CV' },
      { rfc: 'PROV00XYZ9999', name: 'Distribuciones del Norte SA de CV' }
    ]
    const clients = [
      { rfc: 'CLI001234AB1', name: 'Cliente Uno SA de CV' },
      { rfc: 'CLI00DEF5678', name: 'Retail MX SA de CV' },
      { rfc: 'CLI00XYZ9999', name: 'Comercializadora Centro SA de CV' }
    ]

    const now = new Date()
    const demoInvoices = Array.from({ length: 48 }, (_, i) => {
      const issued = i % 2 === 0
      const date = new Date(now)
      date.setMonth(now.getMonth() - rand(0, 11))
      const subtotal = rand(5000, 300000)
      const total = Number((subtotal * 1.16).toFixed(2))
      const issuer = issued ? { rfc: company.rfc!, name: company.businessName! } : suppliers[rand(0, suppliers.length - 1)]
      const receiver = issued ? clients[rand(0, clients.length - 1)] : { rfc: company.rfc!, name: company.businessName! }
      return {
        userId,
        fiscalEntityId: fiscalEntity!.id,
        uuid: crypto.randomUUID(),
        cfdiType: [CfdiType.INGRESO, CfdiType.EGRESO, CfdiType.PAGO, CfdiType.NOMINA][rand(0, 3)],
        series: issued ? 'S' : 'R',
        folio: `${rand(1000, 9999)}`,
        currency: 'MXN',
        exchangeRate: null,
        status: InvoiceStatus.ACTIVE,
        satStatus: [SatStatus.VIGENTE, SatStatus.CANCELADO, SatStatus.NO_ENCONTRADO][rand(0, 2)],
        issuerRfc: issuer.rfc,
        issuerName: issuer.name,
        receiverRfc: receiver.rfc,
        receiverName: receiver.name,
        subtotal,
        total,
        ivaTrasladado: Number((subtotal * 0.16).toFixed(2)),
        ivaRetenido: 0,
        isrRetenido: 0,
        iepsRetenido: 0,
        xmlContent: '<xml>sat</xml>',
        pdfUrl: null,
        issuanceDate: date,
        certificationDate: new Date(date.getTime() + 60000),
        certificationPac: 'SAT',
        paymentMethod: ['PUE', 'PPD'][rand(0, 1)],
        paymentForm: ['03', '01', '99'][rand(0, 2)],
        usageCfdi: 'G03',
        expeditionPlace: '04120'
      }
    })

    const sat = (prisma as unknown as { satInvoice: { createMany: (args: unknown) => Promise<unknown> } }).satInvoice
    await sat.createMany({ data: demoInvoices as unknown })

    return NextResponse.json({ imported: demoInvoices.length })
  } catch (error) {
    console.error('Error import SAT:', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
