-- Fiscal Control reads received CFDI by tenant, receiver company and issuance
-- date, then continues with an id tie-breaker cursor. This avoids filtering a
-- broad date index as the received-CFDI history grows.
CREATE INDEX "provider_uploaded_cfdis_org_company_issuance_id_idx"
ON "provider_uploaded_cfdis" ("organization_id", "receiver_company_id", "issuance_date", "id");
