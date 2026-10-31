// @vitest-environment node
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import express from 'express';
import type {Server} from 'node:http';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {acquireIngestionLock} from './ingestionLifecycle';
import {createJudicialIngestionRun,dismissJudicialCandidate,getJudicialIngestionRun,importJudicialCandidate,listJudicialCandidates,requestJudicialIngestionCancel,validateJudicialIngestionConfig} from './judicialIngestionRepository';
import {createJudicialIngestionWorker} from './judicialIngestionWorker';
import {attachJudicialIngestionRoutes} from './judicialIngestionRoutes';
import {getJudicialProfile} from './judicialRepository';
import {getProceedingCoverageStats,getProceedingSummaries} from './judicialProceedingsRepository';
import {OfficialJudicialSourceError} from './officialJudicialHttp';
import type {JudicialPageCollector,JudicialSourceDocument} from './judicialIngestionTypes';

describe('validação coleta judicial',()=>{
  it('normaliza limites e rejeita fontes, seleção e números inválidos',()=>{
    expect(validateJudicialIngestionConfig({})).toMatchObject({maxPoliticians:25,maxPages:2,status:'ativo'});
    expect(validateJudicialIngestionConfig({sources:['STF_CASES'],status:'todos',maxPoliticians:10000,maxPages:500})).toMatchObject({maxPoliticians:10000,maxPages:500,status:'todos'});
    for(const value of [{sources:['OTHER']},{sources:['STF_NEWS','STF_NEWS']},{maxPoliticians:101},{maxPages:6},{maxPages:'2'},{politicoIds:['-1']},{afterId:'1',politicoIds:['2']},{status:'inativo'}])expect(()=>validateJudicialIngestionConfig(value)).toThrow();
  });
});
const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('coleta judicial durável PostgreSQL isolado',()=>{
  const schema=`judicial_ingest_${randomUUID().replaceAll('-','')}`;let admin:Pool,pool:Pool;
  const config=()=>validateJudicialIngestionConfig({sources:['STF_NEWS'],maxPoliticians:1,maxPages:2});
  const doc=(hash='hash1'):JudicialSourceDocument=>({sourceId:'STF_NEWS',sourceKey:'doc1',url:'https://noticias.stf.jus.br/doc1',title:'Documento oficial fictício',text:'Pessoa A foi condenada pelo STF por peculato.',contentHash:hash,publishedAt:'2025-01-01',modifiedAt:null,raw:{privateEvidence:'original'},matchedNames:['Pessoa A'],signals:['CONVICTION']});
  const fixture=(extra={})=>({kind:'CONVICTION',category:'CRIMINAL',caseNumber:'0001-2025',court:'STF',title:'Registro de teste',description:'Descrição fictícia para teste isolado',eventDate:'2025-01-01',finalityDate:'2025-02-01',releasedAt:null,convictionStatus:'FINAL',custodyType:null,custodyConfirmed:false,grounds:'Fundamento fictício',outcome:'Desfecho fictício',sourceUrl:'https://noticias.stf.jus.br/doc1',sourceLabel:'STF notícia',verification:'VERIFIED',identityEvidence:'Identidade conferida pelo operador do teste',reviewNote:'Revisão fictícia em teste',expectedVersion:0,candidateVersion:1,recordId:randomUUID(),...extra});
  beforeAll(async()=>{
    if(new URL(url!).pathname!=='/app_test')throw new Error('Apenas app_test é permitido.');
    admin=new Pool({connectionString:url});await admin.query(`CREATE SCHEMA "${schema}"`);
    const configured=new URL(url!);configured.searchParams.delete('schema');configured.searchParams.set('options',`-c search_path=${schema},public`);pool=new Pool({connectionString:configured.toString(),max:8});
    await pool.query('CREATE TABLE politicos(id bigint PRIMARY KEY,nome text,nome_civil text,ativo boolean)');
    for(const path of ['20261030030000_judicial_history','20261030120000_judicial_ingestion','20261030210000_judicial_proceedings'])await pool.query(await readFile(`prisma/migrations/${path}/migration.sql`,'utf8'));
    await pool.query("INSERT INTO politicos VALUES(1,'Pessoa A','Pessoa A Civil',true),(2,'Pessoa B',null,true),(3,'Pessoa C',null,false)");
  },20000);
  beforeEach(async()=>{await pool.query('TRUNCATE judicial_process_pages,judicial_process_attempts,judicial_process_observations,judicial_candidate_evidence,judicial_candidates,judicial_source_documents,judicial_ingestion_runs,judicial_audit,judicial_records,judicial_coverage');});
  afterAll(async()=>{await pool?.end();await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await admin?.end();});
  async function collectOne(hash='hash1'){
    const id=randomUUID();await createJudicialIngestionRun(pool,id,config());
    const worker=createJudicialIngestionWorker(pool,()=>async()=>({documents:[doc(hash)],hasMore:false,scope:'teste'}));await worker.start(id);await worker.wait(id);return id;
  }
  it('UUID idempotente preserva seleção e conflito não cria execução',async()=>{
    const id=randomUUID();const first=await createJudicialIngestionRun(pool,id,config());expect(first.people.map(p=>p.id)).toEqual(['1']);expect(first).toMatchObject({hasMorePoliticians:true,nextPoliticoId:'1',truncated:true});
    expect(await createJudicialIngestionRun(pool,id,config())).toEqual(first);
    await expect(createJudicialIngestionRun(pool,id,validateJudicialIngestionConfig({maxPages:3}))).rejects.toMatchObject({status:409});
    expect((await pool.query('SELECT count(*)::int n FROM judicial_ingestion_runs')).rows[0].n).toBe(1);
  });
  it('ordena IDs numericamente e continua sem pular pessoas entre 9 e 10',async()=>{
    await pool.query("INSERT INTO politicos VALUES(9,'Pessoa Nove',null,true),(10,'Pessoa Dez',null,true)");
    try {
      const first=await createJudicialIngestionRun(pool,randomUUID(),validateJudicialIngestionConfig({sources:['STF_NEWS'],status:'todos',maxPoliticians:4}));
      expect(first.people.map(person=>person.id)).toEqual(['1','2','3','9']);expect(first.nextPoliticoId).toBe('9');
      const next=await createJudicialIngestionRun(pool,randomUUID(),validateJudicialIngestionConfig({sources:['STF_NEWS'],status:'todos',maxPoliticians:4,afterId:first.nextPoliticoId}));
      expect(next.people.map(person=>person.id)).toEqual(['10']);
    } finally {await pool.query('DELETE FROM politicos WHERE id IN (9,10)');}
  });
  it('deduplica evidências, preserva versões alteradas e não publica nem marca cobertura',async()=>{
    const id=await collectOne();expect(await getJudicialIngestionRun(pool,id)).toMatchObject({status:'COMPLETED',processedPages:1,candidatesFound:1,active:false});
    await collectOne();expect((await pool.query('SELECT count(*)::int n FROM judicial_candidates')).rows[0].n).toBe(1);
    await collectOne('hash2');const {items,total}=await listJudicialCandidates(pool,null,'PENDING',25,0);expect(total).toBe(1);expect(items[0]).toMatchObject({version:2,contentChanged:true});expect(items[0].document).not.toHaveProperty('raw');
    expect((await pool.query('SELECT count(*)::int n FROM judicial_source_documents')).rows[0].n).toBe(2);
    expect((await pool.query('SELECT count(*)::int n FROM judicial_candidate_evidence')).rows[0].n).toBe(3);
    expect(await getJudicialProfile(pool,'1')).toMatchObject({records:[],summary:{coverage:{status:'NOT_RESEARCHED'}}});
  });
  it('importa DRAFT atomicamente com auditoria, idempotência, privacidade e versão',async()=>{
    await collectOne();const candidate=(await listJudicialCandidates(pool,null,'PENDING',25,0)).items[0];const input=fixture();
    const [saved,repeated]=await Promise.all([importJudicialCandidate(pool,candidate.id,input),importJudicialCandidate(pool,candidate.id,input)]);expect(saved).toMatchObject({verification:'DRAFT',version:1});expect(repeated).toEqual(saved);
    expect(await importJudicialCandidate(pool,candidate.id,input)).toEqual(saved);
    await expect(importJudicialCandidate(pool,candidate.id,{...input,title:'Outro conteúdo revisado'})).rejects.toMatchObject({status:409});
    await expect(importJudicialCandidate(pool,candidate.id,{...input,expectedVersion:1})).rejects.toMatchObject({status:409});
    expect((await pool.query('SELECT count(*)::int n FROM judicial_audit')).rows[0].n).toBe(1);
    expect((await getJudicialProfile(pool,'1')).records).toEqual([]);
    await expect(importJudicialCandidate(pool,candidate.id,fixture())).rejects.toMatchObject({status:409});
    await collectOne('changed');await expect(importJudicialCandidate(pool,candidate.id,input)).rejects.toMatchObject({status:409});
  });
  it('documento sobre duas pessoas mantém a correspondência nominal em cada candidato',async()=>{
    const id=randomUUID();await createJudicialIngestionRun(pool,id,validateJudicialIngestionConfig({sources:['STF_NEWS'],maxPoliticians:2}));
    const worker=createJudicialIngestionWorker(pool,()=>async(_source,person)=>({documents:[{...doc(),text:'Pessoa A foi condenada pelo STF por peculato. Pessoa B foi presa pela Polícia Federal.',matchedNames:[person.nome]}],hasMore:false,scope:'teste'}));
    await worker.start(id);await worker.wait(id);const {items}=await listJudicialCandidates(pool,null,'ALL',25,0);
    expect(items).toHaveLength(2);for(const c of items){expect(c.document.matchedNames).toEqual([c.politicoName]);expect(c.evidence).toEqual([expect.objectContaining({matchedName:c.politicoName,kind:c.politicoId==='1'?'CONVICTION':'IMPRISONMENT'})]);}
    expect((await pool.query('SELECT count(*)::int n FROM judicial_source_documents')).rows[0].n).toBe(1);
  });
  it('ignora denúncias e fatos de terceiros mesmo se o coletor enviar signals positivos',async()=>{
    const id=randomUUID();await createJudicialIngestionRun(pool,id,config());
    const worker=createJudicialIngestionWorker(pool,()=>async()=>({documents:[{...doc(),text:'STF recebeu denúncia contra Pessoa A. Pessoa B foi condenada por peculato.'}],hasMore:false,scope:'teste'}));
    await worker.start(id);await worker.wait(id);
    expect(await getJudicialIngestionRun(pool,id)).toMatchObject({status:'COMPLETED',candidatesFound:0});
    expect((await listJudicialCandidates(pool,null,'PENDING',25,0)).total).toBe(0);
  });
  it('atualização sem evidência preserva novo snapshot e invalida importação da versão antiga',async()=>{
    await collectOne();const original=(await listJudicialCandidates(pool,null,'PENDING',25,0)).items[0];
    const id=randomUUID();await createJudicialIngestionRun(pool,id,config());
    const worker=createJudicialIngestionWorker(pool,()=>async()=>({documents:[],observedDocuments:[{...doc('corrected'),text:'STF recebeu denúncia contra Pessoa A. O pedido de prisão foi negado.'}],hasMore:false,scope:'teste'}));
    await worker.start(id);await worker.wait(id);
    const current=(await listJudicialCandidates(pool,null,'PENDING',25,0)).items[0];
    expect(current).toMatchObject({id:original.id,version:2,contentChanged:true,evidence:[],document:{contentHash:'corrected'}});
    expect((await pool.query('SELECT count(*)::int n FROM judicial_source_documents')).rows[0].n).toBe(2);
    expect((await pool.query('SELECT count(*)::int n FROM judicial_candidate_evidence')).rows[0].n).toBe(2);
    await expect(importJudicialCandidate(pool,current.id,fixture())).rejects.toMatchObject({code:'JUDICIAL_VERSION_CONFLICT'});
    await expect(importJudicialCandidate(pool,current.id,fixture({candidateVersion:2}))).rejects.toMatchObject({code:'JUDICIAL_EVIDENCE_REQUIRED'});
  });
  it('bloqueia importação de candidato legado sem evidência positiva e não cria registro',async()=>{
    await collectOne();const candidate=(await listJudicialCandidates(pool,null,'PENDING',25,0)).items[0];
    await pool.query("UPDATE judicial_source_documents SET payload=jsonb_set(payload,'{text}',to_jsonb($1::text))",['STF recebeu denúncia contra Pessoa A. O pedido de prisão foi negado.']);
    expect((await listJudicialCandidates(pool,null,'PENDING',25,0)).items[0].evidence).toEqual([]);
    await expect(importJudicialCandidate(pool,candidate.id,fixture())).rejects.toMatchObject({code:'JUDICIAL_EVIDENCE_REQUIRED'});
    expect((await pool.query('SELECT count(*)::int n FROM judicial_records')).rows[0].n).toBe(0);
  });
  it('não transforma condenação em prisão nem reversão em condenação vigente',async()=>{
    await collectOne();const candidate=(await listJudicialCandidates(pool,null,'PENDING',25,0)).items[0];
    await expect(importJudicialCandidate(pool,candidate.id,fixture({kind:'IMPRISONMENT',convictionStatus:null,finalityDate:null,custodyType:'PREVENTIVE',custodyConfirmed:true}))).rejects.toMatchObject({code:'JUDICIAL_EVIDENCE_REQUIRED'});
    await pool.query("UPDATE judicial_source_documents SET payload=jsonb_set(payload,'{text}',to_jsonb($1::text))",['A condenação de Pessoa A foi anulada pelo STF.']);
    await expect(importJudicialCandidate(pool,candidate.id,fixture())).rejects.toMatchObject({code:'JUDICIAL_EVIDENCE_REQUIRED'});
    expect(await importJudicialCandidate(pool,candidate.id,fixture({convictionStatus:'ANNULLED',finalityDate:null}))).toMatchObject({verification:'DRAFT',convictionStatus:'ANNULLED'});
  });
  it('falha na auditoria desfaz candidato e registro conjuntamente',async()=>{
    await collectOne();const candidate=(await listJudicialCandidates(pool,null,'PENDING',25,0)).items[0];
    await pool.query("CREATE FUNCTION fail_ingest_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture'; END $$;CREATE TRIGGER fail_audit BEFORE INSERT ON judicial_audit FOR EACH ROW EXECUTE FUNCTION fail_ingest_audit()");
    try {await expect(importJudicialCandidate(pool,candidate.id,fixture())).rejects.toThrow();expect((await listJudicialCandidates(pool,null,'PENDING',25,0)).items[0].version).toBe(1);expect((await pool.query('SELECT count(*)::int n FROM judicial_records')).rows[0].n).toBe(0);}
    finally{await pool.query('DROP TRIGGER fail_audit ON judicial_audit;DROP FUNCTION fail_ingest_audit()');}
  });
  it('cancelamento durante HTTP impede documentos e checkpoint posteriores',async()=>{
    const id=randomUUID();await createJudicialIngestionRun(pool,id,config());let release!:()=>void,entered!:()=>void;
    const enteredPromise=new Promise<void>(resolve=>{entered=resolve;});const blocked=new Promise<void>(resolve=>{release=resolve;});
    const worker=createJudicialIngestionWorker(pool,()=>async()=>{entered();await blocked;return {documents:[doc()],hasMore:false,scope:'teste'};});
    await worker.start(id);await enteredPromise;expect((await getJudicialIngestionRun(pool,id)).active).toBe(true);
    await requestJudicialIngestionCancel(pool,id);release();await worker.wait(id);
    expect(await getJudicialIngestionRun(pool,id)).toMatchObject({status:'CANCELLED',processedPages:0,cursor:{personIndex:0,page:1}});expect((await listJudicialCandidates(pool,null,'ALL',25,0)).total).toBe(0);
    await worker.start(id,true);await worker.wait(id);expect((await getJudicialIngestionRun(pool,id)).status).toBe('COMPLETED');
  });
  it('documentos e cursor fazem rollback juntos e retomada reaproveita o checkpoint',async()=>{
    const id=randomUUID();await createJudicialIngestionRun(pool,id,config());let invalid=true;
    const worker=createJudicialIngestionWorker(pool,()=>async()=>({documents:invalid?[doc(),{...doc(),sourceKey:'oversize',text:'x'.repeat(200001)}]:[doc()],hasMore:false,scope:'teste'}));
    await worker.start(id);await worker.wait(id);expect(await getJudicialIngestionRun(pool,id)).toMatchObject({status:'FAILED',processedPages:0,cursor:{personIndex:0,page:1}});
    expect((await pool.query('SELECT count(*)::int n FROM judicial_source_documents')).rows[0].n).toBe(0);expect((await listJudicialCandidates(pool,null,'ALL',25,0)).total).toBe(0);
    invalid=false;await worker.start(id,true);await worker.wait(id);expect(await getJudicialIngestionRun(pool,id)).toMatchObject({status:'COMPLETED',processedPages:1,candidatesFound:1});
  });
  it('fechar worker persiste cancelamento e aborta HTTP sem avançar cursor',async()=>{
    const id=randomUUID();await createJudicialIngestionRun(pool,id,config());let entered!:()=>void;
    const enteredPromise=new Promise<void>(resolve=>{entered=resolve;});
    const worker=createJudicialIngestionWorker(pool,()=>async(_source,_person,_page,signal)=>{entered();await new Promise<void>((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));return {documents:[doc()],hasMore:false,scope:'teste'};});
    await worker.start(id);await enteredPromise;await worker.close();
    expect(await getJudicialIngestionRun(pool,id)).toMatchObject({status:'CANCELLED',cancelRequested:true,processedPages:0,cursor:{personIndex:0,page:1}});
    expect((await listJudicialCandidates(pool,null,'ALL',25,0)).total).toBe(0);
    const resumed=createJudicialIngestionWorker(pool,()=>async()=>({documents:[],hasMore:false,scope:'teste'}));await resumed.start(id,true);await resumed.wait(id);expect((await getJudicialIngestionRun(pool,id)).status).toBe('COMPLETED');
  });
  it('perda da conexão do lock aborta proprietário antigo e impede checkpoint sobre nova execução',async()=>{
    const id=randomUUID();await createJudicialIngestionRun(pool,id,config());let entered!:()=>void,release!:()=>void;let signal:AbortSignal;
    const enteredPromise=new Promise<void>(resolve=>{entered=resolve;});const blocked=new Promise<void>(resolve=>{release=resolve;});
    const stale=createJudicialIngestionWorker(pool,()=>async(_source,_person,_page,s)=>{signal=s;entered();await blocked;return {documents:[{...doc(),sourceKey:'stale'}],hasMore:false,scope:'teste'};});
    await stale.start(id);await enteredPromise;
    const pid=(await pool.query('SELECT lock_pid FROM judicial_ingestion_runs WHERE id=$1',[id])).rows[0].lock_pid;
    await pool.query('SELECT pg_terminate_backend($1)',[pid]);
    await new Promise<void>(resolve=>{if(signal.aborted)resolve();else signal.addEventListener('abort',()=>resolve(),{once:true});});
    expect(await getJudicialIngestionRun(pool,id)).toMatchObject({status:'RUNNING',active:false,processedPages:0});
    const fresh=createJudicialIngestionWorker(pool,()=>async()=>({documents:[{...doc(),sourceKey:'fresh'}],hasMore:false,scope:'teste'}));await fresh.start(id,true);await fresh.wait(id);
    release();await stale.wait(id);
    expect(await getJudicialIngestionRun(pool,id)).toMatchObject({status:'COMPLETED',processedPages:1});
    expect((await listJudicialCandidates(pool,null,'ALL',25,0)).items.map(c=>c.document.sourceKey)).toEqual(['fresh']);
  });
  it('lock compartilhado bloqueia execução/limpeza e crash exige retomada explícita',async()=>{
    const id=randomUUID();await createJudicialIngestionRun(pool,id,config());const lock=await acquireIngestionLock(pool);expect(lock).not.toBeNull();
    const worker=createJudicialIngestionWorker(pool,()=>async()=>({documents:[],hasMore:false,scope:'teste'}));
    try {await expect(worker.start(id)).rejects.toMatchObject({status:409});expect((await getJudicialIngestionRun(pool,id)).active).toBe(false);}finally{await lock!.release();}
    await pool.query(`UPDATE judicial_ingestion_runs SET data=jsonb_set(data,'{status}','"RUNNING"') WHERE id=$1`,[id]);
    await worker.start(id);expect((await getJudicialIngestionRun(pool,id)).status).toBe('RUNNING');expect((await getJudicialIngestionRun(pool,id)).processedPages).toBe(0);
    await worker.start(id,true);await worker.wait(id);expect((await getJudicialIngestionRun(pool,id)).status).toBe('COMPLETED');
  });
  it('erro de fonte é PARTIAL e paginação limitada sinaliza truncamento',async()=>{
    const id=randomUUID();await createJudicialIngestionRun(pool,id,validateJudicialIngestionConfig({sources:['STF_NEWS','STJ_NEWS'],maxPoliticians:1,maxPages:1}));
    const collector:JudicialPageCollector=async source=>{if(source==='STJ_NEWS')throw new Error('upstream private token');return {documents:[doc()],hasMore:true,scope:'teste'};};
    const worker=createJudicialIngestionWorker(pool,()=>collector);await worker.start(id);await worker.wait(id);
    expect(await getJudicialIngestionRun(pool,id)).toMatchObject({status:'PARTIAL',truncated:true,processedPages:2});expect(JSON.stringify(await getJudicialIngestionRun(pool,id))).not.toContain('upstream private token');
  });
  it('descarte concorrente respeita versão',async()=>{
    await collectOne();const candidate=(await listJudicialCandidates(pool,null,'PENDING',25,0)).items[0];
    expect(await dismissJudicialCandidate(pool,candidate.id,1,'Não corresponde')).toMatchObject({status:'DISMISSED',version:2});await expect(dismissJudicialCandidate(pool,candidate.id,1,'Duplicado')).rejects.toMatchObject({status:409});
  });
  it('pesquisa todos inclusive inativos, persiste cobertura por página e separa falha de zero',async()=>{
    const id=randomUUID();await createJudicialIngestionRun(pool,id,validateJudicialIngestionConfig({sources:['STF_CASES'],status:'todos',maxPoliticians:10000,maxPages:500}));
    const worker=createJudicialIngestionWorker(pool,()=>async(_source,person,page)=>{
      if(person.id==='2')throw new Error('Falha externa privada');
      return {documents:[],hasMore:person.id==='1'&&page===1,scope:'STF',proceedings:{observations:[],nominalMatches:0,errors:[]}};
    });
    await worker.start(id);await worker.wait(id);
    expect(await getJudicialIngestionRun(pool,id)).toMatchObject({status:'PARTIAL',processedPages:4,cursor:{personIndex:3,page:1}});
    const summaries=await getProceedingSummaries(pool,['1','2','3']);
    expect(summaries.get('1')).toMatchObject({againstPerson:0,coverage:{status:'COMPLETE'}});
    expect(summaries.get('2')).toMatchObject({againstPerson:null,coverage:{status:'FAILED'}});
    expect(summaries.get('3')).toMatchObject({againstPerson:0,coverage:{status:'COMPLETE'}});
    expect(await getProceedingCoverageStats(pool)).toMatchObject({total:3,researched:3,complete:2,failed:1,notResearched:0});
    expect((await pool.query('SELECT count(*)::int n FROM judicial_records')).rows[0].n).toBe(0);
  });
  it('não trata coletor incompatível ou truncamento de processos como consulta vazia completa',async()=>{
    for(const missing of [true,false]){
      const id=randomUUID();await createJudicialIngestionRun(pool,id,validateJudicialIngestionConfig({sources:['STF_CASES'],politicoIds:['1'],maxPages:1}));
      const worker=createJudicialIngestionWorker(pool,()=>async()=>({documents:[],hasMore:!missing,scope:'STF',...(missing?{}:{proceedings:{observations:[],nominalMatches:0,errors:[]}})}));
      await worker.start(id);await worker.wait(id);
      expect((await getJudicialIngestionRun(pool,id)).status).toBe('PARTIAL');
      expect((await getProceedingSummaries(pool,['1'])).get('1')).toMatchObject({againstPerson:null,coverage:{status:missing?'FAILED':'PARTIAL'}});
    }
  });
  it('cancelamento entre páginas retoma o mesmo checkpoint processual sem duplicar páginas',async()=>{
    const id=randomUUID();await createJudicialIngestionRun(pool,id,validateJudicialIngestionConfig({sources:['STF_CASES'],politicoIds:['1'],maxPages:3}));
    let entered!:()=>void;const enteredPromise=new Promise<void>(resolve=>{entered=resolve;});
    const worker=createJudicialIngestionWorker(pool,()=>async(_source,_person,page,signal)=>{
      if(page===2){entered();await new Promise<void>((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('cancelado')),{once:true}));}
      return {documents:[],hasMore:true,scope:'STF',proceedings:{observations:[],nominalMatches:0,errors:[]}};
    });
    await worker.start(id);await enteredPromise;await worker.close();
    expect(await getJudicialIngestionRun(pool,id)).toMatchObject({status:'CANCELLED',processedPages:1,cursor:{personIndex:0,page:2}});
    const resumed=createJudicialIngestionWorker(pool,()=>async()=>({documents:[],hasMore:false,scope:'STF',proceedings:{observations:[],nominalMatches:0,errors:[]}}));
    await resumed.start(id,true);await resumed.wait(id);
    expect(await getJudicialIngestionRun(pool,id)).toMatchObject({status:'COMPLETED',processedPages:2,cursor:{personIndex:1,page:1}});
    expect((await pool.query('SELECT count(*)::int n FROM judicial_process_pages WHERE run_id=$1',[id])).rows[0].n).toBe(2);
    expect((await getProceedingSummaries(pool,['1'])).get('1')?.coverage.status).toBe('COMPLETE');
  });
  it('bloqueio oficial interrompe o lote sem insistir em todas as pessoas nem perder a retomada',async()=>{
    const id=randomUUID();await createJudicialIngestionRun(pool,id,validateJudicialIngestionConfig({sources:['STF_CASES'],status:'todos',maxPoliticians:10000,maxPages:500}));
    let calls=0,blocked=true;
    const worker=createJudicialIngestionWorker(pool,()=>async()=>{
      calls++;if(blocked)throw new OfficialJudicialSourceError('Fonte oficial indisponível (HTTP 403).',403);
      return {documents:[],hasMore:false,scope:'STF',proceedings:{observations:[],nominalMatches:0,errors:[]}};
    });
    await worker.start(id);await worker.wait(id);expect(calls).toBe(1);
    expect(await getJudicialIngestionRun(pool,id)).toMatchObject({status:'FAILED',processedPages:0,cursor:{personIndex:0,page:1},lastError:'Fonte oficial indisponível (HTTP 403).'});
    expect(await getProceedingCoverageStats(pool)).toMatchObject({researched:0,notResearched:3});
    blocked=false;await worker.start(id,true);await worker.wait(id);
    expect(await getJudicialIngestionRun(pool,id)).toMatchObject({status:'COMPLETED',processedPages:3,lastError:null});
    expect(await getProceedingCoverageStats(pool)).toMatchObject({researched:3,complete:3});
  });
  it('todas as rotas administrativas exigem autorização',async()=>{
    const app=express();app.use(express.json());const worker=attachJudicialIngestionRoutes(app,pool,(_req,res)=>{res.status(401).json({error:'unauthorized'});},()=>async()=>({documents:[],hasMore:false,scope:'teste'}));
    const server:Server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api/admin/judicial/ingestion`;
    try {for(const [method,path] of [['GET','/sources'],['GET','/runs'],['GET',`/runs/${randomUUID()}`],['PUT',`/runs/${randomUUID()}`],['PUT',`/runs/${randomUUID()}/resume`],['PUT',`/runs/${randomUUID()}/cancel`],['GET','/candidates'],['PUT',`/candidates/${randomUUID()}/import`],['PUT',`/candidates/${randomUUID()}/dismiss`]])expect((await fetch(base+path,{method})).status).toBe(401);}
    finally{await worker.close();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });
});
