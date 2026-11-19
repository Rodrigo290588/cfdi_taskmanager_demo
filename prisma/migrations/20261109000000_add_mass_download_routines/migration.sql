-- CreateEnum
CREATE TYPE "RoutineRequestType" AS ENUM ('CFDI', 'METADATA');

-- CreateEnum
CREATE TYPE "RoutineRetrievalType" AS ENUM ('EMITIDOS', 'RECIBIDOS');

-- CreateEnum
CREATE TYPE "RoutinePeriodPreset" AS ENUM ('CURRENT_DAY', 'PREVIOUS_DAY', 'CURRENT_WEEK', 'PREVIOUS_WEEK', 'LAST_SEVEN_DAYS', 'CURRENT_MONTH', 'PREVIOUS_MONTH', 'CUSTOM');

-- CreateEnum
CREATE TYPE "RoutineScheduleFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "RoutineStatus" AS ENUM ('ACTIVE', 'PAUSED', 'DELETED');

-- CreateEnum
CREATE TYPE "DownloadLogStatus" AS ENUM ('SCHEDULED', 'QUEUED', 'REQUESTING', 'VERIFYING', 'DOWNLOADING', 'PROCESSING', 'COMPLETED', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "download_routines" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "requesting_rfc" TEXT NOT NULL,
    "request_type" "RoutineRequestType" NOT NULL,
    "retrieval_type" "RoutineRetrievalType" NOT NULL,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "period_preset" "RoutinePeriodPreset" NOT NULL,
    "custom_start_date" TIMESTAMP(3),
    "custom_end_date" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'America/Mexico_City',
    "schedule_frequency" "RoutineScheduleFrequency" NOT NULL,
    "scheduled_hour" INTEGER NOT NULL,
    "scheduled_minute" INTEGER NOT NULL DEFAULT 0,
    "week_days" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
    "month_days" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
    "status" "RoutineStatus" NOT NULL DEFAULT 'ACTIVE',
    "storage_options" JSONB NOT NULL DEFAULT '{}',
    "next_run_at" TIMESTAMP(3),
    "last_run_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "download_routines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "download_logs" (
    "id" TEXT NOT NULL,
    "routine_id" TEXT,
    "organization_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "mass_download_request_id" TEXT,
    "correlation_id" TEXT NOT NULL,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "effective_start_date" TIMESTAMP(3),
    "effective_end_date" TIMESTAMP(3),
    "status" "DownloadLogStatus" NOT NULL DEFAULT 'SCHEDULED',
    "sat_request_id" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "packages_found" INTEGER NOT NULL DEFAULT 0,
    "retry_attempt" INTEGER NOT NULL DEFAULT 0,
    "error_code" TEXT,
    "error_message" TEXT,
    "error_details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "download_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "download_log_events" (
    "id" TEXT NOT NULL,
    "download_log_id" TEXT NOT NULL,
    "event_name" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "details" JSONB,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "download_log_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "download_routines_organization_id_company_id_status_idx" ON "download_routines"("organization_id", "company_id", "status");

-- CreateIndex
CREATE INDEX "download_routines_status_next_run_at_idx" ON "download_routines"("status", "next_run_at");

-- CreateIndex
CREATE UNIQUE INDEX "download_logs_mass_download_request_id_key" ON "download_logs"("mass_download_request_id");

-- CreateIndex
CREATE INDEX "download_logs_organization_id_company_id_scheduled_for_idx" ON "download_logs"("organization_id", "company_id", "scheduled_for");

-- CreateIndex
CREATE INDEX "download_logs_routine_id_scheduled_for_idx" ON "download_logs"("routine_id", "scheduled_for");

-- CreateIndex
CREATE INDEX "download_logs_status_scheduled_for_idx" ON "download_logs"("status", "scheduled_for");

-- CreateIndex
CREATE INDEX "download_logs_correlation_id_idx" ON "download_logs"("correlation_id");

-- CreateIndex
CREATE INDEX "download_log_events_download_log_id_occurred_at_idx" ON "download_log_events"("download_log_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "download_routines" ADD CONSTRAINT "download_routines_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "download_routines" ADD CONSTRAINT "download_routines_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "download_logs" ADD CONSTRAINT "download_logs_routine_id_fkey" FOREIGN KEY ("routine_id") REFERENCES "download_routines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "download_logs" ADD CONSTRAINT "download_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "download_logs" ADD CONSTRAINT "download_logs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "download_logs" ADD CONSTRAINT "download_logs_mass_download_request_id_fkey" FOREIGN KEY ("mass_download_request_id") REFERENCES "mass_download_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "download_log_events" ADD CONSTRAINT "download_log_events_download_log_id_fkey" FOREIGN KEY ("download_log_id") REFERENCES "download_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
