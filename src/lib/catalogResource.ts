type Options = {signal?: AbortSignal; force?: boolean};
type Entry = {controller: AbortController; promise: Promise<unknown>; consumers: number; settled: boolean; cached: boolean; value?: unknown; completedAt: number; revision?: string};
const resources = new Map<string, Entry>();
const MAX_ENTRIES = 100;
const MAX_AGE = 30_000;
const TIMEOUT = 30_000;
let revision: string | undefined;
let generation = 0;
export const getCatalogRevision = () => revision;
const aborted = () => new DOMException('Consulta cancelada.', 'AbortError');

function keyFor(url: string) {
  const parsed = new URL(url, 'http://catalog.local');
  if (!url.startsWith('/api/') || parsed.pathname.startsWith('/api/admin')) throw new Error('O cache aceita somente consultas públicas do catálogo.');
  parsed.searchParams.sort();
  return parsed.pathname + parsed.search;
}
function prune() {
  for (const [key, entry] of resources) if (entry.settled && (!entry.cached || Date.now() - entry.completedAt >= MAX_AGE)) resources.delete(key);
  for (const [key, entry] of resources) {
    if (resources.size <= MAX_ENTRIES) break;
    if (entry.settled) resources.delete(key);
  }
}
/** A visibility/reconnection refresh has no new revision to compare yet. */
export function invalidateCatalogResources() {
  generation++;
  for (const [key, entry] of resources) if (entry.settled) resources.delete(key);
}
export function setCatalogRevision(next: string) {
  if (revision === next) return;
  revision = next; generation++;
  for (const [key, entry] of resources) if (entry.settled && entry.revision !== next) resources.delete(key);
}
export function clearCatalogResources() {
  for (const entry of resources.values()) if (!entry.settled) entry.controller.abort();
  resources.clear(); revision = undefined; generation++;
}
function start(key: string): Entry {
  const controller = new AbortController();
  const startedGeneration = generation;
  const entry: Entry = {controller, promise: Promise.resolve(), consumers: 0, settled: false, cached: false, completedAt: 0};
  let timeout: ReturnType<typeof setTimeout>;
  let rejectAbort: () => void;
  const interrupted = new Promise<never>((_resolve, reject) => {
    rejectAbort = () => reject(controller.signal.reason ?? aborted());
    controller.signal.addEventListener('abort', rejectAbort, {once: true});
    timeout = setTimeout(() => controller.abort(new DOMException('A consulta demorou demais. Tente novamente.', 'TimeoutError')), TIMEOUT);
  });
  const transport = (async () => {
    const response = await fetch(key, {signal: controller.signal});
    if (!response.ok) throw new Error(`Não foi possível carregar os dados (HTTP ${response.status}).`);
    return response.json();
  })();
  entry.promise = Promise.race([transport, interrupted]).then(value => {
    entry.value = value;
    entry.revision = value && typeof value.revision === 'string' ? value.revision : undefined;
    entry.cached = !controller.signal.aborted && (startedGeneration === generation || (entry.revision !== undefined && entry.revision === revision));
    entry.completedAt = Date.now();
    return value;
  }).finally(() => {
    clearTimeout(timeout);
    controller.signal.removeEventListener('abort', rejectAbort);
    entry.settled = true;
    if (!entry.cached && resources.get(key) === entry) resources.delete(key);
    prune();
  });
  // Consumers may leave before the shared transport settles.
  void entry.promise.catch(() => undefined);
  resources.set(key, entry);
  return entry;
}
/** One GET per normalized resource, with independent cancellation per consumer. */
export function fetchCatalogJson<T>(url: string, options: Options = {}): Promise<T> {
  if (options.signal?.aborted) return Promise.reject(aborted());
  const key = keyFor(url); prune();
  let entry = resources.get(key);
  if (entry?.controller.signal.aborted || (entry?.settled && (options.force || !entry.cached))) entry = undefined;
  if (!entry) entry = start(key);
  const shared = entry;
  if (shared.settled) {
    resources.delete(key); resources.set(key, shared);
    return Promise.resolve(shared.value as T);
  }
  shared.consumers++;
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const release = () => {
      if (done) return false;
      done = true;
      options.signal?.removeEventListener('abort', onAbort);
      shared.consumers--;
      // Development remounts may immediately attach another consumer.
      queueMicrotask(() => {if (!shared.settled && shared.consumers === 0) shared.controller.abort();});
      return true;
    };
    const onAbort = () => {if (release()) reject(aborted());};
    options.signal?.addEventListener('abort', onAbort, {once: true});
    shared.promise.then(value => {if (release()) resolve(value as T);}, error => {if (release()) reject(error);});
  });
}
