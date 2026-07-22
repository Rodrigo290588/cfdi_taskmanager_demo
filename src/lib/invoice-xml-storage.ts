import { createCipheriv, createDecipheriv, createHash, randomBytes, type CipherGCM, type DecipherGCM } from 'node:crypto'
import { Prisma, PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'

const INVOICE_XML_ENCRYPTION_KEY_ENV = 'INVOICE_XML_ENCRYPTION_KEY'
const INVOICE_XML_ENCRYPTION_KEY_FALLBACK_ENV = 'PROVIDER_CFDI_XML_ENCRYPTION_KEY'
const INVOICE_XML_KEY_VERSION = process.env.INVOICE_XML_KEY_VERSION || process.env.PROVIDER_CFDI_XML_KEY_VERSION || 'v1'
const INVOICE_XML_ENCRYPTION_ALGORITHM = 'aes-256-gcm'
const INVOICE_XML_IV_LENGTH = 12

type InvoiceBlobClient = PrismaClient | Prisma.TransactionClient

function resolveInvoiceEncryptionKey() {
  const rawValue =
    process.env[INVOICE_XML_ENCRYPTION_KEY_ENV]
    || process.env[INVOICE_XML_ENCRYPTION_KEY_FALLBACK_ENV]

  if (!rawValue) {
    throw new Error(
      `No se encontró la llave ${INVOICE_XML_ENCRYPTION_KEY_ENV}. Configúrala o reutiliza ${INVOICE_XML_ENCRYPTION_KEY_FALLBACK_ENV} para habilitar el resguardo cifrado del XML de ingresos.`
    )
  }

  const normalizedValue = rawValue.trim()

  if (/^[0-9a-fA-F]{64}$/.test(normalizedValue)) {
    return createHash('sha256').update(Buffer.from(normalizedValue, 'hex')).digest()
  }

  try {
    const base64Buffer = Buffer.from(normalizedValue, 'base64')
    if (base64Buffer.length >= 32) {
      return createHash('sha256').update(base64Buffer).digest()
    }
  } catch {}

  return createHash('sha256').update(normalizedValue, 'utf8').digest()
}

function sha256Hex(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function encryptInvoiceXmlContent(xmlContent: string) {
  const key = resolveInvoiceEncryptionKey()
  const iv = randomBytes(INVOICE_XML_IV_LENGTH)
  const cipher = createCipheriv(INVOICE_XML_ENCRYPTION_ALGORITHM, key, iv) as CipherGCM

  const ciphertext = Buffer.concat([cipher.update(xmlContent, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return {
    sha256: sha256Hex(xmlContent),
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    algorithm: INVOICE_XML_ENCRYPTION_ALGORITHM,
    keyVersion: INVOICE_XML_KEY_VERSION
  }
}

export function decryptInvoiceXmlContent(params: {
  ciphertext: string
  iv: string
  authTag: string
  algorithm: string
}) {
  const key = resolveInvoiceEncryptionKey()
  const decipher = createDecipheriv(
    params.algorithm || INVOICE_XML_ENCRYPTION_ALGORITHM,
    key,
    Buffer.from(params.iv, 'base64')
  ) as DecipherGCM

  decipher.setAuthTag(Buffer.from(params.authTag, 'base64'))

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(params.ciphertext, 'base64')),
    decipher.final()
  ])

  return decrypted.toString('utf8')
}

export async function upsertInvoiceXmlBlob(
  prismaClient: InvoiceBlobClient,
  params: {
    invoiceId: string
    xmlContent: string
  }
) {
  const encrypted = encryptInvoiceXmlContent(params.xmlContent)

  return prismaClient.invoiceBlob.upsert({
    where: { invoiceId: params.invoiceId },
    create: {
      invoiceId: params.invoiceId,
      xmlSha256: encrypted.sha256,
      xmlCiphertext: encrypted.ciphertext,
      xmlIv: encrypted.iv,
      xmlAuthTag: encrypted.authTag,
      xmlEncryptionAlg: encrypted.algorithm,
      xmlKeyVersion: encrypted.keyVersion
    },
    update: {
      xmlSha256: encrypted.sha256,
      xmlCiphertext: encrypted.ciphertext,
      xmlIv: encrypted.iv,
      xmlAuthTag: encrypted.authTag,
      xmlEncryptionAlg: encrypted.algorithm,
      xmlKeyVersion: encrypted.keyVersion
    }
  })
}

export async function getInvoiceXmlRecordById(invoiceId: string) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      uuid: true,
      satStatus: true,
      xmlContent: true,
      blob: {
        select: {
          xmlCiphertext: true,
          xmlIv: true,
          xmlAuthTag: true,
          xmlEncryptionAlg: true
        }
      }
    }
  })

  if (!invoice) {
    return null
  }

  const xmlContent = invoice.blob
    ? decryptInvoiceXmlContent({
        ciphertext: invoice.blob.xmlCiphertext,
        iv: invoice.blob.xmlIv,
        authTag: invoice.blob.xmlAuthTag,
        algorithm: invoice.blob.xmlEncryptionAlg
      })
    : invoice.xmlContent

  return {
    id: invoice.id,
    uuid: invoice.uuid,
    satStatus: invoice.satStatus,
    xmlContent
  }
}
