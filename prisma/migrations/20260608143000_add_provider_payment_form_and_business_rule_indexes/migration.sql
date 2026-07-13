ALTER TABLE "provider_uploaded_cfdis"
ADD COLUMN IF NOT EXISTS "payment_form" TEXT;

CREATE INDEX IF NOT EXISTS "provider_uploaded_cfdis_org_company_payment_rule_idx"
ON "provider_uploaded_cfdis"("organization_id", "receiver_company_id", "payment_method", "payment_form");
