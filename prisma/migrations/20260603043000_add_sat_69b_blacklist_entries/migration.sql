CREATE TABLE IF NOT EXISTS "sat_69b_blacklist_entries" (
  "rfc" TEXT NOT NULL,
  "taxpayer_name" TEXT,
  "status_label" TEXT NOT NULL,
  "status_bucket" TEXT NOT NULL,
  "is_active_risk" BOOLEAN NOT NULL DEFAULT false,
  "publication_date" DATE,
  "removal_date" DATE,
  "source_type" TEXT NOT NULL DEFAULT 'SAT_69B',
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sat_69b_blacklist_entries_pkey" PRIMARY KEY ("rfc")
);

CREATE INDEX IF NOT EXISTS "sat_69b_blacklist_entries_status_bucket_idx"
ON "sat_69b_blacklist_entries"("status_bucket");

CREATE INDEX IF NOT EXISTS "sat_69b_blacklist_entries_active_rfc_idx"
ON "sat_69b_blacklist_entries"("is_active_risk", "rfc");

CREATE INDEX IF NOT EXISTS "sat_69b_blacklist_entries_last_seen_idx"
ON "sat_69b_blacklist_entries"("last_seen_at");
