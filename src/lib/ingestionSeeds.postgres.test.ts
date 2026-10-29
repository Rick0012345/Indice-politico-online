// @vitest-environment node
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {seedCheckpointBatch, type CheckpointSeed} from './ingestionSeeds';

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('semeadura em PostgreSQL isolado', () => {
  const schema = `seeds_test_${randomUUID().replaceAll('-', '')}`;
  let pool: Pool;
  let admin: Pool;
  const flags = {resetFailed: true, resetCancelled: true, resetEmpty: true};
  const seed = (entityId: string): CheckpointSeed => ({dataset: 'despesas', entityId, start: '2026-01-01', end: '2026-01-31'});
  beforeAll(async () => {
    admin = new Pool({connectionString: url});
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.query(`CREATE TABLE ${schema}.ingestion_checkpoints (LIKE catalogo.ingestion_checkpoints INCLUDING ALL)`);
    const connection = new URL(url!);
    connection.searchParams.set('options', `-c search_path=${schema},public`);
    pool = new Pool({connectionString: connection.toString()});
  });
  afterAll(async () => {
    await pool?.end();
    await admin?.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin?.end();
  });
  const read = async (entity: string) => (await pool.query('SELECT *, xmin::text AS version FROM ingestion_checkpoints WHERE entity_id=$1', [entity])).rows[0];
  it.each(['failed', 'cancelled', 'pending'])('reabre %s preservando cursor e itens já confirmados', async status => {
    await seedCheckpointBatch(pool, [seed(status), seed(status)], flags);
    await pool.query(`UPDATE ingestion_checkpoints SET status=$1, attempts=5, items_count=100, progress_json='{"nextPage":2}', last_error='erro', locked_at=now(), finished_at=now() WHERE entity_id=$1`, [status]);
    await seedCheckpointBatch(pool, [seed(status)], flags);
    expect(await read(status)).toMatchObject({status: 'pending', attempts: 0, items_count: 100, progress_json: {nextPage: 2}, last_error: null, locked_at: null, finished_at: null});
  });
  it('reabre concluído vazio limpando cursor', async () => {
    await seedCheckpointBatch(pool, [seed('empty')], flags);
    await pool.query(`UPDATE ingestion_checkpoints SET status='done', progress_json='{"nextPage":3}', finished_at=now() WHERE entity_id='empty'`);
    await seedCheckpointBatch(pool, [seed('empty')], flags);
    expect(await read('empty')).toMatchObject({status: 'pending', items_count: 0, progress_json: {}, finished_at: null});
  });
  it('preserva xmin para concluídos com dados e estados sem flag aplicável', async () => {
    const states = ['done', 'failed', 'cancelled', 'pending', 'running'];
    for (const status of states) {
      const entity = `noop-${status}`;
      await seedCheckpointBatch(pool, [seed(entity)], flags);
      await pool.query(`UPDATE ingestion_checkpoints SET status=$1, attempts=5, items_count=42 WHERE entity_id=$2`, [status, entity]);
      const before = await read(entity);
      await seedCheckpointBatch(pool, [seed(entity)], {resetFailed: false, resetCancelled: false, resetEmpty: false});
      expect(await read(entity)).toEqual(before);
      if (status === 'done' || status === 'running') {
        await seedCheckpointBatch(pool, [seed(entity)], flags);
        expect(await read(entity)).toEqual(before);
      }
    }
  });
});
