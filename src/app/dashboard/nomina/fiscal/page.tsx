// ============================================================
// src/app/dashboard/nomina/fiscal/page.tsx · TASK 4 (entry)
// Slot pattern children Server/Client — paridad rh/page.tsx.
// Exporta force-dynamic, nodejs runtime, maxDuration 30s.
// ============================================================

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

import { Suspense } from 'react';
import Link from 'next/link';
import { DashboardSkeleton } from '@/components/loading/skeletons';
import { FiscalNominaClientPage } from './fiscal-nomina-client-page';
import { FiscalNominaServerPage } from './fiscal-nomina-server-page';
import { parseFiscalNominaSearchParams } from '@/lib/fiscal-nomina-dashboard-url';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { AlertTriangle, RefreshCcw, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function FallbackFatalServerError({ errorMsg }: { errorMsg: string }) {
  return (
    <div className="flex-1 p-4 md:p-6 pt-6">
      <Card className="border-red-200 bg-red-50/40">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-100 text-red-700">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <div className="text-lg font-semibold text-red-900">
                Error al cargar el tablero fiscal de nómina
              </div>
              <div className="text-sm text-red-700 mt-1">
                Se presentó un error inesperado en el servidor. Los datos podrían no estar
                disponibles temporalmente.
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-white rounded-lg border border-red-100 p-4 text-xs font-mono text-slate-700 whitespace-pre-wrap break-all">
            {errorMsg || 'Sin detalles adicionales del error.'}
          </div>
          <div className="flex flex-wrap gap-3">
            <Button variant="default" size="sm" asChild className="gap-2">
              <a href="#">
                <RefreshCcw className="w-4 h-4" />
                Reintentar (presiona F5)
              </a>
            </Button>
            <Button variant="outline" size="sm" asChild className="gap-2">
              <Link href="/dashboard">
                <Home className="w-4 h-4" />
                Volver al inicio
              </Link>
            </Button>
          </div>
          <p className="text-xs text-slate-500 pt-2">
            Si el error persiste, contacta a soporte con el texto de arriba incluido.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

type RawParsedFiscal = ReturnType<typeof parseFiscalNominaSearchParams>;
export default async function FiscalNominaDashboardPage(props: {
  searchParams: SearchParams;
}) {
  const pageProps: { awaited: Record<string, string | string[] | undefined> | null; initialFilters: RawParsedFiscal; fatalErr: string | null } = { awaited: null, initialFilters: {} as RawParsedFiscal, fatalErr: null };
  try {
    const awaited = await props.searchParams;
    pageProps.awaited = awaited ?? null;
    pageProps.initialFilters = parseFiscalNominaSearchParams(awaited ?? {});
  } catch (err) {
    const errorMsg =
      err instanceof Error
        ? `[FiscalNominaPage] ${err.name}: ${err.message}\n${err.stack ?? ''}`
        : `[FiscalNominaPage] Error desconocido: ${String(err)}`;
    pageProps.fatalErr = errorMsg;
  }
  if (pageProps.fatalErr) {
    return <FallbackFatalServerError errorMsg={pageProps.fatalErr} />;
  }
  const awaited = pageProps.awaited ?? {};
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <FiscalNominaClientPage initialSearchParams={awaited}>
        <FiscalNominaServerPage initialFilters={pageProps.initialFilters} />
      </FiscalNominaClientPage>
    </Suspense>
  );
}
