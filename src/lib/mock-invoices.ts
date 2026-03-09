import { CfdiType, InvoiceStatus, SatStatus } from "@prisma/client"

export interface MockInvoice {
  id: string
  uuid: string
  cfdiType: CfdiType
  series: string
  folio: string
  issuerRfc: string
  issuerName: string
  receiverRfc: string
  receiverName: string
  total: number
  subtotal: number
  ivaTrasladado: number
  status: InvoiceStatus
  satStatus: SatStatus
  issuanceDate: Date
  certificationDate: Date
  paymentMethod: string
  paymentForm: string
}

export const mockInvoices: MockInvoice[] = [
  {
    id: "1",
    uuid: "F7F6F5E4-3D2C-1B0A-9F8E-7D6C5B4A3921",
    cfdiType: CfdiType.INGRESO,
    series: "A",
    folio: "12345",
    issuerRfc: "BIMO840515XXX",
    issuerName: "Grupo Bimbo S.A.B. de C.V.",
    receiverRfc: "WALM830312XXX",
    receiverName: "Walmart de México S.A.B. de C.V.",
    total: 125000.00,
    subtotal: 107758.62,
    ivaTrasladado: 17241.38,
    status: InvoiceStatus.ACTIVE,
    satStatus: SatStatus.VIGENTE,
    issuanceDate: new Date("2024-03-15T10:30:00Z"),
    certificationDate: new Date("2024-03-15T10:31:00Z"),
    paymentMethod: "PUE",
    paymentForm: "03"
  },
  {
    id: "2",
    uuid: "E6E5D4C3-2B1A-0F9E-8D7C-6B5A49382817",
    cfdiType: CfdiType.EGRESO,
    series: "NC",
    folio: "67890",
    issuerRfc: "BIMO840515XXX",
    issuerName: "Grupo Bimbo S.A.B. de C.V.",
    receiverRfc: "PROV123456XXX",
    receiverName: "Proveedores Industriales S.A. de C.V.",
    total: 35000.00,
    subtotal: 30172.41,
    ivaTrasladado: 4827.59,
    status: InvoiceStatus.ACTIVE,
    satStatus: SatStatus.VIGENTE,
    issuanceDate: new Date("2024-03-14T14:20:00Z"),
    certificationDate: new Date("2024-03-14T14:21:00Z"),
    paymentMethod: "PUE",
    paymentForm: "04"
  },
  {
    id: "3",
    uuid: "D5D4C3B2-1A0F-9E8D-7C6B-5A4938281765",
    cfdiType: CfdiType.INGRESO,
    series: "B",
    folio: "54321",
    issuerRfc: "BIMO840515XXX",
    issuerName: "Grupo Bimbo S.A.B. de C.V.",
    receiverRfc: "SORI840517XXX",
    receiverName: "Soriana S.A.B. de C.V.",
    total: 87500.00,
    subtotal: 75431.03,
    ivaTrasladado: 12068.97,
    status: InvoiceStatus.ACTIVE,
    satStatus: SatStatus.VIGENTE,
    issuanceDate: new Date("2024-03-13T09:15:00Z"),
    certificationDate: new Date("2024-03-13T09:16:00Z"),
    paymentMethod: "PPD",
    paymentForm: "99"
  },
  {
    id: "4",
    uuid: "C4C3B2A1-0F9E-8D7C-6B5A-493828176543",
    cfdiType: CfdiType.NOMINA,
    series: "NOM",
    folio: "98765",
    issuerRfc: "BIMO840515XXX",
    issuerName: "Grupo Bimbo S.A.B. de C.V.",
    receiverRfc: "JuanPerez",
    receiverName: "Juan Pérez García",
    total: 18500.00,
    subtotal: 18500.00,
    ivaTrasladado: 0.00,
    status: InvoiceStatus.ACTIVE,
    satStatus: SatStatus.VIGENTE,
    issuanceDate: new Date("2024-03-12T12:00:00Z"),
    certificationDate: new Date("2024-03-12T12:01:00Z"),
    paymentMethod: "PUE",
    paymentForm: "99"
  },
  {
    id: "5",
    uuid: "B3B2A190-F8E7-D6C5-B4A3-928271605438",
    cfdiType: CfdiType.PAGO,
    series: "P",
    folio: "13579",
    issuerRfc: "BIMO840515XXX",
    issuerName: "Grupo Bimbo S.A.B. de C.V.",
    receiverRfc: "WALM830312XXX",
    receiverName: "Walmart de México S.A.B. de C.V.",
    total: 125000.00,
    subtotal: 125000.00,
    ivaTrasladado: 0.00,
    status: InvoiceStatus.ACTIVE,
    satStatus: SatStatus.VIGENTE,
    issuanceDate: new Date("2024-03-11T16:45:00Z"),
    certificationDate: new Date("2024-03-11T16:46:00Z"),
    paymentMethod: "PUE",
    paymentForm: "03"
  }
]

export const getStatusBadgeColor = (status: InvoiceStatus) => {
  switch (status) {
    case InvoiceStatus.ACTIVE:
      return 'bg-green-100 text-green-800'
    case InvoiceStatus.CANCELLED:
      return 'bg-red-100 text-red-800'
    case InvoiceStatus.PENDING:
      return 'bg-yellow-100 text-yellow-800'
    default:
      return 'bg-gray-100 text-gray-800'
  }
}

export const getSatStatusBadgeColor = (status: SatStatus) => {
  switch (status) {
    case SatStatus.VIGENTE:
      return 'bg-blue-100 text-blue-800'
    case SatStatus.CANCELADO:
      return 'bg-red-100 text-red-800'
    case SatStatus.NO_ENCONTRADO:
      return 'bg-gray-100 text-gray-800'
    default:
      return 'bg-gray-100 text-gray-800'
  }
}

export const getCfdiTypeBadgeColor = (type: CfdiType) => {
  switch (type) {
    case CfdiType.INGRESO:
      return 'bg-green-100 text-green-800'
    case CfdiType.EGRESO:
      return 'bg-red-100 text-red-800'
    case CfdiType.NOMINA:
      return 'bg-purple-100 text-purple-800'
    case CfdiType.PAGO:
      return 'bg-blue-100 text-blue-800'
    case CfdiType.TRASLADO:
      return 'bg-orange-100 text-orange-800'
    default:
      return 'bg-gray-100 text-gray-800'
  }
}