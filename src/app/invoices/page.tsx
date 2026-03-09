'use client'

import { useEffect, useState } from 'react'
import { DataGrid } from "@/components/invoices/data-grid"
import { DataGridSkeleton } from "@/components/loading/skeletons"
import { mockInvoices } from "@/lib/mock-invoices"
import { showSuccess } from "@/lib/toast"
import { ProtectedRoute } from "@/components/protected-route"

export default function InvoicesPage() {
  const [loading, setLoading] = useState(true)
  const [invoices, setInvoices] = useState(mockInvoices)

  useEffect(() => {
    // Simulate data loading
    const timer = setTimeout(() => {
      setLoading(false)
      setInvoices(mockInvoices)
      showSuccess("Bóveda fiscal cargada", `${mockInvoices.length} facturas disponibles`)
    }, 1500)

    return () => clearTimeout(timer)
  }, [])

  if (loading) {
    return <DataGridSkeleton />
  }

  return (
    <ProtectedRoute>
      <div className="flex-1 space-y-4 p-4 md:p-6 pt-6">
        <div className="flex items-center justify-between space-y-2">
          <h2 className="text-3xl font-bold tracking-tight">Bóveda Fiscal</h2>
          <div className="flex items-center space-x-2">
            <span className="text-sm text-muted-foreground">
              RFC: BIMO840515XXX - Grupo Bimbo S.A.B. de C.V.
            </span>
          </div>
        </div>

        <DataGrid invoices={invoices} />
      </div>
    </ProtectedRoute>
  )
}