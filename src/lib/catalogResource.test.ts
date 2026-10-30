import {afterEach, describe, expect, it, vi} from 'vitest';
import {clearCatalogResources, fetchCatalogJson, setCatalogRevision} from './catalogResource';

afterEach(() => {clearCatalogResources(); vi.unstubAllGlobals(); vi.useRealTimers();});
const response = (data: unknown) => ({ok: true, json: async () => data}) as Response;
describe('recursos compartilhados do catálogo', () => {
  it('compartilha URLs equivalentes e permite cancelar somente um consumidor', async () => {
    let finish!: (value: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>(resolve => {finish = resolve;}));
    vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController();
    const first = fetchCatalogJson('/api/politicos/ranking?status=ativo&view=cards', {signal: controller.signal});
    const second = fetchCatalogJson('/api/politicos/ranking?view=cards&status=ativo');
    const rejected = expect(first).rejects.toMatchObject({name: 'AbortError'});
    controller.abort();
    await rejected;
    expect(fetcher.mock.calls).toHaveLength(1);
    finish(response({items: [1]}));
    expect(await second).toEqual({items: [1]});
    expect(await fetchCatalogJson('/api/politicos/ranking?view=cards&status=ativo')).toEqual({items: [1]});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('reaproveita resultado da mesma revisão inicial mas invalida após mudança', async () => {
    const fetcher = vi.fn(async () => response({revision: 'boot:1', items: [1]}));
    vi.stubGlobal('fetch', fetcher);
    await fetchCatalogJson('/api/politicos/ranking?view=cards');
    setCatalogRevision('boot:1');
    await fetchCatalogJson('/api/politicos/ranking?view=cards');
    expect(fetcher).toHaveBeenCalledTimes(1);
    setCatalogRevision('boot:2');
    fetcher.mockResolvedValue(response({revision: 'boot:2', items: [2]}));
    expect(await fetchCatalogJson('/api/politicos/ranking?view=cards')).toMatchObject({items: [2]});
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('não guarda uma resposta antiga que terminou depois da invalidação', async () => {
    setCatalogRevision('boot:1');
    let finish!: (value: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>(resolve => {finish = resolve;}));
    vi.stubGlobal('fetch', fetcher);
    const first = fetchCatalogJson('/api/politicos/1');
    setCatalogRevision('boot:2');
    finish(response({nome: 'Anterior'}));
    await first;
    fetcher.mockResolvedValue(response({nome: 'Atual'}));
    expect(await fetchCatalogJson('/api/politicos/1')).toEqual({nome: 'Atual'});
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('expira cache, permite repetição após falha e força uma atualização', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => response({items: [1]}));
    vi.stubGlobal('fetch', fetcher);
    await fetchCatalogJson('/api/partidos');
    await vi.advanceTimersByTimeAsync(30_001);
    await fetchCatalogJson('/api/partidos');
    expect(fetcher).toHaveBeenCalledTimes(2);
    fetcher.mockResolvedValueOnce({ok: false, status: 503} as Response);
    await expect(fetchCatalogJson('/api/partidos', {force: true})).rejects.toThrow();
    await fetchCatalogJson('/api/partidos', {force: true});
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('encerra consulta sem consumidores e dá timeout mesmo se o transporte não responder', async () => {
    vi.useFakeTimers();
    let transportSignal!: AbortSignal;
    vi.stubGlobal('fetch', vi.fn((_input, init) => {transportSignal = init.signal; return new Promise(() => {});}));
    const controller = new AbortController();
    const request = fetchCatalogJson('/api/politicos/1', {signal: controller.signal});
    const rejected = expect(request).rejects.toMatchObject({name: 'AbortError'});
    controller.abort(); await rejected; await Promise.resolve();
    expect(transportSignal.aborted).toBe(true);
    const timeout = fetchCatalogJson('/api/politicos/2');
    const failed = expect(timeout).rejects.toMatchObject({name: 'TimeoutError'});
    await vi.advanceTimersByTimeAsync(30_000);
    await failed;
    expect(transportSignal.aborted).toBe(true);
  });
});
