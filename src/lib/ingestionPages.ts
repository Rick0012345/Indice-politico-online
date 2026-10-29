import type {Pool, PoolClient} from 'pg';
import {IngestionCancelledError} from './ingestionLifecycle';

export type PageProgress = {
  version: 1;
  resource: string;
  params: Record<string, string | number>;
  nextPage: number;
  itemsCount: number;
  finished: boolean;
};

const sameParams = (params: Record<string, string | number>) =>
  JSON.stringify(Object.entries(params).sort(([a], [b]) => a.localeCompare(b)));

export function readPageProgress(value: unknown, resource: string, params: PageProgress['params']): PageProgress {
  if (value == null || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0)) {
    return {version: 1, resource, params, nextPage: 1, itemsCount: 0, finished: false};
  }
  const progress = value as PageProgress;
  if (!progress || progress.version !== 1 || progress.resource !== resource || !progress.params ||
      sameParams(progress.params) !== sameParams(params) || !Number.isSafeInteger(progress.nextPage) ||
      progress.nextPage < 1 || progress.nextPage > 201 || !Number.isSafeInteger(progress.itemsCount) ||
      progress.itemsCount < 0 || typeof progress.finished !== 'boolean') {
    throw new Error('O progresso salvo não corresponde à consulta de ingestão.');
  }
  return progress;
}

export async function* iteratePages<T>(
  fetchPage: (page: number) => Promise<{dados?: T[]; links?: Array<{rel?: string}>}>,
  {startPage = 1, maxPages = 200}: {startPage?: number; maxPages?: number} = {},
) {
  for (let page = startPage; ; page++) {
    if (!Number.isSafeInteger(page) || page < 1 || page > maxPages) throw new Error(`Limite de paginação excedido (${maxPages}).`);
    const response = await fetchPage(page);
    if (!Array.isArray(response.dados)) throw new Error('Resposta paginada sem uma lista de dados válida.');
    const items = response.dados;
    const hasNext = items.length > 0 && Boolean(response.links?.some(link => link.rel === 'next'));
    yield {page, items, hasNext};
    if (!hasNext) return;
  }
}

/** Domain rows, raw evidence and the resume cursor commit together. No HTTP while holding this transaction. */
export async function commitCheckpointPage(
  pool: Pick<Pool, 'connect'>,
  checkpointId: string,
  progress: PageProgress,
  persist: (client: PoolClient) => Promise<void>,
  checkCancellation: (client: PoolClient) => Promise<void>,
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await checkCancellation(client);
    await persist(client);
    await checkCancellation(client);
    const result = await client.query(
      `UPDATE ingestion_checkpoints SET progress_json = $2::jsonb, items_count = $3,
         locked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'running'`,
      [checkpointId, JSON.stringify(progress), progress.itemsCount],
    );
    if (!result.rowCount) throw new IngestionCancelledError();
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
