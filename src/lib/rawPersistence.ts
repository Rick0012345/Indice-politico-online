import type {PoolClient} from 'pg';

export type RawItemUpsert = {
  resource: string; resourceId: string; endpoint: string; rawJson: unknown;
  parentResource?: string | null; parentId?: string | null;
  queryParams?: Record<string, unknown>; linksJson?: unknown;
};

export async function upsertRawBatch(client: Pick<PoolClient, 'query'>, items: RawItemUpsert[]): Promise<number> {
  if (items.length === 0) return 0;
  const payload = new Map<string, {
    resource: string; resource_id: string; parent_resource: string; parent_id: string;
    endpoint: string; query_params: Record<string, unknown>; raw_json: unknown; links_json: unknown;
  }>();
  for (const item of items) {
    const row = {
      resource: item.resource,
      resource_id: item.resourceId,
      parent_resource: item.parentResource ?? '',
      parent_id: item.parentId ?? '',
      endpoint: item.endpoint,
      query_params: item.queryParams ?? {},
      raw_json: item.rawJson,
      links_json: item.linksJson ?? null,
    };
    // A tuple encoded as JSON avoids collisions between separator-containing IDs.
    const key = JSON.stringify([row.resource, row.resource_id, row.parent_resource, row.parent_id]);
    payload.set(key, row);
  }
  const result = await client.query(`
    INSERT INTO camara_api_raw_items AS current (
      resource, resource_id, parent_resource, parent_id, endpoint,
      query_params, raw_json, links_json
    )
    SELECT resource, resource_id, parent_resource, parent_id, endpoint,
      query_params, raw_json, links_json
    FROM jsonb_to_recordset($1::jsonb) AS item (
      resource varchar(120), resource_id text, parent_resource varchar(120), parent_id text,
      endpoint text, query_params jsonb, raw_json jsonb, links_json jsonb
    )
    ON CONFLICT (resource, resource_id, parent_resource, parent_id) DO UPDATE SET
      endpoint = EXCLUDED.endpoint,
      query_params = EXCLUDED.query_params,
      raw_json = EXCLUDED.raw_json,
      links_json = EXCLUDED.links_json,
      fetched_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
    WHERE ROW(current.endpoint, current.query_params, current.raw_json, current.links_json)
      IS DISTINCT FROM ROW(EXCLUDED.endpoint, EXCLUDED.query_params, EXCLUDED.raw_json, EXCLUDED.links_json)
  `, [JSON.stringify([...payload.values()])]);
  return result.rowCount ?? 0;
}
