import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowUpIcon, ArrowDownIcon, MinusIcon } from "lucide-react"
import { cn } from "@/lib/utils"

interface KPICardProps {
  title: string
  value: string
  change: number
  trend: 'up' | 'down' | 'neutral'
}

export function KPICard({ title, value, change, trend }: KPICardProps) {
  const trendConfig = {
    up: {
      icon: ArrowUpIcon,
      color: "text-green-600",
      bgColor: "bg-green-50"
    },
    down: {
      icon: ArrowDownIcon,
      color: "text-red-600",
      bgColor: "bg-red-50"
    },
    neutral: {
      icon: MinusIcon,
      color: "text-gray-600",
      bgColor: "bg-gray-50"
    }
  }

  const config = trendConfig[trend]
  const Icon = config.icon

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground font-heading">
          {title}
        </CardTitle>
        <div className={cn("rounded-full p-2.5", config.bgColor)}>
          <Icon className={cn("h-4 w-4", config.color)} />
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold font-heading text-foreground">{value}</div>
        <p className={cn("text-xs font-medium mt-1", config.color)}>
          {change > 0 ? '+' : ''}{change !== 0 ? `${change.toFixed(1)}%` : 'Sin cambios'} <span className="text-muted-foreground font-normal">vs mes anterior</span>
        </p>
      </CardContent>
    </Card>
  )
}