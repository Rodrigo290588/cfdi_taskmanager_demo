import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import crypto from 'crypto'
import { sendInvitationEmail } from '@/lib/mail'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as readline from 'readline'

// 2. Prevención de CSV Injection (Sanitización)
const sanitizeCSV = (str: string) => {
  let sanitized = str.trim()
  if (/^[=\+\-@\t\r]/.test(sanitized)) {
    sanitized = "'" + sanitized // Escapamos el inicio para neutralizar fórmulas
  }
  return sanitized
}

// 3. Tipos y Extracciones auxiliares
interface ValidUserInvite {
  email: string
  name: string
  systemRole: 'ADMIN' | 'AUDITOR' | 'VIEWER'
  customRoleId: string | null
  isProvider: boolean
  companyIds: string[]
  providerRfc: string | null
  providerName: string | null
  existingUser: { id: string; name: string | null } | null
}

async function validateProviderInfo(
  isProvider: boolean,
  providerRfc: string,
  providerName: string,
  companyRfcs: string[]
): Promise<string | null> {
  if (!isProvider) return null
  if (!providerRfc) return 'El RFC es obligatorio para el rol Proveedor'
  const rfcRegex = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i
  if (!rfcRegex.test(providerRfc)) return 'El RFC del proveedor no tiene un formato válido'
  if (!providerName) return 'El nombre es obligatorio para el rol Proveedor'
  if (companyRfcs.length === 0) return 'Debes asignar al menos una empresa (RFC) al proveedor'
  return null
}

function resolveRole(
  roleName: string,
  customRoles: Array<{ id: string; name: string }>
) {
  let systemRole: 'ADMIN' | 'AUDITOR' | 'VIEWER' = 'VIEWER'
  let customRoleId: string | null = null
  let isProvider = false
  let errorMsg: string | null = null

  const roleNameLower = roleName.toLowerCase()
  if (roleNameLower === 'administrador' || roleName === 'ADMIN') {
    systemRole = 'ADMIN'
  } else if (roleNameLower === 'auditor' || roleName === 'AUDITOR') {
    systemRole = 'AUDITOR'
  } else if (roleNameLower === 'visualizador' || roleName === 'VIEWER') {
    systemRole = 'VIEWER'
  } else {
    const foundCustomRole = customRoles.find(r => r.name.toLowerCase() === roleNameLower)
    if (foundCustomRole) {
      customRoleId = foundCustomRole.id
      if (foundCustomRole.name.toLowerCase().includes('proveedor')) isProvider = true
    } else {
      errorMsg = `El rol "${roleName}" no existe en la organización`
    }
  }

  return { systemRole, customRoleId, isProvider, errorMsg }
}

async function validateUserExistence(email: string, membershipOrgId: string) {
  const existingUser = await prisma.user.findUnique({ where: { email } })
  if (existingUser) {
    const existingMembership = await prisma.member.findFirst({
      where: { userId: existingUser.id, organizationId: membershipOrgId }
    })
    if (existingMembership) {
      return { errorMsg: `El usuario con correo ${email} ya es miembro de esta organización`, existingUser: null }
    }
  }
  return { errorMsg: null, existingUser }
}

function resolveCompanyIds(
  companyRfcs: string[],
  companies: Array<{ id: string; rfc: string }>
): { companyIds: string[]; errorMsg: string | null } {
  const companyIds: string[] = []
  for (const rfc of companyRfcs) {
    const found = companies.find(c => c.rfc.toUpperCase() === rfc.toUpperCase())
    if (found) companyIds.push(found.id)
    else return { companyIds: [], errorMsg: `La empresa con RFC "${rfc}" no existe o no tienes acceso` }
  }
  return { companyIds, errorMsg: null }
}

async function parseLineColumns(
  cols: string[],
  rowNumber: number,
  customRoles: Array<{ id: string; name: string }>,
  companies: Array<{ id: string; rfc: string }>,
  membershipOrgId: string
): Promise<{ error?: { rowNumber: number; message: string }; invite?: ValidUserInvite }> {
  const email = cols[0]
  const name = cols[1]
  const roleName = cols[2]
  const companyRfcs = cols[3] ? cols[3].split(',').map(r => sanitizeCSV(r)).filter(r => r.length > 0) : []
  const providerRfc = cols[4] || ''
  const providerName = cols[5] || ''

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: { rowNumber, message: 'Formato de correo electrónico inválido' } }
  }

  if (name.length < 2) {
    return { error: { rowNumber, message: 'El nombre debe tener al menos 2 caracteres' } }
  }

  const { systemRole, customRoleId, isProvider, errorMsg } = resolveRole(roleName, customRoles)
  if (errorMsg) return { error: { rowNumber, message: errorMsg } }

  const providerError = await validateProviderInfo(isProvider, providerRfc, providerName, companyRfcs)
  if (providerError) return { error: { rowNumber, message: providerError } }

  const { companyIds, errorMsg: companyError } = resolveCompanyIds(companyRfcs, companies)
  if (companyError) return { error: { rowNumber, message: companyError } }

  const { errorMsg: userError, existingUser } = await validateUserExistence(email, membershipOrgId)
  if (userError) return { error: { rowNumber, message: userError } }

  return {
    invite: {
      email, name, systemRole, customRoleId, isProvider, companyIds,
      providerRfc: isProvider ? providerRfc.toUpperCase() : null,
      providerName: isProvider ? providerName : null,
      existingUser
    }
  }
}

async function processLine(
  line: string,
  rowNumber: number,
  customRoles: Array<{ id: string; name: string }>,
  companies: Array<{ id: string; rfc: string }>,
  membershipOrgId: string
): Promise<{ error?: { rowNumber: number; message: string }; invite?: ValidUserInvite }> {
  const trimmedLine = line.trim()
  if (!trimmedLine) return {}
  
  if (rowNumber === 1 && !trimmedLine.includes('@')) return {}

  const cols = trimmedLine.split('|').map(c => sanitizeCSV(c))
  if (cols.length < 3) {
    return { error: { rowNumber, message: 'La fila no tiene el formato mínimo requerido (Correo | Nombre | Rol)' } }
  }

  return parseLineColumns(cols, rowNumber, customRoles, companies, membershipOrgId)
}

async function validateAndSaveFile(request: NextRequest): Promise<{ errorResponse?: NextResponse, filePath?: string, fileBuffer?: Buffer }> {
  const formData = await request.formData()
  const file = formData.get('file') as File | null

  if (!file) {
    return { errorResponse: NextResponse.json({ error: 'No se recibió ningún archivo' }, { status: 400 }) }
  }

  const MAX_SIZE = 5 * 1024 * 1024
  if (file.size > MAX_SIZE) {
    return { errorResponse: NextResponse.json({ error: 'El archivo excede el límite permitido de 5MB' }, { status: 400 }) }
  }

  if (!file.name.toLowerCase().endsWith('.txt') || file.type !== 'text/plain') {
    return { errorResponse: NextResponse.json({ error: 'Tipo de archivo no permitido. Solo se admite texto plano (.txt)' }, { status: 400 }) }
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  for (let i = 0; i < Math.min(buffer.length, 1024); i++) {
    if (buffer[i] === 0) {
      return { errorResponse: NextResponse.json({ error: 'Contenido inválido. El archivo parece ser un binario disfrazado.' }, { status: 400 }) }
    }
  }

  const safeFilename = crypto.randomUUID() + '.txt'
  const filePath = path.join(/*turbopackIgnore: true*/ os.tmpdir(), safeFilename)
  fs.writeFileSync(filePath, buffer)

  return { filePath, fileBuffer: buffer }
}

async function insertValidUsers(
  validUsersToInvite: Array<ValidUserInvite>,
  sessionUserId: string,
  membership: { organizationId: string; organization: { name: string } }
): Promise<number> {
  let invitedCount = 0
  for (const invite of validUsersToInvite) {
    const plainToken = crypto.randomBytes(32).toString('hex')
    const tokenHash = crypto.createHash('sha256').update(plainToken).digest('hex')
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000)

    await prisma.$transaction(async (tx) => {
      let userId = invite.existingUser?.id

      if (!userId) {
        const newUser = await tx.user.create({
          data: {
            email: invite.email,
            name: invite.name,
            systemRole: 'USER',
            onboardingStep: 'ORGANIZATION_INVITATION',
            onboardingData: {
              invitedBy: sessionUserId,
              invitedAt: new Date(),
              organizationId: membership.organizationId
            }
          }
        })
        userId = newUser.id
      }

      const newMember = await tx.member.create({
        data: {
          userId: userId,
          organizationId: membership.organizationId,
          role: invite.systemRole,
          customRoleId: invite.customRoleId,
          status: 'PENDING',
          invitationTokenHash: tokenHash,
          invitationExpiresAt: expiresAt,
          providerRfc: invite.providerRfc,
          providerName: invite.providerName,
        }
      })

      if (invite.companyIds && invite.companyIds.length > 0) {
        await tx.companyAccess.createMany({
          data: invite.companyIds.map((companyId: string) => ({
            companyId,
            memberId: newMember.id,
            organizationId: membership.organizationId,
            role: invite.systemRole,
            customRoleId: invite.customRoleId
          }))
        })
      }
    })

    await sendInvitationEmail({
      to: invite.email,
      name: invite.existingUser?.name || invite.name,
      invitationToken: plainToken,
      organizationName: membership.organization.name,
      organizationId: membership.organizationId,
      isProvider: invite.isProvider
    }).catch(err => console.error("Error sending bulk email", err))

    invitedCount++
  }
  return invitedCount
}

async function getContextData(organizationId: string) {
  const customRoles = await prisma.customRole.findMany({
    where: { organizationId }
  })

  const orgMembers = await prisma.member.findMany({
    where: { organizationId },
    select: { userId: true }
  })
  const userIds = orgMembers.map(m => m.userId)
  const companies = await prisma.company.findMany({
    where: { createdBy: { in: userIds } }
  })

  return { customRoles, companies }
}

async function processFileLines(
  filePath: string,
  customRoles: Array<{ id: string; name: string }>,
  companies: Array<{ id: string; rfc: string }>,
  organizationId: string
) {
  const errors: Array<{ rowNumber: number; message: string }> = []
  const validUsersToInvite: Array<ValidUserInvite> = []

  const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' })
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity })

  let rowNumber = 0
  for await (const line of rl) {
    rowNumber++
    const { error, invite } = await processLine(line, rowNumber, customRoles, companies, organizationId)
    if (error) errors.push(error)
    if (invite) validUsersToInvite.push(invite)
  }

  return { errors, validUsersToInvite }
}

export async function POST(request: NextRequest) {
  let filePath = ''
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const membership = await prisma.member.findFirst({
      where: { userId: session.user.id, status: { equals: 'APPROVED' } },
      include: { organization: true }
    })
    if (!membership) {
      return NextResponse.json({ error: 'No perteneces a ninguna organización' }, { status: 404 })
    }

    const isOwner = membership.organization.ownerId === session.user.id
    const isSuperAdmin = (session.user.systemRole as string) === 'SUPER_ADMIN'
    if (!isOwner && !isSuperAdmin) {
      return NextResponse.json({ error: 'No tienes permisos para invitar usuarios' }, { status: 403 })
    }

    const fileValidationResult = await validateAndSaveFile(request)
    if (fileValidationResult.errorResponse) return fileValidationResult.errorResponse
    filePath = fileValidationResult.filePath!

    const { customRoles, companies } = await getContextData(membership.organizationId)

    const { errors, validUsersToInvite } = await processFileLines(filePath, customRoles, companies, membership.organizationId)

    if (errors.length > 0) {
      return NextResponse.json({ success: false, message: 'Se encontraron errores en el archivo', errors }, { status: 400 })
    }

    const invitedCount = await insertValidUsers(validUsersToInvite, session.user.id, membership)

    return NextResponse.json({
      success: true,
      message: `Se han invitado exitosamente a ${invitedCount} usuarios`,
      invitedCount
    })

  } catch (error) {
    console.error(`[SECURITY LOG - ${new Date().toISOString()}] Bulk Upload Error:`, error)
    return NextResponse.json(
      { error: 'Error interno al procesar el archivo. Contacte al administrador.' },
      { status: 500 }
    )
  } finally {
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath)
      } catch (e) {
        console.error(`[SECURITY LOG] No se pudo eliminar el archivo temporal: ${filePath}`, e)
      }
    }
  }
}
