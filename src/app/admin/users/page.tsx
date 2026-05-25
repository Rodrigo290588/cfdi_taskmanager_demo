'use client'

import { useState, useEffect } from 'react'
import { UserInvitationForm } from '@/components/admin/user-invitation-form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Users, Mail, UserCheck, Clock, CheckCircle, Trash2, Edit2, ShieldAlert } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Building2, ChevronDown } from 'lucide-react'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { toast } from 'sonner'
import { showSuccess, showError } from '@/lib/toast'

export interface Invitation {
  id: string
  email: string
  name: string | null
  role: string
  status: string
  invitationTokenHash?: string | null
  isCustomRole?: boolean
}

interface ActiveUser extends Invitation {
  roleId: string
  companyIds: string[]
}

export default function UsersManagementPage() {
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [activeUsers, setActiveUsers] = useState<ActiveUser[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingUsers, setLoadingUsers] = useState(true)
  
  // Edit modal state
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [editingUser, setEditingUser] = useState<ActiveUser | null>(null)
  const [editFormData, setEditFormData] = useState<{ roleId: string; companyIds: string[] }>({ roleId: '', companyIds: [] })
  const [roles, setRoles] = useState<Array<{ id: string; name: string; isSystemRole: boolean }>>([])
  const [companies, setCompanies] = useState<Array<{ id: string; businessName: string; rfc: string }>>([])
  const [savingEdit, setSavingEdit] = useState(false)

  useEffect(() => {
    fetchInvitations()
    fetchActiveUsers()
    fetchCompanies()
    fetchRoles()

    const handleRefresh = () => {
      fetchActiveUsers()
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
      if (res.ok && data.roles) setRoles(data.roles)
    } catch (error) {
      console.error('Error fetching roles:', error)
    }
  }

  const fetchCompanies = async () => {
    try {
      const res = await fetch('/api/user/company-access')
      const data = await res.json()
      if (res.ok && data.companies) setCompanies(data.companies)
    } catch (error) {
      console.error('Error fetching companies:', error)
    }
  }

  const fetchInvitations = async () => {
    try {
      const response = await fetch('/api/admin/users/invite')
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Error al cargar invitaciones')
      }

      setInvitations(data.invitations)
    } catch (error) {
      showError('Error al cargar invitaciones', error instanceof Error ? error.message : 'Error desconocido')
    } finally {
      setLoading(false)
    }
  }

  const fetchActiveUsers = async () => {
    try {
      const response = await fetch('/api/admin/users', { cache: 'no-store' })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Error al cargar usuarios activos')
      }

      setActiveUsers(data.users || [])
    } catch (error) {
      showError('Error al cargar usuarios activos', error instanceof Error ? error.message : 'Error desconocido')
    } finally {
      setLoadingUsers(false)
    }
  }

  const getRoleBadgeVariant = (role: string, isCustomRole?: boolean) => {
    if (isCustomRole) return 'default'
    switch (role) {
      case 'ADMIN':
        return 'destructive'
      case 'AUDITOR':
        return 'secondary'
      case 'VIEWER':
        return 'outline'
      default:
        return 'default'
    }
  }

  const getRoleLabel = (role: string, isCustomRole?: boolean) => {
    if (isCustomRole) return role
    switch (role) {
      case 'ADMIN':
        return 'Administrador'
      case 'AUDITOR':
        return 'Auditor'
      case 'VIEWER':
        return 'Visualizador'
      default:
        return role
    }
  }

  const handleDeleteInvitation = (id: string, name: string) => {
    toast('¿Eliminar invitación?', {
      description: `¿Estás seguro de que deseas cancelar la invitación para ${name}?`,
      action: {
        label: 'Eliminar',
        onClick: async () => {
          try {
            const response = await fetch(`/api/admin/users/invite/${id}`, {
              method: 'DELETE',
            })
            const data = await response.json()

            if (!response.ok) {
              throw new Error(data.error || 'Error al eliminar invitación')
            }

            showSuccess('Invitación eliminada', 'La invitación ha sido cancelada correctamente')
            fetchInvitations() // Recargar la lista
          } catch (error) {
            showError('Error', error instanceof Error ? error.message : 'No se pudo eliminar la invitación')
          }
        },
      },
      cancel: {
        label: 'Cancelar',
        onClick: () => {},
      },
    })
  }

  const handleToggleStatus = async (user: ActiveUser) => {
    const newStatus = user.status === 'APPROVED' ? 'INACTIVE' : 'APPROVED'
    const actionText = newStatus === 'APPROVED' ? 'activar' : 'inactivar'
    
    toast(`¿${actionText} usuario?`, {
      description: `¿Estás seguro de que deseas ${actionText} a ${user.name}?`,
      action: {
        label: 'Confirmar',
        onClick: async () => {
          try {
            const response = await fetch(`/api/admin/users/${user.id}/status`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: newStatus })
            })
            const data = await response.json()

            if (!response.ok) {
              throw new Error(data.error || 'Error al cambiar el estado')
            }

            if (typeof window !== 'undefined') {
              window.dispatchEvent(new Event('company-access-changed'))
              document.dispatchEvent(new Event('company-access-changed'))
              window.dispatchEvent(new Event('member-modules-changed'))
              document.dispatchEvent(new Event('member-modules-changed'))
            }

            showSuccess('Estado actualizado', `El usuario ha sido ${actionText}do correctamente`)
            fetchActiveUsers()
          } catch (error) {
            showError('Error', error instanceof Error ? error.message : 'No se pudo actualizar el estado')
          }
        },
      },
      cancel: { label: 'Cancelar', onClick: () => {} },
    })
  }

  const handleOpenEdit = (user: ActiveUser) => {
    setEditingUser(user)
    setEditFormData({
      roleId: user.roleId,
      companyIds: [...user.companyIds]
    })
    setShowEditDialog(true)
  }

  const handleSaveEdit = async () => {
    if (!editingUser) return
    setSavingEdit(true)
    try {
      const response = await fetch(`/api/admin/users/${editingUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editFormData)
      })
      const data = await response.json()

      if (!response.ok) throw new Error(data.error || 'Error al actualizar usuario')

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('company-access-changed'))
        document.dispatchEvent(new Event('company-access-changed'))
        window.dispatchEvent(new Event('member-modules-changed'))
        document.dispatchEvent(new Event('member-modules-changed'))
      }

      showSuccess('Usuario actualizado', 'Los permisos han sido actualizados correctamente')
      setShowEditDialog(false)
      fetchActiveUsers()
    } catch (error) {
      showError('Error', error instanceof Error ? error.message : 'No se pudo actualizar el usuario')
    } finally {
      setSavingEdit(false)
    }
  }

  const toggleEditCompany = (companyId: string) => {
    setEditFormData(prev => {
      const newIds = prev.companyIds.includes(companyId)
        ? prev.companyIds.filter(id => id !== companyId)
        : [...prev.companyIds, companyId]
      return { ...prev, companyIds: newIds }
    })
  }

  const handleDeleteActiveUser = (user: ActiveUser) => {
    toast('¿Eliminar usuario?', {
      description: `¿Estás seguro de que deseas eliminar permanentemente a ${user.name}? Esta acción no se puede deshacer y revocará todos sus accesos.`,
      action: {
        label: 'Eliminar',
        onClick: async () => {
          try {
            const response = await fetch(`/api/admin/users/${user.id}`, {
              method: 'DELETE',
            })
            const data = await response.json()

            if (!response.ok) {
              throw new Error(data.error || 'Error al eliminar usuario')
            }

            showSuccess('Usuario eliminado', 'El usuario ha sido eliminado de la organización correctamente')
            fetchActiveUsers()
          } catch (error) {
            showError('Error', error instanceof Error ? error.message : 'No se pudo eliminar el usuario')
          }
        },
      },
      cancel: { label: 'Cancelar', onClick: () => {} },
    })
  }

  return (
    <div className="container mx-auto py-8 px-4 md:px-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">
          Gestión de Usuarios
        </h1>
        <p className="text-muted-foreground mt-2">
          Administre los usuarios de su organización y envíe invitaciones
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* User Invitation Form */}
        <UserInvitationForm onSuccess={fetchInvitations} />

        {/* Pending Invitations */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Invitaciones Pendientes
            </CardTitle>
            <CardDescription>
              Usuarios invitados que aún no han aceptado la invitación
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="animate-pulse">
                    <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                    <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                  </div>
                ))}
              </div>
            ) : invitations.length === 0 ? (
              <div className="text-center py-8">
                <Users className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-500">No hay invitaciones pendientes</p>
              </div>
            ) : (
              <div className="space-y-4">
                {invitations.map((invitation) => (
                  <div key={invitation.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center space-x-3">
                      <div className="h-10 w-10 bg-blue-100 rounded-full flex items-center justify-center">
                        <UserCheck className="h-5 w-5 text-blue-600" />
                      </div>
                      <div>
                        <p className="font-medium">{invitation.name}</p>
                        <p className="text-sm text-gray-500">{invitation.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Badge variant={getRoleBadgeVariant(invitation.role, invitation.isCustomRole)}>
                        {getRoleLabel(invitation.role, invitation.isCustomRole)}
                      </Badge>
                      <Badge variant="outline">
                        <Clock className="h-3 w-3 mr-1" />
                        Pendiente
                      </Badge>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => handleDeleteInvitation(invitation.id, invitation.name || 'Usuario')}
                        title="Cancelar invitación"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Current Users */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Usuarios Actuales
          </CardTitle>
          <CardDescription>
            Miembros activos de su organización
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingUsers ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="animate-pulse">
                  <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                  <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                </div>
              ))}
            </div>
          ) : activeUsers.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
              <p className="text-gray-500">No hay usuarios activos adicionales</p>
              <p className="text-sm text-gray-400 mt-2">
                Los usuarios aparecerán aquí después de aceptar sus invitaciones
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {activeUsers.map((user) => (
                <div key={user.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex items-center space-x-3">
                    <div className="h-10 w-10 bg-green-100 rounded-full flex items-center justify-center">
                      <UserCheck className="h-5 w-5 text-green-600" />
                    </div>
                    <div>
                      <p className="font-medium">{user.name}</p>
                      <p className="text-sm text-gray-500">{user.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Badge variant={getRoleBadgeVariant(user.role, user.isCustomRole)}>
                      {getRoleLabel(user.role, user.isCustomRole)}
                    </Badge>
                    <Badge 
                      variant="outline" 
                      className={user.status === 'APPROVED' ? "text-green-600 border-green-200 bg-green-50" : "text-gray-500 border-gray-200 bg-gray-50"}
                    >
                      {user.status === 'APPROVED' ? <CheckCircle className="h-3 w-3 mr-1" /> : <ShieldAlert className="h-3 w-3 mr-1" />}
                      {user.status === 'APPROVED' ? 'Activo' : 'Inactivo'}
                    </Badge>
                    <div className="flex items-center ml-2 space-x-1 border-l pl-2">
                      <Switch 
                        checked={user.status === 'APPROVED'}
                        onCheckedChange={() => handleToggleStatus(user)}
                        title={user.status === 'APPROVED' ? 'Inactivar usuario' : 'Activar usuario'}
                      />
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 text-muted-foreground hover:text-primary"
                        onClick={() => handleOpenEdit(user)}
                        title="Editar permisos"
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => handleDeleteActiveUser(user)}
                        title="Eliminar usuario"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      {/* Edit User Modal */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Editar Permisos de Usuario</DialogTitle>
            <DialogDescription>
              Modifica el rol y el acceso a empresas de {editingUser?.name}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Rol en la Organización</Label>
              <Select
                value={editFormData.roleId}
                onValueChange={(value) => setEditFormData({ ...editFormData, roleId: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccione un rol" />
                </SelectTrigger>
                <SelectContent>
                  {roles.map(role => (
                    <SelectItem key={role.id} value={role.id}>{role.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Empresas Asignadas</Label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="w-full justify-between bg-background font-normal">
                    <span className="flex items-center truncate">
                      <Building2 className="h-4 w-4 mr-2 text-muted-foreground shrink-0" />
                      {editFormData.companyIds.length === 0 
                        ? "Seleccionar empresas..." 
                        : `${editFormData.companyIds.length} empresa${editFormData.companyIds.length > 1 ? 's' : ''} seleccionada${editFormData.companyIds.length > 1 ? 's' : ''}`}
                    </span>
                    <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-[--radix-dropdown-menu-trigger-width] max-h-60 overflow-y-auto">
                  {companies.length === 0 ? (
                    <div className="p-2 text-sm text-muted-foreground text-center">No tienes empresas asignadas</div>
                  ) : (
                    companies.map(company => (
                      <DropdownMenuCheckboxItem
                        key={company.id}
                        checked={editFormData.companyIds.includes(company.id)}
                        onCheckedChange={() => toggleEditCompany(company.id)}
                      >
                        <div className="flex flex-col max-w-full">
                          <span className="truncate">{company.businessName}</span>
                          <span className="text-xs text-muted-foreground">{company.rfc}</span>
                        </div>
                      </DropdownMenuCheckboxItem>
                    ))
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)} disabled={savingEdit}>
              Cancelar
            </Button>
            <Button onClick={handleSaveEdit} disabled={savingEdit}>
              {savingEdit ? 'Guardando...' : 'Guardar Cambios'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}