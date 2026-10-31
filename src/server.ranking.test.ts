// @vitest-environment node
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {Pool,type PoolClient} from 'pg';
import type {Server} from 'node:http';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {storeProceedingPage} from './lib/judicialProceedingsRepository';
import type {ProceedingObservation} from './lib/judicialProceedingsTypes';

const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('totais do ranking no PostgreSQL', () => {
  const schema = `test_ranking_${randomUUID().replaceAll('-','')}`;
  let database: Pool;
  let apiPool: Pool;
  let server: Server;
  let base: string;
  const previousDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    if(new URL(databaseUrl!).pathname!=='/app_test')throw new Error('TEST_DATABASE_URL deve apontar ao banco app_test.');
    database = new Pool({connectionString: databaseUrl});
    await database.query(`CREATE SCHEMA ${schema}`);
    const sourceSchema = new URL(databaseUrl!).searchParams.get('schema') ?? 'public';
    const sourceIdentifier = '"' + sourceSchema.replaceAll('"', '""') + '"';
    for (const table of ['politicos', 'despesas', 'avaliacoes', 'votos_deputados','ingestion_checkpoints']) {
      await database.query(`CREATE TABLE ${schema}.${table} (LIKE ${sourceIdentifier}.${table} INCLUDING ALL)`);
    }
    await database.query(`INSERT INTO ${schema}.politicos (id,nome,sigla_partido,sigla_uf,ativo)
      SELECT 900000+n, 'Pessoa '||n, CASE WHEN n<=2 THEN 'ABC' ELSE 'XYZ' END, 'SP', n<=55
      FROM generate_series(1,60) n`);
    await database.query(`INSERT INTO ${schema}.despesas(politico_id,ano,mes,tipo_despesa,valor_documento,valor_liquido)
      SELECT 900000+n,2026,1,'Base',CASE WHEN n=60 THEN -60.60 ELSE n*1.01 END,
        CASE WHEN n=60 THEN -60.60 ELSE n*1.01 END FROM generate_series(1,60) n`);
    const url = new URL(databaseUrl!);
    url.searchParams.set('options', `-c search_path=${schema},public`);
    process.env.DATABASE_URL = url.toString();
    const api = await import('./server');
    apiPool = api.pool;
    const isolated=await apiPool.connect();
    try {
      await isolated.query(`SET search_path=${schema},public`);
      await isolated.query(await readFile('prisma/migrations/20261030030000_judicial_history/migration.sql','utf8'));
      await isolated.query(await readFile('prisma/migrations/20261030120000_judicial_ingestion/migration.sql','utf8'));
      await isolated.query(await readFile('prisma/migrations/20261030210000_judicial_proceedings/migration.sql','utf8'));
    } finally {isolated.release();}
    server = api.app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
  }, 20000);

  afterAll(async () => {
    if (server) await new Promise<void>((resolve,reject) => server.close(error => error ? reject(error) : resolve()));
    await apiPool?.end();
    await database?.query(`DROP SCHEMA ${schema} CASCADE`);
    await database?.end();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });

  const get = async (query='') => {
    const response = await fetch(`${base}/api/politicos/ranking?${query}`);
    expect(response.status).toBe(200);
    return response.json();
  };

  it('conta o cadastro completo e o filtro antes da paginação', async () => {
    const data = await get('limit=50');
    expect(data.items).toHaveLength(50);
    expect(data).toMatchObject({totalCadastrados:60,total:55});
    expect(await get('limit=1&status=inativo')).toMatchObject({totalCadastrados:60,total:5});
    expect(await get('limit=1&status=todos')).toMatchObject({totalCadastrados:60,total:60});
  });

  it('mantém totais com offset fora da coleção e pesquisa vazia', async () => {
    expect(await get('offset=100')).toMatchObject({items:[],totalCadastrados:60,total:55});
    expect(await get('search=Inexistente')).toMatchObject({items:[],totalCadastrados:60,total:0});
  });

  it.each([['Pessoa 1',11],['ABC',2],['SP',55],['Deputado Federal',55]] as const)('aplica a mesma pesquisa %s aos itens e ao total', async (search,total) => {
    const data = await get(`limit=1&search=${encodeURIComponent(search)}`);
    expect(data.items).toHaveLength(1);
    expect(data).toMatchObject({totalCadastrados:60,total});
  });

  it.each(['nota','despesas','votacoes'])('preserva os totais ao ordenar por %s', async metric => {
    const data = await get(`limit=1&metric=${metric}&direction=asc`);
    expect(data).toMatchObject({totalCadastrados:60,total:55});
    expect(data.items[0].id).toBe('900001');
  });

  it.each(['nota','despesas','votacoes'])('soma todo o filtro independentemente da ordem e paginação por %s',async metric=>{
    for(const direction of ['asc','desc']) {
      const first=await get(`metric=${metric}&direction=${direction}&limit=1`);
      expect(first.items).toHaveLength(1);
      expect(first.totalDespesas).toBe(1555.40);
      const outside=await get(`metric=${metric}&direction=${direction}&limit=2&offset=100`);
      expect(outside).toMatchObject({items:[],total:55,totalDespesas:1555.40});
    }
  });

  it.each([
    ['status=inativo',171.70],['status=todos',1727.10],['search=Pessoa%201',147.46],
    ['search=ABC',3.03],['search=SP',1555.40],['search=Deputado%20Federal',1555.40],
    ['search=Inexistente',0],['status=inativo&search=Pessoa%2060',-60.60],
  ] as const)('soma despesas com os mesmos filtros %s',async(query,totalDespesas)=>{
    expect((await get(`${query}&limit=1`)).totalDespesas).toBe(totalDespesas);
  });

  it('não multiplica políticos com várias avaliações, despesas e votos', async () => {
    await database.query(`INSERT INTO ${schema}.avaliacoes (politico_id,cpf_hash,nota)
      VALUES (900001,'primeira',3),(900001,'segunda',5)`);
    await database.query(`INSERT INTO ${schema}.despesas (politico_id,ano,mes,tipo_despesa,valor_liquido,valor_documento)
      VALUES (900001,2026,1,'Teste',10,10),(900001,2026,1,'Teste',20,20)`);
    await database.query(`INSERT INTO ${schema}.votos_deputados (politico_id,votacao_id,voto)
      VALUES (900001,'teste-1','Sim'),(900001,'teste-2','Não')`);
    const data = await get('limit=1');
    expect(data).toMatchObject({totalCadastrados:60,total:55,totalDespesas:1585.40});
    expect(data.items[0]).toMatchObject({id:'900001',totalAvaliacoes:2,notaMedia:4,totalDespesas:31.01,totalVotacoes:2});
  });

  it.each(['nota','despesas','votacoes'])('mantém linhas e ordem exatas no modo items por %s',async metric=>{
    for(const direction of ['asc','desc']) {
      for(const query of ['','status=inativo','status=todos','search=ABC','search=Inexistente','ano=2026&mes=1&valorMin=-100','offset=100']) {
        const suffix=`${query}&metric=${metric}&direction=${direction}&limit=7`;
        const full=await get(suffix),items=await get(`${suffix}&view=items`);
        expect(items.revision).toEqual(expect.any(String));
        expect(items).toMatchObject({total:full.total,totalCadastrados:full.totalCadastrados});
        expect(items.items.map((row:{id:string})=>row.id)).toEqual(full.items.map((row:{id:string})=>row.id));
        for(let i=0;i<items.items.length;i++)expect(full.items[i]).toMatchObject(items.items[i]);
        expect(items).not.toHaveProperty('cobertura');
        if(items.items.length)expect(items.items[0]).not.toHaveProperty('nomeCivil');
      }
    }
  });

  it.each(['best','worst'])('entrega cards leves com a ordem %s e desempate por ID',async filter=>{
    await database.query(`UPDATE ${schema}.politicos SET atualizado_em='2026-10-01'`);
    const full=await get(`filter=${filter}&limit=60&status=todos`);
    const cards=await get(`view=cards&filter=${filter}&limit=60&status=todos`);
    expect(cards.revision).toEqual(expect.any(String));
    expect(cards.items.map((row:{id:string})=>row.id)).toEqual(full.items.map((row:{id:string})=>row.id));
    for(let i=0;i<cards.items.length;i++)expect(full.items[i]).toMatchObject(cards.items[i]);
    expect(cards.items[0]).not.toHaveProperty('totalDespesas');
    expect(cards).not.toHaveProperty('cobertura');
  });

  it.each(['','status=inativo','search=ABC','search=Inexistente','ano=2026&mes=1&valorMax=0'])('mantém resumo independente da página e ordem %s',async query=>{
    const full=await get(query);
    const summary=await get(`${query}&view=summary&metric=despesas&direction=asc&offset=100`);
    const {items:_items,...totals}=full;
    expect(summary).toMatchObject(totals);
    expect(summary.revision).toEqual(expect.any(String));
    expect(summary).not.toHaveProperty('items');
  });

  it('preserva cobertura parcial e filtros de período no resumo',async()=>{
    await database.query(`INSERT INTO ${schema}.ingestion_checkpoints (source,dataset,entity_id,period_start,period_end,status,items_count)
      VALUES ('camara','despesas','900001','2026-01-01','2026-01-31','done',2),
      ('camara','despesas','900002','2026-02-01','2026-02-28','failed',0)`);
    for(const query of ['search=ABC','search=ABC&ano=2026&mes=1','search=ABC&ano=2026&mes=2']) {
      const full=await get(query),summary=await get(`${query}&view=summary`);
      expect(summary.cobertura).toEqual(full.cobertura);
      expect(summary.cobertura.status).toBe('partial');
    }
  });

  it('lista anos distintos em ordem decrescente com vários documentos e competências',async()=>{
    await database.query(`INSERT INTO ${schema}.despesas(politico_id,ano,mes,tipo_despesa,valor_documento,valor_liquido)
      VALUES (900001,2024,1,'Ano antigo',1,1),(900001,2024,2,'Ano antigo',1,1),(900001,2025,1,'Ano anterior',1,1)`);
    const response=await fetch(`${base}/api/despesas/anos`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({items:[2026,2025,2024]});
  });

  it('compartilha a segmentação por fornecedor e faixa de valor com o perfil',async()=>{
    const originals=[{nomeFornecedor:'A',valorLiquido:10},{nomeFornecedor:'B',valorLiquido:20}];
    await database.query(`INSERT INTO ${schema}.despesas(politico_id,ano,mes,tipo_despesa,cod_documento,valor_documento,valor_liquido,nome_fornecedor,raw_json)
      VALUES(900001,2023,1,'Misto','0',30,30,'B',$1)`,[JSON.stringify({sourceEntries:originals})]);
    const supplier=createHash('md5').update('nome:a').digest('hex');
    try {
      for(const [filter,total] of [[`fornecedorId=${supplier}`,10],['valorMin=15',20]] as const) {
        const query=`ano=2023&${filter}`;
        const response=await fetch(`${base}/api/politicos/900001/despesas?${query}`);
        expect(response.status).toBe(200);
        expect((await response.json()).totalValor).toBe(total);
        for(const metric of ['nota','despesas','votacoes']) {
          const full=await get(`${query}&search=ABC&metric=${metric}`);
          const items=await get(`${query}&search=ABC&metric=${metric}&view=items`);
          const summary=await get(`${query}&search=ABC&metric=${metric}&view=summary&offset=100`);
          expect(full.totalDespesas).toBe(total);
          expect(summary.totalDespesas).toBe(total);
          expect(full.items.find((row:{id:string})=>row.id==='900001').totalDespesas).toBe(total);
          expect(items.items.find((row:{id:string})=>row.id==='900001').totalDespesas).toBe(total);
          expect(items.items.map((row:{id:string})=>row.id)).toEqual(full.items.map((row:{id:string})=>row.id));
        }
      }
    } finally {await database.query(`DELETE FROM ${schema}.despesas WHERE ano=2023`);}
  });

  it('integra resumo judicial e ordenação global, preservando categorias, publicação e privacidade',async()=>{
    const add=async(id:number,category='CRIMINAL',kind='CONVICTION',convictionStatus='FINAL',verification='VERIFIED')=>{
      const key=randomUUID();
      const payload={kind,category,court:'STF',convictionStatus,verification,caseNumber:key,eventDate:'2025-01-01',custodyType:kind==='IMPRISONMENT'?'PREVENTIVE':null,custodyConfirmed:kind==='IMPRISONMENT',identityEvidence:'SEGREDO DE IDENTIDADE',reviewNote:'SEGREDO DE REVISÃO'};
      await database.query(`INSERT INTO ${schema}.judicial_records(id,politico_id,kind,category,case_key,dedupe_key,verification,payload,checked_at)
        VALUES($1::text::uuid,$2,$3,$4,$1::text,$1::text,$5,$6,now())`,[key,id,kind,category,verification,JSON.stringify(payload)]);
    };
    await database.query(`INSERT INTO ${schema}.judicial_coverage(politico_id,status,scope,sources) VALUES(900001,'REVIEWED','Teste','[]')`);
    await add(900001,'CRIMINAL','CONVICTION','FINAL','DRAFT');
    await add(900001,'CRIMINAL','CONVICTION','ANNULLED');
    await add(900002);await add(900002);await add(900002,'ELECTORAL');
    await add(900003,'ELECTORAL');await add(900003,'ELECTORAL');
    await add(900003,'CRIMINAL','IMPRISONMENT');
    await add(900004,'CRIMINAL','IMPRISONMENT','FINAL','DRAFT');
    try {
      for(const direction of ['asc','desc']) {
        const expected=direction==='asc'?['900001','900003','900002']:['900002','900001','900003'];
        for(const view of ['','&view=items']) {
          const ranked=await get(`metric=condenacoes&direction=${direction}&limit=3${view}`);
          expect(ranked.items.map((p:{id:string})=>p.id)).toEqual(expected);
          expect(ranked.items.find((p:{id:string})=>p.id==='900001').judicial.finalConvictions).toBe(0);
          const unknown=await get(`metric=condenacoes&direction=${direction}&limit=1&offset=3${view}`);
          expect(unknown.items[0].judicial.finalConvictions).toBeNull();
          expect(JSON.stringify(ranked)).not.toMatch(/identityEvidence|reviewNote|SEGREDO|"records"|judicialKnown|judicialFinal/);
          const page=await get(`metric=condenacoes&direction=${direction}&limit=1&offset=1${view}`);
          expect(page.items[0].id).toBe(expected[1]);
        }
      }
      for(const view of ['','&view=items']) {
        const electoral=await get(`metric=condenacoes&category=ELECTORAL&limit=1${view}`);
        expect(electoral.items[0]).toMatchObject({id:'900003',judicial:{finalConvictions:0,counts:{ELECTORAL:{final:2}},confirmedImprisonments:1}});
        const prison=await get(`metric=condenacoes&prisonOnly=true${view}`);
        expect(prison).toMatchObject({total:1,items:[{id:'900003',judicial:{finalConvictions:0,confirmedImprisonments:1}}]});
      }
      const prisonFull=await get('metric=condenacoes&prisonOnly=true');
      expect(await get('view=summary&prisonOnly=true')).toMatchObject({total:1,totalDespesas:prisonFull.totalDespesas,totalAvaliacoes:0});
      const cards=await get('view=cards&metric=condenacoes');
      expect(cards.items.map((p:{id:string})=>p.id)).toEqual((await get('view=cards')).items.map((p:{id:string})=>p.id));
      expect(cards.items[0]).toHaveProperty('judicial');
      expect(await get('view=cards&prisonOnly=true')).toMatchObject({total:1,items:[{id:'900003'}]});
      const full=(await get('search=Pessoa%202&metric=condenacoes')).items.find((p:{id:string})=>p.id==='900002');
      const profile=await fetch(`${base}/api/politicos/900002`);expect(profile.status).toBe(200);
      expect((await profile.json()).politico.judicial).toEqual(full.judicial);
      const list=await fetch(`${base}/api/politicos?search=Pessoa%202`);expect(list.status).toBe(200);
      expect((await list.json()).items.find((p:{id:string})=>p.id==='900002').judicial).toEqual(full.judicial);
      // Publish on another connection precisely between ranking and enrichment.
      for(const view of ['','&view=items']) {
        const before=(await get('metric=condenacoes&search=ABC')).items.find((p:{id:string})=>p.id==='900002').judicial.finalConvictions;
        let intercepted=false;
        const intercept=(client:PoolClient)=>{
          const original=client.query;
          client.query=function(...args:Parameters<typeof original>){
            const pending=original.apply(this,args);
            const text=args[0];
            if(typeof text==='string'&&text.includes('WITH filtrados AS')) {
              client.query=original;intercepted=true;
              return Promise.resolve(pending).then(async result=>{await add(900002);return result;});
            }
            return pending;
          } as typeof original;
        };
        apiPool.once('acquire',intercept);
        try {
          const concurrent=await get(`metric=condenacoes&search=ABC${view}`);
          expect(intercepted).toBe(true);
          expect(concurrent.items.find((p:{id:string})=>p.id==='900002').judicial.finalConvictions).toBe(before);
          expect((await get('metric=condenacoes&search=ABC')).items.find((p:{id:string})=>p.id==='900002').judicial.finalConvictions).toBe(before+1);
        } finally {apiPool.off('acquire',intercept);}
      }
      for(const query of ['category=INVALID','category=CRIMINAL&category=ELECTORAL','prisonOnly=yes','prisonOnly=true&prisonOnly=false'])expect((await fetch(`${base}/api/politicos/ranking?${query}`)).status).toBe(400);
    } finally {
      await database.query(`DELETE FROM ${schema}.judicial_records; DELETE FROM ${schema}.judicial_coverage`);
    }
  });

  it('integra processos no ranking legado/progressivo e preserva desconhecidos após a página',async()=>{
    const runId=randomUUID();await apiPool.query("INSERT INTO judicial_ingestion_runs(id,data) VALUES($1,'{}')",[runId]);
    const obs=(key:string):ProceedingObservation=>({sourceId:'STF_CASES',sourceKey:key,sourcePersonId:'SEGREDO',court:'STF',caseNumber:`AP ${key}`,cnjNumber:null,phase:'ACTION',status:'ACTIVE',filedAt:null,subjects:[],roles:[{role:'DEFENDANT',label:'Réu'}],sourceUrl:'https://portal.stf.jus.br/processos/',sourceLabel:'STF',fetchedAt:'2026-10-30T12:00:00Z',contentHash:'SEGREDO',identity:'CONFIRMED',identityEvidence:[]});
    const client=await apiPool.connect();
    try {
      await client.query('BEGIN');
      for(const [id,observations] of [['900001',[]],['900002',[obs('1'),obs('2')]],['900003',[obs('3')]]] as Array<[string,ProceedingObservation[]]>)await storeProceedingPage(client,{runId,politicoId:id,page:1,result:{observations,nominalMatches:observations.length,errors:[]},done:true,truncated:false,error:null});
      await client.query('COMMIT');
      for(const direction of ['asc','desc'])for(const view of ['','&view=items']){
        const expected=direction==='asc'?['900001','900003','900002']:['900002','900003','900001'];
        const ranked=await get(`metric=processos&direction=${direction}&limit=3${view}`);
        expect(ranked.items.map((item:{id:string})=>item.id)).toEqual(expected);
        expect(ranked.items.find((item:{id:string})=>item.id==='900002').judicial.proceedings.againstPerson).toBe(2);
        const next=await get(`metric=processos&direction=${direction}&limit=1&offset=3${view}`);
        expect(next.items[0].judicial.proceedings.againstPerson).toBeNull();
        expect(JSON.stringify(ranked)).not.toMatch(/SEGREDO|sourcePersonId|contentHash|proceedingsKnown|proceedingsCount/);
      }
    } finally {
      await client.query('ROLLBACK');client.release();
      await apiPool.query('DELETE FROM judicial_process_pages; DELETE FROM judicial_process_attempts; DELETE FROM judicial_process_observations; DELETE FROM judicial_ingestion_runs');
    }
  });

  it('devolve ambos totais zerados quando não há políticos cadastrados', async () => {
    await database.query(`TRUNCATE ${schema}.politicos, ${schema}.avaliacoes, ${schema}.despesas, ${schema}.votos_deputados,${schema}.judicial_records,${schema}.judicial_coverage,${schema}.judicial_audit,${schema}.judicial_candidates,${schema}.judicial_candidate_evidence,${schema}.judicial_process_observations,${schema}.judicial_process_pages,${schema}.judicial_process_attempts`);
    expect(await get()).toMatchObject({items:[],totalCadastrados:0,total:0,totalDespesas:0,totalAvaliacoes:0,totalVotacoes:0,notaMedia:0,votacoesDisponiveis:false,cobertura:{status:'not_imported',periods:0,expectedPeriods:0,missing:0,politicians:0}});
    expect(await (await fetch(`${base}/api/despesas/anos`)).json()).toEqual({items:[]});
  });
});
