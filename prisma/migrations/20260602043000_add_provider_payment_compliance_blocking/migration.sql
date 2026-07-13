ALTER TABLE "members"
ADD COLUMN IF NOT EXISTS "provider_upload_blocked_at" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "provider_upload_blocked_reason" TEXT,
ADD COLUMN IF NOT EXISTS "provider_upload_blocked_by_system" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "members_organization_id_provider_rfc_idx"
ON "members"("organization_id", "provider_rfc");

CREATE INDEX IF NOT EXISTS "members_provider_upload_blocked_by_system_idx"
ON "members"("provider_upload_blocked_by_system");

ALTER TABLE "provider_uploaded_cfdis"
ADD COLUMN IF NOT EXISTS "payment_complement_due_date" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "provider_uploaded_cfdis_payment_complement_due_date_idx"
ON "provider_uploaded_cfdis"("payment_complement_due_date");
