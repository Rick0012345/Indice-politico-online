import {randomUUID} from 'node:crypto';
import type {Express} from 'express';

/** One invalidation stream per API, shared by SSE connections and lightweight polling. */
export class CatalogEvents {
  private readonly boot = randomUUID();
  private sequence = 0;
  private listeners = new Set<(revision: string) => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  constructor(private readonly batchMs = 600) {}
  get revision() { return `${this.boot}:${this.sequence}`; }
  get size() { return this.listeners.size; }
  subscribe(callback: (revision: string) => void) {
    this.listeners.add(callback);
    return () => { this.listeners.delete(callback); };
  }
  invalidate() {
    if (this.closed || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.sequence++;
      for (const callback of this.listeners) {
        try { callback(this.revision); } catch { this.listeners.delete(callback); }
      }
    }, this.batchMs);
    this.timer.unref?.();
  }
  close() {
    this.closed = true;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.listeners.clear();
  }
}

export const attachCatalogRoutes = (app: Express, hub: CatalogEvents) => {
  app.get('/api/catalogo/revision', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({revision: hub.revision});
  });
  app.get('/api/catalogo/events', (_req, res) => {
    if (hub.size >= 500) {
      res.setHeader('Retry-After', '10');
      res.status(503).json({error: 'Limite de conexões de atualização atingido.'});
      return;
    }
    res.status(200).set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write('retry: 3000\n\n');
    const send = (revision: string) => {
      if (res.destroyed || res.writableEnded) return;
      if (!res.write(`event: catalogo\ndata: ${JSON.stringify({revision})}\n\n`)) res.end();
    };
    const unsubscribe = hub.subscribe(send);
    send(hub.revision);
    const heartbeat = setInterval(() => {
      if (!res.write(': heartbeat\n\n')) res.end();
    }, 15000);
    heartbeat.unref?.();
    res.on('close', () => { clearInterval(heartbeat); unsubscribe(); });
  });
};
