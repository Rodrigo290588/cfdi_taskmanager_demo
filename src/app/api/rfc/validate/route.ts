import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

const rfcValidationSchema = z.object({
  rfc: z.string().regex(/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/, 'RFC inválido'),
})

/**
 * Validates Mexican RFC (Registro Federal de Contribuyentes)
 * Format: XXXX000000XXX (4 letters, 6 digits, 3 alphanumeric)
 * For persons: 4 letters (name), 6 digits (birthdate YYMMDD), 3 alphanumeric (homoclave)
 * For companies: 3 letters (company name), 6 digits (constitution date YYMMDD), 3 alphanumeric (homoclave)
 */
function validateRFC(rfc: string): { isValid: boolean; type: 'person' | 'company'; errors: string[] } {
  const errors: string[] = []
  
  // Basic format validation
  if (!rfc || rfc.length < 12 || rfc.length > 13) {
    errors.push('RFC debe tener entre 12 y 13 caracteres')
    return { isValid: false, type: 'person', errors }
  }

  // RFC pattern validation
  const rfcPattern = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/
  if (!rfcPattern.test(rfc)) {
    errors.push('Formato de RFC inválido')
    return { isValid: false, type: 'person', errors }
  }

  const type = rfc.length === 12 ? 'company' : 'person'
  
  // Extract components
  const letters = rfc.substring(0, type === 'person' ? 4 : 3)
  const datePart = rfc.substring(type === 'person' ? 4 : 3, type === 'person' ? 10 : 9)
  const homoclave = rfc.substring(type === 'person' ? 10 : 9)
  
  // Validate date part (YYMMDD)
  const year = parseInt(datePart.substring(0, 2))
  const month = parseInt(datePart.substring(2, 4))
  const day = parseInt(datePart.substring(4, 6))
  
  // Validate year (reasonable range)
  const currentYear = new Date().getFullYear()
  const currentCentury = Math.floor(currentYear / 100)
  const fullYear = year < 30 ? (currentCentury * 100) + year : ((currentCentury - 1) * 100) + year
  
  if (fullYear < 1900 || fullYear > currentYear) {
    errors.push('Año en RFC inválido')
  }
  
  // Validate month
  if (month < 1 || month > 12) {
    errors.push('Mes en RFC inválido')
  }
  
  // Validate day (basic validation)
  if (day < 1 || day > 31) {
    errors.push('Día en RFC inválido')
  }
  
  // More specific day validation based on month
  const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (month >= 1 && month <= 12 && day > daysInMonth[month - 1]) {
    // Check for leap year if February
    if (month === 2 && day === 29) {
      const isLeapYear = (fullYear % 4 === 0 && fullYear % 100 !== 0) || (fullYear % 400 === 0)
      if (!isLeapYear) {
        errors.push('Febrero no tiene 29 días en este año')
      }
    } else {
      errors.push(`El mes ${month} no tiene ${day} días`)
    }
  }
  
  // Validate homoclave (last 3 characters)
  const homoclavePattern = /^[A-Z0-9]{3}$/
  if (!homoclavePattern.test(homoclave)) {
    errors.push('Homoclave de RFC inválida')
  }
  
  // Forbidden words validation (palabras prohibidas)
  const forbiddenWords = [
    'BUEI', 'BUEY', 'CACA', 'CACO', 'CAGA', 'CAGO', 'CAKA', 'CAKO', 'COGE', 'COJA', 'COJE', 'COJI', 'COJO',
    'CULO', 'FETO', 'GUEY', 'JOTO', 'KACA', 'KACO', 'KAGA', 'KAGO', 'KOGE', 'KOJO', 'KULO', 'MAME',
    'MAMO', 'MEAR', 'MEAS', 'MEON', 'MION', 'MOCO', 'MULA', 'PEDA', 'PEDO', 'PENE', 'PUTA', 'PUTO',
    'QULO', 'RATA', 'RUIN', 'BUEI', 'BUEY', 'CACA', 'CACO', 'CAGA', 'CAGO', 'CAKA', 'CAKO', 'COGE',
    'COJA', 'COJE', 'COJI', 'COJO', 'CULO', 'FETO', 'GUEY', 'JOTO', 'KACA', 'KACO', 'KAGA', 'KAGO',
    'KOGE', 'KOJO', 'KULO', 'MAME', 'MAMO', 'MEAR', 'MEAS', 'MEON', 'MION', 'MOCO', 'MULA', 'PEDA',
    'PEDO', 'PENE', 'PUTA', 'PUTO', 'QULO', 'RATA', 'RUIN'
  ]
  
  if (forbiddenWords.includes(letters)) {
    errors.push('RFC contiene palabras no permitidas')
  }
  
  return {
    isValid: errors.length === 0,
    type,
    errors
  }
}

/**
 * Calculates verification digit for RFC
 * This is a simplified version - the actual algorithm is more complex
 */
function calculateVerificationDigit(rfc: string): string {
  // This is a simplified implementation
  // The actual SAT algorithm is more complex and involves:
  // 1. Converting letters to numbers
  // 2. Applying weights
  // 3. Modulo operations
  // 4. Mapping to verification digit
  
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  let sum = 0
  let factor = 13
  
  for (let i = 0; i < rfc.length - 1; i++) {
    const char = rfc[i].toUpperCase()
    const value = alphabet.indexOf(char)
    if (value !== -1) {
      sum += value * factor
      factor--
    }
  }
  
  const verification = 11 - (sum % 11)
  
  if (verification === 10) return 'A'
  if (verification === 11) return '0'
  return verification.toString()
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    // Validate input
    const validationResult = rfcValidationSchema.safeParse(body)
    
    if (!validationResult.success) {
      return NextResponse.json(
        { 
          error: 'Datos inválidos',
          details: validationResult.error.issues.map(issue => ({
            field: issue.path.join('.'),
            message: issue.message
          }))
        },
        { status: 400 }
      )
    }

    const { rfc } = validationResult.data
    
    // Validate RFC
    const validation = validateRFC(rfc)
    
    // Calculate verification digit
    const verificationDigit = calculateVerificationDigit(rfc)
    
    return NextResponse.json({
      rfc,
      isValid: validation.isValid,
      type: validation.type,
      errors: validation.errors,
      verificationDigit,
      suggestions: validation.errors.length > 0 ? [
        'Verifique que el RFC tenga el formato correcto',
        'Asegúrese de que la fecha sea válida',
        'Revise que no contenga caracteres especiales',
        'Para personas físicas: 4 letras + 6 dígitos + 3 caracteres',
        'Para personas morales: 3 letras + 6 dígitos + 3 caracteres'
      ] : []
    })

  } catch (error) {
    console.error('Error validating RFC:', error)
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const rfc = searchParams.get('rfc')
    
    if (!rfc) {
      return NextResponse.json(
        { error: 'RFC es requerido' },
        { status: 400 }
      )
    }
    
    // Validate RFC
    const validation = validateRFC(rfc)
    
    return NextResponse.json({
      rfc,
      isValid: validation.isValid,
      type: validation.type,
      errors: validation.errors
    })

  } catch (error) {
    console.error('Error validating RFC:', error)
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
}