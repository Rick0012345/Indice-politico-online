// @vitest-environment node
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {Pool} from 'pg';
import type {Server} from 'node:http';

const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('contrato de despesas no PostgreSQL', () => {
  const schema = `test_expenses_${Date.now()}`;
  let database: Pool;
  let apiPool: Pool;
  let server: Server;
  let base: string;
  beforeAll(async () => {
    database = new Pool({connectionString: databaseUrl});
    await database.query(`CREATE SCHEMA ${schema}`);
    const sourceSchema = new URL(databaseUrl!).searchParams.get('schema') ?? 'public';
    const sourceIdentifier = '"' + sourceSchema.replaceAll('"', '""') + '"';
    for (const table of ['politicos', 'despesas', 'avaliacoes', 'votos_deputados', 'votacoes', 'camara_votacoes_orientacoes',
      'ingestion_checkpoints', 'camara_proposicoes', 'camara_eventos', 'camara_legislaturas',
      'camara_partidos', 'camara_blocos', 'camara_orgaos', 'camara_frentes', 'camara_referencias']) {
      await database.query(`CREATE TABLE ${schema}.${table} (LIKE ${sourceIdentifier}.${table} INCLUDING ALL)`);
    }
    await database.query(`INSERT INTO ${schema}.politicos (id,nome,sigla_partido,sigla_uf) VALUES (900001,'Pessoa teste','TESTE','RS'),(900002,'Outro','OUTRO','SP')`);
    await database.query(`INSERT INTO ${schema}.despesas (politico_id,ano,mes,tipo_despesa,valor_liquido,valor_documento)
      SELECT 900001,2026,4,CASE WHEN n<=220 THEN 'Combustível' ELSE 'Passagens' END,10,10 FROM generate_series(1,240) n`);
    await database.query(`INSERT INTO ${schema}.despesas (politico_id,ano,mes,tipo_despesa,valor_liquido,valor_documento)
      VALUES (900001,2025,12,'Estorno',-5,-5),(900002,2026,4,'Outra pessoa',999,999)`);
    const url = new URL(databaseUrl!);
    url.searchParams.set('options', `-c search_path=${schema},public`);
    process.env.DATABASE_URL = url.toString();
    process.env.ADMIN_API_TOKEN = 'test-admin-only';
    const api = await import('./server');
    apiPool = api.pool;
    server = api.app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
  }, 20000);
  afterAll(async () => {
    if(server) await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
    await apiPool?.end();
    await database?.query(`DROP SCHEMA ${schema} CASCADE`);
    await database?.end();
  });
  const get = (query='') => fetch(`${base}/api/politicos/900001/despesas?${query}`);
  it('inclui tarefas concluídas vazias no resumo administrativo e informa sua quantidade', async () => {
    await database.query(`INSERT INTO ${schema}.ingestion_checkpoints (source,dataset,entity_id,period_start,period_end,status,items_count)
      VALUES ('camara','despesas','900001','2020-01-01','2020-01-31','done',0),
      ('camara','despesas','900002','2020-01-01','2020-01-31','done',10)`);
    try {
      const response = await fetch(`${base}/api/admin/ingestion/summary`, {headers:{Authorization:'Bearer test-admin-only'}});
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.checkpoints).toEqual(expect.arrayContaining([
        expect.objectContaining({dataset:'despesas',status:'done',total:2,itemsCount:10,emptyTotal:1}),
      ]));
    } finally {
      await database.query(`DELETE FROM ${schema}.ingestion_checkpoints WHERE entity_id IN ('900001','900002') AND period_start='2020-01-01'`);
    }
  });
  it('totaliza além da página e mantém total com offset fora da coleção', async () => {
    const first = await (await get('limit=200')).json();
    expect(first.items).toHaveLength(200);
    expect(first).toMatchObject({total:241,totalValor:2395,hasMore:true});
    const end = await (await get('offset=500')).json();
    expect(end).toMatchObject({items:[],total:241,totalValor:2395,hasMore:false});
  });
  it('filtra tipo/valor no banco e fornece opções completas do período',async()=>{
    const data = await (await get('ano=2026&mes=4&tipo=passagens&valorMin=9&valorMax=11')).json();
    expect(data).toMatchObject({total:20,totalValor:200,hasMore:false});
    expect(data.items).toHaveLength(20);
    expect(data.tiposDisponiveis).toEqual(['Combustível','Passagens']);
    expect((await (await get('tipo=%25')).json()).total).toBe(0);
    expect((await (await get('valorMax=-1')).json()).totalValor).toBe(-5);
  });
  it('não repete nem pula itens empatados entre páginas',async()=>{
    const a=await (await get('limit=120')).json();
    const b=await (await get('limit=120&offset=120')).json();
    expect(new Set([...a.items,...b.items].map(i=>i.id)).size).toBe(240);
  });
  it.each(['mes=13','ano=x','valorMin=20&valorMax=10','limit=1.5','valorMax=NaN'])('rejeita filtro inválido %s',async query=>{
    expect((await get(query)).status).toBe(400);
  });
  it('preserva totais de gastos por partido',async()=>{
    const res=await fetch(`${base}/api/partidos/gastos`);
    expect(res.status).toBe(200);
    const data=await res.json();
    expect(data.items).toEqual(expect.arrayContaining([{partido:'TESTE',totalDespesas:2395,totalPoliticos:1},{partido:'OUTRO',totalDespesas:999,totalPoliticos:1}]));
  });
  it('rejeita ID inválido e mantém autorização administrativa',async()=>{
    expect((await fetch(`${base}/api/politicos/foo/despesas`)).status).toBe(400);
    expect([401,503]).toContain((await fetch(`${base}/api/admin/metrics`)).status);
  });
  it.each(['foo','9223372036854775808','000123'])('valida a identidade numérica da proposição %s',async id=>{
    expect((await fetch(`${base}/api/camara/proposicoes/${id}`)).status).toBe(400);
  });
  it('monitoramento não recupera checkpoint antigo de um processo vivo e limpeza é bloqueada',async()=>{
    const {acquireIngestionLock}=await import('./lib/ingestionLifecycle');
    const lock=await acquireIngestionLock(database);
    expect(lock).not.toBeNull();
    try {
      await database.query(`INSERT INTO ${schema}.ingestion_checkpoints
        (source,dataset,period_start,period_end,status,locked_at)
        VALUES ('camara','despesas','2026-04-01','2026-04-30','running',NOW()-INTERVAL '2 hours')`);
      for (const path of ['summary','logs']) {
        const res=await fetch(`${base}/api/admin/ingestion/${path}`,{headers:{Authorization:'Bearer test-admin-only'}});
        const data=await res.json();
        expect(res.status, `${path}: ${JSON.stringify(data)}`).toBe(200);
        if (path==='summary') expect(data.execution).toEqual({processActive:false,maintenanceActive:true});
      }
      const row=await database.query(`SELECT status FROM ${schema}.ingestion_checkpoints`);
      expect(row.rows[0].status).toBe('running');
      const clear=await fetch(`${base}/api/admin/database/clear`,{method:'POST',headers:{Authorization:'Bearer test-admin-only','Content-Type':'application/json'},body:JSON.stringify({dataset:'despesas'})});
      expect(clear.status).toBe(409);
      expect((await (await get()).json()).total).toBe(241);
    } finally {await lock?.release();}
  });
});
