import { NextRequest, NextResponse } from 'next/server'
import { validateApiKey } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { cfdiInputSchema } from '@/schemas/cfdiInput'
import { normalizarJson, generarXml } from '@/services/cfdi.service'
import { timbrarCfdi } from '@/services/pac.service'
import { CfdiType, InvoiceStatus, SatStatus, Prisma } from '@prisma/client'
import crypto from 'crypto'

export async function POST(request: NextRequest) {
  try {
    const authResult = await validateApiKey(request)
    if (!authResult.valid) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status || 401 })
    }
    if (!authResult.permissions?.includes('write')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || undefined
    const userAgent = request.headers.get('user-agent') || undefined
    const orgId = request.headers.get('x-org-id') || undefined
    if (!orgId) {
      try {
        await prisma.auditLog.create({
          data: {
            tableName: 'cfdi_api',
            recordId: crypto.randomUUID(),
            action: 'REJECT',
            oldValues: ({ reason: 'missing_org_header' } as unknown) as Prisma.InputJsonValue,
            newValues: { step: 'missing_org_header' },
            userId: authResult.user?.id || '',
            userEmail: authResult.user?.email || '',
            ipAddress: ip,
            userAgent,
            description: 'x-org-id header requerido'
          }
        })
      } catch {}
      return NextResponse.json({ error: 'x-org-id header requerido' }, { status: 400 })
    }

    const body = await request.json()
    const requestId = crypto.randomUUID()
    await prisma.auditLog.create({
      data: {
        tableName: 'cfdi_api',
        recordId: requestId,
        action: 'IMPORT',
        oldValues: body,
        newValues: { step: 'received' },
        userId: authResult.user?.id || '',
        userEmail: authResult.user?.email || '',
        ipAddress: ip,
        userAgent,
        description: 'CFDI timbrar request recibido',
      }
    })
    const input = cfdiInputSchema.parse(body)

    const norm = normalizarJson(input)
    const xml = generarXml(norm)
    const { uuid, xmlTimbrado } = await timbrarCfdi(xml)

    const userId = authResult.user?.id || ''

    // Validar membresía del usuario a la organización indicada
    const member = await prisma.member.findFirst({ where: { userId, organizationId: orgId, status: 'APPROVED' } })
    if (!member) {
      try {
        await prisma.auditLog.create({
          data: {
            tableName: 'cfdi_api',
            recordId: requestId,
            action: 'REJECT',
            oldValues: ({ reason: 'no_membership_access', orgId } as unknown) as Prisma.InputJsonValue,
            newValues: { step: 'membership_reject' },
            userId,
            userEmail: authResult.user?.email || '',
            ipAddress: ip,
            userAgent,
            description: 'Sin acceso a la organización'
          }
        })
      } catch {}
      return NextResponse.json({ error: 'Sin acceso a la organización' }, { status: 403 })
    }

    // Fiscal entity por RFC y organización; no crear si no existe
    const fiscalEntity = await prisma.fiscalEntity.findFirst({ where: { rfc: norm.emisor.rfc, organizationId: orgId } })
    if (!fiscalEntity) {
      try {
        await prisma.auditLog.create({
          data: {
            tableName: 'cfdi_api',
            recordId: requestId,
            action: 'REJECT',
            oldValues: ({ reason: 'fiscal_entity_not_found', issuerRfc: norm.emisor.rfc, organizationId: orgId } as unknown) as Prisma.InputJsonValue,
            newValues: { step: 'fiscal_entity_missing' },
            userId,
            userEmail: authResult.user?.email || '',
            ipAddress: ip,
            userAgent,
            description: 'Entidad fiscal (RFC) no registrada en la organización'
          }
        })
      } catch {}
      return NextResponse.json({ error: 'Entidad fiscal (RFC) no registrada en la organización' }, { status: 400 })
    }

    // Totales por impuesto
    const sumByImpuesto = (items: Array<{ impuesto: string; importe: string }>) =>
      items.reduce<Record<string, number>>((acc, i) => {
        acc[i.impuesto] = (acc[i.impuesto] || 0) + Number(i.importe)
        return acc
      }, {})

    const trasSum = sumByImpuesto(norm.comprobante.impuestos.traslados)
    const retSum = sumByImpuesto(norm.comprobante.impuestos.retenciones)

    const ivaTransferred = trasSum['002'] || 0
    const ivaWithheld = retSum['002'] || 0
    const isrWithheld = retSum['001'] || 0
    const iepsWithheld = retSum['003'] || 0

    const invoice = await prisma.invoice.create({
      data: {
        userId,
        issuerFiscalEntityId: fiscalEntity.id,
        uuid,
        cfdiType: CfdiType.INGRESO,
        series: norm.comprobante.serie,
        folio: norm.comprobante.folio,
        currency: norm.comprobante.moneda,
        exchangeRate: norm.comprobante.tipoCambio ? Number(norm.comprobante.tipoCambio) : null,
        status: InvoiceStatus.ACTIVE,
        satStatus: SatStatus.VIGENTE,
        issuerRfc: norm.emisor.rfc,
        issuerName: norm.emisor.nombre,
        receiverRfc: norm.receptor.rfc,
        receiverName: norm.receptor.nombre,
        subtotal: new Prisma.Decimal(norm.comprobante.subtotal),
        discount: new Prisma.Decimal(norm.comprobante.descuento),
        total: new Prisma.Decimal(norm.comprobante.total),
        ivaTransferred: new Prisma.Decimal(ivaTransferred.toFixed(2)),
        ivaWithheld: new Prisma.Decimal(ivaWithheld.toFixed(2)),
        isrWithheld: new Prisma.Decimal(isrWithheld.toFixed(2)),
        iepsWithheld: new Prisma.Decimal(iepsWithheld.toFixed(2)),
        xmlContent: xmlTimbrado,
        pdfUrl: null,
        issuanceDate: new Date(norm.comprobante.fecha),
        certificationDate: new Date(),
        certificationPac: 'PAC SIMULADO',
        paymentMethod: norm.comprobante.metodoPago,
        paymentForm: norm.comprobante.formaPago,
        cfdiUsage: norm.receptor.usoCfdi,
        placeOfExpedition: norm.comprobante.lugarExpedicion,
        exportKey: norm.comprobante.exportacion,
        objectTaxComprobante: norm.comprobante.objetoImp,
        paymentConditions: norm.comprobante.condicionesDePago,
        concepts: {
          create: norm.conceptos.map(c => ({
            productServiceKey: c.claveProdServ,
            identificationNumber: c.noIdentificacion,
            unitQuantity: new Prisma.Decimal(c.cantidad),
            unitKey: c.claveUnidad,
            unitDescription: c.unidad,
            description: c.descripcion,
            unitValue: new Prisma.Decimal(c.valorUnitario),
            amount: new Prisma.Decimal(c.importe),
            discount: new Prisma.Decimal((c.descuento ?? '0')),
            objectOfTax: c.objetoImp,
            transferredTaxesJson: c.impuestos.traslados.length ? (c.impuestos.traslados as unknown as object) : undefined,
            withheldTaxesJson: c.impuestos.retenciones.length ? (c.impuestos.retenciones as unknown as object) : undefined,
          }))
        },
        relatedCfdis: {
          create: norm.cfdiRelacionados.flatMap(r => r.uuids.map(u => ({ relationType: r.tipoRelacion, relatedUuid: u })))
        }
      }
    })

    await prisma.auditLog.create({
      data: {
        tableName: 'cfdi_api',
        recordId: uuid,
        action: 'CREATE',
        oldValues: { requestId },
        newValues: {
          uuid,
          issuerRfc: invoice.issuerRfc,
          receiverRfc: invoice.receiverRfc,
          total: invoice.total.toString(),
        },
        userId,
        userEmail: authResult.user?.email || '',
        ipAddress: ip,
        userAgent,
        description: 'CFDI timbrado y registrado',
      }
    })

    return NextResponse.json({ uuid: invoice.uuid, xml: xmlTimbrado }, { status: 201 })
  } catch (error) {
    if (typeof error === 'object' && error && 'issues' in (error as object)) {
      const zodErr = error as { issues: unknown }
      try {
        await prisma.auditLog.create({
          data: {
            tableName: 'cfdi_api',
            recordId: crypto.randomUUID(),
            action: 'REJECT',
            oldValues: ({ reason: 'Zod validation', details: zodErr.issues } as unknown) as Prisma.InputJsonValue,
            newValues: { step: 'validation_error' },
            userId: '',
            userEmail: '',
            description: 'Solicitud rechazada por validación Zod',
          }
        })
      } catch {}
      return NextResponse.json({ error: 'Validación Zod', details: zodErr.issues }, { status: 400 })
    }
    console.error('Error timbrado:', error)
    try {
      await prisma.auditLog.create({
        data: {
          tableName: 'cfdi_api',
          recordId: crypto.randomUUID(),
          action: 'REJECT',
          oldValues: { reason: 'Internal error' },
          newValues: { step: 'internal_error' },
          userId: '',
          userEmail: '',
          description: 'Error interno en timbrado',
        }
      })
    } catch {}
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
