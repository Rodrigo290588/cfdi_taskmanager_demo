'use client'

import React, { useState } from 'react'
import { usePathname } from 'next/navigation'
import { usePermissions } from '@/hooks/use-permissions'
import { Permission } from '@/lib/permissions'
import { Button } from '@/components/ui/button'
import { MessageCircle } from 'lucide-react'
import { AiChatSheet } from './ai-chat-sheet'
import { AiChatMessages } from './ai-chat-messages'
import { AiChatInput } from './ai-chat-input'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'

export function AiChatWrapper() {
  const pathname = usePathname()
  const { hasPermission } = usePermissions()
  const [isOpen, setIsOpen] = useState(false)
  
  const { messages, sendMessage } = useChat({
    transport: new DefaultChatTransport({ api: '/api/ai/chat' })
  })

  // Validar que estemos en una ruta de workpapers
  const isWorkpapersRoute = pathname?.includes('/workpaper')
  
  // Validar permisos del usuario
  const canAccessChat = hasPermission(Permission.AI_CHAT_ACCESS)

  // Si no está en la ruta permitida o no tiene permiso, no renderizar nada
  if (!isWorkpapersRoute || !canAccessChat) {
    return null
  }

  const handleSend = (content: string) => {
    sendMessage({
      text: content
    })
  }

  return (
    <>
      <div className="fixed bottom-6 right-6 z-40">
        <Button
          onClick={() => setIsOpen(true)}
          size="icon"
          className="h-14 w-14 rounded-full shadow-lg"
        >
          <MessageCircle className="h-6 w-6" />
        </Button>
      </div>

      <AiChatSheet isOpen={isOpen} onClose={() => setIsOpen(false)}>
        <AiChatMessages messages={messages} />
        <AiChatInput onSend={handleSend} />
      </AiChatSheet>
    </>
  )
}
