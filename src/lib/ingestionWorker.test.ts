// @vitest-environment node
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const db = vi.hoisted(() => ({query: vi.fn(), sessionQuery: vi.fn(), release: vi.fn(), connect: vi.fn(), end: vi.fn()}));
vi.mock('pg', () => ({Pool: class {
  query = db.query; connect = db.connect; end = db.end;
}}));

const argv = process.argv;
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  process.exitCode = 0;
  db.end.mockResolvedValue(undefined);
  db.sessionQuery.mockResolvedValue({rows:[{acquired:true}]});
  db.connect.mockResolvedValue({query:db.sessionQuery,release:db.release});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {process.argv = argv; process.exitCode = 0; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();});

describe('CLI real com dependências isoladas', () => {
  it('enriquecedor respeita desativação salva mesmo com chave no ambiente', async () => {
    vi.stubEnv('GROQ_API_KEY', 'chave-sintetica');
    db.query.mockResolvedValue({rows:[{key:'groq_enabled',value:'false'}]});
    await import('../enrich-vote-ai');
    await vi.waitFor(() => expect(db.end).toHaveBeenCalled());
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
  it('enriquecedor usa o modelo salvo para selecionar o trabalho', async () => {
    vi.stubEnv('GROQ_API_KEY', 'chave-sintetica');
    vi.stubEnv('GROQ_MODEL', 'modelo-ambiente');
    db.query.mockImplementation(async (sql: string) => ({rows:sql.includes('app_settings') ? [{key:'groq_model',value:'modelo-salvo'}] : []}));
    await import('../enrich-vote-ai');
    await vi.waitFor(() => expect(db.end).toHaveBeenCalled());
    expect(db.query.mock.calls[1][1][0]).toBe('modelo-salvo');
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
  it('dry-run retorna antes de liberar checkpoints stale, consultar ou escrever banco', async () => {
    process.argv = ['node', 'ingest-agent.ts', '--dry-run'];
    await import('../ingest-agent');
    await vi.waitFor(() => expect(db.end).toHaveBeenCalled());
    expect(db.query).not.toHaveBeenCalled(); expect(db.connect).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('cancelamento antes do HTTP impede fetch, dados e finalização done/failed', async () => {
    process.argv = ['node', 'ingest-agent.ts', '--datasets=legislaturas', '--concurrency=1'];
    let checks = 0;
    db.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT status FROM ingestion_checkpoints')) return {rows:[{status: ++checks === 1 ? 'running' : 'cancelled'}]};
      if (sql.includes('RETURNING id, entity_id')) return {rows:[{id:'cp',entity_id:'all',period_start:'2016-01-01',period_end:'2020-12-31'}]};
      return {rows:[],rowCount:0};
    });
    await import('../ingest-agent');
    await vi.waitFor(() => expect(db.end).toHaveBeenCalled());
    expect(fetch).not.toHaveBeenCalled();
    expect(db.query.mock.calls.some(([sql]) => sql.includes('SET status = $2::varchar'))).toBe(false);
    expect(db.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO camara_legislaturas'))).toBe(false);
    expect(db.sessionQuery).toHaveBeenLastCalledWith('SELECT pg_advisory_unlock($1)', [7710042]);
    expect(process.exitCode).toBe(0);
  });
  it('cancelamento durante HTTP descarta a resposta antes de persistir', async () => {
    process.argv = ['node', 'ingest-agent.ts', '--datasets=legislaturas', '--concurrency=1'];
    let checks = 0;
    db.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT status FROM ingestion_checkpoints')) return {rows:[{status: ++checks <= 2 ? 'running' : 'cancelled'}]};
      if (sql.includes('RETURNING id, entity_id')) return {rows:[{id:'cp',entity_id:'all',period_start:'2016-01-01',period_end:'2020-12-31'}]};
      return {rows:[],rowCount:0};
    });
    vi.mocked(fetch).mockResolvedValue({ok:true,status:200,json:async () => ({dados:[{id:57}]})} as Response);
    await import('../ingest-agent');
    await vi.waitFor(() => expect(db.end).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO camara_legislaturas'))).toBe(false);
    expect(db.query.mock.calls.some(([sql]) => sql.includes('SET status = $2::varchar'))).toBe(false);
    expect(process.exitCode).toBe(0);
  });
  it('cancelamento com transação aberta faz rollback e drena tarefa irmã antes de liberar lock', async () => {
    process.argv = ['node', 'ingest-agent.ts', '--datasets=votacoes', '--concurrency=1', '--from=2026-01-01', '--to=2026-01-31'];
    const events: string[] = [];
    let cancelled = false;
    let siblingStarted!: () => void;
    let releaseSibling!: (response: Response) => void;
    const siblingHasStarted = new Promise<void>((resolve) => { siblingStarted = resolve; });
    const siblingResponse = new Promise<Response>((resolve) => { releaseSibling = resolve; });
    const response = (dados: unknown) => ({ok:true,status:200,json:async () => ({dados})}) as Response;
    db.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT status FROM ingestion_checkpoints')) return {rows:[{status:cancelled ? 'cancelled' : 'running'}]};
      if (sql.includes('RETURNING id, entity_id')) return {rows:[{id:'cp',entity_id:'all',period_start:'2026-01-01',period_end:'2026-01-31'}]};
      return {rows:[],rowCount:0};
    });
    const transactionQuery = vi.fn(async (sql: string) => {
      if (sql === 'BEGIN') {events.push('begin'); await siblingHasStarted; cancelled = true;}
      if (sql === 'ROLLBACK') events.push('rollback');
      if (sql.includes('SELECT status FROM ingestion_checkpoints')) return {rows:[{status:cancelled ? 'cancelled' : 'running'}]};
      return {rows:[],rowCount:0};
    });
    db.connect.mockResolvedValueOnce({query:db.sessionQuery,release:db.release})
      .mockResolvedValue({query:transactionQuery,release:vi.fn()});
    db.sessionQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('pg_advisory_unlock')) events.push('unlock');
      return {rows:[{acquired:true}]};
    });
    db.end.mockImplementation(async () => {events.push('end');});
    vi.mocked(fetch).mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith('/votacoes')) return response([{id:'v1'},{id:'v2'}]);
      if (path.endsWith('/votacoes/v1')) return response({id:'v1'});
      if (path.endsWith('/votacoes/v2')) {events.push('sibling-start'); siblingStarted(); return siblingResponse;}
      throw new Error(`Chamada inesperada no teste: ${path}`);
    });
    await import('../ingest-agent');
    try {
      await vi.waitFor(() => expect(events).toContain('rollback'), {timeout:5000});
      expect(events).toContain('begin'); expect(events).toContain('sibling-start');
      expect(events).not.toContain('unlock'); expect(db.end).not.toHaveBeenCalled();
      expect(transactionQuery.mock.calls.some(([sql]) => sql === 'COMMIT' || sql.startsWith('DELETE FROM'))).toBe(false);
    } finally {
      events.push('sibling-response'); releaseSibling(response({id:'v2'}));
      await vi.waitFor(() => expect(db.end).toHaveBeenCalled(), {timeout:5000});
    }
    expect(events.indexOf('rollback')).toBeLessThan(events.indexOf('sibling-response'));
    expect(events.indexOf('sibling-response')).toBeLessThan(events.indexOf('unlock'));
    expect(events.indexOf('unlock')).toBeLessThan(events.indexOf('end'));
    expect(db.query.mock.calls.some(([sql]) => sql.includes('SET status = $2::varchar'))).toBe(false);
    expect(process.exitCode).toBe(0);
  }, 10000);
});
