import type {Pool, PoolClient} from 'pg';
import type {CatalogEvents} from './catalogEvents';

/** The listener uses one dedicated session, irrespective of the number of browsers. */
export const startCatalogListener = (pool: Pool, hub: CatalogEvents, retryMs = 2000) => {
  let stopped = false;
  let connecting = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let session: {client: PoolClient; release(): void} | undefined;
  const schedule = () => {
    if (stopped || retry) return;
    retry = setTimeout(() => { retry = undefined; void connect(); }, retryMs);
    retry.unref?.();
  };
  const connect = async () => {
    if (stopped) return;
    if (connecting) { schedule(); return; }
    connecting = true;
    let current: typeof session;
    try {
      const client = await pool.connect();
      let released = false;
      let schema = '';
      const onNotification = (event: {channel: string; payload?: string}) => {
        if (event.channel === 'catalogo_changes' && event.payload === schema) hub.invalidate();
      };
      const onLost = () => {
        current?.release();
        if (!stopped) schedule();
      };
      current = {client, release: () => {
        if (released) return;
        released = true;
        client.off('notification', onNotification);
        client.off('error', onLost);
        client.off('end', onLost);
        client.release(true);
        if (session === current) session = undefined;
      }};
      session = current;
      client.on('notification', onNotification);
      client.on('error', onLost);
      client.on('end', onLost);
      if (stopped) { current.release(); return; }
      const result = await client.query('SELECT current_schema() AS schema');
      schema = result.rows[0].schema;
      await client.query('LISTEN catalogo_changes');
      if (stopped || session !== current) return;
      // Reconcile anything committed while this API was starting or disconnected.
      hub.invalidate();
    } catch (error) {
      current?.release();
      if (!stopped) {
        console.error('[catalogo-listener]', error instanceof Error ? error.message : 'Falha de conexão.');
        schedule();
      }
    } finally {
      connecting = false;
    }
  };
  void connect();
  return () => {
    stopped = true;
    clearTimeout(retry);
    retry = undefined;
    session?.release();
  };
};
