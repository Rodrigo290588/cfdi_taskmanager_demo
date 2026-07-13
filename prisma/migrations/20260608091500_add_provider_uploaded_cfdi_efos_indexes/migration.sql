CREATE INDEX IF NOT EXISTS "provider_uploaded_cfdis_org_company_issuer_date_idx"
ON "provider_uploaded_cfdis"("organization_id", "receiver_company_id", "issuer_rfc", "issuance_date");

CREATE INDEX IF NOT EXISTS "provider_uploaded_cfdis_org_company_validation_type_idx"
ON "provider_uploaded_cfdis"("organization_id", "receiver_company_id", "validation_status", "cfdi_type");
