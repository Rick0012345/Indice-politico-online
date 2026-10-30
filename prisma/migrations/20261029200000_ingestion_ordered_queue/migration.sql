-- Preserve all checkpoint states; align the pending queue index with its LIMIT 1 ordering.
CREATE INDEX IF NOT EXISTS idx_ingestion_checkpoints_ordered_pending
ON ingestion_checkpoints (source, dataset, period_start, entity_id)
WHERE status IN ('pending', 'failed');
