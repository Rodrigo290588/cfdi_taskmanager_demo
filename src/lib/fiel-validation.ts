import { X509Certificate, createPrivateKey, createPublicKey } from "crypto"

interface FielValidationResult {
  isValid: boolean
  error?: string
  rfc?: string
}

export function validateFiel(
  privateKeyBuffer: Buffer,
  certificateBuffer: Buffer,
  password: string
): FielValidationResult {
  try {
    // 1. Validate Private Key and Password
    // SAT Private Keys are usually PKCS#8 DER Encrypted
    let privateKey
    try {
      privateKey = createPrivateKey({
        key: privateKeyBuffer,
        format: "der",
        type: "pkcs8",
        passphrase: password,
      })
    } catch {
      // If it fails, try 'pem' format just in case, though SAT uses DER
      try {
        privateKey = createPrivateKey({
          key: privateKeyBuffer,
          format: "pem",
          passphrase: password,
        })
      } catch {
        return {
          isValid: false,
          error: "La contraseña es incorrecta o el archivo .key no es válido.",
        }
      }
    }

    // 2. Validate Certificate and Extract Public Key
    let x509
    try {
      x509 = new X509Certificate(certificateBuffer)
    } catch {
      return {
        isValid: false,
        error: "El archivo .cer no es válido.",
      }
    }

    // 3. Compare Public Keys
    const certPublicKey = x509.publicKey.export({ type: "spki", format: "pem" })
    
    // Create public key from private key
    const derivedPublicKey = createPublicKey(privateKey).export({ type: "spki", format: "pem" })

    if (certPublicKey !== derivedPublicKey) {
      return {
        isValid: false,
        error: "El archivo .cer no corresponde al archivo .key proporcionado.",
      }
    }
    
    // 4. Extract RFC from Certificate Subject
    // The Subject string format typically includes the RFC
    // Common format: "C=MX\nO=Servicio de Administración Tributaria\nOU=Servicio de Administración Tributaria\nCN=..."
    // Or for older certs, OID 2.5.4.45 (x500UniqueIdentifier) might contain the RFC
    
    // We'll try to find the RFC in the subject string. 
    // It's often present as part of the CN or explicitly.
    // However, robust parsing is complex.
    // A simpler approach for SAT certs: The Subject often contains the RFC 
    // or the 'x500UniqueIdentifier' field.
    
    // Let's use a regex to find a pattern that looks like an RFC in the subject.
    // RFC Pattern: [A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}
    
    const subject = x509.subject
    const rfcMatch = subject.match(/([A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3})/i)
    const extractedRfc = rfcMatch ? rfcMatch[0].toUpperCase() : undefined

    // Note: This regex might match other things if they look like an RFC, but in the context of a SAT cert subject, 
    // it's highly likely to be the RFC (or CURP which is similar but longer, RFC is 12 or 13 chars).
    
    return {
      isValid: true,
      rfc: extractedRfc
    }

  } catch (error) {
    console.error("FIEL Validation Error:", error)
    const errorMessage = error instanceof Error ? error.message : "Unknown error"
    return {
      isValid: false,
      error: "Error inesperado al validar la FIEL: " + errorMessage,
    }
  }
}
