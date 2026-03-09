'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
 
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { showSuccess, showError } from '@/lib/toast'
import { Loader2, Settings, CheckCircle2, AlertTriangle, RefreshCw, Copy, Eye, EyeOff } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

interface TenantData {
  id: string
  name: string
  slug: string
  logo?: string | null
  operationalAccessEnabled?: boolean
  systemSettings?: {
    theme?: 'light' | 'dark' | 'system'
    smtp?: {
      host?: string
      port?: number
      secure?: boolean
      user?: string
      pass?: string
      fromEmail?: string
      fromName?: string
    }
    notifications?: {
      emailEnabled?: boolean
      alertsEnabled?: boolean
      auditEnabled?: boolean
    }
    preferences?: {
      locale?: string
      timezone?: string
      sessionTimeoutMinutes?: number
      currency?: string
      fontStyle?: 'system' | 'serif' | 'mono'
    }
  }
}

interface TenantStatus {
  hasOperationalAccess: boolean
  status: {
    setupProgress: number
  }
}

export default function SettingsPage() {
  const [tenant, setTenant] = useState<TenantData | null>(null)
  const [status, setStatus] = useState<TenantStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [configTab, setConfigTab] = useState<string>('smtp')
  const [apiKey, setApiKey] = useState<string | null>(null)
  const [showKey, setShowKey] = useState(false)
  const [keyLoading, setKeyLoading] = useState(false)
  const [keyRotating, setKeyRotating] = useState(false)

  useEffect(() => {
    fetchData()
  }, [])

  useEffect(() => {
    if (configTab === 'webservice' && !apiKey) {
      fetchApiKey()
    }
  }, [configTab, apiKey])

  const fetchApiKey = async () => {
    try {
      setKeyLoading(true)
      const res = await fetch('/api/tenant/api-key')
      if (res.ok) {
        const data = await res.json()
        setApiKey(data.key)
      }
    } catch (error) {
      console.error('Error fetching API key:', error)
    } finally {
      setKeyLoading(false)
    }
  }

  const rotateApiKey = async () => {
    toast('¿Estás seguro?', {
      description: 'La clave anterior dejará de funcionar inmediatamente.',
      action: {
        label: 'Confirmar',
        onClick: async () => {
          try {
            setKeyRotating(true)
            const res = await fetch('/api/tenant/api-key', { method: 'POST' })
            if (res.ok) {
              const data = await res.json()
              setApiKey(data.key)
              showSuccess('API Key actualizada', 'La nueva clave ha sido generada')
            } else {
              throw new Error('Error al rotar clave')
            }
          } catch {
            showError('Error', 'No se pudo rotar la API Key')
          } finally {
            setKeyRotating(false)
          }
        },
      },
      cancel: {
        label: 'Cancelar',
        onClick: () => {},
      },
    })
  }

  useEffect(() => {
    try {
      const url = new URL(window.location.href)
      const t = url.searchParams.get('tab') || (window.location.hash ? window.location.hash.replace('#', '') : null)
      if (t) {
        const configTabs = ['smtp', 'notifications', 'operational', 'webservice', 'smtp-test']
        if (configTabs.includes(t)) setConfigTab(t)
      }
    } catch {}
  }, [])

  const fetchData = async () => {
    try {
      setLoading(true)
      const [tenantRes, statusRes] = await Promise.all([
        fetch('/api/tenant'),
        fetch('/api/tenant/status')
      ])
      const tenantData = await tenantRes.json()
      const statusData = await statusRes.json()
      if (tenantRes.ok) setTenant(tenantData.tenant)
      if (statusRes.ok) setStatus({ hasOperationalAccess: statusData.tenant.hasOperationalAccess, status: { setupProgress: statusData.tenant.status.setupProgress } })
    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  const updateTenant = async () => {
    if (!tenant) return
    try {
      setSaving(true)
      const res = await fetch('/api/tenant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: tenant.name,
          operationalAccessEnabled: tenant.operationalAccessEnabled,
          systemSettings: tenant.systemSettings
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al guardar configuración')
      setTenant(data.tenant)
      showSuccess('Configuración guardada', 'Los cambios se aplicaron correctamente')
      fetchData()
    } catch (error) {
      console.error(error)
      showError('Error al guardar', error instanceof Error ? error.message : undefined)
    } finally {
      setSaving(false)
    }
  }

  // Logo y datos de identidad se gestionan en otras secciones; aquí se omiten

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  if (!tenant) {
    return (
      <div className="container mx-auto py-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Configuración del Sistema
            </CardTitle>
            <CardDescription>No se pudo cargar el tenant</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto py-8 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Configuración del Sistema
          </CardTitle>
          <CardDescription>Ajustes generales del sistema</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={configTab} onValueChange={setConfigTab}>
            <TabsList>
              <TabsTrigger value="smtp">SMTP</TabsTrigger>
              <TabsTrigger value="notifications">Notificaciones</TabsTrigger>
              <TabsTrigger value="operational">Operativo</TabsTrigger>
              <TabsTrigger value="webservice">Web Service</TabsTrigger>
              <TabsTrigger value="smtp-test">Prueba SMTP</TabsTrigger>
            </TabsList>

            <TabsContent value="smtp">
              <div className="p-4 border rounded-lg space-y-3">
                <p className="font-medium">SMTP (Correo)</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Host</Label>
                    <Input value={tenant.systemSettings?.smtp?.host || ''} onChange={(e) => setTenant({ ...tenant, systemSettings: { ...(tenant.systemSettings || {}), smtp: { ...(tenant.systemSettings?.smtp || {}), host: e.target.value } } })} />
                  </div>
                  <div>
                    <Label>Puerto</Label>
                    <Input type="number" value={tenant.systemSettings?.smtp?.port ?? ''} onChange={(e) => setTenant({ ...tenant, systemSettings: { ...(tenant.systemSettings || {}), smtp: { ...(tenant.systemSettings?.smtp || {}), port: e.target.value ? Number(e.target.value) : undefined } } })} />
                  </div>
                  <div>
                    <Label>Usuario</Label>
                    <Input value={tenant.systemSettings?.smtp?.user || ''} onChange={(e) => setTenant({ ...tenant, systemSettings: { ...(tenant.systemSettings || {}), smtp: { ...(tenant.systemSettings?.smtp || {}), user: e.target.value } } })} />
                  </div>
                  <div>
                    <Label>Contraseña</Label>
                    <Input type="password" value={tenant.systemSettings?.smtp?.pass || ''} onChange={(e) => setTenant({ ...tenant, systemSettings: { ...(tenant.systemSettings || {}), smtp: { ...(tenant.systemSettings?.smtp || {}), pass: e.target.value } } })} />
                  </div>
                  <div>
                    <Label>Remitente (Email)</Label>
                    <Input type="email" value={tenant.systemSettings?.smtp?.fromEmail || ''} onChange={(e) => setTenant({ ...tenant, systemSettings: { ...(tenant.systemSettings || {}), smtp: { ...(tenant.systemSettings?.smtp || {}), fromEmail: e.target.value } } })} />
                  </div>
                  <div>
                    <Label>Remitente (Nombre)</Label>
                    <Input value={tenant.systemSettings?.smtp?.fromName || ''} onChange={(e) => setTenant({ ...tenant, systemSettings: { ...(tenant.systemSettings || {}), smtp: { ...(tenant.systemSettings?.smtp || {}), fromName: e.target.value } } })} />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-sm">TLS/Seguro</Label>
                  <Button variant={tenant.systemSettings?.smtp?.secure ? 'default' : 'outline'} size="sm" onClick={() => setTenant({ ...tenant, systemSettings: { ...(tenant.systemSettings || {}), smtp: { ...(tenant.systemSettings?.smtp || {}), secure: !tenant.systemSettings?.smtp?.secure } } })}>{tenant.systemSettings?.smtp?.secure ? 'Sí' : 'No'}</Button>
                </div>
                <div className="flex justify-end mt-4">
                  <Button onClick={updateTenant} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}Guardar</Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="notifications">
              <div className="p-4 border rounded-lg space-y-3">
                <p className="font-medium">Notificaciones</p>
                <div className="flex items-center gap-3">
                  <Label className="text-sm">Email</Label>
                  <Button variant={tenant.systemSettings?.notifications?.emailEnabled ? 'default' : 'outline'} size="sm" onClick={() => setTenant({ ...tenant, systemSettings: { ...(tenant.systemSettings || {}), notifications: { ...(tenant.systemSettings?.notifications || {}), emailEnabled: !tenant.systemSettings?.notifications?.emailEnabled } } })}>{tenant.systemSettings?.notifications?.emailEnabled ? 'Habilitado' : 'Deshabilitado'}</Button>
                </div>
                <div className="flex items-center gap-3">
                  <Label className="text-sm">Alertas del sistema</Label>
                  <Button variant={tenant.systemSettings?.notifications?.alertsEnabled ? 'default' : 'outline'} size="sm" onClick={() => setTenant({ ...tenant, systemSettings: { ...(tenant.systemSettings || {}), notifications: { ...(tenant.systemSettings?.notifications || {}), alertsEnabled: !tenant.systemSettings?.notifications?.alertsEnabled } } })}>{tenant.systemSettings?.notifications?.alertsEnabled ? 'Habilitado' : 'Deshabilitado'}</Button>
                </div>
                <div className="flex items-center gap-3">
                  <Label className="text-sm">Auditoría</Label>
                  <Button variant={tenant.systemSettings?.notifications?.auditEnabled ? 'default' : 'outline'} size="sm" onClick={() => setTenant({ ...tenant, systemSettings: { ...(tenant.systemSettings || {}), notifications: { ...(tenant.systemSettings?.notifications || {}), auditEnabled: !tenant.systemSettings?.notifications?.auditEnabled } } })}>{tenant.systemSettings?.notifications?.auditEnabled ? 'Habilitado' : 'Deshabilitado'}</Button>
                </div>
                <div className="flex justify-end mt-4">
                  <Button onClick={updateTenant} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}Guardar</Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="operational">
              <div className="p-4 border rounded-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Acceso Operativo</p>
                    <p className="text-xs text-gray-500">Habilita características operativas cuando el onboarding esté completo</p>
                  </div>
                  <Button
                    variant={tenant.operationalAccessEnabled ? 'default' : 'outline'}
                    onClick={() => setTenant({ ...tenant, operationalAccessEnabled: !tenant.operationalAccessEnabled })}
                  >
                    {tenant.operationalAccessEnabled ? 'Habilitado' : 'Deshabilitado'}
                  </Button>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  {status?.hasOperationalAccess ? (
                    <Badge variant="default" className="gap-1"><CheckCircle2 className="h-4 w-4" />Activo</Badge>
                  ) : (
                    <Badge variant="secondary" className="gap-1"><AlertTriangle className="h-4 w-4" />Pendiente</Badge>
                  )}
                  <span className="text-xs text-gray-500">Progreso de configuración: {status?.status.setupProgress ?? 0}%</span>
                </div>
                <div className="flex justify-end mt-4">
                  <Button onClick={updateTenant} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}Guardar</Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="webservice">
              <div className="p-4 border rounded-lg space-y-6">
                <div>
                  <h3 className="text-lg font-medium">Credenciales de Acceso</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Utiliza esta API Key para autenticar tus peticiones al Web Service.
                    Inclúyela en el encabezado <code className="text-xs bg-muted px-1 rounded">X-API-Key</code>.
                  </p>

                  <div className="flex items-end gap-3">
                    <div className="flex-1 space-y-2">
                      <Label>Tu API Key</Label>
                      <div className="relative">
                        <Input 
                          type={showKey ? "text" : "password"} 
                          value={apiKey || ''} 
                          readOnly 
                          className="font-mono pr-24"
                          placeholder={keyLoading ? "Cargando..." : "Generando..."}
                        />
                        <div className="absolute right-1 top-1 flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setShowKey(!showKey)}
                            title={showKey ? "Ocultar" : "Mostrar"}
                          >
                            {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => {
                              if (apiKey) {
                                navigator.clipboard.writeText(apiKey)
                                showSuccess('Copiado', 'API Key copiada al portapapeles')
                              }
                            }}
                            title="Copiar"
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                    <Button 
                      variant="outline" 
                      onClick={rotateApiKey} 
                      disabled={keyRotating || keyLoading}
                    >
                      {keyRotating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                      Rotar Clave
                    </Button>
                  </div>
                  
                  <div className="mt-4 flex items-center gap-2 p-3 bg-amber-50 text-amber-900 rounded-md text-sm border border-amber-200">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <p>Esta clave tiene permisos completos. No la compartas ni la expongas en el frontend.</p>
                  </div>
                </div>

                <div className="mt-6 pt-6 border-t space-y-4">
                  <h3 className="font-semibold text-lg">Guía de Integración API REST</h3>
                  <p className="text-sm text-muted-foreground">
                    Utiliza los siguientes ejemplos para integrar tu sistema con nuestro motor de timbrado CFDI 4.0.
                    Endpoint: <span className="font-mono bg-muted px-1 rounded">POST /api/cfdi/timbrar</span>
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>1. Identificación de Organización</Label>
                      <div className="flex gap-2">
                        <Input readOnly value={tenant.id} className="font-mono text-xs" />
                        <Button variant="outline" size="icon" onClick={() => { navigator.clipboard.writeText(tenant.id); showSuccess('Copiado', 'ID de organización copiado'); }}>
                          <span className="sr-only">Copiar</span>
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">Header requerido: <span className="font-mono">X-Org-Id</span></p>
                    </div>

                    <div className="space-y-2">
                      <Label>2. Encabezados HTTP</Label>
                      <div className="bg-muted p-3 rounded-md text-xs font-mono space-y-1">
                        <div>Content-Type: application/json</div>
                        <div>X-API-Key: {apiKey ? `${apiKey.substring(0, 12)}...` : '(Generando...)'}</div>
                        <div>X-Org-Id: {tenant.id}</div>
                      </div>
                    </div>
                  </div>

                  <Tabs defaultValue="curl" className="w-full">
                    <div className="w-full overflow-x-auto pb-2">
                      <TabsList className="justify-start h-auto w-max">
                        <TabsTrigger value="curl">cURL</TabsTrigger>
                        <TabsTrigger value="basic">JSON Básico</TabsTrigger>
                        <TabsTrigger value="advanced">JSON Avanzado (Impuestos)</TabsTrigger>
                        <TabsTrigger value="predial">A Cuenta Predial</TabsTrigger>
                        <TabsTrigger value="terceros">A Cuenta de Terceros</TabsTrigger>
                        <TabsTrigger value="anticipo">Anticipo CFDi Egreso</TabsTrigger>
                        <TabsTrigger value="remanente">Anticipo Con Remanente</TabsTrigger>
                        <TabsTrigger value="relacionados">Cfdis Relacionados</TabsTrigger>
                        <TabsTrigger value="sin-imp">Ingreso Sin Impuestos</TabsTrigger>
                        <TabsTrigger value="kit-parte">Kit (Parte)</TabsTrigger>
                        <TabsTrigger value="nota-credito">Nota de Crédito</TabsTrigger>
                        <TabsTrigger value="nota-debito">Nota de Débito</TabsTrigger>
                        <TabsTrigger value="objeto-imp-06">Objeto de Impuesto 06</TabsTrigger>
                        <TabsTrigger value="objeto-imp-07">Objeto de Impuesto 07</TabsTrigger>
                        <TabsTrigger value="objeto-imp-08">Objeto de Impuesto 08</TabsTrigger>
                        <TabsTrigger value="publico-general">Público en General</TabsTrigger>
                        <TabsTrigger value="resico">Resico</TabsTrigger>
                        <TabsTrigger value="tasa-0">Tasa 0%</TabsTrigger>
                        <TabsTrigger value="tasa-0-ret">Tasa 0% con Retenciones</TabsTrigger>
                        <TabsTrigger value="traslado">Traslado</TabsTrigger>
                        <TabsTrigger value="imp-menor-ingreso">Importe Menor CFDI Ingreso</TabsTrigger>
                      </TabsList>
                    </div>
                    
                    <TabsContent value="curl" className="space-y-2">
                      <div className="relative">
                        <Textarea
                          readOnly
                          rows={12}
                          className="font-mono text-xs pr-12"
                          value={`curl -X POST '${typeof window !== 'undefined' ? window.location.origin : 'https://api.tu-dominio.com'}/api/cfdi/timbrar' \\
  -H 'Content-Type: application/json' \\
  -H 'X-API-Key: ${apiKey || 'TU_API_KEY'}' \\
  -H 'X-Org-Id: ${tenant.id}' \\
  -d '{
  "emisor": { "rfc": "XAXX010101000", "nombre": "DEMO SA" },
  "receptor": { "rfc": "COSC8001137NA", "nombre": "Cliente", "usoCfdi": "G01" },
  "comprobante": {
    "lugarExpedicion": "01000",
    "metodoPago": "PUE",
    "formaPago": "01",
    "fecha": "2025-12-15T12:00:00Z"
  },
  "conceptos": [
    {
      "claveProdServ": "01010101",
      "cantidad": 1,
      "claveUnidad": "H87",
      "descripcion": "Servicio",
      "valorUnitario": 100,
      "importe": 100,
      "objetoImp": "02",
      "impuestos": {
        "traslados": [
          {
            "impuesto": "002",
            "tipoFactor": "Tasa",
            "tasaOCuota": "0.16",
            "base": "100",
            "importe": "16"
          }
        ]
      }
    }
  ]
}'`}
                        />
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="absolute top-2 right-2 h-8 w-8 p-0"
                          onClick={() => {
                             const val = `curl -X POST '${window.location.origin}/api/cfdi/timbrar' \\
  -H 'Content-Type: application/json' \\
  -H 'X-API-Key: ${apiKey || 'TU_API_KEY'}' \\
  -H 'X-Org-Id: ${tenant.id}' \\
  -d '{
  "emisor": { "rfc": "XAXX010101000", "nombre": "DEMO SA" },
  "receptor": { "rfc": "COSC8001137NA", "nombre": "Cliente", "usoCfdi": "G01" },
  "comprobante": {
    "lugarExpedicion": "01000",
    "metodoPago": "PUE",
    "formaPago": "01",
    "fecha": "2025-12-15T12:00:00Z"
  },
  "conceptos": [
    {
      "claveProdServ": "01010101",
      "cantidad": 1,
      "claveUnidad": "H87",
      "descripcion": "Servicio",
      "valorUnitario": 100,
      "importe": 100,
      "objetoImp": "02",
      "impuestos": {
        "traslados": [
          {
            "impuesto": "002",
            "tipoFactor": "Tasa",
            "tasaOCuota": "0.16",
            "base": "100",
            "importe": "16"
          }
        ]
      }
    }
  ]
}'`;
                             navigator.clipboard.writeText(val);
                             showSuccess('Copiado', 'Ejemplo cURL copiado');
                          }}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                        </Button>
                      </div>
                    </TabsContent>

                    <TabsContent value="nota-credito" className="space-y-2">
                      <div className="relative">
                        <Textarea
                          readOnly
                          rows={40}
                          className="font-mono text-xs pr-12"
                          value={`{ 
  "Version": "4.0", 
  "FormaPago": "01", 
  "Serie": "NC", 
  "Folio": "123456", 
  "Fecha": "2024-04-29T00:00:00", 
  "Sello": "", 
  "NoCertificado": "", 
  "Certificado": "", 
  "CondicionesDePago": null, 
  "MetodoPago": "PUE", 
  "SubTotal": "10.00", 
  "Descuento": "0.00", 
  "Moneda": "MXN", 
  "Total": "11.00", 
  "TipoDeComprobante": "E", 
  "Exportacion": "01", 
  "LugarExpedicion": "45610", 
  "CfdiRelacionados": [ 
    { 
      "TipoRelacion": "01", 
      "CfdiRelacionado": [ 
        { 
          "UUID": "1fac4464-1111-0000-1111-cd37179db12e" 
        } 
      ] 
    } 
  ], 
  "Emisor": { 
    "Rfc": "EKU9003173C9", 
    "Nombre": "ESCUELA KEMPER URGATE", 
    "RegimenFiscal": "603" 
  }, 
  "Receptor": { 
    "Rfc": "EKU9003173C9", 
    "Nombre": "ESCUELA KEMPER URGATE", 
    "DomicilioFiscalReceptor": "42501", 
    "RegimenFiscalReceptor": "601", 
    "UsoCFDI": "CP01" 
  }, 
  "Conceptos": [ 
    { 
      "ClaveProdServ": "84111506", 
      "NoIdentificacion": null, 
      "Cantidad": "1.0", 
      "ClaveUnidad": "ACT", 
      "Unidad": null, 
      "Descripcion": "NC por devolución", 
      "ValorUnitario": "10.00", 
      "Importe": "10.00", 
      "Descuento": "0.00", 
      "ObjetoImp": "02", 
      "Impuestos": { 
        "Traslados": [ 
          { 
            "Base": "1", 
            "Importe": "1", 
            "Impuesto": "002", 
            "TasaOCuota": "0.160000", 
            "TipoFactor": "Tasa" 
          } 
        ] 
      } 
    } 
  ], 
  "Impuestos": { 
    "TotalImpuestosTrasladados": "1.00", 
    "Traslados": [ 
      { 
        "Base": "1.00", 
        "Importe": "1.00", 
        "Impuesto": "002", 
        "TasaOCuota": "0.160000", 
        "TipoFactor": "Tasa" 
      } 
    ] 
  } 
 }`}
                        />
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="absolute top-2 right-2 h-8 w-8 p-0"
                          onClick={() => {
                            const val = `{ 
  "Version": "4.0", 
  "FormaPago": "01", 
  "Serie": "NC", 
  "Folio": "123456", 
  "Fecha": "2024-04-29T00:00:00", 
  "Sello": "", 
  "NoCertificado": "", 
  "Certificado": "", 
  "CondicionesDePago": null, 
  "MetodoPago": "PUE", 
  "SubTotal": "10.00", 
  "Descuento": "0.00", 
  "Moneda": "MXN", 
  "Total": "11.00", 
  "TipoDeComprobante": "E", 
  "Exportacion": "01", 
  "LugarExpedicion": "45610", 
  "CfdiRelacionados": [ 
    { 
      "TipoRelacion": "01", 
      "CfdiRelacionado": [ 
        { 
          "UUID": "1fac4464-1111-0000-1111-cd37179db12e" 
        } 
      ] 
    } 
  ], 
  "Emisor": { 
    "Rfc": "EKU9003173C9", 
    "Nombre": "ESCUELA KEMPER URGATE", 
    "RegimenFiscal": "603" 
  }, 
  "Receptor": { 
    "Rfc": "EKU9003173C9", 
    "Nombre": "ESCUELA KEMPER URGATE", 
    "DomicilioFiscalReceptor": "42501", 
    "RegimenFiscalReceptor": "601", 
    "UsoCFDI": "CP01" 
  }, 
  "Conceptos": [ 
    { 
      "ClaveProdServ": "84111506", 
      "NoIdentificacion": null, 
      "Cantidad": "1.0", 
      "ClaveUnidad": "ACT", 
      "Unidad": null, 
      "Descripcion": "NC por devolución", 
      "ValorUnitario": "10.00", 
      "Importe": "10.00", 
      "Descuento": "0.00", 
      "ObjetoImp": "02", 
      "Impuestos": { 
        "Traslados": [ 
          { 
            "Base": "1", 
            "Importe": "1", 
            "Impuesto": "002", 
            "TasaOCuota": "0.160000", 
            "TipoFactor": "Tasa" 
          } 
        ] 
      } 
    } 
  ], 
  "Impuestos": { 
    "TotalImpuestosTrasladados": "1.00", 
    "Traslados": [ 
      { 
        "Base": "1.00", 
        "Importe": "1.00", 
        "Impuesto": "002", 
        "TasaOCuota": "0.160000", 
        "TipoFactor": "Tasa" 
      } 
    ] 
  } 
 }`;
                            navigator.clipboard.writeText(val);
                            showSuccess('Copiado', 'JSON Nota de Crédito copiado');
                          }}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                        </Button>
                      </div>
                    </TabsContent>

                    <TabsContent value="nota-debito" className="space-y-2">
                      <div className="relative">
                        <Textarea
                          readOnly
                          rows={44}
                          className="font-mono text-xs pr-12"
                          value={`{ 
    "Version": "4.0", 
    "Serie": "Serie", 
    "Folio": "120380", 
    "Fecha": "2024-04-29T00:00:00", 
    "FormaPago": "99", 
    "SubTotal": 285.00, 
    "Descuento": 0.00, 
    "Moneda": "MXN", 
    "Total": 285.00, 
    "TipoDeComprobante": "I", 
    "Exportacion": "01", 
    "MetodoPago": "PUE", 
    "LugarExpedicion": "99039", 
    "CfdiRelacionados": [ 
        { 
            "CfdiRelacionado": [ 
                { 
                    "UUID": "61b2f6b4-f588-44d3-aec7-85cf146c33bd" 
                } 
            ], 
            "TipoRelacion": "02" 
        } 
    ], 
    "Emisor": { 
        "Rfc": "EKU9003173C9", 
        "Nombre": "ESCUELA KEMPER URGATE", 
        "RegimenFiscal": 601 
    }, 
    "Receptor": { 
        "Rfc": "CACX7605101P8", 
        "Nombre": "XOCHILT CASAS CHAVEZ", 
        "DomicilioFiscalReceptor": "36257", 
        "RegimenFiscalReceptor": 612, 
        "UsoCFDI": "S01" 
    }, 
    "Conceptos": [ 
        { 
            "Impuestos": { 
                "Traslados": [ 
                    { 
                        "Base": 285.00, 
                        "Impuesto": "002", 
                        "TipoFactor": "Tasa", 
                        "TasaOCuota": 0.000000, 
                        "Importe": 0.000000 
                    } 
                ] 
            }, 
            "ClaveProdServ": "70171600", 
            "NoIdentificacion": "7506475100557", 
            "Cantidad": 3.00, 
            "ClaveUnidad": "ACT", 
            "Unidad": "HUR", 
            "Descripcion": "Vigilancia", 
            "ValorUnitario": 95.00, 
            "Importe": 285.00, 
            "Descuento": 0.00, 
            "ObjetoImp": "02" 
        } 
    ], 
    "Impuestos": { 
        "Traslados": [ 
            { 
                "Base": 285.00, 
                "Impuesto": "002", 
                "TipoFactor": "Tasa", 
                "TasaOCuota": 0.000000, 
                "Importe": 0.00 
            } 
        ], 
        "TotalImpuestosTrasladados": 0.00 
    } 
 }`}
                        />
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="absolute top-2 right-2 h-8 w-8 p-0"
                          onClick={() => {
                            const val = `{ 
    "Version": "4.0", 
    "Serie": "Serie", 
    "Folio": "120380", 
    "Fecha": "2024-04-29T00:00:00", 
    "FormaPago": "99", 
    "SubTotal": 285.00, 
    "Descuento": 0.00, 
    "Moneda": "MXN", 
    "Total": 285.00, 
    "TipoDeComprobante": "I", 
    "Exportacion": "01", 
    "MetodoPago": "PUE", 
    "LugarExpedicion": "99039", 
    "CfdiRelacionados": [ 
        { 
            "CfdiRelacionado": [ 
                { 
                    "UUID": "61b2f6b4-f588-44d3-aec7-85cf146c33bd" 
                } 
            ], 
            "TipoRelacion": "02" 
        } 
    ], 
    "Emisor": { 
        "Rfc": "EKU9003173C9", 
        "Nombre": "ESCUELA KEMPER URGATE", 
        "RegimenFiscal": 601 
    }, 
    "Receptor": { 
        "Rfc": "CACX7605101P8", 
        "Nombre": "XOCHILT CASAS CHAVEZ", 
        "DomicilioFiscalReceptor": "36257", 
        "RegimenFiscalReceptor": 612, 
        "UsoCFDI": "S01" 
    }, 
    "Conceptos": [ 
        { 
            "Impuestos": { 
                "Traslados": [ 
                    { 
                        "Base": 285.00, 
                        "Impuesto": "002", 
                        "TipoFactor": "Tasa", 
                        "TasaOCuota": 0.000000, 
                        "Importe": 0.000000 
                    } 
                ] 
            }, 
            "ClaveProdServ": "70171600", 
            "NoIdentificacion": "7506475100557", 
            "Cantidad": 3.00, 
            "ClaveUnidad": "ACT", 
            "Unidad": "HUR", 
            "Descripcion": "Vigilancia", 
            "ValorUnitario": 95.00, 
            "Importe": 285.00, 
            "Descuento": 0.00, 
            "ObjetoImp": "02" 
        } 
    ], 
    "Impuestos": { 
        "Traslados": [ 
            { 
                "Base": 285.00, 
                "Impuesto": "002", 
                "TipoFactor": "Tasa", 
                "TasaOCuota": 0.000000, 
                "Importe": 0.00 
            } 
        ], 
        "TotalImpuestosTrasladados": 0.00 
    } 
 }`;
                            navigator.clipboard.writeText(val);
                            showSuccess('Copiado', 'JSON Nota de Débito copiado');
                          }}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                        </Button>
                      </div>
                    </TabsContent>

                    <TabsContent value="objeto-imp-06" className="space-y-2">
                      <div className="relative">
                        <Textarea
                          readOnly
                          rows={44}
                          className="font-mono text-xs pr-12"
                          value={`{ 
  "Version": "4.0", 
  "Serie": "Serie", 
  "Folio": "Folio", 
  "Fecha": "2024-12-18T00:00:00", 
  "FormaPago": "99", 
  "CondicionesDePago": "CondicionesDePago", 
  "SubTotal": "200", 
  "Moneda": "MXN", 
  "Total": "199.90", 
  "TipoDeComprobante": "I", 
  "Exportacion": "01", 
  "MetodoPago": "PPD", 
  "LugarExpedicion": "20000", 
  "Emisor": { 
    "Rfc": "EKU9003173C9", 
    "Nombre": "ESCUELA KEMPER URGATE", 
    "RegimenFiscal": "601" 
  }, 
  "Receptor": { 
    "Rfc": "URE180429TM6", 
    "Nombre": "UNIVERSIDAD ROBOTICA ESPAÑOLA", 
    "DomicilioFiscalReceptor": "86991", 
    "RegimenFiscalReceptor": "601", 
    "UsoCFDI": "G01" 
  }, 
  "Conceptos": [ 
    { 
      "ClaveProdServ": "50211503", 
      "Cantidad": "1", 
      "ClaveUnidad": "H87", 
      "Unidad": "Pieza", 
      "Descripcion": "Cigarros", 
      "ValorUnitario": "200.00", 
      "Importe": "200.00", 
      "ObjetoImp": "06", 
      "Impuestos": { 
        "Retenciones": [ 
          { 
            "Base": "1", 
            "Impuesto": "001", 
            "TipoFactor": "Tasa", 
            "TasaOCuota": "0.106666", 
            "Importe": "0.10" 
          } 
        ] 
      } 
    } 
  ], 
  "Impuestos": { 
    "TotalImpuestosRetenidos": "0.10", 
    "Retenciones": [ 
      { 
        "Impuesto": "001", 
        "Importe": "0.10" 
      } 
    ] 
  } 
 }`}
                        />
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="absolute top-2 right-2 h-8 w-8 p-0"
                          onClick={() => {
                            const val = `{ 
  "Version": "4.0", 
  "Serie": "Serie", 
  "Folio": "Folio", 
  "Fecha": "2024-12-18T00:00:00", 
  "FormaPago": "99", 
  "CondicionesDePago": "CondicionesDePago", 
  "SubTotal": "200", 
  "Moneda": "MXN", 
  "Total": "199.90", 
  "TipoDeComprobante": "I", 
  "Exportacion": "01", 
  "MetodoPago": "PPD", 
  "LugarExpedicion": "20000", 
  "Emisor": { 
    "Rfc": "EKU9003173C9", 
    "Nombre": "ESCUELA KEMPER URGATE", 
    "RegimenFiscal": "601" 
  }, 
  "Receptor": { 
    "Rfc": "URE180429TM6", 
    "Nombre": "UNIVERSIDAD ROBOTICA ESPAÑOLA", 
    "DomicilioFiscalReceptor": "86991", 
    "RegimenFiscalReceptor": "601", 
    "UsoCFDI": "G01" 
  }, 
  "Conceptos": [ 
    { 
      "ClaveProdServ": "50211503", 
      "Cantidad": "1", 
      "ClaveUnidad": "H87", 
      "Unidad": "Pieza", 
      "Descripcion": "Cigarros", 
      "ValorUnitario": "200.00", 
      "Importe": "200.00", 
      "ObjetoImp": "06", 
      "Impuestos": { 
        "Retenciones": [ 
          { 
            "Base": "1", 
            "Impuesto": "001", 
            "TipoFactor": "Tasa", 
            "TasaOCuota": "0.106666", 
            "Importe": "0.10" 
          } 
        ] 
      } 
    } 
  ], 
  "Impuestos": { 
    "TotalImpuestosRetenidos": "0.10", 
    "Retenciones": [ 
      { 
        "Impuesto": "001", 
        "Importe": "0.10" 
      } 
    ] 
  } 
 }`;
                            navigator.clipboard.writeText(val);
                            showSuccess('Copiado', 'JSON Objeto de Impuesto 06 copiado');
                          }}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                        </Button>
                      </div>
                    </TabsContent>

                    <TabsContent value="objeto-imp-07" className="space-y-2">
                      <div className="relative">
                        <Textarea
                          readOnly
                          rows={54}
                          className="font-mono text-xs pr-12"
                          value={`{ 
  "Version": "4.0", 
  "Serie": "Serie", 
  "Folio": "Folio", 
  "Fecha": "2024-12-18T00:00:00", 
  "FormaPago": "99", 
  "CondicionesDePago": "CondicionesDePago", 
  "SubTotal": "200", 
  "Moneda": "MXN", 
  "Total": "199.96", 
  "TipoDeComprobante": "I", 
  "Exportacion": "01", 
  "MetodoPago": "PPD", 
  "LugarExpedicion": "20000", 
  "Emisor": { 
      "Rfc": "EKU9003173C9", 
      "Nombre": "ESCUELA KEMPER URGATE", 
      "RegimenFiscal": "601" 
  }, 
  "Receptor": { 
      "Rfc": "URE180429TM6", 
      "Nombre": "UNIVERSIDAD ROBOTICA ESPAÑOLA", 
      "DomicilioFiscalReceptor": "86991", 
      "RegimenFiscalReceptor": "601", 
      "UsoCFDI": "G01" 
  }, 
  "Conceptos": [ 
      { 
          "ClaveProdServ": "50211503", 
          "Cantidad": "1", 
          "ClaveUnidad": "H87", 
          "Unidad": "Pieza", 
          "Descripcion": "Cigarros", 
          "ValorUnitario": "200.00", 
          "Importe": "200.00", 
          "ObjetoImp": "07", 
          "Impuestos": { 
              "Traslados": [ 
                  { 
                      "Base": "1", 
                      "Impuesto": "003", 
                      "TipoFactor": "Tasa", 
                      "TasaOCuota": "0.060000", 
                      "Importe": "0.06" 
                  } 
              ], 
              "Retenciones": [ 
                  { 
                      "Base": "1", 
                      "Impuesto": "001", 
                      "TipoFactor": "Tasa", 
                      "TasaOCuota": "0.100000", 
                      "Importe": "0.10" 
                  } 
              ] 
          } 
      } 
  ], 
  "Impuestos": { 
      "TotalImpuestosRetenidos": "0.10", 
      "TotalImpuestosTrasladados": "0.06", 
      "Retenciones": [ 
          { 
              "Impuesto": "001", 
              "Importe": "0.10" 
          } 
      ], 
      "Traslados": [ 
          { 
              "Base": "1", 
              "Impuesto": "003", 
              "TipoFactor": "Tasa", 
              "TasaOCuota": "0.060000", 
              "Importe": "0.06" 
          } 
      ] 
  } 
 }`}
                        />
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="absolute top-2 right-2 h-8 w-8 p-0"
                          onClick={() => {
                            const val = `{ 
  "Version": "4.0", 
  "Serie": "Serie", 
  "Folio": "Folio", 
  "Fecha": "2024-12-18T00:00:00", 
  "FormaPago": "99", 
  "CondicionesDePago": "CondicionesDePago", 
  "SubTotal": "200", 
  "Moneda": "MXN", 
  "Total": "199.96", 
  "TipoDeComprobante": "I", 
  "Exportacion": "01", 
  "MetodoPago": "PPD", 
  "LugarExpedicion": "20000", 
  "Emisor": { 
      "Rfc": "EKU9003173C9", 
      "Nombre": "ESCUELA KEMPER URGATE", 
      "RegimenFiscal": "601" 
  }, 
  "Receptor": { 
      "Rfc": "URE180429TM6", 
      "Nombre": "UNIVERSIDAD ROBOTICA ESPAÑOLA", 
      "DomicilioFiscalReceptor": "86991", 
      "RegimenFiscalReceptor": "601", 
      "UsoCFDI": "G01" 
  }, 
  "Conceptos": [ 
      { 
          "ClaveProdServ": "50211503", 
          "Cantidad": "1", 
          "ClaveUnidad": "H87", 
          "Unidad": "Pieza", 
          "Descripcion": "Cigarros", 
          "ValorUnitario": "200.00", 
          "Importe": "200.00", 
          "ObjetoImp": "07", 
          "Impuestos": { 
              "Traslados": [ 
                  { 
                      "Base": "1", 
                      "Impuesto": "003", 
                      "TipoFactor": "Tasa", 
                      "TasaOCuota": "0.060000", 
                      "Importe": "0.06" 
                  } 
              ], 
              "Retenciones": [ 
                  { 
                      "Base": "1", 
                      "Impuesto": "001", 
                      "TipoFactor": "Tasa", 
                      "TasaOCuota": "0.100000", 
                      "Importe": "0.10" 
                  } 
              ] 
          } 
      } 
  ], 
  "Impuestos": { 
      "TotalImpuestosRetenidos": "0.10", 
      "TotalImpuestosTrasladados": "0.06", 
      "Retenciones": [ 
          { 
              "Impuesto": "001", 
              "Importe": "0.10" 
          } 
      ], 
      "Traslados": [ 
          { 
              "Base": "1", 
              "Impuesto": "003", 
              "TipoFactor": "Tasa", 
              "TasaOCuota": "0.060000", 
              "Importe": "0.06" 
          } 
      ] 
  } 
 }`;
                            navigator.clipboard.writeText(val);
                            showSuccess('Copiado', 'JSON Objeto de Impuesto 07 copiado');
                          }}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                        </Button>
                      </div>
                    </TabsContent>

                    <TabsContent value="objeto-imp-08" className="space-y-2">
                      <div className="relative">
                        <Textarea
                          readOnly
                          rows={30}
                          className="font-mono text-xs pr-12"
                          value={`{ 
     "Version": "4.0", 
     "Serie": "Serie", 
     "Folio": "Folio", 
     "Fecha": "2024-12-18T00:00:00", 
     "FormaPago": "99", 
     "CondicionesDePago": "CondicionesDePago", 
     "SubTotal": "200", 
     "Moneda": "MXN", 
     "Total": "199.90", 
     "TipoDeComprobante": "I", 
     "Exportacion": "01", 
     "MetodoPago": "PPD", 
     "LugarExpedicion": "20000", 
     "Emisor": { 
         "Rfc": "EKU9003173C9", 
         "Nombre": "ESCUELA KEMPER URGATE", 
         "RegimenFiscal": "601" 
     }, 
     "Receptor": { 
         "Rfc": "URE180429TM6", 
         "Nombre": "UNIVERSIDAD ROBOTICA ESPAÑOLA", 
         "DomicilioFiscalReceptor": "86991", 
         "RegimenFiscalReceptor": "601", 
         "UsoCFDI": "G01" 
     }, 
     "Conceptos": [ 
         { 
             "ClaveProdServ": "50211503", 
             "Cantidad": "1", 
             "ClaveUnidad": "H87", 
             "Unidad": "Pieza", 
             "Descripcion": "Cigarros", 
             "ValorUnitario": "200.00", 
             "Importe": "200.00", 
             "ObjetoImp": "08", 
             "Impuestos": { 
                 "Retenciones": [ 
                     { 
                         "Base": "1", 
                         "Impuesto": "001", 
                         "TipoFactor": "Tasa", 
                         "TasaOCuota": "0.106666", 
                         "Importe": "0.10" 
                     } 
                 ] 
             } 
         } 
     ], 
     "Impuestos": { 
         "TotalImpuestosRetenidos": "0.10", 
         "Retenciones": [ 
             { 
                 "Impuesto": "001", 
                 "Importe": "0.10" 
             } 
         ] 
     } 
 }`}
                        />
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="absolute top-2 right-2 h-8 w-8 p-0"
                          onClick={() => {
                            const val = `{ 
     "Version": "4.0", 
     "Serie": "Serie", 
     "Folio": "Folio", 
     "Fecha": "2024-12-18T00:00:00", 
     "FormaPago": "99", 
     "CondicionesDePago": "CondicionesDePago", 
     "SubTotal": "200", 
     "Moneda": "MXN", 
     "Total": "199.90", 
     "TipoDeComprobante": "I", 
     "Exportacion": "01", 
     "MetodoPago": "PPD", 
     "LugarExpedicion": "20000", 
     "Emisor": { 
         "Rfc": "EKU9003173C9", 
         "Nombre": "ESCUELA KEMPER URGATE", 
         "RegimenFiscal": "601" 
     }, 
     "Receptor": { 
         "Rfc": "URE180429TM6", 
         "Nombre": "UNIVERSIDAD ROBOTICA ESPAÑOLA", 
         "DomicilioFiscalReceptor": "86991", 
         "RegimenFiscalReceptor": "601", 
         "UsoCFDI": "G01" 
     }, 
     "Conceptos": [ 
         { 
             "ClaveProdServ": "50211503", 
             "Cantidad": "1", 
             "ClaveUnidad": "H87", 
             "Unidad": "Pieza", 
             "Descripcion": "Cigarros", 
             "ValorUnitario": "200.00", 
             "Importe": "200.00", 
             "ObjetoImp": "08", 
             "Impuestos": { 
                 "Retenciones": [ 
                     { 
                         "Base": "1", 
                         "Impuesto": "001", 
                         "TipoFactor": "Tasa", 
                         "TasaOCuota": "0.106666", 
                         "Importe": "0.10" 
                     } 
                 ] 
             } 
         } 
     ], 
     "Impuestos": { 
         "TotalImpuestosRetenidos": "0.10", 
         "Retenciones": [ 
             { 
                 "Impuesto": "001", 
                 "Importe": "0.10" 
             } 
         ] 
     } 
 }`;
                            navigator.clipboard.writeText(val);
                            showSuccess('Copiado', 'JSON Objeto de Impuesto 08 copiado');
                          }}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                        </Button>
                      </div>
                    </TabsContent>

                    <TabsContent value="publico-general" className="space-y-2">
                      <div className="relative">
                        <Textarea
                          readOnly
                          rows={34}
                          className="font-mono text-xs pr-12"
                          value={`{ 
     "Version": "4.0", 
     "FormaPago": "01", 
     "Serie": "SW", 
     "Folio": "123456", 
     "Fecha": "2024-04-29T00:00:00", 
     "MetodoPago": "PUE", 
     "Sello": "", 
     "NoCertificado": "", 
     "Certificado": "", 
     "CondicionesDePago": "CondicionesDePago", 
     "SubTotal": "10.00", 
     "Descuento": "0.00", 
     "Moneda": "MXN", 
     "Total": "10.00", 
     "TipoDeComprobante": "I", 
     "Exportacion": "01", 
     "LugarExpedicion": "45610", 
     "Emisor": { 
       "Rfc": "EKU9003173C9", 
       "Nombre": "ESCUELA KEMPER URGATE", 
       "RegimenFiscal": "603" 
     }, 
     "Receptor": { 
       "Rfc": "XAXX010101000", 
       "Nombre": "CLIENTE", 
       "DomicilioFiscalReceptor": "45610", 
       "RegimenFiscalReceptor": "616", 
       "UsoCFDI": "S01" 
     }, 
     "Conceptos": [ 
       { 
         "ClaveProdServ": "50211503", 
         "NoIdentificacion": "None", 
         "Cantidad": "1.0", 
         "ClaveUnidad": "H87", 
         "Unidad": "Pieza", 
         "Descripcion": "Cigarros", 
         "ValorUnitario": "10.00", 
         "Importe": "10.00", 
         "Descuento": "0.00", 
         "ObjetoImp": "02", 
         "Impuestos": { 
           "Traslados": [ 
             { 
               "Base": "1", 
               "Importe": "1", 
               "Impuesto": "002", 
               "TasaOCuota": "0.160000", 
               "TipoFactor": "Tasa" 
             } 
           ], 
           "Retenciones": [ 
             { 
               "Base": "1", 
               "Importe": "1", 
               "Impuesto": "002", 
               "TasaOCuota": "0.040000", 
               "TipoFactor": "Tasa" 
             } 
           ] 
         } 
       } 
     ], 
     "Impuestos": { 
       "TotalImpuestosTrasladados": "1.00", 
       "TotalImpuestosRetenidos": "1.00", 
       "Retenciones": [ 
         { 
           "Importe": "1.00", 
           "Impuesto": "002" 
         } 
       ], 
       "Traslados": [ 
         { 
           "Base": "1.00", 
           "Importe": "1.00", 
           "Impuesto": "002", 
           "TasaOCuota": "0.160000", 
           "TipoFactor": "Tasa" 
         } 
       ] 
     } 
   }`}
                        />
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="absolute top-2 right-2 h-8 w-8 p-0"
                          onClick={() => {
                            const val = `{ 
     "Version": "4.0", 
     "FormaPago": "01", 
     "Serie": "SW", 
     "Folio": "123456", 
     "Fecha": "2024-04-29T00:00:00", 
     "MetodoPago": "PUE", 
     "Sello": "", 
     "NoCertificado": "", 
     "Certificado": "", 
     "CondicionesDePago": "CondicionesDePago", 
     "SubTotal": "10.00", 
     "Descuento": "0.00", 
     "Moneda": "MXN", 
     "Total": "10.00", 
     "TipoDeComprobante": "I", 
     "Exportacion": "01", 
     "LugarExpedicion": "45610", 
     "Emisor": { 
       "Rfc": "EKU9003173C9", 
       "Nombre": "ESCUELA KEMPER URGATE", 
       "RegimenFiscal": "603" 
     }, 
     "Receptor": { 
       "Rfc": "XAXX010101000", 
       "Nombre": "CLIENTE", 
       "DomicilioFiscalReceptor": "45610", 
       "RegimenFiscalReceptor": "616", 
       "UsoCFDI": "S01" 
     }, 
     "Conceptos": [ 
       { 
         "ClaveProdServ": "50211503", 
         "NoIdentificacion": "None", 
         "Cantidad": "1.0", 
         "ClaveUnidad": "H87", 
         "Unidad": "Pieza", 
         "Descripcion": "Cigarros", 
         "ValorUnitario": "10.00", 
         "Importe": "10.00", 
         "Descuento": "0.00", 
         "ObjetoImp": "02", 
         "Impuestos": { 
           "Traslados": [ 
             { 
               "Base": "1", 
               "Importe": "1", 
               "Impuesto": "002", 
               "TasaOCuota": "0.160000", 
               "TipoFactor": "Tasa" 
             } 
           ], 
           "Retenciones": [ 
             { 
               "Base": "1", 
               "Importe": "1", 
               "Impuesto": "002", 
               "TasaOCuota": "0.040000", 
               "TipoFactor": "Tasa" 
             } 
           ] 
         } 
       } 
     ], 
     "Impuestos": { 
       "TotalImpuestosTrasladados": "1.00", 
       "TotalImpuestosRetenidos": "1.00", 
       "Retenciones": [ 
         { 
           "Importe": "1.00", 
           "Impuesto": "002" 
         } 
       ], 
       "Traslados": [ 
         { 
           "Base": "1.00", 
           "Importe": "1.00", 
           "Impuesto": "002", 
           "TasaOCuota": "0.160000", 
           "TipoFactor": "Tasa" 
         } 
       ] 
     } 
   }`;
                            navigator.clipboard.writeText(val);
                            showSuccess('Copiado', 'JSON Público en General copiado');
                          }}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                        </Button>
                      </div>
                    </TabsContent>

                    <TabsContent value="resico" className="space-y-2">
                      <div className="relative">
                        <Textarea
                          readOnly
                          rows={42}
                          className="font-mono text-xs pr-12"
                          value={`{ 
   "Version": "4.0", 
   "Serie": "Serie", 
   "Folio": "LC09", 
   "Fecha": "2024-04-29T00:00:00", 
   "Sello": "", 
   "FormaPago": "03", 
   "NoCertificado": "30001000000400002335", 
   "Certificado": "M", 
   "CondicionesDePago": "CONTADO", 
   "SubTotal": 3499.99, 
   "Moneda": "MXN", 
   "TipoCambio": 1, 
   "Total": 4016.24, 
   "TipoDeComprobante": "I", 
   "Exportacion": "01", 
   "MetodoPago": "PUE", 
   "LugarExpedicion": "97134", 
   "Emisor": { 
     "Rfc": "EKU9003173C9", 
     "Nombre": "ESCUELA KEMPER URGATE", 
     "RegimenFiscal": 601 
   }, 
   "Receptor": { 
     "Rfc": "EKU9003173C9", 
     "Nombre": "ESCUELA KEMPER URGATE", 
     "DomicilioFiscalReceptor": "42501", 
     "RegimenFiscalReceptor": 601, 
     "UsoCFDI": "G03" 
   }, 
   "Conceptos": [ 
     { 
       "Impuestos": { 
         "Traslados": [ 
           { 
             "Base": 3499.99, 
             "Impuesto": "002", 
             "TipoFactor": "Tasa", 
             "TasaOCuota": "0.160000", 
             "Importe": 559.9984 
           } 
         ], 
         "Retenciones": [ 
           { 
             "Base": 3499.99, 
             "Impuesto": "001", 
             "TipoFactor": "Tasa", 
             "TasaOCuota": 0.0125, 
             "Importe": 43.7498 
           } 
         ] 
       }, 
       "ClaveProdServ": "80101508", 
       "NoIdentificacion": "84111506", 
       "Cantidad": 1, 
       "ClaveUnidad": "E48", 
       "Unidad": "SERVICIO", 
       "Descripcion": "SERVICIOS DE ASESORAMIENTO SOBRE INTELIGENCIA EMPRESARIAL", 
       "ValorUnitario": 3499.99, 
       "Importe": 3499.99, 
       "ObjetoImp": "02" 
     } 
   ], 
   "Impuestos": { 
     "Retenciones": [ 
       { 
         "Impuesto": "001", 
         "Importe": 43.75 
       } 
     ], 
     "Traslados": [ 
       { 
         "Base": 3499.99, 
         "Impuesto": "002", 
         "TipoFactor": "Tasa", 
         "TasaOCuota": "0.160000", 
         "Importe": 560.00 
       } 
     ], 
     "TotalImpuestosRetenidos": 43.75, 
     "TotalImpuestosTrasladados": 560.00 
   } 
 }`}
                        />
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="absolute top-2 right-2 h-8 w-8 p-0"
                          onClick={() => {
                            const val = `{ 
   "Version": "4.0", 
   "Serie": "Serie", 
   "Folio": "LC09", 
   "Fecha": "2024-04-29T00:00:00", 
   "Sello": "", 
   "FormaPago": "03", 
   "NoCertificado": "30001000000400002335", 
   "Certificado": "M", 
   "CondicionesDePago": "CONTADO", 
   "SubTotal": 3499.99, 
   "Moneda": "MXN", 
   "TipoCambio": 1, 
   "Total": 4016.24, 
   "TipoDeComprobante": "I", 
   "Exportacion": "01", 
   "MetodoPago": "PUE", 
   "LugarExpedicion": "97134", 
   "Emisor": { 
     "Rfc": "EKU9003173C9", 
     "Nombre": "ESCUELA KEMPER URGATE", 
     "RegimenFiscal": 601 
   }, 
   "Receptor": { 
     "Rfc": "EKU9003173C9", 
     "Nombre": "ESCUELA KEMPER URGATE", 
     "DomicilioFiscalReceptor": "42501", 
     "RegimenFiscalReceptor": 601, 
     "UsoCFDI": "G03" 
   }, 
   "Conceptos": [ 
     { 
       "Impuestos": { 
         "Traslados": [ 
           { 
             "Base": 3499.99, 
             "Impuesto": "002", 
             "TipoFactor": "Tasa", 
             "TasaOCuota": "0.160000", 
             "Importe": 559.9984 
           } 
         ], 
         "Retenciones": [ 
           { 
             "Base": 3499.99, 
             "Impuesto": "001", 
             "TipoFactor": "Tasa", 
             "TasaOCuota": 0.0125, 
             "Importe": 43.7498 
           } 
         ] 
       }, 
       "ClaveProdServ": "80101508", 
       "NoIdentificacion": "84111506", 
       "Cantidad": 1, 
       "ClaveUnidad": "E48", 
       "Unidad": "SERVICIO", 
       "Descripcion": "SERVICIOS DE ASESORAMIENTO SOBRE INTELIGENCIA EMPRESARIAL", 
       "ValorUnitario": 3499.99, 
       "Importe": 3499.99, 
       "ObjetoImp": "02" 
     } 
   ], 
   "Impuestos": { 
     "Retenciones": [ 
       { 
         "Impuesto": "001", 
         "Importe": 43.75 
       } 
     ], 
     "Traslados": [ 
       { 
         "Base": 3499.99, 
         "Impuesto": "002", 
         "TipoFactor": "Tasa", 
         "TasaOCuota": "0.160000", 
         "Importe": 560.00 
       } 
     ], 
     "TotalImpuestosRetenidos": 43.75, 
     "TotalImpuestosTrasladados": 560.00 
   } 
 }`;
                            navigator.clipboard.writeText(val);
                            showSuccess('Copiado', 'JSON Resico copiado');
                          }}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                        </Button>
                      </div>
                    </TabsContent>

                    <TabsContent value="tasa-0" className="space-y-2">
                      <div className="relative">
                        <Textarea
                          readOnly
                          rows={38}
                          className="font-mono text-xs pr-12"
                          value={`{ 
     "Version": "4.0", 
     "Serie": "Serie", 
     "Folio": "Folio", 
     "Fecha": "2024-04-29T00:00:00", 
     "Sello": "", 
     "CondicionesDePago": "CondicionesDePago", 
     "SubTotal": "200", 
     "Moneda": "MXN", 
     "Total": "200.00", 
     "TipoDeComprobante": "I", 
     "Exportacion": "01", 
     "MetodoPago": "PPD", 
     "FormaPago": "99", 
     "LugarExpedicion": "20000", 
     "Emisor": { 
         "Rfc": "EKU9003173C9", 
         "Nombre": "ESCUELA KEMPER URGATE", 
         "RegimenFiscal": "601" 
     }, 
     "Receptor": { 
         "Rfc": "URE180429TM6", 
         "Nombre": "UNIVERSIDAD ROBOTICA ESPAÑOLA", 
         "DomicilioFiscalReceptor": "86991", 
         "RegimenFiscalReceptor": "601", 
         "UsoCFDI": "G01" 
     }, 
     "Conceptos": [ 
         { 
             "ClaveProdServ": "50211503", 
             "Cantidad": "1", 
             "ClaveUnidad": "H87", 
             "Unidad": "Pieza", 
             "Descripcion": "Cigarros", 
             "ValorUnitario": "200.00", 
             "Importe": "200.00", 
             "ObjetoImp": "02", 
             "Impuestos": { 
                 "Traslados": [ 
                     { 
                         "Base": "200.00", 
                         "Impuesto": "002", 
                         "TipoFactor": "Tasa", 
                         "TasaOCuota": "0.000000", 
                         "Importe": "0.00" 
                     } 
                 ], 
                 "Retenciones": [ 
                     { 
                         "Base": "200.00", 
                         "Impuesto": "001", 
                         "TipoFactor": "Tasa", 
                         "TasaOCuota": "0.000000", 
                         "Importe": "0.00" 
                     } 
                 ] 
             }, 
         } 
     ], 
     "Impuestos": { 
         "TotalImpuestosRetenidos": "0.00", 
         "TotalImpuestosTrasladados": "0.00", 
         "Retenciones": [ 
             { 
                 "Impuesto": "001", 
                 "Importe": "0.00" 
             } 
         ], 
         "Traslados": [ 
             { 
                 "Base": "200.00", 
                 "Impuesto": "002", 
                 "TipoFactor": "Tasa", 
                 "TasaOCuota": "0.000000", 
                 "Importe": "0.00" 
             } 
         ] 
     } 
 }`}
                        />
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="absolute top-2 right-2 h-8 w-8 p-0"
                          onClick={() => {
                            const val = `{ 
     "Version": "4.0", 
     "Serie": "Serie", 
     "Folio": "Folio", 
     "Fecha": "2024-04-29T00:00:00", 
     "Sello": "", 
     "CondicionesDePago": "CondicionesDePago", 
     "SubTotal": "200", 
     "Moneda": "MXN", 
     "Total": "200.00", 
     "TipoDeComprobante": "I", 
     "Exportacion": "01", 
     "MetodoPago": "PPD", 
     "FormaPago": "99", 
     "LugarExpedicion": "20000", 
     "Emisor": { 
         "Rfc": "EKU9003173C9", 
         "Nombre": "ESCUELA KEMPER URGATE", 
         "RegimenFiscal": "601" 
     }, 
     "Receptor": { 
         "Rfc": "URE180429TM6", 
         "Nombre": "UNIVERSIDAD ROBOTICA ESPAÑOLA", 
         "DomicilioFiscalReceptor": "86991", 
         "RegimenFiscalReceptor": "601", 
         "UsoCFDI": "G01" 
     }, 
     "Conceptos": [ 
         { 
             "ClaveProdServ": "50211503", 
             "Cantidad": "1", 
             "ClaveUnidad": "H87", 
             "Unidad": "Pieza", 
             "Descripcion": "Cigarros", 
             "ValorUnitario": "200.00", 
             "Importe": "200.00", 
             "ObjetoImp": "02", 
             "Impuestos": { 
                 "Traslados": [ 
                     { 
                         "Base": "200.00", 
                         "Impuesto": "002", 
                         "TipoFactor": "Tasa", 
                         "TasaOCuota": "0.000000", 
                         "Importe": "0.00" 
                     } 
                 ], 
                 "Retenciones": [ 
                     { 
                         "Base": "200.00", 
                         "Impuesto": "001", 
                         "TipoFactor": "Tasa", 
                         "TasaOCuota": "0.000000", 
                         "Importe": "0.00" 
                     } 
                 ] 
             }, 
         } 
     ], 
     "Impuestos": { 
         "TotalImpuestosRetenidos": "0.00", 
         "TotalImpuestosTrasladados": "0.00", 
         "Retenciones": [ 
             { 
                 "Impuesto": "001", 
                 "Importe": "0.00" 
             } 
         ], 
         "Traslados": [ 
             { 
                 "Base": "200.00", 
                 "Impuesto": "002", 
                 "TipoFactor": "Tasa", 
                 "TasaOCuota": "0.000000", 
                 "Importe": "0.00" 
             } 
         ] 
     } 
 }`;
                            navigator.clipboard.writeText(val);
                            showSuccess('Copiado', 'JSON Tasa 0% copiado');
                          }}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                        </Button>
                      </div>
                    </TabsContent>

                    <TabsContent value="tasa-0-ret" className="space-y-2">
                      <div className="relative">
                        <Textarea
                          readOnly
                          rows={46}
                          className="font-mono text-xs pr-12"
                          value={`{ 
    "Version": "4.0", 
    "Serie": "Serie", 
    "Folio": "Folio", 
    "Fecha": "2024-04-29T00:00:00", 
    "CondicionesDePago": "CondicionesDePago", 
    "SubTotal": "200", 
    "Moneda": "MXN", 
    "Total": "199.80", 
    "TipoDeComprobante": "I", 
    "Exportacion": "01", 
    "MetodoPago": "PPD", 
    "FormaPago": "99", 
    "LugarExpedicion": "20000", 
    "Emisor": { 
       "Rfc": "EKU9003173C9", 
       "Nombre": "ESCUELA KEMPER URGATE", 
       "RegimenFiscal": "601" 
    }, 
    "Receptor": { 
       "Rfc": "URE180429TM6", 
       "Nombre": "UNIVERSIDAD ROBOTICA ESPAÑOLA", 
       "DomicilioFiscalReceptor": "86991", 
       "RegimenFiscalReceptor": "601", 
       "UsoCFDI": "G01" 
    }, 
    "Conceptos": [ 
       { 
          "ClaveProdServ": "50211503", 
          "Cantidad": "1", 
          "ClaveUnidad": "H87", 
          "Unidad": "Pieza", 
          "Descripcion": "Cigarros", 
          "ValorUnitario": "200.00", 
          "Importe": "200.00", 
          "ObjetoImp": "02", 
          "Impuestos": { 
             "Traslados": [ 
                { 
                   "Base": "200.00", 
                   "Impuesto": "002", 
                   "TipoFactor": "Tasa", 
                   "TasaOCuota": "0.000000", 
                   "Importe": "0.00" 
                } 
             ], 
             "Retenciones": [ 
                { 
                   "Base": "1", 
                   "Impuesto": "001", 
                   "TipoFactor": "Tasa", 
                   "TasaOCuota": "0.100000", 
                   "Importe": "0.10" 
                }, 
                { 
                   "Base": "1", 
                   "Impuesto": "002", 
                   "TipoFactor": "Tasa", 
                   "TasaOCuota": "0.106666", 
                   "Importe": "0.10" 
                } 
             ] 
          } 
       } 
    ], 
    "Impuestos": { 
       "TotalImpuestosRetenidos": "0.20", 
       "TotalImpuestosTrasladados": "0.00", 
       "Retenciones": [ 
          { 
             "Impuesto": "001", 
             "Importe": "0.10" 
          }, 
          { 
             "Impuesto": "002", 
             "Importe": "0.10" 
          } 
       ], 
       "Traslados": [ 
          { 
             "Base": "200.00", 
             "Impuesto": "002", 
             "TipoFactor": "Tasa", 
             "TasaOCuota": "0.000000", 
             "Importe": "0.00" 
          } 
       ] 
    } 
 }`}
                        />
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="absolute top-2 right-2 h-8 w-8 p-0"
                          onClick={() => {
                            const val = `{ 
    "Version": "4.0", 
    "Serie": "Serie", 
    "Folio": "Folio", 
    "Fecha": "2024-04-29T00:00:00", 
    "CondicionesDePago": "CondicionesDePago", 
    "SubTotal": "200", 
    "Moneda": "MXN", 
    "Total": "199.80", 
    "TipoDeComprobante": "I", 
    "Exportacion": "01", 
    "MetodoPago": "PPD", 
    "FormaPago": "99", 
    "LugarExpedicion": "20000", 
    "Emisor": { 
       "Rfc": "EKU9003173C9", 
       "Nombre": "ESCUELA KEMPER URGATE", 
       "RegimenFiscal": "601" 
    }, 
    "Receptor": { 
       "Rfc": "URE180429TM6", 
       "Nombre": "UNIVERSIDAD ROBOTICA ESPAÑOLA", 
       "DomicilioFiscalReceptor": "86991", 
       "RegimenFiscalReceptor": "601", 
       "UsoCFDI": "G01" 
    }, 
    "Conceptos": [ 
       { 
          "ClaveProdServ": "50211503", 
          "Cantidad": "1", 
          "ClaveUnidad": "H87", 
          "Unidad": "Pieza", 
          "Descripcion": "Cigarros", 
          "ValorUnitario": "200.00", 
          "Importe": "200.00", 
          "ObjetoImp": "02", 
          "Impuestos": { 
             "Traslados": [ 
                { 
                   "Base": "200.00", 
                   "Impuesto": "002", 
                   "TipoFactor": "Tasa", 
                   "TasaOCuota": "0.000000", 
                   "Importe": "0.00" 
                } 
             ], 
             "Retenciones": [ 
                { 
                   "Base": "1", 
                   "Impuesto": "001", 
                   "TipoFactor": "Tasa", 
                   "TasaOCuota": "0.100000", 
                   "Importe": "0.10" 
                }, 
                { 
                   "Base": "1", 
                   "Impuesto": "002", 
                   "TipoFactor": "Tasa", 
                   "TasaOCuota": "0.106666", 
                   "Importe": "0.10" 
                } 
             ] 
          } 
       } 
    ], 
    "Impuestos": { 
       "TotalImpuestosRetenidos": "0.20", 
       "TotalImpuestosTrasladados": "0.00", 
       "Retenciones": [ 
          { 
             "Impuesto": "001", 
             "Importe": "0.10" 
          }, 
          { 
             "Impuesto": "002", 
             "Importe": "0.10" 
          } 
       ], 
       "Traslados": [ 
          { 
             "Base": "200.00", 
             "Impuesto": "002", 
             "TipoFactor": "Tasa", 
             "TasaOCuota": "0.000000", 
             "Importe": "0.00" 
          } 
       ] 
    } 
 }`;
                            navigator.clipboard.writeText(val);
                            showSuccess('Copiado', 'JSON Tasa 0% con Retenciones copiado');
                          }}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                        </Button>
                      </div>
                    </TabsContent>

                    <TabsContent value="traslado" className="space-y-2">
                      <div className="relative">
                        <Textarea
                          readOnly
                          rows={34}
                          className="font-mono text-xs pr-12"
                          value={`{ 
   "Version": "4.0", 
   "Serie": "SW", 
   "Folio": "123455", 
   "Fecha": "2024-04-29T00:00:00", 
   "Sello": "", 
   "NoCertificado": "", 
   "Certificado": "", 
   "SubTotal": "0", 
   "Moneda": "MXN", 
   "Total": "0.00", 
   "TipoDeComprobante": "T", 
   "Exportacion": "01", 
   "LugarExpedicion": "45610", 
   "Emisor": { 
     "Rfc": "EKU9003173C9", 
     "Nombre": "ESCUELA KEMPER URGATE", 
     "RegimenFiscal": "603" 
   }, 
   "Receptor": { 
     "Rfc": "EKU9003173C9", 
     "Nombre": "ESCUELA KEMPER URGATE", 
     "DomicilioFiscalReceptor": "42501", 
     "RegimenFiscalReceptor": "601", 
     "UsoCFDI": "CP01" 
   }, 
   "Conceptos": [ 
     { 
       "ClaveProdServ": "50211503", 
       "NoIdentificacion": "None", 
       "Cantidad": "1.0", 
       "ClaveUnidad": "H87", 
       "Unidad": "Pieza", 
       "Descripcion": "Cigarros", 
       "ValorUnitario": "10.00", 
       "Importe": "10.00", 
       "ObjetoImp": "01" 
     } 
   ] 
 }`}
                        />
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="absolute top-2 right-2 h-8 w-8 p-0"
                          onClick={() => {
                            const val = `{ 
   "Version": "4.0", 
   "Serie": "SW", 
   "Folio": "123455", 
   "Fecha": "2024-04-29T00:00:00", 
   "Sello": "", 
   "NoCertificado": "", 
   "Certificado": "", 
   "SubTotal": "0", 
   "Moneda": "MXN", 
   "Total": "0.00", 
   "TipoDeComprobante": "T", 
   "Exportacion": "01", 
   "LugarExpedicion": "45610", 
   "Emisor": { 
     "Rfc": "EKU9003173C9", 
     "Nombre": "ESCUELA KEMPER URGATE", 
     "RegimenFiscal": "603" 
   }, 
   "Receptor": { 
     "Rfc": "EKU9003173C9", 
     "Nombre": "ESCUELA KEMPER URGATE", 
     "DomicilioFiscalReceptor": "42501", 
     "RegimenFiscalReceptor": "601", 
     "UsoCFDI": "CP01" 
   }, 
   "Conceptos": [ 
     { 
       "ClaveProdServ": "50211503", 
       "NoIdentificacion": "None", 
       "Cantidad": "1.0", 
       "ClaveUnidad": "H87", 
       "Unidad": "Pieza", 
       "Descripcion": "Cigarros", 
       "ValorUnitario": "10.00", 
       "Importe": "10.00", 
       "ObjetoImp": "01" 
     } 
   ] 
 }`;
                            navigator.clipboard.writeText(val);
                            showSuccess('Copiado', 'JSON Traslado copiado');
                          }}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                        </Button>
                      </div>
                    </TabsContent>

                    <TabsContent value="imp-menor-ingreso" className="space-y-2">
                      <div className="relative">
                        <Textarea
                          readOnly
                          rows={46}
                          className="font-mono text-xs pr-12"
                          value={`{ 
     "NoCertificado": "30001000000500003416", 
     "Certificado": "", 
     "Version": "4.0", 
     "Serie": "Serie", 
     "Folio": "Folio", 
     "Fecha": "2024-04-29T00:00:00", 
     "Sello": "", 
     "FormaPago": "01", 
     "CondicionesDePago": "CondicionesDePago", 
     "MetodoPago": "PUE", 
     "SubTotal": "35.00", 
     "Moneda": "MXN", 
     "Total": "35.00", 
     "TipoDeComprobante": "E", 
     "Exportacion": "01", 
     "LugarExpedicion": "20000", 
     "CfdiRelacionados": [ 
         { 
             "TipoRelacion": "01", 
             "CfdiRelacionado": [ 
                 { 
                     "UUID": "1fac4464-1111-0000-1111-cd37179db12e" 
                 }, 
                 { 
                     "UUID": "628b6113-d831-455a-907e-097821c2f48c" 
                 } 
             ] 
         } 
     ], 
     "Emisor": { 
         "Rfc": "EKU9003173C9", 
         "Nombre": "ESCUELA KEMPER URGATE", 
         "RegimenFiscal": "601" 
     }, 
     "Receptor": { 
         "Rfc": "URE180429TM6", 
         "Nombre": "UNIVERSIDAD ROBOTICA ESPAÑOLA", 
         "DomicilioFiscalReceptor": "86991", 
         "RegimenFiscalReceptor": "601", 
         "UsoCFDI": "G02" 
     }, 
     "Conceptos": [ 
         { 
             "ClaveProdServ": "84111506", 
             "Cantidad": "1.0", 
             "ClaveUnidad": "ACT", 
             "Descripcion": "10% del saldo de todos los CFDI relacionados", 
             "ValorUnitario": "35.00", 
             "Importe": "35.00", 
             "ObjetoImp": "01" 
         } 
     ] 
 }`}
                        />
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="absolute top-2 right-2 h-8 w-8 p-0"
                          onClick={() => {
                            const val = `{ 
     "NoCertificado": "30001000000500003416", 
     "Certificado": "", 
     "Version": "4.0", 
     "Serie": "Serie", 
     "Folio": "Folio", 
     "Fecha": "2024-04-29T00:00:00", 
     "Sello": "", 
     "FormaPago": "01", 
     "CondicionesDePago": "CondicionesDePago", 
     "MetodoPago": "PUE", 
     "SubTotal": "35.00", 
     "Moneda": "MXN", 
     "Total": "35.00", 
     "TipoDeComprobante": "E", 
     "Exportacion": "01", 
     "LugarExpedicion": "20000", 
     "CfdiRelacionados": [ 
         { 
             "TipoRelacion": "01", 
             "CfdiRelacionado": [ 
                 { 
                     "UUID": "1fac4464-1111-0000-1111-cd37179db12e" 
                 }, 
                 { 
                     "UUID": "628b6113-d831-455a-907e-097821c2f48c" 
                 } 
             ] 
         } 
     ], 
     "Emisor": { 
         "Rfc": "EKU9003173C9", 
         "Nombre": "ESCUELA KEMPER URGATE", 
         "RegimenFiscal": "601" 
     }, 
     "Receptor": { 
         "Rfc": "URE180429TM6", 
         "Nombre": "UNIVERSIDAD ROBOTICA ESPAÑOLA", 
         "DomicilioFiscalReceptor": "86991", 
         "RegimenFiscalReceptor": "601", 
         "UsoCFDI": "G02" 
     }, 
     "Conceptos": [ 
         { 
             "ClaveProdServ": "84111506", 
             "Cantidad": "1.0", 
             "ClaveUnidad": "ACT", 
             "Descripcion": "10% del saldo de todos los CFDI relacionados", 
             "ValorUnitario": "35.00", 
             "Importe": "35.00", 
             "ObjetoImp": "01" 
         } 
     ] 
 }`;
                            navigator.clipboard.writeText(val);
                            showSuccess('Copiado', 'JSON Importe Menor CFDI Ingreso copiado');
                          }}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                        </Button>
                      </div>
                    </TabsContent>

                    <TabsContent value="kit-parte" className="space-y-2">
                      <div className="relative">
                        <Textarea
                          readOnly
                          rows={28}
                          className="font-mono text-xs pr-12"
                          value={`{ 
   "Version": "4.0", 
   "FormaPago":"01", 
   "Serie": "SW", 
   "Folio": "123456", 
   "Fecha": "2024-04-29T00:00:00", 
   "Sello": "", 
   "NoCertificado": "", 
   "Certificado": "", 
   "CondicionesDePago": "CondicionesDePago", 
   "MetodoPago": "PUE", 
   "SubTotal": "10.00", 
   "Descuento": "0.00", 
   "Moneda": "MXN", 
   "Total": "10.00", 
   "TipoDeComprobante": "I", 
   "Exportacion": "01", 
   "LugarExpedicion": "45610", 
   "CfdiRelacionados": [ 
     { 
       "TipoRelacion": "01", 
       "CfdiRelacionado": [ 
         { 
           "UUID": "1fac4464-1111-0000-1111-cd37179db12e" 
         } 
       ] 
     } 
   ], 
   "Emisor": { 
     "Rfc": "EKU9003173C9", 
     "Nombre": "ESCUELA KEMPER URGATE", 
     "RegimenFiscal": "603" 
   }, 
   "Receptor": { 
     "Rfc": "CACX7605101P8", 
     "Nombre": "XOCHILT CASAS CHAVEZ", 
     "DomicilioFiscalReceptor": "36257", 
     "RegimenFiscalReceptor": "612", 
     "UsoCFDI": "CP01" 
   }, 
   "Conceptos": [ 
     { 
       "ClaveProdServ": "50211503", 
       "NoIdentificacion": "None", 
       "Cantidad": "1.0", 
       "ClaveUnidad": "H87", 
       "Unidad": "Pieza", 
       "Descripcion": "Cigarros", 
       "ValorUnitario": "10.00", 
       "Importe": "10.00", 
       "Descuento": "0.00", 
       "ObjetoImp": "01", 
       "Parte": [ 
         { 
           "ClaveProdServ": "51241200", 
           "NoIdentificacion": "IM0071", 
           "Cantidad": "1", 
           "Unidad": "Pieza", 
           "Descripcion": "25311FM00239 (LUARIL ETER SULFATO DE SODIO VEHICULO CBP 300ML), ACEITE AJONJOLI 150CC, ACEITE DE ALMENDRAS DULCES 150CC, TALCO 10GR, OXIDO DE ZINC 10GR.", 
           "ValorUnitario": "736.89", 
           "Importe": "736.89" 
         } 
       ] 
     } 
   ] 
 }`}
                        />
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="absolute top-2 right-2 h-8 w-8 p-0"
                          onClick={() => {
                             const val = `{ 
   "Version": "4.0", 
   "FormaPago":"01", 
   "Serie": "SW", 
   "Folio": "123456", 
   "Fecha": "2024-04-29T00:00:00", 
   "Sello": "", 
   "NoCertificado": "", 
   "Certificado": "", 
   "CondicionesDePago": "CondicionesDePago", 
   "MetodoPago": "PUE", 
   "SubTotal": "10.00", 
   "Descuento": "0.00", 
   "Moneda": "MXN", 
   "Total": "10.00", 
   "TipoDeComprobante": "I", 
   "Exportacion": "01", 
   "LugarExpedicion": "45610", 
   "CfdiRelacionados": [ 
     { 
       "TipoRelacion": "01", 
       "CfdiRelacionado": [ 
         { 
           "UUID": "1fac4464-1111-0000-1111-cd37179db12e" 
         } 
       ] 
     } 
   ], 
   "Emisor": { 
     "Rfc": "EKU9003173C9", 
     "Nombre": "ESCUELA KEMPER URGATE", 
     "RegimenFiscal": "603" 
   }, 
   "Receptor": { 
     "Rfc": "CACX7605101P8", 
     "Nombre": "XOCHILT CASAS CHAVEZ", 
     "DomicilioFiscalReceptor": "36257", 
     "RegimenFiscalReceptor": "612", 
     "UsoCFDI": "CP01" 
   }, 
   "Conceptos": [ 
     { 
       "ClaveProdServ": "50211503", 
       "NoIdentificacion": "None", 
       "Cantidad": "1.0", 
       "ClaveUnidad": "H87", 
       "Unidad": "Pieza", 
       "Descripcion": "Cigarros", 
       "ValorUnitario": "10.00", 
       "Importe": "10.00", 
       "Descuento": "0.00", 
       "ObjetoImp": "01", 
       "Parte": [ 
         { 
           "ClaveProdServ": "51241200", 
           "NoIdentificacion": "IM0071", 
           "Cantidad": "1", 
           "Unidad": "Pieza", 
           "Descripcion": "25311FM00239 (LUARIL ETER SULFATO DE SODIO VEHICULO CBP 300ML), ACEITE AJONJOLI 150CC, ACEITE DE ALMENDRAS DULCES 150CC, TALCO 10GR, OXIDO DE ZINC 10GR.", 
           "ValorUnitario": "736.89", 
           "Importe": "736.89" 
         } 
       ] 
     } 
   ] 
 }`;
                             navigator.clipboard.writeText(val);
                             showSuccess('Copiado', 'JSON Kit (Parte) copiado');
                          }}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                        </Button>
                      </div>
                    </TabsContent>

                    <TabsContent value="sin-imp" className="space-y-2">
                      <div className="relative">
                        <Textarea
                          readOnly
                          rows={22}
                          className="font-mono text-xs pr-12"
                          value={`{ 
   "Version": "4.0", 
   "FormaPago": "01", 
   "Serie": "SW", 
   "Folio": "123456", 
   "Fecha": "2024-04-29T00:00:00", 
   "MetodoPago":"PUE", 
   "Sello": "", 
   "NoCertificado": "", 
   "Certificado": "", 
   "CondicionesDePago": "CondicionesDePago", 
   "SubTotal": "10.00", 
   "Descuento": "0.00", 
   "Moneda": "MXN", 
   "Total": "10.00", 
   "TipoDeComprobante": "I", 
   "Exportacion": "01", 
   "LugarExpedicion": "45610", 
   "Emisor": { 
     "Rfc": "EKU9003173C9", 
     "Nombre": "ESCUELA KEMPER URGATE", 
     "RegimenFiscal": "603" 
   }, 
   "Receptor": { 
     "Rfc": "URE180429TM6", 
     "Nombre": "UNIVERSIDAD ROBOTICA ESPAÑOLA", 
     "DomicilioFiscalReceptor": "86991", 
     "RegimenFiscalReceptor": "601", 
     "UsoCFDI": "CP01" 
   }, 
   "Conceptos": [ 
     { 
       "ClaveProdServ": "50211503", 
       "NoIdentificacion": "None", 
       "Cantidad": "1.0", 
       "ClaveUnidad": "H87", 
       "Unidad": "Pieza", 
       "Descripcion": "Cigarros", 
       "ValorUnitario": "10.00", 
       "Importe": "10.00", 
       "Descuento": "0.00", 
       "ObjetoImp": "01" 
     } 
   ] 
 }`}
                        />
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="absolute top-2 right-2 h-8 w-8 p-0"
                          onClick={() => {
                             const val = `{ 
   "Version": "4.0", 
   "FormaPago": "01", 
   "Serie": "SW", 
   "Folio": "123456", 
   "Fecha": "2024-04-29T00:00:00", 
   "MetodoPago":"PUE", 
   "Sello": "", 
   "NoCertificado": "", 
   "Certificado": "", 
   "CondicionesDePago": "CondicionesDePago", 
   "SubTotal": "10.00", 
   "Descuento": "0.00", 
   "Moneda": "MXN", 
   "Total": "10.00", 
   "TipoDeComprobante": "I", 
   "Exportacion": "01", 
   "LugarExpedicion": "45610", 
   "Emisor": { 
     "Rfc": "EKU9003173C9", 
     "Nombre": "ESCUELA KEMPER URGATE", 
     "RegimenFiscal": "603" 
   }, 
   "Receptor": { 
     "Rfc": "URE180429TM6", 
     "Nombre": "UNIVERSIDAD ROBOTICA ESPAÑOLA", 
     "DomicilioFiscalReceptor": "86991", 
     "RegimenFiscalReceptor": "601", 
     "UsoCFDI": "CP01" 
   }, 
   "Conceptos": [ 
     { 
       "ClaveProdServ": "50211503", 
       "NoIdentificacion": "None", 
       "Cantidad": "1.0", 
       "ClaveUnidad": "H87", 
       "Unidad": "Pieza", 
       "Descripcion": "Cigarros", 
       "ValorUnitario": "10.00", 
       "Importe": "10.00", 
       "Descuento": "0.00", 
       "ObjetoImp": "01" 
     } 
   ] 
 }`;
                             navigator.clipboard.writeText(val);
                             showSuccess('Copiado', 'JSON sin impuestos copiado');
                          }}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                        </Button>
                      </div>
                    </TabsContent>

                    <TabsContent value="relacionados" className="space-y-2">
                      <div className="relative">
                        <Textarea
                          readOnly
                          rows={20}
                          className="font-mono text-xs pr-12"
                          value={`{ 
     "Version": "4.0", 
     "Serie": "Serie", 
     "Folio": "189", 
     "Fecha": "2024-04-29T00:00:00", 
     "Sello": "", 
     "NoCertificado": "", 
     "Certificado": "", 
     "MetodoPago": "PPD", 
     "SubTotal": "1308.35", 
     "Descuento": "0.00", 
     "Moneda": "MXN", 
     "Total": "1517.69", 
     "TipoDeComprobante": "I", 
     "FormaPago": "99", 
     "Exportacion": "01", 
     "LugarExpedicion": "44520", 
     "Emisor": { 
         "Rfc": "EKU9003173C9", 
         "Nombre": "ESCUELA KEMPER URGATE", 
         "RegimenFiscal": "601" 
     }, 
     "Receptor": { 
         "Rfc": "XIA190128J61", 
         "Nombre": "XENON INDUSTRIAL ARTICLES", 
         "DomicilioFiscalReceptor": "76343", 
         "RegimenFiscalReceptor": "601", 
         "UsoCFDI": "G03" 
     }, 
     "Conceptos": [ 
         { 
             "ClaveProdServ": "84111506", 
             "NoIdentificacion": "1", 
             "Cantidad": "1", 
             "ClaveUnidad": "ACT", 
             "Unidad": "ACT", 
             "Descripcion": "84111506 DESCUENTOS Y BONIFICACIONES GAS NATURAL", 
             "ValorUnitario": "1308.35", 
             "Importe": "1308.35", 
             "Descuento": "0.00", 
             "ObjetoImp": "02", 
             "Impuestos": { 
                 "Traslados": [ 
                     { 
                         "Base": "1308.350000", 
                         "Importe": "209.34", 
                         "Impuesto": "002", 
                         "TasaOCuota": "0.160000", 
                         "TipoFactor": "Tasa" 
                     } 
                 ]
             } 
         } 
     ], 
     "Impuestos": { 
         "TotalImpuestosTrasladados": "209.34", 
         "Traslados": [ 
             { 
                 "Base": "1308.35", 
                 "Importe": "209.34", 
                 "Impuesto": "002", 
                 "TasaOCuota": "0.160000", 
                 "TipoFactor": "Tasa" 
             } 
         ] 
     }, 
     "cfdiRelacionados": [ 
         { 
             "tipoRelacion": "01", 
             "cfdiRelacionado": [ 
                 { 
                     "uuid": "6c76a910-2115-4a2c-bf15-e67c1505dd21" 
                 } 
             ] 
         }, 
         { 
             "tipoRelacion": "02", 
             "cfdiRelacionado": [ 
                 { 
                     "uuid": "6c76a910-2115-4a2c-bf15-e67c1505bb22" 
                 } 
             ] 
         } 
     ] 
 }`}
                        />
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="absolute top-2 right-2 h-8 w-8 p-0"
                          onClick={() => {
                             const val = `{ 
     "Version": "4.0", 
     "Serie": "Serie", 
     "Folio": "189", 
     "Fecha": "2024-04-29T00:00:00", 
     "Sello": "", 
     "NoCertificado": "", 
     "Certificado": "", 
     "MetodoPago": "PPD", 
     "SubTotal": "1308.35", 
     "Descuento": "0.00", 
     "Moneda": "MXN", 
     "Total": "1517.69", 
     "TipoDeComprobante": "I", 
     "FormaPago": "99", 
     "Exportacion": "01", 
     "LugarExpedicion": "44520", 
     "Emisor": { 
         "Rfc": "EKU9003173C9", 
         "Nombre": "ESCUELA KEMPER URGATE", 
         "RegimenFiscal": "601" 
     }, 
     "Receptor": { 
         "Rfc": "XIA190128J61", 
         "Nombre": "XENON INDUSTRIAL ARTICLES", 
         "DomicilioFiscalReceptor": "76343", 
         "RegimenFiscalReceptor": "601", 
         "UsoCFDI": "G03" 
     }, 
     "Conceptos": [ 
         { 
             "ClaveProdServ": "84111506", 
             "NoIdentificacion": "1", 
             "Cantidad": "1", 
             "ClaveUnidad": "ACT", 
             "Unidad": "ACT", 
             "Descripcion": "84111506 DESCUENTOS Y BONIFICACIONES GAS NATURAL", 
             "ValorUnitario": "1308.35", 
             "Importe": "1308.35", 
             "Descuento": "0.00", 
             "ObjetoImp": "02", 
             "Impuestos": { 
                 "Traslados": [ 
                     { 
                         "Base": "1308.350000", 
                         "Importe": "209.34", 
                         "Impuesto": "002", 
                         "TasaOCuota": "0.160000", 
                         "TipoFactor": "Tasa" 
                     } 
                 ]
             } 
         } 
     ], 
     "Impuestos": { 
         "TotalImpuestosTrasladados": "209.34", 
         "Traslados": [ 
             { 
                 "Base": "1308.35", 
                 "Importe": "209.34", 
                 "Impuesto": "002", 
                 "TasaOCuota": "0.160000", 
                 "TipoFactor": "Tasa" 
             } 
         ] 
     }, 
     "cfdiRelacionados": [ 
         { 
             "tipoRelacion": "01", 
             "cfdiRelacionado": [ 
                 { 
                     "uuid": "6c76a910-2115-4a2c-bf15-e67c1505dd21" 
                 } 
             ] 
         }, 
         { 
             "tipoRelacion": "02", 
             "cfdiRelacionado": [ 
                 { 
                     "uuid": "6c76a910-2115-4a2c-bf15-e67c1505bb22" 
                 } 
             ] 
         } 
     ] 
 }`;
                             navigator.clipboard.writeText(val);
                             showSuccess('Copiado', 'JSON relacionados copiado');
                          }}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                        </Button>
                      </div>
                    </TabsContent>

                    <TabsContent value="basic" className="space-y-2">
                       <div className="relative">
                        <Textarea
                          readOnly
                          rows={15}
                          className="font-mono text-xs pr-12"
                          value={`{
  "emisor": { 
    "rfc": "XAXX010101000", 
    "nombre": "EMPRESA DEMO" 
  },
  "receptor": { 
    "rfc": "COSC8001137NA", 
    "nombre": "CLIENTE MOSTRADOR", 
    "usoCfdi": "G01" 
  },
  "comprobante": {
    "lugarExpedicion": "01000",
    "metodoPago": "PUE",
    "formaPago": "01",
    "fecha": "2025-12-15T12:00:00Z"
  },
  "conceptos": [
    {
      "claveProdServ": "01010101",
      "cantidad": 1,
      "claveUnidad": "H87",
      "descripcion": "Servicio de Consultoría",
      "valorUnitario": 1000.00,
      "importe": 1000.00,
      "objetoImp": "02",
      "impuestos": {
        "traslados": [
          { 
            "impuesto": "002", 
            "tipoFactor": "Tasa", 
            "tasaOCuota": "0.16", 
            "base": "1000.00", 
            "importe": "160.00" 
          }
        ]
      }
    }
  ]
}`}
                        />
                         <Button 
                          size="sm" 
                          variant="ghost" 
                          className="absolute top-2 right-2 h-8 w-8 p-0"
                          onClick={() => {
                             const val = `{
  "emisor": { 
    "rfc": "XAXX010101000", 
    "nombre": "EMPRESA DEMO" 
  },
  "receptor": { 
    "rfc": "COSC8001137NA", 
    "nombre": "CLIENTE MOSTRADOR", 
    "usoCfdi": "G01" 
  },
  "comprobante": {
    "lugarExpedicion": "01000",
    "metodoPago": "PUE",
    "formaPago": "01",
    "fecha": "2025-12-15T12:00:00Z"
  },
  "conceptos": [
    {
      "claveProdServ": "01010101",
      "cantidad": 1,
      "claveUnidad": "H87",
      "descripcion": "Servicio de Consultoría",
      "valorUnitario": 1000.00,
      "importe": 1000.00,
      "objetoImp": "02",
      "impuestos": {
        "traslados": [
          { 
            "impuesto": "002", 
            "tipoFactor": "Tasa", 
            "tasaOCuota": "0.16", 
            "base": "1000.00", 
            "importe": "160.00" 
          }
        ]
      }
    }
  ]
}`;
                             navigator.clipboard.writeText(val);
                             showSuccess('Copiado', 'JSON básico copiado');
                          }}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                        </Button>
                      </div>
                    </TabsContent>

                    <TabsContent value="advanced" className="space-y-2">
                      <div className="relative">
                        <Textarea
                          readOnly
                          rows={20}
                          className="font-mono text-xs pr-12"
                          value={`{
  "emisor": { 
    "rfc": "XAXX010101000", 
    "nombre": "EMPRESA DEMO" 
  },
  "receptor": { 
    "rfc": "COSC8001137NA", 
    "nombre": "CLIENTE DE PRUEBA", 
    "usoCfdi": "G01" 
  },
  "comprobante": {
    "lugarExpedicion": "01000",
    "metodoPago": "PUE",
    "formaPago": "01",
    "fecha": "2025-12-15T12:00:00Z",
    "moneda": "MXN",
    "impuestos": {
      "traslados": [
        { "impuesto": "002", "tipoFactor": "Tasa", "tasaOCuota": "0.16", "importe": "160.00" }
      ]
    }
  },
  "conceptos": [
    {
      "claveProdServ": "01010101",
      "cantidad": 1,
      "claveUnidad": "E48",
      "descripcion": "Desarrollo de Software",
      "valorUnitario": 1000.00,
      "importe": 1000.00,
      "objetoImp": "02",
      "impuestos": {
        "traslados": [
          { "impuesto": "002", "tipoFactor": "Tasa", "tasaOCuota": "0.16", "base": "1000.00", "importe": "160.00" }
        ]
      }
    }
  ],
  "cfdiRelacionados": [
    { 
      "tipoRelacion": "01", 
      "uuids": ["550e8400-e29b-41d4-a716-446655440000"] 
    }
  ]
}`}
                        />
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="absolute top-2 right-2 h-8 w-8 p-0"
                          onClick={() => {
                             const val = `{
  "emisor": { 
    "rfc": "XAXX010101000", 
    "nombre": "EMPRESA DEMO" 
  },
  "receptor": { 
    "rfc": "COSC8001137NA", 
    "nombre": "CLIENTE DE PRUEBA", 
    "usoCfdi": "G01" 
  },
  "comprobante": {
    "lugarExpedicion": "01000",
    "metodoPago": "PUE",
    "formaPago": "01",
    "fecha": "2025-12-15T12:00:00Z",
    "moneda": "MXN",
    "impuestos": {
      "traslados": [
        { "impuesto": "002", "tipoFactor": "Tasa", "tasaOCuota": "0.16", "importe": "160.00" }
      ]
    }
  },
  "conceptos": [
    {
      "claveProdServ": "01010101",
      "cantidad": 1,
      "claveUnidad": "E48",
      "descripcion": "Desarrollo de Software",
      "valorUnitario": 1000.00,
      "importe": 1000.00,
      "objetoImp": "02",
      "impuestos": {
        "traslados": [
          { "impuesto": "002", "tipoFactor": "Tasa", "tasaOCuota": "0.16", "base": "1000.00", "importe": "160.00" }
        ]
      }
    }
  ],
  "cfdiRelacionados": [
    { 
      "tipoRelacion": "01", 
      "uuids": ["550e8400-e29b-41d4-a716-446655440000"] 
    }
  ]
}`;
                             navigator.clipboard.writeText(val);
                             showSuccess('Copiado', 'JSON avanzado copiado');
                          }}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                        </Button>
                      </div>
                    </TabsContent>

                    <TabsContent value="predial" className="space-y-2">
                      <div className="relative">
                        <Textarea
                          readOnly
                          rows={20}
                          className="font-mono text-xs pr-12"
                          value={`{ 
     "Version": "4.0", 
     "FormaPago": "01", 
     "Serie": "SW", 
     "Folio": "123456", 
     "Fecha": "2024-05-20T00:00:00", 
     "Sello": "", 
     "NoCertificado": "", 
     "MetodoPago": "PUE", 
     "Certificado": "", 
     "CondicionesDePago": "CondicionesDePago", 
     "SubTotal": "200.00", 
     "Descuento": "0.00", 
     "Moneda": "MXN", 
     "Total": "180.00", 
     "TipoDeComprobante": "I", 
     "Exportacion": "01", 
     "LugarExpedicion": "45610", 
     "Emisor": { 
         "Rfc": "EKU9003173C9", 
         "Nombre": "ESCUELA KEMPER URGATE", 
         "RegimenFiscal": "603" 
     }, 
     "Receptor": { 
         "Rfc": "URE180429TM6", 
         "Nombre": "UNIVERSIDAD ROBOTICA ESPAÑOLA", 
         "DomicilioFiscalReceptor": "86991", 
         "RegimenFiscalReceptor": "601", 
         "UsoCFDI": "CP01" 
     }, 
     "Conceptos": [ 
         { 
             "ClaveProdServ": "50211503", 
             "NoIdentificacion": "None", 
             "Cantidad": "1.0", 
             "ClaveUnidad": "H87", 
             "Unidad": "Pieza", 
             "Descripcion": "Cigarros", 
             "ValorUnitario": "200.00", 
             "Importe": "200.00", 
             "Descuento": "0.00", 
             "ObjetoImp": "02", 
             "Impuestos": { 
                 "Retenciones": [ 
                     { 
                         "Base": "200.00", 
                         "Impuesto": "001", 
                         "TipoFactor": "Tasa", 
                         "TasaOCuota": "0.100000", 
                         "Importe": "20.00" 
                     } 
                 ] 
             }, 
             "CuentaPredial": [{ 
                 "Numero": "aB3cD4eF5gH6iJ7kL8mN9oP0" 
             }] 
         } 
     ], 
     "Impuestos": { 
         "TotalImpuestosRetenidos": "20.00", 
         "Retenciones": [ 
             { 
                 "Impuesto": "001", 
                 "Importe": "20.00" 
             } 
         ] 
     } 
 }`}
                        />
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="absolute top-2 right-2 h-8 w-8 p-0"
                          onClick={() => {
                             const val = `{ 
     "Version": "4.0", 
     "FormaPago": "01", 
     "Serie": "SW", 
     "Folio": "123456", 
     "Fecha": "2024-05-20T00:00:00", 
     "Sello": "", 
     "NoCertificado": "", 
     "MetodoPago": "PUE", 
     "Certificado": "", 
     "CondicionesDePago": "CondicionesDePago", 
     "SubTotal": "200.00", 
     "Descuento": "0.00", 
     "Moneda": "MXN", 
     "Total": "180.00", 
     "TipoDeComprobante": "I", 
     "Exportacion": "01", 
     "LugarExpedicion": "45610", 
     "Emisor": { 
         "Rfc": "EKU9003173C9", 
         "Nombre": "ESCUELA KEMPER URGATE", 
         "RegimenFiscal": "603" 
     }, 
     "Receptor": { 
         "Rfc": "URE180429TM6", 
         "Nombre": "UNIVERSIDAD ROBOTICA ESPAÑOLA", 
         "DomicilioFiscalReceptor": "86991", 
         "RegimenFiscalReceptor": "601", 
         "UsoCFDI": "CP01" 
     }, 
     "Conceptos": [ 
         { 
             "ClaveProdServ": "50211503", 
             "NoIdentificacion": "None", 
             "Cantidad": "1.0", 
             "ClaveUnidad": "H87", 
             "Unidad": "Pieza", 
             "Descripcion": "Cigarros", 
             "ValorUnitario": "200.00", 
             "Importe": "200.00", 
             "Descuento": "0.00", 
             "ObjetoImp": "02", 
             "Impuestos": { 
                 "Retenciones": [ 
                     { 
                         "Base": "200.00", 
                         "Impuesto": "001", 
                         "TipoFactor": "Tasa", 
                         "TasaOCuota": "0.100000", 
                         "Importe": "20.00" 
                     } 
                 ] 
             }, 
             "CuentaPredial": [{ 
                 "Numero": "aB3cD4eF5gH6iJ7kL8mN9oP0" 
             }] 
         } 
     ], 
     "Impuestos": { 
         "TotalImpuestosRetenidos": "20.00", 
         "Retenciones": [ 
             { 
                 "Impuesto": "001", 
                 "Importe": "20.00" 
             } 
         ] 
     } 
 }`;
                             navigator.clipboard.writeText(val);
                             showSuccess('Copiado', 'JSON predial copiado');
                          }}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                        </Button>
                      </div>
                    </TabsContent>

                    <TabsContent value="terceros" className="space-y-2">
                      <div className="relative">
                        <Textarea
                          readOnly
                          rows={20}
                          className="font-mono text-xs pr-12"
                          value={`{ 
   "Version": "4.0", 
   "FormaPago":"01", 
   "Serie": "SW", 
   "Folio": "123456", 
   "Fecha": "2024-04-29T00:00:00", 
   "Sello": "", 
   "NoCertificado": "", 
   "MetodoPago":"PUE", 
   "Certificado": "", 
   "CondicionesDePago": "CondicionesDePago", 
   "SubTotal": "200.00", 
   "Descuento": "0.00", 
   "Moneda": "MXN", 
   "Total": "180.00", 
   "TipoDeComprobante": "I", 
   "Exportacion": "01", 
   "LugarExpedicion": "45610", 
   "Emisor": { 
     "Rfc": "EKU9003173C9", 
     "Nombre": "ESCUELA KEMPER URGATE", 
     "RegimenFiscal": "603" 
   }, 
   "Receptor": { 
     "Rfc": "URE180429TM6", 
     "Nombre": "UNIVERSIDAD ROBOTICA ESPAÑOLA", 
     "DomicilioFiscalReceptor": "86991", 
     "RegimenFiscalReceptor": "601", 
     "UsoCFDI": "CP01" 
   }, 
   "Conceptos": [ 
     { 
       "ClaveProdServ": "50211503", 
       "NoIdentificacion": "None", 
       "Cantidad": "1.0", 
       "ClaveUnidad": "H87", 
       "Unidad": "Pieza", 
       "Descripcion": "Cigarros", 
       "ValorUnitario": "200.00", 
       "Importe": "200.00", 
       "Descuento": "0.00", 
       "ObjetoImp": "02", 
       "Impuestos": { 
         "Retenciones": [ 
           { 
             "Base": "200.00", 
             "Impuesto": "001", 
             "TipoFactor": "Tasa", 
             "TasaOCuota": "0.100000", 
             "Importe": "20.00" 
           } 
         ] 
       }, 
       "ACuentaTerceros": { 
         "RfcACuentaTerceros": "CACX7605101P8", 
         "NombreACuentaTerceros": "XOCHILT CASAS CHAVEZ", 
         "RegimenFiscalACuentaTerceros": "601", 
         "DomicilioFiscalACuentaTerceros": "36257" 
       } 
     } 
   ], 
   "Impuestos": { 
     "TotalImpuestosRetenidos": "20.00", 
     "Retenciones": [ 
       { 
         "Impuesto": "001", 
         "Importe": "20.00" 
       } 
     ] 
   } 
 }`}
                        />
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="absolute top-2 right-2 h-8 w-8 p-0"
                          onClick={() => {
                             const val = `{ 
   "Version": "4.0", 
   "FormaPago":"01", 
   "Serie": "SW", 
   "Folio": "123456", 
   "Fecha": "2024-04-29T00:00:00", 
   "Sello": "", 
   "NoCertificado": "", 
   "MetodoPago":"PUE", 
   "Certificado": "", 
   "CondicionesDePago": "CondicionesDePago", 
   "SubTotal": "200.00", 
   "Descuento": "0.00", 
   "Moneda": "MXN", 
   "Total": "180.00", 
   "TipoDeComprobante": "I", 
   "Exportacion": "01", 
   "LugarExpedicion": "45610", 
   "Emisor": { 
     "Rfc": "EKU9003173C9", 
     "Nombre": "ESCUELA KEMPER URGATE", 
     "RegimenFiscal": "603" 
   }, 
   "Receptor": { 
     "Rfc": "URE180429TM6", 
     "Nombre": "UNIVERSIDAD ROBOTICA ESPAÑOLA", 
     "DomicilioFiscalReceptor": "86991", 
     "RegimenFiscalReceptor": "601", 
     "UsoCFDI": "CP01" 
   }, 
   "Conceptos": [ 
     { 
       "ClaveProdServ": "50211503", 
       "NoIdentificacion": "None", 
       "Cantidad": "1.0", 
       "ClaveUnidad": "H87", 
       "Unidad": "Pieza", 
       "Descripcion": "Cigarros", 
       "ValorUnitario": "200.00", 
       "Importe": "200.00", 
       "Descuento": "0.00", 
       "ObjetoImp": "02", 
       "Impuestos": { 
         "Retenciones": [ 
           { 
             "Base": "200.00", 
             "Impuesto": "001", 
             "TipoFactor": "Tasa", 
             "TasaOCuota": "0.100000", 
             "Importe": "20.00" 
           } 
         ] 
       }, 
       "ACuentaTerceros": { 
         "RfcACuentaTerceros": "CACX7605101P8", 
         "NombreACuentaTerceros": "XOCHILT CASAS CHAVEZ", 
         "RegimenFiscalACuentaTerceros": "601", 
         "DomicilioFiscalACuentaTerceros": "36257" 
       } 
     } 
   ], 
   "Impuestos": { 
     "TotalImpuestosRetenidos": "20.00", 
     "Retenciones": [ 
       { 
         "Impuesto": "001", 
         "Importe": "20.00" 
       } 
     ] 
   } 
 }`;
                             navigator.clipboard.writeText(val);
                             showSuccess('Copiado', 'JSON a cuenta de terceros copiado');
                          }}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                        </Button>
                      </div>
                    </TabsContent>

                    <TabsContent value="anticipo" className="space-y-2">
                      <div className="relative">
                        <Textarea
                          readOnly
                          rows={20}
                          className="font-mono text-xs pr-12"
                          value={`{ 
     "Version": "4.0", 
     "Serie": "Serie", 
     "Folio": "Folio", 
     "Fecha": "2024-04-29T00:00:00", 
     "Sello": "", 
     "CondicionesDePago": "CondicionesDePago", 
     "SubTotal": "200", 
     "Moneda": "MXN", 
     "Total": "200.16", 
     "TipoDeComprobante": "I", 
     "Exportacion": "01", 
     "MetodoPago": "PUE", 
     "FormaPago": "01", 
     "LugarExpedicion": "20000", 
     "NoCertificado": "30001000000500003416", 
     "Certificado": "", 
     "Emisor": { 
         "Rfc": "EKU9003173C9", 
         "Nombre": "ESCUELA KEMPER URGATE", 
         "RegimenFiscal": "601" 
     }, 
     "Receptor": { 
         "Rfc": "URE180429TM6", 
         "Nombre": "UNIVERSIDAD ROBOTICA ESPAÑOLA", 
         "DomicilioFiscalReceptor": "86991", 
         "RegimenFiscalReceptor": "601", 
         "UsoCFDI": "G01" 
     }, 
     "Conceptos": [ 
         { 
             "ClaveProdServ": "84111506", 
             "Cantidad": "1", 
             "ClaveUnidad": "ACT", 
             "Unidad": "Pieza", 
             "Descripcion": "Anticipo del bien o servicio", 
             "ValorUnitario": "200.00", 
             "Importe": "200.00", 
             "ObjetoImp": "02", 
             "Impuestos": { 
                 "Traslados": [ 
                     { 
                         "Base": "1", 
                         "Importe": "0.16", 
                         "Impuesto": "002", 
                         "TasaOCuota": "0.160000", 
                         "TipoFactor": "Tasa" 
                     } 
                 ] 
             } 
         } 
     ], 
     "Impuestos": { 
         "TotalImpuestosTrasladados": "0.16", 
         "Traslados": [ 
             { 
                 "Base": "1", 
                 "Importe": "0.16", 
                 "Impuesto": "002", 
                 "TasaOCuota": "0.160000", 
                 "TipoFactor": "Tasa" 
             } 
         ] 
     } 
 }`}
                        />
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="absolute top-2 right-2 h-8 w-8 p-0"
                          onClick={() => {
                             const val = `{ 
     "Version": "4.0", 
     "Serie": "Serie", 
     "Folio": "Folio", 
     "Fecha": "2024-04-29T00:00:00", 
     "Sello": "", 
     "CondicionesDePago": "CondicionesDePago", 
     "SubTotal": "200", 
     "Moneda": "MXN", 
     "Total": "200.16", 
     "TipoDeComprobante": "I", 
     "Exportacion": "01", 
     "MetodoPago": "PUE", 
     "FormaPago": "01", 
     "LugarExpedicion": "20000", 
     "NoCertificado": "30001000000500003416", 
     "Certificado": "", 
     "Emisor": { 
         "Rfc": "EKU9003173C9", 
         "Nombre": "ESCUELA KEMPER URGATE", 
         "RegimenFiscal": "601" 
     }, 
     "Receptor": { 
         "Rfc": "URE180429TM6", 
         "Nombre": "UNIVERSIDAD ROBOTICA ESPAÑOLA", 
         "DomicilioFiscalReceptor": "86991", 
         "RegimenFiscalReceptor": "601", 
         "UsoCFDI": "G01" 
     }, 
     "Conceptos": [ 
         { 
             "ClaveProdServ": "84111506", 
             "Cantidad": "1", 
             "ClaveUnidad": "ACT", 
             "Unidad": "Pieza", 
             "Descripcion": "Anticipo del bien o servicio", 
             "ValorUnitario": "200.00", 
             "Importe": "200.00", 
             "ObjetoImp": "02", 
             "Impuestos": { 
                 "Traslados": [ 
                     { 
                         "Base": "1", 
                         "Importe": "0.16", 
                         "Impuesto": "002", 
                         "TasaOCuota": "0.160000", 
                         "TipoFactor": "Tasa" 
                     } 
                 ] 
             } 
         } 
     ], 
     "Impuestos": { 
         "TotalImpuestosTrasladados": "0.16", 
         "Traslados": [ 
             { 
                 "Base": "1", 
                 "Importe": "0.16", 
                 "Impuesto": "002", 
                 "TasaOCuota": "0.160000", 
                 "TipoFactor": "Tasa" 
             } 
         ] 
     } 
 }`;
                             navigator.clipboard.writeText(val);
                             showSuccess('Copiado', 'JSON anticipo copiado');
                          }}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                        </Button>
                      </div>
                    </TabsContent>

                    <TabsContent value="remanente" className="space-y-2">
                      <div className="relative">
                        <Textarea
                          readOnly
                          rows={20}
                          className="font-mono text-xs pr-12"
                          value={`{ 
     "Version": "4.0", 
     "Serie": "Serie", 
     "Folio": "Folio", 
     "Fecha": "2024-04-29T00:00:00", 
     "Sello": "", 
     "CondicionesDePago": "CondicionesDePago", 
     "SubTotal": "200", 
     "Moneda": "MXN", 
     "Total": "200.16", 
     "TipoDeComprobante": "I", 
     "Exportacion": "01", 
     "MetodoPago": "PUE", 
     "FormaPago": "01", 
     "LugarExpedicion": "20000", 
     "NoCertificado": "30001000000500003416", 
     "Certificado": "", 
     "Emisor": { 
         "Rfc": "EKU9003173C9", 
         "Nombre": "ESCUELA KEMPER URGATE", 
         "RegimenFiscal": "601" 
     }, 
     "Receptor": { 
         "Rfc": "URE180429TM6", 
         "Nombre": "UNIVERSIDAD ROBOTICA ESPAÑOLA", 
         "DomicilioFiscalReceptor": "86991", 
         "RegimenFiscalReceptor": "601", 
         "UsoCFDI": "G01" 
     }, 
     "Conceptos": [ 
         { 
             "ClaveProdServ": "84111506", 
             "Cantidad": "1", 
             "ClaveUnidad": "ACT", 
             "Unidad": "Pieza", 
             "Descripcion": "Anticipo del bien o servicio", 
             "ValorUnitario": "200.00", 
             "Importe": "200.00", 
             "ObjetoImp": "02", 
             "Impuestos": { 
                 "Traslados": [ 
                     { 
                         "Base": "1", 
                         "Importe": "0.16", 
                         "Impuesto": "002", 
                         "TasaOCuota": "0.160000", 
                         "TipoFactor": "Tasa" 
                     } 
                 ] 
             } 
         } 
     ], 
     "Impuestos": { 
         "TotalImpuestosTrasladados": "0.16", 
         "Traslados": [ 
              { 
                 "Base": "1", 
                 "Importe": "0.16", 
                 "Impuesto": "002", 
                 "TasaOCuota": "0.160000", 
                 "TipoFactor": "Tasa" 
             } 
         ] 
     } 
 }`}
                        />
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="absolute top-2 right-2 h-8 w-8 p-0"
                          onClick={() => {
                             const val = `{ 
     "Version": "4.0", 
     "Serie": "Serie", 
     "Folio": "Folio", 
     "Fecha": "2024-04-29T00:00:00", 
     "Sello": "", 
     "CondicionesDePago": "CondicionesDePago", 
     "SubTotal": "200", 
     "Moneda": "MXN", 
     "Total": "200.16", 
     "TipoDeComprobante": "I", 
     "Exportacion": "01", 
     "MetodoPago": "PUE", 
     "FormaPago": "01", 
     "LugarExpedicion": "20000", 
     "NoCertificado": "30001000000500003416", 
     "Certificado": "", 
     "Emisor": { 
         "Rfc": "EKU9003173C9", 
         "Nombre": "ESCUELA KEMPER URGATE", 
         "RegimenFiscal": "601" 
     }, 
     "Receptor": { 
         "Rfc": "URE180429TM6", 
         "Nombre": "UNIVERSIDAD ROBOTICA ESPAÑOLA", 
         "DomicilioFiscalReceptor": "86991", 
         "RegimenFiscalReceptor": "601", 
         "UsoCFDI": "G01" 
     }, 
     "Conceptos": [ 
         { 
             "ClaveProdServ": "84111506", 
             "Cantidad": "1", 
             "ClaveUnidad": "ACT", 
             "Unidad": "Pieza", 
             "Descripcion": "Anticipo del bien o servicio", 
             "ValorUnitario": "200.00", 
             "Importe": "200.00", 
             "ObjetoImp": "02", 
             "Impuestos": { 
                 "Traslados": [ 
                     { 
                         "Base": "1", 
                         "Importe": "0.16", 
                         "Impuesto": "002", 
                         "TasaOCuota": "0.160000", 
                         "TipoFactor": "Tasa" 
                     } 
                 ] 
             } 
         } 
     ], 
     "Impuestos": { 
         "TotalImpuestosTrasladados": "0.16", 
         "Traslados": [ 
              { 
                 "Base": "1", 
                 "Importe": "0.16", 
                 "Impuesto": "002", 
                 "TasaOCuota": "0.160000", 
                 "TipoFactor": "Tasa" 
             } 
         ] 
     } 
 }`;
                             navigator.clipboard.writeText(val);
                             showSuccess('Copiado', 'JSON remanente copiado');
                          }}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-copy"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                        </Button>
                      </div>
                    </TabsContent>
                  </Tabs>
                </div>

              </div>
            </TabsContent>

            <TabsContent value="smtp-test">
              <div className="p-4 border rounded-lg space-y-3">
                <p className="font-medium">Prueba SMTP</p>
                <p className="text-xs text-gray-500">Verifica la conectividad con el servidor SMTP configurado</p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={async () => {
                      try {
                        const res = await fetch('/api/tenant/smtp-test', { method: 'POST' })
                        const data = await res.json()
                        if (!res.ok) throw new Error(data.error || data.message || 'Fallo en la prueba SMTP')
                        showSuccess('Prueba exitosa', data.message)
                      } catch (e) {
                        showError('Prueba fallida', e instanceof Error ? e.message : undefined)
                      }
                    }}
                  >
                    Probar conexión SMTP
                  </Button>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

    </div>
  )
}
