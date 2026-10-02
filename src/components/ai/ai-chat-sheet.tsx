'use client'

import React from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface AiChatSheetProps {
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly children: React.ReactNode
}

export function AiChatSheet({ isOpen, onClose, children }: AiChatSheetProps) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full sm:w-[400px] flex-col bg-background shadow-2xl border-l sm:max-w-md transition-transform duration-300 transform translate-x-0">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h2 className="text-lg font-semibold">Asistente AI</h2>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-5 w-5" />
        </Button>
      </div>
      <div className="flex-1 overflow-hidden flex flex-col">
        {children}
      </div>
    </div>
  )
}
