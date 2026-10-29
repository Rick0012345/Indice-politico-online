import type {Pool} from 'pg';

export class IngestionCancelledError extends Error {
  constructor() { super('Ingestão cancelada pelo operador.'); this.name = 'IngestionCancelledError'; }
}

export const createCancellationGuard = <Args extends unknown[]>(isCancelled: (...args: Args) => Promise<boolean>) => {
  let cancelled = false;
  return async (...args: Args) => {
    if (cancelled || await isCancelled(...args)) {
      cancelled = true;
      throw new IngestionCancelledError();
    }
  };
};

// The dedicated connection owns the session lock until all workers have drained.
export const acquireIngestionLock = async (pool: Pick<Pool, 'connect'>): Promise<{release(): Promise<void>} | null> => {
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT pg_try_advisory_lock($1) AS acquired', [7710042]);
    if (!result.rows[0]?.acquired) { client.release(); return null; }
  } catch (error) { client.release(true); throw error; }
  let released = false;
  return {release: async () => {
    if (released) return;
    released = true;
    try { await client.query('SELECT pg_advisory_unlock($1)', [7710042]); client.release(); }
    catch (error) { client.release(true); throw error; }
  }};
};

export const runIngestion = async (pool: Pick<Pool, 'connect'>, dryRun: boolean, execute: () => Promise<void>) => {
  if (dryRun) return;
  const lock = await acquireIngestionLock(pool);
  if (!lock) throw new Error('Outra ingestão ou limpeza está em andamento.');
  try { await execute(); } finally { await lock.release(); }
};
