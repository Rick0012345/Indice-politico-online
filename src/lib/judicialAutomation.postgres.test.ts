// @vitest-environment node
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {beforeAll,afterAll,beforeEach,describe,it,expect} from 'vitest';
import {consolidateJudicialPerson} from './judicialAutomation';
import {createJudicialIngestionRun,validateJudicialIngestionConfig,storeJudicialDocuments} from './judicialIngestionRepository';
import {judicialTransaction,getJudicialProfile} from './judicialRepository';
import type {JudicialSourceDocument} from './judicialIngestionTypes';
const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('consolidação judicial automática PostgreSQL',()=>{
 const schema=`judicial_auto_${randomUUID().replaceAll('-','')}`;let admin:Pool,pool:Pool;
 const person={id:'1',nome:'João Exemplo',nomeCivil:'João Exemplo Civil'};
 const doc=(key:string,text:string):JudicialSourceDocument=>({sourceId:'STF_NEWS',sourceKey:key,url:`https://noticias.stf.jus.br/postsnoticias/${key}/`,title:'Decisão oficial',text,publishedAt:'2025-06-01T00:00:00Z',modifiedAt:null,contentHash:key+text,raw:{text},matchedNames:[person.nome],signals:['CONVICTION']});
 beforeAll(async()=>{if(new URL(url!).pathname!=='/app_test')throw new Error('Banco isolado obrigatório');admin=new Pool({connectionString:url});await admin.query(`CREATE SCHEMA "${schema}"`);const connection=new URL(url!);connection.searchParams.delete('schema');connection.searchParams.set('options',`-c search_path=${schema},public`);pool=new Pool({connectionString:connection.toString()});await pool.query('CREATE TABLE politicos(id bigint PRIMARY KEY,nome text,nome_civil text,ativo boolean)');for(const migration of ['20261030030000_judicial_history','20261030120000_judicial_ingestion','20261030210000_judicial_proceedings'])await pool.query(await readFile(`prisma/migrations/${migration}/migration.sql`,'utf8'));await pool.query("INSERT INTO politicos VALUES(1,'João Exemplo','João Exemplo Civil',true)");});
 beforeEach(async()=>{await pool.query('TRUNCATE judicial_process_pages,judicial_process_attempts,judicial_process_observations,judicial_candidate_evidence,judicial_candidates,judicial_source_documents,judicial_ingestion_runs,judicial_audit,judicial_records,judicial_coverage');});
 afterAll(async()=>{await pool?.end();await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await admin?.end();});
 async function collect(documents:JudicialSourceDocument[]){const run=await createJudicialIngestionRun(pool,randomUUID(),validateJudicialIngestionConfig({sources:['STF_NEWS'],politicoIds:['1']}));await judicialTransaction(pool,client=>storeJudicialDocuments(client,run,'1',documents));return judicialTransaction(pool,client=>consolidateJudicialPerson(client,person));}
 it('reúne notícias do mesmo processo e publica dados preenchidos sem intervenção',async()=>{
  const a=doc('a','O deputado João Exemplo foi condenado pelo STF por peculato na Ação Penal (AP) 1044.');
  const b=doc('b','O STF condenou o deputado João Exemplo por peculato na AP 1044.');
  expect(await collect([a,b])).toMatchObject({created:1,cases:1});const profile=await getJudicialProfile(pool,'1');
  expect(profile.records).toHaveLength(1);expect(profile.records[0]).toMatchObject({caseNumber:'AP 1044',court:'STF',eventDate:null,convictionStatus:'UNKNOWN',verification:'VERIFIED',sources:expect.arrayContaining([{url:a.url,label:expect.any(String)},{url:b.url,label:expect.any(String)}])});
  expect(profile.summary).toMatchObject({identifiedConvictions:1,finalConvictions:0});expect(profile.records[0]).not.toHaveProperty('automation');
  const audits=(await pool.query('SELECT COUNT(*)::int n FROM judicial_audit')).rows[0].n;
  expect(await judicialTransaction(pool,c=>consolidateJudicialPerson(c,person))).toMatchObject({created:0,updated:0,unchanged:1});expect((await pool.query('SELECT COUNT(*)::int n FROM judicial_audit')).rows[0].n).toBe(audits);
 });
 it('nega denúncia sem número comprovado e não transforma pedido de prisão em cumprimento',async()=>{
  await collect([doc('denuncia','A denúncia contra o deputado João Exemplo foi recebida na AP 1044. Foi decretada a prisão preventiva de João Exemplo.'),doc('sem-caso','O deputado João Exemplo foi condenado por peculato.')]);
  expect((await getJudicialProfile(pool,'1')).records).toEqual([]);
 });
 it('atualiza reversão sem duplicar a condenação e tira de contagem',async()=>{
  await collect([doc('a','O deputado João Exemplo foi condenado pelo STF por peculato na AP 1044.')]);
  const reversal={...doc('b','A condenação do deputado João Exemplo foi anulada pelo STF na AP 1044.'),publishedAt:'2025-07-01T00:00:00Z'};
  expect(await collect([reversal])).toMatchObject({created:0,updated:1});const profile=await getJudicialProfile(pool,'1');expect(profile.records).toHaveLength(1);expect(profile.records[0].convictionStatus).toBe('ANNULLED');expect(profile.summary.identifiedConvictions).toBe(0);
 });
 it('retira publicação automática se a única fonte corrige a atribuição',async()=>{
  await collect([doc('a','O deputado João Exemplo foi condenado pelo STF por peculato na AP 1044.')]);
  await collect([doc('a','Correção: João Exemplo não foi condenado. A decisão refere-se a outra pessoa na AP 1044.')]);
  expect((await getJudicialProfile(pool,'1')).records).toEqual([]);expect((await getJudicialProfile(pool,'1',true)).records[0].verification).toBe('DRAFT');
 });
 it('incorpora absolvição processual oficial sem repetir o caso ou a auditoria',async()=>{
  await collect([doc('a','O STF condenou o deputado João Exemplo por peculato na AP 1044.')]);
  const reconcile=async()=>({caseNumber:'AP 1044',incidentId:'123',sourceUrl:'https://portal.stf.jus.br/processos/abaAndamentos.asp?incidente=123&imprimir=',sourceLabel:'STF — andamentos oficiais de AP 1044',checkedAt:new Date().toISOString(),snapshotHash:'hash',lookupSnapshotHash:'lookup',lookupUrl:'https://portal.stf.jus.br/processos/detalhe.asp?incidente=123',outcome:'Ação penal julgada improcedente com absolvição nominal em decisão colegiada.',convictionStatus:'OVERTURNED' as const,movementDate:'2025-07-01',eventEvidence:'Decisão colegiada absolve João Exemplo Civil.',finalityDate:'2025-08-01',finalityEvidence:'Trânsito da absolvição.'});
  expect(await judicialTransaction(pool,c=>consolidateJudicialPerson(c,person,reconcile))).toMatchObject({updated:1,cases:1});
  const profile=await getJudicialProfile(pool,'1');expect(profile.records).toHaveLength(1);expect(profile.summary.identifiedConvictions).toBe(0);
  expect(profile.records[0]).toMatchObject({convictionStatus:'OVERTURNED',finalityDate:null,sources:expect.arrayContaining([{url:expect.stringContaining('abaAndamentos'),label:expect.any(String)}])});expect(profile.records[0]).not.toHaveProperty('automation');
  const audits=(await pool.query('SELECT COUNT(*)::int n FROM judicial_audit')).rows[0].n;
  expect(await judicialTransaction(pool,c=>consolidateJudicialPerson(c,person,reconcile))).toMatchObject({updated:0,unchanged:1});expect((await pool.query('SELECT COUNT(*)::int n FROM judicial_audit')).rows[0].n).toBe(audits);
 });
 it('mantém o indulto posterior no desfecho sem apagar o trânsito da condenação',async()=>{
  await collect([doc('a','O STF condenou o deputado João Exemplo por peculato na AP 1044. O STF declarou o trânsito em julgado da condenação em 10/05/2025.')]);
  const update={...doc('b','O ministro Edson Fachin, do Supremo Tribunal Federal (STF), declarou extintas as penas privativas de liberdade impostas ao deputado João Exemplo na Ação Penal (AP) 1044. O indulto abrange apenas as penas privativas de liberdade, ficando mantidos os demais efeitos da condenação.'),publishedAt:'2025-07-01T00:00:00Z'};
  await collect([update]);const profile=await getJudicialProfile(pool,'1');expect(profile.records).toHaveLength(1);expect(profile.records[0]).toMatchObject({convictionStatus:'FINAL',outcome:expect.stringContaining('indulto')});
 });
});
