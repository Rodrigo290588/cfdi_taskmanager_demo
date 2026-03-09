import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { InvoiceSummary } from "@/lib/mock-data"
import { formatCurrency } from "@/lib/mock-data"

interface InvoiceSummaryProps {
  summary: InvoiceSummary[]
}

export function InvoiceSummaryCard({ summary }: InvoiceSummaryProps) {
  const getBadgeVariant = (tipo: string) => {
    switch (tipo) {
      case 'Ingreso':
        return 'default'
      case 'Egreso':
        return 'destructive'
      case 'Nómina':
        return 'secondary'
      case 'Pago':
        return 'outline'
      default:
        return 'default'
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading font-semibold text-foreground">Resumen de CFDIs</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {summary.map((item, index) => (
            <div key={index} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant={getBadgeVariant(item.tipo) as 'default' | 'destructive' | 'secondary' | 'outline' | null | undefined}>
                  {item.tipo}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {item.count} facturas
                </span>
              </div>
              <div className="text-right">
                <div className="font-semibold">
                  {formatCurrency(item.total)}
                </div>
                <div className="text-sm text-muted-foreground">
                  {item.percentage.toFixed(1)}%
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}