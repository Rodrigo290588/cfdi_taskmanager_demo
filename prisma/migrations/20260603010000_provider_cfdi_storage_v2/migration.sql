ALTER TABLE "provider_uploaded_cfdis"
ALTER COLUMN "xml_ciphertext" DROP NOT NULL,
ALTER COLUMN "xml_iv" DROP NOT NULL,
ALTER COLUMN "xml_auth_tag" DROP NOT NULL,
ALTER COLUMN "xml_encryption_alg" DROP NOT NULL,
ALTER COLUMN "xml_key_version" DROP NOT NULL;

CREATE TABLE IF NOT EXISTS "provider_uploaded_cfdi_blobs" (
  "provider_uploaded_cfdi_id" TEXT NOT NULL,
  "xml_ciphertext" TEXT NOT NULL,
  "xml_iv" TEXT NOT NULL,
  "xml_auth_tag" TEXT NOT NULL,
  "xml_encryption_alg" TEXT NOT NULL DEFAULT 'aes-256-gcm',
  "xml_key_version" TEXT NOT NULL DEFAULT 'v1',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "provider_uploaded_cfdi_blobs_pkey" PRIMARY KEY ("provider_uploaded_cfdi_id"),
  CONSTRAINT "provider_uploaded_cfdi_blobs_provider_uploaded_cfdi_id_fkey"
    FOREIGN KEY ("provider_uploaded_cfdi_id")
    REFERENCES "provider_uploaded_cfdis"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "provider_received_cfdi_daily_summary" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "receiver_company_id" TEXT NOT NULL,
  "summary_date" DATE NOT NULL,
  "cfdi_type" TEXT NOT NULL,
  "sat_estado" TEXT NOT NULL DEFAULT 'SIN_ESTATUS',
  "issuer_rfc" TEXT NOT NULL DEFAULT '',
  "issuer_name" TEXT NOT NULL DEFAULT '',
  "payment_method" TEXT NOT NULL DEFAULT '',
  "payment_status_bucket" TEXT NOT NULL DEFAULT 'NO_APLICA',
  "cfdi_count" INTEGER NOT NULL DEFAULT 0,
  "total_amount" DECIMAL(18, 6) NOT NULL DEFAULT 0,
  "transferred_taxes_total" DECIMAL(18, 6) NOT NULL DEFAULT 0,
  "withheld_taxes_total" DECIMAL(18, 6) NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "provider_received_cfdi_daily_summary_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "provider_received_cfdi_daily_summary_organization_id_fkey"
    FOREIGN KEY ("organization_id")
    REFERENCES "organizations"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT "provider_received_cfdi_daily_summary_receiver_company_id_fkey"
    FOREIGN KEY ("receiver_company_id")
    REFERENCES "companies"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "provider_received_cfdi_daily_summary_unique_dim_idx"
ON "provider_received_cfdi_daily_summary" (
  "organization_id",
  "receiver_company_id",
  "summary_date",
  "cfdi_type",
  "sat_estado",
  "issuer_rfc",
  "payment_method",
  "payment_status_bucket"
);

CREATE INDEX IF NOT EXISTS "provider_received_cfdi_daily_summary_company_date_idx"
ON "provider_received_cfdi_daily_summary"("organization_id", "receiver_company_id", "summary_date");

CREATE INDEX IF NOT EXISTS "provider_received_cfdi_daily_summary_company_type_idx"
ON "provider_received_cfdi_daily_summary"("organization_id", "receiver_company_id", "cfdi_type");

CREATE INDEX IF NOT EXISTS "provider_received_cfdi_daily_summary_company_status_idx"
ON "provider_received_cfdi_daily_summary"("organization_id", "receiver_company_id", "sat_estado");

CREATE INDEX IF NOT EXISTS "provider_received_cfdi_daily_summary_company_supplier_idx"
ON "provider_received_cfdi_daily_summary"("organization_id", "receiver_company_id", "issuer_rfc");

CREATE INDEX IF NOT EXISTS "provider_received_cfdi_daily_summary_company_payment_bucket_idx"
ON "provider_received_cfdi_daily_summary"("organization_id", "receiver_company_id", "payment_status_bucket");

CREATE INDEX IF NOT EXISTS "provider_uploaded_cfdis_dashboard_lookup_idx"
ON "provider_uploaded_cfdis" (
  "organization_id",
  "receiver_company_id",
  "validation_status",
  "issuance_date" DESC
)
INCLUDE (
  "cfdi_type",
  "total",
  "sat_estado",
  "issuer_rfc",
  "issuer_name",
  "payment_method",
  "payment_status_manual",
  "transferred_taxes_total",
  "withheld_taxes_total"
);

CREATE INDEX IF NOT EXISTS "provider_uploaded_cfdis_provider_list_idx"
ON "provider_uploaded_cfdis" (
  "organization_id",
  "provider_rfc",
  "validation_status",
  "issuance_date" DESC,
  "last_validated_at" DESC,
  "uuid" DESC
);

CREATE INDEX IF NOT EXISTS "provider_uploaded_cfdis_payment_compliance_idx"
ON "provider_uploaded_cfdis" (
  "organization_id",
  "provider_rfc",
  "payment_complement_due_date"
)
WHERE "validation_status" = 'APPROVED'
  AND "cfdi_type" IN ('I', 'E', 'T')
  AND "payment_status_manual" = 'PAGADO';
