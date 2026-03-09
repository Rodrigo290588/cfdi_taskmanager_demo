"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Upload, FileKey, FileBadge, Lock, Loader2, Eye, EyeOff } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

const formSchema = z.object({
  rfc: z.string().min(1, "Selecciona un RFC"),
  privateKey: z.any()
    .refine((files) => files?.length === 1, "Sube el archivo .key")
    .refine((files) => files?.[0]?.name.endsWith(".key"), "El archivo debe ser .key"),
  certificate: z.any()
    .refine((files) => files?.length === 1, "Sube el archivo .cer")
    .refine((files) => files?.[0]?.name.endsWith(".cer"), "El archivo debe ser .cer"),
  password: z.string().min(1, "Ingresa la contraseña"),
})

interface Company {
  id: string
  rfc: string
  businessName: string
}

interface PrivateKeyFormProps {
  companies: Company[]
  organizationId?: string
}

export function PrivateKeyForm({ companies, organizationId }: PrivateKeyFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: async (data, context, options) => {
      try {
        return await zodResolver(formSchema)(data, context, options)
      } catch (error) {
        // Handle ZodError thrown by resolver (likely due to version mismatch)
        type ValidationIssue = {
          path: (string | number)[]
          message: string
          code?: string
        }

        const knownError = error as { issues?: ValidationIssue[] } | ValidationIssue[]
        const issues = 'issues' in knownError && Array.isArray(knownError.issues) 
          ? knownError.issues 
          : (Array.isArray(knownError) ? (knownError as ValidationIssue[]) : null)
        
        if (issues) {
          const errors = issues.reduce<Record<string, { type: string; message: string }>>((acc, issue) => {
            const path = issue.path[0]
            if (path && !acc[path.toString()]) {
              acc[path.toString()] = {
                type: issue.code || 'validation',
                message: issue.message
              }
            }
            return acc
          }, {})
          
          return {
            values: {},
            errors
          }
        }
        throw error
      }
    },
    defaultValues: {
      rfc: "",
      password: "",
    },
  })

  // Helper to handle file input changes
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, fieldName: "privateKey" | "certificate") => {
    const file = e.target.files?.[0]
    if (file) {
      // Manual validation to avoid triggering global schema validation
      if (fieldName === "privateKey" && !file.name.endsWith(".key")) {
        toast.error("El archivo debe tener extensión .key")
        e.target.value = "" // Reset input
        return
      }
      if (fieldName === "certificate" && !file.name.endsWith(".cer")) {
        toast.error("El archivo debe tener extensión .cer")
        e.target.value = "" // Reset input
        return
      }
      
      form.setValue(fieldName, e.target.files)
      form.clearErrors(fieldName)
    }
  }

  async function onSubmit(values: z.infer<typeof formSchema>) {
    if (!organizationId) {
      toast.error("Error: No se identificó la organización")
      return
    }

    setIsSubmitting(true)
    
    try {
      const formData = new FormData()
      formData.append("rfc", values.rfc)
      formData.append("password", values.password)
      formData.append("privateKey", values.privateKey[0])
      formData.append("certificate", values.certificate[0])
      formData.append("organizationId", organizationId)

      const response = await fetch("/api/mass-downloads/credentials", {
        method: "POST",
        body: formData,
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || "Error al guardar la configuración")
      }

      toast.success("Configuración guardada exitosamente")
      form.reset()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Ocurrió un error al guardar la configuración"
      toast.error(errorMessage)
    } finally {
      setIsSubmitting(false)
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onError = (errors: any) => {
    const missingFields: string[] = []
    
    if (errors.privateKey) missingFields.push("su key")
    if (errors.certificate) missingFields.push("su certificado")
    if (errors.password) missingFields.push("su contraseña")
    
    if (missingFields.length > 0) {
      const last = missingFields.pop()
      const message = missingFields.length > 0 
        ? `Favor de cargar ${missingFields.join(", ")} y ${last}` 
        : `Favor de cargar ${last}`
      
      toast.error(message)
    } else if (errors.rfc) {
      toast.error(errors.rfc.message)
    }
  }

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="text-xl font-semibold">Configuración de Llaves Privadas</CardTitle>
        <CardDescription>
          Ingresa los archivos de la FIEL (.key y .cer) y la contraseña para habilitar las descargas masivas.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit, onError)} className="space-y-6">
            
            <FormField
              control={form.control}
              name="rfc"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>RFC</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecciona una empresa" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {companies.map((company) => (
                        <SelectItem key={company.id} value={company.rfc}>
                          {company.rfc} - {company.businessName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField
                control={form.control}
                name="privateKey"
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                render={({ field: { value, onChange: _onChange, ...field } }) => (
                  <FormItem>
                    <FormLabel>Carga de llave privada (.key)</FormLabel>
                    <FormControl>
                      <div className="relative group cursor-pointer">
                        <div className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg hover:bg-muted/50 transition-colors">
                          {value?.[0] ? (
                            <div className="flex flex-col items-center text-green-600 dark:text-green-400">
                              <FileKey className="w-8 h-8 mb-2" />
                              <span className="text-sm font-medium truncate max-w-[200px]">{value[0].name}</span>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center text-muted-foreground">
                              <Upload className="w-8 h-8 mb-2" />
                              <span className="text-sm">Seleccionar archivo .key</span>
                            </div>
                          )}
                          <Input 
                            type="file" 
                            accept=".key"
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            onChange={(e) => handleFileChange(e, "privateKey")}
                            name={field.name}
                            onBlur={field.onBlur}
                            ref={field.ref}
                          />
                        </div>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="certificate"
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                render={({ field: { value, onChange: _onChange, ...field } }) => (
                  <FormItem>
                    <FormLabel>Certificado (.cer)</FormLabel>
                    <FormControl>
                      <div className="relative group cursor-pointer">
                        <div className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg hover:bg-muted/50 transition-colors">
                          {value?.[0] ? (
                            <div className="flex flex-col items-center text-green-600 dark:text-green-400">
                              <FileBadge className="w-8 h-8 mb-2" />
                              <span className="text-sm font-medium truncate max-w-[200px]">{value[0].name}</span>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center text-muted-foreground">
                              <Upload className="w-8 h-8 mb-2" />
                              <span className="text-sm">Seleccionar archivo .cer</span>
                            </div>
                          )}
                          <Input 
                            type="file" 
                            accept=".cer"
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                            onChange={(e) => handleFileChange(e, "certificate")}
                            name={field.name}
                            onBlur={field.onBlur}
                            ref={field.ref}
                          />
                        </div>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Contraseña</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input 
                        type={showPassword ? "text" : "password"}
                        placeholder="••••••••" 
                        className="pl-10 pr-10" 
                        {...field} 
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent z-10"
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Eye className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="sr-only">
                          {showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                        </span>
                      </Button>
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button 
              type="submit" 
              className="w-full"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Guardando...
                </>
              ) : (
                "Guardar Configuración"
              )}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
