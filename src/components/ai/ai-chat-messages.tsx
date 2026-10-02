'use client'

import React from 'react'
import type { UIMessage } from 'ai'

interface AiChatMessagesProps {
  readonly messages: UIMessage[]
}

export function AiChatMessages({ messages }: AiChatMessagesProps) {
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {messages.length === 0 ? (
        <div className="text-center text-muted-foreground mt-10">
          <p>¡Hola! ¿En qué puedo ayudarte hoy?</p>
        </div>
      ) : (
        messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${
              message.role === 'user' ? 'justify-end' : 'justify-start'
            }`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2 text-sm ${
                message.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-foreground'
              }`}
            >
              {React.Children.toArray(
                message.parts?.map((part, index) => {
                  const partKey = `${message.id}-part-${index}`
                  if (part.type === 'text') return <span key={partKey}>{part.text}</span>
                  if (part.type.startsWith('tool-')) {
                    const toolName = part.type.replace('tool-', '')
                    // En el nuevo SDK, el estado y los datos de la herramienta están directamente en el `part`
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const state = (part as any).state
                    return (
                      <div key={partKey} className="mt-2 text-xs italic opacity-70">
                        {state === 'result' || state === 'error'
                          ? `Herramienta ${toolName} finalizada.`
                          : `Ejecutando herramienta: ${toolName}...`}
                      </div>
                    )
                  }
                  return null
                })
              )}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
