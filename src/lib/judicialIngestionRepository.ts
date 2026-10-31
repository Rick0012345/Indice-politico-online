import type {Pool,PoolClient} from 'pg';
import {JudicialError,expectedVersion,validateJudicialRecord} from './judicialRules';
import {judicialTransaction,saveJudicialRecordInTransaction} from './judicialRepository';
import {assessJudicialEvidence} from './judicialEvidence';
import {judicialIngestionSources,type JudicialIngestionConfig,type JudicialIngestionRun,type JudicialSourceDocument,type JudicialCandidate} from './judicialIngestionTypes';

export function ingestionUuid(value:unknown):string {
  if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))throw new JudicialError('UUID inválido.');
  return value.toLowerCase();
}
export function ingestionPoliticoId(value:unknown):string {
  if(typeof value!=='string'||! /^[1-9]\d{0,18}$/.test(value)||BigInt(value)>9223372036854775807n)throw new JudicialError('Político inválido.');return value;
}
export function validateJudicialIngestionConfig(value:unknown):JudicialIngestionConfig {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new JudicialError('Configuração inválida.');
  const v=value as Record<string,unknown>;
  const sources=v.sources??['STF_NEWS','STJ_NEWS'];
  if(!Array.isArray(sources)||!sources.length||sources.length>Object.keys(judicialIngestionSources).length||sources.some(s=>typeof s!=='string'||!Object.hasOwn(judicialIngestionSources,s))||new Set(sources).size!==sources.length)throw new JudicialError('Fontes inválidas.');
  const onlyProceedings=sources.length===1&&sources[0]==='STF_CASES';
  const integer=(raw:unknown,fallback:number,max:number)=>{const n=raw??fallback;if(!Number.isInteger(n)||Number(n)<1||Number(n)>max)throw new JudicialError('Limite da coleta inválido.');return Number(n);};
  const status=v.status??'ativo';if(status!=='ativo'&&status!=='todos')throw new JudicialError('Situação inválida.');
  const afterId=v.afterId==null?null:ingestionPoliticoId(v.afterId);
  let politicoIds:string[]|undefined;
  if(v.politicoIds!==undefined){if(!Array.isArray(v.politicoIds)||!v.politicoIds.length||v.politicoIds.length>100)throw new JudicialError('Seleção inválida.');politicoIds=[...new Set(v.politicoIds.map(ingestionPoliticoId))].sort((a,b)=>BigInt(a)<BigInt(b)?-1:1);if(afterId)throw new JudicialError('Use seleção ou continuação.');}
  return {sources:[...sources].sort(),...(politicoIds?{politicoIds}:{}),status,afterId,maxPoliticians:integer(v.maxPoliticians,25,onlyProceedings?10000:100),maxPages:integer(v.maxPages,2,onlyProceedings?500:5)} as JudicialIngestionConfig;
}
export async function getJudicialIngestionRun(db:Pool|PoolClient,id:string,lock=false):Promise<JudicialIngestionRun & {active:boolean}> {
  const {rows}=await db.query(`SELECT data,EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=0 AND objid=7710042 AND objsubid=1 AND granted AND pid=r.lock_pid) AS active FROM judicial_ingestion_runs r WHERE id=$1${lock?' FOR UPDATE OF r':''}`,[id]);
  if(!rows.length)throw new JudicialError('Execução não encontrada.',404);return {...rows[0].data,active:rows[0].active};
}
export async function createJudicialIngestionRun(pool:Pool,id:string,config:JudicialIngestionConfig){
  return judicialTransaction(pool,async client=>{
    // Serialize a stable request UUID without colliding with the maintenance lock.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,42))',[id]);
    const existing=(await client.query('SELECT data FROM judicial_ingestion_runs WHERE id=$1',[id])).rows[0]?.data;
    if(existing){if(JSON.stringify(validateJudicialIngestionConfig(existing.config))!==JSON.stringify(config))throw new JudicialError('UUID já utilizado com outra configuração.',409,'JUDICIAL_RUN_CONFLICT');return existing as JudicialIngestionRun;}
    const {rows}=await client.query(`SELECT id::text,nome,nome_civil AS "nomeCivil" FROM politicos WHERE ($1='todos' OR COALESCE(ativo,true)) AND ($2::bigint IS NULL OR id>$2) AND ($3::bigint[] IS NULL OR id=ANY($3)) ORDER BY politicos.id LIMIT $4`,[config.status,config.afterId,config.politicoIds??null,config.maxPoliticians+1]);
    const more=rows.length>config.maxPoliticians;const people=rows.slice(0,config.maxPoliticians);
    const run:JudicialIngestionRun={id,status:'QUEUED',config,cursor:{personIndex:0,sourceIndex:0,page:1},people,processedPages:0,candidatesFound:0,errors:[],truncated:more,nextPoliticoId:more?people.at(-1)?.id??null:null,hasMorePoliticians:more,cancelRequested:false,heartbeatAt:null,startedAt:null,finishedAt:null};
    await persistJudicialIngestionRun(client,run,true);return run;
  });
}
export async function persistJudicialIngestionRun(client:PoolClient,run:JudicialIngestionRun,insert=false){
  if(insert)await client.query('INSERT INTO judicial_ingestion_runs(id,data) VALUES($1,$2::jsonb)',[run.id,JSON.stringify(run)]);
  else await client.query('UPDATE judicial_ingestion_runs SET data=$2::jsonb,updated_at=now() WHERE id=$1',[run.id,JSON.stringify(run)]);
}
export async function requestJudicialIngestionCancel(pool:Pool,id:string){return judicialTransaction(pool,async client=>{
  const run=await getJudicialIngestionRun(client,id,true);if(['QUEUED','RUNNING'].includes(run.status)){run.cancelRequested=true;if(!run.active){run.status='CANCELLED';run.finishedAt=new Date().toISOString();}await persistJudicialIngestionRun(client,run);}return run;
});}
export async function storeJudicialDocuments(client:PoolClient,run:JudicialIngestionRun,politicoId:string,documents:JudicialSourceDocument[]){
  let found=0;
  const person=run.people.find(item=>item.id===politicoId);
  if(!person)throw new JudicialError('Político fora da seleção desta coleta.');
  let existingKeys:Set<string>|undefined;
  for(const doc of documents){
    // Defense in depth against unexpectedly large upstream documents.
    if(doc.text.length>200000||doc.title.length>2000||doc.sourceKey.length>2048||JSON.stringify(doc.raw).length>1000000)throw new JudicialError('Documento excede o limite de armazenamento.');
    // A correction that removes the reported event still replaces the current
    // snapshot of an existing candidate, invalidating stale import requests.
    if(!assessJudicialEvidence(doc,person).length){
      // A feed may contain many unrelated observations; load associations once.
      existingKeys??=new Set((await client.query('SELECT source_id,source_key FROM judicial_candidates WHERE politico_id=$1',[politicoId])).rows.map(row=>JSON.stringify([row.source_id,row.source_key])));
      if(!existingKeys.has(JSON.stringify([doc.sourceId,doc.sourceKey])))continue;
    }
    const d=await client.query(`INSERT INTO judicial_source_documents(source_id,source_key,content_hash,payload) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(source_id,source_key,content_hash) DO UPDATE SET source_key=EXCLUDED.source_key RETURNING id`,[doc.sourceId,doc.sourceKey,doc.contentHash,JSON.stringify(doc)]);
    const documentId=d.rows[0].id;
    const candidate=await client.query(`INSERT INTO judicial_candidates(politico_id,source_id,source_key,document_id,matched_names) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(politico_id,source_id,source_key) DO UPDATE SET document_id=EXCLUDED.document_id,matched_names=EXCLUDED.matched_names,last_seen_at=now(),version=judicial_candidates.version+CASE WHEN judicial_candidates.document_id<>EXCLUDED.document_id THEN 1 ELSE 0 END,content_changed=judicial_candidates.content_changed OR judicial_candidates.document_id<>EXCLUDED.document_id RETURNING id,(xmax=0) AS inserted`,[politicoId,doc.sourceId,doc.sourceKey,documentId,JSON.stringify(doc.matchedNames)]);
    found+=Number(candidate.rows[0].inserted);
    await client.query('INSERT INTO judicial_candidate_evidence(candidate_id,document_id,run_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[candidate.rows[0].id,documentId,run.id]);
  }
  return found;
}
const candidateSelect=`SELECT c.id,c.politico_id::text AS "politicoId",p.nome AS "politicoName",p.nome_civil AS "nomeCivil",c.source_id AS "sourceId",(d.payload-'raw') || jsonb_build_object('matchedNames',c.matched_names) AS document,c.status,c.version,c.record_id AS "recordId",c.content_changed AS "contentChanged",c.first_seen_at AS "firstSeenAt",c.last_seen_at AS "lastSeenAt",c.review_note AS "reviewNote" FROM judicial_candidates c JOIN politicos p ON p.id=c.politico_id JOIN judicial_source_documents d ON d.id=c.document_id`;
function assessedCandidate(row:JudicialCandidate & {nomeCivil:string|null}):JudicialCandidate {
  const {nomeCivil,...candidate}=row;
  return {...candidate,evidence:assessJudicialEvidence(candidate.document,{id:candidate.politicoId,nome:candidate.politicoName,nomeCivil})};
}
export async function listJudicialCandidates(pool:Pool,politicoId:string|null,status:string,limit:number,offset:number):Promise<{items:JudicialCandidate[];total:number}>{return judicialTransaction(pool,async client=>{
  await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  const args=[politicoId,status];const where=' WHERE ($1::bigint IS NULL OR c.politico_id=$1) AND ($2=\'ALL\' OR c.status=$2)';
  const total=(await client.query(`SELECT count(*)::int AS total FROM judicial_candidates c${where}`,args)).rows[0].total;
  const items=(await client.query(`${candidateSelect}${where} ORDER BY c.last_seen_at DESC,c.id LIMIT $3 OFFSET $4`,[...args,limit,offset])).rows.map(assessedCandidate);return {items,total};
});}
export async function dismissJudicialCandidate(pool:Pool,id:string,version:number,note:string){return judicialTransaction(pool,async client=>{
  const row=(await client.query('SELECT * FROM judicial_candidates WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!row)throw new JudicialError('Candidato não encontrado.',404);
  if(row.version!==version)throw new JudicialError('Candidato alterado.',409,'JUDICIAL_VERSION_CONFLICT');
  if(row.status==='IMPORTED')throw new JudicialError('Candidato já importado.',409);
  await client.query("UPDATE judicial_candidates SET status='DISMISSED',review_note=$2,version=version+1 WHERE id=$1",[id,note]);
  return assessedCandidate((await client.query(`${candidateSelect} WHERE c.id=$1`,[id])).rows[0]);
});}
export async function importJudicialCandidate(pool:Pool,id:string,value:Record<string,unknown>){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new JudicialError('Importação inválida.');
  const recordId=ingestionUuid(value.recordId);const candidateVersion=expectedVersion(value.candidateVersion);const version=expectedVersion(value.expectedVersion);
  const input=validateJudicialRecord({...value,verification:'DRAFT'});
  return judicialTransaction(pool,async client=>{
    const candidate=(await client.query('SELECT * FROM judicial_candidates WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!candidate)throw new JudicialError('Candidato não encontrado.',404);
    if(candidate.status==='IMPORTED'&&candidate.record_id===recordId){
      // An imported version is incremented once. Changed evidence still conflicts.
      if(candidate.version!==candidateVersion+1||candidate.content_changed)throw new JudicialError('Evidência alterada após importação.',409,'JUDICIAL_VERSION_CONFLICT');
      const saved=(await client.query("SELECT payload,version,payload || jsonb_build_object('id',id::text,'politicoId',politico_id::text,'version',version,'checkedAt',checked_at,'updatedAt',updated_at) AS data FROM judicial_records WHERE id=$1",[recordId])).rows[0];
      if(saved.version!==version+1||JSON.stringify(validateJudicialRecord(saved.payload))!==JSON.stringify(input))throw new JudicialError('UUID de importação já utilizado com outro conteúdo ou versão.',409,'JUDICIAL_VERSION_CONFLICT');
      return saved.data;
    }
    if(candidate.status!=='PENDING'||candidate.version!==candidateVersion)throw new JudicialError('Candidato alterado ou já revisado.',409,'JUDICIAL_VERSION_CONFLICT');
    const snapshot=assessedCandidate((await client.query(`${candidateSelect} WHERE c.id=$1`,[id])).rows[0]);
    const evidence=snapshot.evidence!.filter(item=>item.kind===input.kind);
    if(!evidence.length)throw new JudicialError('O documento não relata explicitamente este tipo de fato atribuído ao político. Denúncias, pedidos e menções não comprovam condenação ou prisão cumprida.',422,'JUDICIAL_EVIDENCE_REQUIRED');
    if(input.kind==='CONVICTION'&&evidence.some(item=>item.status==='REVERSED')&&['APPEAL','FINAL'].includes(input.convictionStatus!))throw new JudicialError('O documento relata reversão ou anulação. Confira o desfecho; ele não pode ser importado como condenação vigente.',422,'JUDICIAL_EVIDENCE_REQUIRED');
    const record=await saveJudicialRecordInTransaction(client,String(candidate.politico_id),recordId,input,version);
    await client.query("UPDATE judicial_candidates SET status='IMPORTED',record_id=$2,version=version+1,content_changed=false,review_note=$3 WHERE id=$1",[id,recordId,input.reviewNote]);return record;
  });
}
