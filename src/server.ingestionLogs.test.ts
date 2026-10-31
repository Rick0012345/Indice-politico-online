// @vitest-environment node
import {afterEach, expect, it, vi} from 'vitest';
import {app, pool, parseIngestionLogStats} from './server';
import {loadIngestionExecution} from './lib/ingestionLifecycle';
import {readLogTail} from './lib/logTail';
import {readdir} from 'node:fs/promises';

vi.mock('node:fs/promises', async importOriginal => ({...await importOriginal<typeof import('node:fs/promises')>(),
  readdir: vi.fn(async () => ['ingest-history.log']),
  stat: vi.fn(async () => ({mtimeMs:1})),
}));
vi.mock('./lib/logTail', () => ({readLogTail:vi.fn()}));
vi.mock('./lib/ingestionLifecycle', async importOriginal => ({...await importOriginal<typeof import('./lib/ingestionLifecycle')>(), loadIngestionExecution:vi.fn()}));
afterEach(() => vi.restoreAllMocks());

it.each([
  [false, false, 0, true],
  [false, true, 0, true],
  [true, true, 1, true],
  [true, true, 0, false],
])('logs só apresentam coleta ativa com processo e checkpoint correspondentes (processo=%s manutenção=%s ativos=%s correspondência=%s)', async (processActive, maintenanceActive, expected, matchingCheckpoint) => {
  const execution = {processActive, maintenanceActive};
  vi.mocked(loadIngestionExecution).mockResolvedValue(execution);
  const event = {stage:'checkpoint_start', dataset:'deputados', periodStart:'2020-01-01', periodEnd:'2020-01-31', timestamp:new Date().toISOString()};
  const ai = {stage:'vote_ai_start', source:'ai', resourceId:1, timestamp:new Date().toISOString()};
  vi.mocked(readLogTail).mockImplementation(async path => ({content:`[event] ${JSON.stringify(String(path).includes('activity-events') ? ai : event)}`, truncated:false}));
  vi.spyOn(pool, 'query').mockImplementation(async () => ({rows:[{...event, dataset:matchingCheckpoint ? 'deputados' : 'votacoes'}]}) as never);
  const route = app._router.stack.find((layer: {route?: {path:string}}) => layer.route?.path === '/api/admin/ingestion/logs').route;
  const response = {status:vi.fn().mockReturnThis(), json:vi.fn()};
  await route.stack[0].handle({}, response);
  expect(response.status).toHaveBeenCalledWith(200);
  const body = response.json.mock.calls[0][0];
  expect(body.execution).toEqual(execution);
  expect(body.events.some((item: {dataset:string}) => item.dataset === 'deputados')).toBe(true);
  expect(body.currentStatus.filter((item: {source:string}) => item.source === 'ingestion')).toHaveLength(expected);
  expect(body.currentStatus.filter((item: {source:string}) => item.source === 'ai')).toHaveLength(1);
});

it('informa execução mesmo sem arquivo de ingestão e preserva a atividade de IA', async () => {
  const execution = {processActive:false, maintenanceActive:true};
  vi.mocked(loadIngestionExecution).mockResolvedValue(execution);
  vi.mocked(readdir).mockResolvedValueOnce([]);
  vi.mocked(readLogTail).mockResolvedValue({content:`[event] ${JSON.stringify({stage:'vote_ai_start', resourceId:1, timestamp:new Date().toISOString()})}`, truncated:false});
  const query = vi.spyOn(pool, 'query');
  const route = app._router.stack.find((layer: {route?: {path:string}}) => layer.route?.path === '/api/admin/ingestion/logs').route;
  const response = {status:vi.fn().mockReturnThis(), json:vi.fn()};
  await route.stack[0].handle({}, response);
  expect(response.status).toHaveBeenCalledWith(200);
  expect(response.json.mock.calls[0][0]).toMatchObject({file:null, execution, currentStatus:[{source:'ai'}]});
  expect(query).not.toHaveBeenCalled();
});

it('retira do progresso atual as janelas concluídas ou com falha', () => {
  const data = parseIngestionLogStats([
    '[progress] votacoes 2020-01-01..2020-01-31: 1/2 sessoes, 100 registros',
    '[progress] proposicoes 2020-02-01..2020-02-29: 1/2 proposicoes, 15 registros',
    '[ok-items] votacoes  2020-01-01..2020-01-31: 100',
    '[retry] proposicoes  2020-02-01..2020-02-29: falhou',
  ].join('\n'));
  expect(data.progressItems).toBe(0);
  expect(data.okItems).toBe(1);
  expect(data.retries).toBe(1);
});

it('mantém apenas a última quantidade da janela que continua em andamento', () => {
  expect(parseIngestionLogStats([
    '[progress] votacoes 2020-01-01..2020-01-31: 1/2 sessoes, 100 registros',
    '[progress] votacoes 2020-01-01..2020-01-31: 2/2 sessoes, 200 registros',
    '[progress] proposicoes 2020-02-01..2020-02-29: 1/2 proposicoes, 15 registros',
    '[ok-zero] proposicoes  2020-02-01..2020-02-29: 0',
  ].join('\n')).progressItems).toBe(200);
});
