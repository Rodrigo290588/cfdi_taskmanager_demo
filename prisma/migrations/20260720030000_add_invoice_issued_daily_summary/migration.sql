CREATE TABLE IF NOT EXISTS "invoice_issued_daily_summary" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "issuer_fiscal_entity_id" TEXT NOT NULL,
  "summary_date" DATE NOT NULL,
  "cfdi_type" TEXT NOT NULL,
  "sat_status" TEXT NOT NULL DEFAULT 'SIN_ESTATUS',
  "receiver_rfc" TEXT NOT NULL DEFAULT '',
  "receiver_name" TEXT NOT NULL DEFAULT '',
  "payment_method" TEXT NOT NULL DEFAULT '',
  "sales_bucket" TEXT NOT NULL DEFAULT 'NO_APLICA',
  "payment_status_bucket" TEXT NOT NULL DEFAULT 'NO_APLICA',
  "cfdi_count" INTEGER NOT NULL DEFAULT 0,
  "subtotal_amount" DECIMAL(18, 6) NOT NULL DEFAULT 0,
  "discount_amount" DECIMAL(18, 6) NOT NULL DEFAULT 0,
  "total_amount" DECIMAL(18, 6) NOT NULL DEFAULT 0,
  "iva_transferred_total" DECIMAL(18, 6) NOT NULL DEFAULT 0,
  "iva_withheld_total" DECIMAL(18, 6) NOT NULL DEFAULT 0,
  "isr_withheld_total" DECIMAL(18, 6) NOT NULL DEFAULT 0,
  "ieps_withheld_total" DECIMAL(18, 6) NOT NULL DEFAULT 0,
  "collected_amount" DECIMAL(18, 6) NOT NULL DEFAULT 0,
  "pending_amount" DECIMAL(18, 6) NOT NULL DEFAULT 0,
  "overdue_amount" DECIMAL(18, 6) NOT NULL DEFAULT 0,
  "credit_note_applied_amount" DECIMAL(18, 6) NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "invoice_issued_daily_summary_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "invoice_issued_daily_summary_unique_dim_idx"
ON "invoice_issued_daily_summary"(
  "organization_id",
  "issuer_fiscal_entity_id",
  "summary_date",
  "cfdi_type",
  "sat_status",
  "receiver_rfc",
  "payment_method",
  "sales_bucket",
  "payment_status_bucket"
);

CREATE INDEX IF NOT EXISTS "invoice_issued_daily_summary_entity_date_idx"
ON "invoice_issued_daily_summary"("organization_id", "issuer_fiscal_entity_id", "summary_date");

CREATE INDEX IF NOT EXISTS "invoice_issued_daily_summary_entity_type_idx"
ON "invoice_issued_daily_summary"("organization_id", "issuer_fiscal_entity_id", "cfdi_type");

CREATE INDEX IF NOT EXISTS "invoice_issued_daily_summary_entity_receiver_idx"
ON "invoice_issued_daily_summary"("organization_id", "issuer_fiscal_entity_id", "receiver_rfc");

CREATE INDEX IF NOT EXISTS "invoice_issued_daily_summary_entity_sales_bucket_idx"
ON "invoice_issued_daily_summary"("organization_id", "issuer_fiscal_entity_id", "sales_bucket");

CREATE INDEX IF NOT EXISTS "invoice_issued_daily_summary_entity_payment_bucket_idx"
ON "invoice_issued_daily_summary"("organization_id", "issuer_fiscal_entity_id", "payment_status_bucket");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'invoice_issued_daily_summary_organization_id_fkey'
      AND table_name = 'invoice_issued_daily_summary'
  ) THEN
    ALTER TABLE "invoice_issued_daily_summary"
    ADD CONSTRAINT "invoice_issued_daily_summary_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'invoice_issued_daily_summary_issuer_fiscal_entity_id_fkey'
      AND table_name = 'invoice_issued_daily_summary'
  ) THEN
    ALTER TABLE "invoice_issued_daily_summary"
    ADD CONSTRAINT "invoice_issued_daily_summary_issuer_fiscal_entity_id_fkey"
    FOREIGN KEY ("issuer_fiscal_entity_id") REFERENCES "fiscal_entities"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
  END IF;
END $$;
