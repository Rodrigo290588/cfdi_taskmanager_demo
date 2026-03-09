import { PrismaClient } from '@prisma/client'
import { SatSoapService } from '../services/sat-soap.service'
import { authenticateWithSat } from '../lib/sat-service'
import { decrypt } from '../lib/encryption'
import crypto from 'crypto'
import fs from 'fs'

const prisma = new PrismaClient()
const satSoapService = new SatSoapService()
const SAT_SOLICITA_URL = 'https://cfdidescargamasivasolicitud.clouda.sat.gob.mx/SolicitaDescargaService.svc'

function getSoapAction(retrievalType: string): string {
  const baseUrl = 'http://DescargaMasivaTerceros.sat.gob.mx/ISolicitaDescargaService'
  switch (retrievalType) {
    case 'recibidos': return `${baseUrl}/SolicitaDescargaRecibidos`
    case 'folio': return `${baseUrl}/SolicitaDescargaFolio`
    default: return `${baseUrl}/SolicitaDescargaEmitidos`
  }
}

async function main() {
  console.log('Starting Debug Script with Request Simulation...')

  // 2. Get Credentials & Token
  // Usage: ts-node src/scripts/debug-soap.ts [RFC]
  const args = process.argv.slice(2)
  const targetRfc = args[0] || 'SCI041122EI6'
  console.log(`Testing with RFC: ${targetRfc}`)

  console.log('Authenticating...')
  const token = await authenticateWithSat(targetRfc)
  console.log('Got Token:', token.substring(0, 20) + '...')

  const credential = await prisma.satCredential.findFirst({
    where: { rfc: targetRfc }
  })

  if (!credential) throw new Error('No credential for ' + targetRfc)

  const privateKeyBase64 = decrypt(credential.encryptedPrivateKey)
  const privateKeyPassword = decrypt(credential.encryptedPassword)
  const certificate = credential.certificate
  
  const privateKeyObject = crypto.createPrivateKey({
    key: Buffer.from(privateKeyBase64, 'base64'),
    format: 'der',
    type: 'pkcs8',
    passphrase: privateKeyPassword
  })
  
  const privateKeyPem = privateKeyObject.export({ format: 'pem', type: 'pkcs8' }) as string

  // 4. Generate SOAP
  // Create a dummy request options
  const soapXml = satSoapService.generateSolicitaDescargaSoap({
      rfcSolicitante: targetRfc,
      startDate: new Date(Date.now() - 86400000 * 5), // 5 days ago
      endDate: new Date(),
      tipoSolicitud: 'CFDI',
      retrievalType: 'emitidos',
      rfcEmisor: targetRfc, // Self
      certificate,
      privateKey: privateKeyPem
  })

  console.log('Generated SOAP XML (Preview):', soapXml.substring(0, 200) + '...')
  fs.writeFileSync('debug_soap_request_final.xml', soapXml)

  // 5. Send Request
  const retrievalType = 'emitidos'
  const soapAction = getSoapAction(retrievalType)
  console.log('Sending to SAT:', SAT_SOLICITA_URL)
  console.log('SOAPAction:', soapAction)

  const response = await fetch(SAT_SOLICITA_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': `"${soapAction}"`,
      'Authorization': `WRAP access_token="${token}"`
    },
    body: soapXml
  })

  const text = await response.text()
  console.log('SAT Response Status:', response.status)
  console.log('SAT Response Body:', text)

}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())