// @vitest-environment node
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {Pool} from 'pg';
import express from 'express';
import {readFile} from 'node:fs/promises';
import type {Server} from 'node:http';
import {randomUUID} from 'node:crypto';
import {attachJudicialRoutes} from './lib/judicialRoutes';
import {CatalogEvents} from './lib/catalogEvents';
const url=process.env.TEST_DATABASE_URL;
const fixture=(delta={})=>({kind:'CONVICTION',category:'CRIMINAL',caseNumber:'0001-23.2025',court:'Tribunal fictício',title:'Teste judicial',description:'Registro fictício apenas para testes',eventDate:'2025-01-01',convictionStatus:'FINAL',finalityDate:'2025-02-01',custodyType:null,custodyConfirmed:false,releasedAt:null,grounds:'Fundamento de teste',outcome:'Desfecho de teste',sourceUrl:'https://stf.jus.br/caso',sourceLabel:'Fonte oficial',verification:'VERIFIED',identityEvidence:'Identidade confirmada em documento oficial fictício',reviewNote:'Revisado em teste isolado',expectedVersion:0,...delta});
describe.skipIf(!url)('API judicial PostgreSQL isolado',()=>{
  const schema=`test_judicial_${randomUUID().replaceAll('-','')}`;let admin:Pool;let pool:Pool;let server:Server;let base:string;const events=new CatalogEvents(1);
  const auth={authorization:'Bearer teste','content-type':'application/json'};
  const request=async(path:string,body?:unknown,authenticated=true)=>{const res=await fetch(base+path,{method:body?'PUT':'GET',headers:authenticated?auth:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:res.status,data:await res.json()};};
  const recordPath=(id:string,p='1')=>`/api/admin/judicial/politicos/${p}/records/${id}`;
  beforeAll(async()=>{
    if(new URL(url!).pathname!=='/app_test')throw new Error('TEST_DATABASE_URL deve apontar ao banco app_test.');
    admin=new Pool({connectionString:url});await admin.query(`CREATE SCHEMA ${schema}`);
    const configured=new URL(url!);configured.searchParams.delete('schema');configured.searchParams.set('options',`-c search_path=${schema},public`);
    pool=new Pool({connectionString:configured.toString()});
    await pool.query('CREATE TABLE politicos(id bigint PRIMARY KEY,nome text,sigla_partido text,sigla_uf text,url_foto text,ativo boolean,situacao text)');
    await pool.query(await readFile('prisma/migrations/20261030030000_judicial_history/migration.sql','utf8'));
    await pool.query(await readFile('prisma/migrations/20261030120000_judicial_ingestion/migration.sql','utf8'));
    await pool.query(await readFile('prisma/migrations/20261030210000_judicial_proceedings/migration.sql','utf8'));
    await pool.query("INSERT INTO politicos VALUES(1,'Fictício A','TST','SP',null,true,'Exercício'),(2,'Fictício B','TST','RJ',null,true,'Exercício'),(3,'Fictício C','TST','MG',null,true,'Exercício'),(4,'Fictício D','TST','BA',null,false,'Fim')");
    const app=express();app.use(express.json());attachJudicialRoutes(app,pool,(req,res,next)=>{if(req.header('authorization')!=='Bearer teste'){res.status(401).json({error:'Sem autorização'});return;}next();},events);
    server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  },20000);
  afterAll(async()=>{events.close();if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));await pool?.end();await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin?.end();});
  it('protege todas as rotas administrativas',async()=>{
    for(const path of ['/api/admin/judicial/politicos/1','/api/admin/judicial/politicos/1/audit'])expect((await request(path,undefined,false)).status).toBe(401);
    expect((await request(recordPath(randomUUID()),fixture(),false)).status).toBe(401);
    expect((await request('/api/admin/judicial/politicos/1/coverage',{},false)).status).toBe(401);
  });
  it('retorna desconhecido e 404 sem confundir ausência com erro',async()=>{
    expect((await request('/api/politicos/1/judicial')).data.summary.finalConvictions).toBeNull();
    expect((await request('/api/politicos/999/judicial')).status).toBe(404);
    expect((await request('/api/politicos/invalido/judicial')).status).toBe(400);
  });
  it('publica verificados com auditoria privada, edição concorrente e dedupe',async()=>{
    const id=randomUUID();const created=await request(recordPath(id),fixture());expect(created.status).toBe(200);expect(created.data.version).toBe(1);
    const publicData=(await request('/api/politicos/1/judicial')).data;
    expect(publicData.summary.finalConvictions).toBe(1);expect(publicData.summary.coverage.status).toBe('PARTIAL');
    expect(JSON.stringify(publicData)).not.toMatch(/identityEvidence|reviewNote|Identidade confirmada/);
    expect((await request(recordPath(randomUUID()),fixture({caseNumber:'0001232025'}))).status).toBe(409);
    const concurrent=await Promise.all([request(recordPath(id),fixture({expectedVersion:1,outcome:'Correção A'})),request(recordPath(id),fixture({expectedVersion:1,outcome:'Correção B'}))]);
    expect(concurrent.map(x=>x.status).sort()).toEqual([200,409]);
    const audit=(await request('/api/admin/judicial/politicos/1/audit')).data.items;expect(audit).toHaveLength(2);expect(audit[0].before.version).toBe(1);expect(audit[0].after.version).toBe(2);
    expect((await request(recordPath(id),fixture({expectedVersion:2,verification:'DRAFT'}))).status).toBe(200);
    expect((await request('/api/politicos/1/judicial')).data.records).toEqual([]);
  });
  it('auditoria e escrita são atômicas, e FK impede apagar evidência',async()=>{
    await pool.query("CREATE FUNCTION reject_judicial_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'falha de teste'; END $$; CREATE TRIGGER test_reject_audit BEFORE INSERT ON judicial_audit FOR EACH ROW EXECUTE FUNCTION reject_judicial_audit()");
    const id=randomUUID();expect((await request(recordPath(id),fixture({caseNumber:'9999'}))).status).toBe(500);
    expect((await pool.query('SELECT id FROM judicial_records WHERE id=$1',[id])).rowCount).toBe(0);
    await pool.query('DROP TRIGGER test_reject_audit ON judicial_audit; DROP FUNCTION reject_judicial_audit()');
    await expect(pool.query('DELETE FROM politicos WHERE id=1')).rejects.toMatchObject({code:'23503'});
  });
  it('ranking calcula totais antes da página, categorias e desconhecidos ao final nas duas direções',async()=>{
    await request(recordPath(randomUUID(),'2'),fixture({caseNumber:'teste2'}));
    await request('/api/admin/judicial/politicos/3/coverage',{status:'REVIEWED',scope:'Consulta fictícia STF',sources:[{label:'STF',url:'https://stf.jus.br'}],expectedVersion:0});
    for(const direction of ['asc','desc']){
      const response=await request(`/api/judicial/ranking?limit=1&direction=${direction}`);expect(response.status).toBe(200);expect(response.data).toMatchObject({total:3,totalCadastrados:4,coverage:{reviewed:1,partial:1,notResearched:1}});
      expect(response.data.items[0].id).toBe(direction==='asc'?'3':'2');
      const last=(await request(`/api/judicial/ranking?offset=2&direction=${direction}`)).data;expect(last.items[0].id).toBe('1');
    }
    expect((await request('/api/judicial/ranking?offset=100')).data).toMatchObject({total:3,items:[]});
    expect((await request('/api/judicial/ranking?category=ELECTORAL&direction=desc')).data.items[0].judicial.counts.ELECTORAL.final).toBe(0);
    expect((await request('/api/judicial/ranking?search=%27%3BSELECT&status=todos')).data.total).toBe(0);
    expect((await request('/api/judicial/ranking?direction=garbage')).status).toBe(400);
  });
  it('publicação de prisão exige cumprimento confirmado e filtro distingue prisão de condenação',async()=>{
    const prison=fixture({kind:'IMPRISONMENT',convictionStatus:null,finalityDate:null,custodyType:'PREVENTIVE',caseNumber:'prison3',custodyConfirmed:false});
    expect((await request(recordPath(randomUUID(),'3'),prison)).status).toBe(400);
    expect((await request(recordPath(randomUUID(),'3'),{...prison,custodyConfirmed:true})).status).toBe(200);
    const result=(await request('/api/judicial/ranking?prisonOnly=true')).data;expect(result.total).toBe(1);expect(result.items[0].id).toBe('3');expect(result.items[0].judicial.finalConvictions).toBe(0);
  });
  it('anulação e troca de categoria mudam perfil e ordenação sem apagar a trilha',async()=>{
    const id=randomUUID();expect((await request(recordPath(id,'2'),fixture({caseNumber:'case-evolution'}))).status).toBe(200);
    expect((await request('/api/politicos/2/judicial')).data.summary.finalConvictions).toBe(2);
    expect((await request(recordPath(id,'2'),fixture({caseNumber:'case-evolution',expectedVersion:1,convictionStatus:'ANNULLED'}))).status).toBe(200);
    expect((await request('/api/politicos/2/judicial')).data.summary.finalConvictions).toBe(1);
    expect((await request(recordPath(id,'2'),fixture({caseNumber:'case-evolution',expectedVersion:2,category:'ELECTORAL'}))).status).toBe(200);
    const profile=(await request('/api/politicos/2/judicial')).data;
    expect(profile.summary.counts).toMatchObject({CRIMINAL:{final:1},ELECTORAL:{final:1}});
    const ranking=(await request('/api/judicial/ranking?category=ELECTORAL')).data;
    expect(ranking.items[0].id).toBe('2');expect(ranking.items[0].judicial).toEqual(profile.summary);
    expect(JSON.stringify(ranking)).not.toMatch(/identityEvidence|reviewNote|Identidade confirmada/);
    expect((await request('/api/admin/judicial/politicos/2')).data.records.some(r=>r.identityEvidence)).toBe(true);
  });
  it('rejeita URLs adversariais, corpos inválidos, datas impossíveis e repetição de query',async()=>{
    for(const delta of [{sourceUrl:'https://stf.jus.br.evil.example'},{sourceUrl:'https://secret:password@stf.jus.br'},{identityEvidence:'só nome'},{reviewNote:''},{finalityDate:null},{eventDate:'2025-02-30'},{eventDate:'2099-01-01'},{releasedAt:'2024-01-01'},{category:'UNKNOWN'},{expectedVersion:'0'}]){
      expect((await request(recordPath(randomUUID(),'2'),fixture(delta))).status).toBe(400);
    }
    expect((await request('/api/judicial/ranking?category=CRIMINAL&category=ELECTORAL')).status).toBe(400);
    expect((await request('/api/judicial/ranking?prisonOnly=yes')).status).toBe(400);
    expect((await request('/api/judicial/ranking?limit=1000')).status).toBe(400);
    expect((await request('/api/admin/judicial/politicos/3/coverage',{status:'REVIEWED',scope:'Teste',sources:[],expectedVersion:1})).status).toBe(400);
  });
  it('deduplica prisão por pessoa/processo/data/modalidade independentemente da categoria',async()=>{
    const repeated=fixture({kind:'IMPRISONMENT',convictionStatus:null,finalityDate:null,custodyType:'PREVENTIVE',caseNumber:'prison3',custodyConfirmed:true,category:'ELECTORAL'});
    expect((await request(recordPath(randomUUID(),'3'),repeated)).status).toBe(409);
    expect((await request(recordPath(randomUUID(),'3'),{...repeated,eventDate:'2025-01-02'})).status).toBe(200);
    expect((await request('/api/politicos/3/judicial')).data.summary.confirmedImprisonments).toBe(2);
  });
});
