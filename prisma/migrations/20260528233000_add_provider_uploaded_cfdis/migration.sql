CREATE TABLE "provider_uploaded_cfdis" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "uploaded_by_user_id" TEXT,
  "receiver_company_id" TEXT,
  "file_name" TEXT NOT NULL,
  "uuid" TEXT NOT NULL,
  "provider_rfc" TEXT NOT NULL,
  "provider_name" TEXT,
  "issuer_rfc" TEXT NOT NULL,
  "issuer_name" TEXT,
  "receiver_rfc" TEXT NOT NULL,
  "receiver_name" TEXT,
  "cfdi_type" TEXT NOT NULL,
  "series" TEXT,
  "folio" TEXT,
  "payment_method" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'MXN',
  "subtotal" DECIMAL(18,6),
  "transferred_taxes_total" DECIMAL(18,6),
  "withheld_taxes_total" DECIMAL(18,6),
  "discount" DECIMAL(18,6),
  "total" DECIMAL(18,6) NOT NULL,
  "issuance_date" TIMESTAMP(3),
  "certification_date" TIMESTAMP(3),
  "validation_status" TEXT NOT NULL DEFAULT 'APPROVED',
  "validation_anexo20" TEXT,
  "validation_sat" TEXT,
  "sat_codigo_estatus" TEXT,
  "sat_estado" TEXT,
  "sat_es_cancelable" TEXT,
  "sat_estatus_cancelacion" TEXT,
  "sat_validacion_efos" TEXT,
  "payment_links_json" JSONB,
  "xml_sha256" TEXT NOT NULL,
  "xml_ciphertext" TEXT NOT NULL,
  "xml_iv" TEXT NOT NULL,
  "xml_auth_tag" TEXT NOT NULL,
  "xml_encryption_alg" TEXT NOT NULL DEFAULT 'aes-256-gcm',
  "xml_key_version" TEXT NOT NULL DEFAULT 'v1',
  "first_validated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_validated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "upload_count" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "provider_uploaded_cfdis_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "provider_uploaded_cfdis_organization_id_uuid_key"
ON "provider_uploaded_cfdis"("organization_id", "uuid");

CREATE INDEX "provider_uploaded_cfdis_organization_id_provider_rfc_idx"
ON "provider_uploaded_cfdis"("organization_id", "provider_rfc");

CREATE INDEX "provider_uploaded_cfdis_organization_id_receiver_rfc_idx"
ON "provider_uploaded_cfdis"("organization_id", "receiver_rfc");

CREATE INDEX "provider_uploaded_cfdis_organization_id_cfdi_type_idx"
ON "provider_uploaded_cfdis"("organization_id", "cfdi_type");

CREATE INDEX "provider_uploaded_cfdis_receiver_company_id_idx"
ON "provider_uploaded_cfdis"("receiver_company_id");

CREATE INDEX "provider_uploaded_cfdis_issuance_date_idx"
ON "provider_uploaded_cfdis"("issuance_date");

CREATE INDEX "provider_uploaded_cfdis_last_validated_at_idx"
ON "provider_uploaded_cfdis"("last_validated_at");

CREATE INDEX "provider_uploaded_cfdis_validation_status_idx"
ON "provider_uploaded_cfdis"("validation_status");

CREATE INDEX "provider_uploaded_cfdis_sat_estado_idx"
ON "provider_uploaded_cfdis"("sat_estado");

ALTER TABLE "provider_uploaded_cfdis"
ADD CONSTRAINT "provider_uploaded_cfdis_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "provider_uploaded_cfdis"
ADD CONSTRAINT "provider_uploaded_cfdis_member_id_fkey"
FOREIGN KEY ("member_id") REFERENCES "members"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "provider_uploaded_cfdis"
ADD CONSTRAINT "provider_uploaded_cfdis_uploaded_by_user_id_fkey"
FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "provider_uploaded_cfdis"
ADD CONSTRAINT "provider_uploaded_cfdis_receiver_company_id_fkey"
FOREIGN KEY ("receiver_company_id") REFERENCES "companies"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
