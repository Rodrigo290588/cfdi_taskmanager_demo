'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { showSuccess, showError } from '@/lib/toast'
import { Loader2, UserCircle, Upload, Trash2, Mail, ShieldCheck } from 'lucide-react'

interface UserProfile {
  id: string
  name?: string | null
  email: string
  image?: string | null
  preferences?: {
    theme?: 'light' | 'dark' | 'system'
    locale?: string
    timezone?: string
    notifications?: {
      emailEnabled?: boolean
      productUpdates?: boolean
      tipsEnabled?: boolean
    }
  }
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)

  useEffect(() => {
    fetchProfile()
  }, [])

  const fetchProfile = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/user/profile')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al cargar perfil')
      setProfile(data.user)
    } catch (e) {
      showError('Error al cargar perfil', e instanceof Error ? e.message : undefined)
    } finally {
      setLoading(false)
    }
  }

  const saveProfile = async () => {
    if (!profile) return
    try {
      setSaving(true)
      const res = await fetch('/api/user/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: profile.name,
          preferences: profile.preferences
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al guardar perfil')
      setProfile(data.user)
      showSuccess('Perfil actualizado', 'Se guardaron tus cambios')
    } catch (e) {
      showError('Error al guardar', e instanceof Error ? e.message : undefined)
    } finally {
      setSaving(false)
    }
  }

  const uploadAvatar = async () => {
    if (!avatarFile) return
    try {
      setUploadingAvatar(true)
      const formData = new FormData()
      formData.append('avatar', avatarFile)
      const res = await fetch('/api/user/profile/avatar', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al subir el avatar')
      setProfile(prev => prev ? { ...prev, image: data.avatarUrl } : prev)
      setAvatarFile(null)
      showSuccess('Avatar actualizado', 'Tu foto de perfil fue actualizada')
    } catch (e) {
      showError('Error al subir avatar', e instanceof Error ? e.message : undefined)
    } finally {
      setUploadingAvatar(false)
    }
  }

  const removeAvatar = async () => {
    try {
      const res = await fetch('/api/user/profile/avatar', { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al eliminar el avatar')
      setProfile(prev => prev ? { ...prev, image: null } : prev)
      showSuccess('Avatar eliminado', 'Se eliminó tu foto de perfil')
    } catch (e) {
      showError('Error al eliminar avatar', e instanceof Error ? e.message : undefined)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="container mx-auto py-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserCircle className="h-5 w-5" />
              Mi Perfil
            </CardTitle>
            <CardDescription>No se pudo cargar el perfil</CardDescription>
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
            <UserCircle className="h-5 w-5" />
            Mi Perfil
          </CardTitle>
          <CardDescription>Administra tu cuenta y preferencias personales</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="account">
            <TabsList>
              <TabsTrigger value="account">Cuenta</TabsTrigger>
              <TabsTrigger value="preferences">Preferencias</TabsTrigger>
              <TabsTrigger value="notifications">Notificaciones</TabsTrigger>
              <TabsTrigger value="security">Seguridad</TabsTrigger>
            </TabsList>

            <TabsContent value="account">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-14 w-14">
                      <AvatarImage src={profile.image || undefined} />
                      <AvatarFallback>{(profile.name || profile.email)?.charAt(0).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium">Avatar</p>
                      <p className="text-xs text-gray-500">Formatos: JPEG, PNG, GIF, WebP</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Input type="file" accept="image/*" onChange={(e) => setAvatarFile(e.target.files?.[0] || null)} />
                    <Button onClick={uploadAvatar} disabled={!avatarFile || uploadingAvatar}>
                      {uploadingAvatar ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                      Subir
                    </Button>
                    <Button variant="destructive" onClick={removeAvatar} disabled={!profile.image}>
                      <Trash2 className="h-4 w-4 mr-2" />Eliminar
                    </Button>
                  </div>
                </div>
                <div className="space-y-4 md:col-span-2">
                  <div className="space-y-2">
                    <Label>Nombre</Label>
                    <Input value={profile.name || ''} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Email</Label>
                    <div className="flex items-center gap-2">
                      <Input value={profile.email} disabled />
                      <Badge variant="secondary" className="gap-1">
                        <Mail className="h-4 w-4" />Verificado
                      </Badge>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button onClick={saveProfile} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}Guardar</Button>
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="preferences">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label>Idioma (locale)</Label>
                  <Input value={profile.preferences?.locale || ''} onChange={(e) => setProfile({ ...profile, preferences: { ...(profile.preferences || {}), locale: e.target.value } })} />
                </div>
                <div className="space-y-2">
                  <Label>Zona horaria</Label>
                  <Input value={profile.preferences?.timezone || ''} onChange={(e) => setProfile({ ...profile, preferences: { ...(profile.preferences || {}), timezone: e.target.value } })} />
                </div>
                <div className="flex justify-end md:col-span-2">
                  <Button onClick={saveProfile} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}Guardar</Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="notifications">
              <div className="space-y-3">
                <p className="text-sm text-gray-600">Controla las notificaciones personales</p>
                <div className="flex items-center gap-3">
                  <Label className="text-sm">Email</Label>
                  <Button variant={profile.preferences?.notifications?.emailEnabled ? 'default' : 'outline'} size="sm" onClick={() => setProfile({ ...profile, preferences: { ...(profile.preferences || {}), notifications: { ...(profile.preferences?.notifications || {}), emailEnabled: !profile.preferences?.notifications?.emailEnabled } } })}>{profile.preferences?.notifications?.emailEnabled ? 'Habilitado' : 'Deshabilitado'}</Button>
                </div>
                <div className="flex items-center gap-3">
                  <Label className="text-sm">Actualizaciones del producto</Label>
                  <Button variant={profile.preferences?.notifications?.productUpdates ? 'default' : 'outline'} size="sm" onClick={() => setProfile({ ...profile, preferences: { ...(profile.preferences || {}), notifications: { ...(profile.preferences?.notifications || {}), productUpdates: !profile.preferences?.notifications?.productUpdates } } })}>{profile.preferences?.notifications?.productUpdates ? 'Habilitado' : 'Deshabilitado'}</Button>
                </div>
                <div className="flex items-center gap-3">
                  <Label className="text-sm">Consejos y tips</Label>
                  <Button variant={profile.preferences?.notifications?.tipsEnabled ? 'default' : 'outline'} size="sm" onClick={() => setProfile({ ...profile, preferences: { ...(profile.preferences || {}), notifications: { ...(profile.preferences?.notifications || {}), tipsEnabled: !profile.preferences?.notifications?.tipsEnabled } } })}>{profile.preferences?.notifications?.tipsEnabled ? 'Habilitado' : 'Deshabilitado'}</Button>
                </div>
                <div className="flex justify-end">
                  <Button onClick={saveProfile} disabled={saving}>{saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}Guardar</Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="security">
              <div className="p-4 border rounded-lg space-y-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4" />
                  <p className="font-medium">Seguridad</p>
                </div>
                <p className="text-xs text-gray-500">Próximamente: 2FA, dispositivos de confianza y actividad de inicio de sesión</p>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}

