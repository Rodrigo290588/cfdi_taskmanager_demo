CREATE TABLE IF NOT EXISTS "sat_validation_error_knowledge" (
  "id" TEXT NOT NULL,
  "source_system" TEXT NOT NULL,
  "raw_error_hash" TEXT NOT NULL,
  "raw_error_text" TEXT NOT NULL,
  "normalized_error_text" TEXT NOT NULL,
  "detected_code" TEXT NOT NULL DEFAULT 'N/A',
  "human_message" TEXT NOT NULL,
  "corrective_action" TEXT NOT NULL,
  "responsible" TEXT NOT NULL,
  "ai_provider" TEXT,
  "ai_model" TEXT,
  "usage_count" INTEGER NOT NULL DEFAULT 1,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sat_validation_error_knowledge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "sat_validation_error_knowledge_raw_error_hash_key"
ON "sat_validation_error_knowledge"("raw_error_hash");

CREATE INDEX IF NOT EXISTS "sat_validation_error_knowledge_source_system_idx"
ON "sat_validation_error_knowledge"("source_system");

CREATE INDEX IF NOT EXISTS "sat_validation_error_knowledge_detected_code_idx"
ON "sat_validation_error_knowledge"("detected_code");

CREATE INDEX IF NOT EXISTS "sat_validation_error_knowledge_last_seen_at_idx"
ON "sat_validation_error_knowledge"("last_seen_at");
