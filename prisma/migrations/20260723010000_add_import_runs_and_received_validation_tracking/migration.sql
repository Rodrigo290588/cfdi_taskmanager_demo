DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'import_run_source') THEN
    CREATE TYPE "import_run_source" AS ENUM ('JAVA_M2M', 'PROVIDER_PORTAL', 'MANUAL_ADMIN');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'import_run_status') THEN
    CREATE TYPE "import_run_status" AS ENUM (
      'QUEUED',
      'DISPATCHING',
      'PROCESSING',
      'PROCESSING_WITH_EXTERNAL_WAIT',
      'COMPLETED',
      'COMPLETED_WITH_ERRORS',
      'FAILED',
      'CANCELLED'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'import_run_classification_result') THEN
    CREATE TYPE "import_run_classification_result" AS ENUM ('EMITTED', 'RECEIVED', 'BOTH', 'NONE');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'import_run_item_direction') THEN
    CREATE TYPE "import_run_item_direction" AS ENUM ('EMITTED', 'RECEIVED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'import_run_item_status') THEN
    CREATE TYPE "import_run_item_status" AS ENUM (
      'QUEUED',
      'PREPARING',
      'PREPARED',
      'VALIDATING_INTERNAL',
      'WAITING_EXTERNAL_VALIDATION',
      'VALIDATING_EXTERNAL',
      'VALIDATED',
      'PERSISTING',
      'PERSISTED',
      'SKIPPED',
      'FAILED',
      'CANCELLED'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'validation_bucket') THEN
    CREATE TYPE "validation_bucket" AS ENUM ('VALIDO', 'INVALIDO');
  END IF;
END $$;

ALTER TABLE "provider_uploaded_cfdis"
ADD COLUMN IF NOT EXISTS "validation_error_message" TEXT;

ALTER TABLE "provider_received_cfdi_daily_summary"
ADD COLUMN IF NOT EXISTS "validation_bucket" "validation_bucket" NOT NULL DEFAULT 'VALIDO';

DROP INDEX IF EXISTS "provider_received_cfdi_daily_summary_unique_dim_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "provider_received_cfdi_daily_summary_unique_dim_idx"
ON "provider_received_cfdi_daily_summary" (
  "organization_id",
  "receiver_company_id",
  "summary_date",
  "cfdi_type",
  "validation_bucket",
  "sat_estado",
  "issuer_rfc",
  "payment_method",
  "payment_status_bucket"
);

CREATE INDEX IF NOT EXISTS "provider_received_cfdi_daily_summary_company_validation_idx"
ON "provider_received_cfdi_daily_summary"("organization_id", "receiver_company_id", "validation_bucket");

CREATE TABLE IF NOT EXISTS "import_runs" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "source" "import_run_source" NOT NULL,
  "batch_id" TEXT,
  "status" "import_run_status" NOT NULL DEFAULT 'QUEUED',
  "total_items" INTEGER NOT NULL DEFAULT 0,
  "processed_items" INTEGER NOT NULL DEFAULT 0,
  "created_emitted" INTEGER NOT NULL DEFAULT 0,
  "created_received" INTEGER NOT NULL DEFAULT 0,
  "skipped_items" INTEGER NOT NULL DEFAULT 0,
  "error_items" INTEGER NOT NULL DEFAULT 0,
  "waiting_external_validation_items" INTEGER NOT NULL DEFAULT 0,
  "started_at" TIMESTAMP(3),
  "finished_at" TIMESTAMP(3),
  "created_by_machine_client_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "import_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "import_runs_organization_id_fkey"
    FOREIGN KEY ("organization_id")
    REFERENCES "organizations"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "import_runs_org_source_batch_id_key"
ON "import_runs"("organization_id", "source", "batch_id");

CREATE INDEX IF NOT EXISTS "import_runs_org_status_created_idx"
ON "import_runs"("organization_id", "status", "created_at");

CREATE INDEX IF NOT EXISTS "import_runs_org_source_created_idx"
ON "import_runs"("organization_id", "source", "created_at");

CREATE INDEX IF NOT EXISTS "import_runs_machine_client_idx"
ON "import_runs"("created_by_machine_client_id");

CREATE TABLE IF NOT EXISTS "import_run_items" (
  "id" TEXT NOT NULL,
  "import_run_id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "file_name" TEXT NOT NULL,
  "xml_sha256" TEXT NOT NULL,
  "uuid" TEXT,
  "issuer_rfc" TEXT,
  "receiver_rfc" TEXT,
  "receiver_company_id" TEXT,
  "classification_result" "import_run_classification_result" NOT NULL DEFAULT 'NONE',
  "direction" "import_run_item_direction",
  "status" "import_run_item_status" NOT NULL DEFAULT 'QUEUED',
  "validation_status" TEXT,
  "validation_bucket" "validation_bucket",
  "error_code" TEXT,
  "error_message" TEXT,
  "next_external_retry_at" TIMESTAMP(3),
  "attempt_count_internal" INTEGER NOT NULL DEFAULT 0,
  "attempt_count_external" INTEGER NOT NULL DEFAULT 0,
  "emitted_invoice_id" TEXT,
  "received_provider_uploaded_cfdi_id" TEXT,
  "processing_started_at" TIMESTAMP(3),
  "processing_finished_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "import_run_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "import_run_items_import_run_id_fkey"
    FOREIGN KEY ("import_run_id")
    REFERENCES "import_runs"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "import_run_items_org_uuid_direction_key"
ON "import_run_items"("organization_id", "uuid", "direction");

CREATE UNIQUE INDEX IF NOT EXISTS "import_run_items_org_sha_direction_key"
ON "import_run_items"("organization_id", "xml_sha256", "direction");

CREATE INDEX IF NOT EXISTS "import_run_items_run_status_idx"
ON "import_run_items"("import_run_id", "status");

CREATE INDEX IF NOT EXISTS "import_run_items_org_company_status_idx"
ON "import_run_items"("organization_id", "receiver_company_id", "status");

CREATE INDEX IF NOT EXISTS "import_run_items_status_retry_idx"
ON "import_run_items"("status", "next_external_retry_at");

CREATE INDEX IF NOT EXISTS "import_run_items_received_cfdi_idx"
ON "import_run_items"("received_provider_uploaded_cfdi_id");

CREATE INDEX IF NOT EXISTS "import_run_items_emitted_invoice_idx"
ON "import_run_items"("emitted_invoice_id");

CREATE TABLE IF NOT EXISTS "import_run_item_blobs" (
  "import_run_item_id" TEXT NOT NULL,
  "xml_ciphertext" TEXT NOT NULL,
  "xml_iv" TEXT NOT NULL,
  "xml_auth_tag" TEXT NOT NULL,
  "xml_encryption_alg" TEXT NOT NULL DEFAULT 'aes-256-gcm',
  "xml_key_version" TEXT NOT NULL DEFAULT 'v1',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "import_run_item_blobs_pkey" PRIMARY KEY ("import_run_item_id"),
  CONSTRAINT "import_run_item_blobs_import_run_item_id_fkey"
    FOREIGN KEY ("import_run_item_id")
    REFERENCES "import_run_items"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);
