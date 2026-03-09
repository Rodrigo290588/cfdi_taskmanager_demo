import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line } from "recharts"
import { ChartData } from "@/lib/mock-data"

interface FinancialChartsProps {
  chartData: ChartData[]
}

export function FinancialCharts({ chartData }: FinancialChartsProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="font-heading font-semibold text-foreground">Ingresos vs Gastos</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip 
                formatter={(value: number) => [
                  new Intl.NumberFormat('es-MX', {
                    style: 'currency',
                    currency: 'MXN'
                  }).format(value),
                  ''
                ]}
              />
              <Legend />
              <Bar dataKey="ingresos" fill="oklch(0.48 0.18 265)" name="Ingresos" />
              <Bar dataKey="gastos" fill="#ef4444" name="Gastos" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-heading font-semibold text-foreground">Desglose de Impuestos</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip 
                formatter={(value: number) => [
                  new Intl.NumberFormat('es-MX', {
                    style: 'currency',
                    currency: 'MXN'
                  }).format(value),
                  ''
                ]}
              />
              <Legend />
              <Line 
                type="monotone" 
                dataKey="ivaTrasladado" 
                stroke="oklch(0.48 0.18 265)" 
                strokeWidth={2}
                name="IVA Trasladado"
              />
              <Line 
                type="monotone" 
                dataKey="ivaAcreditable" 
                stroke="#f59e0b" 
                strokeWidth={2}
                name="IVA Acreditable"
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  )
}