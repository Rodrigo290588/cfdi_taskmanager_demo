import { prisma } from '../lib/prisma'
import { authenticateWithSat } from '../lib/sat-service'
import { decrypt } from '../lib/encryption'
import crypto from 'node:crypto'

async function main() {
    const rfc = 'DMC750410C41'
    const idSolicitud = '68a72926-bc06-423a-a10a-f0d3a7d0dbb4'
    const token = await authenticateWithSat(rfc)

    const credential = await prisma.satCredential.findFirst({ where: { rfc } })
    if (!credential) throw new Error(`No credentials`)

    const privateKeyBase64 = decrypt(credential.encryptedPrivateKey)
    const privateKeyPassword = decrypt(credential.encryptedPassword)
    const certificateBase64 = credential.certificate.replace(/-----BEGIN CERTIFICATE-----/g, '').replace(/-----END CERTIFICATE-----/g, '').replace(/\s/g, '')

    const privateKey = crypto.createPrivateKey({
        key: Buffer.from(privateKeyBase64, 'base64'),
        format: 'der',
        type: 'pkcs8',
        passphrase: privateKeyPassword
    })

    const certBuffer = Buffer.from(certificateBase64, 'base64')
    const x509 = new crypto.X509Certificate(certBuffer)
    const issuerName = x509.issuer.split('\n').reverse().join(', ')
    const serialHex = x509.serialNumber
    const serialNumber = BigInt('0x' + serialHex).toString(10)

    const solicitudAttrs = `IdSolicitud="${idSolicitud}" RfcSolicitante="${rfc}"`
    const solicitudXml = `<des:solicitud ${solicitudAttrs}></des:solicitud>`

    const shasum = crypto.createHash('sha1') // NOSONAR: Requerido por la especificación del SAT para xmldsig#sha1
    shasum.update(solicitudXml)
    const digest = shasum.digest('base64')

    const signedInfoXml = `<SignedInfo><CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/><SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/><Reference URI=""><Transforms><Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/></Transforms><DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/><DigestValue>${digest}</DigestValue></Reference></SignedInfo>`

    const signer = crypto.createSign('rsa-sha1')
    signer.update(signedInfoXml)
    const signature = signer.sign(privateKey, 'base64')

    const envelope = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:des="http://DescargaMasivaTerceros.sat.gob.mx" xmlns:xd="http://www.w3.org/2000/09/xmldsig#"><soapenv:Header/><soapenv:Body><des:VerificaSolicitudDescarga><des:solicitud ${solicitudAttrs}><Signature xmlns="http://www.w3.org/2000/09/xmldsig#">${signedInfoXml}<SignatureValue>${signature}</SignatureValue><KeyInfo><X509Data><X509IssuerSerial><X509IssuerName>${issuerName}</X509IssuerName><X509SerialNumber>${serialNumber}</X509SerialNumber></X509IssuerSerial><X509Certificate>${certificateBase64}</X509Certificate></X509Data></KeyInfo></Signature></des:solicitud></des:VerificaSolicitudDescarga></soapenv:Body></soapenv:Envelope>`

    console.log("=== TOKEN (BEARER PARA SOAPUI) ===")
    console.log(`WRAP access_token="${token}"`)
    console.log("\n=== XML ENVELOPE ===")
    console.log(envelope)
}

main().catch(console.error)
