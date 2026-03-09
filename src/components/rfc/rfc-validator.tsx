'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'

interface RFCValidationResult {
  rfc: string
  isValid: boolean
  type: 'person' | 'company'
  errors: string[]
  verificationDigit?: string
  suggestions?: string[]
}

interface RFCValidatorProps {
  value: string
  onChange: (value: string) => void
  onValidation?: (result: RFCValidationResult) => void
  placeholder?: string
  className?: string
}

export default function RFCValidator({
  value,
  onChange,
  onValidation,
  placeholder = "XAXX010101000",
  className
}: RFCValidatorProps) {
  const [validation, setValidation] = useState<RFCValidationResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const validateRFC = async (rfc: string) => {
    if (!rfc || rfc.length < 12) {
      setValidation(null)
      return
    }

    setLoading(true)
    setError(null)

    try {
      console.log('Validating RFC:', rfc)
      const response = await fetch(`/api/rfc/validate?rfc=${encodeURIComponent(rfc.toUpperCase())}`)
      const result = await response.json()
      console.log('RFC validation result:', result)

      if (!response.ok) {
        throw new Error(result.error || 'Error al validar RFC')
      }

      setValidation(result)
      onValidation?.(result)
    } catch (err) {
      console.error('RFC validation error:', err)
      setError(err instanceof Error ? err.message : 'Error al validar RFC')
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value.toUpperCase().replace(/[^A-Z0-9Ñ&]/g, '')
    onChange(newValue)
    
    // Auto-validate when RFC is complete
    if (newValue.length >= 12) {
      validateRFC(newValue)
    } else {
      setValidation(null)
    }
  }

  const getTypeLabel = (type: 'person' | 'company') => {
    return type === 'person' ? 'Persona Física' : 'Persona Moral'
  }

  const getStatusBadge = (isValid: boolean) => {
    if (isValid) {
      return <Badge variant="default">Válido</Badge>
    } else {
      return <Badge variant="destructive">Inválido</Badge>
    }
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Input
          value={value}
          onChange={handleChange}
          placeholder={placeholder}
          className={`uppercase ${className || ''}`}
          maxLength={13}
        />
        {loading && (
          <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
          </div>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {validation && (
        <Alert variant={validation.isValid ? "default" : "destructive"}>
          <AlertDescription>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span>RFC: {validation.rfc}</span>
                {getStatusBadge(validation.isValid)}
                <Badge variant="outline">{getTypeLabel(validation.type)}</Badge>
              </div>
              
              {validation.verificationDigit && (
                <div>
                  <span className="text-sm text-muted-foreground">
                    Dígito verificador: {validation.verificationDigit}
                  </span>
                </div>
              )}

              {validation.errors.length > 0 && (
                <div>
                  <p className="font-medium mb-1">Errores:</p>
                  <ul className="text-sm space-y-1">
                    {validation.errors.map((error, index) => (
                      <li key={index}>• {error}</li>
                    ))}
                  </ul>
                </div>
              )}

              {validation.suggestions && validation.suggestions.length > 0 && (
                <div>
                  <p className="font-medium mb-1">Sugerencias:</p>
                  <ul className="text-sm space-y-1">
                    {validation.suggestions.map((suggestion, index) => (
                      <li key={index}>• {suggestion}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}