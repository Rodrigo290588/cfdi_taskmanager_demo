'use client'

import { useTenant } from '@/hooks/use-tenant'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { Users, Building2, UserCheck, CheckCircle, Circle, Edit3 } from 'lucide-react'
import Link from 'next/link'

export function OnboardingDashboard() {
  const { 
    tenantState, 
    loading, 
    error, 
    getOnboardingProgress, 
    getNextOnboardingStep 
  } = useTenant()

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Cargando configuración...</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-gray-200 rounded w-3/4"></div>
            <div className="h-4 bg-gray-200 rounded w-1/2"></div>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Error</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-red-600">{error}</p>
        </CardContent>
      </Card>
    )
  }

  if (!tenantState) {
    return null
  }

  const progress = getOnboardingProgress()
  const nextStep = getNextOnboardingStep()
  const { status, onboardingSteps } = tenantState

  const getStepIcon = (stepKey: string) => {
    const isCompleted = status.currentState.completedSteps.includes(stepKey)
    
    switch (stepKey) {
      case 'TENANT_SETUP':
        return isCompleted ? <CheckCircle className="h-5 w-5 text-green-500" /> : <Circle className="h-5 w-5 text-gray-400" />
      case 'COMPANY_REGISTRATION':
        return <Building2 className="h-5 w-5" />
      case 'USER_INVITATION':
        return <Users className="h-5 w-5" />
      case 'PROFILE_ASSIGNMENT':
        return <UserCheck className="h-5 w-5" />
      default:
        return <Circle className="h-5 w-5" />
    }
  }

  const getStepAction = (stepKey: string) => {
    switch (stepKey) {
      case 'COMPANY_REGISTRATION':
        return { href: '/companies', label: 'Registrar Empresa' }
      case 'USER_INVITATION':
        return { href: '/admin/users/invite', label: 'Invitar Usuarios' }
      case 'PROFILE_ASSIGNMENT':
        return { href: '/admin/users', label: 'Asignar Perfiles' }
      default:
        return null
    }
  }

  return (
    <div className="space-y-6">
      {/* Progress Overview */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div>
            <CardTitle>Progreso de Configuración de la Organización</CardTitle>
            <CardDescription>
              Complete los pasos requeridos para habilitar el acceso operativo
            </CardDescription>
          </div>
          <Link href="/tenant/management">
            <Button variant="outline" size="sm">
              <Edit3 className="h-4 w-4 mr-2" />
              Editar Información
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex justify-between text-sm">
              <span>Progreso General</span>
              <span>{progress}%</span>
            </div>
            <Progress value={progress} className="h-2" />
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
              <div className="text-center p-4 bg-blue-50 rounded-lg">
                <div className="text-2xl font-bold text-blue-600">
                  {status.currentState.totalInvitations}
                </div>
                <div className="text-sm text-gray-600">Usuarios</div>
                <div className="text-xs text-gray-500">
                  Mínimo: {status.requirements.minUsers}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Aprobados: {status.currentState.totalApprovedUsers}
                </div>
              </div>
              
              <div className="text-center p-4 bg-green-50 rounded-lg">
                <div className="text-2xl font-bold text-green-600">
                  {status.currentState.totalCompanies}
                </div>
                <div className="text-sm text-gray-600">Empresas</div>
                <div className="text-xs text-gray-500">
                  Mínimo: {status.requirements.minCompanies}
                </div>
              </div>
              
              <div className="text-center p-4 bg-purple-50 rounded-lg">
                <div className="text-2xl font-bold text-purple-600">
                  {status.currentState.completedSteps.length}
                </div>
                <div className="text-sm text-gray-600">Pasos Completados</div>
                <div className="text-xs text-gray-500">
                  Total: {onboardingSteps.length}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Onboarding Steps */}
      <Card>
        <CardHeader>
          <CardTitle>Pasos de Configuración</CardTitle>
          <CardDescription>
            Siga estos pasos para completar la configuración de su organización
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {onboardingSteps.map((step) => {
              const isCompleted = status.currentState.completedSteps.includes(step.key)
              const isNextStep = step.key === nextStep
              const action = getStepAction(step.key)

              return (
                <div
                  key={step.key}
                  className={`flex items-center justify-between p-4 rounded-lg border ${
                    isCompleted
                      ? 'bg-green-50 border-green-200'
                      : isNextStep
                      ? 'bg-blue-50 border-blue-200'
                      : 'bg-gray-50 border-gray-200'
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    {getStepIcon(step.key)}
                    <div>
                      <h4 className={`font-medium ${
                        isCompleted ? 'text-green-800' : 'text-gray-900'
                      }`}>
                        {step.title}
                      </h4>
                      <p className={`text-sm ${
                        isCompleted ? 'text-green-600' : 'text-gray-600'
                      }`}>
                        {step.description}
                      </p>
                    </div>
                  </div>
                  
                  {action && !isCompleted && (
                    <Link href={action.href}>
                      <Button size="sm" variant={isNextStep ? 'default' : 'outline'}>
                        {action.label}
                      </Button>
                    </Link>
                  )}
                  
                  {isCompleted && (
                    <span className="text-sm text-green-600 font-medium">
                      Completado
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Access Status */}
      <Card>
        <CardHeader>
          <CardTitle>Estado de Acceso</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className={`flex items-center space-x-2 ${status.currentState.completedSteps.includes('TENANT_SETUP') ? 'text-green-600' : 'text-yellow-600'}`}>
              {status.currentState.completedSteps.includes('TENANT_SETUP') ? (
                <CheckCircle className="h-5 w-5" />
              ) : (
                <Circle className="h-5 w-5" />
              )}
              <span className="font-medium">
                {status.currentState.completedSteps.includes('TENANT_SETUP') ? 'Configuración completa' : 'Configuración pendiente'}
              </span>
            </div>

            {tenantState.hasOperationalAccess ? (
              <div className="flex items-center space-x-2 text-green-600">
                <CheckCircle className="h-5 w-5" />
                <span className="font-medium">Acceso operativo habilitado</span>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center space-x-2 text-yellow-600">
                  <Circle className="h-5 w-5" />
                  <span className="font-medium">Acceso operativo deshabilitado</span>
                </div>
                <p className="text-sm text-gray-600">
                  Complete los pasos requeridos de usuarios y empresas para habilitar el acceso operativo.
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
