ALTER TABLE "provider_uploaded_cfdis"
ADD COLUMN IF NOT EXISTS "sat_initial_estado" TEXT,
ADD COLUMN IF NOT EXISTS "sat_status_last_checked_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "sat_status_changed_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "sat_cancellation_detected_at" TIMESTAMP(3);

UPDATE "provider_uploaded_cfdis"
SET
  "sat_initial_estado" = COALESCE("sat_initial_estado", "sat_estado"),
  "sat_status_last_checked_at" = COALESCE("sat_status_last_checked_at", "last_validated_at")
WHERE "sat_initial_estado" IS NULL
   OR "sat_status_last_checked_at" IS NULL;

CREATE INDEX IF NOT EXISTS "provider_uploaded_cfdis_org_company_cancel_detected_idx"
ON "provider_uploaded_cfdis"("organization_id", "receiver_company_id", "sat_cancellation_detected_at");

CREATE INDEX IF NOT EXISTS "provider_uploaded_cfdis_sat_monitor_scan_idx"
ON "provider_uploaded_cfdis"("validation_status", "sat_initial_estado", "sat_estado", "sat_status_last_checked_at");
