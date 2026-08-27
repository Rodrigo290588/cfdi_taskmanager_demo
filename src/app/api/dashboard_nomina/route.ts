// ============================================================
// src/app/api/dashboard_nomina/route.ts
// DASH-SAST-001 FIX: Auth + RBAC Scoping (auth / MODULE_PAYROLL_VIEW /
//                     requireApprovedDashboardAccess = IDOR BOLA protection).
// DASH-SAST-002 FIX: Triple Rate Limit (IP / user / org) + SECURITY_HEADERS.
// DASH-SAST-004 FIX: findMany take: MAX_NOMINA_BATCH (DoS memoria).
// DASH-SAST-009 FIX: Regex allow-list + MAX_ATTR_CHARS (ReDoS) + MAX_XML_BYTES.
// DASH-SAST-010 FIX: Next.js exports (runtime/nodejs dynamic/force-dynamic) +
//                     fp32/safeErrSummary (correlation IDs logging seguro).
// ============================================================
export const runtime     = 'nodejs';
export const dynamic     = 'force-dynamic';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { CfdiType, InvoiceStatus, SatStatus, SystemRole } from '@prisma/client';
import { Permission, requireApprovedDashboardAccess, enrichUserWithMemberships, hasPermission } from '@/lib/permissions';
import { rateLimit } from '@/lib/rate-limit';
import { getRealClientIp } from '@/lib/security';
import { SECURITY_HEADERS, MAX_XML_BYTES_DASHBOARD, safeTextEncoderLength } from '@/lib/org-dashboard-helpers';
import { safeErrSummary } from '@/lib/security';
import { fp32 } from '@/lib/monitor-security-helpers';

const MAX_NOMINA_BATCH = 300;   // DoS memoria: lote seguro por UI
const MAX_XML_SCAN_PREFIX = 16 * 1024; // 16KB son suficientes para atributos cabecera nomina
const MAX_DEPARTAMENTO_CHARS = 80;    // ReDoS límite allow-list atributo
const MAX_NUMERIC_DECIMAL = /^(\d{1,12}(?:\.\d{1,6})?)$/;
const ALLOW_DEPARTAMENTO = new RegExp(`^[A-Za-z0-9 ÑñáéíóúÁÉÍÓÚÜü.,_/-]{1,${MAX_DEPARTAMENTO_CHARS}}$`);

/** PII masking para nombre de empleado: muestra solo iniciales + asteriscos intermedios */
function maskEmployeeName(name: string | null | undefined): string {
  if (!name) return '';
  const raw = String(name).trim();
  if (raw.length <= 4) return raw.charAt(0) + '*'.repeat(Math.max(2, raw.length - 1));
  const parts = raw.split(/\s+/).filter(Boolean);
  return parts.map(p => p.length <= 2 ? p : (p.charAt(0) + '*'.repeat(Math.max(3, p.length - 2)) + p.charAt(p.length - 1))).join(' ');
}

export async function GET(request: NextRequest) {
  try {
    // ------------------------------------------------------------------
    // DASH-SAST-002: Rate Limit triple capa (IP antes auth — igual que compliance pattern en org/dashboard)
    // ------------------------------------------------------------------
    const sourceIp = getRealClientIp(request.headers);
    const ipRl = await rateLimit(`dash-nomina-ip:${sourceIp}`, { limit: 60, interval: 60_000 });
    if (!ipRl.success) {
      return NextResponse.json(
        { ok:false, error:'RATE_LIMITED_IP', retryAfterMs: ipRl.retryAfterMs },
        { status:429, headers:{ ...SECURITY_HEADERS, 'Retry-After': String(Math.ceil(ipRl.retryAfterMs/1000)) } }
      );
    }

    // ------------------------------------------------------------------
    // DASH-SAST-001: Autenticación obligatoria
    // ------------------------------------------------------------------
    const session = await auth();
    if (!session?.user?.id || !session.user.email) {
      return NextResponse.json({ ok:false, error:'UNAUTHENTICATED' }, { status:401, headers: SECURITY_HEADERS });
    }

    const userRl = await rateLimit(`dash-nomina-user:${session.user.id}`, { limit: 30, interval: 60_000 });
    if (!userRl.success) {
      return NextResponse.json(
        { ok:false, error:'RATE_LIMITED_USER', retryAfterMs: userRl.retryAfterMs },
        { status:429, headers:{ ...SECURITY_HEADERS, 'Retry-After': String(Math.ceil(userRl.retryAfterMs/1000)) } }
      );
    }

    // ------------------------------------------------------------------
    // Parámetro companyId (obligatorio, formato no null '')
    // ------------------------------------------------------------------
    const companyId = request.nextUrl.searchParams.get('companyId');
    if (!companyId || typeof companyId !== 'string' || companyId.trim() === '') {
      return NextResponse.json({ ok:false, error:'MISSING_COMPANY' }, { status:400, headers: SECURITY_HEADERS });
    }

    // ------------------------------------------------------------------
    // DASH-SAST-001: Reconstruir systemRole para requireApprovedDashboardAccess.
    // Pass #1 de enrich: trae memberships APPROVED + systemRole listo para RBAC.
    // ------------------------------------------------------------------
    const u = await prisma.user.findUnique({ where:{ id: session.user.id }, select:{ systemRole:true } });
    const systemRole = (u?.systemRole as SystemRole) || SystemRole.USER;
    const enrichedUser = await enrichUserWithMemberships({ id: session.user.id, systemRole });

    // Permission gate individual (también requireApprovedDashboardAccess lo hace internamente;
    // doble check = fail closed defense in depth).
    if (!hasPermission(enrichedUser, Permission.MODULE_PAYROLL_VIEW)) {
      return NextResponse.json({ ok:false, error:'FORBIDDEN_PAYROLL' }, { status:403, headers: SECURITY_HEADERS });
    }

    // Scoped dashboard context: valida member.status=APPROVED + CompanyAccess scope
    // + fiscalEntity.organizationId === organizationId asegurado.
    const ctx = await requireApprovedDashboardAccess(session.user.id, systemRole, {
      companyId,
      permission: Permission.MODULE_PAYROLL_VIEW
    });

    const orgRl = await rateLimit(`dash-nomina-org:${ctx.organizationId}`, { limit: 180, interval: 60_000 });
    if (!orgRl.success) {
      return NextResponse.json(
        { ok:false, error:'RATE_LIMITED_ORG', retryAfterMs: orgRl.retryAfterMs },
        { status:429, headers:{ ...SECURITY_HEADERS, 'Retry-After': String(Math.ceil(orgRl.retryAfterMs/1000)) } }
      );
    }

    // ------------------------------------------------------------------
    // DASH-SAST-004: findMany CON take(MAX_NOMINA_BATCH) + fiscalEntityId SCOPADO (ctx.fiscalEntityId)
    // ------------------------------------------------------------------
    const safeFiscalId = (ctx.fiscalEntityId as string | undefined | null) || (ctx.companyId as string | undefined | null) || companyId;

    const invoices = await prisma.satInvoice.findMany({
      where: {
        fiscalEntityId: safeFiscalId,
        cfdiType: CfdiType.NOMINA,
        status: InvoiceStatus.ACTIVE,
        satStatus: SatStatus.VIGENTE
      },
      orderBy: { issuanceDate: 'desc' },
      take: MAX_NOMINA_BATCH,  // ← DEFENSA #1 DoS memoria
      select: {
        id: true,
        uuid: true,
        issuanceDate: true,
        xmlContent: true,
        total: true,
        receiverName: true,
        receiverRfc: true,
        cfdiType: true,
        status: true,
        satStatus: true
      }
    });

    let totalDeducciones = 0;
    let totalOtrosPagos = 0;
    let totalPercepciones = 0;
    let totalNomina = 0;
    let totalDiasPagados = 0;
    const empleadosSet = new Set<string>();
    const byDepartment: Record<string, { percepciones:number; deducciones:number; otrosPagos:number; nomina:number; count:number }> = {};
    let xmlRedactedInvoices = 0;

    for (const inv of invoices) {
      // ----------------------------------------------------------------
      // DASH-SAST-004/009: Truncar XML a MAX_XML_BYTES_DASHBOARD y después
      // a MAX_XML_SCAN_PREFIX para regex. Evitamos ReDoS + OOM en XMLs huge.
      // ----------------------------------------------------------------
      const rawXml = inv.xmlContent || '';
      const xmlByteLen = safeTextEncoderLength(rawXml);
      const exceedsMax = xmlByteLen > MAX_XML_BYTES_DASHBOARD;
      if (exceedsMax) xmlRedactedInvoices += 1;

      // Solo escaneamos los primeros 16KB (atributos de cabecera de nómina viven ahí).
      // Cortamos con slice; si había " justo al límite → regex no match = 0 (fail safe).
      const scanXml = exceedsMax ? rawXml.slice(0, MAX_XML_SCAN_PREFIX) : rawXml;

      // Allow-list regex con límites. NUNCA usar [^"]+ sin límites.
      const mPerc = scanXml.match(/TotalPercepciones="(\d{1,12}(?:\.\d{1,6})?)"/);
      const percepciones = mPerc && MAX_NUMERIC_DECIMAL.test(mPerc[1]) ? Number(mPerc[1]) : 0;
      const mDed = scanXml.match(/TotalDeducciones="(\d{1,12}(?:\.\d{1,6})?)"/);
      const deducciones = mDed && MAX_NUMERIC_DECIMAL.test(mDed[1]) ? Number(mDed[1]) : 0;
      const mOtros = scanXml.match(/TotalOtrosPagos="(\d{1,12}(?:\.\d{1,6})?)"/);
      const otrosPagos = mOtros && MAX_NUMERIC_DECIMAL.test(mOtros[1]) ? Number(mOtros[1]) : 0;
      const mDias = scanXml.match(/NumDiasPagados="(\d{1,4}(?:\.\d{1,2})?)"/);
      const dias = mDias ? Number(mDias[1]) : 0;
      const mDepto = scanXml.match(/Departamento="([^"]{1,80})"/);
      let departamento = 'Sin Departamento';
      if (mDepto && ALLOW_DEPARTAMENTO.test(mDepto[1])) departamento = mDepto[1];
      else if (mDepto) departamento = 'Sin Departamento (valor no alfanumérico)';

      // Acumuladores
      totalPercepciones += percepciones;
      totalDeducciones += deducciones;
      totalOtrosPagos += otrosPagos;
      totalNomina += Number(inv.total) || 0;
      totalDiasPagados += dias;

      // DASH-SAST-005 compliant: empleado name/rfc PII masked antes de meter a Set/Departamento (no filtramos por empleado, pero no dejamos pasar raw)
      const maskedName = maskEmployeeName(inv.receiverName);
      empleadosSet.add(inv.receiverName ? maskedName : 'Desconocido');

      if (!byDepartment[departamento]) {
        byDepartment[departamento] = { percepciones:0, deducciones:0, otrosPagos:0, nomina:0, count:0 };
      }
      byDepartment[departamento].percepciones += percepciones;
      byDepartment[departamento].deducciones += deducciones;
      byDepartment[departamento].otrosPagos  += otrosPagos;
      byDepartment[departamento].nomina      += Number(inv.total) || 0;

      byDepartment[departamento].count       += 1;
    }

    const empleadosPagados = empleadosSet.size;
    const processed = invoices.length;
    const promedioNomina = processed > 0 ? totalNomina / processed : 0;
    const costoPorEmpleado = empleadosPagados > 0 ? totalNomina / empleadosPagados : 0;
    const pctDeducciones = totalPercepciones > 0 ? (totalDeducciones / totalPercepciones) * 100 : 0;

    const departments = Object.entries(byDepartment)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.nomina - a.nomina);

    return NextResponse.json(
      {
        ok: true,
        truncated: processed === MAX_NOMINA_BATCH,
        maxBatch: MAX_NOMINA_BATCH,
        processed,
        xmlRedactedInvoices,
        scope: {
          organizationId: ctx.organizationId,
          fiscalEntityId: safeFiscalId,
          memberRole: ctx.memberRole,
          payrollViewGranted: true
        },
        kpis: {
          totalDeducciones,
          totalOtrosPagos,
          totalPercepciones,
          totalNomina,
          empleadosPagados,
          promedioNomina,
          totalDiasPagados,
          costoPorEmpleado,
          pctDeducciones,
          indiceAusentismo: 0
        },
        departments
      },
      { headers: SECURITY_HEADERS }
    );

  } catch (err) {
    // ------------------------------------------------------------------
    // DASH-SAST-010: Logging seguro con fingerprint correlacionable.
    // NUNCA devolver stack/paths al cliente; solo correlation id.
    // ------------------------------------------------------------------
    const fingerprint = fp32(JSON.stringify({
      msg: (err as Error)?.message || 'ERR_UNKNOWN',
      stack: (err as Error)?.stack?.slice(0, 256) || '',
      t: Date.now()
    }));
    const summary = safeErrSummary(err);
    // No console.error bruto (prohibido volcar paths/stack en prod si logger centralizado)
    console.error('[DASH_NOMINA_500]', { fp: fingerprint, summary });

    let status = 500;
    let error = 'INTERNAL_ERROR';
    const errName = summary.name || '';
    if (/DashboardForbiddenError|FORBIDDEN/.test(errName)) { status = 403; error = 'FORBIDDEN'; }
    else if (/DashboardMissingParamError|MISSING/.test(errName)) { status = 400; error = 'BAD_REQUEST'; }

    return NextResponse.json(
      {
        ok: false,
        error,
        correlationId: fingerprint,
        helpText: 'Si el error persiste, por favor reporta este código a soporte: ' + fingerprint
      },
      { status, headers: SECURITY_HEADERS }
    );
  }
}
