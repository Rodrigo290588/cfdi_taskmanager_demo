import type { SbcSdiAlertCursor, BrechaTimbradoCursor } from '@/lib/postgres-keyset-pagination';

export type FiscalNomTableParams = Readonly<{
  companyId: string;
  startDate: string;
  endDate: string;
  fiscalEntityId?: string | null;
}>;

export type SbcSdiFetchTop100Params = FiscalNomTableParams & Readonly<{
  cursor?: SbcSdiAlertCursor | null;
  limit?: number;
}>;

export type BrechaFetchTop100Params = FiscalNomTableParams & Readonly<{
  cursor?: BrechaTimbradoCursor | null;
  limit?: number;
}>;
