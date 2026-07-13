ALTER TABLE "provider_uploaded_cfdis"
ADD COLUMN IF NOT EXISTS "issuer_fiscal_regime" TEXT;

ALTER TABLE "provider_uploaded_cfdis"
ADD COLUMN IF NOT EXISTS "has_resico_isr_retention" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "provider_uploaded_cfdis_org_company_resico_rule_idx"
ON "provider_uploaded_cfdis"("organization_id", "receiver_company_id", "issuer_fiscal_regime", "has_resico_isr_retention");
