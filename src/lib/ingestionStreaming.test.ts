// @vitest-environment node
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const db = vi.hoisted(() => ({query: vi.fn(), sessionQuery: vi.fn(), release: vi.fn(), connect: vi.fn(), end: vi.fn()}));
vi.mock('pg', () => ({Pool: class {
  query = db.query; connect = db.connect; end = db.end;
}}));

const originalArgv = process.argv;
let activeRun: Promise<void> | undefined;
beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks();
  process.exitCode = 0;
  db.end.mockResolvedValue(undefined);
  db.sessionQuery.mockResolvedValue({rows: [{acquired: true}]});
  db.connect.mockResolvedValue({query: db.sessionQuery, release: db.release});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(async () => {
  await activeRun;
  activeRun = undefined;
  process.argv = originalArgv;
  process.exitCode = 0;
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
});

function configureCheckpoint(dataset: string, intercept?: (sql: string, params: unknown[]) => Promise<void>) {
  process.argv = ['node', 'ingest-agent.ts', `--datasets=${dataset}`, '--concurrency=1', '--min-delay-ms=1', '--max-attempts=1'];
  let claimed = false;
  db.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('SELECT status FROM ingestion_checkpoints')) return {rows: [{status: 'running'}]};
    if (sql.includes('RETURNING id, entity_id')) {
      if (claimed) return {rows: [], rowCount: 0};
      claimed = true;
      return {rows: [{id: 'cp', entity_id: 'all', period_start: '2016-01-01', period_end: '2020-12-31', progress_json: {}}], rowCount: 1};
    }
    await intercept?.(sql, params);
    return {rows: [], rowCount: 1};
  });
}

const response = (dados: unknown, links: unknown[] = []) => ({ok: true, status: 200, json: async () => ({dados, links})}) as Response;
const completions = () => db.query.mock.calls.filter(([sql]) => sql.includes('SET status = $2::varchar')).map(([, params]) => params);

describe('CLI de ingestão: streaming e preservação de detalhes', () => {
  it('aguarda a persistência da primeira página antes de buscar a segunda e finaliza done', async () => {
    let releaseInsert!: () => void;
    const insertBlocked = new Promise<void>((resolve) => {releaseInsert = resolve;});
    const events: string[] = [];
    configureCheckpoint('legislaturas', async (sql, params) => {
      if (sql.includes('INSERT INTO camara_legislaturas')) {
        events.push(`insert:${params[0]}`);
        if (params[0] === 57) await insertBlocked;
      }
    });
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = new URL(String(input));
      const page = url.searchParams.get('pagina');
      if (!url.pathname.endsWith('/legislaturas') || !['1', '2'].includes(page ?? '')) {
        throw new Error(`HTTP inesperado: ${url.pathname} página ${page}`);
      }
      events.push(`http:${page}`);
      return page === '1' ? response([{id: 57}], [{rel: 'next', href: '?pagina=2'}]) : response([{id: 58}]);
    });
    activeRun = (await import('../ingest-agent')).ingestionRun;
    try {
      await vi.waitFor(() => expect(events).toContain('insert:57'));
      expect(events).toEqual(['http:1', 'insert:57']);
      expect(completions()).toEqual([]);
    } finally {
      releaseInsert();
      await activeRun;
    }
    expect(events).toEqual(['http:1', 'insert:57', 'http:2', 'insert:58']);
    expect(completions()).toEqual([['cp', 'done', 2, null]]);
    expect(db.end).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(0);
  });

  it.each([404, 401])('partidos: detalhe HTTP %i mantém o contrato de fallback e falha', async (status) => {
    configureCheckpoint('partidos');
    const summary = {id: 42, sigla: 'ABC', nome: 'Resumo recebido'};
    vi.mocked(fetch).mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/partidos')) return response([summary]);
      if (path.endsWith('/partidos/42')) return {ok: false, status} as Response;
      throw new Error(`HTTP inesperado: ${path}`);
    });
    activeRun = (await import('../ingest-agent')).ingestionRun;
    await activeRun;
    const inserts = db.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO camara_partidos'));
    const rawInserts = db.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO camara_api_raw_items'));
    if (status === 404) {
      expect(inserts).toHaveLength(1);
      expect(inserts[0][1].slice(0, 3)).toEqual([42, 'ABC', 'Resumo recebido']);
      expect(JSON.parse(inserts[0][1][9])).toEqual(summary);
      expect(rawInserts).toHaveLength(1);
      expect(completions()).toEqual([['cp', 'done', 1, null]]);
    } else {
      expect(inserts).toEqual([]);
      expect(rawInserts).toEqual([]);
      expect(completions()).toEqual([['cp', 'failed', 0, expect.stringContaining('401')]]);
    }
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(db.end).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(status === 404 ? 0 : 1);
  });
});
