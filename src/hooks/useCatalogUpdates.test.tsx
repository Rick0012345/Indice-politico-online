import {act, renderHook} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {useCatalogUpdates} from './useCatalogUpdates';

class FakeEvents {
  static instances: FakeEvents[] = [];
  listeners = new Map<string, (event: any) => void>();
  close = vi.fn();
  constructor() { FakeEvents.instances.push(this); }
  addEventListener(name: string, listener: (event: any) => void) { this.listeners.set(name, listener); }
  emit(name: string, revision = '') { this.listeners.get(name)?.({data: JSON.stringify({revision})}); }
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); FakeEvents.instances = []; });
it('compartilha conexão, agrupa mudanças e limpa a última assinatura', async () => {
  vi.useFakeTimers(); vi.stubGlobal('EventSource', FakeEvents);
  const first = vi.fn(); const second = vi.fn();
  const a = renderHook(() => useCatalogUpdates(first)); const b = renderHook(() => useCatalogUpdates(second));
  expect(FakeEvents.instances).toHaveLength(1);
  const source = FakeEvents.instances[0];
  act(() => { source.emit('open'); source.emit('catalogo', 'a'); source.emit('catalogo', 'b'); source.emit('catalogo', 'c'); });
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  expect(first).toHaveBeenCalledTimes(1); expect(second).toHaveBeenCalledTimes(1);
  a.unmount(); expect(source.close).not.toHaveBeenCalled();
  b.unmount(); expect(source.close).toHaveBeenCalledTimes(1);
});
it('reconcilia ao reconectar e pausa callbacks enquanto a aba está oculta', async () => {
  vi.useFakeTimers(); vi.stubGlobal('EventSource', FakeEvents);
  let hidden = false; vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  const update = vi.fn(); const hook = renderHook(() => useCatalogUpdates(update));
  const source = FakeEvents.instances[0];
  act(() => { source.emit('open'); source.emit('catalogo', 'a'); source.emit('error'); });
  expect(hook.result.current).toBe('reconnecting');
  act(() => { hidden = true; document.dispatchEvent(new Event('visibilitychange')); source.emit('catalogo', 'b'); });
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(update).not.toHaveBeenCalled(); expect(hook.result.current).toBe('paused');
  act(() => { hidden = false; document.dispatchEvent(new Event('visibilitychange')); source.emit('open'); });
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  expect(update).toHaveBeenCalledTimes(1); hook.unmount(); vi.restoreAllMocks();
});
it('consulta apenas a revisão no fallback e reconcilia o primeiro resultado', async () => {
  vi.useFakeTimers(); vi.stubGlobal('EventSource', undefined);
  const fetcher = vi.fn(async () => ({ok:true, json:async()=>({revision:'baseline'})}));
  vi.stubGlobal('fetch', fetcher);
  const update = vi.fn(); const hook = renderHook(() => useCatalogUpdates(update));
  expect(fetcher).not.toHaveBeenCalled(); expect(hook.result.current).toBe('offline');
  await act(async () => { await vi.advanceTimersByTimeAsync(30_400); });
  expect(fetcher).toHaveBeenCalledWith('/api/catalogo/revision', expect.anything());
  expect(update).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(update).toHaveBeenCalledTimes(1); hook.unmount();
});
it('não sobrepõe callbacks e conserva invalidações recebidas durante a consulta', async () => {
  vi.useFakeTimers(); vi.stubGlobal('EventSource', FakeEvents);
  let finish!:()=>void;
  const update = vi.fn(() => new Promise<void>(resolve => {finish=resolve;}));
  const hook = renderHook(() => useCatalogUpdates(update)); const source = FakeEvents.instances[0];
  act(() => source.emit('catalogo', 'a'));
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  act(() => source.emit('catalogo', 'b'));
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  expect(update).toHaveBeenCalledTimes(1);
  await act(async () => { finish(); await vi.advanceTimersByTimeAsync(1600); });
  expect(update).toHaveBeenCalledTimes(2); hook.unmount();
});
