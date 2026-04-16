
import { Metadata } from "next"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { ProtectedRoute } from "@/components/auth/protected-route"
import { PrivateKeyForm } from "@/components/mass-downloads/private-key-form"

export const metadata: Metadata = {
  title: "Configuración de Llaves Privadas - PlatFi Intelligence",
  description: "Configura tus llaves privadas para descargas masivas de CFDI",
}

export default async function MassDownloadsPage() {
  const session = await auth()

  if (!session?.user?.id) {
    redirect("/auth/signin")
  }

  let companies: Array<{
    id: string
    rfc: string
    businessName: string
  }> = []
  let organizationId: string | undefined

  const membership = await prisma.member.findFirst({
    where: { userId: session.user.id, status: "APPROVED" },
    include: { organization: true },
  })

  if (membership?.organization) {
    const isOwner = membership.organization.ownerId === session.user.id
    const isAdmin = membership.role === "ADMIN"

    organizationId = membership.organization.id

    let rows
    if (isOwner || isAdmin) {
      // Get all companies in the organization
      const members = await prisma.member.findMany({
        where: { organizationId: membership.organization.id, status: "APPROVED" },
        select: { userId: true },
      })
      const userIds = members.map((m) => m.userId)
      rows = await prisma.company.findMany({
        where: { createdBy: { in: userIds } },
        orderBy: { businessName: "asc" },
        select: { id: true, rfc: true, businessName: true },
      })
    } else {
      // Get assigned companies
      const access = await prisma.companyAccess.findMany({
        where: { memberId: membership.id },
        select: { companyId: true },
      })
      const companyIds = access.map((a) => a.companyId)
      rows = await prisma.company.findMany({
        where: { id: { in: companyIds } },
        orderBy: { businessName: "asc" },
        select: { id: true, rfc: true, businessName: true },
      })
    }

    companies = rows
  }

  return (
    <ProtectedRoute>
      <div className="flex-1 space-y-4 p-4 md:p-6 pt-6">
        <div className="flex items-center justify-between space-y-2">
          <div className="flex flex-col space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">Configuración de Descargas Masivas</h1>
            <p className="text-sm text-muted-foreground">
              Configura tus RFCs y sube tus archivos .key y .cer para poder solicitar y descargar comprobantes desde el SAT.
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-8">
          <PrivateKeyForm companies={companies} organizationId={organizationId} />
        </div>
      </div>
    </ProtectedRoute>
  )
}
