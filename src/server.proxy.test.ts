// @vitest-environment node
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {Server} from 'node:http';

let server: Server | undefined;
let shutdown: (() => Promise<void>) | undefined;
afterEach(async () => {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  await shutdown?.();
  server = undefined;
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function start(proxy: string) {
  vi.stubEnv('TRUST_PROXY_HOPS', proxy);
  const {app,pool,catalogEvents} = await import('./server');
  shutdown = async () => { catalogEvents.close(); await pool.end(); };
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server!.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
  return async (chain: string) => (await fetch(`${base}/api/politicos/1/avaliacoes`, {
    method: 'POST', headers: {'Content-Type':'application/json','X-Forwarded-For':chain},
    body: JSON.stringify({cpf:'invalid',nota:3}),
  })).status;
}

describe('identidade de visitantes atrás do proxy de produção', () => {
  it('isola limites entre visitantes e mantém o limite do mesmo visitante', async () => {
    const request = await start('2');
    for (let n=0;n<10;n++) expect(await request('198.51.100.1, 172.20.0.1')).toBe(400);
    expect(await request('198.51.100.1, 172.20.0.1')).toBe(429);
    expect(await request('198.51.100.2, 172.20.0.1')).toBe(400);
  });

  it('ignora endereço adicional antes dos dois proxies confiáveis', async () => {
    const request = await start('2');
    for (let n=0;n<10;n++) expect(await request('203.0.113.10, 198.51.100.1, 172.20.0.1')).toBe(400);
    expect(await request('203.0.113.20, 198.51.100.1, 172.20.0.1')).toBe(429);
  });

  it('não confia em cabeçalhos encaminhados sem configuração explícita', async () => {
    const request = await start('');
    for (let n=0;n<10;n++) expect(await request(`198.51.100.${n+1}, 172.20.0.1`)).toBe(400);
    expect(await request('203.0.113.20, 172.20.0.1')).toBe(429);
  });
});
