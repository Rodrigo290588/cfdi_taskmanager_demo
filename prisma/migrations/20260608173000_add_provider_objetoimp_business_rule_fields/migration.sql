ALTER TABLE "provider_uploaded_cfdis"
ADD COLUMN IF NOT EXISTS "has_objetoimp_tax_mismatch" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "provider_uploaded_cfdis"
ADD COLUMN IF NOT EXISTS "objetoimp_tax_mismatch_reason" TEXT;

CREATE INDEX IF NOT EXISTS "provider_uploaded_cfdis_org_company_objetoimp_rule_idx"
ON "provider_uploaded_cfdis"("organization_id", "receiver_company_id", "has_objetoimp_tax_mismatch");
