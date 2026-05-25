'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2, Plus, ShieldAlert, ShieldCheck, Trash2, Edit } from 'lucide-react'
import { showSuccess, showError } from '@/lib/toast'

interface CustomRole {
  id: string
  name: string
  description: string | null
  canViewEmission: boolean
  canViewReception: boolean
  canViewPayroll: boolean
  canViewSatPortal: boolean
  canViewMassDownloads: boolean
  canManageOrg: boolean
  granularPermissions?: Record<string, boolean>
  isSystemRole?: boolean
}

const DEFAULT_GRANULAR_PERMISSIONS = {
  emissionDashboard: true,
  emissionWorkpaper: true,
  emissionPartial: true,
  emissionCancelations: true,
  receptionDashboard: true,
  receptionWorkpaper: true,
  payrollDashboard: true,
  payrollReceipts: true,
  satConnection: true,
  satCfdiStatus: true,
  massKeys: true,
  massRequests: true,
  massVerification: true,
  massPackages: true,
  massPanel: true,
  orgCompanies: false,
  orgUsers: false,
  orgProfiles: false,
  orgRoles: false,
  orgSettings: false,
  providerDashboard: true
}

const DEFAULT_PERMISSIONS = {
  canViewEmission: true,
  canViewReception: true,
  canViewPayroll: true,
  canViewSatPortal: true,
  canViewMassDownloads: true,
  canManageOrg: false
}

export default function RolesManagementPage() {
  const [roles, setRoles] = useState<CustomRole[]>([])
  const [loading, setLoading] = useState(true)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingRole, setEditingRole] = useState<CustomRole | null>(null)
  
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    permissions: { ...DEFAULT_PERMISSIONS },
    granularPermissions: { ...DEFAULT_GRANULAR_PERMISSIONS }
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchRoles()
  }, [])

  const fetchRoles = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/admin/roles')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al cargar roles')
      setRoles(data.roles || [])
    } catch (error) {
      console.error(error)
      showError('Error', error instanceof Error ? error.message : 'Error desconocido')
    } finally {
      setLoading(false)
    }
  }

  const handleOpenDialog = (role?: CustomRole) => {
    if (role) {
      setEditingRole(role)
      setFormData({
        name: role.name,
        description: role.description || '',
        permissions: {
          canViewEmission: role.canViewEmission,
          canViewReception: role.canViewReception,
          canViewPayroll: role.canViewPayroll,
          canViewSatPortal: role.canViewSatPortal,
          canViewMassDownloads: role.canViewMassDownloads,
          canManageOrg: role.canManageOrg
        },
        granularPermissions: { ...DEFAULT_GRANULAR_PERMISSIONS, ...(role.granularPermissions as Partial<typeof DEFAULT_GRANULAR_PERMISSIONS> || {}) }
      })
    } else {
      setEditingRole(null)
      setFormData({
        name: '',
        description: '',
        permissions: { ...DEFAULT_PERMISSIONS },
        granularPermissions: { ...DEFAULT_GRANULAR_PERMISSIONS }
      })
    }
    setIsDialogOpen(true)
  }

  const handleSave = async () => {
    if (!formData.name.trim()) {
      showError('Error', 'El nombre del rol es requerido')
      return
    }

    try {
      setSaving(true)
      const url = editingRole ? `/api/admin/roles/${editingRole.id}` : '/api/admin/roles'
      const method = editingRole ? 'PUT' : 'POST'
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      })
      
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al guardar el rol')
      
      showSuccess('Éxito', editingRole ? 'Rol actualizado correctamente' : 'Rol creado correctamente')
      setIsDialogOpen(false)
      fetchRoles()
    } catch (error) {
      console.error(error)
      showError('Error', error instanceof Error ? error.message : 'Error desconocido')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('¿Está seguro que desea eliminar este rol? Esta acción no se puede deshacer.')) return

    try {
      setLoading(true)
      const res = await fetch(`/api/admin/roles/${id}`, {
        method: 'DELETE'
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al eliminar el rol')
      
      showSuccess('Éxito', 'Rol eliminado correctamente')
      fetchRoles()
    } catch (error) {
      console.error(error)
      showError('Error', error instanceof Error ? error.message : 'Error desconocido')
      setLoading(false)
    }
  }

  const togglePermission = (key: keyof typeof DEFAULT_PERMISSIONS) => {
    setFormData(prev => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        [key]: !prev.permissions[key]
      }
    }))
  }

  const toggleGranularPermission = (key: keyof typeof DEFAULT_GRANULAR_PERMISSIONS) => {
    setFormData(prev => ({
      ...prev,
      granularPermissions: {
        ...prev.granularPermissions,
        [key]: !prev.granularPermissions[key]
      }
    }))
  }

  return (
    <div className="container mx-auto py-8 px-4 md:px-8">
      <div className="mb-8 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Roles y Permisos</h1>
          <p className="text-muted-foreground mt-2">Cree roles personalizados y asigne permisos específicos</p>
        </div>
        <Button onClick={() => handleOpenDialog()} className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Nuevo Rol
        </Button>
      </div>

      {loading && roles.length === 0 ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : roles.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent>
            <ShieldAlert className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-lg font-medium text-foreground">No hay roles personalizados</p>
            <p className="text-muted-foreground mt-1 mb-6">Cree su primer rol personalizado para comenzar a gestionar permisos</p>
            <Button onClick={() => handleOpenDialog()}>Crear Rol</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {roles.map(role => (
            <Card key={role.id} className="flex flex-col">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-primary" />
                  {role.name}
                </CardTitle>
                <CardDescription className="min-h-[40px] line-clamp-2">
                  {role.description || 'Sin descripción'}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1">
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Emisión:</span>
                    <span className={role.canViewEmission ? "text-green-600 font-medium" : "text-red-500"}>{role.canViewEmission ? 'Sí' : 'No'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Recepción:</span>
                    <span className={role.canViewReception ? "text-green-600 font-medium" : "text-red-500"}>{role.canViewReception ? 'Sí' : 'No'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Nómina:</span>
                    <span className={role.canViewPayroll ? "text-green-600 font-medium" : "text-red-500"}>{role.canViewPayroll ? 'Sí' : 'No'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Portal SAT:</span>
                    <span className={role.canViewSatPortal ? "text-green-600 font-medium" : "text-red-500"}>{role.canViewSatPortal ? 'Sí' : 'No'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Descargas Masivas:</span>
                    <span className={role.canViewMassDownloads ? "text-green-600 font-medium" : "text-red-500"}>{role.canViewMassDownloads ? 'Sí' : 'No'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Gestionar Org:</span>
                    <span className={role.canManageOrg ? "text-green-600 font-medium" : "text-red-500"}>{role.canManageOrg ? 'Sí' : 'No'}</span>
                  </div>
                </div>
              </CardContent>
              <CardFooter className="flex justify-end gap-2 border-t pt-4">
                {!role.isSystemRole && (
                  <>
                    <Button variant="outline" size="sm" onClick={() => handleOpenDialog(role)}>
                      <Edit className="h-4 w-4 mr-1" /> Editar
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => handleDelete(role.id)}>
                      <Trash2 className="h-4 w-4 mr-1" /> Eliminar
                    </Button>
                  </>
                )}
                {role.isSystemRole && (
                  <span className="text-xs text-muted-foreground italic px-2 py-1">Rol de sistema (Solo lectura)</span>
                )}
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingRole ? 'Editar Rol' : 'Crear Nuevo Rol'}</DialogTitle>
            <DialogDescription>
              {editingRole ? 'Modifique los permisos para este rol' : 'Defina el nombre y los permisos para el nuevo rol'}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-6 py-4">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Nombre del Rol <span className="text-red-500">*</span></Label>
                <Input 
                  id="name" 
                  placeholder="Ej. Supervisor Contable" 
                  value={formData.name}
                  onChange={e => setFormData({...formData, name: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Descripción (Opcional)</Label>
                <Input 
                  id="description" 
                  placeholder="Breve descripción del propósito de este rol" 
                  value={formData.description}
                  onChange={e => setFormData({...formData, description: e.target.value})}
                />
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="font-semibold text-lg border-b pb-2">Permisos del Sistema</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* CFDI Emitidos */}
                <div className="flex flex-col p-4 border rounded-lg bg-card hover:bg-accent/5 transition-colors">
                  <div className="flex items-start justify-between mb-4 pb-3 border-b">
                    <div className="space-y-1 pr-4">
                      <Label className="text-base font-semibold">CFDI Emitidos (Ingresos)</Label>
                      <p className="text-xs text-muted-foreground">Módulo principal de ingresos</p>
                    </div>
                    <Switch 
                      checked={formData.permissions.canViewEmission}
                      onCheckedChange={() => togglePermission('canViewEmission')}
                      className="mt-1"
                    />
                  </div>
                  <div className="space-y-3 pl-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm text-muted-foreground font-normal">Tablero principal de ingresos</Label>
                      <Switch size="sm" checked={formData.granularPermissions.emissionDashboard} onCheckedChange={() => toggleGranularPermission('emissionDashboard')} disabled={!formData.permissions.canViewEmission} />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label className="text-sm text-muted-foreground font-normal">Reporte de ingresos (Hoja de trabajo)</Label>
                      <Switch size="sm" checked={formData.granularPermissions.emissionWorkpaper} onCheckedChange={() => toggleGranularPermission('emissionWorkpaper')} disabled={!formData.permissions.canViewEmission} />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label className="text-sm text-muted-foreground font-normal">Gestión de ingresos parcialmente cobrados</Label>
                      <Switch size="sm" checked={formData.granularPermissions.emissionPartial} onCheckedChange={() => toggleGranularPermission('emissionPartial')} disabled={!formData.permissions.canViewEmission} />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label className="text-sm text-muted-foreground font-normal">Monitor de cancelaciones</Label>
                      <Switch size="sm" checked={formData.granularPermissions.emissionCancelations} onCheckedChange={() => toggleGranularPermission('emissionCancelations')} disabled={!formData.permissions.canViewEmission} />
                    </div>
                  </div>
                </div>
                
                {/* CFDI Recibidos */}
                <div className="flex flex-col p-4 border rounded-lg bg-card hover:bg-accent/5 transition-colors">
                  <div className="flex items-start justify-between mb-4 pb-3 border-b">
                    <div className="space-y-1 pr-4">
                      <Label className="text-base font-semibold">CFDI Recibidos (Egresos)</Label>
                      <p className="text-xs text-muted-foreground">Módulo principal de egresos</p>
                    </div>
                    <Switch 
                      checked={formData.permissions.canViewReception}
                      onCheckedChange={() => togglePermission('canViewReception')}
                      className="mt-1"
                    />
                  </div>
                  <div className="space-y-3 pl-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm text-muted-foreground font-normal">Dashboard de gastos y compras</Label>
                      <Switch size="sm" checked={formData.granularPermissions.receptionDashboard} onCheckedChange={() => toggleGranularPermission('receptionDashboard')} disabled={!formData.permissions.canViewReception} />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label className="text-sm text-muted-foreground font-normal">Hoja de trabajo de egresos</Label>
                      <Switch size="sm" checked={formData.granularPermissions.receptionWorkpaper} onCheckedChange={() => toggleGranularPermission('receptionWorkpaper')} disabled={!formData.permissions.canViewReception} />
                    </div>
                  </div>
                </div>
                
                {/* Nómina */}
                <div className="flex flex-col p-4 border rounded-lg bg-card hover:bg-accent/5 transition-colors">
                  <div className="flex items-start justify-between mb-4 pb-3 border-b">
                    <div className="space-y-1 pr-4">
                      <Label className="text-base font-semibold">Nómina</Label>
                      <p className="text-xs text-muted-foreground">Módulo de recibos de nómina</p>
                    </div>
                    <Switch 
                      checked={formData.permissions.canViewPayroll}
                      onCheckedChange={() => togglePermission('canViewPayroll')}
                      className="mt-1"
                    />
                  </div>
                  <div className="space-y-3 pl-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm text-muted-foreground font-normal">Dashboard general de nómina</Label>
                      <Switch size="sm" checked={formData.granularPermissions.payrollDashboard} onCheckedChange={() => toggleGranularPermission('payrollDashboard')} disabled={!formData.permissions.canViewPayroll} />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label className="text-sm text-muted-foreground font-normal">Consulta de recibos de empleados</Label>
                      <Switch size="sm" checked={formData.granularPermissions.payrollReceipts} onCheckedChange={() => toggleGranularPermission('payrollReceipts')} disabled={!formData.permissions.canViewPayroll} />
                    </div>
                  </div>
                </div>
                
                {/* Portal SAT */}
                <div className="flex flex-col p-4 border rounded-lg bg-card hover:bg-accent/5 transition-colors">
                  <div className="flex items-start justify-between mb-4 pb-3 border-b">
                    <div className="space-y-1 pr-4">
                      <Label className="text-base font-semibold">Portal SAT</Label>
                      <p className="text-xs text-muted-foreground">Conexión directa al SAT</p>
                    </div>
                    <Switch 
                      checked={formData.permissions.canViewSatPortal}
                      onCheckedChange={() => togglePermission('canViewSatPortal')}
                      className="mt-1"
                    />
                  </div>
                  <div className="space-y-3 pl-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm text-muted-foreground font-normal">Monitor de conexión al SAT</Label>
                      <Switch size="sm" checked={formData.granularPermissions.satConnection} onCheckedChange={() => toggleGranularPermission('satConnection')} disabled={!formData.permissions.canViewSatPortal} />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label className="text-sm text-muted-foreground font-normal">Consulta de estado de CFDIs</Label>
                      <Switch size="sm" checked={formData.granularPermissions.satCfdiStatus} onCheckedChange={() => toggleGranularPermission('satCfdiStatus')} disabled={!formData.permissions.canViewSatPortal} />
                    </div>
                  </div>
                </div>
                
                {/* Descargas Masivas */}
                <div className="flex flex-col p-4 border rounded-lg bg-card hover:bg-accent/5 transition-colors">
                  <div className="flex items-start justify-between mb-4 pb-3 border-b">
                    <div className="space-y-1 pr-4">
                      <Label className="text-base font-semibold">Descargas Masivas</Label>
                      <p className="text-xs text-muted-foreground">Peticiones al WebService del SAT</p>
                    </div>
                    <Switch 
                      checked={formData.permissions.canViewMassDownloads}
                      onCheckedChange={() => togglePermission('canViewMassDownloads')}
                      className="mt-1"
                    />
                  </div>
                  <div className="space-y-3 pl-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm text-muted-foreground font-normal">Configuración de llaves privadas</Label>
                      <Switch size="sm" checked={formData.granularPermissions.massKeys} onCheckedChange={() => toggleGranularPermission('massKeys')} disabled={!formData.permissions.canViewMassDownloads} />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label className="text-sm text-muted-foreground font-normal">Solicitud de descargas al WebService</Label>
                      <Switch size="sm" checked={formData.granularPermissions.massRequests} onCheckedChange={() => toggleGranularPermission('massRequests')} disabled={!formData.permissions.canViewMassDownloads} />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label className="text-sm text-muted-foreground font-normal">Monitor de verificación de peticiones</Label>
                      <Switch size="sm" checked={formData.granularPermissions.massVerification} onCheckedChange={() => toggleGranularPermission('massVerification')} disabled={!formData.permissions.canViewMassDownloads} />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label className="text-sm text-muted-foreground font-normal">Descarga de paquetes (ZIP)</Label>
                      <Switch size="sm" checked={formData.granularPermissions.massPackages} onCheckedChange={() => toggleGranularPermission('massPackages')} disabled={!formData.permissions.canViewMassDownloads} />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label className="text-sm text-muted-foreground font-normal">Panel de Control Fiscal CFDI</Label>
                      <Switch size="sm" checked={formData.granularPermissions.massPanel} onCheckedChange={() => toggleGranularPermission('massPanel')} disabled={!formData.permissions.canViewMassDownloads} />
                    </div>
                  </div>
                </div>
                
                {/* Proveedor */}
                <div className="flex flex-col p-4 border rounded-lg bg-card hover:bg-accent/5 transition-colors">
                  <div className="flex items-start justify-between mb-4 pb-3 border-b">
                    <div className="space-y-1 pr-4">
                      <Label className="text-base font-semibold">Proveedor</Label>
                      <p className="text-xs text-muted-foreground">Funcionalidades de Proveedores</p>
                    </div>
                    <Switch 
                      checked={formData.granularPermissions.providerDashboard}
                      onCheckedChange={() => toggleGranularPermission('providerDashboard')}
                      className="mt-1"
                    />
                  </div>
                  <div className="space-y-3 pl-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm text-muted-foreground font-normal">Reporte CFDI&apos;s</Label>
                      <Switch size="sm" checked={formData.granularPermissions.providerDashboard} onCheckedChange={() => toggleGranularPermission('providerDashboard')} disabled={!formData.granularPermissions.providerDashboard} />
                    </div>
                  </div>
                </div>

                {/* Gestionar Organización */}
                <div className="flex flex-col p-4 border rounded-lg bg-red-50/50 dark:bg-red-950/10 border-red-100 dark:border-red-900">
                  <div className="flex items-start justify-between mb-4 pb-3 border-b border-red-200 dark:border-red-800">
                    <div className="space-y-1 pr-4">
                      <Label className="text-base font-semibold text-red-700 dark:text-red-400">Gestionar Organización</Label>
                      <p className="text-xs text-muted-foreground text-red-600/80 dark:text-red-400/80">Permisos administrativos avanzados</p>
                    </div>
                    <Switch 
                      checked={formData.permissions.canManageOrg}
                      onCheckedChange={() => togglePermission('canManageOrg')}
                      className="mt-1"
                    />
                  </div>
                  <div className="space-y-3 pl-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm text-muted-foreground font-normal">Registrar y administrar empresas</Label>
                      <Switch size="sm" checked={formData.granularPermissions.orgCompanies} onCheckedChange={() => toggleGranularPermission('orgCompanies')} disabled={!formData.permissions.canManageOrg} />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label className="text-sm text-muted-foreground font-normal">Invitar y gestionar usuarios</Label>
                      <Switch size="sm" checked={formData.granularPermissions.orgUsers} onCheckedChange={() => toggleGranularPermission('orgUsers')} disabled={!formData.permissions.canManageOrg} />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label className="text-sm text-muted-foreground font-normal">Asignar perfiles y accesos</Label>
                      <Switch size="sm" checked={formData.granularPermissions.orgProfiles} onCheckedChange={() => toggleGranularPermission('orgProfiles')} disabled={!formData.permissions.canManageOrg} />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label className="text-sm text-muted-foreground font-normal">Crear y editar roles personalizados</Label>
                      <Switch size="sm" checked={formData.granularPermissions.orgRoles} onCheckedChange={() => toggleGranularPermission('orgRoles')} disabled={!formData.permissions.canManageOrg} />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label className="text-sm text-muted-foreground font-normal">Modificar preferencias del sistema</Label>
                      <Switch size="sm" checked={formData.granularPermissions.orgSettings} onCheckedChange={() => toggleGranularPermission('orgSettings')} disabled={!formData.permissions.canManageOrg} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              {editingRole ? 'Actualizar Rol' : 'Crear Rol'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
