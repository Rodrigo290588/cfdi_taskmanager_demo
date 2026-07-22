CREATE TABLE IF NOT EXISTS "invoice_blobs" (
  "id" TEXT NOT NULL,
  "invoice_id" TEXT NOT NULL,
  "xml_sha256" TEXT NOT NULL,
  "xml_ciphertext" TEXT NOT NULL,
  "xml_iv" TEXT NOT NULL,
  "xml_auth_tag" TEXT NOT NULL,
  "xml_encryption_alg" TEXT NOT NULL,
  "xml_key_version" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "invoice_blobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "invoice_blobs_invoice_id_key"
ON "invoice_blobs"("invoice_id");

CREATE INDEX IF NOT EXISTS "invoice_blobs_xml_sha256_idx"
ON "invoice_blobs"("xml_sha256");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'invoice_blobs_invoice_id_fkey'
      AND table_name = 'invoice_blobs'
  ) THEN
    ALTER TABLE "invoice_blobs"
    ADD CONSTRAINT "invoice_blobs_invoice_id_fkey"
    FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
  END IF;
END $$;
