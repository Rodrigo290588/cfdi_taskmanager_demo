import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'

const preferencesSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).optional(),
  locale: z.string().optional(),
  timezone: z.string().optional(),
  notifications: z.object({
    emailEnabled: z.boolean().optional(),
    productUpdates: z.boolean().optional(),
    tipsEnabled: z.boolean().optional()
  }).optional(),
  tables: z.object({
    workpaperEmitidos: z.object({
      visibleColumns: z.array(z.string()).optional(),
      columnOrder: z.array(z.string()).optional()
    }).optional()
  }).optional()
}).strict().optional()

const profileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  preferences: preferencesSchema
}).strict()

export async function GET() {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({ where: { id: session.user.id } })
    if (!user) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })

    const onboarding = (user.onboardingData as unknown as { preferences?: unknown }) || {}
    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        preferences: onboarding.preferences || {}
      }
    })
  } catch (error) {
    console.error('Get profile error:', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const body = await request.json()
    const validated = profileSchema.parse(body)

    const user = await prisma.user.findUnique({ where: { id: session.user.id } })
    if (!user) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })

    const currentOnboarding = (user.onboardingData as unknown as Record<string, unknown>) || {}
    const currentPreferences = (currentOnboarding.preferences as Record<string, unknown> | undefined) || {}
    const nextPreferences = validated.preferences
      ? { ...currentPreferences, ...validated.preferences }
      : currentPreferences
    const updatedOnboarding: Prisma.JsonObject = { ...currentOnboarding, preferences: nextPreferences as Prisma.JsonValue }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        name: validated.name ?? user.name ?? undefined,
        onboardingData: updatedOnboarding
      }
    })

    const onboarding = (updated.onboardingData as unknown as { preferences?: unknown }) || {}
    return NextResponse.json({
      success: true,
      user: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        image: updated.image,
        preferences: onboarding.preferences || {}
      }
    })
  } catch (error) {
    console.error('Update profile error:', error)
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Datos inválidos', details: error.issues }, { status: 400 })
    }
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
