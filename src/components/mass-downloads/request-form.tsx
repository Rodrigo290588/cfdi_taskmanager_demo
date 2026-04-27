'use client'

import { useState, useEffect } from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'

const COMPLEMENT_OPTIONS = [
  { value: 'null', label: 'Todos (Sin filtro)' },
  { value: 'acreditamientoieps10', label: 'Acreditamiento IEPS 1.0' },
  { value: 'aerolineas', label: 'Aerolíneas' },
  { value: 'certificadodedestruccion', label: 'Certificado de Destrucción' },
  { value: 'cfdiregistrofiscal', label: 'CFDI Registro Fiscal' },
  { value: 'comercioexterior10', label: 'Comercio Exterior 1.0' },
  { value: 'comercioexterior11', label: 'Comercio Exterior 1.1' },
  { value: 'comprobante', label: 'Comprobante' },
  { value: 'consumodecombustibles', label: 'Consumo de Combustibles' },
  { value: 'consumodecombustibles11', label: 'Consumo de Combustibles 1.1' },
  { value: 'detallista', label: 'Detallista' },
  { value: 'divisas', label: 'Divisas' },
  { value: 'donat11', label: 'Donatarias 1.1' },
  { value: 'ecc11', label: 'Estado de Cuenta de Combustibles 1.1' },
  { value: 'ecc12', label: 'Estado de Cuenta de Combustibles 1.2' },
  { value: 'gastoshidrocarburos10', label: 'Gastos Hidrocarburos 1.0' },
  { value: 'iedu', label: 'IEDU' },
  { value: 'implocal', label: 'Impuestos Locales' },
  { value: 'ine11', label: 'INE 1.1' },
  { value: 'ingresoshidrocarburos', label: 'Ingresos Hidrocarburos' },
  { value: 'leyendasfisc', label: 'Leyendas Fiscales' },
  { value: 'nomina11', label: 'Nómina 1.1' },
  { value: 'nomina12', label: 'Nómina 1.2' },
  { value: 'notariospublicos', label: 'Notarios Públicos' },
  { value: 'obrasarteantiguedades', label: 'Obras de Arte y Antigüedades' },
  { value: 'pagoenespecie', label: 'Pago en Especie' },
  { value: 'pagos10', label: 'Pagos 1.0' },
  { value: 'pfic', label: 'PFIC' },
  { value: 'renovacionysustitucionvehiculos', label: 'Renovación y Sustitución de Vehículos' },
  { value: 'servicioparcialconstruccion', label: 'Servicios Parciales de Construcción' },
  { value: 'spei', label: 'SPEI' },
  { value: 'terceros11', label: 'Terceros 1.1' },
  { value: 'turistapasajeroextranjero', label: 'Turista Pasajero Extranjero' },
  { value: 'valesdedespensa', label: 'Vales de Despensa' },
  { value: 'vehiculousado', label: 'Vehículo Usado' },
  { value: 'ventavehiculos11', label: 'Venta de Vehículos 1.1' },
]

const massDownloadRequestSchema = z.object({
  startDate: z.string().optional().refine((val) => {
    if (!val) return true;
    const date = new Date(val);
    return date.getFullYear() >= 2011;
  }, 'La fecha debe ser a partir del año 2011'),
  endDate: z.string().optional().refine((val) => {
    if (!val) return true;
    const date = new Date(val);
    return date.getFullYear() >= 2011;
  }, 'La fecha debe ser a partir del año 2011'),
  receiverRfc: z.string().optional(), // Can be multiple, handled as string
  issuerRfc: z.string().optional(),
  requestingRfc: z.string().optional(),
  retrievalType: z.enum(['emitidos', 'recibidos', 'folio']).default('emitidos'),
  requestType: z.enum(['metadata', 'cfdi']),
  voucherType: z.enum(['I', 'E', 'P', 'T', 'N']).optional(),
  status: z.enum(['Todos', 'Cancelado', 'Vigente']).default('Todos'),
  thirdPartyRfc: z.string().optional(),
  complement: z.string().default('null'),
  companyId: z.string().min(1, 'La empresa es requerida'),
  folio: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.retrievalType === 'emitidos') {
    if (!data.startDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'La fecha inicial es requerida', path: ['startDate'] })
    }
    if (!data.endDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'La fecha final es requerida', path: ['endDate'] })
    }
    if (!data.issuerRfc) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'El RFC Emisor es requerido',
        path: ['issuerRfc'],
      })
    }
  }
  if (data.retrievalType === 'recibidos') {
    if (!data.startDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'La fecha inicial es requerida', path: ['startDate'] })
    }
    if (!data.endDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'La fecha final es requerida', path: ['endDate'] })
    }
    if (!data.receiverRfc) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'El RFC Receptor es requerido',
        path: ['receiverRfc'],
      })
    }
  }
  if (data.retrievalType === 'folio') {
    if (!data.folio) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'El Folio es requerido',
        path: ['folio'],
      })
    } else if (!/^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/i.test(data.folio)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'El folio debe tener un formato UUID válido',
        path: ['folio'],
      })
    }
  }
})

type MassDownloadRequestValues = z.infer<typeof massDownloadRequestSchema>

const formatUuid = (value: string) => {
  const cleaned = value.replace(/[^a-fA-F0-9]/g, '')
  const g1 = cleaned.substring(0, 8)
  const g2 = cleaned.substring(8, 12)
  const g3 = cleaned.substring(12, 16)
  const g4 = cleaned.substring(16, 20)
  const g5 = cleaned.substring(20, 32)
  
  let result = g1
  if (g2) result += '-' + g2
  if (g3) result += '-' + g3
  if (g4) result += '-' + g4
  if (g5) result += '-' + g5
  
  return result
}

export function MassDownloadRequestForm() {
  const [isSubmitting, setIsSubmitting] = useState(false)

  const form = useForm<MassDownloadRequestValues>({
    resolver: zodResolver(massDownloadRequestSchema),
    defaultValues: {
      startDate: '',
      endDate: '',
      receiverRfc: '',
      issuerRfc: '',
      requestingRfc: '',
      requestType: 'metadata',
      status: 'Todos',
      thirdPartyRfc: '',
      complement: 'null',
      companyId: '',
      folio: '',
    },
  })

  const { watch } = form
  const retrievalType = watch('retrievalType')
  const isFolio = retrievalType === 'folio'

  useEffect(() => {
    const updateCompany = () => {
      try {
        const stored = localStorage.getItem('selectedCompany')
        if (stored) {
          const company = JSON.parse(stored)
          if (company?.id) {
            form.setValue('companyId', company.id)
          }
          
          if (company?.rfc) {
            // Always set requesting RFC
            form.setValue('requestingRfc', company.rfc)

            // Dynamic assignment based on retrieval type
            if (retrievalType === 'emitidos') {
              form.setValue('issuerRfc', company.rfc)
              // Ensure receiverRfc is not the company RFC if we switched
              const currentReceiver = form.getValues('receiverRfc')
              if (currentReceiver === company.rfc) {
                form.setValue('receiverRfc', '')
              }
            } else if (retrievalType === 'recibidos') {
              form.setValue('receiverRfc', company.rfc)
              // Ensure issuerRfc is not the company RFC if we switched
              const currentIssuer = form.getValues('issuerRfc')
              if (currentIssuer === company.rfc) {
                form.setValue('issuerRfc', '')
              }
            } else {
              // Folio
            }
          }
        }
      } catch (e) {
        console.error('Failed to parse selected company', e)
      }
    }

    updateCompany()
    
    const handleCompanyChange = () => updateCompany()
    window.addEventListener('company-selected', handleCompanyChange)
    
    return () => {
      window.removeEventListener('company-selected', handleCompanyChange)
    }
  }, [form, retrievalType])

    async function onSubmit(data: MassDownloadRequestValues) {
    // Default requestingRfc to issuerRfc if not provided
    const payload = {
      ...data,
      requestingRfc: data.requestingRfc || data.issuerRfc || ''
    }

    setIsSubmitting(true)
    try {
      const response = await fetch('/api/mass-downloads/requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      let result
      try {
        result = await response.json()
      } catch {
        // Ignore JSON parse error
      }

      if (!response.ok) {
        // Priorizar el mensaje de 'details' que contiene la descripción específica del SAT
        throw new Error(result?.details || result?.error || 'Error al enviar la solicitud')
      }

      if (Array.isArray(result) && result.length > 0) {
        const ids = result.map((r: { id: string }) => r.id).join(', ')
        const satIds = result
          .map((r: { satPackageId?: string }) => r.satPackageId)
          .filter(Boolean)
          .join(', ')

        let message = `Solicitud registrada correctamente. ID(s) Interno(s): ${ids}.`
        if (satIds) {
          message += ` ID(s) Paquete SAT: ${satIds}.`
        }
        message += ' El proceso de solicitud al SAT se ha iniciado en segundo plano.'

        toast.success(message, {
          duration: 10000,
        })
      } else if (result && result.satToken) {
        toast.success(`Solicitud enviada. Token SAT: ${result.satToken}`, {
          duration: 10000,
        })
      } else {
        toast.success('Solicitud enviada correctamente. Procesando en segundo plano...')
      }

      form.reset()
      // Restore company info after reset
      const stored = localStorage.getItem('selectedCompany')
      if (stored) {
        const company = JSON.parse(stored)
        if (company?.id) form.setValue('companyId', company.id)
        if (company?.rfc) {
          form.setValue('issuerRfc', company.rfc)
          form.setValue('requestingRfc', company.rfc)
        }
      }
    } catch (error) {
      console.error(error)
      toast.error(error instanceof Error ? error.message : 'Error al enviar la solicitud', {
        duration: 10000,
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nueva Solicitud de Descarga</CardTitle>
        <CardDescription>
          Completa el formulario para solicitar una descarga masiva de CFDI al SAT.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <FormField
                control={form.control}
                name="requestingRfc"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>RFC Solicitante (Empresa Seleccionada)</FormLabel>
                    <FormControl>
                      <Input {...field} disabled readOnly className="bg-muted" />
                    </FormControl>
                    <FormDescription>
                      Este es el RFC con el que se firmará la solicitud (FIEL requerida).
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="retrievalType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo de Solicitud</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccione tipo" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="emitidos">Emitidos</SelectItem>
                        <SelectItem value="recibidos">Recibidos</SelectItem>
                        <SelectItem value="folio">Por Folio</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {!isFolio && (
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="startDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Fecha Inicial de Emisión *</FormLabel>
                      <FormControl>
                        <Input type="date" min="2011-01-01" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="endDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Fecha Final de Emisión *</FormLabel>
                      <FormControl>
                        <Input type="date" min="2011-01-01" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              {isFolio ? (
                <FormField
                  control={form.control}
                  name="folio"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Folio UUID *</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" 
                          {...field} 
                          onChange={(e) => {
                            const formatted = formatUuid(e.target.value)
                            field.onChange(formatted)
                          }}
                          maxLength={36}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : retrievalType === 'emitidos' ? (
                <FormField
                  control={form.control}
                  name="issuerRfc"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>RFC Emisor (Yo)</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="RFC del emisor" 
                          {...field} 
                          disabled
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : (
                <FormField
                  control={form.control}
                  name="receiverRfc"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>RFC Receptor (Yo)</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="RFC del receptor" 
                          {...field} 
                          disabled
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>

            {!isFolio && (
              retrievalType === 'emitidos' ? (
                <FormField
                  control={form.control}
                  name="receiverRfc"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>RFC Receptor (Filtro Opcional)</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="Ingrese los RFCs separados por comas o saltos de línea"
                          className="resize-none"
                          {...field} 
                        />
                      </FormControl>
                      <FormDescription>
                        Puede capturar N cantidad de RFCs para filtrar.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : (
                <FormField
                  control={form.control}
                  name="issuerRfc"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>RFC Emisor (Filtro Opcional)</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="Ingrese los RFCs separados por comas o saltos de línea"
                          className="resize-none"
                          {...field} 
                        />
                      </FormControl>
                      <FormDescription>
                        Puede capturar N cantidad de RFCs para filtrar.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )
            )}

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <FormField
                control={form.control}
                name="requestType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo de Archivo</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccione tipo" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="metadata">Metadata</SelectItem>
                        <SelectItem value="cfdi">CFDI</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="voucherType"
                render={({ field }) => (
                  <FormItem className={isFolio ? 'hidden' : ''}>
                    <FormLabel>Tipo de Comprobante</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccione tipo" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="I">I - Ingreso</SelectItem>
                        <SelectItem value="E">E - Egreso</SelectItem>
                        <SelectItem value="P">P - Pago</SelectItem>
                        <SelectItem value="T">T - Traslado</SelectItem>
                        <SelectItem value="N">N - Nómina</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem className={isFolio ? 'hidden' : ''}>
                    <FormLabel>Estado del Comprobante</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccione estado" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Todos">Todos</SelectItem>
                        <SelectItem value="Vigente">Vigente</SelectItem>
                        <SelectItem value="Cancelado">Cancelado</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className={`grid grid-cols-1 gap-6 md:grid-cols-2 ${isFolio ? 'hidden' : ''}`}>
              <FormField
                control={form.control}
                name="thirdPartyRfc"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>RFC A Cuenta De Terceros</FormLabel>
                    <FormControl>
                      <Input placeholder="RFC a cuenta de terceros" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="complement"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Complemento</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccione complemento" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent side="bottom" align="start" className="max-h-[300px]">
                        {COMPLEMENT_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Enviando...' : 'Enviar Solicitud'}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
