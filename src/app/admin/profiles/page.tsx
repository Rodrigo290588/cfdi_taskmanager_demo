'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { UserCheck, Shield, Users, Loader2, Building2, Settings } from 'lucide-react'
import Link from 'next/link'
import { showSuccess, showError } from '@/lib/toast'
import { cn } from '@/lib/utils'

type MemberRole = 'ADMIN' | 'VIEWER'
type CompanyRole = 'ADMIN' | 'AUDITOR' | 'VIEWER' | 'NONE'

interface MemberItem {
  id: string
  userId: string
  name: string
  email: string
  image?: string | null
  role: MemberRole
  status: string
  createdAt: string
}

export default function ProfilesManagementPage() {
  const [members, setMembers] = useState<MemberItem[]>([])
  const [loading, setLoading] = useState(true)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [companies, setCompanies] = useState<Array<{ id: string; rfc: string; businessName: string; isActive: boolean }>>([])
  const [openMemberCompanies, setOpenMemberCompanies] = useState<string | null>(null)
  const [openMemberModules, setOpenMemberModules] = useState<string | null>(null)
  const [memberAccess, setMemberAccess] = useState<Record<string, Record<string, CompanyRole>>>({})
  type ModuleFlags = { canViewEmission: boolean; canViewReception: boolean; canViewPayroll: boolean; canViewSatPortal: boolean; canViewMassDownloads: boolean; canManageOrg: boolean }
  const defaultModuleFlags: ModuleFlags = { canViewEmission: true, canViewReception: true, canViewPayroll: true, canViewSatPortal: true, canViewMassDownloads: true, canManageOrg: false }
  const [memberModules, setMemberModules] = useState<Record<string, ModuleFlags>>({})
  const [accessError, setAccessError] = useState<string | null>(null)
  const [modulesError, setModulesError] = useState<string | null>(null)
  const [accessPrefetched, setAccessPrefetched] = useState(false)

  useEffect(() => {
    fetchMembers()
    fetchCompanies()
  }, [])

  useEffect(() => {
    const prefetch = async () => {
      if (accessPrefetched) return
      if (members.length === 0 || companies.length === 0) return
      try {
        await Promise.all(members.map((m) => fetchMemberAccess(m.id)))
        setAccessPrefetched(true)
    } catch {
      // silently ignore, UI will render without chips
    }
    }
    prefetch()
  }, [members, companies, accessPrefetched])

  const fetchMembers = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/admin/members')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al cargar miembros')
      setMembers(data.members)
    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  const fetchCompanies = async () => {
    try {
      const res = await fetch('/api/companies/tenant')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al cargar empresas')
      setCompanies(data.companies || [])
    } catch (error) {
      console.error(error)
    }
  }

  const fetchMemberAccess = async (memberId: string) => {
    try {
      const res = await fetch(`/api/admin/members/${memberId}/access`)
      const data = await res.json()
      if (!res.ok) {
        setAccessError(data.error || 'Error al cargar accesos')
        setMemberAccess(prev => ({ ...prev, [memberId]: {} }))
        return
      }
      const accessMap: Record<string, CompanyRole> = Object.create(null) as Record<string, CompanyRole>
      (data.access || []).forEach((a: { companyId: string; role: CompanyRole }) => {
        accessMap[a.companyId] = a.role
      })
      setMemberAccess(prev => ({ ...prev, [memberId]: accessMap }))
      setAccessError(null)
    } catch (error) {
      console.error(error)
      setAccessError('No fue posible cargar los accesos de empresas')
    }
  }

  const fetchMemberModules = async (memberId: string) => {
    try {
      const res = await fetch(`/api/admin/members/${memberId}/modules`)
      const data = await res.json()
      if (!res.ok) {
        setModulesError(data.error || 'Error al cargar permisos de módulos')
        setMemberModules(prev => ({ ...prev, [memberId]: defaultModuleFlags }))
        return
      }
      setMemberModules(prev => ({ ...prev, [memberId]: data.modules as ModuleFlags }))
      setModulesError(null)
    } catch {
      setModulesError('No fue posible cargar permisos de módulos')
    }
  }

  const updateMemberModules = async (memberId: string, modules: Partial<ModuleFlags>) => {
    try {
      setUpdatingId(memberId)
      const res = await fetch(`/api/admin/members/${memberId}/modules`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(modules)
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al actualizar permisos de módulos')
      setMemberModules(prev => {
        const prevMods = prev[memberId] || defaultModuleFlags
        const merged = { ...prevMods, ...modules } as ModuleFlags
        return { ...prev, [memberId]: merged }
      })
      if (typeof window !== 'undefined') {
        try {
          window.dispatchEvent(new Event('member-modules-changed'))
          document.dispatchEvent(new Event('member-modules-changed'))
        } catch {}
      }
      showSuccess('Permisos actualizados', 'Se guardaron los permisos de módulos')
    } catch (error) {
      showError('Error al actualizar', error instanceof Error ? error.message : undefined)
    } finally {
      setUpdatingId(null)
    }
  }

  const updateRole = async (id: string, role: MemberRole) => {
    try {
      setUpdatingId(id)
      const res = await fetch(`/api/admin/members/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al actualizar rol')
      setMembers(prev => prev.map(m => (m.id === id ? { ...m, role } : m)))
      showSuccess('Rol actualizado', 'El rol del miembro se guardó correctamente')
    } catch (error) {
      console.error(error)
      showError('Error al actualizar rol', error instanceof Error ? error.message : undefined)
    } finally {
      setUpdatingId(null)
    }
  }

  const updateCompanyRole = async (memberId: string, companyId: string, role: CompanyRole) => {
    try {
      setUpdatingId(memberId)
      const res = await fetch(`/api/admin/members/${memberId}/access`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, role })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al actualizar acceso')
      setMemberAccess(prev => ({
        ...prev,
        [memberId]: {
          ...(prev[memberId] || {}),
          [companyId]: role
        }
      }))
      if (memberId && typeof window !== 'undefined') {
        window.dispatchEvent(new Event('company-access-changed'))
        document.dispatchEvent(new Event('company-access-changed'))
      }
      showSuccess('Acceso actualizado', 'Se guardó el rol para la empresa')
    } catch (error) {
      console.error(error)
      showError('Error al actualizar acceso', error instanceof Error ? error.message : undefined)
    } finally {
      setUpdatingId(null)
    }
  }

  const roleLabel = (role: MemberRole) => {
    switch (role) {
      case 'ADMIN':
        return 'Administrador'
      case 'VIEWER':
        return 'Usuario'
      default:
        return role
    }
  }

  const companyRoleLabel = (role: CompanyRole) => {
    switch (role) {
      case 'ADMIN':
        return 'Administrador'
      case 'AUDITOR':
        return 'Auditor'
      case 'VIEWER':
        return 'Visualizador'
      case 'NONE':
        return 'Sin acceso'
      default:
        return role
    }
  }

  const roleBadgeVariant = (role: MemberRole) => {
    switch (role) {
      case 'ADMIN':
        return 'destructive'
      case 'VIEWER':
        return 'outline'
      default:
        return 'default'
    }
  }

  return (
    <div className="container mx-auto py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Perfiles y Roles</h1>
        <p className="text-muted-foreground mt-2">Asigne roles y permisos a los usuarios invitados</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Gestión de Roles
          </CardTitle>
          <CardDescription>Actualice el rol de cada miembro de su organización</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : members.length === 0 ? (
            <div className="text-center py-12">
              <Users className="h-10 w-10 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500">No hay miembros en tu organización</p>
            </div>
          ) : (
            <div className="space-y-4">
              {members.map((m) => {
                const isActive = openMemberCompanies === m.id || openMemberModules === m.id
                return (
                <div
                  key={m.id}
                  className={cn(
                    "flex items-center justify-between p-4 border rounded-lg transition-colors",
                    isActive && "border-blue-300 bg-blue-50"
                  )}
                  aria-selected={isActive}
                >
                  <div className="flex items-center gap-3">
                    <Avatar>
                      <AvatarImage src={m.image || undefined} />
                      <AvatarFallback>{(m.name || m.email || '').charAt(0).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{m.name}</p>
                        <Badge variant={roleBadgeVariant(m.role)}>{roleLabel(m.role)}</Badge>
                      </div>
                      <p className="text-sm text-gray-500">{m.email}</p>
                      <p className="text-xs text-gray-400">{m.status === 'APPROVED' ? 'Aprobado' : 'Pendiente'}</p>
                      {memberAccess[m.id] && Object.keys(memberAccess[m.id]).length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {Object.entries(memberAccess[m.id])
                            .filter(([, role]) => role !== 'NONE')
                            .map(([companyId, role]) => {
                              const company = companies.find((c) => c.id === companyId)
                              const label = company?.businessName || company?.id || 'Empresa'
                              return (
                                <Badge key={companyId} variant="outline" className="text-xs">
                                  {label}
                                  <span className="ml-1 opacity-70">({companyRoleLabel(role as CompanyRole)})</span>
                                  
                                </Badge>
                              )
                            })}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <Select
                      value={m.role}
                      onValueChange={(value) => updateRole(m.id, value as MemberRole)}
                      disabled={updatingId === m.id}
                    >
                      <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Seleccionar rol" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ADMIN">Administrador</SelectItem>
                        <SelectItem value="VIEWER">Usuario</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button variant="outline" size="sm" disabled={updatingId === m.id}>
                      <UserCheck className="h-4 w-4 mr-2" />
                      Asignar
                    </Button>
                  <Button
                    variant={openMemberCompanies === m.id ? 'default' : 'ghost'}
                    size="sm"
                    onClick={async () => {
                      const open = openMemberCompanies === m.id ? null : m.id
                      setOpenMemberCompanies(open)
                      if (open) await fetchMemberAccess(m.id)
                    }}
                  >
                    <Building2 className="h-4 w-4 mr-2" />
                    Empresas
                  </Button>
                  <Button
                    variant={openMemberModules === m.id ? 'default' : 'ghost'}
                    size="sm"
                    onClick={async () => {
                      const open = openMemberModules === m.id ? null : m.id
                      setOpenMemberModules(open)
                      if (open) await fetchMemberModules(m.id)
                    }}
                  >
                    <Settings className="h-4 w-4 mr-2" />
                    Permisos
                  </Button>
                </div>
              </div>
            )})}
          </div>
        )}
      </CardContent>
    </Card>

      {openMemberCompanies && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Empresas asignadas
            </CardTitle>
            <CardDescription>Defina acceso por empresa para el usuario seleccionado</CardDescription>
          </CardHeader>
          <CardContent>
            {accessError && (
              <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-red-700">
                {accessError}
              </div>
            )}
            {companies.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-500">No hay empresas registradas</p>
                <Link href="/companies" className="text-blue-600 hover:underline text-sm">Registrar empresa</Link>
              </div>
            ) : (
              <div className="space-y-3">
                {companies.map((c) => {
                  const currentRole = memberAccess[openMemberCompanies!]?.[c.id] || 'NONE'
                  return (
                    <div key={c.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div>
                        <p className="font-medium">{c.businessName}</p>
                        <p className="text-xs text-gray-500">{c.rfc}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <Select
                          value={currentRole}
                          onValueChange={(value) => updateCompanyRole(openMemberCompanies!, c.id, value as CompanyRole)}
                          disabled={updatingId === openMemberCompanies}
                        >
                          <SelectTrigger className="w-[200px]">
                            <SelectValue placeholder="Seleccionar acceso" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="NONE">Sin acceso</SelectItem>
                            <SelectItem value="VIEWER">Visualizador</SelectItem>
                            <SelectItem value="AUDITOR">Auditor</SelectItem>
                            <SelectItem value="ADMIN">Administrador</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={updatingId === openMemberCompanies}
                          onClick={() => {
                            if (typeof window !== 'undefined') {
                              window.dispatchEvent(new Event('company-access-changed'))
                              document.dispatchEvent(new Event('company-access-changed'))
                            }
                          }}
                        >
                          Actualizar
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {openMemberModules && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Permisos de Módulos
            </CardTitle>
            <CardDescription>Defina qué módulos puede ver el usuario seleccionado</CardDescription>
          </CardHeader>
          <CardContent>
            {modulesError && (
              <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-red-700">
                {modulesError}
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(() => {
                const mods = memberModules[openMemberModules!]
                const setFlag = (key: keyof typeof mods, value: boolean) => setMemberModules(prev => ({ ...prev, [openMemberModules!]: { ...prev[openMemberModules!], [key]: value } }))
                return (
                  <>
                    <div className="p-3 border rounded-lg flex items-center justify-between">
                      <div>
                        <p className="font-medium">Módulo de Emisión</p>
                        <p className="text-xs text-gray-500">Dashboard y emisión de CFDIs</p>
                      </div>
                      <div className="flex gap-2">
                        <Button variant={mods?.canViewEmission ? 'default' : 'outline'} size="sm" onClick={() => setFlag('canViewEmission', true)}>Ver</Button>
                        <Button variant={!mods?.canViewEmission ? 'default' : 'outline'} size="sm" onClick={() => setFlag('canViewEmission', false)}>Ocultar</Button>
                      </div>
                    </div>
                    <div className="p-3 border rounded-lg flex items-center justify-between">
                      <div>
                        <p className="font-medium">Módulo de Recepción</p>
                        <p className="text-xs text-gray-500">Dashboard de recibidos</p>
                      </div>
                      <div className="flex gap-2">
                        <Button variant={mods?.canViewReception ? 'default' : 'outline'} size="sm" onClick={() => setFlag('canViewReception', true)}>Ver</Button>
                        <Button variant={!mods?.canViewReception ? 'default' : 'outline'} size="sm" onClick={() => setFlag('canViewReception', false)}>Ocultar</Button>
                      </div>
                    </div>
                    <div className="p-3 border rounded-lg flex items-center justify-between">
                      <div>
                        <p className="font-medium">Módulo de Nómina</p>
                        <p className="text-xs text-gray-500">Dashboard de nómina</p>
                      </div>
                      <div className="flex gap-2">
                        <Button variant={mods?.canViewPayroll ? 'default' : 'outline'} size="sm" onClick={() => setFlag('canViewPayroll', true)}>Ver</Button>
                        <Button variant={!mods?.canViewPayroll ? 'default' : 'outline'} size="sm" onClick={() => setFlag('canViewPayroll', false)}>Ocultar</Button>
                      </div>
                    </div>
                    <div className="p-3 border rounded-lg flex items-center justify-between">
                      <div>
                        <p className="font-medium">CFDIs en Portal del SAT</p>
                        <p className="text-xs text-gray-500">Consulta y descargas del SAT</p>
                      </div>
                      <div className="flex gap-2">
                        <Button variant={mods?.canViewSatPortal ? 'default' : 'outline'} size="sm" onClick={() => setFlag('canViewSatPortal', true)}>Ver</Button>
                        <Button variant={!mods?.canViewSatPortal ? 'default' : 'outline'} size="sm" onClick={() => setFlag('canViewSatPortal', false)}>Ocultar</Button>
                      </div>
                    </div>
                    <div className="p-3 border rounded-lg flex items-center justify-between">
                      <div>
                        <p className="font-medium">Descargas masivas de CFDI</p>
                        <p className="text-xs text-gray-500">Módulo de descargas masivas</p>
                      </div>
                      <div className="flex gap-2">
                        <Button variant={mods?.canViewMassDownloads ? 'default' : 'outline'} size="sm" onClick={() => setFlag('canViewMassDownloads', true)}>Ver</Button>
                        <Button variant={!mods?.canViewMassDownloads ? 'default' : 'outline'} size="sm" onClick={() => setFlag('canViewMassDownloads', false)}>Ocultar</Button>
                      </div>
                    </div>
                    <div className="p-3 border rounded-lg flex items-center justify-between md:col-span-2">
                      <div>
                        <p className="font-medium">Administración de la Organización</p>
                        <p className="text-xs text-gray-500">Configuración y gestión avanzada</p>
                      </div>
                      <div className="flex gap-2">
                        <Button variant={mods?.canManageOrg ? 'default' : 'outline'} size="sm" onClick={() => setFlag('canManageOrg', true)}>Permitir</Button>
                        <Button variant={!mods?.canManageOrg ? 'default' : 'outline'} size="sm" onClick={() => setFlag('canManageOrg', false)}>Restringir</Button>
                      </div>
                    </div>
                  </>
                )
              })()}
            </div>
            <div className="flex justify-end mt-4">
              <Button
                onClick={() => updateMemberModules(openMemberModules!, memberModules[openMemberModules!] || {})}
                disabled={updatingId === openMemberModules}
              >
                Guardar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
