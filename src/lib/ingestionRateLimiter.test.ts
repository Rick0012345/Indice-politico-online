// @vitest-environment node
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createHttpRateLimiter} from './ingestionRateLimiter';

beforeEach(() => {vi.useFakeTimers(); vi.setSystemTime(0);});
afterEach(() => vi.useRealTimers());
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve,ms));
const limiter = () => createHttpRateLimiter({intervalMs:1000,now:Date.now,sleep});

describe('limite HTTP compartilhado da ingestão', () => {
  it('reserva slots serializados com intervalo estável para chamadas concorrentes', async () => {
    const rate = limiter();
    const starts: number[] = [];
    const requests = Array.from({length:3},() => rate.waitForSlot().then(() => {starts.push(Date.now());}));
    await vi.advanceTimersByTimeAsync(0);
    expect(starts).toEqual([0]);
    await vi.advanceTimersByTimeAsync(999);
    expect(starts).toEqual([0]);
    await vi.advanceTimersByTimeAsync(1001);
    await Promise.all(requests);
    expect(starts).toEqual([0,1000,2000]);
  });

  it('reavalia cooldown de 429 recebido enquanto outra chamada já aguarda o slot', async () => {
    const rate = limiter();
    await rate.waitForSlot();
    const starts: number[] = [];
    const second = rate.waitForSlot().then(() => {starts.push(Date.now());});
    await vi.advanceTimersByTimeAsync(100);
    rate.cooldown(60000);
    const third = rate.waitForSlot().then(() => {starts.push(Date.now());});
    await vi.advanceTimersByTimeAsync(59999);
    expect(starts).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await second;
    expect(starts).toEqual([60100]);
    await vi.advanceTimersByTimeAsync(1000);
    await third;
    expect(starts).toEqual([60100,61100]);
  });

  it('cooldowns de respostas paralelas nunca encurtam o prazo compartilhado', async () => {
    const rate = limiter();
    await rate.waitForSlot();
    rate.cooldown(60000);
    const starts: number[] = [];
    const pending = rate.waitForSlot().then(() => {starts.push(Date.now());});
    await vi.advanceTimersByTimeAsync(1000);
    rate.cooldown(1000);
    await vi.advanceTimersByTimeAsync(58999);
    expect(starts).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(starts).toEqual([60000]);
  });

  it('reavalia também um cooldown prorrogado durante a espera do anterior', async () => {
    const rate = limiter();
    rate.cooldown(10000);
    let started = false;
    const pending = rate.waitForSlot().then(() => {started = true;});
    await vi.advanceTimersByTimeAsync(5000);
    rate.cooldown(20000);
    await vi.advanceTimersByTimeAsync(19999);
    expect(started).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(started).toBe(true);
  });

  it('uma falha na espera rejeita a chamada sem envenenar as próximas da fila', async () => {
    const wait = vi.fn(sleep).mockRejectedValueOnce(new Error('espera falhou'));
    const rate = createHttpRateLimiter({intervalMs:1000,now:Date.now,sleep:wait});
    await rate.waitForSlot();
    await expect(rate.waitForSlot()).rejects.toThrow('espera falhou');
    let started = false;
    const next = rate.waitForSlot().then(() => {started = true;});
    await vi.advanceTimersByTimeAsync(999);
    expect(started).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await next;
    expect(started).toBe(true);
  });

  it.each([NaN,Infinity,-Infinity,-1])('rejeita cooldown inválido %s sem alterar a fila', async ms => {
    const rate = limiter();
    expect(() => rate.cooldown(ms)).toThrow(RangeError);
    await rate.waitForSlot();
    rate.cooldown(0);
  });

  it.each([NaN,Infinity,0,-1])('rejeita intervalo inválido %s', intervalMs => {
    expect(() => createHttpRateLimiter({intervalMs})).toThrow(RangeError);
  });
});
