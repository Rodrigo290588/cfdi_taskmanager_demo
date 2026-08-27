ALTER TABLE "members"
ADD COLUMN IF NOT EXISTS "provider_upload_blocked_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "provider_upload_blocked_reason" TEXT,
ADD COLUMN IF NOT EXISTS "provider_upload_blocked_by_system" BOOLEAN NOT NULL DEFAULT false;

-- Índice condicional: la columna provider_rfc en members se agrega en una migración
-- POSTERIOR (20260603010000_provider_cfdi_storage_v2). Para evitar que este script
-- falle en ordenes de apply históricos, sólo crear el índice SI la columna ya existe.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'members'
      AND column_name = 'provider_rfc'
  ) THEN
    CREATE INDEX IF NOT EXISTS "members_organization_id_provider_rfc_idx"
    ON "members"("organization_id", "provider_rfc");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "members_provider_upload_blocked_by_system_idx"
ON "members"("provider_upload_blocked_by_system");

ALTER TABLE "provider_uploaded_cfdis"
ADD COLUMN IF NOT EXISTS "payment_complement_due_date" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "provider_uploaded_cfdis_payment_complement_due_date_idx"
ON "provider_uploaded_cfdis"("payment_complement_due_date");
