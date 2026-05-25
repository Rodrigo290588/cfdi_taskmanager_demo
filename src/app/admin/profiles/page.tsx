'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { UserCheck, Shield, Users, Loader2, Building2 } from 'lucide-react'
import Link from 'next/link'
import { showSuccess, showError } from '@/lib/toast'
import { cn } from '@/lib/utils'

type MemberRole = 'ADMIN' | 'VIEWER' | string // Permitimos string para roles personalizados
type CompanyRole = 'ADMIN' | 'AUDITOR' | 'VIEWER' | 'NONE' | string

interface MemberItem {
  id: string
  userId: string
  name: string
  email: string
  image?: string | null
  role: MemberRole
  customRoleId?: string | null
  customRoleName?: string | null
  isCustomRole?: boolean
  status: string
  createdAt: string
}

interface CustomRole {
  id: string
  name: string
  isSystemRole: boolean
}

export default function ProfilesManagementPage() {
  const [members, setMembers] = useState<MemberItem[]>([])
  const [loading, setLoading] = useState(true)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [companies, setCompanies] = useState<Array<{ id: string; rfc: string; businessName: string; isActive: boolean }>>([])
  const [roles, setRoles] = useState<CustomRole[]>([])
  const [openMemberCompanies, setOpenMemberCompanies] = useState<string | null>(null)
  const [memberAccess, setMemberAccess] = useState<Record<string, Record<string, CompanyRole>>>({})
  const [accessError, setAccessError] = useState<string | null>(null)
  const [accessPrefetched, setAccessPrefetched] = useState(false)

  useEffect(() => {
    fetchMembers()
    fetchCompanies()
    fetchRoles()

    const handleRefresh = () => {
      fetchMembers()
      // Note: fetchMemberAccess is called lazily per member when expanding the card,
      // but we could clear the state or let the user click "Actualizar" to see fresh data.
      // For immediate sync, we can just clear memberAccess state to force a refetch if expanded.
      setMemberAccess({})
    }

    window.addEventListener('member-modules-changed', handleRefresh)
    window.addEventListener('company-access-changed', handleRefresh)

    return () => {
      window.removeEventListener('member-modules-changed', handleRefresh)
      window.removeEventListener('company-access-changed', handleRefresh)
    }
  }, [])

  const fetchRoles = async () => {
    try {
      const res = await fetch('/api/admin/roles', { cache: 'no-store' })
      const data = await res.json()
      if (res.ok && data.roles) {
        setRoles(data.roles)
      }
    } catch (error) {
      console.error('Error fetching roles:', error)
    }
  }

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
      const res = await fetch('/api/admin/members', { cache: 'no-store' })
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
      const res = await fetch('/api/companies/tenant', { cache: 'no-store' })
      const data = await res.json() // parse response
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
      
      setMembers(prev => prev.map(m => (m.id === id ? { 
        ...m, 
        role: data.member.role,
        customRoleId: data.member.customRoleId,
        customRoleName: data.member.customRoleName,
        isCustomRole: data.member.isCustomRole
      } : m)))
      
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('member-modules-changed'))
        document.dispatchEvent(new Event('member-modules-changed'))
      }

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
        window.dispatchEvent(new Event('member-modules-changed'))
        document.dispatchEvent(new Event('member-modules-changed'))
      }
      showSuccess('Acceso actualizado', 'Se guardó el rol para la empresa')
    } catch (error) {
      console.error(error)
      showError('Error al actualizar acceso', error instanceof Error ? error.message : undefined)
    } finally {
      setUpdatingId(null)
    }
  }

  const roleLabel = (role: MemberRole, isCustomRole?: boolean, customRoleName?: string | null) => {
    if (isCustomRole && customRoleName) return customRoleName
    switch (role) {
      case 'ADMIN':
        return 'Administrador'
      case 'VIEWER':
        return 'Usuario'
      default:
        return role
    }
  }

  const companyRoleLabel = (roleId: CompanyRole) => {
    switch (roleId) {
      case 'ADMIN':
        return 'Administrador'
      case 'AUDITOR':
        return 'Auditor'
      case 'VIEWER':
        return 'Visualizador'
      case 'NONE':
        return 'Sin acceso'
      default:
        const found = roles.find(r => r.id === roleId)
        return found ? found.name : roleId
    }
  }

  const roleBadgeVariant = (role: MemberRole, isCustomRole?: boolean) => {
    if (isCustomRole) return 'default'
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
    <div className="container mx-auto py-8 px-4 md:px-8">
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
                const isActive = openMemberCompanies === m.id
                return (
                <div
                  key={m.id}
                  className={cn(
                    "flex flex-col md:flex-row md:items-center justify-between p-4 border rounded-lg transition-colors gap-4",
                    isActive && "border-blue-300 bg-blue-50"
                  )}
                  aria-selected={isActive}
                >
                  <div className="flex items-start md:items-center gap-3 w-full md:w-auto">
                    <Avatar className="mt-1 md:mt-0">
                      <AvatarImage src={m.image || undefined} />
                      <AvatarFallback>{(m.name || m.email || '').charAt(0).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium truncate">{m.name}</p>
                        <Badge variant={roleBadgeVariant(m.role, m.isCustomRole)} className="shrink-0">
                          {roleLabel(m.role, m.isCustomRole, m.customRoleName)}
                        </Badge>
                      </div>
                      <p className="text-sm text-gray-500 truncate">{m.email}</p>
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

                  <div className="flex flex-wrap md:flex-nowrap items-center gap-2 w-full md:w-auto">
                    <div className="w-full sm:w-auto flex-1 sm:flex-none">
                      <Select
                        value={m.isCustomRole && m.customRoleId ? m.customRoleId : m.role}
                        onValueChange={(value) => updateRole(m.id, value)}
                        disabled={updatingId === m.id}
                      >
                        <SelectTrigger className="w-full sm:w-[180px]">
                          <SelectValue placeholder="Seleccionar rol" />
                        </SelectTrigger>
                        <SelectContent>
                          {roles.map(role => (
                            <SelectItem key={role.id} value={role.id}>
                              {role.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                      <Button variant="outline" size="sm" disabled={updatingId === m.id} className="flex-1 sm:flex-none">
                        <UserCheck className="h-4 w-4 mr-2" />
                        <span className="hidden sm:inline">Asignar</span>
                      </Button>
                      <Button
                        variant={openMemberCompanies === m.id ? 'default' : 'ghost'}
                        size="sm"
                        onClick={async () => {
                          const open = openMemberCompanies === m.id ? null : m.id
                          setOpenMemberCompanies(open)
                          if (open) await fetchMemberAccess(m.id)
                        }}
                        className="flex-1 sm:flex-none"
                      >
                        <Building2 className="h-4 w-4 sm:mr-2" />
                        <span className="hidden sm:inline">Empresas</span>
                      </Button>
                    </div>
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
                            {roles.map((role) => (
                              <SelectItem key={role.id} value={role.id}>
                                {role.name}
                              </SelectItem>
                            ))}
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
                              window.dispatchEvent(new Event('member-modules-changed'))
                              document.dispatchEvent(new Event('member-modules-changed'))
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

    </div>
  )
}
