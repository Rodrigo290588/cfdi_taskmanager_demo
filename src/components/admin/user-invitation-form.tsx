'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Users, Mail, UserPlus, Loader2, Copy, Check, Building2, ChevronDown } from 'lucide-react'
import { showSuccess, showError } from '@/lib/toast'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface UserInvitationFormProps {
  onSuccess?: () => void
}

export function UserInvitationForm({ onSuccess }: UserInvitationFormProps) {
  const [loading, setLoading] = useState(false)
  const [roles, setRoles] = useState<Array<{ id: string; name: string; isSystemRole: boolean }>>([])
  const [companies, setCompanies] = useState<Array<{ id: string; businessName: string; rfc: string }>>([])
  
  // Dialog state
  const [showInviteDialog, setShowInviteDialog] = useState(false)
  const [inviteLink, setInviteLink] = useState('')
  const [copied, setCopied] = useState(false)
  
  const [formData, setFormData] = useState<{
    email: string
    name: string
    roleId: string
    companyIds: string[]
    providerRfc?: string
    providerName?: string
  }>({
    email: '',
    name: '',
    roleId: 'VIEWER',
    companyIds: [],
    providerRfc: '',
    providerName: ''
  })

  // Detect if selected role is provider
  const selectedRoleName = roles.find(r => r.id === formData.roleId)?.name?.toLowerCase() || ''
  const isProvider = selectedRoleName.includes('proveedor')

  useEffect(() => {
    fetchRoles()
    fetchCompanies()
  }, [])

  const fetchRoles = async () => {
    try {
      const res = await fetch('/api/admin/roles')
      const data = await res.json()
      if (res.ok && data.roles) {
        setRoles(data.roles)
      }
    } catch (error) {
      console.error('Error fetching roles:', error)
    }
  }

  const fetchCompanies = async () => {
    try {
      const res = await fetch('/api/user/company-access')
      const data = await res.json()
      if (res.ok && data.companies) {
        setCompanies(data.companies)
      }
    } catch (error) {
      console.error('Error fetching companies:', error)
    }
  }

  const toggleCompany = (companyId: string) => {
    setFormData(prev => {
      const newCompanyIds = prev.companyIds.includes(companyId)
        ? prev.companyIds.filter(id => id !== companyId)
        : [...prev.companyIds, companyId]
      return { ...prev, companyIds: newCompanyIds }
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    // Custom Validations for Provider
    if (isProvider) {
      if (!formData.providerRfc || formData.providerRfc.trim() === '') {
        showError('Validación', 'El RFC del proveedor es obligatorio.')
        return
      }
      
      const rfcRegex = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i
      if (!rfcRegex.test(formData.providerRfc.trim())) {
        showError('Validación', 'El RFC del proveedor no tiene un formato válido.')
        return
      }

      if (!formData.providerName || formData.providerName.trim() === '') {
        showError('Validación', 'El nombre del proveedor es obligatorio.')
        return
      }

      if (formData.companyIds.length === 0) {
        showError('Validación', 'Debes asignar al menos una empresa al proveedor.')
        return
      }
    }
    
    try {
      setLoading(true)
      
      const response = await fetch('/api/admin/users/invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData)
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Error al invitar usuario')
      }

      showSuccess('Usuario invitado exitosamente', 
        data.existingUser 
          ? 'El usuario ya existe y fue agregado a la organización'
          : 'Se ha enviado una invitación al usuario'
      )

      if (data.invitationToken) {
        const link = `${window.location.origin}/auth/accept-invite?token=${data.invitationToken}`
        setInviteLink(link)
        setShowInviteDialog(true)
      }

      // Reset form
      setFormData({ email: '', name: '', roleId: 'VIEWER', companyIds: [], providerRfc: '', providerName: '' })
      
      // Notify parent to refresh list
      if (onSuccess) onSuccess()
    } catch (error) {
      showError('Error al invitar usuario', error instanceof Error ? error.message : 'Error desconocido')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserPlus className="h-5 w-5" />
          Invitar Usuario
        </CardTitle>
        <CardDescription>
          Invite nuevos usuarios a unirse a su organización
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">
              <Mail className="h-4 w-4 inline mr-1" />
              Correo Electrónico
            </Label>
            <Input
              id="email"
              type="email"
              placeholder="usuario@empresa.com"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">
              <Users className="h-4 w-4 inline mr-1" />
              Nombre Completo
            </Label>
            <Input
              id="name"
              type="text"
              placeholder="Juan Pérez García"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="role">Rol en la Organización</Label>
            <Select
              value={formData.roleId}
              onValueChange={(value) => setFormData({ ...formData, roleId: value })}
            >
              <SelectTrigger id="role">
                <SelectValue placeholder="Seleccione un rol" />
              </SelectTrigger>
              <SelectContent>
                {roles.map(role => (
                  <SelectItem key={role.id} value={role.id}>
                    {role.name}
                  </SelectItem>
                ))}
                {roles.length === 0 && (
                  <>
                    <SelectItem value="VIEWER">Visualizador</SelectItem>
                    <SelectItem value="AUDITOR">Auditor</SelectItem>
                    <SelectItem value="ADMIN">Administrador</SelectItem>
                  </>
                )}
              </SelectContent>
            </Select>
          </div>

          {isProvider && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="providerRfc">RFC del Proveedor <span className="text-red-500">*</span></Label>
                <Input
                  id="providerRfc"
                  type="text"
                  placeholder="XAXX010101000"
                  value={formData.providerRfc}
                  onChange={(e) => setFormData({ ...formData, providerRfc: e.target.value.toUpperCase() })}
                  maxLength={13}
                  required={isProvider}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="providerName">Nombre del Proveedor <span className="text-red-500">*</span></Label>
                <Input
                  id="providerName"
                  type="text"
                  placeholder="Razón Social o Nombre"
                  value={formData.providerName}
                  onChange={(e) => setFormData({ ...formData, providerName: e.target.value })}
                  required={isProvider}
                />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>Empresas Asignadas {isProvider ? <span className="text-red-500">*</span> : '(Opcional)'}</Label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button 
                  variant="outline" 
                  className="w-full justify-between bg-background font-normal"
                >
                  <span className="flex items-center truncate">
                    <Building2 className="h-4 w-4 mr-2 text-muted-foreground shrink-0" />
                    {formData.companyIds.length === 0 
                      ? "Seleccionar empresas..." 
                      : `${formData.companyIds.length} empresa${formData.companyIds.length > 1 ? 's' : ''} seleccionada${formData.companyIds.length > 1 ? 's' : ''}`}
                  </span>
                  <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-[--radix-dropdown-menu-trigger-width] max-h-60 overflow-y-auto">
                {companies.length === 0 ? (
                  <div className="p-2 text-sm text-muted-foreground text-center">
                    No tienes empresas asignadas
                  </div>
                ) : (
                  companies.map(company => (
                    <DropdownMenuCheckboxItem
                      key={company.id}
                      checked={formData.companyIds.includes(company.id)}
                      onCheckedChange={() => toggleCompany(company.id)}
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

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Invitando...
              </>
            ) : (
              <>
                <UserPlus className="mr-2 h-4 w-4" />
                Invitar Usuario
              </>
            )}
          </Button>
        </form>
      </CardContent>

      <Dialog open={showInviteDialog} onOpenChange={setShowInviteDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invitación Creada</DialogTitle>
            <DialogDescription>
              Se ha enviado un correo electrónico al usuario con este enlace. También puedes copiarlo y enviarlo manualmente.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center space-x-2 mt-4">
            <div className="grid flex-1 gap-2">
              <Input
                id="link"
                defaultValue={inviteLink}
                readOnly
                className="bg-muted"
              />
            </div>
            <Button
              type="button"
              size="sm"
              className="px-3"
              onClick={() => {
                try {
                  if (navigator.clipboard && window.isSecureContext) {
                    navigator.clipboard.writeText(inviteLink)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 2000)
                    showSuccess('Copiado', 'Enlace copiado al portapapeles')
                  } else {
                    const textArea = document.createElement("textarea")
                    textArea.value = inviteLink
                    textArea.style.position = "fixed"
                    textArea.style.left = "-999999px"
                    document.body.appendChild(textArea)
                    textArea.focus()
                    textArea.select()
                    const successful = document.execCommand('copy')
                    document.body.removeChild(textArea)
                    
                    if (successful) {
                      setCopied(true)
                      setTimeout(() => setCopied(false), 2000)
                      showSuccess('Copiado', 'Enlace copiado al portapapeles')
                    } else {
                      showError('Error', 'No se pudo copiar el enlace')
                    }
                  }
                } catch (err) {
                  console.error(err)
                  showError('Error', 'Tu navegador bloqueó el portapapeles')
                }
              }}
            >
              <span className="sr-only">Copiar</span>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <DialogFooter className="sm:justify-end mt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowInviteDialog(false)}
            >
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}