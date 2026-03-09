import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'

const uploadsDir = path.join(process.cwd(), 'public', 'uploads', 'avatars')

async function ensureUploadsDir() {
  try {
    await mkdir(uploadsDir, { recursive: true })
  } catch (error) {
    console.error('Error creating uploads directory:', error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const form = await request.formData()
    const file = form.get('avatar') as File
    if (!file) return NextResponse.json({ error: 'Archivo requerido' }, { status: 400 })

    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ error: 'Tipo de archivo no permitido' }, { status: 400 })
    }
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'Archivo demasiado grande (máx 5MB)' }, { status: 400 })
    }

    await ensureUploadsDir()

    const ext = path.extname(file.name)
    const name = `${session.user.id}${ext}`
    const filePath = path.join(uploadsDir, name)
    const buffer = Buffer.from(await file.arrayBuffer())
    await writeFile(filePath, buffer)

    const avatarUrl = `/uploads/avatars/${name}`
    await prisma.user.update({ where: { id: session.user.id }, data: { image: avatarUrl } })

    return NextResponse.json({ success: true, avatarUrl })
  } catch (error) {
    console.error('Error uploading avatar:', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}

export async function DELETE() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }
    await prisma.user.update({ where: { id: session.user.id }, data: { image: null } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting avatar:', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}

