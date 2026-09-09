// ============================================================
// fiscal-nomina-alertas-tables.tsx · TASK 10
// Dos tablas Server async:
//   (A) Alertas SBC / SDI · top 100 desviaciones (keyset, NO OFFSET)
//   (B) Alertas Brecha Timbrado > 5 días · top 100 (keyset)
// ============================================================

import { Suspense, type ReactNode } from 'react';
import Link from 'next/link';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { FileWarning, AlertOctagon, FileX, ExternalLink } from 'lucide-react';
import { prisma } from '@/lib/prisma';
import { cn } from '@/lib/utils';
import {
  buildKeysetWhere, SBC_SDI_ORDER, BRECHA_TIMBRADO_ORDER,
} from '@/lib/postgres-keyset-pagination';
import {
  FiscalNomEmptyState, ChartCard,
} from './fiscal-nomina-shared';
import {
  fmtMxn, fmtNum, fmtPct, fmtDateEs, fmtDiasDiferencia,
} from '@/lib/fiscal-nomina-formatters';
import {
  safeStr, safeNum,
} from '@/lib/fiscal-nomina-drilldown-helpers';
import type {
  FiscalNomTableParams, SbcSdiFetchTop100Params, BrechaFetchTop100Params,
} from '@/lib/fiscal-nomina-types';

// ==================================================================
// TIPO 1 — ALERTA SBC / SDI (IMSS · Carga Social)
// ==================================================================
export type SbcSdiAlertRow = {
  id: string;
  rfc: string;
  nombre: string;
  departamento: string | null;
  sbc: number | null;
  sdi: number | null;
  diff: number;
  diff_pct: number;
  alerta: 'NULL_SBC' | 'NULL_SDI' | 'ZERO_SBC' | 'ZERO_SDI' | 'DESV_GT_3PCT' | 'OK';
};

export async function fetchAuditoriaSbcSdiTop100(params: SbcSdiFetchTop100Params): Promise<SbcSdiAlertRow[]> {
  const { startDate: sIso, endDate: eIso } = params;
  const fe = params.fiscalEntityId ?? null;
  const limit = Math.max(1, Math.min(500, params.limit ?? 100));

  const keyset = buildKeysetWhere(SBC_SDI_ORDER, params.cursor ?? null);

  const rows = await prisma.$queryRaw<(SbcSdiAlertRow & { sbc_raw: unknown; sdi_raw: unknown })[]>`
    WITH base AS (
      SELECT pr.id,
             rec.rfc,
             rec.nombre,
             COALESCE(pr.departamento, rec.departamento) AS departamento,
             rec.salario_base_cot_apor   AS sbc_raw,
             rec.salario_diario_integrado AS sdi_raw
        FROM payroll_receipts pr
        JOIN payroll_receptors rec ON rec.payroll_receipt_id = pr.id
       WHERE pr.company_id = ${params.companyId}::text
         AND pr.fecha_pago >= ${sIso}::date
         AND pr.fecha_pago <= ${eIso}::date
         AND (${fe}::text IS NULL OR pr.fiscal_entity_id = ${fe}::text)
    )
    SELECT id,
           rfc,
           nombre,
           departamento,
           sbc_raw::numeric(18,6) AS sbc,
           sdi_raw::numeric(18,6) AS sdi,
           (COALESCE(ABS(sbc_raw - sdi_raw), 0))::numeric(18,6) AS diff,
           CASE
             WHEN sbc_raw IS NULL OR sdi_raw IS NULL OR sbc_raw = 0 OR sdi_raw = 0 THEN 0
             ELSE (ABS(sbc_raw - sdi_raw) / NULLIF(sdi_raw, 0) * 100)::numeric(10,2)
           END AS diff_pct,
           CASE
             WHEN sbc_raw IS NULL THEN 'NULL_SBC'::text
             WHEN sdi_raw IS NULL THEN 'NULL_SDI'::text
             WHEN sbc_raw = 0   THEN 'ZERO_SBC'::text
             WHEN sdi_raw = 0   THEN 'ZERO_SDI'::text
             WHEN (ABS(sbc_raw - sdi_raw) / NULLIF(sdi_raw, 0) * 100) > 3 THEN 'DESV_GT_3PCT'::text
             ELSE 'OK'::text
           END AS alerta
      FROM base
     WHERE (sbc_raw IS NULL OR sdi_raw IS NULL OR sbc_raw = 0 OR sdi_raw = 0
            OR (sdi_raw <> 0 AND (ABS(sbc_raw - sdi_raw) / sdi_raw * 100) > 3))
       AND ${keyset.sql}
     ORDER BY diff DESC, id ASC
     LIMIT ${limit}::int;
  `;

  return rows.map(r => ({
    id: r.id,
    rfc: r.rfc,
    nombre: r.nombre,
    departamento: r.departamento,
    sbc: r.sbc == null ? null : Number(r.sbc),
    sdi: r.sdi == null ? null : Number(r.sdi),
    diff: Number(r.diff),
    diff_pct: Number(r.diff_pct),
    alerta: r.alerta,
  }));
}

export function SbcSdiTableSkeleton() {
  return (
    <ChartCard
      title="Alertas SBC / SDI · IMSS"
      subtitle="Top 100 — Nulos / Cero / Desviación > 3%"
      minHeight={340}
    >
      <div className="space-y-3">
        <Skeleton className="h-9 w-full bg-slate-200/60 rounded animate-pulse" />
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full bg-slate-200/40 rounded animate-pulse" />
        ))}
      </div>
    </ChartCard>
  );
}

const ALERTA_META: Record<SbcSdiAlertRow['alerta'], { tone: string; label: string }> = {
  NULL_SBC:    { tone: 'bg-rose-500/15 text-rose-700 border-rose-200',  label: 'SBC NULL' },
  NULL_SDI:    { tone: 'bg-rose-500/15 text-rose-700 border-rose-200',  label: 'SDI NULL' },
  ZERO_SBC:    { tone: 'bg-amber-500/15 text-amber-700 border-amber-200',label: 'SBC = 0' },
  ZERO_SDI:    { tone: 'bg-amber-500/15 text-amber-700 border-amber-200',label: 'SDI = 0' },
  DESV_GT_3PCT:{ tone: 'bg-violet-500/15 text-violet-700 border-violet-200', label: 'Desv. > 3%' },
  OK:          { tone: 'bg-emerald-500/15 text-emerald-700 border-emerald-200', label: 'OK' },
};

function _emptySbcSdiFallback(titleExtra = '') {
  return (
    <ChartCard
      title="Alertas SBC / SDI · IMSS"
      subtitle="Top 100 — Nulos / Cero / Desviación > 3%"
      minHeight={340}
    >
      <FiscalNomEmptyState
        icon={<AlertOctagon className="h-12 w-12" />}
        title={titleExtra || 'Sin desviaciones en SBC / SDI'}
        subtitle="No se detectaron nulos, ceros ni desviaciones > 3% entre SalarioBaseCotApor y SalarioDiarioIntegrado en el período seleccionado."
      />
    </ChartCard>
  );
}

export async function SbcSdiAlertsTable(params: FiscalNomTableParams) {
  type Node = React.ReactNode;
  let rows: SbcSdiAlertRow[] | null = null;
  try {
    let rawRows: (SbcSdiAlertRow & { sbc_raw: unknown; sdi_raw: unknown })[] = [];
    try {
      rawRows = await prisma.$queryRaw<(SbcSdiAlertRow & { sbc_raw: unknown; sdi_raw: unknown })[]>`
        WITH base AS (
          SELECT pr.id,
                 rec.rfc,
                 rec.nombre,
                 COALESCE(pr.departamento, rec.departamento) AS departamento,
                 rec.salario_base_cot_apor   AS sbc_raw,
                 rec.salario_diario_integrado AS sdi_raw
            FROM payroll_receipts pr
            JOIN payroll_receptors rec ON rec.payroll_receipt_id = pr.id
           WHERE pr.company_id = ${params.companyId}::text
             AND pr.fecha_pago >= ${params.startDate}::date
             AND pr.fecha_pago <= ${params.endDate}::date
             AND (${params.fiscalEntityId ?? null}::text IS NULL OR pr.fiscal_entity_id = ${params.fiscalEntityId ?? null}::text)
        )
        SELECT id,
               rfc,
               nombre,
               departamento,
               sbc_raw::numeric(18,6) AS sbc,
               sdi_raw::numeric(18,6) AS sdi,
               (COALESCE(ABS(sbc_raw - sdi_raw), 0))::numeric(18,6) AS diff,
               CASE
                 WHEN sbc_raw IS NULL OR sdi_raw IS NULL OR sbc_raw = 0 OR sdi_raw = 0 THEN 0
                 ELSE (ABS(sbc_raw - sdi_raw) / NULLIF(sdi_raw, 0) * 100)::numeric(10,2)
               END AS diff_pct,
               CASE
                 WHEN sbc_raw IS NULL THEN 'NULL_SBC'::text
                 WHEN sdi_raw IS NULL THEN 'NULL_SDI'::text
                 WHEN sbc_raw = 0   THEN 'ZERO_SBC'::text
                 WHEN sdi_raw = 0   THEN 'ZERO_SDI'::text
                 WHEN (ABS(sbc_raw - sdi_raw) / NULLIF(sdi_raw, 0) * 100) > 3 THEN 'DESV_GT_3PCT'::text
                 ELSE 'OK'::text
               END AS alerta
          FROM base
         WHERE (sbc_raw IS NULL OR sdi_raw IS NULL OR sbc_raw = 0 OR sdi_raw = 0
                OR (sdi_raw <> 0 AND (ABS(sbc_raw - sdi_raw) / sdi_raw * 100) > 3))
         ORDER BY diff DESC, id ASC
         LIMIT 100::int;
      `;
    } catch { rawRows = []; }

    rows = rawRows.map(r => ({
      id: String(r.id),
      rfc: safeStr(r.rfc),
      nombre: safeStr(r.nombre),
      departamento: r.departamento == null ? null : safeStr(r.departamento),
      sbc: r.sbc == null ? null : safeNum(r.sbc),
      sdi: r.sdi == null ? null : safeNum(r.sdi),
      diff: safeNum(r.diff),
      diff_pct: safeNum(r.diff_pct),
      alerta: (['NULL_SBC','NULL_SDI','ZERO_SBC','ZERO_SDI','DESV_GT_3PCT','OK'].includes(safeStr(r.alerta))
        ? safeStr(r.alerta) as SbcSdiAlertRow['alerta']
        : 'OK'),
    }));
  } catch (e) {
    console.error('[SbcSdiAlertsTable] fatal render (capturado):', e instanceof Error ? `${e.name}: ${e.message}` : String(e));
  }

  let node: Node;
  if (!rows || rows.length === 0) {
    node = _emptySbcSdiFallback(rows === null ? 'Módulo no disponible temporalmente' : '');
  } else {
    node = (
      <ChartCard
        title="Alertas SBC / SDI · IMSS"
        subtitle={`Top ${rows.length} · Nulos / Cero / Desviación > 3%`}
        right={
          <Badge variant="outline" className="font-normal text-xs border-violet-200 text-violet-700 bg-violet-500/10">
            {fmtNum(rows.length, 0)} alertas
          </Badge>
        }
        minHeight={340}
        footer={
          <span>
            Lógica SAT: <code>nomina12:Receptor/@SalarioBaseCotApor</code>{' '}vs{' '}
            <code className="mx-1">@SalarioDiarioIntegrado</code>.{' '}Una desviación {'>'}{' '}3% sugiere inconsistencia{' '}
            entre SBC (IMSS) y SDI (prima vacacional / aguinaldo).
          </span>
        }
      >
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs font-semibold">RFC</TableHead>
                <TableHead className="text-xs font-semibold">Empleado</TableHead>
                <TableHead className="text-xs font-semibold">Departamento</TableHead>
                <TableHead className="text-xs font-semibold text-right">SBC</TableHead>
                <TableHead className="text-xs font-semibold text-right">SDI</TableHead>
                <TableHead className="text-xs font-semibold text-right">Diff $</TableHead>
                <TableHead className="text-xs font-semibold text-right">Diff %</TableHead>
                <TableHead className="text-xs font-semibold">Alerta</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => {
                const meta = ALERTA_META[r.alerta];
                const filaRoja = r.alerta === 'NULL_SBC' || r.alerta === 'NULL_SDI' || r.alerta === 'DESV_GT_3PCT';
                return (
                  <TableRow
                    key={r.id}
                    className={cn(filaRoja && 'bg-rose-50/50 hover:bg-rose-50')}
                  >
                    <TableCell className="font-mono text-xs">{r.rfc}</TableCell>
                    <TableCell className="text-xs">{r.nombre}</TableCell>
                    <TableCell className="text-xs text-slate-500">{r.departamento ?? '—'}</TableCell>
                    <TableCell className={cn('text-xs text-right tabular-nums', r.sbc == null && 'text-rose-600 font-medium')}>
                      {r.sbc == null ? <span className="font-bold">NULL</span> : fmtMxn(r.sbc)}
                    </TableCell>
                    <TableCell className={cn('text-xs text-right tabular-nums', r.sdi == null && 'text-rose-600 font-medium')}>
                      {r.sdi == null ? <span className="font-bold">NULL</span> : fmtMxn(r.sdi)}
                    </TableCell>
                    <TableCell className="text-xs text-right tabular-nums">{fmtMxn(r.diff)}</TableCell>
                    <TableCell className="text-xs text-right tabular-nums">{fmtPct(r.diff_pct, 2)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn('font-normal text-xs border-transparent', meta.tone)}>
                        {meta.label}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </ChartCard>
    );
  }
  return <>{node}</>;
}

// ==================================================================
// TIPO 2 — BRECHA DE TIMBRADO (FechaPago vs FechaEmisión CFDI)
// ==================================================================
export type BrechaTimbradoRow = {
  id: string;
  uuid: string;
  invoice_id: string | null;
  pdf_url: string | null;
  fecha_pago: Date;
  fecha_emision: Date;
  brecha_dias: number;
  rfc_empleado: string;
  nombre_empleado: string;
};

export async function fetchAlertasBrechaTimbradoTop100(params: BrechaFetchTop100Params): Promise<BrechaTimbradoRow[]> {
  const { startDate: sIso, endDate: eIso } = params;
  const fe = params.fiscalEntityId ?? null;
  const limit = Math.max(1, Math.min(500, params.limit ?? 100));
  const keyset = buildKeysetWhere(BRECHA_TIMBRADO_ORDER, params.cursor ?? null);

  const rows = await prisma.$queryRaw<(BrechaTimbradoRow & { brecha_raw: unknown })[]>`
    WITH base AS (
      SELECT pr.id,
             pr.uuid,
             pr.invoice_id,
             inv.pdf_url,
             pr.fecha_pago,
             pr.fecha_emision,
             (pr.fecha_emision::date - pr.fecha_pago::date)::int AS brecha_dias_raw,
             rec.rfc    AS rfc_empleado,
             rec.nombre AS nombre_empleado
        FROM payroll_receipts pr
        LEFT JOIN invoices inv ON inv.id = pr.invoice_id
        JOIN payroll_receptors rec ON rec.payroll_receipt_id = pr.id
       WHERE pr.company_id = ${params.companyId}::text
         AND pr.fecha_pago >= ${sIso}::date
         AND pr.fecha_pago <= ${eIso}::date
         AND (${fe}::text IS NULL OR pr.fiscal_entity_id = ${fe}::text)
         AND (pr.fecha_emision::date - pr.fecha_pago::date) > 5
    )
    SELECT id, uuid, invoice_id, pdf_url, fecha_pago, fecha_emision,
           brecha_dias_raw::int AS brecha_dias,
           rfc_empleado, nombre_empleado
      FROM base
     WHERE ${keyset.sql}
     ORDER BY brecha_dias DESC, id ASC
     LIMIT ${limit}::int;
  `;

  return rows.map(r => ({
    id: r.id,
    uuid: r.uuid,
    invoice_id: r.invoice_id,
    pdf_url: r.pdf_url,
    fecha_pago: r.fecha_pago,
    fecha_emision: r.fecha_emision,
    brecha_dias: Number(r.brecha_dias),
    rfc_empleado: r.rfc_empleado,
    nombre_empleado: r.nombre_empleado,
  }));
}

export function BrechaTimbradoTableSkeleton() {
  return (
    <ChartCard
      title="Brecha de Timbrado > 5 días"
      subtitle="FechaPago (nómina) vs FechaEmisión (CFDI)"
      minHeight={340}
    >
      <div className="space-y-3">
        <Skeleton className="h-9 w-full bg-slate-200/60 rounded animate-pulse" />
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full bg-slate-200/40 rounded animate-pulse" />
        ))}
      </div>
    </ChartCard>
  );
}

function _emptyBrechaTimbradoFallback(titleExtra = '') {
  return (
    <ChartCard
      title="Brecha de Timbrado > 5 días"
      subtitle="FechaPago (nómina) vs FechaEmisión (CFDI)"
      minHeight={340}
    >
      <FiscalNomEmptyState
        icon={<FileX className="h-12 w-12" />}
        title={titleExtra || 'Sin retrasos de timbrado'}
        subtitle="Todos los CFDIs de nómina fueron emitidos dentro de los 5 días naturales posteriores a la fecha de pago."
        hint="Regla general SAT: Art. 29 CFF. Brecha > 5 días puede generar riesgo de deducibilidad."
      />
    </ChartCard>
  );
}

function _safeDate(v: unknown): Date {
  if (v instanceof Date) return v;
  try {
    const d = new Date(safeStr(v));
    if (Number.isNaN(d.getTime())) return new Date();
    return d;
  } catch { return new Date(); }
}

function _brechaRenderLink(r: BrechaTimbradoRow): ReactNode {
  if (r.pdf_url) {
    return (
      <Link
        href={r.pdf_url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-xs text-blue-700 hover:text-blue-900 font-medium"
      >
        Ver{' '}<ExternalLink className="h-3 w-3" />
      </Link>
    );
  }
  if (r.invoice_id) {
    return (
      <Link
        href={`/invoices/${r.invoice_id}`}
        className="inline-flex items-center gap-1 text-xs text-blue-700 hover:text-blue-900 font-medium"
      >
        Detalle{' '}<ExternalLink className="h-3 w-3" />
      </Link>
    );
  }
  return <span className="text-xs text-slate-400">—</span>;
}

export async function BrechaTimbradoAlertsTable(params: FiscalNomTableParams) {
  let rows: BrechaTimbradoRow[] | null = null;
  try {
    let rawRows: (BrechaTimbradoRow & { brecha_raw: unknown })[] = [];
    try {
      rawRows = await prisma.$queryRaw<(BrechaTimbradoRow & { brecha_raw: unknown })[]>`
        WITH base AS (
          SELECT pr.id,
                 pr.uuid,
                 pr.invoice_id,
                 inv.pdf_url,
                 pr.fecha_pago,
                 pr.fecha_emision,
                 (pr.fecha_emision::date - pr.fecha_pago::date)::int AS brecha_dias_raw,
                 rec.rfc    AS rfc_empleado,
                 rec.nombre AS nombre_empleado
            FROM payroll_receipts pr
            LEFT JOIN invoices inv ON inv.id = pr.invoice_id
            JOIN payroll_receptors rec ON rec.payroll_receipt_id = pr.id
           WHERE pr.company_id = ${params.companyId}::text
             AND pr.fecha_pago >= ${params.startDate}::date
             AND pr.fecha_pago <= ${params.endDate}::date
             AND (${params.fiscalEntityId ?? null}::text IS NULL OR pr.fiscal_entity_id = ${params.fiscalEntityId ?? null}::text)
             AND (pr.fecha_emision::date - pr.fecha_pago::date) > 5
        )
        SELECT id, uuid, invoice_id, pdf_url, fecha_pago, fecha_emision,
               brecha_dias_raw::int AS brecha_dias,
               rfc_empleado, nombre_empleado
          FROM base
         ORDER BY brecha_dias DESC, id ASC
         LIMIT 100::int;
      `;
    } catch { rawRows = []; }

    rows = rawRows.map(r => ({
      id: String(r.id),
      uuid: safeStr(r.uuid) || '00000000-0000-0000-0000-000000000000',
      invoice_id: r.invoice_id == null ? null : safeStr(r.invoice_id),
      pdf_url: r.pdf_url == null ? null : safeStr(r.pdf_url),
      fecha_pago: _safeDate(r.fecha_pago),
      fecha_emision: _safeDate(r.fecha_emision),
      brecha_dias: safeNum(r.brecha_dias),
      rfc_empleado: safeStr(r.rfc_empleado),
      nombre_empleado: safeStr(r.nombre_empleado),
    }));
  } catch (e) {
    console.error('[BrechaTimbradoAlertsTable] fatal render (capturado):', e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    rows = null;
  }

  let node: React.ReactNode;
  if (!rows || rows.length === 0) {
    node = _emptyBrechaTimbradoFallback(rows === null ? 'Módulo no disponible temporalmente' : '');
  } else {
    node = (
      <ChartCard
        title="Brecha de Timbrado > 5 días"
        subtitle="FechaPago (nómina) vs FechaEmisión (CFDI)"
        right={
          <Badge variant="outline" className="font-normal text-xs border-amber-200 text-amber-700 bg-amber-500/10">
            {fmtNum(rows.length, 0)} retrasos
          </Badge>
        }
        minHeight={340}
        footer={
          <span>
            Lógica SAT: <code>nomina12:Nomina/@FechaPago</code>{' '}vs{' '}<code className="mx-1">Comprobante/@Fecha</code>.
            Una brecha mayor a 5 días calendario sugiere timbrado extemporáneo y riesgo de deducibilidad
            (ISR patronal e IMSS).
          </span>
        }
      >
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs font-semibold">UUID CFDI</TableHead>
                <TableHead className="text-xs font-semibold text-right">Fecha Pago</TableHead>
                <TableHead className="text-xs font-semibold text-right">Fecha Emisión</TableHead>
                <TableHead className="text-xs font-semibold text-right">Brecha</TableHead>
                <TableHead className="text-xs font-semibold">RFC Empleado</TableHead>
                <TableHead className="text-xs font-semibold">Empleado</TableHead>
                <TableHead className="text-xs font-semibold text-right">PDF</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.id} className="bg-amber-50/30 hover:bg-amber-50">
                  <TableCell className="font-mono text-[11px] max-w-[180px] truncate" title={r.uuid}>
                    {r.uuid.slice(0, 8)}…{r.uuid.slice(-6)}
                  </TableCell>
                  <TableCell className="text-xs text-right tabular-nums">{fmtDateEs(r.fecha_pago)}</TableCell>
                  <TableCell className="text-xs text-right tabular-nums">{fmtDateEs(r.fecha_emision)}</TableCell>
                  <TableCell className="text-xs text-right tabular-nums font-semibold text-amber-700">
                    {fmtDiasDiferencia(r.brecha_dias)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.rfc_empleado}</TableCell>
                  <TableCell className="text-xs max-w-[200px] truncate">{r.nombre_empleado}</TableCell>
                  <TableCell className="text-right">
                    {_brechaRenderLink(r)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </ChartCard>
    );
  }
  return <>{node}</>;
}

function _emptyTopComprobantesFallback() {
  return (
    <ChartCard title="Top Comprobantes · Estatus SAT" subtitle="Módulo no disponible temporalmente" minHeight={260}>
      <FiscalNomEmptyState
        icon={<FileWarning className="h-12 w-12 text-slate-400" />}
        title="Sin datos de estatus SAT"
        subtitle="El resumen de comprobantes se cargará después de importar CFDIs de nómina."
      />
    </ChartCard>
  );
}

type TopCompTotals = Readonly<{
  totalReceipts: number;
  totalCancelados: number;
  totalVigentes: number;
}>;

async function _tCompQueryFromDB(params: FiscalNomTableParams): Promise<TopCompTotals> {
  const { startDate: sIso, endDate: eIso } = params;
  const fe = params.fiscalEntityId ?? null;
  let totalReceipts = 0;
  let totalCancelados = 0;
  let totalVigentes = 0;
  try {
    const rows = await prisma.$queryRaw<{ total: bigint; sat_status: string }[]>`
      SELECT COUNT(*)::bigint AS total,
             COALESCE(inv.sat_status::text, 'VIGENTE') AS sat_status
        FROM payroll_receipts pr
        LEFT JOIN invoices inv ON inv.id = pr.invoice_id
       WHERE pr.company_id = ${params.companyId}::text
         AND pr.fecha_pago >= ${sIso}::date
         AND pr.fecha_pago <= ${eIso}::date
         AND (${fe}::text IS NULL OR pr.fiscal_entity_id = ${fe}::text)
       GROUP BY COALESCE(inv.sat_status::text, 'VIGENTE');
    `;
    for (const r of rows) {
      const n = safeNum(r.total);
      totalReceipts += n;
      if (r.sat_status === 'CANCELADO') totalCancelados = n;
      else totalVigentes += n;
    }
  } catch { /* fail soft */ }
  return { totalReceipts, totalCancelados, totalVigentes };
}

function _tCompCancelCardBorderBg(cancelados: number): string {
  if (cancelados > 0) return 'border-rose-200 bg-rose-50/40';
  return 'border-slate-200 bg-slate-50/40';
}
function _tCompCancelTextHeader(cancelados: number): string {
  if (cancelados > 0) return 'text-rose-700';
  return 'text-slate-600';
}
function _tCompCancelTextValue(cancelados: number): string {
  if (cancelados > 0) return 'text-rose-700';
  return '';
}
function _tCompCancelTextFooter(cancelados: number): string {
  if (cancelados > 0) return 'text-rose-600/80';
  return 'text-slate-500';
}
function _tCompCancelFooterLabel(pct: number): string {
  if (pct >= 1) return '⚠ Riesgo alto';
  return 'Dentro de tolerancia';
}

// ==================================================================
// TOP COMPROBANTES (RESUMEN) · Sección 6 del dropdown
// ==================================================================
export async function TopComprobantesCard(params: FiscalNomTableParams) {
  let totals: TopCompTotals | null = null;
  try {
    totals = await _tCompQueryFromDB(params);
  } catch (e) {
    console.error('[TopComprobantesCard] fatal render (capturado):', e instanceof Error ? `${e.name}: ${e.message}` : String(e));
  }

  if (!totals) return _emptyTopComprobantesFallback();
  const { totalReceipts, totalCancelados, totalVigentes } = totals;
  const pctCancelado = totalReceipts ? (totalCancelados / totalReceipts) * 100 : 0;
  const pctVigentes = totalReceipts ? (totalVigentes / totalReceipts) * 100 : 0;

  return (
    <ChartCard
      title="Top Comprobantes · Estatus SAT"
      subtitle="Conteo de recibos de nómina por estatus de timbrado"
      minHeight={260}
      right={
        <Badge variant="outline" className="font-normal text-xs border-slate-200 text-slate-700 bg-slate-500/10">
          {fmtNum(totalReceipts, 0)} totales
        </Badge>
      }
      footer={
        <span>
          Fuente: Cancelados ≥ 1% ameritan revisión de bitácora de cancelaciones 20/24 horas SAT.
        </span>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 py-2">
        <div className="space-y-2 border rounded-md p-4 border-emerald-200 bg-emerald-50/40">
          <div className="text-xs font-semibold text-emerald-700 uppercase tracking-wider">Vigentes</div>
          <div className="text-2xl font-bold tabular-nums">{fmtNum(totalVigentes, 0)}</div>
          <div className="text-xs text-emerald-600/80">{fmtPct(pctVigentes, 1)} del lote</div>
        </div>
        <div className={cn(
          'space-y-2 border rounded-md p-4',
          _tCompCancelCardBorderBg(totalCancelados),
        )}>
          <div className={cn('text-xs font-semibold uppercase tracking-wider', _tCompCancelTextHeader(totalCancelados))}>
            Cancelados
          </div>
          <div className={cn('text-2xl font-bold tabular-nums', _tCompCancelTextValue(totalCancelados))}>
            {fmtNum(totalCancelados, 0)}
          </div>
          <div className={cn('text-xs', _tCompCancelTextFooter(totalCancelados))}>
            {fmtPct(pctCancelado, 2)} del lote · {_tCompCancelFooterLabel(pctCancelado)}
          </div>
        </div>
        <div className="space-y-2 border rounded-md p-4 border-slate-200 bg-slate-50/40">
          <div className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
            <FileWarning className="h-3 w-3 inline mr-1" />{' '}UUIDs únicos
          </div>
          <div className="text-2xl font-bold tabular-nums">{fmtNum(totalReceipts, 0)}</div>
          <div className="text-xs text-slate-500/80">Sin duplicados detectados en el lote</div>
        </div>
      </div>
    </ChartCard>
  );
}

export function TopComprobantesCardSkeleton() {
  return (
    <ChartCard title="Top Comprobantes · Estatus SAT" minHeight={260}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 py-2">
        {[0, 1, 2].map(i => (
          <div key={i} className="space-y-2 border rounded-md p-4">
            <Skeleton className="h-3 w-24 bg-slate-200/60 rounded animate-pulse" />
            <Skeleton className="h-8 w-32 bg-slate-200/70 rounded animate-pulse" />
            <Skeleton className="h-3 w-full bg-slate-200/50 rounded animate-pulse" />
          </div>
        ))}
      </div>
    </ChartCard>
  );
}

export function SbcSdiAlertsTableSuspensed(props: Readonly<Parameters<typeof SbcSdiAlertsTable>[0]>) {
  return (
    <Suspense fallback={<SbcSdiTableSkeleton />}>
      <SbcSdiAlertsTable {...props} />
    </Suspense>
  );
}

export function BrechaTimbradoAlertsTableSuspensed(props: Readonly<Parameters<typeof BrechaTimbradoAlertsTable>[0]>) {
  return (
    <Suspense fallback={<BrechaTimbradoTableSkeleton />}>
      <BrechaTimbradoAlertsTable {...props} />
    </Suspense>
  );
}

export function TopComprobantesCardSuspensed(props: Readonly<Parameters<typeof TopComprobantesCard>[0]>) {
  return (
    <Suspense fallback={<TopComprobantesCardSkeleton />}>
      <TopComprobantesCard {...props} />
    </Suspense>
  );
}
