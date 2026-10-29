// @vitest-environment node
import {randomUUID} from 'node:crypto';
import {Pool, type PoolClient} from 'pg';
import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';
import {upsertRawBatch, type RawItemUpsert} from './rawPersistence';

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('persistência raw no PostgreSQL isolado', () => {
  const pool = new Pool({connectionString: url});
  const schema = `raw_test_${randomUUID().replaceAll('-', '')}`;
  let client: PoolClient;
  const item: RawItemUpsert = {resource: 'despesas', resourceId: '10', endpoint: '/deputados/1/despesas', rawJson: {valor: -20}};
  beforeAll(async () => {
    client = await pool.connect();
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(`CREATE TABLE camara_api_raw_items (
      id bigserial PRIMARY KEY, resource varchar(120) NOT NULL, resource_id text NOT NULL,
      parent_resource varchar(120) NOT NULL DEFAULT '', parent_id text NOT NULL DEFAULT '',
      endpoint text NOT NULL, query_params jsonb NOT NULL DEFAULT '{}'::jsonb,
      raw_json jsonb NOT NULL, links_json jsonb,
      fetched_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (resource, resource_id, parent_resource, parent_id))`);
  });
  beforeEach(async () => {await client.query('TRUNCATE camara_api_raw_items');});
  afterAll(async () => {
    if (client) {await client.query(`DROP SCHEMA "${schema}" CASCADE`); client.release();}
    await pool.end();
  });

  it('retry idêntico preserva xmin e timestamps de observação persistida', async () => {
    expect(await upsertRawBatch(client, [item])).toBe(1);
    const before = (await client.query('SELECT xmin::text, fetched_at::text, updated_at::text FROM camara_api_raw_items')).rows[0];
    expect(await upsertRawBatch(client, [item])).toBe(0);
    expect((await client.query('SELECT xmin::text, fetched_at::text, updated_at::text FROM camara_api_raw_items')).rows[0]).toEqual(before);
  });

  it.each([
    {endpoint: '/outro'}, {queryParams: {ano: 2026}}, {linksJson: [{rel: 'next', href: '/pagina2'}]}, {rawJson: {valor: -30}},
  ])('mudança de conteúdo ou metadata atualiza timestamps: %j', async (change) => {
    await upsertRawBatch(client, [item]);
    await client.query("UPDATE camara_api_raw_items SET fetched_at = '2000-01-01Z', updated_at = '2000-01-01Z'");
    expect(await upsertRawBatch(client, [{...item, ...change}])).toBe(1);
    const {rows: [row]} = await client.query('SELECT endpoint, query_params, raw_json, links_json, fetched_at, updated_at FROM camara_api_raw_items');
    expect(row).toMatchObject({endpoint: change.endpoint ?? item.endpoint, query_params: change.queryParams ?? {},
      raw_json: change.rawJson ?? item.rawJson, links_json: change.linksJson ?? null});
    expect(row.fetched_at.getUTCFullYear()).toBeGreaterThan(2000);
    expect(row.updated_at).toEqual(row.fetched_at);
  });

  it('deduplica pela chave completa, última ocorrência vence e parents diferentes permanecem', async () => {
    const items = [item, {...item, parentResource: null, parentId: null, rawJson: {valor: 30}},
      {...item, parentResource: 'deputados', parentId: '1'}, {...item, parentResource: 'deputados', parentId: '2'}];
    expect(await upsertRawBatch(client, items)).toBe(3);
    expect((await client.query('SELECT parent_resource, parent_id, raw_json, query_params, links_json FROM camara_api_raw_items ORDER BY parent_id')).rows)
      .toEqual([{parent_resource: '', parent_id: '', raw_json: {valor: 30}, query_params: {}, links_json: null},
        {parent_resource: 'deputados', parent_id: '1', raw_json: {valor: -20}, query_params: {}, links_json: null},
        {parent_resource: 'deputados', parent_id: '2', raw_json: {valor: -20}, query_params: {}, links_json: null}]);
    expect(await upsertRawBatch(client, items)).toBe(0);
  });

  it('rollback do chamador reverte raw junto com os demais dados', async () => {
    await client.query('BEGIN');
    try {await upsertRawBatch(client, [item]);} finally {await client.query('ROLLBACK');}
    expect((await client.query('SELECT count(*)::int AS total FROM camara_api_raw_items')).rows[0].total).toBe(0);
  });
});
