-- CreateIndex
CREATE UNIQUE INDEX "download_logs_routine_id_scheduled_for_key" ON "download_logs"("routine_id", "scheduled_for");
