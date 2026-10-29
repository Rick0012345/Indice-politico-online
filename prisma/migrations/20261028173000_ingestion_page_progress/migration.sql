BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE ingestion_checkpoints ADD COLUMN progress_json JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMIT;
