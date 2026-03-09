'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, Upload, X, Building2, MapPin, Phone, Mail, Globe, Calendar, Users, Tag } from 'lucide-react'
import Image from 'next/image'
import { toast } from 'sonner'
import { RegisteredCompaniesTable } from './registered-companies-table'
import { useRouter } from 'next/navigation'

// Validation schema for tenant registration
const tenantFormSchema = z.object({
  name: z.string().min(3, 'El nombre debe tener al menos 3 caracteres').max(100),
  description: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  postalCode: z.string().optional().nullable(),
  country: z.string().optional().nullable().default('México'),
  phone: z.string().optional().nullable(),
  contactEmail: z.preprocess((val) => {
    if (typeof val === 'string') {
      const trimmed = val.trim()
      return trimmed === '' ? undefined : trimmed
    }
    return val
  }, z.string().email({ message: 'Email inválido' }).optional().nullable()),
  businessDescription: z.string().optional().nullable(),
  website: z.string().url('URL inválida').optional().nullable(),
  industry: z.string().optional().nullable(),
  companySize: z.string().optional().nullable(),
  foundedYear: z.number().int().min(1800).max(new Date().getFullYear()).optional().nullable(),
  taxId: z.string().optional().nullable(),
  businessType: z.string().optional().nullable(),
})

export type TenantFormData = z.infer<typeof tenantFormSchema>

const INDUSTRIES = [
  'Tecnología',
  'Manufactura',
  'Servicios',
  'Comercio',
  'Construcción',
  'Salud',
  'Educación',
  'Finanzas',
  'Alimentos y Bebidas',
  'Transporte',
  'Inmobiliaria',
  'Consultoría',
  'Otro'
]

const COMPANY_SIZES = [
  '1-10 empleados',
  '11-50 empleados',
  '51-200 empleados',
  '201-500 empleados',
  '501-1000 empleados',
  'Más de 1000 empleados'
]

const BUSINESS_TYPES = [
  'Sociedad Anónima',
  'Sociedad de Responsabilidad Limitada',
  'Sociedad Civil',
  'Persona Física',
  'Cooperativa',
  'Otro'
]

const MEXICAN_STATES = [
  'Aguascalientes', 'Baja California', 'Baja California Sur', 'Campeche',
  'Chiapas', 'Chihuahua', 'Coahuila', 'Colima', 'Durango', 'Guanajuato',
  'Guerrero', 'Hidalgo', 'Jalisco', 'Estado de México', 'Michoacán',
  'Morelos', 'Nayarit', 'Nuevo León', 'Oaxaca', 'Puebla', 'Querétaro',
  'Quintana Roo', 'San Luis Potosí', 'Sinaloa', 'Sonora', 'Tabasco',
  'Tamaulipas', 'Tlaxcala', 'Veracruz', 'Yucatán', 'Zacatecas', 'CDMX'
]

interface TenantRegistrationFormProps {
  onSuccess?: (data: TenantFormData) => void
  onCancel?: () => void
  initialData?: Partial<TenantFormData>
  isEditing?: boolean
}

export function TenantRegistrationForm({ 
  onSuccess, 
  onCancel, 
  initialData, 
  isEditing = false 
}: TenantRegistrationFormProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attemptedSubmit, setAttemptedSubmit] = useState(false)
  const router = useRouter()

  const {
    register,
    handleSubmit,
    formState: { errors, isValid, isSubmitted },
    setValue,
    trigger,
    watch
  } = useForm<TenantFormData>({
    resolver: zodResolver(tenantFormSchema),
    defaultValues: initialData || {
      country: 'México'
    },
    mode: 'onSubmit',
    reValidateMode: 'onBlur'
  })

  const handleLogoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      // Validate file type
      const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
      if (!allowedTypes.includes(file.type)) {
        setError('Tipo de archivo no permitido. Use JPEG, PNG, GIF o WebP')
        return
      }

      // Validate file size (max 5MB)
      const maxSize = 5 * 1024 * 1024 // 5MB
      if (file.size > maxSize) {
        setError('El archivo es demasiado grande. Máximo 5MB')
        return
      }

      setLogoFile(file)
      const reader = new FileReader()
      reader.onloadend = () => {
        setLogoPreview(reader.result as string)
      }
      reader.readAsDataURL(file)
      setError(null)
    }
  }

  const removeLogo = () => {
    setLogoFile(null)
    setLogoPreview(null)
  }

  const handleViewCompanyDetails = (companyId: string) => {
    router.push(`/companies/${companyId}`)
  }

  const onSubmit = async (data: TenantFormData) => {
    setIsLoading(true)
    setError(null)

    try {
      // The data is already validated by react-hook-form with zodResolver
      // No need to validate again, just submit
      
      // Submit tenant data
      const response = await fetch('/api/tenant', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Error al guardar la información')
      }

      const result = await response.json()
      
      // Upload logo if provided
      if (logoFile) {
        const formData = new FormData()
        formData.append('logo', logoFile)
        
        const logoResponse = await fetch('/api/tenant/logo', {
          method: 'POST',
          body: formData,
        })
        
        if (!logoResponse.ok) {
          console.error('Error uploading logo:', await logoResponse.json())
        }
      }

      onSuccess?.(result.tenant)
      
    } catch (error) {
      let errorMessage = 'Error desconocido'
      
      if (error instanceof z.ZodError) {
        // Handle Zod validation errors
        errorMessage = error.issues.map(issue => issue.message).join(', ')
      } else if (error instanceof Error) {
        errorMessage = error.message
      }
      
      setError(errorMessage)
      toast.error(errorMessage)
    } finally {
      setIsLoading(false)
    }
  }

  // Enhanced form submission handler
  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setAttemptedSubmit(true)
    
    // Trigger validation manually to show all errors
    const isValid = await trigger()
    
    if (!isValid) {
      // Scroll to first error
      const firstError = document.querySelector('.border-red-500')
      if (firstError) {
        firstError.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
      
      // Show validation summary
      const errorMessages = Object.values(errors).map(err => err?.message).filter(Boolean)
      if (errorMessages.length > 0) {
        const summary = errorMessages.join(', ')
        setError(summary)
        toast.error('Por favor corrija los errores en el formulario')
      }
      return
    }
    
    // If validation passes, proceed with normal submission
    handleSubmit(onSubmit)(e)
  }

  return (
    <div className="space-y-8">
      {/* Registration Form */}
      <Card className="w-full max-w-4xl mx-auto">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            {isEditing ? 'Editar Información del Tenant' : 'Registrar Información del Tenant'}
          </CardTitle>
          <CardDescription>
            Complete la información detallada de su organización. Solo el nombre es obligatorio.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleFormSubmit} className="space-y-6">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>
                  <div className="font-medium">Error de validación:</div>
                  <div>{error}</div>
                </AlertDescription>
              </Alert>
            )}
            
            {/* Validation Errors Summary */}
            {isSubmitted && Object.keys(errors).length > 0 && (
              <Alert variant="destructive">
                <AlertDescription>
                  <div className="font-medium mb-2">Por favor corrija los siguientes errores:</div>
                  <ul className="list-disc pl-4 space-y-1">
                    {Object.entries(errors).map(([field, error]) => (
                      <li key={field} className="text-sm">
                        <span className="font-medium capitalize">{field}:</span> {error?.message}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {/* Logo Upload Section */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="md:col-span-1">
                <Label>Logo de la Empresa</Label>
                <div className="mt-2">
                  {logoPreview ? (
                    <div className="relative">
                      <Image
                        src={logoPreview}
                        alt="Logo preview"
                        width={400}
                        height={128}
                        className="w-full h-32 object-contain rounded-lg border"
                      />
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        className="absolute top-2 right-2"
                        onClick={removeLogo}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                      <Upload className="mx-auto h-8 w-8 text-gray-400" />
                      <p className="mt-2 text-sm text-gray-600">Subir logo</p>
                    </div>
                  )}
                  <Input
                    type="file"
                    accept="image/*"
                    onChange={handleLogoUpload}
                    className="mt-2"
                  />
                </div>
              </div>

              {/* Basic Information */}
              <div className="md:col-span-2 space-y-4">
                <div>
                  <Label htmlFor="name">
                    Nombre del Tenant <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="name"
                    {...register('name')}
                    placeholder="Ej: Corporativo BIMBO"
                    className={attemptedSubmit && errors.name ? 'border-red-500 focus:ring-red-500' : ''}
                  />
                  {attemptedSubmit && errors.name && (
                    <div className="flex items-center mt-1">
                      <p className="text-red-500 text-sm flex-1">{errors.name.message}</p>
                      <span className="text-red-500 text-xs bg-red-50 px-2 py-1 rounded">Requerido</span>
                    </div>
                  )}
                </div>

                <div>
                  <Label htmlFor="description">Descripción Breve</Label>
                  <Textarea
                    id="description"
                    {...register('description')}
                    placeholder="Breve descripción de la organización"
                    rows={3}
                  />
                </div>

                <div>
                  <Label htmlFor="businessDescription">Descripción del Negocio</Label>
                  <Textarea
                    id="businessDescription"
                    {...register('businessDescription')}
                    placeholder="Describa a detalle el giro y actividades principales del negocio"
                    rows={4}
                  />
                </div>
              </div>
            </div>

            {/* Contact Information */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <Label className="flex items-center gap-2">
                  <Phone className="h-4 w-4" />
                  Teléfono de Contacto
                </Label>
                <Input
                  {...register('phone')}
                  placeholder="+52 55 1234 5678"
                />
              </div>

              <div>
                <Label className="flex items-center gap-2">
                  <Mail className="h-4 w-4" />
                  Email de Contacto
                </Label>
                <Input
                  type="email"
                  {...register('contactEmail')}
                  placeholder="contacto@empresa.com"
                  className={attemptedSubmit && errors.contactEmail ? 'border-red-500' : ''}
                />
                {attemptedSubmit && errors.contactEmail && (
                  <p className="text-red-500 text-sm mt-1">{errors.contactEmail.message}</p>
                )}
              </div>
            </div>

            {/* Website and Industry */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <Label className="flex items-center gap-2">
                  <Globe className="h-4 w-4" />
                  Sitio Web
                </Label>
                <Input
                  type="url"
                  {...register('website')}
                  placeholder="https://www.empresa.com"
                  className={attemptedSubmit && errors.website ? 'border-red-500' : ''}
                />
                {attemptedSubmit && errors.website && (
                  <p className="text-red-500 text-sm mt-1">{errors.website.message}</p>
                )}
              </div>

              <div>
                <Label className="flex items-center gap-2">
                  <Tag className="h-4 w-4" />
                  Industria
                </Label>
                <Select value={watch('industry') || undefined} onValueChange={(value) => setValue('industry', value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccione una industria" />
                  </SelectTrigger>
                  <SelectContent>
                    {INDUSTRIES.map((industry) => (
                      <SelectItem key={industry} value={industry}>
                        {industry}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Company Details */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <Label className="flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Tamaño de la Empresa
                </Label>
                <Select value={watch('companySize') || undefined} onValueChange={(value) => setValue('companySize', value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccione tamaño" />
                  </SelectTrigger>
                  <SelectContent>
                    {COMPANY_SIZES.map((size) => (
                      <SelectItem key={size} value={size}>
                        {size}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Año de Fundación
                </Label>
                <Input
                  type="number"
                  {...register('foundedYear', { valueAsNumber: true })}
                  placeholder="2024"
                  min={1800}
                  max={new Date().getFullYear()}
                  className={attemptedSubmit && errors.foundedYear ? 'border-red-500' : ''}
                />
                {attemptedSubmit && errors.foundedYear && (
                  <p className="text-red-500 text-sm mt-1">{errors.foundedYear.message}</p>
                )}
              </div>

              <div>
                <Label>Tipo de Negocio</Label>
                <Select value={watch('businessType') || undefined} onValueChange={(value) => setValue('businessType', value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccione tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    {BUSINESS_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Address Information */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <MapPin className="h-5 w-5 text-gray-600" />
                <h3 className="text-lg font-medium">Ubicación</h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Dirección Completa</Label>
                  <Input
                    {...register('address')}
                    placeholder="Calle, número, colonia"
                  />
                </div>

                <div>
                  <Label>Ciudad</Label>
                  <Input
                    {...register('city')}
                    placeholder="Ciudad de México"
                  />
                </div>

                <div>
                  <Label>Estado</Label>
                  <Select value={watch('state') || undefined} onValueChange={(value) => setValue('state', value)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Seleccione un estado" />
                    </SelectTrigger>
                    <SelectContent>
                      {MEXICAN_STATES.map((state) => (
                        <SelectItem key={state} value={state}>
                          {state}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Código Postal</Label>
                  <Input
                    {...register('postalCode')}
                    placeholder="01234"
                  />
                </div>

                <div>
                  <Label>País</Label>
                  <Input
                    {...register('country')}
                    defaultValue="México"
                    placeholder="México"
                  />
                </div>

                <div>
                  <Label>ID Fiscal (RFC)</Label>
                  <Input
                    {...register('taxId')}
                    placeholder="RFC de la empresa (opcional)"
                  />
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex justify-end gap-4 pt-6">
              <Button
                type="button"
                variant="outline"
                onClick={onCancel}
                disabled={isLoading}
              >
                Cancelar
              </Button>
              <Button 
                type="submit" 
                disabled={isLoading}
                className={attemptedSubmit && !isValid ? 'border-red-500' : ''}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {isEditing ? 'Actualizando...' : 'Guardando...'}
                  </>
                ) : (
                  isEditing ? 'Actualizar Información' : 'Registrar Tenant'
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Registered Companies Table */}
      <RegisteredCompaniesTable onViewDetails={handleViewCompanyDetails} />
    </div>
  )
}
