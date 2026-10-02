import { PrismaClient, MemberRole } from "@prisma/client";
const prisma = new PrismaClient();
import { getUserApprovedOrganizationIds } from "@/lib/tenant";

const __ROLE_RANK: Record<MemberRole, number> = {
  ADMIN: 4,
  AUDITOR: 2,
  VIEWER: 1,
} as const;

async function main() {
  const email = "rtorreh@itcomplements.com";
  const orgIdParam: string | undefined = undefined; // pasa 'cmnntrppk000502gcp93ketfx' (Grupo Demo) para simulacro con ?orgId=

  const user = await prisma.user.findFirstOrThrow({ where: { email }, select: { id: true, email: true } });
  console.log("STEP 0: user =", user);

  const allowedOrgIds = await getUserApprovedOrganizationIds(user.id, { take: 200 });
  console.log("\nSTEP 1: getUserApprovedOrganizationIds ->", allowedOrgIds);

  let orgId: string | undefined;
  if (orgIdParam) {
    if (!allowedOrgIds.includes(orgIdParam)) {
      console.log("\n⚠ orgIdParam no pertenece a allowedOrgIds → GENERIC_NOT_FOUND_BODY");
      process.exit(0);
    }
    orgId = orgIdParam;
    console.log("  → orgId filtrado a", orgId);
  }

  const baseWhere = {
    userId: user.id,
    status: "APPROVED" as const,
    organizationId: { in: allowedOrgIds.length > 0 ? allowedOrgIds : ["__none__"] },
  } as const;

  const allMemberships = await prisma.member.findMany({
    where: { ...baseWhere, ...(orgId ? { organizationId: orgId } : {}) },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 100,
  });
  console.log("\nSTEP 2: allMemberships APPROVED count =", allMemberships.length);
  allMemberships.forEach((m, i) => console.log(`  [${i}] memberId=${m.id} orgId=${m.organizationId} role=${m.role} status=${m.status} created=${m.createdAt.toISOString()}`));

  if (allMemberships.length === 0) {
    console.log("\n⚠ allMemberships === 0 → GENERIC_NOT_FOUND");
    process.exit(0);
  }

  const allMemberIds = allMemberships.map((m) => m.id);
  console.log("\nSTEP 2b: allMemberIds =", allMemberIds);

  const membershipDominante = [...allMemberships].sort((a, b) => {
    const ra = __ROLE_RANK[(a.role as MemberRole) || "VIEWER"] || 0;
    const rb = __ROLE_RANK[(b.role as MemberRole) || "VIEWER"] || 0;
    if (rb !== ra) return rb - ra;
    if (a.createdAt.getTime() !== b.createdAt.getTime()) return a.createdAt.getTime() - b.createdAt.getTime();
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  })[0]!;
  console.log("\nSTEP 3: membershipDominante =", membershipDominante.id, "role =", membershipDominante.role);

  const accessRows = await prisma.companyAccess.findMany({
    where: { memberId: { in: allMemberIds } },
    take: 500,
    include: {
      company: { select: { id: true, rfc: true, businessName: true, status: true, name: true } },
      member: { select: { role: true } },
      customRole: {
        select: {
          name: true,
          canViewEmission: true, canViewReception: true, canViewPayroll: true, canViewSatPortal: true,
          canViewMassDownloads: true, canManageOrg: true, granularPermissions: true,
        },
      },
    },
  });
  console.log("\nSTEP 4: Fuente 1 — companyAccess memberId IN allMemberIds  → count =", accessRows.length);

  type FEC = {
    id: string; rfc: string; businessName: string; isActive: boolean; role: string;
    isCustomRole: boolean; moduleFlags: unknown | null;
  };
  const candidateByCompanyId = new Map<string, FEC>();
  for (const row of accessRows) {
    const ok = !!row.company && row.company.status === "APPROVED";
    console.log(`  - [${ok ? "✓" : "✗ skip"}] companyId=${row.company?.id} rfc=${row.company?.rfc} status=${row.company?.status} customRole=${!!row.customRole}`);
    if (!row.company || row.company.status !== "APPROVED") continue;
    const role = row.customRole ? row.customRole.name : ((row.member.role as MemberRole) || "VIEWER");
    candidateByCompanyId.set(row.company.id, {
      id: row.company.id, rfc: row.company.rfc,
      businessName: row.company.businessName || row.company.name,
      isActive: true, role, isCustomRole: !!row.customRole,
      moduleFlags: row.customRole
        ? {
            canViewEmission: row.customRole.canViewEmission,
            canViewReception: row.customRole.canViewReception,
            canViewPayroll: row.customRole.canViewPayroll,
            canViewSatPortal: row.customRole.canViewSatPortal,
            canViewMassDownloads: row.customRole.canViewMassDownloads,
            canManageOrg: row.customRole.canManageOrg,
            granularPermissions: (row.customRole.granularPermissions as Record<string, boolean>) || {},
          }
        : null,
    });
  }

  console.log("\nSTEP 5: Fuente 2 — empresas creadas por userId, status APPROVED");
  const empresasCreadasPorUsuario = await prisma.company.findMany({
    where: { createdBy: user.id, status: "APPROVED" },
    select: { id: true, rfc: true, businessName: true, name: true, status: true },
    take: 500,
  });
  console.log("  count =", empresasCreadasPorUsuario.length);
  for (const c of empresasCreadasPorUsuario) {
    const yaEstaba = candidateByCompanyId.has(c.id);
    console.log(`    [${yaEstaba ? "ya via fuente1 skip" : "ADD fuente2"}] name=${c.name} rfc=${c.rfc}`);
    if (yaEstaba) continue;
    candidateByCompanyId.set(c.id, {
      id: c.id, rfc: c.rfc,
      businessName: c.businessName || c.name,
      isActive: true, role: membershipDominante.role,
      isCustomRole: false, moduleFlags: null,
    });
  }

  const finalCompanies = Array.from(candidateByCompanyId.values());
  console.log("\n===== RESULTADO FINAL endpoint =====");
  console.log("  hasAccess =", finalCompanies.length > 0);
  console.log("  companies count =", finalCompanies.length);
  finalCompanies.forEach((c, i) => console.log(`    [${i}] rfc=${c.rfc} businessName=${c.businessName} role=${c.role} custom=${c.isCustomRole}`));
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
