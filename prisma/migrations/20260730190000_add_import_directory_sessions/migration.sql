CREATE TABLE IF NOT EXISTS "import_directory_sessions" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "source" "import_run_source" NOT NULL,
  "execution_id" TEXT NOT NULL,
  "total_xml_files" INTEGER NOT NULL,
  "skipped_by_progress_files" INTEGER NOT NULL,
  "new_xml_files" INTEGER NOT NULL,
  "created_by_machine_client_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "import_directory_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "import_directory_sessions_organization_id_fkey"
    FOREIGN KEY ("organization_id")
    REFERENCES "organizations"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "import_directory_sessions_org_source_exec_key"
ON "import_directory_sessions"("organization_id", "source", "execution_id");

CREATE INDEX IF NOT EXISTS "import_directory_sessions_org_created_idx"
ON "import_directory_sessions"("organization_id", "created_at");

ALTER TABLE "import_runs"
ADD COLUMN IF NOT EXISTS "directory_session_id" TEXT;

CREATE INDEX IF NOT EXISTS "import_runs_directory_session_idx"
ON "import_runs"("directory_session_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'import_runs_directory_session_id_fkey'
      AND table_name = 'import_runs'
  ) THEN
    ALTER TABLE "import_runs"
    ADD CONSTRAINT "import_runs_directory_session_id_fkey"
      FOREIGN KEY ("directory_session_id")
      REFERENCES "import_directory_sessions"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;
