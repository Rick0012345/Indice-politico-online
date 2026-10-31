// @vitest-environment node
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import type {Server} from 'node:http';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';

const databaseUrl=process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('análise e cobertura financeira PostgreSQL',()=>{
  const schema=`analytics_${randomUUID().replaceAll('-','')}`;
  let database:Pool,apiPool:Pool,server:Server,base:string;
  const oldUrl=process.env.DATABASE_URL;
  beforeAll(async()=>{
    database=new Pool({connectionString:databaseUrl});
    const source='"'+(new URL(databaseUrl!).searchParams.get('schema')??'public').replaceAll('"','""')+'"';
    await database.query(`CREATE SCHEMA ${schema}`);
    for(const table of ['politicos','despesas','avaliacoes','votos_deputados','votacoes','ingestion_checkpoints']) await database.query(`CREATE TABLE ${schema}.${table}(LIKE ${source}.${table} INCLUDING ALL)`);
    await database.query(`INSERT INTO ${schema}.politicos(id,nome,sigla_partido,sigla_uf,ativo) VALUES(900001,'Primeira','ABC','SP',true),(900002,'Segunda','DEF','RJ',true),(900003,'Terceira','ABC','SP',false)`);
    await database.query(`INSERT INTO ${schema}.despesas(politico_id,ano,mes,tipo_despesa,valor_documento,valor_liquido,nome_fornecedor,cnpj_cpf_fornecedor)
      VALUES(900001,2025,1,'A',100,100,'Fornecedor','00123456789012'),(900001,2025,1,'A',-20,-20,'Fornecedor','00123456789012'),
      (900001,2025,2,'B',30,30,' Nome ',NULL),(900001,2024,3,'C',10,10,NULL,NULL),(900002,2025,1,'A',200,200,'Outro','99999999999999')`);
    await database.query(`INSERT INTO ${schema}.ingestion_checkpoints(source,dataset,entity_id,period_start,period_end,status,items_count)
      VALUES('camara','despesas','900001','2025-01-01','2025-01-15','failed',0),('camara','despesas','900001','2025-01-01','2025-01-31','done',2),
      ('camara','despesas','900001','2025-02-01','2025-02-28','pending',0),('camara','despesas','900002','2025-01-01','2025-01-31','done',0),
      ('camara','despesas','900003','2026-10-01','2026-10-29','done',0)`);
    const url=new URL(databaseUrl!);url.searchParams.set('options',`-c search_path=${schema},public`);process.env.DATABASE_URL=url.toString();
    const api=await import('./server');apiPool=api.pool;
    const isolated=await apiPool.connect();
    try {
      await isolated.query(`SET search_path=${schema},public`);
      await isolated.query(await readFile('prisma/migrations/20261030030000_judicial_history/migration.sql','utf8'));
      await isolated.query(await readFile('prisma/migrations/20261030120000_judicial_ingestion/migration.sql','utf8'));
      await isolated.query(await readFile('prisma/migrations/20261030210000_judicial_proceedings/migration.sql','utf8'));
    } finally {isolated.release();}
    server=api.app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
    base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  },20000);
  afterAll(async()=>{if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));await apiPool?.end();await database?.query(`DROP SCHEMA ${schema} CASCADE`);await database?.end();if(oldUrl===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=oldUrl;});
  const get=async(path:string)=>{const response=await fetch(base+path);expect(response.status,await response.clone().text()).toBe(200);return response.json();};
  const profile='/api/politicos/900001/despesas';
  it('oferece anos globais e totais de ranking com período sem excluir parlamentares',async()=>{
    expect(await get('/api/despesas/anos')).toEqual({items:[2025,2024]});
    for(const metric of ['nota','despesas','votacoes']) expect(await get(`/api/politicos/ranking?ano=2025&mesInicio=1&mesFim=1&metric=${metric}&limit=1`)).toMatchObject({total:2,totalDespesas:280,votacoesDisponiveis:false,totalAvaliacoes:0,totalVotacoes:0});
  });
  it('deduplica janela mais ampla, separa vazio concluído de pendente e não inventa cobertura',async()=>{
    const ranking=await get('/api/politicos/ranking?ano=2025&mesInicio=1&mesFim=2');
    expect(ranking.cobertura).toMatchObject({status:'partial',periods:3,expectedPeriods:4,missing:1,completed:2,empty:1,pending:1,failed:0,politicians:2,withoutCheckpoints:0,from:'2025-01-01',to:'2025-02-28'});
    expect((await get('/api/politicos/ranking?search=Inexistente&ano=2025')).cobertura).toMatchObject({status:'not_imported',periods:0,politicians:0});
    expect((await get('/api/politicos/ranking?status=todos&ano=2025')).cobertura).toMatchObject({status:'partial',withoutCheckpoints:1});
    expect((await get('/api/politicos/ranking?search=Segunda&ano=2025')).cobertura).toMatchObject({status:'partial',periods:1,expectedPeriods:12,missing:11,completed:1});
    expect((await get('/api/politicos/ranking?ano=2030')).cobertura).toMatchObject({status:'not_imported',periods:0,expectedPeriods:0,missing:0,from:null,to:null});
    expect((await get('/api/politicos/ranking?search=Segunda&ano=2025&mes=1')).cobertura).toMatchObject({status:'complete',periods:1,expectedPeriods:1,missing:0,empty:1});
  });
  it('análise, lista, resumo e média usam o mesmo fornecedor/categoria/período e preservam estorno',async()=>{
    const id=createHash('md5').update('doc:00123456789012').digest('hex');
    const query=`ano=2025&mesInicio=1&mesFim=2&tipo=A&fornecedorId=${id}`;
    const analysis=await get(`${profile}/analise?${query}`);
    expect(analysis).toMatchObject({total:2,totalValor:80,categorias:[{tipo:'A',total:80,quantidade:2,participacao:100}],fornecedores:[{id,nome:'Fornecedor',identificacao:'documento',total:80,quantidade:2,participacao:100}],outrosFornecedores:{total:0,quantidade:0,fornecedores:0},periodo:{ano:2025,mes:null,mesInicio:1,mesFim:2}});
    expect(JSON.stringify(analysis)).not.toContain('00123456789012');
    expect(await get(`${profile}?${query}&limit=1`)).toMatchObject({total:2,totalValor:80});
    expect(await get(`${profile}/resumo?${query}`)).toEqual({items:[{ano:2025,mes:1,total:80}]});
    expect(await get(`/api/despesas/media?${query}`)).toEqual({items:[{ano:2025,mes:1,media:80,participantes:1}]});
    expect(await get(`${profile}/analise?ano=2025&valorMax=-1`)).toMatchObject({total:1,totalValor:-20,categorias:[{tipo:'A',total:-20,quantidade:1,participacao:null}]});
  });
  it.each(['ano=x','mes=1&mesInicio=1','mesInicio=2','ano=2025&mesInicio=3&mesFim=2','ano=2025&mesFim=13','fornecedorId=abc','valorMin=10&valorMax=1'])('rejeita filtro comum inválido %s',async query=>{
    for(const path of [profile,`${profile}/analise`,`${profile}/resumo`,'/api/despesas/media','/api/politicos/ranking'])expect((await fetch(`${base}${path}?${query}`)).status).toBe(400);
  });
  it('média declara só participantes com registros e nota é ponderada por avaliações',async()=>{
    expect(await get('/api/despesas/media?ano=2025&mes=1')).toEqual({items:[{ano:2025,mes:1,media:140,participantes:2}]});
    await database.query(`INSERT INTO ${schema}.avaliacoes(politico_id,cpf_hash,nota)VALUES(900001,'a',5),(900001,'b',1),(900002,'c',5)`);
    await database.query(`INSERT INTO ${schema}.votos_deputados(politico_id,votacao_id,voto)VALUES(900001,'v','Sim'),(900002,'v','Não')`);
    const ranking=await get('/api/politicos/ranking?ano=2024&mes=3');
    expect(ranking).toMatchObject({totalAvaliacoes:3,totalVotacoes:2,votacoesDisponiveis:true,totalDespesas:10});expect(ranking.notaMedia).toBeCloseTo(11/3);
    expect((await get('/api/politicos/900001')).politico.votacoesDisponiveis).toBe(true);
  });
  it('fornecedor por nome é explícito e dez maiores mais outros reconciliam todo o filtro',async()=>{
    await database.query(`INSERT INTO ${schema}.despesas(politico_id,ano,mes,tipo_despesa,valor_documento,valor_liquido,nome_fornecedor)
      SELECT 900001,2023,1,'Extra',n,n,'Nome '||n FROM generate_series(1,12)n`);
    const analysis=await get(`${profile}/analise?ano=2023`);
    expect(analysis).toMatchObject({total:12,totalValor:78,outrosFornecedores:{total:3,quantidade:2,fornecedores:2}});
    expect(analysis.fornecedores).toHaveLength(10);
    expect(analysis.fornecedores.every((row:any)=>row.identificacao==='nome')).toBe(true);
    expect(analysis.fornecedores.reduce((sum:number,row:any)=>sum+row.total,analysis.outrosFornecedores.total)).toBe(analysis.totalValor);
    const id=createHash('md5').update('nome:nome').digest('hex');
    expect(await get(`${profile}/analise?ano=2025&fornecedorId=${id}`)).toMatchObject({total:1,totalValor:30,fornecedores:[{nome:'Nome',identificacao:'nome'}]});
    expect(await get(`${profile}/analise?ano=2024`)).toMatchObject({fornecedores:[{nome:'Sem fornecedor informado',identificacao:'nome'}],cobertura:{status:'not_imported',periods:0}});
  });
  it('gastos por partido compartilham período e status sem alterar contagem do cadastro',async()=>{
    expect((await get('/api/partidos/gastos?ano=2025&mesInicio=1&mesFim=1')).items).toEqual([{partido:'DEF',totalDespesas:200,totalPoliticos:1},{partido:'ABC',totalDespesas:80,totalPoliticos:1}]);
    expect((await get('/api/partidos/gastos?ano=2025&mesInicio=2&mesFim=2')).items).toEqual([{partido:'ABC',totalDespesas:30,totalPoliticos:1},{partido:'DEF',totalDespesas:0,totalPoliticos:1}]);
    expect((await get('/api/partidos/gastos?ano=2025&mes=1&status=todos')).items).toEqual([{partido:'DEF',totalDespesas:200,totalPoliticos:1},{partido:'ABC',totalDespesas:80,totalPoliticos:2}]);
    expect((await get('/api/partidos/gastos?ano=2025&status=inativo')).items).toEqual([{partido:'ABC',totalDespesas:0,totalPoliticos:1}]);
    expect((await fetch(`${base}/api/partidos/gastos?ano=2025&mesInicio=3&mesFim=2`)).status).toBe(400);
  });
  it('distribui agregado multi-fornecedor pelos componentes em lista, análise, resumo e média',async()=>{
    const originals=[{codDocumento:0,ano:2022,mes:1,tipoDespesa:'Misto',nomeFornecedor:'A',valorLiquido:10},
      {codDocumento:0,ano:2022,mes:1,tipoDespesa:'Misto',nomeFornecedor:'B',valorLiquido:20}];
    await database.query(`INSERT INTO ${schema}.despesas(politico_id,ano,mes,tipo_despesa,cod_documento,valor_documento,valor_liquido,nome_fornecedor,raw_json)
      VALUES(900001,2022,1,'Misto','0',30,30,'B',$1)`,[JSON.stringify({...originals[1],valorLiquido:30,sourceEntries:originals})]);
    const analysis=await get(`${profile}/analise?ano=2022`);
    expect(analysis).toMatchObject({total:2,totalValor:30,categorias:[{tipo:'Misto',total:30,quantidade:2}]});
    expect(analysis.fornecedores.map((row:any)=>[row.nome,row.total,row.quantidade]).sort()).toEqual([['A',10,1],['B',20,1]]);
    const all=await get(`${profile}?ano=2022`);expect(all).toMatchObject({total:2,totalValor:30});
    expect(new Set(all.items.map((row:any)=>row.id)).size).toBe(2);
    const id=createHash('md5').update('nome:a').digest('hex'),query=`ano=2022&fornecedorId=${id}`;
    expect(await get(`${profile}?${query}`)).toMatchObject({total:1,totalValor:10,items:[{valor:10,fornecedor:'A'}]});
    expect(await get(`${profile}/analise?${query}`)).toMatchObject({total:1,totalValor:10});
    expect(await get(`${profile}/resumo?${query}`)).toEqual({items:[{ano:2022,mes:1,total:10}]});
    expect(await get(`/api/despesas/media?${query}`)).toEqual({items:[{ano:2022,mes:1,media:10,participantes:1}]});
    expect(await get(`${profile}?ano=2022&valorMax=15`)).toMatchObject({total:1,totalValor:10});
  });
  it('expande somente janela multimensal e mantém prioridade da consulta mais ampla',async()=>{
    await database.query(`INSERT INTO ${schema}.ingestion_checkpoints(source,dataset,entity_id,period_start,period_end,status,items_count)
      VALUES('camara','despesas','900003','2021-01-01','2021-03-31','done',0),('camara','despesas','900003','2021-02-01','2021-02-15','failed',0)`);
    expect((await get('/api/politicos/ranking?status=inativo&ano=2021&mesInicio=1&mesFim=3')).cobertura).toMatchObject({status:'complete',periods:3,expectedPeriods:3,missing:0,completed:3,empty:3,failed:0,from:'2021-01-01',to:'2021-03-31'});
  });
  it('mantém ID e quantidade de fornecedor único e estornos distintos de múltiplos fornecedores',async()=>{
    const a={nomeFornecedor:'A',valorLiquido:10},b={nomeFornecedor:'B',valorLiquido:-20};
    const single=(await database.query(`INSERT INTO ${schema}.despesas(politico_id,ano,mes,tipo_despesa,valor_documento,valor_liquido,nome_fornecedor,raw_json)
      VALUES(900001,2021,12,'Único',5,5,'A',$1) RETURNING id`,[JSON.stringify({sourceEntries:[a,{...a,valorLiquido:-5}]})])).rows[0].id;
    expect(await get(`${profile}?ano=2021&mes=12`)).toMatchObject({total:1,totalValor:5,items:[{id:single,valor:5}]});
    await database.query(`INSERT INTO ${schema}.despesas(politico_id,ano,mes,tipo_despesa,valor_documento,valor_liquido,nome_fornecedor,raw_json)
      VALUES(900001,2021,11,'Estorno',-10,-10,'B',$1)`,[JSON.stringify({sourceEntries:[a,b]})]);
    const analysis=await get(`${profile}/analise?ano=2021&mes=11`);
    expect(analysis).toMatchObject({total:2,totalValor:-10,categorias:[{tipo:'Estorno',total:-10,participacao:null}]});
    expect(analysis.fornecedores.map((row:any)=>[row.total,row.participacao])).toEqual([[10,null],[-20,null]]);
    const first=await get(`${profile}?ano=2021&mes=11&limit=1`),last=await get(`${profile}?ano=2021&mes=11&limit=1&offset=1`);
    expect(first).toMatchObject({total:2,totalValor:-10});expect(last).toMatchObject({total:2,totalValor:-10});
    expect(first.items[0].id).not.toBe(last.items[0].id);
    expect(await get(`${profile}?ano=2021&mes=11&valorMax=0`)).toMatchObject({total:1,totalValor:-20});
  });
  it('associa somente URL dos originais do próprio fornecedor e omite grupo com URLs ambíguas',async()=>{
    const urlA='https://example.test/a',urlB='https://example.test/b';
    await database.query(`INSERT INTO ${schema}.despesas(politico_id,ano,mes,tipo_despesa,valor_documento,valor_liquido,nome_fornecedor,url_documento,raw_json)
      VALUES(900001,2022,3,'URL',30,30,'B',$1,$2)`,[urlB,JSON.stringify({sourceEntries:[{nomeFornecedor:'A',valorLiquido:10,urlDocumento:urlA},{nomeFornecedor:'B',valorLiquido:20,urlDocumento:urlB}]})]);
    const all=await get(`${profile}?ano=2022&mes=3`);
    expect(all.items.map((item:any)=>[item.fornecedor,item.valor,item.urlDocumento]).sort()).toEqual([['A',10,urlA],['B',20,urlB]]);
    const id=createHash('md5').update('nome:a').digest('hex');
    expect(await get(`${profile}?ano=2022&mes=3&fornecedorId=${id}`)).toMatchObject({total:1,totalValor:10,items:[{fornecedor:'A',urlDocumento:urlA}]});
    await database.query(`INSERT INTO ${schema}.despesas(politico_id,ano,mes,tipo_despesa,valor_documento,valor_liquido,nome_fornecedor,url_documento,raw_json)
      VALUES(900001,2022,4,'URL ambígua',10,10,'A',$1,$2)`,[urlB,JSON.stringify({sourceEntries:[{nomeFornecedor:'A',valorLiquido:5,urlDocumento:urlA},{nomeFornecedor:'A',valorLiquido:5,urlDocumento:urlB}]})]);
    expect(await get(`${profile}?ano=2022&mes=4`)).toMatchObject({total:1,totalValor:10,items:[{fornecedor:'A',urlDocumento:null}]});
    await database.query(`INSERT INTO ${schema}.despesas(politico_id,ano,mes,tipo_despesa,valor_documento,valor_liquido,nome_fornecedor,url_documento)
      VALUES(900001,2022,5,'Sem array',10,10,'A',$1)`,[urlA]);
    expect(await get(`${profile}?ano=2022&mes=5`)).toMatchObject({items:[{urlDocumento:urlA}]});
    await database.query(`INSERT INTO ${schema}.despesas(politico_id,ano,mes,tipo_despesa,valor_documento,valor_liquido,nome_fornecedor,url_documento,raw_json)
      VALUES(900001,2022,6,'URL única',10,10,'A',$1,$2)`,[urlB,JSON.stringify({sourceEntries:[{nomeFornecedor:'A',valorLiquido:4,urlDocumento:urlA},{nomeFornecedor:'A',valorLiquido:6,urlDocumento:urlA}]})]);
    expect(await get(`${profile}?ano=2022&mes=6`)).toMatchObject({total:1,totalValor:10,items:[{urlDocumento:urlA}]});
  });
});
