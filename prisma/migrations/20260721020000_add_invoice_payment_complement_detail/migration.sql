CREATE TABLE IF NOT EXISTS "invoice_payment_complement_details" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "issuer_fiscal_entity_id" TEXT NOT NULL,
  "payment_invoice_id" TEXT NOT NULL,
  "payment_invoice_uuid" TEXT NOT NULL,
  "related_invoice_id" TEXT,
  "related_invoice_uuid" TEXT NOT NULL,
  "payment_date" TIMESTAMP(3) NOT NULL,
  "payment_series" TEXT,
  "payment_folio" TEXT,
  "monto_total_pagos" DECIMAL(18, 6) NOT NULL DEFAULT 0,
  "imp_pagado" DECIMAL(18, 6) NOT NULL DEFAULT 0,
  "imp_saldo_ant" DECIMAL(18, 6) NOT NULL DEFAULT 0,
  "imp_saldo_insoluto" DECIMAL(18, 6) NOT NULL DEFAULT 0,
  "moneda_p" TEXT NOT NULL DEFAULT 'MXN',
  "moneda_dr" TEXT NOT NULL DEFAULT 'MXN',
  "equivalencia_dr" DECIMAL(18, 6) NOT NULL DEFAULT 1,
  "num_parcialidad" INTEGER NOT NULL DEFAULT 1,
  "sat_status_snapshot" TEXT NOT NULL DEFAULT 'SIN_ESTATUS',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "invoice_payment_complement_details_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "invoice_payment_comp_entity_rel_uuid_idx"
ON "invoice_payment_complement_details"("organization_id", "issuer_fiscal_entity_id", "related_invoice_uuid");

CREATE INDEX IF NOT EXISTS "invoice_payment_comp_entity_pay_date_idx"
ON "invoice_payment_complement_details"("organization_id", "issuer_fiscal_entity_id", "payment_date");

CREATE INDEX IF NOT EXISTS "invoice_payment_comp_payment_inv_id_idx"
ON "invoice_payment_complement_details"("payment_invoice_id");

CREATE INDEX IF NOT EXISTS "invoice_payment_comp_related_inv_id_idx"
ON "invoice_payment_complement_details"("related_invoice_id");

CREATE INDEX IF NOT EXISTS "invoice_payment_comp_uuid_partiality_idx"
ON "invoice_payment_complement_details"("payment_invoice_uuid", "related_invoice_uuid", "num_parcialidad");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'invoice_payment_comp_det_org_id_fkey'
      AND table_name = 'invoice_payment_complement_details'
  ) THEN
    ALTER TABLE "invoice_payment_complement_details"
    ADD CONSTRAINT "invoice_payment_comp_det_org_id_fkey"
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
    WHERE constraint_name = 'invoice_payment_comp_det_entity_id_fkey'
      AND table_name = 'invoice_payment_complement_details'
  ) THEN
    ALTER TABLE "invoice_payment_complement_details"
    ADD CONSTRAINT "invoice_payment_comp_det_entity_id_fkey"
    FOREIGN KEY ("issuer_fiscal_entity_id") REFERENCES "fiscal_entities"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'invoice_payment_comp_det_pay_inv_id_fkey'
      AND table_name = 'invoice_payment_complement_details'
  ) THEN
    ALTER TABLE "invoice_payment_complement_details"
    ADD CONSTRAINT "invoice_payment_comp_det_pay_inv_id_fkey"
    FOREIGN KEY ("payment_invoice_id") REFERENCES "invoices"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'invoice_payment_comp_det_rel_inv_id_fkey'
      AND table_name = 'invoice_payment_complement_details'
  ) THEN
    ALTER TABLE "invoice_payment_complement_details"
    ADD CONSTRAINT "invoice_payment_comp_det_rel_inv_id_fkey"
    FOREIGN KEY ("related_invoice_id") REFERENCES "invoices"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
  END IF;
END $$;
