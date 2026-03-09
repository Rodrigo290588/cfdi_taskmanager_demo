'use client'

import { useState, useEffect } from 'react'
import { UserInvitationForm } from '@/components/admin/user-invitation-form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Users, Mail, UserCheck, Clock, CheckCircle } from 'lucide-react'
import { showError } from '@/lib/toast'

interface Invitation {
  id: string
  userId: string
  name: string
  email: string
  role: string
  status: string
  invitedAt: string
  invitationToken: string
}

export default function UsersManagementPage() {
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchInvitations()
  }, [])

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

  const getRoleBadgeVariant = (role: string) => {
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

  const getRoleLabel = (role: string) => {
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

  return (
    <div className="container mx-auto py-8">
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
        <UserInvitationForm />

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
                      <Badge variant={getRoleBadgeVariant(invitation.role)}>
                        {getRoleLabel(invitation.role)}
                      </Badge>
                      <Badge variant="outline">
                        <Clock className="h-3 w-3 mr-1" />
                        Pendiente
                      </Badge>
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
          <div className="text-center py-8">
            <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
            <p className="text-gray-500">No hay usuarios activos adicionales</p>
            <p className="text-sm text-gray-400 mt-2">
              Los usuarios aparecerán aquí después de aceptar sus invitaciones
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}