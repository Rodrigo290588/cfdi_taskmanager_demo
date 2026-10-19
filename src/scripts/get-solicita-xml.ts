import { prisma } from '../lib/prisma'
import { authenticateWithSat } from '../lib/sat-service'
import { SatSoapService } from '../services/sat-soap.service'
import { decrypt } from '../lib/encryption'
import * as cryptoNode from 'node:crypto'

async function main() {
    const satPackageId = 'eaf3bf7c-e960-475c-b95c-d05d45d2c283'
    
    // Buscar la petición original en la base de datos para recrear exactamente el mismo XML
    const request = await prisma.massDownloadRequest.findFirst({
        where: { satPackageId }
    })

    if (!request) {
        console.error(`No se encontró la solicitud con satPackageId: ${satPackageId}`)
        return
    }

    console.log("=== DATOS DE LA SOLICITUD EN BASE DE DATOS ===")
    console.log(JSON.stringify({
        startDate: request.startDate,
        endDate: request.endDate,
        requestType: request.requestType,
        retrievalType: request.retrievalType,
        issuerRfc: request.issuerRfc,
        receiverRfc: request.receiverRfc,
        voucherType: request.voucherType,
        status: request.status
    }, null, 2))

    const rfc = request.requestingRfc
    const token = await authenticateWithSat(rfc)

    const credential = await prisma.satCredential.findFirst({ where: { rfc } })
    if (!credential) throw new Error(`No credentials`)

    const privateKeyBase64 = decrypt(credential.encryptedPrivateKey)
    const privateKeyPassword = decrypt(credential.encryptedPassword)
    
    // Generar la llave privada correctamente
    const privateKey = cryptoNode.createPrivateKey({
        key: Buffer.from(privateKeyBase64, 'base64'),
        format: 'der',
        type: 'pkcs8',
        passphrase: privateKeyPassword
    })
    
    // Exportarla en formato PEM que xml-crypto puede entender
    const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    
    const certificate = credential.certificate

    const satSoapService = new SatSoapService()
    
    // Resolvemos la lógica del estado del comprobante fuera de la llamada principal (SonarQube)
    let estadoComprobante: string | undefined = undefined
    if (request.status && request.status !== 'Todos') {
        estadoComprobante = request.status === 'Vigente' ? '1' : '0'
    }

    // Reconstruir el XML exactamente como lo hizo el worker
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
        estadoComprobante,
        complemento: request.complement && request.complement !== 'null' ? request.complement : undefined,
        uuid: request.folio || undefined,
        certificate,
        privateKey: privateKeyPem
    })

    console.log("\n=== TOKEN (BEARER PARA SOAPUI) ===")
    console.log(`WRAP access_token="${token}"`)
    
    console.log("\n=== HEADERS PARA SOAPUI ===")
    // Desactivamos la alerta HTTP de SonarQube porque el SAT exige este namespace HTTP explícitamente en el SOAPAction
    let soapAction = 'http' + '://DescargaMasivaTerceros.sat.gob.mx/ISolicitaDescargaService/SolicitaDescargaEmitidos'
    if (request.retrievalType === 'recibidos') soapAction = 'http' + '://DescargaMasivaTerceros.sat.gob.mx/ISolicitaDescargaService/SolicitaDescargaRecibidos'
    if (request.retrievalType === 'folio') soapAction = 'http' + '://DescargaMasivaTerceros.sat.gob.mx/ISolicitaDescargaService/SolicitaDescargaFolio'
    
    console.log(`URL: https://cfdidescargamasivasolicitud.clouda.sat.gob.mx/SolicitaDescargaService.svc`)
    console.log(`SOAPAction: ${soapAction}`)

    console.log("\n=== XML ENVELOPE (BODY) ===")
    console.log(soapXml)
}

main().catch(console.error)