'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import RFCValidator from '@/components/rfc/rfc-validator'
import Image from 'next/image'
import { Upload, X } from 'lucide-react'

const optionalUrlSchema = z.preprocess(
  (val) => (typeof val === 'string' && val.trim() === '' ? undefined : val),
  z.string().url('URL inválida').optional()
)

const optionalPositiveIntSchema = z.preprocess(
  (val) => {
    if (val === '' || val === null || val === undefined) return undefined
    if (typeof val === 'number' && Number.isNaN(val)) return undefined
    return val
  },
  z.number().int().positive().optional()
)

const companyFormSchema = z.object({
  name: z.string().min(1, 'El nombre es requerido').max(200),
  rfc: z.string()
    .regex(/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/, 'RFC inválido')
    .transform(val => val.toUpperCase()),
  businessName: z.string().min(1, 'La razón social es requerida').max(200),
  legalRepresentative: z.string().optional(),
  taxRegime: z.string().min(1, 'El régimen fiscal es requerido'),
  postalCode: z.string().regex(/^\d{5}$/, 'Código postal inválido'),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().default('México'),
  phone: z.string().optional(),
  email: z.string().email('Email inválido').optional(),
  website: optionalUrlSchema,
  industry: z.string().optional(),
  employeesCount: optionalPositiveIntSchema,
  incorporationDate: z.string().optional(),
  notes: z.string().optional(),
})

type CompanyFormData = z.infer<typeof companyFormSchema>

const taxRegimes = [
  { code: '601', name: 'General de Ley Personas Morales' },
  { code: '603', name: 'Personas Morales con Fines no Lucrativos' },
  { code: '605', name: 'Sueldos y Salarios e Ingresos Asimilados a Salarios' },
  { code: '606', name: 'Arrendamiento' },
  { code: '607', name: 'Régimen de Enajenación o Adquisición de Bienes' },
  { code: '608', name: 'Demás ingresos' },
  { code: '609', name: 'Consolidación' },
  { code: '610', name: 'Residentes en el Extranjero sin Establecimiento Permanente en México' },
  { code: '611', name: 'Ingresos por Dividendos (socios y accionistas)' },
  { code: '612', name: 'Personas Físicas con Actividades Empresariales y Profesionales' },
  { code: '614', name: 'Ingresos por intereses' },
  { code: '615', name: 'Régimen de los ingresos por obtención de premios' },
  { code: '616', name: 'Sin obligaciones fiscales' },
  { code: '620', name: 'Sociedades Cooperativas de Producción que optan por diferir sus ingresos' },
  { code: '621', name: 'Incorporación Fiscal' },
  { code: '622', name: 'Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras' },
  { code: '623', name: 'Opcional para Grupos de Sociedades' },
  { code: '624', name: 'Coordinados' },
  { code: '625', name: 'Régimen de las Actividades Empresariales con ingresos a través de Plataformas Tecnológicas' },
  { code: '626', name: 'Régimen Simplificado de Confianza' },
]

const industries = [
  'Agricultura, Ganadería, Silvicultura y Pesca',
  'Minería',
  'Construcción',
  'Manufactura',
  'Electricidad, Agua y Gas',
  'Comercio',
  'Transporte y Almacenamiento',
  'Información en Medios Masivos',
  'Servicios Financieros y de Seguros',
  'Servicios Inmobiliarios',
  'Servicios Profesionales y Técnicos',
  'Servicios de Apoyo a los Negocios',
  'Servicios de Educación',
  'Servicios de Salud',
  'Servicios de Esparcimiento y Recreativos',
  'Servicios de Alimentación',
  'Servicios Personales',
  'Servicios de Organizaciones y Órganos Extraterritoriales',
]

interface UpdatedCompany {
  id: string
  name: string
  rfc: string
  businessName: string
  legalRepresentative: string | null
  taxRegime: string
  postalCode: string
  address: string | null
  city: string | null
  state: string | null
  country: string
  phone: string | null
  email: string | null
  website: string | null
  industry: string | null
  employeesCount: number | null
  incorporationDate: string | null
  status: string
}

interface CompanyRegistrationFormProps {
  mode?: 'create' | 'edit'
  initialData?: Partial<CompanyFormData> & { id?: string }
  onClose?: () => void
  onSaved?: (updated: UpdatedCompany) => void
}

export default function CompanyRegistrationForm({ mode = 'create', initialData, onClose, onSaved }: CompanyRegistrationFormProps) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    watch,
    reset,
  } = useForm<CompanyFormData>({
    resolver: zodResolver(companyFormSchema),
    defaultValues: {
      country: 'México',
    },
  })

  useEffect(() => {
    if (!initialData) return
    const defaults: Partial<CompanyFormData> = {
      name: initialData.name,
      rfc: initialData.rfc,
      businessName: initialData.businessName,
      legalRepresentative: initialData.legalRepresentative ?? undefined,
      taxRegime: initialData.taxRegime,
      postalCode: initialData.postalCode,
      address: initialData.address ?? undefined,
      city: initialData.city ?? undefined,
      state: initialData.state ?? undefined,
      country: initialData.country ?? 'México',
      phone: initialData.phone ?? undefined,
      email: initialData.email ?? undefined,
      website: initialData.website ?? undefined,
      industry: initialData.industry ?? undefined,
      employeesCount: initialData.employeesCount ?? undefined,
      incorporationDate: initialData.incorporationDate ? new Date(initialData.incorporationDate as string).toISOString().slice(0,10) : undefined,
      notes: initialData.notes ?? undefined
    }
    reset(defaults as CompanyFormData)
  }, [initialData, reset])

  const handleLogoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    if (!allowedTypes.includes(file.type)) {
      setError('Tipo de archivo no permitido. Use JPEG, PNG, GIF o WebP')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('El archivo es demasiado grande. Máximo 5MB')
      return
    }
    setLogoFile(file)
    const reader = new FileReader()
    reader.onloadend = () => setLogoPreview(reader.result as string)
    reader.readAsDataURL(file)
  }

  const removeLogo = () => {
    setLogoFile(null)
    setLogoPreview(null)
  }

  const onSubmit = async (data: CompanyFormData) => {
    // Process the data before validation
    const processedData = {
      ...data,
      // Convert date to ISO datetime format if it exists
      incorporationDate: data.incorporationDate ? new Date(data.incorporationDate).toISOString() : undefined
    }

    // First validate the data with Zod schema
    const validationResult = companyFormSchema.safeParse(processedData)
    if (!validationResult.success) {
      const errors: Record<string, string> = {}
      validationResult.error.issues.forEach(issue => {
        const field = issue.path.join('.')
        errors[field] = issue.message
      })
      setFieldErrors(errors)
      setError('Errores de validación en el formulario')
      console.log('Client-side validation errors:', validationResult.error.issues)
      return
    }
    setIsSubmitting(true)
    setError(null)
    setSuccess(null)
    setFieldErrors({})

    // Debug: Log the data being submitted
    console.log('Submitting company data:', data)

    try {
      const url = mode === 'edit' && initialData?.id ? `/api/companies/${initialData.id}` : '/api/companies/register'
      const method = mode === 'edit' ? 'PUT' : 'POST'
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(processedData),
      })

      const result = await response.json()
      console.log('Server response:', result)

      if (!response.ok) {
        // Handle validation errors from server
        if (result.details && Array.isArray(result.details)) {
          const errors: Record<string, string> = {}
          result.details.forEach((detail: { field: string; message: string }) => {
            errors[detail.field] = detail.message
          })
          setFieldErrors(errors)
          const fieldErrorsMessage = result.details.map((detail: { field: string; message: string }) => `${detail.field}: ${detail.message}`).join(', ')
          throw new Error(`Errores de validación: ${fieldErrorsMessage}`)
        }
        throw new Error(result.error || 'Error al registrar la empresa')
      }

      const savedCompanyId = (result?.company?.id as string) || initialData?.id

      // optional logo upload after save
      if (savedCompanyId && logoFile) {
        const formData = new FormData()
        formData.append('logo', logoFile)
        const logoRes = await fetch(`/api/companies/${savedCompanyId}/logo`, { method: 'POST', body: formData })
        if (!logoRes.ok) {
          console.error('Error subiendo logo de empresa', await logoRes.text())
        }
      }

      if (mode === 'edit') {
        setSuccess('Empresa actualizada exitosamente')
        if (onSaved && result && result.company) {
          onSaved(result.company as UpdatedCompany)
        }
        if (onClose) onClose()
      } else {
        if (onSaved && result && result.company) {
          onSaved(result.company as UpdatedCompany)
          if (onClose) onClose()
        } else {
          setSuccess('Empresa registrada exitosamente. Será revisada por el administrador.')
          reset()
          setTimeout(() => {
            router.push('/companies')
          }, 2000)
        }
      }

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Error al registrar la empresa'
      console.error('Registration error:', errorMessage)
      setError(errorMessage)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Registro de Empresa</CardTitle>
          <CardDescription>
            Complete el formulario para registrar una nueva empresa en el sistema.
            La información será revisada por el administrador antes de ser aprobada.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>
                  <div className="font-medium">Error al registrar la empresa:</div>
                  <div>{error}</div>
                  {Object.keys(fieldErrors).length > 0 && (
                    <div className="mt-2">
                      <div className="font-medium">Errores por campo:</div>
                      <ul className="list-disc pl-4 space-y-1">
                        {Object.entries(fieldErrors).map(([field, message]) => (
                          <li key={field} className="text-sm">
                            <span className="font-medium capitalize">{field}:</span> {message}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </AlertDescription>
              </Alert>
            )}
            
            {success && (
              <Alert>
                <AlertDescription>{success}</AlertDescription>
              </Alert>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="md:col-span-2">
                <Label>Logo de la Empresa</Label>
                <div className="mt-2">
                  {logoPreview ? (
                    <div className="relative">
                      <Image src={logoPreview} alt="Logo preview" width={400} height={128} className="w-full h-32 object-contain rounded-lg border" />
                      <Button type="button" variant="destructive" size="sm" className="absolute top-2 right-2" onClick={removeLogo}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                      <Upload className="mx-auto h-8 w-8 text-gray-400" />
                      <p className="mt-2 text-sm text-gray-600">Subir logo</p>
                    </div>
                  )}
                  <Input type="file" accept="image/*" onChange={handleLogoUpload} className="mt-2" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">Nombre de la Empresa *</Label>
                <Input
                  id="name"
                  {...register('name')}
                  placeholder="Nombre comercial de la empresa"
                  className={fieldErrors.name ? 'border-red-500' : ''}
                />
                {errors.name && (
                  <p className="text-sm text-red-500">{errors.name.message}</p>
                )}
                {fieldErrors.name && (
                  <p className="text-sm text-red-500">{fieldErrors.name}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="rfc">RFC *</Label>
                <RFCValidator
                  value={watch('rfc') || ''}
                  onChange={(value) => setValue('rfc', value)}
                  onValidation={(result) => {
                    if (!result.isValid) {
                      setError('El RFC ingresado no es válido')
                      setFieldErrors(prev => ({ ...prev, rfc: 'RFC inválido' }))
                    } else {
                      setError(null)
                      setFieldErrors(prev => ({ ...prev, rfc: '' }))
                    }
                  }}
                  className={fieldErrors.rfc ? 'border-red-500' : ''}
                />
                {errors.rfc && (
                  <p className="text-sm text-red-500">{errors.rfc.message}</p>
                )}
                {fieldErrors.rfc && (
                  <p className="text-sm text-red-500">{fieldErrors.rfc}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="businessName">Razón Social *</Label>
                <Input
                  id="businessName"
                  {...register('businessName')}
                  placeholder="Razón social o denominación"
                  className={fieldErrors.businessName ? 'border-red-500' : ''}
                />
                {errors.businessName && (
                  <p className="text-sm text-red-500">{errors.businessName.message}</p>
                )}
                {fieldErrors.businessName && (
                  <p className="text-sm text-red-500">{fieldErrors.businessName}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="legalRepresentative">Representante Legal</Label>
                <Input
                  id="legalRepresentative"
                  {...register('legalRepresentative')}
                  placeholder="Nombre del representante legal"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="taxRegime">Régimen Fiscal *</Label>
                <Select value={watch('taxRegime') || undefined} onValueChange={(value) => setValue('taxRegime', value)}>
                  <SelectTrigger className={fieldErrors.taxRegime ? 'border-red-500' : ''}>
                    <SelectValue placeholder="Seleccione régimen fiscal" />
                  </SelectTrigger>
                  <SelectContent 
                    className="max-h-[300px] overflow-y-auto w-full" 
                    position="popper" 
                    side="bottom" 
                    align="start"
                    sideOffset={4}
                  >
                    {taxRegimes.map((regime) => (
                      <SelectItem key={regime.code} value={regime.code} className="break-all text-sm">
                        {regime.code} - {regime.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.taxRegime && (
                  <p className="text-sm text-red-500">{errors.taxRegime.message}</p>
                )}
                {fieldErrors.taxRegime && (
                  <p className="text-sm text-red-500">{fieldErrors.taxRegime}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="postalCode">Código Postal *</Label>
                <Input
                  id="postalCode"
                  {...register('postalCode')}
                  placeholder="00000"
                  className={fieldErrors.postalCode ? 'border-red-500' : ''}
                />
                {errors.postalCode && (
                  <p className="text-sm text-red-500">{errors.postalCode.message}</p>
                )}
                {fieldErrors.postalCode && (
                  <p className="text-sm text-red-500">{fieldErrors.postalCode}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="address">Dirección</Label>
                <Input
                  id="address"
                  {...register('address')}
                  placeholder="Calle, número, colonia"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="city">Ciudad</Label>
                <Input
                  id="city"
                  {...register('city')}
                  placeholder="Ciudad"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="state">Estado</Label>
                <Input
                  id="state"
                  {...register('state')}
                  placeholder="Estado"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="country">País</Label>
                <Input
                  id="country"
                  {...register('country')}
                  placeholder="País"
                  defaultValue="México"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">Teléfono</Label>
                <Input
                  id="phone"
                  {...register('phone')}
                  placeholder="+52 (000) 000-0000"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  {...register('email')}
                  placeholder="contacto@empresa.com"
                />
                {errors.email && (
                  <p className="text-sm text-red-500">{errors.email.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="website">Sitio Web</Label>
                <Input
                  id="website"
                  {...register('website')}
                  placeholder="https://www.empresa.com"
                />
                {errors.website && (
                  <p className="text-sm text-red-500">{errors.website.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="industry">Industria</Label>
                <Select value={watch('industry') || undefined} onValueChange={(value) => setValue('industry', value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccione industria" />
                  </SelectTrigger>
                  <SelectContent>
                    {industries.map((industry) => (
                      <SelectItem key={industry} value={industry}>
                        {industry}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="employeesCount">Número de Empleados</Label>
                <Input
                  id="employeesCount"
                  type="number"
                  {...register('employeesCount', {
                    setValueAs: (value) => value === '' ? undefined : Number(value)
                  })}
                  placeholder="100"
                />
                {errors.employeesCount && (
                  <p className="text-sm text-red-500">{errors.employeesCount.message}</p>
                )}
              </div>

            <div className="space-y-2">
              <Label htmlFor="incorporationDate">Fecha de Constitución</Label>
              <Input
                id="incorporationDate"
                type="date"
                {...register('incorporationDate')}
                className={fieldErrors.incorporationDate ? 'border-red-500' : ''}
              />
              {fieldErrors.incorporationDate && (
                <p className="text-sm text-red-500">{fieldErrors.incorporationDate}</p>
              )}
            </div>

            <div className="md:col-span-2 space-y-2">
              <Label htmlFor="notes">Notas</Label>
              <Textarea
                id="notes"
                {...register('notes')}
                placeholder="Notas internas, consideraciones o comentarios"
                className="min-h-[90px]"
              />
            </div>
          </div>

            <div className="sticky bottom-0 bg-background flex justify-end gap-4 pt-3 mt-6 border-t">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (mode === 'edit') {
                    if (onClose) onClose()
                  } else {
                    router.push('/companies')
                  }
                }}
                disabled={isSubmitting}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (mode === 'edit' ? 'Guardando...' : 'Registrando...') : (mode === 'edit' ? 'Guardar cambios' : 'Registrar Empresa')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
