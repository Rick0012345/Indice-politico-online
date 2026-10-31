// @vitest-environment node
import type {Server} from 'node:http';
import {afterAll, beforeAll, beforeEach, expect, it, vi} from 'vitest';
import {app, pool} from './server';

let server: Server;
let base: string;
const previousToken = process.env.ADMIN_API_TOKEN;
const checkpoints = [{dataset: 'despesas', status: 'running', total: 2, itemsCount: 30, emptyTotal: 0}];

beforeAll(async () => {
  process.env.ADMIN_API_TOKEN = 'ingestion-summary-test-only';
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as {port: number}).port}`;
});

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(pool, 'query').mockImplementation((async (sql: string) => {
    if (sql.includes('pg_locks')) return {rows: [{maintenanceActive: true}]};
    if (sql.includes('FROM ingestion_checkpoints')) return {rows: checkpoints};
    return {rows: []};
  }) as any);
});

afterAll(async () => {
  vi.restoreAllMocks();
  if (previousToken === undefined) delete process.env.ADMIN_API_TOKEN;
  else process.env.ADMIN_API_TOKEN = previousToken;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await pool.end();
});

it('expõe a atividade separada dos checkpoints sem alterar seu estado', async () => {
  const response = await fetch(`${base}/api/admin/ingestion/summary`, {headers: {Authorization: 'Bearer ingestion-summary-test-only'}});
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({checkpoints, periods: [], execution: {processActive: false, maintenanceActive: true}});
  expect(vi.mocked(pool.query).mock.calls.map(call => String(call[0])).join('\n')).not.toMatch(/\bUPDATE\b|\bINSERT\b|\bDELETE\b|pg_try_advisory_lock/);
});

it('exige autorização antes de consultar estado operacional', async () => {
  const response = await fetch(`${base}/api/admin/ingestion/summary`);
  expect(response.status).toBe(401);
  expect(pool.query).not.toHaveBeenCalled();
});

it('não transforma uma falha de leitura em fila vazia ou agente parado', async () => {
  vi.mocked(pool.query).mockRejectedValueOnce(new Error('Banco indisponível'));
  const response = await fetch(`${base}/api/admin/ingestion/summary`, {headers: {Authorization: 'Bearer ingestion-summary-test-only'}});
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({error: 'Erro ao carregar resumo de ingestao.'});
});
