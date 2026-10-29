// @vitest-environment node
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {votePresentationAssignments} from './votePresentationPersistence';
import {acquireIngestionLock} from './ingestionLifecycle';

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('persistência de apresentação no PostgreSQL isolado', () => {
  const pool = new Pool({connectionString:url});
  const schema = `worker_test_${randomUUID().replaceAll('-', '')}`;
  beforeAll(async () => {
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await pool.query(`CREATE TABLE "${schema}".votes (id text PRIMARY KEY, titulo_publico text, resumo_leigo text, ai_model text, ai_prompt_versao text, ai_gerado_em timestamptz, ai_input_hash text)`);
  });
  afterAll(async () => {await pool.query(`DROP SCHEMA "${schema}" CASCADE`); await pool.end();});

  it('outra sessão não pode obter lock enquanto o worker estiver ativo', async () => {
    const first = await acquireIngestionLock(pool);
    expect(first).not.toBeNull();
    try {expect(await acquireIngestionLock(pool)).toBeNull();}
    finally {await first?.release();}
    const next = await acquireIngestionLock(pool);
    expect(next).not.toBeNull(); await next?.release();
  });

  for (const operation of ['reingestão', 'backfill']) {
    for (const compatible of [true, false]) {
      it(`${operation}: ${compatible ? 'preserva cópia IA e proveniência compatíveis' : 'substitui cópia e invalida proveniência ao mudar hash'}`, async () => {
        const id = randomUUID();
        await pool.query(`INSERT INTO "${schema}".votes VALUES ($1, 'Título IA', 'Resumo IA', 'modelo', 'prompt', '2026-01-01Z', 'hash-a')`, [id]);
        const hash = compatible ? 'hash-a' : 'hash-b';
        if (operation === 'reingestão') {
          await pool.query(`INSERT INTO "${schema}".votes AS current VALUES ($1, 'Título determinístico', 'Resumo determinístico', NULL, NULL, NULL, $2)
            ON CONFLICT (id) DO UPDATE SET ${votePresentationAssignments('current', 'EXCLUDED')}, ai_input_hash = EXCLUDED.ai_input_hash`, [id,hash]);
        } else {
          await pool.query(`UPDATE "${schema}".votes AS current SET ${votePresentationAssignments('current', 'item')}, ai_input_hash = item.ai_input_hash
            FROM (SELECT $1::text AS id, 'Título determinístico'::text AS titulo_publico, 'Resumo determinístico'::text AS resumo_leigo, $2::text AS ai_input_hash) item WHERE current.id = item.id`, [id,hash]);
        }
        const {rows:[row]} = await pool.query(`SELECT * FROM "${schema}".votes WHERE id = $1`, [id]);
        expect(row.titulo_publico).toBe(compatible ? 'Título IA' : 'Título determinístico');
        expect(row.resumo_leigo).toBe(compatible ? 'Resumo IA' : 'Resumo determinístico');
        expect(row.ai_model).toBe(compatible ? 'modelo' : null);
        expect(row.ai_prompt_versao).toBe(compatible ? 'prompt' : null);
        expect(row.ai_gerado_em === null).toBe(!compatible);
        expect(row.ai_input_hash).toBe(hash);
      });
    }
  }
});
