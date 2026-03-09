import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), 'public', 'uploads', 'logos')

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

    // Find the user's organization
    const member = await prisma.member.findFirst({
      where: { 
        userId: session.user.id,
        status: 'APPROVED'
      },
      include: {
        organization: true
      }
    })

    if (!member?.organization) {
      return NextResponse.json({ error: 'No se encontró el tenant' }, { status: 404 })
    }

    // Check permissions - only owner and admin can modify logo
    const isOwner = member.organization.ownerId === session.user.id
    const isAdmin = member.role === 'ADMIN'
    
    if (!isOwner && !isAdmin) {
      return NextResponse.json(
        { error: 'No tienes permisos para modificar esta información' },
        { status: 403 }
      )
    }

    const data = await request.formData()
    const file = data.get('logo') as File

    if (!file) {
      return NextResponse.json({ error: 'No se proporcionó ningún archivo' }, { status: 400 })
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: 'Tipo de archivo no permitido. Use JPEG, PNG, GIF o WebP' },
        { status: 400 }
      )
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024 // 5MB
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: 'El archivo es demasiado grande. Máximo 5MB' },
        { status: 400 }
      )
    }

    // Ensure uploads directory exists
    await ensureUploadsDir()

    // Generate unique filename
    const fileExtension = path.extname(file.name)
    const fileName = `${uuidv4()}${fileExtension}`
    const filePath = path.join(uploadsDir, fileName)

    // Convert file to buffer and save
    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    await writeFile(filePath, buffer)

    // Update organization with logo path
    const logoUrl = `/uploads/logos/${fileName}`
    const updatedOrganization = await prisma.organization.update({
      where: { id: member.organization.id },
      data: { logo: logoUrl }
    })

    return NextResponse.json({
      success: true,
      logoUrl: logoUrl,
      organization: updatedOrganization,
      message: 'Logo subido exitosamente'
    })

  } catch (error) {
    console.error('Error uploading logo:', error)
    return NextResponse.json(
      { error: 'Error al subir el logo' },
      { status: 500 }
    )
  }
}

// DELETE /api/tenant/logo - Remove tenant logo
export async function DELETE() {
  try {
    const session = await auth()
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    // Find the user's organization
    const member = await prisma.member.findFirst({
      where: { 
        userId: session.user.id,
        status: 'APPROVED'
      },
      include: {
        organization: true
      }
    })

    if (!member?.organization) {
      return NextResponse.json({ error: 'No se encontró el tenant' }, { status: 404 })
    }

    // Check permissions - only owner and admin can modify logo
    const isOwner = member.organization.ownerId === session.user.id
    const isAdmin = member.role === 'ADMIN'
    
    if (!isOwner && !isAdmin) {
      return NextResponse.json(
        { error: 'No tienes permisos para modificar esta información' },
        { status: 403 }
      )
    }

    // Remove logo from database
    const updatedOrganization = await prisma.organization.update({
      where: { id: member.organization.id },
      data: { logo: null }
    })

    // Note: In a production environment, you might want to also delete the actual file
    // For now, we'll just remove the reference from the database

    return NextResponse.json({
      success: true,
      organization: updatedOrganization,
      message: 'Logo eliminado exitosamente'
    })

  } catch (error) {
    console.error('Error removing logo:', error)
    return NextResponse.json(
      { error: 'Error al eliminar el logo' },
      { status: 500 }
    )
  }
}