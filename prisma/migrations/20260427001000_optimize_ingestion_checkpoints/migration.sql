CREATE INDEX IF NOT EXISTS "idx_ingestion_checkpoints_running_lock"
ON "ingestion_checkpoints"("source", "status", "locked_at");

CREATE INDEX IF NOT EXISTS "idx_ingestion_checkpoints_claim_queue"
ON "ingestion_checkpoints"("source", "dataset", "status", "attempts", "period_start", "entity_id");
