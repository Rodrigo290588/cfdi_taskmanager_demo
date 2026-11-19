DROP INDEX IF EXISTS "provider_uploaded_cfdis_org_company_issuance_id_idx";

CREATE INDEX "provider_uploaded_cfdis_org_company_issuance_uuid_idx"
ON "provider_uploaded_cfdis"
("organization_id", "receiver_company_id", "issuance_date", "uuid");
