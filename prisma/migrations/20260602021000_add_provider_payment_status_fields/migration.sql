ALTER TABLE "provider_uploaded_cfdis"
ADD COLUMN IF NOT EXISTS "payment_status_manual" TEXT,
ADD COLUMN IF NOT EXISTS "payment_date_manual" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "payment_status_updated_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "payment_status_updated_by_client_id" TEXT;

CREATE INDEX IF NOT EXISTS "provider_uploaded_cfdis_payment_status_manual_idx"
ON "provider_uploaded_cfdis"("payment_status_manual");

CREATE INDEX IF NOT EXISTS "provider_uploaded_cfdis_payment_date_manual_idx"
ON "provider_uploaded_cfdis"("payment_date_manual");
