import type {Pool} from 'pg';
import type {IngestionExecution} from './ingestionProgress';

const ingestionLockKey = 7710042;

// Observation must never acquire the shared maintenance lock or reset checkpoints.
export const loadIngestionExecution = async (pool: Pick<Pool, 'query'>, processActive: boolean): Promise<IngestionExecution> => {
  const result = await pool.query<{maintenanceActive: boolean}>(`
    SELECT EXISTS (
      SELECT 1 FROM pg_locks
      WHERE locktype = 'advisory' AND granted
        AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
        AND classid = 0 AND objid = $1::oid AND objsubid = 1
    ) AS "maintenanceActive"
  `, [ingestionLockKey]);
  return {processActive, maintenanceActive: result.rows[0]?.maintenanceActive === true};
};

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
export const acquireIngestionLock = async (pool: Pick<Pool, 'connect'>): Promise<{pid?:number;release(): Promise<void>} | null> => {
  const client = await pool.connect();
  let pid:number|undefined;
  try {
    const result = await client.query('SELECT pg_try_advisory_lock($1) AS acquired, pg_backend_pid() AS pid', [ingestionLockKey]);
    if (!result.rows[0]?.acquired) { client.release(); return null; }
    pid=Number(result.rows[0]?.pid)||undefined;
  } catch (error) { client.release(true); throw error; }
  let released = false;
  return {pid,release: async () => {
    if (released) return;
    released = true;
    try { await client.query('SELECT pg_advisory_unlock($1)', [ingestionLockKey]); client.release(); }
    catch (error) { client.release(true); throw error; }
  }};
};

export const runIngestion = async (pool: Pick<Pool, 'connect'>, dryRun: boolean, execute: (owner:{pid?:number}) => Promise<void>) => {
  if (dryRun) return;
  const lock = await acquireIngestionLock(pool);
  if (!lock) throw new Error('Outra ingestão ou limpeza está em andamento.');
  try { await execute({pid:lock.pid}); } finally { await lock.release(); }
};
