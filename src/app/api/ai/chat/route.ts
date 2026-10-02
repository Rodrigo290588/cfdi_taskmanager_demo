import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { hasPermission, Permission, enrichUserWithMemberships, getAccessibleCompanyIds } from '@/lib/permissions'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { streamText, createUIMessageStreamResponse, toUIMessageStream, convertToModelMessages, isStepCount } from 'ai'
import { createBillingSummaryTool } from '@/lib/ai/tools/billing-summary'
import { SystemRole } from '@prisma/client'

export async function POST(req: Request) {
  console.log('=== LLEGÓ PETICIÓN AL API CHAT ===')
  try {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const systemRole = (session.user as { systemRole?: SystemRole }).systemRole as SystemRole

    const enrichedUser = await enrichUserWithMemberships({
      id: session.user.id,
      systemRole: systemRole
    })
    
    // Validar permiso de chat de IA
    const canUseAiChat = hasPermission(enrichedUser, Permission.AI_CHAT_ACCESS)
    
    if (!canUseAiChat) {
      return NextResponse.json(
        { error: 'No tienes permiso para usar el chat con IA' },
        { status: 403 }
      )
    }

    // Obtener las compañías permitidas para este usuario
    // Si es SUPER_ADMIN, getAccessibleCompanyIds retorna null (acceso a todas)
    const allowedCompanyIds = await getAccessibleCompanyIds(enrichedUser.id, enrichedUser.systemRole)

    const { messages } = await req.json()
    console.log('=== MESSAGES RECEIVED ===', JSON.stringify(messages, null, 2))

    const customGoogle = createGoogleGenerativeAI({
      apiKey: process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    })

    const coreMessages = await convertToModelMessages(messages)

    const result = streamText({
      model: customGoogle('gemini-3.7-flash'),
      messages: coreMessages,
      stopWhen: isStepCount(5),
      system: 'Eres un asistente financiero de IA. Usa las herramientas proporcionadas para ayudar al usuario con su información de facturación e impuestos.',
      tools: {
        billingSummary: createBillingSummaryTool(allowedCompanyIds)
      },
      onError: ({ error }) => {
        console.error('=== STREAM ERROR ===', error)
      }
    })

    console.log('=== GENERATING STREAM RESPONSE ===')
    return createUIMessageStreamResponse({
      stream: toUIMessageStream({ stream: result.stream })
    })
  } catch (error) {
    console.error('==== ERROR EN AI CHAT API ====')
    console.error(error)
    console.error('==============================')
    return NextResponse.json(
      { error: 'Error interno del servidor al procesar la solicitud de IA', details: String(error) },
      { status: 500 }
    )
  }
}
