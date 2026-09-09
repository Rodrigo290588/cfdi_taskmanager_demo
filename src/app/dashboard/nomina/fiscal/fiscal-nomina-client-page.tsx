// ============================================================
// fiscal-nomina-client-page.tsx · TASK 4 (client wrapper)
// Wrapper 'use client' 1:1 con rh-client-page.tsx.
//   · populateFromStorage({force: true}) desde localStorage.selectedCompany
//   · Listeners CustomEvent window/document 'company-selected' + 'storage'
//   · Preserva: startDate, endDate, departamento, registroPatronal,
//               sections, organizationId, fiscalEntityId
// ============================================================
'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DashboardSkeleton } from '@/components/loading/skeletons';
import {
  buildFiscalNominaDashboardUrl,
  parseFiscalNominaSearchParams,
} from '@/lib/fiscal-nomina-dashboard-url';

type SelectedCompanyShape = { id?: string; rfc?: string; businessName?: string; name?: string } | null;

type FiscalNomClientPageProps = Readonly<{
  initialSearchParams: Record<string, string | string[] | undefined>;
  children: ReactNode;
}>;

function readSelectedCompanyFromStorage(): SelectedCompanyShape {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem('selectedCompany');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && 'id' in (parsed as Record<string, unknown>)) {
      return parsed as SelectedCompanyShape;
    }
    return null;
  } catch {
    return null;
  }
}

function _preserveFiltersFromSearchParams(sp: ReturnType<typeof useSearchParams>): Record<string, string> {
  const preserved: Record<string, string> = {};
  const sd  = sp.get('startDate');
  const ed  = sp.get('endDate');
  const d   = sp.get('departamento');
  const rp  = sp.get('registroPatronal');
  const sec = sp.get('sections');
  const org = sp.get('organizationId');
  const fe  = sp.get('fiscalEntityId');
  if (sd)  preserved.startDate = sd;
  if (ed)  preserved.endDate = ed;
  if (d && d.length > 0)   preserved.departamento = d;
  if (rp && rp.length > 0) preserved.registroPatronal = rp;
  if (sec && sec.length > 0) preserved.sections = sec;
  if (org) preserved.organizationId = org;
  if (fe)  preserved.fiscalEntityId = fe;
  return preserved;
}

type _NavigateCandidate = Readonly<{
  nextUrl: string;
}>;
function _buildNavigateCandidateOrNull(args: Readonly<{
  force: boolean;
  urlCompanyId: string;
  storedId: string;
  preserved: Record<string, string>;
}>): _NavigateCandidate | null {
  const { force, urlCompanyId, storedId, preserved } = args;
  if (!force && urlCompanyId && urlCompanyId === storedId) return null;
  const nextUrl = buildFiscalNominaDashboardUrl(undefined, {
    companyId: storedId,
    ...preserved,
  });
  return { nextUrl };
}

export function FiscalNominaClientPage(props: FiscalNomClientPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialFilters = useMemo(
    () => parseFiscalNominaSearchParams(props.initialSearchParams),
    [props.initialSearchParams],
  );

  const [mounted, setMounted] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState<SelectedCompanyShape>(null);

  const urlCompanyId = searchParams.get('companyId') ?? initialFilters.companyId ?? '';
  const hasCompanyInUrl = urlCompanyId.length > 0;

  const populateFromStorage = useCallback(({ force }: { force: boolean }) => {
    const stored = readSelectedCompanyFromStorage();
    const storedId = stored?.id;
    if (!storedId) return;
    const preserved = _preserveFiltersFromSearchParams(searchParams);
    const nav = _buildNavigateCandidateOrNull({ force, urlCompanyId, storedId, preserved });
    if (!nav) return;
    window.history.replaceState(window.history.state, '', nav.nextUrl);
    router.replace(nav.nextUrl, { scroll: false });
  }, [urlCompanyId, searchParams, router]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setMounted(true);
      setSelectedCompany(readSelectedCompanyFromStorage());
    }, 0);

    const handler = () => {
      setSelectedCompany(readSelectedCompanyFromStorage());
      populateFromStorage({ force: true });
    };
    window.addEventListener('company-selected', handler as EventListener);
    document.addEventListener('company-selected', handler as EventListener);
    window.addEventListener('storage', handler as EventListener);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('company-selected', handler as EventListener);
      document.removeEventListener('company-selected', handler as EventListener);
      window.removeEventListener('storage', handler as EventListener);
    };
  }, [populateFromStorage]);

  useEffect(() => {
    if (!mounted) return;
    populateFromStorage({ force: false });
  }, [mounted, populateFromStorage]);

  if (!mounted) {
    return <DashboardSkeleton />;
  }

  if (!hasCompanyInUrl && !selectedCompany?.id) {
    return (
      <div className="flex-1 space-y-4 p-4 md:p-6 pt-6">
        <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-widest text-slate-500 mb-1">
              Nómina · Cumplimiento y Conciliación
            </p>
            <h1 className="text-3xl font-bold tracking-tight">
              Tablero de Contabilidad y Fiscal
            </h1>
          </div>
        </header>
        <Card>
          <CardHeader>
            <div className="text-lg font-semibold">Selecciona una empresa</div>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-3">
            <p>
              Usa el selector de empresas del sidebar para elegir una RFC, o agrega{' '}
              <code className="inline-block mx-1 px-1 rounded bg-slate-100">?companyId=...</code>
              {' '}a la URL para visualizar el tablero de contabilidad y cumplimiento de nómina.
            </p>
            <p className="text-xs text-slate-500">
              Elige una empresa desde el botón del tenant en la parte superior del menú lateral.
            </p>
            <div>
              <Link href="/dashboard">
                <Button variant="outline" size="sm">
                  Ir al inicio del dashboard
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{props.children}</>;
}
