// @vitest-environment node
import {afterEach,describe,expect,it,vi} from 'vitest';
import {CatalogEvents} from './catalogEvents';

afterEach(()=>vi.useRealTimers());
describe('invalidação compartilhada do catálogo',()=>{
  it('agrupa uma rajada sem postergar indefinidamente durante uma importação',()=>{
    vi.useFakeTimers();
    const hub=new CatalogEvents(600);
    const callback=vi.fn();const unsubscribe=hub.subscribe(callback);
    const before=hub.revision;
    for(let i=0;i<5;i++){hub.invalidate();vi.advanceTimersByTime(100);}
    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(hub.revision).not.toBe(before);
    unsubscribe();hub.invalidate();vi.advanceTimersByTime(600);
    expect(callback).toHaveBeenCalledTimes(1);hub.close();
  });
  it('um cliente defeituoso não bloqueia os demais e libera recursos ao encerrar',()=>{
    vi.useFakeTimers();const hub=new CatalogEvents(1);
    hub.subscribe(()=>{throw new Error('cliente fechado');});
    const healthy=vi.fn();hub.subscribe(healthy);
    hub.invalidate();vi.advanceTimersByTime(1);
    expect(healthy).toHaveBeenCalledOnce();
    hub.close();hub.invalidate();vi.advanceTimersByTime(10);
    expect(healthy).toHaveBeenCalledOnce();expect(hub.size).toBe(0);
  });
});
