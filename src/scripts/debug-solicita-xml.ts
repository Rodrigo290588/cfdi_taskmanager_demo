import { prisma } from '../lib/prisma'
import { SatSoapService } from '../services/sat-soap.service'
import { decrypt } from '../lib/encryption'
import crypto from 'node:crypto'

function resolveEstadoComprobante(status?: string | null): string | undefined {
  if (!status || status === 'Todos') return undefined
  if (status === 'Vigente') return 'Vigente'
  return '0'
}

async function main() {
  const args = process.argv.slice(2)
  const reqIdIndex = args.indexOf('--id')
  let request;
  
  if (reqIdIndex !== -1 && args[reqIdIndex + 1]) {
    request = await prisma.massDownloadRequest.findUnique({
      where: { id: args[reqIdIndex + 1] }
    })
  } else {
    // Buscar la última solicitud que tuvo el error de XML Mal Formado
    request = await prisma.massDownloadRequest.findFirst({
      where: { 
        satMessage: {
          contains: 'XML Mal Formado'
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    if (!request) {
       // Si no, simplemente traemos la última solicitud general
       request = await prisma.massDownloadRequest.findFirst({
         orderBy: { createdAt: 'desc' }
       })
    }
  }

  if (!request) {
    console.error('No se encontró ninguna solicitud en la base de datos.')
    process.exit(1)
  }

  console.log(`Generando XML para la solicitud interna ID: ${request.id}`)
  console.log(`RFC Solicitante: ${request.requestingRfc}`)
  console.log(`Fechas: Del ${request.startDate?.toISOString()} al ${request.endDate?.toISOString()}`)
  console.log(`Tipo: ${request.requestType} | Recuperación: ${request.retrievalType} | Estatus: ${request.status}`)

  const credential = await prisma.satCredential.findFirst({
    where: { rfc: request.requestingRfc }
  })

  if (!credential) {
    console.error(`No hay credenciales SAT registradas para el RFC ${request.requestingRfc}`)
    process.exit(1)
  }

  const privateKeyBase64 = decrypt(credential.encryptedPrivateKey)
  const privateKeyPassword = decrypt(credential.encryptedPassword)
  const certificate = credential.certificate

  const privateKeyObject = crypto.createPrivateKey({
    key: Buffer.from(privateKeyBase64, 'base64'),
    format: 'der',
    type: 'pkcs8',
    passphrase: privateKeyPassword
  })

  const privateKeyPem = privateKeyObject.export({
    format: 'pem',
    type: 'pkcs8'
  }) as string

  const satSoapService = new SatSoapService()
  
  const soapXml = satSoapService.generateSolicitaDescargaSoap({
    rfcSolicitante: request.requestingRfc,
    startDate: request.startDate!,
    endDate: request.endDate!,
    tipoSolicitud: request.requestType as 'CFDI' | 'Metadata',
    retrievalType: request.retrievalType as 'emitidos' | 'recibidos' | 'folio',
    rfcEmisor: request.issuerRfc || undefined,
    rfcReceptor: request.receiverRfc || undefined,
    rfcACuentaTerceros: request.thirdPartyRfc || undefined,
    tipoComprobante: request.voucherType || undefined,
    estadoComprobante: resolveEstadoComprobante(request.status),
    complemento: request.complement && request.complement !== 'null' ? request.complement : undefined,
    uuid: request.folio || undefined,
    certificate,
    privateKey: privateKeyPem
  })

  console.log('\n================ XML SOAP GENERADO ================')
  console.log(soapXml)
  console.log('===================================================\n')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())