import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import crypto from 'crypto'
import { sendInvitationEmail } from '@/lib/mail'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as readline from 'readline'

export async function POST(request: NextRequest) {
  let filePath = ''
  try {
    const session = await auth()
    
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    // Get user's organization
    const membership = await prisma.member.findFirst({
      where: {
        userId: session.user.id,
        status: { equals: 'APPROVED' }
      },
      include: {
        organization: true
      }
    })

    if (!membership) {
      return NextResponse.json({ error: 'No perteneces a ninguna organización' }, { status: 404 })
    }

    // Only organization owner can invite users
    if (membership.organization.ownerId !== session.user.id) {
      return NextResponse.json({ error: 'No tienes permisos para invitar usuarios' }, { status: 403 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null

    // ==========================================
    // CAPA 1: Validación Estricta en la Recepción
    // ==========================================
    if (!file) {
      return NextResponse.json({ error: 'No se recibió ningún archivo' }, { status: 400 })
    }

    // 1. Control de Tamaño: Máximo 5MB para mitigar DoS
    const MAX_SIZE = 5 * 1024 * 1024
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'El archivo excede el límite permitido de 5MB' }, { status: 400 })
    }

    // 2. Filtro de Extensión y Tipo MIME
    if (!file.name.toLowerCase().endsWith('.txt') || file.type !== 'text/plain') {
      return NextResponse.json({ error: 'Tipo de archivo no permitido. Solo se admite texto plano (.txt)' }, { status: 400 })
    }

    // 3. Verificación de Magic Numbers / Contenido Real
    // Los archivos de texto no deben contener bytes nulos (0x00). Si los tiene, es probable que sea un binario disfrazado.
    const buffer = Buffer.from(await file.arrayBuffer())
    for (let i = 0; i < Math.min(buffer.length, 1024); i++) {
      if (buffer[i] === 0) {
        return NextResponse.json({ error: 'Contenido inválido. El archivo parece ser un binario disfrazado.' }, { status: 400 })
      }
    }

    // ==========================================
    // CAPA 2: Almacenamiento Aislado y Seguro
    // ==========================================
    // 1. Renombrado Seguro con UUID para evitar Path Traversal y sobreescrituras
    const safeFilename = crypto.randomUUID() + '.txt'
    
    // 2. Ubicación aislada fuera del Web Root (/tmp)
    filePath = path.join(os.tmpdir(), safeFilename)

    // NOTA DE SEGURIDAD (PERMISOS):
    // En producción, el directorio temporal y este archivo deben configurarse con permisos 
    // restrictivos (ej. chmod 600 o 644) para evitar lectura/escritura/ejecución no autorizada.
    fs.writeFileSync(filePath, buffer)

    // Load available roles
    const customRoles = await prisma.customRole.findMany({
      where: { organizationId: membership.organizationId }
    })

    // Load available companies via organization's members
    const orgMembers = await prisma.member.findMany({
      where: { organizationId: membership.organizationId },
      select: { userId: true }
    })
    const userIds = orgMembers.map(m => m.userId)
    const companies = await prisma.company.findMany({
      where: { createdBy: { in: userIds } }
    })

    const errors: Array<{ rowNumber: number; message: string }> = []
    const validUsersToInvite: Array<{
      email: string
      name: string
      systemRole: 'ADMIN' | 'AUDITOR' | 'VIEWER'
      customRoleId: string | null
      isProvider: boolean
      companyIds: string[]
      providerRfc: string | null
      providerName: string | null
      existingUser: { id: string, name: string | null } | null
    }> = []

    // ==========================================
    // CAPA 3: Procesamiento y Sanitización de Datos
    // ==========================================
    // 1. Lectura Segura mediante Stream para no cargar todo a la RAM
    const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' })
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity })

    // 2. Prevención de CSV Injection (Sanitización)
    const sanitizeCSV = (str: string) => {
      let sanitized = str.trim()
      if (/^[=\+\-@\t\r]/.test(sanitized)) {
        sanitized = "'" + sanitized // Escapamos el inicio para neutralizar fórmulas
      }
      return sanitized
    }

    let rowNumber = 0
    for await (const line of rl) {
      rowNumber++
      const trimmedLine = line.trim()
      if (!trimmedLine) continue
      
      // Omitir cabecera
      if (rowNumber === 1 && !trimmedLine.includes('@')) continue

      const cols = trimmedLine.split('|').map(c => sanitizeCSV(c))

      if (cols.length < 3) {
        errors.push({ rowNumber, message: 'La fila no tiene el formato mínimo requerido (Correo | Nombre | Rol)' })
        continue
      }

      const email = cols[0]
      const name = cols[1]
      const roleName = cols[2]
      const companyRfcs = cols[3] ? cols[3].split(',').map(r => sanitizeCSV(r)).filter(r => r.length > 0) : []
      const providerRfc = cols[4] || ''
      const providerName = cols[5] || ''

      // 3. Validación de Negocio: Email
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(email)) {
        errors.push({ rowNumber, message: 'Formato de correo electrónico inválido' })
        continue
      }

      // Validación de Nombre
      if (name.length < 2) {
        errors.push({ rowNumber, message: 'El nombre debe tener al menos 2 caracteres' })
        continue
      }

      // Validación de Rol
      let systemRole: 'ADMIN' | 'AUDITOR' | 'VIEWER' = 'VIEWER'
      let customRoleId: string | null = null
      let isProvider = false

      const roleNameLower = roleName.toLowerCase()
      if (roleNameLower === 'administrador') systemRole = 'ADMIN'
      else if (roleNameLower === 'auditor') systemRole = 'AUDITOR'
      else if (roleNameLower === 'visualizador') systemRole = 'VIEWER'
      else {
        const foundCustomRole = customRoles.find(r => r.name.toLowerCase() === roleNameLower)
        if (foundCustomRole) {
          customRoleId = foundCustomRole.id
          if (foundCustomRole.name.toLowerCase().includes('proveedor')) isProvider = true
        } else {
          // Permitir roles de sistema (para compatibilidad con otros flujos si el usuario escribe el ID del rol o nombres en inglés)
          if (roleName === 'ADMIN') systemRole = 'ADMIN'
          else if (roleName === 'AUDITOR') systemRole = 'AUDITOR'
          else if (roleName === 'VIEWER') systemRole = 'VIEWER'
          else {
            errors.push({ rowNumber, message: `El rol "${roleName}" no existe en la organización` })
            continue
          }
        }
      }

      // Provider Validations
      if (isProvider) {
        if (!providerRfc) {
          errors.push({ rowNumber, message: 'El RFC es obligatorio para el rol Proveedor' })
          continue
        }
        const rfcRegex = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i
        if (!rfcRegex.test(providerRfc)) {
          errors.push({ rowNumber, message: 'El RFC del proveedor no tiene un formato válido' })
          continue
        }
        if (!providerName) {
          errors.push({ rowNumber, message: 'El nombre es obligatorio para el rol Proveedor' })
          continue
        }
        if (companyRfcs.length === 0) {
          errors.push({ rowNumber, message: 'Debes asignar al menos una empresa (RFC) al proveedor' })
          continue
        }
      }

      // Companies Validation
      const companyIds: string[] = []
      let missingCompanies = false
      for (const rfc of companyRfcs) {
        const found = companies.find(c => c.rfc.toUpperCase() === rfc.toUpperCase())
        if (found) {
          companyIds.push(found.id)
        } else {
          errors.push({ rowNumber, message: `La empresa con RFC "${rfc}" no existe o no tienes acceso` })
          missingCompanies = true
        }
      }
      if (missingCompanies) continue

      // User existence
      const existingUser = await prisma.user.findUnique({ where: { email } })
      if (existingUser) {
        const existingMembership = await prisma.member.findFirst({
          where: { userId: existingUser.id, organizationId: membership.organizationId }
        })
        if (existingMembership) {
          errors.push({ rowNumber, message: `El usuario con correo ${email} ya es miembro de esta organización` })
          continue
        }
      }

      validUsersToInvite.push({
        email, name, systemRole, customRoleId, isProvider, companyIds,
        providerRfc: isProvider ? providerRfc.toUpperCase() : null,
        providerName: isProvider ? providerName : null,
        existingUser
      })
    }

    if (errors.length > 0) {
      return NextResponse.json({ success: false, message: 'Se encontraron errores en el archivo', errors }, { status: 400 })
    }

    // 4. Inserción Segura en Base de Datos
    // NOTA: Prisma ORM utiliza por debajo Prepared Statements (Consultas Preparadas)
    // lo que neutraliza por completo cualquier intento de SQL Injection. No concatenamos variables.
    let invitedCount = 0

    // Process valid users
    for (const invite of validUsersToInvite) {
      const plainToken = crypto.randomBytes(32).toString('hex')
      const tokenHash = crypto.createHash('sha256').update(plainToken).digest('hex')
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000) // 30 mins

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
                invitedBy: session.user.id,
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

      // Send email (we don't await so it doesn't block the loop too much, or we can await to ensure delivery)
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

    return NextResponse.json({
          success: true,
          message: `Se han invitado exitosamente a ${invitedCount} usuarios`,
          invitedCount
        })

      } catch (error) {
        // ==========================================
        // CAPA 4: Manejo de Errores Seguro y Logs
        // ==========================================
        // Registramos el detalle exacto internamente para auditoría.
        console.error(`[SECURITY LOG - ${new Date().toISOString()}] Bulk Upload Error:`, error)
        
        // Devolvemos un error genérico para no exponer rutas ni detalles de la infraestructura.
        return NextResponse.json(
          { error: 'Error interno al procesar el archivo. Contacte al administrador.' },
          { status: 500 }
        )
      } finally {
        // ==========================================
        // CAPA 4: Limpieza
        // ==========================================
        // Destrucción inmediata del archivo temporal sin importar el resultado.
        if (filePath && fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath)
          } catch (e) {
            console.error(`[SECURITY LOG] No se pudo eliminar el archivo temporal: ${filePath}`, e)
          }
        }
      }
    }
