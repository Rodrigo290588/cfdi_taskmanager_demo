import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { hasPermission, Permission } from '@/lib/permissions'
import { prisma } from '@/lib/prisma'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
 

const uploadsDir = path.join(process.cwd(), 'public', 'uploads', 'company-logos')

async function ensureUploadsDir() {
  try {
    await mkdir(uploadsDir, { recursive: true })
  } catch (error) {
    console.error('Error creating uploads directory:', error)
  }
}

 

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: 'ID de empresa requerido' }, { status: 400 })
    }

    const user = await prisma.user.findUnique({ where: { id: session.user.id } })
    if (!user) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
    if (!hasPermission({ id: user.id, systemRole: user.systemRole }, Permission.COMPANY_UPDATE)) {
      return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
    }

    const company = await prisma.company.findUnique({ where: { id } })
    if (!company) {
      return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 })
    }

    const form = await request.formData()
    const file = form.get('logo') as File
    if (!file) {
      return NextResponse.json({ error: 'Archivo requerido' }, { status: 400 })
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ error: 'Tipo de archivo no permitido' }, { status: 400 })
    }
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'Archivo demasiado grande (máx 5MB)' }, { status: 400 })
    }

    await ensureUploadsDir()

    const ext = path.extname(file.name)
    const name = `${id}-${uuidv4()}${ext}`
    const filePath = path.join(uploadsDir, name)
    const buffer = Buffer.from(await file.arrayBuffer())
    await writeFile(filePath, buffer)

    const logoUrl = `/uploads/company-logos/${name}`

    return NextResponse.json({ success: true, logoUrl })
  } catch (error) {
    console.error('Error uploading company logo:', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
