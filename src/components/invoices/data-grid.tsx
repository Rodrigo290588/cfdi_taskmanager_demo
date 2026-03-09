import { useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table"
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem
} from "@/components/ui/dropdown-menu"
import { MockInvoice } from "@/lib/mock-invoices"
import { 
  getStatusBadgeColor, 
  getSatStatusBadgeColor, 
  getCfdiTypeBadgeColor 
} from "@/lib/mock-invoices"
import { Search, Filter, Download, Eye, ChevronLeft, ChevronRight } from "lucide-react"
import { showSuccess, showInfo } from "@/lib/toast"

interface DataGridProps {
  invoices: MockInvoice[]
}

export function DataGrid({ invoices }: DataGridProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [selectedTypes, setSelectedTypes] = useState<string[]>([])
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([])
  const itemsPerPage = 10

  const filteredInvoices = useMemo(() => {
    return invoices.filter(invoice => {
      const matchesSearch = 
        invoice.uuid.toLowerCase().includes(searchTerm.toLowerCase()) ||
        invoice.issuerRfc.toLowerCase().includes(searchTerm.toLowerCase()) ||
        invoice.issuerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        invoice.receiverRfc.toLowerCase().includes(searchTerm.toLowerCase()) ||
        invoice.receiverName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        invoice.folio.toLowerCase().includes(searchTerm.toLowerCase())

      const matchesType = selectedTypes.length === 0 || selectedTypes.includes(invoice.cfdiType)
      const matchesStatus = selectedStatuses.length === 0 || selectedStatuses.includes(invoice.status)

      return matchesSearch && matchesType && matchesStatus
    })
  }, [invoices, searchTerm, selectedTypes, selectedStatuses])

  const paginatedInvoices = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage
    return filteredInvoices.slice(startIndex, startIndex + itemsPerPage)
  }, [filteredInvoices, currentPage])

  const totalPages = Math.ceil(filteredInvoices.length / itemsPerPage)

  const handleTypeToggle = (type: string) => {
    setSelectedTypes(prev => 
      prev.includes(type) 
        ? prev.filter(t => t !== type)
        : [...prev, type]
    )
  }

  const handleStatusToggle = (status: string) => {
    setSelectedStatuses(prev => 
      prev.includes(status) 
        ? prev.filter(s => s !== status)
        : [...prev, status]
    )
  }

  const uniqueTypes = [...new Set(invoices.map(i => i.cfdiType))]
  const uniqueStatuses = [...new Set(invoices.map(i => i.status))]

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Bóveda Fiscal</CardTitle>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por UUID, RFC, nombre o folio..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 w-80"
              />
            </div>
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Filter className="h-4 w-4 mr-2" />
                  Tipo CFDI
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {uniqueTypes.map(type => (
                  <DropdownMenuCheckboxItem
                    key={type}
                    checked={selectedTypes.includes(type)}
                    onCheckedChange={() => handleTypeToggle(type)}
                  >
                    {type}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Filter className="h-4 w-4 mr-2" />
                  Estado
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {uniqueStatuses.map(status => (
                  <DropdownMenuCheckboxItem
                    key={status}
                    checked={selectedStatuses.includes(status)}
                    onCheckedChange={() => handleStatusToggle(status)}
                  >
                    {status}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button 
              variant="outline" 
              size="sm"
              onClick={() => showInfo("Exportar", "Función de exportación en desarrollo")}
            >
              <Download className="h-4 w-4 mr-2" />
              Exportar
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">
            Mostrando {paginatedInvoices.length} de {filteredInvoices.length} facturas
          </div>
          
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>UUID</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Folio</TableHead>
                  <TableHead>Emisor</TableHead>
                  <TableHead>Receptor</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>SAT</TableHead>
                  <TableHead>Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedInvoices.map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell className="font-mono text-xs">
                      {invoice.uuid.substring(0, 8)}...
                    </TableCell>
                    <TableCell>
                      <Badge className={getCfdiTypeBadgeColor(invoice.cfdiType)}>
                        {invoice.cfdiType}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {invoice.series}-{invoice.folio}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        <div className="font-medium">{invoice.issuerName}</div>
                        <div className="text-muted-foreground">{invoice.issuerRfc}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        <div className="font-medium">{invoice.receiverName}</div>
                        <div className="text-muted-foreground">{invoice.receiverRfc}</div>
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">
                      ${invoice.total.toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell>
                      {invoice.issuanceDate.toLocaleDateString('es-MX')}
                    </TableCell>
                    <TableCell>
                      <Badge className={getStatusBadgeColor(invoice.status)}>
                        {invoice.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={getSatStatusBadgeColor(invoice.satStatus)}>
                        {invoice.satStatus}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <Eye className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => showInfo("Ver detalles", "Función en desarrollo")}>
                            Ver detalles
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => showSuccess("Descarga iniciada", "XML descargado exitosamente")}>
                            Descargar XML
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => showSuccess("Descarga iniciada", "PDF descargado exitosamente")}>
                            Descargar PDF
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => window.open(`https://www.sat.gob.mx`, '_blank')}>
                            Ver en SAT
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                Página {currentPage} de {totalPages}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                >
                  Siguiente
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}