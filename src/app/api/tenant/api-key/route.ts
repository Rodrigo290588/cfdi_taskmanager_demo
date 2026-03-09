import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import crypto from 'crypto'

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const member = await prisma.member.findFirst({
      where: { userId: session.user.id, status: 'APPROVED' },
      include: { organization: true }
    })
    if (!member?.organization) {
      return NextResponse.json({ error: 'No se encontró la organización' }, { status: 404 })
    }

    const keyName = `Web Service Key (${member.organization.slug})`
    let apiKey = await prisma.apiKey.findFirst({
      where: { userId: session.user.id, name: keyName }
    })

    if (!apiKey) {
      const random = crypto.randomBytes(16).toString('hex')
      const keyString = `sk_live_${member.organization.id}_${random}`
      apiKey = await prisma.apiKey.create({
        data: {
          userId: session.user.id,
          name: keyName,
          key: keyString,
          permissions: ['read', 'write'],
          isActive: true
        }
      })
    }

    return NextResponse.json({
      key: apiKey.key,
      createdAt: apiKey.createdAt,
      lastUsedAt: apiKey.lastUsedAt
    })
  } catch (error) {
    console.error('Error obteniendo API Key:', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}

export async function POST() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const member = await prisma.member.findFirst({
      where: { userId: session.user.id, status: 'APPROVED' },
      include: { organization: true }
    })
    if (!member?.organization) {
      return NextResponse.json({ error: 'No se encontró la organización' }, { status: 404 })
    }

    const keyName = `Web Service Key (${member.organization.slug})`
    const random = crypto.randomBytes(16).toString('hex')
    const keyString = `sk_live_${member.organization.id}_${random}`

    const existing = await prisma.apiKey.findFirst({
      where: { userId: session.user.id, name: keyName }
    })

    if (existing) {
      await prisma.apiKey.update({
        where: { id: existing.id },
        data: { key: keyString, lastUsedAt: null }
      })
    } else {
      await prisma.apiKey.create({
        data: {
          userId: session.user.id,
          name: keyName,
          key: keyString,
          permissions: ['read', 'write'],
          isActive: true
        }
      })
    }

    return NextResponse.json({ key: keyString })
  } catch (error) {
    console.error('Error rotando API Key:', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}

