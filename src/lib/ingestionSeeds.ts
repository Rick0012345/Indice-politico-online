import type {Pool} from 'pg';

export type CheckpointSeed = {dataset: string; entityId: string; start: string; end: string};
export async function seedCheckpointBatch(
  db: Pick<Pool, 'query'>,
  seeds: CheckpointSeed[],
  options: {resetFailed: boolean; resetCancelled: boolean; resetEmpty: boolean},
): Promise<void> {
  if (!seeds.length) return;
  const unique = new Map(seeds.map(seed => [JSON.stringify([seed.dataset, seed.entityId, seed.start, seed.end]), seed]));
  await db.query(`
    INSERT INTO ingestion_checkpoints (source, dataset, entity_id, period_start, period_end)
    SELECT 'camara', seed.dataset, seed."entityId", seed.start::date, seed."end"::date
    FROM jsonb_to_recordset($1::jsonb) AS seed(dataset text, "entityId" text, start text, "end" text)
    ON CONFLICT (source, dataset, entity_id, period_start, period_end)
    DO UPDATE SET
      status = 'pending',
      attempts = 0,
      last_error = NULL,
      locked_at = NULL,
      finished_at = NULL,
      progress_json = CASE WHEN ingestion_checkpoints.status = 'done' THEN '{}'::jsonb ELSE ingestion_checkpoints.progress_json END,
      items_count = CASE WHEN ingestion_checkpoints.status = 'done' THEN 0 ELSE ingestion_checkpoints.items_count END,
      updated_at = CURRENT_TIMESTAMP
    WHERE ($2::boolean AND (ingestion_checkpoints.status = 'failed'
        OR (ingestion_checkpoints.status = 'pending' AND ingestion_checkpoints.attempts >= 5)))
      OR ($3::boolean AND ingestion_checkpoints.status = 'cancelled')
      OR ($4::boolean AND ingestion_checkpoints.status = 'done' AND ingestion_checkpoints.items_count = 0)
  `, [JSON.stringify([...unique.values()]), options.resetFailed, options.resetCancelled, options.resetEmpty]);
}
