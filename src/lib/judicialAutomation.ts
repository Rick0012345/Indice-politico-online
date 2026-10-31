import {createHash} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {extractJudicialFacts} from './judicialAutoExtract';
import {judicialCaseKey,type JudicialRecordInput} from './judicialTypes';
import {validateJudicialRecord,JudicialError} from './judicialRules';
import {saveJudicialRecordInTransaction,judicialTransaction} from './judicialRepository';
import {acquireIngestionLock} from './ingestionLifecycle';
import type {JudicialAutomationResult,JudicialExtractedFact} from './judicialAutomationTypes';
import type {JudicialIngestionPerson,JudicialSourceDocument} from './judicialIngestionTypes';
import type {StfMovementReconciler} from './judicialStfMovements';

const VERSION='judicial-auto-2026-10-30.1';
export const emptyAutomationResult=():JudicialAutomationResult=>({created:0,updated:0,unchanged:0,unresolved:0,cases:0});
type Entry={fact:JudicialExtractedFact;candidateId:string;document:JudicialSourceDocument};
const stable=(value:unknown):string=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
const key=(fact:JudicialExtractedFact)=>`${fact.kind}:${fact.category}:${judicialCaseKey(fact)}`;
function recordId(person:string,caseKey:string){const hex=createHash('sha256').update(`${VERSION.split('.').slice(0,-1).join('.')}:${person}:${caseKey}`).digest('hex').slice(0,32);return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20)}`;}
function choose(entries:Entry[]):JudicialRecordInput {
  const sorted=[...entries].sort((a,b)=>(b.document.publishedAt??'').localeCompare(a.document.publishedAt??'')||a.document.url.localeCompare(b.document.url));
  const base=sorted[0].fact;
  // Later explicit changes outrank earlier ones; a news recap with no status
  // does not turn a documented definitive/reversed decision back into UNKNOWN.
  const status=sorted.find(entry=>entry.fact.convictionStatus&&entry.fact.convictionStatus!=='UNKNOWN')?.fact??base;
  const complete=sorted.find(entry=>entry.fact.grounds.length>0)?.fact??base;
  const latestOutcome=['Condenação relatada na fonte oficial.','Prisão efetiva relatada na fonte oficial.'].includes(base.outcome)?status.outcome:base.outcome;
  const {eventEvidence:_event,caseEvidence:_case,supportingEvidence:_supporting,...fields}=base;
  const sources=[...new Map(sorted.map(entry=>[entry.document.url,{url:entry.document.url,label:`${entry.fact.court} — ${entry.document.title}`.slice(0,200)}])).values()].sort((a,b)=>a.url.localeCompare(b.url)).slice(0,100);
  const dates=sorted.map(entry=>entry.fact.eventDate).filter((date):date is string=>!!date).sort();
  const published:JudicialRecordInput={...fields,title:`${base.kind==='CONVICTION'?'Condenação':'Prisão confirmada'} — ${base.caseNumber}`,description:complete.description.slice(0,8000),grounds:complete.grounds.slice(0,8000)||'Motivo não identificado no trecho oficial.',eventDate:dates[0]??null,convictionStatus:status.convictionStatus,finalityDate:status.finalityDate,outcome:latestOutcome,sourceUrl:base.sourceUrl,sourceLabel:base.sourceLabel.slice(0,200),sources,verification:'VERIFIED',identityEvidence:`O documento oficial identifica nominalmente ${sorted[0].document.matchedNames.join(' / ')} e seu cargo. Trecho: ${base.eventEvidence}`.slice(0,8000),reviewNote:`Consolidação automática ${VERSION}. Processo comprovado no trecho: ${base.caseEvidence}`.slice(0,8000),automation:{version:VERSION,candidateIds:[...new Set(sorted.map(entry=>entry.candidateId))].sort(),documentHashes:[...new Set(sorted.map(entry=>entry.document.contentHash))].sort()}};
  return validateJudicialRecord(published,{automated:true});
}

/** Runs inside the same transaction/checkpoint that owns the input evidence. */
export async function consolidateJudicialPerson(client:PoolClient,person:JudicialIngestionPerson,reconcile?:StfMovementReconciler,signal=new AbortController().signal):Promise<JudicialAutomationResult>{
  const result=emptyAutomationResult();
  await client.query('SELECT id FROM politicos WHERE id=$1 FOR UPDATE',[person.id]);
  const rows=(await client.query(`SELECT c.id,c.status,c.document_id,c.matched_names,d.payload FROM judicial_candidates c JOIN judicial_source_documents d ON d.id=c.document_id WHERE c.politico_id=$1 AND c.status<>'DISMISSED' ORDER BY c.id`,[person.id])).rows;
  const groups=new Map<string,Entry[]>();
  for(const row of rows){
    const document={...row.payload,matchedNames:row.matched_names} as JudicialSourceDocument;const extracted=extractJudicialFacts(document,person);
    if(!extracted.facts.length)result.unresolved++;
    for(const fact of extracted.facts){
      // Extracted claims must be backed by the stored snapshot, not free text.
      const text=`${document.title}\n${document.text}`;
      if([fact.eventEvidence,fact.caseEvidence,...(fact.supportingEvidence??[])].some(excerpt=>!text.includes(excerpt)))throw new JudicialError('Extração sem trecho de origem.',422,'JUDICIAL_EXTRACTION_INVALID');
      const group=groups.get(key(fact))??[];group.push({fact,candidateId:row.id,document});groups.set(key(fact),group);
    }
  }
  const existing=(await client.query('SELECT id::text,version,payload FROM judicial_records WHERE politico_id=$1 ORDER BY id FOR UPDATE',[person.id])).rows;
  const activeRecordIds=new Set<string>();
  for(const [caseKey,entries] of groups){
    let input=choose(entries);
    const found=existing.find(row=>key(row.payload)===caseKey);
    // Preserve explicit manual management; automatic evidence never overwrites it.
    if(found&&!found.payload.automation){result.unchanged++;result.cases++;continue;}
    if(reconcile&&input.kind==='CONVICTION'&&input.court==='STF'&&/^AP \d+$/.test(input.caseNumber)){
      const movement=await reconcile(person,input.caseNumber,signal);
      if(movement){
        // Finality of an acquittal is not finality of the earlier conviction.
        input={...input,convictionStatus:movement.convictionStatus??input.convictionStatus,finalityDate:null,outcome:movement.outcome,sourceUrl:movement.sourceUrl,sourceLabel:movement.sourceLabel,
          sources:[...(input.sources??[]).filter(source=>source.url!==movement.sourceUrl),{url:movement.sourceUrl,label:movement.sourceLabel}].sort((a,b)=>a.url.localeCompare(b.url)),
          automation:{...input.automation!,proceduralEvidence:{sourceUrl:movement.sourceUrl,snapshotHash:movement.snapshotHash,lookupSnapshotHash:movement.lookupSnapshotHash,caseNumber:movement.caseNumber,movementDate:movement.movementDate,eventEvidence:movement.eventEvidence}}};
        input=validateJudicialRecord(input,{automated:true});
      }
    }
    const id=found?.id??recordId(person.id,caseKey);activeRecordIds.add(id);
    if(found&&stable(found.payload)===stable(input))result.unchanged++;
    else {await saveJudicialRecordInTransaction(client,person.id,id,input,found?.version??0);if(found)result.updated++;else result.created++;}
    result.cases++;
    await client.query(`UPDATE judicial_candidates SET status='IMPORTED',record_id=COALESCE(record_id,$2::uuid),version=version+CASE WHEN status<>'IMPORTED' OR content_changed THEN 1 ELSE 0 END,content_changed=false,review_note=$3 WHERE id=ANY($1::uuid[])`,[input.automation!.candidateIds,id,`Dados consolidados automaticamente em ${input.court} / ${input.caseNumber}. Fontes originais preservadas.`]);
  }
  for(const old of existing){
    if(!old.payload.automation||old.payload.verification!=='VERIFIED'||activeRecordIds.has(old.id))continue;
    // If its current sources no longer support the claim, retain the audit trail
    // and withdraw public visibility instead of keeping stale assertions online.
    if(!old.payload.automation.candidateIds.some((id:string)=>rows.some(row=>row.id===id)))continue;
    await saveJudicialRecordInTransaction(client,person.id,old.id,{...old.payload,verification:'DRAFT',reviewNote:`${VERSION}: evidência atual insuficiente; publicação automática retirada, fontes preservadas.`},old.version);result.updated++;
    await client.query("UPDATE judicial_candidates SET status='PENDING',record_id=NULL,version=version+1 WHERE record_id=$1",[old.id]);
  }
  return result;
}

export async function consolidateJudicialCandidates(pool:Pool,reconcile?:StfMovementReconciler):Promise<JudicialAutomationResult>{
  const lock=await acquireIngestionLock(pool);if(!lock)throw new JudicialError('A coleta está em andamento. Os dados serão consolidados automaticamente ao avançar.',409,'INGESTION_BUSY');
  try {const people=(await pool.query(`SELECT DISTINCT p.id::text,p.nome,p.nome_civil AS "nomeCivil" FROM politicos p JOIN judicial_candidates c ON c.politico_id=p.id WHERE c.status<>'DISMISSED' ORDER BY p.id::text`)).rows;const result=emptyAutomationResult();for(const person of people){const current=await judicialTransaction(pool,client=>consolidateJudicialPerson(client,person,reconcile));for(const name of Object.keys(result) as Array<keyof JudicialAutomationResult>)result[name]+=current[name];}return result;}
  finally{await lock.release();}
}
