// @vitest-environment node
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';

const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('worker de despesas com PostgreSQL real e HTTP controlado', () => {
  const schema = `pipeline_${randomUUID().replaceAll('-', '')}`;
  const database = new Pool({connectionString: databaseUrl});
  let url: string;
  const argv = process.argv;
  const expense = (codDocumento: number) => ({codDocumento, ano: 2026, mes: 1, valorDocumento: 10, valorLiquido: 10});
  const response = (dados: unknown[], next = false) => ({ok: true, status: 200, json: async () => ({dados, links: next ? [{rel: 'next'}] : []})}) as Response;
  beforeAll(async () => {
    const parsed = new URL(databaseUrl!);
    const source = parsed.searchParams.get('schema') ?? 'public';
    const identifier = '"' + source.replaceAll('"', '""') + '"';
    await database.query(`CREATE SCHEMA ${schema}`);
    for (const table of ['politicos', 'despesas', 'camara_api_raw_items', 'ingestion_checkpoints']) {
      await database.query(`CREATE TABLE ${schema}.${table} (LIKE ${identifier}.${table} INCLUDING ALL)`);
    }
    parsed.searchParams.set('options', `-c search_path=${schema},public`);
    url = parsed.toString();
  });
  beforeEach(async () => {
    await database.query(`TRUNCATE ${schema}.despesas, ${schema}.camara_api_raw_items, ${schema}.ingestion_checkpoints, ${schema}.politicos`);
    await database.query(`INSERT INTO ${schema}.politicos (id,nome,sigla_partido,sigla_uf,id_legislatura) VALUES (900001,'Pessoa sintética','TST','SP',57)`);
    vi.stubEnv('DATABASE_URL', url);
    vi.stubGlobal('fetch', vi.fn());
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    process.exitCode = 0;
  });
  afterEach(() => {process.argv = argv; process.exitCode = 0; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();});
  afterAll(async () => {await database.query(`DROP SCHEMA ${schema} CASCADE`); await database.end();});
  const run = async () => {
    vi.resetModules();
    process.argv = ['node', 'ingest-agent.ts', '--datasets=despesas', '--from=2026-01-01', '--to=2026-01-31', '--concurrency=1', '--max-attempts=1', '--min-delay-ms=1', '--reset-failed'];
    const worker = await import('../ingest-agent');
    await worker.ingestionRun;
  };

  it('falha na página 2 preserva a página 1 e retoma sem buscá-la ou duplicá-la', async () => {
    vi.mocked(fetch).mockImplementation(async input => new URL(String(input)).searchParams.get('pagina') === '1'
      ? response(Array.from({length: 100}, (_, i) => expense(i + 1)), true)
      : response([{...expense(101), dataDocumento: 'data-invalida'}]));
    await run();
    const first = (await database.query(`SELECT status,items_count,progress_json FROM ${schema}.ingestion_checkpoints`)).rows[0];
    expect(first).toMatchObject({status: 'failed', items_count: 100, progress_json: {nextPage: 2, itemsCount: 100, finished: false}});
    expect((await database.query(`SELECT count(*)::int AS total FROM ${schema}.despesas`)).rows[0].total).toBe(100);
    vi.mocked(fetch).mockClear().mockResolvedValue(response([expense(101)]));
    await run();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(new URL(String(vi.mocked(fetch).mock.calls[0][0])).searchParams.get('pagina')).toBe('2');
    expect((await database.query(`SELECT status,items_count FROM ${schema}.ingestion_checkpoints`)).rows[0]).toEqual({status: 'done', items_count: 101});
    expect((await database.query(`SELECT count(*)::int AS total FROM ${schema}.despesas`)).rows[0].total).toBe(101);
    expect((await database.query(`SELECT count(*)::int AS total FROM ${schema}.camara_api_raw_items`)).rows[0].total).toBe(101);
  }, 20000);

  it('erro no arquivo raw desfaz despesas e cursor da mesma página', async () => {
    await database.query(`CREATE FUNCTION ${schema}.reject_raw() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'raw indisponível'; END $$;
      CREATE TRIGGER reject_raw BEFORE INSERT ON ${schema}.camara_api_raw_items FOR EACH ROW EXECUTE FUNCTION ${schema}.reject_raw()`);
    try {
      vi.mocked(fetch).mockResolvedValue(response([expense(201), expense(202)]));
      await run();
      expect((await database.query(`SELECT status,items_count,progress_json FROM ${schema}.ingestion_checkpoints`)).rows[0]).toEqual({status: 'failed', items_count: 0, progress_json: {}});
      expect((await database.query(`SELECT count(*)::int AS total FROM ${schema}.despesas`)).rows[0].total).toBe(0);
    } finally {await database.query(`DROP TRIGGER reject_raw ON ${schema}.camara_api_raw_items; DROP FUNCTION ${schema}.reject_raw()`);}
  }, 20000);

  it('cursor final confirmado conclui uma retomada sem repetir HTTP ou dados', async () => {
    await database.query(`INSERT INTO ${schema}.ingestion_checkpoints
      (source,dataset,entity_id,period_start,period_end,status,items_count,progress_json)
      VALUES ('camara','despesas','900001','2026-01-01','2026-01-31','failed',100,$1::jsonb)`,
      [JSON.stringify({version: 1, resource: '/deputados/900001/despesas', params: {ano: 2026, mes: 1}, nextPage: 2, itemsCount: 100, finished: true})]);
    await run();
    expect(fetch).not.toHaveBeenCalled();
    expect((await database.query(`SELECT status,items_count FROM ${schema}.ingestion_checkpoints`)).rows[0]).toEqual({status: 'done', items_count: 100});
  }, 20000);

  it('cancelamento confirmado durante HTTP impede gravação e avanço da página', async () => {
    vi.mocked(fetch).mockImplementation(async () => {
      await database.query(`UPDATE ${schema}.ingestion_checkpoints SET status='cancelled' WHERE status='running'`);
      return response([expense(301)]);
    });
    await run();
    expect((await database.query(`SELECT status,items_count,progress_json FROM ${schema}.ingestion_checkpoints`)).rows[0]).toEqual({status: 'cancelled', items_count: 0, progress_json: {}});
    expect((await database.query(`SELECT count(*)::int AS total FROM ${schema}.despesas`)).rows[0].total).toBe(0);
  }, 20000);
});
