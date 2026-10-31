import type {Pool,PoolClient} from 'pg';
import type {JudicialProceeding,ProceedingAnchor,ProceedingObservation,ProceedingPage,ProceedingsSummary} from './judicialProceedingsTypes';

type Db=Pool|PoolClient;
export const proceedingScope='Consulta nominal pública do STF, em tramitação e fora de tramitação; limitada às páginas consultadas e aos vínculos de identidade comprovados. Não inclui todos os tribunais ou processos sigilosos.';
const sourceUrl='https://portal.stf.jus.br/processos/';
const sourceLabel='STF — consulta processual pública';
const against=(o:ProceedingObservation)=>!['INVESTIGATION','ENFORCEMENT'].includes(o.phase)&&o.roles.some(r=>r.role==='DEFENDANT'||r.role==='RESPONDENT');
const canonical=(o:ProceedingObservation)=>o.cnjNumber?.replace(/\D/g,'').length===20?`CNJ:${o.cnjNumber.replace(/\D/g,'')}`:`STF:${o.sourceKey}`;
export const proceedingLatestAttemptSql=`SELECT DISTINCT ON(politico_id) * FROM judicial_process_attempts ORDER BY politico_id,started_at DESC,run_id DESC`;
// A newer attempt cannot refresh an older observation by absence. Legacy rows
// without a run marker remain historical until the source revalidates them.
const currentObservation=`COALESCE(o.payload->>'lastSeenRunId'=latest.run_id::text,false)`;

/** Shared grouped SQL: count each canonical case once, preserving the role/phase association. */
export function proceedingAggregateSql(){return `SELECT politico_id,count(*)::int AS identified,
 count(*) FILTER(WHERE against_person)::int AS against_person,
 count(*) FILTER(WHERE active_against_person)::int AS active_against_person,
 count(*) FILTER(WHERE unknown_active_against)::int AS unknown_active_against,
 count(*) FILTER(WHERE stale)::int AS stale,
 count(*) FILTER(WHERE investigation)::int AS investigations,count(*) FILTER(WHERE enforcement)::int AS enforcements
 FROM (SELECT politico_id,canonical_key,
 bool_or(payload->>'phase' NOT IN ('INVESTIGATION','ENFORCEMENT') AND payload->'roles' @> '[{"role":"DEFENDANT"}]'::jsonb OR payload->>'phase' NOT IN ('INVESTIGATION','ENFORCEMENT') AND payload->'roles' @> '[{"role":"RESPONDENT"}]'::jsonb) AS against_person,
 bool_or(${currentObservation} AND payload->>'status'='ACTIVE' AND payload->>'phase' NOT IN ('INVESTIGATION','ENFORCEMENT') AND (payload->'roles' @> '[{"role":"DEFENDANT"}]'::jsonb OR payload->'roles' @> '[{"role":"RESPONDENT"}]'::jsonb)) AS active_against_person,
 (bool_or(${currentObservation} AND payload->>'status'='UNKNOWN' AND payload->>'phase' NOT IN ('INVESTIGATION','ENFORCEMENT') AND (payload->'roles' @> '[{"role":"DEFENDANT"}]'::jsonb OR payload->'roles' @> '[{"role":"RESPONDENT"}]'::jsonb))
 OR NOT bool_or(${currentObservation}) AND bool_or(payload->>'phase' NOT IN ('INVESTIGATION','ENFORCEMENT') AND (payload->'roles' @> '[{"role":"DEFENDANT"}]'::jsonb OR payload->'roles' @> '[{"role":"RESPONDENT"}]'::jsonb))) AS unknown_active_against,
 NOT bool_or(${currentObservation}) AS stale,
 bool_or(payload->>'phase'='INVESTIGATION') AS investigation,bool_or(payload->>'phase'='ENFORCEMENT') AS enforcement
 FROM judicial_process_observations o LEFT JOIN (${proceedingLatestAttemptSql}) latest USING(politico_id) WHERE identity='CONFIRMED' GROUP BY politico_id,canonical_key) cases GROUP BY politico_id`;}
export const proceedingUnresolvedSql=`SELECT politico_id,count(*)::int AS unresolved FROM judicial_process_observations WHERE identity='UNRESOLVED' GROUP BY politico_id`;

/** Must run in the worker transaction with the durable cursor checkpoint. */
export async function storeProceedingPage(client:PoolClient,input:{runId:string;politicoId:string;page:number;result:ProceedingPage|null;done:boolean;truncated:boolean;error:string|null}):Promise<void>{
 const {runId,politicoId,page,result,done,truncated,error}=input;
 await client.query(`INSERT INTO judicial_process_attempts(run_id,politico_id,source_id,status) VALUES($1,$2,'STF_CASES','RUNNING') ON CONFLICT DO NOTHING`,[runId,politicoId]);
 await client.query(`SELECT run_id FROM judicial_process_attempts WHERE run_id=$1 AND politico_id=$2 AND source_id='STF_CASES' FOR UPDATE`,[runId,politicoId]);
 const errors=[...(result?.errors??[]),...(error?[error]:[])];
 const saved=await client.query(`INSERT INTO judicial_process_pages(run_id,politico_id,source_id,page,succeeded,nominal_matches,errors) VALUES($1,$2,'STF_CASES',$3,$4,$5,$6::jsonb) ON CONFLICT DO NOTHING RETURNING page`,[runId,politicoId,page,result!==null,result?.nominalMatches??0,JSON.stringify(errors)]);
 if(!saved.rowCount)return;
 for(const observation of result?.observations??[]){
  // Missing immutable metadata does not undo a previously established case link.
  // Mutable status and identity still come from the newest observation. The run
  // marker is private storage metadata, omitted by the explicit public projection.
  await client.query(`INSERT INTO judicial_process_observations(politico_id,source_id,source_key,canonical_key,identity,payload) VALUES($1,'STF_CASES',$2,$3,$4,$5::jsonb)
   ON CONFLICT(politico_id,source_id,source_key) DO UPDATE SET
   canonical_key=CASE WHEN EXCLUDED.payload->>'cnjNumber' IS NULL AND judicial_process_observations.payload->>'cnjNumber' IS NOT NULL THEN judicial_process_observations.canonical_key ELSE EXCLUDED.canonical_key END,
   identity=EXCLUDED.identity,payload=EXCLUDED.payload || jsonb_build_object(
    'cnjNumber',COALESCE(EXCLUDED.payload->>'cnjNumber',judicial_process_observations.payload->>'cnjNumber'),
    'filedAt',COALESCE(EXCLUDED.payload->>'filedAt',judicial_process_observations.payload->>'filedAt')),updated_at=now()`,[politicoId,observation.sourceKey,canonical(observation),observation.identity,JSON.stringify({...observation,lastSeenRunId:runId})]);
 }
 await client.query(`UPDATE judicial_process_attempts a SET processed_pages=s.pages,nominal_matches=s.matches,errors=s.errors,truncated=a.truncated OR $3,
 status=CASE WHEN NOT $4 THEN 'RUNNING' WHEN s.successes=0 THEN 'FAILED' WHEN jsonb_array_length(s.errors)>0 OR a.truncated OR $3 THEN 'PARTIAL' ELSE 'COMPLETE' END,
 checked_at=CASE WHEN $4 THEN now() ELSE NULL END,updated_at=now()
 FROM (SELECT count(*)::int pages,sum(nominal_matches)::int matches,count(*) FILTER(WHERE succeeded)::int successes,
 COALESCE((SELECT jsonb_agg(e.value) FROM judicial_process_pages p2 CROSS JOIN LATERAL jsonb_array_elements(p2.errors) e WHERE p2.run_id=$1 AND p2.politico_id=$2),'[]'::jsonb) errors
 FROM judicial_process_pages WHERE run_id=$1 AND politico_id=$2) s WHERE a.run_id=$1 AND a.politico_id=$2 AND a.source_id='STF_CASES'`,[runId,politicoId,truncated,done]);
}

export async function getProceedingSummaries(db:Db,ids:readonly string[]):Promise<Map<string,ProceedingsSummary>>{
 if(!ids.length)return new Map();
 const {rows}=await db.query(`SELECT p.id::text,c.*,a.status,a.checked_at,a.started_at,u.unresolved FROM politicos p
 LEFT JOIN (${proceedingAggregateSql()}) c ON c.politico_id=p.id LEFT JOIN (${proceedingLatestAttemptSql}) a ON a.politico_id=p.id
 LEFT JOIN (${proceedingUnresolvedSql}) u ON u.politico_id=p.id WHERE p.id=ANY($1::bigint[])`,[[...new Set(ids)]]);
 return new Map(rows.map(row=>{
  const unresolved=row.unresolved??0;const stale=Number(row.stale??0);const zeroKnown=row.status==='COMPLETE'&&unresolved===0&&stale===0;
  const count=(name:string)=>Number(row[name]??0)>0?Number(row[name]):zeroKnown?0:null;
  const activeCount=count('active_against_person');
  const date=(value:unknown)=>value instanceof Date?value.toISOString():typeof value==='string'?value:null;
  const status:ProceedingsSummary['coverage']['status']=row.status==='COMPLETE'?(unresolved||stale?'PARTIAL':'COMPLETE'):row.status==='FAILED'?'FAILED':row.status?'PARTIAL':Number(row.identified??0)>0||unresolved?'PARTIAL':'NOT_RESEARCHED';
  return [row.id,{identified:count('identified'),againstPerson:count('against_person'),activeAgainstPerson:activeCount===0&&Number(row.unknown_active_against??0)>0?null:activeCount,investigations:count('investigations'),enforcements:count('enforcements'),coverage:{status,scope:proceedingScope,sourceLabel,sourceUrl,checkedAt:date(row.checked_at),attemptedAt:date(row.started_at),unresolved}}];
 }));
}
export async function getProceedings(db:Db,id:string):Promise<JudicialProceeding[]>{
 const {rows}=await db.query(`SELECT canonical_key,payload,${currentObservation} AS current FROM judicial_process_observations o LEFT JOIN (${proceedingLatestAttemptSql}) latest USING(politico_id) WHERE politico_id=$1 AND identity='CONFIRMED' ORDER BY canonical_key,source_key`,[id]);
 const currentStatuses=new Map<string,ProceedingObservation['status'][]>();
 const groups=new Map<string,ProceedingObservation[]>();for(const row of rows){const group=groups.get(row.canonical_key)??[];group.push(row.payload);groups.set(row.canonical_key,group);if(row.current)currentStatuses.set(row.canonical_key,[...(currentStatuses.get(row.canonical_key)??[]),row.payload.status]);}
 return [...groups].map(([key,observations])=>{
  const ordered=[...observations].sort((a,b)=>(a.phase==='ACTION'?-1:0)-(b.phase==='ACTION'?-1:0)||a.caseNumber.localeCompare(b.caseNumber));const first=ordered[0];
  const roles=[...new Map(observations.flatMap(o=>o.roles).map(r=>[`${r.role}:${r.label}`,r])).values()];
  const statuses=currentStatuses.get(key)??[];
  return {id:key,court:first.court,caseNumber:first.caseNumber,cnjNumber:first.cnjNumber,aliases:[...new Set(observations.map(o=>o.caseNumber))].sort(),phase:first.phase,status:statuses.includes('ACTIVE')?'ACTIVE':statuses.length&&statuses.every(status=>status==='INACTIVE')?'INACTIVE':'UNKNOWN',filedAt:observations.map(o=>o.filedAt).filter((v):v is string=>!!v).sort()[0]??null,subjects:[...new Set(observations.flatMap(o=>o.subjects))].sort(),roles,countsAgainstPerson:observations.some(against),sources:[...new Map(observations.map(o=>[o.sourceUrl,{url:o.sourceUrl,label:o.sourceLabel}])).values()],checkedAt:observations.map(o=>o.fetchedAt).sort().at(-1)!};
 });
}
export async function getProceedingAnchors(db:Db,id:string):Promise<ProceedingAnchor[]>{
 const {rows}=await db.query(`SELECT payload FROM judicial_records WHERE politico_id=$1 AND verification='VERIFIED' ORDER BY id`,[id]);
 return rows.map(({payload:p})=>({court:p.court,caseNumber:p.caseNumber,sourceUrl:p.sourceUrl,excerpt:p.identityEvidence||p.description||p.title}));
}
export async function getProceedingCoverageStats(db:Db){
 const {rows}=await db.query(`SELECT count(*)::int total,count(*) FILTER(WHERE a.politico_id IS NOT NULL)::int researched,
 count(*) FILTER(WHERE a.status='COMPLETE' AND COALESCE(u.unresolved,0)=0 AND COALESCE(c.stale,0)=0)::int complete,
 count(*) FILTER(WHERE a.status IN ('RUNNING','PARTIAL') OR a.status='COMPLETE' AND (COALESCE(u.unresolved,0)>0 OR COALESCE(c.stale,0)>0))::int partial,
 count(*) FILTER(WHERE a.status='FAILED')::int failed,count(*) FILTER(WHERE a.politico_id IS NULL)::int "notResearched",
 COALESCE(sum(c.identified),0)::int "confirmedCases",COALESCE(sum(u.unresolved),0)::int unresolved
 FROM politicos p LEFT JOIN (${proceedingLatestAttemptSql}) a ON a.politico_id=p.id LEFT JOIN (${proceedingAggregateSql()}) c ON c.politico_id=p.id LEFT JOIN (${proceedingUnresolvedSql}) u ON u.politico_id=p.id`);
 return rows[0] as {total:number;researched:number;complete:number;partial:number;failed:number;notResearched:number;confirmedCases:number;unresolved:number};
}
