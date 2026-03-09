'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { showSuccess, showError } from '@/lib/toast'
import { Loader2, Sliders, Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

interface TenantData {
  id: string
  name: string
  slug: string
  logo?: string | null
  operationalAccessEnabled?: boolean
  systemSettings?: {
    theme?: 'light' | 'dark' | 'system'
    preferences?: {
      locale?: string
      timezone?: string
      sessionTimeoutMinutes?: number
      currency?: string
      fontStyle?: 'system' | 'serif' | 'mono'
    }
  }
}

export default function PreferencesPage() {
  const [tenant, setTenant] = useState<TenantData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const { setTheme } = useTheme()
  const [tab, setTab] = useState<string>('theme')

  useEffect(() => {
    fetchData()
  }, [])

  useEffect(() => {
    try {
      const url = new URL(window.location.href)
      const t = url.searchParams.get('tab') || (window.location.hash ? window.location.hash.replace('#', '') : null)
      if (t) setTab(t)
    } catch {}
  }, [])

  const fetchData = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/tenant')
      const data = await res.json()
      if (res.ok) setTenant(data.tenant)
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
      if (!res.ok) throw new Error(data.error || 'Error al guardar preferencias')
      setTenant(data.tenant)
      showSuccess('Preferencias guardadas', 'Los cambios se aplicaron correctamente')
      fetchData()
    } catch (error) {
      console.error(error)
      showError('Error al guardar', error instanceof Error ? error.message : undefined)
    } finally {
      setSaving(false)
    }
  }

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
              <Sliders className="h-5 w-5" />
              Preferencias del Sistema
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
            <Sliders className="h-5 w-5" />
            Preferencias del Sistema
          </CardTitle>
          <CardDescription>Ajustes personales y de presentación</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="theme">Tema</TabsTrigger>
              <TabsTrigger value="font">Fuente</TabsTrigger>
              <TabsTrigger value="locale">Idioma</TabsTrigger>
              <TabsTrigger value="currency">Moneda</TabsTrigger>
              <TabsTrigger value="timezone">Zona horaria</TabsTrigger>
              <TabsTrigger value="session">Sesión</TabsTrigger>
            </TabsList>

            <TabsContent value="theme">
              <div className="p-4 border rounded-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Preferencia de tema</p>
                    <p className="text-xs text-gray-500">Afecta la apariencia de toda la aplicación</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant={tenant.systemSettings?.theme === 'light' ? 'default' : 'outline'} onClick={() => { setTheme('light'); setTenant({ ...tenant, systemSettings: { ...(tenant.systemSettings || {}), theme: 'light' } }) }}><Sun className="h-4 w-4 mr-2" />Claro</Button>
                    <Button variant={tenant.systemSettings?.theme === 'dark' ? 'default' : 'outline'} onClick={() => { setTheme('dark'); setTenant({ ...tenant, systemSettings: { ...(tenant.systemSettings || {}), theme: 'dark' } }) }}><Moon className="h-4 w-4 mr-2" />Oscuro</Button>
                    <Button variant={tenant.systemSettings?.theme === 'system' ? 'default' : 'outline'} onClick={() => { setTheme('system'); setTenant({ ...tenant, systemSettings: { ...(tenant.systemSettings || {}), theme: 'system' } }) }}>Sistema</Button>
                  </div>
                </div>
                <div className="flex justify-end mt-4">
                  <Button onClick={updateTenant} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}Guardar</Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="font">
              <div className="p-4 border rounded-lg space-y-3">
                <p className="font-medium">Estilo de fuente</p>
                <div className="flex items-center gap-2">
                  <Button variant={tenant.systemSettings?.preferences?.fontStyle === 'system' ? 'default' : 'outline'} onClick={() => setTenant({ ...tenant, systemSettings: { ...(tenant.systemSettings || {}), preferences: { ...(tenant.systemSettings?.preferences || {}), fontStyle: 'system' } } })}>Sistema</Button>
                  <Button variant={tenant.systemSettings?.preferences?.fontStyle === 'serif' ? 'default' : 'outline'} onClick={() => setTenant({ ...tenant, systemSettings: { ...(tenant.systemSettings || {}), preferences: { ...(tenant.systemSettings?.preferences || {}), fontStyle: 'serif' } } })}>Serif</Button>
                  <Button variant={tenant.systemSettings?.preferences?.fontStyle === 'mono' ? 'default' : 'outline'} onClick={() => setTenant({ ...tenant, systemSettings: { ...(tenant.systemSettings || {}), preferences: { ...(tenant.systemSettings?.preferences || {}), fontStyle: 'mono' } } })}>Monospace</Button>
                </div>
                <div className="flex justify-end mt-4">
                  <Button onClick={updateTenant} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}Guardar</Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="locale">
              <div className="p-4 border rounded-lg space-y-3">
                <p className="font-medium">Idioma</p>
                <div>
                  <Label>Idioma (locale)</Label>
                  <Input value={tenant.systemSettings?.preferences?.locale || ''} onChange={(e) => setTenant({ ...tenant, systemSettings: { ...(tenant.systemSettings || {}), preferences: { ...(tenant.systemSettings?.preferences || {}), locale: e.target.value } } })} />
                </div>
                <div className="flex justify-end mt-4">
                  <Button onClick={updateTenant} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}Guardar</Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="currency">
              <div className="p-4 border rounded-lg space-y-3">
                <p className="font-medium">Moneda</p>
                <div>
                  <Label>Moneda (ISO, ej. MXN, USD)</Label>
                  <Input value={tenant.systemSettings?.preferences?.currency || ''} onChange={(e) => setTenant({ ...tenant, systemSettings: { ...(tenant.systemSettings || {}), preferences: { ...(tenant.systemSettings?.preferences || {}), currency: e.target.value.toUpperCase() } } })} />
                </div>
                <div className="flex justify-end mt-4">
                  <Button onClick={updateTenant} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}Guardar</Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="timezone">
              <div className="p-4 border rounded-lg space-y-3">
                <p className="font-medium">Zona horaria</p>
                <div>
                  <Label>Zona horaria</Label>
                  <Input value={tenant.systemSettings?.preferences?.timezone || ''} onChange={(e) => setTenant({ ...tenant, systemSettings: { ...(tenant.systemSettings || {}), preferences: { ...(tenant.systemSettings?.preferences || {}), timezone: e.target.value } } })} />
                </div>
                <div className="flex justify-end mt-4">
                  <Button onClick={updateTenant} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}Guardar</Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="session">
              <div className="p-4 border rounded-lg space-y-3">
                <p className="font-medium">Tiempo de sesión</p>
                <div>
                  <Label>Tiempo de sesión (minutos)</Label>
                  <Input type="number" value={tenant.systemSettings?.preferences?.sessionTimeoutMinutes ?? ''} onChange={(e) => setTenant({ ...tenant, systemSettings: { ...(tenant.systemSettings || {}), preferences: { ...(tenant.systemSettings?.preferences || {}), sessionTimeoutMinutes: e.target.value ? Number(e.target.value) : undefined } } })} />
                </div>
                <div className="flex justify-end mt-4">
                  <Button onClick={updateTenant} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}Guardar</Button>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}

