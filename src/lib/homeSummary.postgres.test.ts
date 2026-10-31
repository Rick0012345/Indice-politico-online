// @vitest-environment node
import {randomUUID} from 'node:crypto';
import {Pool, type PoolClient} from 'pg';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {homeSummaryQuery} from './homeSummary';

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('resumo inicial no PostgreSQL isolado', () => {
  let pool: Pool;
  let client: PoolClient;
  const schema = `home_test_${randomUUID().replaceAll('-', '')}`;
  beforeAll(async () => {
    if (new URL(url!).pathname !== '/app_test') throw new Error('Use somente app_test.');
    pool = new Pool({connectionString: url});
    client = await pool.connect();
    await client.query(`CREATE SCHEMA ${schema}; SET search_path TO ${schema};
      CREATE TABLE politicos(id bigint PRIMARY KEY, ativo boolean, sigla_partido text, sigla_uf text);
      CREATE TABLE despesas(politico_id bigint, valor_liquido numeric(12,2));
      INSERT INTO politicos VALUES (1,true,'ABC','SP'),(2,null,'ABC','SP'),(3,true,'XYZ','RJ'),
        (4,false,'XYZ','RJ'),(5,true,'',''),(6,true,null,null);
      INSERT INTO despesas VALUES (1,10.10),(1,-2.05),(2,20.20),(4,999),(5,3.15),(6,1.01);`);
  });
  afterAll(async () => {
    if (client) {await client.query(`DROP SCHEMA ${schema} CASCADE`); client.release();}
    await pool?.end();
  });
  it('preserva precisão, ativos desconhecidos, negativos e deputados sem despesas', async () => {
    const {rows: [result]} = await client.query(homeSummaryQuery);
    expect(result).toEqual({
      panorama: {total: 5, totalCadastrados: 6, totalDespesas: 32.41},
      estados: [{uf: 'RJ', totalPoliticos: 1, totalDespesas: 0}, {uf: 'SP', totalPoliticos: 2, totalDespesas: 28.25}],
      partidos: [{partido: 'ABC', totalPoliticos: 2, totalDespesas: 28.25}, {partido: 'XYZ', totalPoliticos: 1, totalDespesas: 0}],
    });
  });
  it('mantém os mesmos totais das consultas anteriores por estado e partido', async () => {
    const {rows: [result]} = await client.query(homeSummaryQuery);
    for (const [column, alias, key, order] of [['sigla_uf','uf','estados','uf'], ['sigla_partido','partido','partidos','"totalDespesas" DESC,partido']] as const) {
      const previous = await client.query(`SELECT p.${column} AS ${alias}, COUNT(p.id)::int AS "totalPoliticos",
        COALESCE(SUM(d.total),0)::double precision AS "totalDespesas" FROM politicos p
        LEFT JOIN (SELECT politico_id,SUM(valor_liquido) AS total FROM despesas GROUP BY politico_id) d ON d.politico_id=p.id
        WHERE p.ativo IS DISTINCT FROM false AND p.${column} IS NOT NULL AND p.${column}<>''
        GROUP BY p.${column} ORDER BY ${order}`);
      expect(result[key]).toEqual(previous.rows);
    }
  });
  it('retorna coleções vazias e total de cadastro quando não existem ativos', async () => {
    await client.query('BEGIN');
    try {
      await client.query('UPDATE politicos SET ativo=false');
      expect((await client.query(homeSummaryQuery)).rows[0]).toEqual({
        panorama: {total: 0, totalCadastrados: 6, totalDespesas: 0}, estados: [], partidos: [],
      });
      await client.query('DELETE FROM despesas; DELETE FROM politicos');
      expect((await client.query(homeSummaryQuery)).rows[0].panorama).toEqual({total: 0, totalCadastrados: 0, totalDespesas: 0});
    } finally {await client.query('ROLLBACK');}
  });
});
