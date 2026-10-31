// @vitest-environment node
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {getProceedingCoverageStats,getProceedings,getProceedingSummaries,storeProceedingPage} from './judicialProceedingsRepository';
import {proceedingRankingSql} from './judicialQueries';
import type {ProceedingObservation,ProceedingPage} from './judicialProceedingsTypes';

const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('processos identificados PostgreSQL isolado',()=>{
 const schema=`processes_${randomUUID().replaceAll('-','')}`;let admin:Pool,pool:Pool;
 const observation=(sourceKey:string,delta:Partial<ProceedingObservation>={}):ProceedingObservation=>({sourceId:'STF_CASES',sourceKey,sourcePersonId:'PRIVATE_PERSON',court:'STF',caseNumber:`AP ${sourceKey}`,cnjNumber:'0000000-00.2020.1.00.0001',phase:'ACTION',status:'ACTIVE',filedAt:'2020-01-01',subjects:['Teste'],roles:[{role:'DEFENDANT',label:'Réu'}],sourceUrl:`https://portal.stf.jus.br/processos/detalhe.asp?incidente=${sourceKey}`,sourceLabel:'STF',fetchedAt:'2026-10-30T12:00:00Z',contentHash:'PRIVATE_HASH',identity:'CONFIRMED',identityEvidence:[{method:'VERIFIED_CASE',url:'https://stf.jus.br/teste',excerpt:'PRIVATE_EVIDENCE'}],...delta});
 beforeAll(async()=>{
  if(new URL(url!).pathname!=='/app_test')throw new Error('Apenas app_test é permitido.');
  admin=new Pool({connectionString:url});await admin.query(`CREATE SCHEMA "${schema}"`);
  const configured=new URL(url!);configured.searchParams.delete('schema');configured.searchParams.set('options',`-c search_path=${schema},public`);pool=new Pool({connectionString:configured.toString()});
  await pool.query('CREATE TABLE politicos(id bigint PRIMARY KEY,nome text)');
  for(const path of ['20261030030000_judicial_history','20261030120000_judicial_ingestion','20261030210000_judicial_proceedings'])await pool.query(await readFile(`prisma/migrations/${path}/migration.sql`,'utf8'));
  await pool.query("INSERT INTO politicos VALUES(1,'Pessoa A'),(2,'Pessoa B'),(3,'Pessoa C'),(4,'Pessoa D')");
 },20000);
 beforeEach(async()=>{await pool.query('TRUNCATE judicial_process_pages,judicial_process_attempts,judicial_process_observations,judicial_candidate_evidence,judicial_ingestion_runs');});
 afterAll(async()=>{await pool?.end();await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await admin?.end();});
 async function save(id:string,observations:ProceedingObservation[],options:{runId?:string;page?:number;done?:boolean;truncated?:boolean;error?:string;result?:ProceedingPage|null}={}){
  const runId=options.runId??randomUUID();await pool.query("INSERT INTO judicial_ingestion_runs(id,data) VALUES($1,'{}') ON CONFLICT DO NOTHING",[runId]);
  const client=await pool.connect();try{await client.query('BEGIN');await storeProceedingPage(client,{runId,politicoId:id,page:options.page??1,result:options.result===undefined?{observations,nominalMatches:observations.length,errors:[]}:options.result,done:options.done??true,truncated:options.truncated??false,error:options.error??null});await client.query('COMMIT');}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}return runId;
 }
 it('consolida AP/PET por CNJ, preserva papéis e não publica evidência privada',async()=>{
  const runId=await save('1',[observation('1'),observation('2',{caseNumber:'PET 20'}),observation('3',{cnjNumber:null,roles:[{role:'AUTHOR',label:'Autor'}]}),observation('4',{cnjNumber:null,phase:'INVESTIGATION',roles:[{role:'INVESTIGATED',label:'Investigado'}]}),observation('5',{cnjNumber:null,phase:'ENFORCEMENT'}),observation('6',{cnjNumber:null,roles:[{role:'APPELLEE',label:'Recorrido'}]})]);
  expect((await getProceedingSummaries(pool,['1'])).get('1')).toMatchObject({identified:5,againstPerson:1,activeAgainstPerson:1,investigations:1,enforcements:1,coverage:{status:'COMPLETE',unresolved:0}});
  const cases=await getProceedings(pool,'1');expect(cases).toHaveLength(5);expect(cases.find(c=>c.cnjNumber)).toMatchObject({aliases:['AP 1','PET 20'],countsAgainstPerson:true});
  expect(JSON.stringify(cases)).not.toMatch(/PRIVATE_|identityEvidence|sourcePersonId|contentHash|lastSeenRunId/);
  await save('1',[observation('1')],{runId});
  expect((await pool.query('SELECT processed_pages,nominal_matches FROM judicial_process_attempts')).rows[0]).toMatchObject({processed_pages:1,nominal_matches:6});
 });
 it('distingue desconhecido, zero no escopo, homônimo, erro e limite inferior positivo',async()=>{
  expect((await getProceedingSummaries(pool,['1'])).get('1')).toMatchObject({identified:null,againstPerson:null,coverage:{status:'NOT_RESEARCHED'}});
  await save('1',[]);await save('2',[observation('2',{identity:'UNRESOLVED'})]);await save('3',[],{result:null,error:'Fonte indisponível'});await save('4',[observation('4')],{done:false});
  const summaries=await getProceedingSummaries(pool,['1','2','3','4']);
  expect(summaries.get('1')).toMatchObject({identified:0,againstPerson:0,coverage:{status:'COMPLETE'}});
  expect(summaries.get('2')).toMatchObject({identified:null,againstPerson:null,coverage:{status:'PARTIAL',unresolved:1}});
  expect(await getProceedings(pool,'2')).toEqual([]);
  expect(summaries.get('3')).toMatchObject({identified:null,againstPerson:null,coverage:{status:'FAILED'}});
  expect(summaries.get('4')).toMatchObject({identified:1,againstPerson:1,investigations:null,coverage:{status:'PARTIAL'}});
  expect(await getProceedingCoverageStats(pool)).toMatchObject({total:4,researched:4,complete:1,partial:2,failed:1,notResearched:0,confirmedCases:1,unresolved:1});
 });
 it('erro parcial ou truncamento impede zero e mantém histórico das tentativas',async()=>{
  const runId=await save('1',[],{done:false});await save('1',[],{runId,page:2,result:null,error:'Detalhe indisponível'});
  expect((await getProceedingSummaries(pool,['1'])).get('1')).toMatchObject({againstPerson:null,coverage:{status:'PARTIAL'}});
  await save('1',[],{truncated:true});expect((await getProceedingSummaries(pool,['1'])).get('1')?.againstPerson).toBeNull();
  await save('1',[]);expect((await getProceedingSummaries(pool,['1'])).get('1')?.againstPerson).toBe(0);
  expect((await pool.query('SELECT count(*)::int n FROM judicial_process_attempts WHERE politico_id=1')).rows[0].n).toBe(3);
 });
 it('ranking ordena antes da página com desconhecidos no fim em ambas direções',async()=>{
  await save('1',[]);await save('2',[observation('21'),observation('22',{cnjNumber:null})]);await save('3',[observation('31')],{done:false});
  const sql=proceedingRankingSql();
  for(const direction of ['ASC','DESC']){
   const rows=(await pool.query(`SELECT p.id::text FROM politicos p ${sql.joins} ORDER BY ${sql.known} DESC,${sql.count} ${direction},p.id LIMIT 4`)).rows;
   expect(rows.map(r=>r.id)).toEqual(direction==='ASC'?['1','3','2','4']:['2','3','1','4']);
  }
 });
 it('não interpreta situação processual desconhecida como ausência de casos ativos',async()=>{
  await save('1',[observation('1',{status:'UNKNOWN'})]);
  expect((await getProceedingSummaries(pool,['1'])).get('1')).toMatchObject({identified:1,againstPerson:1,activeAgainstPerson:null,coverage:{status:'COMPLETE'}});
  await save('2',[observation('2',{status:'INACTIVE'})]);
  expect((await getProceedingSummaries(pool,['2'])).get('2')?.activeAgainstPerson).toBe(0);
  await save('3',[observation('3',{status:'UNKNOWN'}),observation('4',{cnjNumber:null,status:'ACTIVE'})]);
  expect((await getProceedingSummaries(pool,['3'])).get('3')?.activeAgainstPerson).toBe(1);
 });
 it('preserva CNJ e autuação conhecidos quando a mesma referência volta sem esses dados',async()=>{
  await save('1',[observation('1',{status:'INACTIVE'}),observation('2',{caseNumber:'PET 20',status:'INACTIVE'})]);
  await save('1',[observation('1',{cnjNumber:null,filedAt:null,status:'UNKNOWN'})]);
  const cases=await getProceedings(pool,'1');
  expect(cases).toHaveLength(1);
  expect(cases[0]).toMatchObject({cnjNumber:'0000000-00.2020.1.00.0001',filedAt:'2020-01-01',aliases:['AP 1','PET 20'],status:'UNKNOWN'});
  const stored=(await pool.query("SELECT canonical_key,payload FROM judicial_process_observations WHERE politico_id=1 AND source_key='1'")).rows[0];
  expect(stored.canonical_key).toBe('CNJ:00000000020201000001');
  expect(stored.payload).toMatchObject({cnjNumber:'0000000-00.2020.1.00.0001',filedAt:'2020-01-01',status:'UNKNOWN'});
  expect((await getProceedingSummaries(pool,['1'])).get('1')).toMatchObject({identified:1,againstPerson:1,activeAgainstPerson:null});
 });
 it('nova consulta completa vazia preserva identidade histórica sem reafirmar situação ativa',async()=>{
  await save('1',[observation('1')]);
  await save('1',[]);
  expect((await getProceedingSummaries(pool,['1'])).get('1')).toMatchObject({identified:1,againstPerson:1,activeAgainstPerson:null,coverage:{status:'PARTIAL'}});
  expect(await getProceedings(pool,'1')).toMatchObject([{status:'UNKNOWN',countsAgainstPerson:true,checkedAt:'2026-10-30T12:00:00Z'}]);
  expect(await getProceedingCoverageStats(pool)).toMatchObject({complete:0,partial:1,confirmedCases:1});
  const stored=(await pool.query('SELECT identity,payload FROM judicial_process_observations')).rows[0];
  expect(stored).toMatchObject({identity:'CONFIRMED',payload:{status:'ACTIVE'}});
  await save('2',[observation('2',{roles:[{role:'AUTHOR',label:'Autor'}]})]);await save('2',[]);
  expect((await getProceedingSummaries(pool,['2'])).get('2')).toMatchObject({identified:1,againstPerson:null,activeAgainstPerson:null,coverage:{status:'PARTIAL'}});
  const ranking=proceedingRankingSql();
  expect((await pool.query(`SELECT ${ranking.known} AS known FROM politicos p ${ranking.joins} WHERE p.id=2`)).rows[0].known).toBe(false);
 });
 it('falha ou consulta parcial não apaga histórico nem transforma situação antiga em atual',async()=>{
  await save('1',[observation('1')]);await save('1',[],{result:null,error:'Fonte indisponível'});
  expect((await getProceedingSummaries(pool,['1'])).get('1')).toMatchObject({identified:1,activeAgainstPerson:null,coverage:{status:'FAILED'}});
  await save('1',[],{done:false});
  expect((await getProceedingSummaries(pool,['1'])).get('1')).toMatchObject({identified:1,activeAgainstPerson:null,coverage:{status:'PARTIAL'}});
  expect(await getProceedings(pool,'1')).toHaveLength(1);
 });
 it('reobservação de um alias canônico atualiza situação sem herdar ACTIVE antigo de outro alias',async()=>{
  await save('1',[observation('1'),observation('2',{caseNumber:'PET 20'})]);
  await save('1',[observation('1',{status:'INACTIVE'})]);
  expect((await getProceedingSummaries(pool,['1'])).get('1')).toMatchObject({identified:1,againstPerson:1,activeAgainstPerson:0,coverage:{status:'COMPLETE'}});
  expect(await getProceedings(pool,'1')).toMatchObject([{status:'INACTIVE',aliases:['AP 1','PET 20']}]);
 });
 it('observações legadas sem marcador mantêm história com situação ainda não revalidada',async()=>{
  await save('1',[observation('1')]);await pool.query("UPDATE judicial_process_observations SET payload=payload-'lastSeenRunId'");
  expect((await getProceedingSummaries(pool,['1'])).get('1')).toMatchObject({identified:1,activeAgainstPerson:null,coverage:{status:'PARTIAL'}});
  expect(await getProceedings(pool,'1')).toMatchObject([{status:'UNKNOWN'}]);
 });
});
