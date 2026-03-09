import { NextRequest } from 'next/server'
import { prisma } from './prisma'
import crypto from 'crypto'

export async function validateApiKey(request: NextRequest) {
  const apiKey = request.headers.get('x-api-key')
  
  if (!apiKey) {
    return {
      valid: false,
      error: 'API key required',
      status: 401
    }
  }

  try {
    // Find the API key in the database
    const keyRecord = await prisma.apiKey.findUnique({
      where: { key: apiKey },
      include: { user: true }
    })

    if (!keyRecord) {
      return {
        valid: false,
        error: 'Invalid API key',
        status: 401
      }
    }

    // Check if the key is active
    if (!keyRecord.isActive) {
      return {
        valid: false,
        error: 'API key is inactive',
        status: 401
      }
    }

    // Check if the key has expired
    if (keyRecord.expiresAt && new Date() > keyRecord.expiresAt) {
      return {
        valid: false,
        error: 'API key has expired',
        status: 401
      }
    }

    // Update last used timestamp
    await prisma.apiKey.update({
      where: { id: keyRecord.id },
      data: { lastUsedAt: new Date() }
    })

    return {
      valid: true,
      user: keyRecord.user,
      permissions: keyRecord.permissions
    }
  } catch (error) {
    console.error('API key validation error:', error)
    return {
      valid: false,
      error: 'Internal server error',
      status: 500
    }
  }
}

export function generateApiKey(): string {
  return crypto.randomBytes(32).toString('hex')
}