import {useEffect, useRef, useState} from 'react';

export type CatalogConnectionState = 'connecting' | 'live' | 'reconnecting' | 'paused' | 'offline';
type Subscription = {notify: () => void | Promise<void>; status: (state: CatalogConnectionState) => void; running: boolean; dirty: boolean; nextAllowed: number};
const subscriptions = new Set<Subscription>();
let source: EventSource | null = null;
let connection: CatalogConnectionState = 'connecting';
let revision: string | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let poll: ReturnType<typeof setInterval> | undefined;
let pollController: AbortController | undefined;
let opened = false;

function publish() {
  for (const subscriber of subscriptions) subscriber.status(document.hidden ? 'paused' : connection);
}
async function deliver(subscriber: Subscription) {
  if (subscriber.running || !subscriber.dirty || document.hidden || !subscriptions.has(subscriber)) return;
  if (Date.now() < subscriber.nextAllowed) { schedule(subscriber.nextAllowed - Date.now()); return; }
  subscriber.running = true;
  subscriber.nextAllowed = Date.now() + 1600;
  subscriber.dirty = false;
  try { await subscriber.notify(); } catch { /* Consumer reports its own request errors. */ }
  finally {
    subscriber.running = false;
    if (subscriber.dirty && subscriptions.has(subscriber)) schedule();
  }
}
function schedule(delay = 400) {
  if (timer || document.hidden) return;
  timer = setTimeout(() => {
    timer = undefined;
    for (const subscriber of subscriptions) void deliver(subscriber);
  }, delay);
}
function invalidate() {
  for (const subscriber of subscriptions) subscriber.dirty = true;
  schedule();
}
function visibility() {
  publish();
  if (!document.hidden) invalidate();
}
function online() { invalidate(); }
function offline() { connection = 'offline'; publish(); }
function start() {
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('online', online);
  window.addEventListener('offline', offline);
  if (typeof EventSource !== 'undefined') {
    try {
      source = new EventSource('/api/catalogo/events');
      source.addEventListener('open', () => {
        connection = 'live'; publish();
        if (opened) invalidate();
        opened = true;
      });
      source.addEventListener('error', () => { connection = navigator.onLine ? 'reconnecting' : 'offline'; publish(); });
      source.addEventListener('catalogo', (event) => {
        try {
          const value = JSON.parse((event as MessageEvent).data)?.revision;
          if (typeof value !== 'string' || value === revision) return;
          revision = value;
          // The first snapshot also closes the initial query/subscription race.
          invalidate();
        } catch { /* Ignore malformed events; the next valid snapshot reconciles. */ }
      });
    } catch { connection = 'offline'; }
  } else connection = 'offline';
  poll = setInterval(async () => {
    if (document.hidden || connection === 'live' || pollController) return;
    const controller = new AbortController(); pollController = controller;
    try {
      const response = await fetch('/api/catalogo/revision', {signal: controller.signal});
      if (!response.ok) return;
      const data = await response.json();
      if (controller.signal.aborted || typeof data.revision !== 'string') return;
      if (revision !== data.revision) { revision = data.revision; invalidate(); }
    } catch { /* Retry on the next interval. */ }
    finally { if (pollController === controller) pollController = undefined; }
  }, 30_000);
  publish();
}
function stop() {
  source?.close(); source = null;
  clearTimeout(timer); clearInterval(poll); timer = undefined; poll = undefined;
  pollController?.abort(); pollController = undefined;
  document.removeEventListener('visibilitychange', visibility);
  window.removeEventListener('online', online);
  window.removeEventListener('offline', offline);
  revision = undefined; opened = false; connection = 'connecting';
}

export function useCatalogUpdates(onUpdate: () => void | Promise<void>): CatalogConnectionState {
  const callback = useRef(onUpdate); callback.current = onUpdate;
  const [state, setState] = useState<CatalogConnectionState>('connecting');
  useEffect(() => {
    const subscriber: Subscription = {notify: () => callback.current(), status: setState, running: false, dirty: false, nextAllowed: 0};
    subscriptions.add(subscriber);
    if (subscriptions.size === 1) start();
    else setState(document.hidden ? 'paused' : connection);
    return () => { subscriptions.delete(subscriber); if (!subscriptions.size) stop(); };
  }, []);
  return state;
}

export const catalogConnectionLabels: Record<CatalogConnectionState, string> = {
  connecting: 'Conectando atualizações automáticas',
  live: 'Conexão de atualizações ativa',
  reconnecting: 'Reconectando · verificação periódica a cada 30 s',
  paused: 'Atualizações pausadas nesta aba',
  offline: 'Sem conexão contínua · verificação periódica a cada 30 s',
};
