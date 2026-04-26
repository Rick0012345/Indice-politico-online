CREATE TABLE IF NOT EXISTS "ingestion_checkpoints" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source" VARCHAR(50) NOT NULL,
    "dataset" VARCHAR(50) NOT NULL,
    "entity_id" TEXT NOT NULL DEFAULT '',
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "items_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "locked_at" TIMESTAMPTZ(6),
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingestion_checkpoints_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ingestion_checkpoints_unique_window"
ON "ingestion_checkpoints"("source", "dataset", "entity_id", "period_start", "period_end");

CREATE INDEX IF NOT EXISTS "idx_ingestion_checkpoints_status"
ON "ingestion_checkpoints"("status", "dataset", "period_start");

CREATE INDEX IF NOT EXISTS "idx_ingestion_checkpoints_updated_at"
ON "ingestion_checkpoints"("updated_at");
