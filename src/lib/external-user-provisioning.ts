import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { createAuditEntry } from '@/lib/audit'
import { inviteUserToOrganization } from '@/lib/user-invitation-service'

const usernameRegex = /^[\p{L}\p{N}]+(?:[ _-][\p{L}\p{N}]+)*$/u
const mexicanRfcRegex = /^([A-ZÑ&]{3,4})\d{6}([A-Z0-9]{3})$/i

export function createExternalUserSchema(validRoles: string[]) {
  const normalizedRoles = new Set(validRoles.map(role => role.trim().toLowerCase()))

  return z.object({
    correo: z.string().email('El correo debe tener un formato válido'),
    nombre_usuario: z
      .string()
      .min(1, 'El nombre de usuario es obligatorio')
      .regex(usernameRegex, 'El nombre de usuario debe ser alfanumérico'),
    rol_empresa: z
      .string()
      .min(1, 'El rol de empresa es obligatorio')
      .refine(role => normalizedRoles.has(role.trim().toLowerCase()), {
        message: 'El rol de empresa no existe en la organización'
      }),
    empresas: z
      .array(
        z.string().regex(mexicanRfcRegex, 'Cada empresa debe ser un RFC mexicano válido')
      )
      .min(1, 'Debes enviar al menos una empresa'),
    rfc_proveedor: z
      .string()
      .regex(mexicanRfcRegex, 'El RFC del proveedor debe ser un RFC mexicano válido')
      .optional(),
    nombre_proveedor: z.string().min(1, 'El nombre del proveedor es obligatorio').optional(),
    externalId: z.string().optional()
  }).superRefine((data, ctx) => {
    const isProviderRole = data.rol_empresa.trim().toLowerCase() === 'proveedor'

    if (isProviderRole) {
      if (!data.rfc_proveedor) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rfc_proveedor'],
          message: 'El RFC del proveedor es obligatorio cuando el rol es proveedor'
        })
      }

      if (!data.nombre_proveedor) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['nombre_proveedor'],
          message: 'El nombre del proveedor es obligatorio cuando el rol es proveedor'
        })
      }
    } else {
      if (typeof data.rfc_proveedor !== 'undefined') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rfc_proveedor'],
          message: 'El campo rfc_proveedor no está permitido cuando el rol no es proveedor'
        })
      }

      if (typeof data.nombre_proveedor !== 'undefined') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['nombre_proveedor'],
          message: 'El campo nombre_proveedor no está permitido cuando el rol no es proveedor'
        })
      }
    }
  }).strict()
}

export type ExternalUserInput = z.infer<ReturnType<typeof createExternalUserSchema>>

function normalizeSystemRole(role: string) {
  const roleLower = role.trim().toLowerCase()

  if (role === 'ADMIN' || roleLower === 'administrador') return 'ADMIN' as const
  if (role === 'AUDITOR' || roleLower === 'auditor') return 'AUDITOR' as const
  if (role === 'VIEWER' || roleLower === 'visualizador') return 'VIEWER' as const

  return null
}

export async function provisionExternalUsers(params: {
  organizationId: string
  sourceClientId: string
  sourceIp?: string | null
  sourceUserAgent?: string | null
  users: ExternalUserInput[]
}) {
  const { organizationId, sourceClientId, sourceIp, sourceUserAgent, users } = params

  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true, ownerId: true }
  })

  if (!organization?.ownerId) {
    throw new Error('La organización no tiene un propietario configurado')
  }

  const customRoles = await prisma.customRole.findMany({
    where: { organizationId }
  })

  const orgMembers = await prisma.member.findMany({
    where: { organizationId },
    select: { userId: true }
  })

  const companies = await prisma.company.findMany({
    where: {
      createdBy: {
        in: orgMembers.map(member => member.userId)
      }
    },
    select: { id: true, rfc: true }
  })

  const results: Array<{
    email: string
    status: 'created' | 'rejected'
    message: string
    externalId?: string
  }> = []

  for (const user of users) {
    try {
      const systemRole = normalizeSystemRole(user.rol_empresa) || 'VIEWER'
      const customRole = normalizeSystemRole(user.rol_empresa)
        ? null
        : customRoles.find(role =>
            role.id === user.rol_empresa ||
            role.name.toLowerCase() === user.rol_empresa.trim().toLowerCase()
          )

      if (!normalizeSystemRole(user.rol_empresa) && !customRole) {
        results.push({
          email: user.correo,
          externalId: user.externalId,
          status: 'rejected',
          message: `El rol "${user.rol_empresa}" no existe en la organización`
        })
        continue
      }

      const isProvider = user.rol_empresa.trim().toLowerCase() === 'proveedor' || !!customRole?.name.toLowerCase().includes('proveedor')

      if (isProvider) {
        if (!user.rfc_proveedor) {
          results.push({
            email: user.correo,
            externalId: user.externalId,
            status: 'rejected',
            message: 'El RFC proveedor es obligatorio para el rol Proveedor'
          })
          continue
        }

        if (!user.nombre_proveedor) {
          results.push({
            email: user.correo,
            externalId: user.externalId,
            status: 'rejected',
            message: 'El nombre del proveedor es obligatorio para el rol Proveedor'
          })
          continue
        }
      }

      const rfcRegex = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i
      if (user.rfc_proveedor && !rfcRegex.test(user.rfc_proveedor)) {
        results.push({
          email: user.correo,
          externalId: user.externalId,
          status: 'rejected',
          message: 'El RFC proveedor no tiene un formato válido'
        })
        continue
      }

      const requestedCompanyIds = new Set<string>()
      let hasInvalidCompanyRfc = false

      for (const rfc of user.empresas || []) {
        const company = companies.find(item => item.rfc.toUpperCase() === rfc.trim().toUpperCase())
        if (!company) {
          results.push({
            email: user.correo,
            externalId: user.externalId,
            status: 'rejected',
            message: `No existe una empresa con RFC ${rfc} en la organización`
          })
          hasInvalidCompanyRfc = true
          break
        }

        requestedCompanyIds.add(company.id)
      }

      if (hasInvalidCompanyRfc) {
        continue
      }

      const normalizedCompanyIds = Array.from(requestedCompanyIds)

      if (isProvider && normalizedCompanyIds.length === 0) {
        results.push({
          email: user.correo,
          externalId: user.externalId,
          status: 'rejected',
          message: 'Debes asignar al menos una empresa al proveedor'
        })
        continue
      }

      const invalidCompanyId = normalizedCompanyIds.find(companyId => !companies.some(company => company.id === companyId))

      if (invalidCompanyId) {
        results.push({
          email: user.correo,
          externalId: user.externalId,
          status: 'rejected',
          message: `La empresa ${invalidCompanyId} no pertenece a la organización`
        })
        continue
      }

      const existingUser = await prisma.user.findUnique({
        where: { email: user.correo }
      })

      if (existingUser) {
        const existingMembership = await prisma.member.findFirst({
          where: {
            userId: existingUser.id,
            organizationId
          }
        })

        if (existingMembership) {
          results.push({
            email: user.correo,
            externalId: user.externalId,
            status: 'rejected',
            message: 'El usuario ya pertenece a la organización'
          })
          continue
        }
      }

      const invitation = await inviteUserToOrganization({
        organizationId,
        invitedByUserId: organization.ownerId,
        email: user.correo,
        name: user.nombre_usuario,
        roleId: customRole?.id || systemRole,
        companyIds: normalizedCompanyIds,
        providerRfc: user.rfc_proveedor,
        providerName: user.nombre_proveedor
      })

      await createAuditEntry({
        tableName: 'members',
        recordId: invitation.memberId,
        action: 'CREATE',
        userId: `m2m:${sourceClientId}`,
        userEmail: `m2m:${sourceClientId}`,
        ipAddress: sourceIp,
        userAgent: sourceUserAgent,
        description: `Alta externa de usuario ${user.correo} vía cliente ${sourceClientId}`,
        newValues: {
          correo: user.correo,
          nombre_usuario: user.nombre_usuario,
          rol_empresa: user.rol_empresa,
          empresas: user.empresas,
          externalId: user.externalId,
          providerDataIncluded: !!(user.rfc_proveedor || user.nombre_proveedor)
        }
      })

      results.push({
        email: user.correo,
        externalId: user.externalId,
        status: 'created',
        message: 'Usuario invitado exitosamente'
      })
    } catch (error) {
      console.error(`Error provisionando usuario externo ${user.correo}:`, error)

      await createAuditEntry({
        tableName: 'members',
        recordId: user.externalId || user.correo,
        action: 'CREATE',
        userId: `m2m:${sourceClientId}`,
        userEmail: `m2m:${sourceClientId}`,
        ipAddress: sourceIp,
        userAgent: sourceUserAgent,
        description: `Intento fallido de alta externa para ${user.correo}`,
        newValues: {
          correo: user.correo,
          nombre_usuario: user.nombre_usuario,
          rol_empresa: user.rol_empresa,
          empresas: user.empresas,
          externalId: user.externalId,
          error: error instanceof Error ? error.message : 'Error interno'
        }
      }).catch(auditError => {
        console.error('Error registrando auditoría de fallo M2M:', auditError)
      })

      results.push({
        email: user.correo,
        externalId: user.externalId,
        status: 'rejected',
        message: 'Error interno al provisionar el usuario'
      })
    }
  }

  return {
    results,
    summary: {
      total: users.length,
      created: results.filter(result => result.status === 'created').length,
      rejected: results.filter(result => result.status === 'rejected').length
    }
  }
}
