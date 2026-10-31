import type {Pool} from 'pg';
import type {JudicialIngestionPerson,JudicialPageCollector} from './judicialIngestionTypes';
import type {ProceedingPerson} from './judicialProceedingsTypes';
import type {OfficialJudicialHttpOptions} from './officialJudicialHttp';
import {createStfProceedingsCollector} from './judicialStfProceedings';
import {getProceedingAnchors} from './judicialProceedingsRepository';
import {anchorsFromOfficialNews} from './judicialProceedingsIdentity';

/** Both the Admin action and CLI share identity resolution and the same collector. */
export function withProceedingsCollector(pool:Pool,fallback:JudicialPageCollector,options:OfficialJudicialHttpOptions&{cacheDir?:string;resume?:boolean}={}):JudicialPageCollector{
 const collect=createStfProceedingsCollector(options);
 const people=new Map<string,Promise<ProceedingPerson>>();
 async function enriched(person:JudicialIngestionPerson):Promise<ProceedingPerson>{
  const anchors=await getProceedingAnchors(pool,person.id);
  const {rows}=await pool.query(`SELECT d.payload->>'text' AS text,d.payload->>'url' AS url
   FROM judicial_candidates c JOIN judicial_source_documents d ON d.id=c.document_id
   WHERE c.politico_id=$1 AND d.source_id='STF_NEWS'`,[person.id]);
  for(const document of rows)anchors.push(...anchorsFromOfficialNews(document,person));
  const birth=(await pool.query("SELECT to_jsonb(p)->>'data_nascimento' AS birth FROM politicos p WHERE id=$1",[person.id])).rows[0]?.birth??null;
  const unique=[...new Map(anchors.map(anchor=>[JSON.stringify([anchor.court,anchor.caseNumber,anchor.sourceUrl]),anchor])).values()];
  return {...person,birthDate:birth,anchors:unique};
 }
 return async(source,person,page,signal)=>{
  if(source!=='STF_CASES')return fallback(source,person,page,signal);
  signal.throwIfAborted();let pending=people.get(person.id);
  if(!pending){pending=enriched(person);people.set(person.id,pending);}
  try{return {documents:[],...await collect(await pending,page,signal)};}
  catch(error){people.delete(person.id);throw error;}
 };
}
