ALTER TABLE "invoice_payment_complement_details"
ADD COLUMN IF NOT EXISTS "payment_node_index" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "invoice_payment_complement_details"
ADD COLUMN IF NOT EXISTS "base_p" DECIMAL(18, 6) NOT NULL DEFAULT 0;

ALTER TABLE "invoice_payment_complement_details"
ADD COLUMN IF NOT EXISTS "importe_p" DECIMAL(18, 6) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "invoice_payment_comp_uuid_node_idx"
ON "invoice_payment_complement_details"("payment_invoice_uuid", "payment_node_index");
