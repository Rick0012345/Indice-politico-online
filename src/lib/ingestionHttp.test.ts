// @vitest-environment node
import {afterEach, expect, it, vi} from 'vitest';
vi.mock('pg', () => ({Pool: class {end = async () => {};}}));
vi.mock('node:timers/promises', () => ({setTimeout: (ms: number) => new Promise(resolve => setTimeout(resolve, ms))}));
const argv = process.argv;
afterEach(() => {process.argv = argv; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();});

it('uma requisição aguardando cooldown não consome seu timeout HTTP antes de obter o slot', async () => {
  vi.resetModules(); vi.useFakeTimers();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  process.argv = ['node', 'ingest-agent.ts', '--dry-run'];
  const worker = await import('../ingest-agent');
  await worker.ingestionRun;
  let limited = false;
  const seen: Array<{url: string; aborted: boolean}> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
    seen.push({url, aborted: Boolean(options.signal?.aborted)});
    if (!limited) {limited = true; return {ok: false, status: 429, headers: new Headers({'retry-after': '60'})};}
    return {ok: true, status: 200, json: async () => ({ok: true})};
  }));
  const first = worker.fetchJson('https://example.invalid/first');
  await vi.advanceTimersByTimeAsync(0);
  const second = worker.fetchJson('https://example.invalid/second');
  await vi.advanceTimersByTimeAsync(60000);
  await vi.advanceTimersByTimeAsync(2000);
  await Promise.all([first, second]);
  expect(seen).toHaveLength(3);
  expect(seen.every(call => !call.aborted)).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
