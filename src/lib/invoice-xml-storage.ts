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

/** Whitelist estricta algoritmos de cifrado AEAD aceptados.
 *  Regla AGENTS 13: helper reusable entre Next routes + BullMQ workers.
 *  NUNCA aceptar algoritmos sin autenticación (aes-128-ecb, aes-cbc, etc.).
 *  INV-007 cryptographic failures → padding oracle attack si algoritmo es manipulado via DB.
 */
const INVOICE_CIPHER_WHITELIST: ReadonlySet<string> = new Set<string>([
  'aes-256-gcm',
  'aes-128-gcm'
])

function assertEncryptionAlgorithmAllowed(algorithm: string): asserts algorithm is 'aes-256-gcm' | 'aes-128-gcm' {
  const normalized = String(algorithm || '').toLowerCase().trim()
  if (!normalized || !INVOICE_CIPHER_WHITELIST.has(normalized)) {
    throw new Error(
      `INV-007: InvoiceBlob encryptionAlg not allowed: ${JSON.stringify(normalized)}. Only AEAD whitelist permitted.`
    )
  }
}

export function decryptInvoiceXmlContent(params: {
  ciphertext: string
  iv: string
  authTag: string
  algorithm: string
}) {
  // INV-007 · Cryptographic Failures: whitelist estricto algoritmo AEAD.
  assertEncryptionAlgorithmAllowed(params.algorithm || INVOICE_XML_ENCRYPTION_ALGORITHM)
  const safeAlg = (params.algorithm || INVOICE_XML_ENCRYPTION_ALGORITHM).toLowerCase().trim() as 'aes-256-gcm' | 'aes-128-gcm'

  if (!params.authTag) {
    throw new Error('INV-007: authTag missing; GCM ciphers require 16-byte authentication tag.')
  }

  const key = resolveInvoiceEncryptionKey()
  const decipher = createDecipheriv(
    safeAlg,
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

/**
 * Recupera XML Invoice + InvoiceBlob descifrado SÓLO si pertenece a la organización dada.
 * INV-001 · BOLA Cross-Org: NO se permite retornar XML sin scope organizationId.
 * Regla AGENTS 12 (Arquitectura CFDI Big Data): InvoiceBlob desacoplado solo se descifra
 * DESPUÉS de comprobar tenant 100%.
 */
export async function getInvoiceXmlRecordById(invoiceId: string, organizationId: string) {
  if (!organizationId) {
    // Defense in depth: helper NO acepta llamadas sin org.
    throw new Error('INV-001: getInvoiceXmlRecordById requires organizationId.')
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      uuid: true,
      satStatus: true,
      xmlContent: true,
      issuerFiscalEntityId: true,
      issuerRfc: true,
      fiscalEntity: {
        select: { organizationId: true, id: true, rfc: true }
      },
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

  // INV-001 · BOLA Defense: Assert organizationId coincide con FiscalEntity dueño del Invoice.
  const targetInvoiceOrgId: unknown = invoice.fiscalEntity?.organizationId
  if (targetInvoiceOrgId !== organizationId) {
    throw new Error(
      `INV-001: Invoice ${invoiceId} does not belong to organization ${organizationId}. Cross-tenant access blocked.`
    )
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
    xmlContent,
    // Exponer metadata mínima tenant-safe para route handler (sin PK leak innecesario)
    _meta: {
      issuerRfc: invoice.issuerRfc,
      issuerFiscalEntityId: invoice.issuerFiscalEntityId,
      organizationId: invoice.fiscalEntity?.organizationId
    }
  }
}
