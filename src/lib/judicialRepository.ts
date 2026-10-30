import type {Pool,PoolClient} from 'pg';
import {JudicialError,normalizeCase,publicRecord,summarizeJudicial} from './judicialRules';
import type {JudicialAdminRecord,JudicialRecordInput,JudicialCoverage,JudicialRankingResponse,JudicialAdminProfile} from './judicialTypes';
type Db=Pool|PoolClient;
const recordJson=(alias='r')=>`${alias}.payload || jsonb_build_object('id',${alias}.id::text,'politicoId',${alias}.politico_id::text,'version',${alias}.version,'checkedAt',${alias}.checked_at,'updatedAt',${alias}.updated_at)`;
const coverageJson=`jsonb_build_object('status',c.status,'scope',c.scope,'sources',c.sources,'version',c.version,'checkedAt',c.checked_at)`;
async function exists(db:Db,id:string,lock=false){const r=await db.query(`SELECT id FROM politicos WHERE id=$1${lock?' FOR UPDATE':''}`,[id]);if(!r.rowCount)throw new JudicialError('Político não encontrado.',404,'JUDICIAL_NOT_FOUND');}
async function transaction<T>(pool:Pool,fn:(db:PoolClient)=>Promise<T>):Promise<T>{
  const client=await pool.connect();try{await client.query('BEGIN');await client.query("SET LOCAL statement_timeout='15000ms'");const result=await fn(client);await client.query('COMMIT');return result;}
  catch(error){await client.query('ROLLBACK').catch(()=>undefined);if((error as {code?:string}).code==='23505')throw new JudicialError('Registro já cadastrado para este caso ou identificador.',409,'JUDICIAL_DUPLICATE');throw error;}finally{client.release();}
}
export async function getJudicialProfile(pool:Pool,id:string,admin=false):Promise<JudicialAdminProfile>{
  const {rows}=await pool.query(`SELECT CASE WHEN c.politico_id IS NULL THEN NULL ELSE ${coverageJson} END AS coverage,
    COALESCE((SELECT jsonb_agg(${recordJson()} ORDER BY r.payload->>'eventDate' DESC,r.id) FROM judicial_records r WHERE r.politico_id=p.id AND ($2::boolean OR r.verification='VERIFIED')),'[]'::jsonb) AS records
    FROM politicos p LEFT JOIN judicial_coverage c ON c.politico_id=p.id WHERE p.id=$1`,[id,admin]);
  if(!rows.length)throw new JudicialError('Político não encontrado.',404,'JUDICIAL_NOT_FOUND');
  const records=rows[0].records as JudicialAdminRecord[];return {summary:summarizeJudicial(records,rows[0].coverage),records:admin?records:records.map(publicRecord) as JudicialAdminRecord[]};
}
export async function saveJudicialRecord(pool:Pool,politicoId:string,id:string,input:JudicialRecordInput,version:number){
  return transaction(pool,async client=>{
    await exists(client,politicoId,true);
    const beforeRows=await client.query(`SELECT ${recordJson()} AS data FROM judicial_records r WHERE r.id=$1 AND r.politico_id=$2`,[id,politicoId]);
    const before=beforeRows.rows[0]?.data??null;
    if((before?.version??0)!==version)throw new JudicialError('O registro foi alterado. Recarregue antes de salvar.',409,'JUDICIAL_VERSION_CONFLICT');
    const key=normalizeCase(input.caseNumber);
    const dedupe=input.kind==='CONVICTION'?`CONVICTION:${input.category}:${key}`:`IMPRISONMENT:${key}:${input.eventDate}:${input.custodyType}`;
    if(before){await client.query(`UPDATE judicial_records SET kind=$3,category=$4,case_key=$5,dedupe_key=$6,verification=$7,payload=$8::jsonb,version=version+1,
      checked_at=CASE WHEN $7='VERIFIED' THEN now() ELSE NULL END,updated_at=now() WHERE id=$1 AND politico_id=$2`,[id,politicoId,input.kind,input.category,key,dedupe,input.verification,JSON.stringify(input)]);}
    else{await client.query(`INSERT INTO judicial_records(id,politico_id,kind,category,case_key,dedupe_key,verification,payload,checked_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,CASE WHEN $7='VERIFIED' THEN now() ELSE NULL END)`,[id,politicoId,input.kind,input.category,key,dedupe,input.verification,JSON.stringify(input)]);}
    const after=(await client.query(`SELECT ${recordJson()} AS data FROM judicial_records r WHERE id=$1`,[id])).rows[0].data as JudicialAdminRecord;
    await client.query('INSERT INTO judicial_audit(politico_id,record_id,action,before_data,after_data) VALUES($1,$2,$3,$4::jsonb,$5::jsonb)',[politicoId,id,before?'UPDATE':'CREATE',before?JSON.stringify(before):null,JSON.stringify(after)]);
    return after;
  });
}
export async function saveJudicialCoverage(pool:Pool,id:string,input:JudicialCoverage,version:number){
  return transaction(pool,async client=>{
    await exists(client,id,true);
    const before=(await client.query(`SELECT ${coverageJson} AS data FROM judicial_coverage c WHERE politico_id=$1`,[id])).rows[0]?.data??null;
    if((before?.version??0)!==version)throw new JudicialError('A cobertura foi alterada. Recarregue antes de salvar.',409,'JUDICIAL_VERSION_CONFLICT');
    const result=await client.query(`INSERT INTO judicial_coverage AS c(politico_id,status,scope,sources,checked_at) VALUES($1,$2,$3,$4::jsonb,CASE WHEN $2='NOT_RESEARCHED' THEN NULL ELSE now() END)
      ON CONFLICT(politico_id) DO UPDATE SET status=EXCLUDED.status,scope=EXCLUDED.scope,sources=EXCLUDED.sources,checked_at=EXCLUDED.checked_at,version=c.version+1,updated_at=now()
      RETURNING ${coverageJson} AS data`,[id,input.status,input.scope,JSON.stringify(input.sources)]);
    const after=result.rows[0].data as JudicialCoverage;
    await client.query("INSERT INTO judicial_audit(politico_id,action,before_data,after_data) VALUES($1,'COVERAGE',$2::jsonb,$3::jsonb)",[id,before?JSON.stringify(before):null,JSON.stringify(after)]);
    return after;
  });
}
export async function getJudicialAudit(pool:Pool,id:string){await exists(pool,id);return {items:(await pool.query(`SELECT id,record_id AS "recordId",action,created_at AS "createdAt",before_data AS before,after_data AS after FROM judicial_audit WHERE politico_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100`,[id])).rows};}
export type JudicialRankingFilters={category:string;prisonOnly:boolean;status:'ativo'|'inativo'|'todos';search:string;direction:'asc'|'desc';limit:number;offset:number};
export async function getJudicialRanking(pool:Pool,filters:JudicialRankingFilters,revision:string):Promise<JudicialRankingResponse>{
  const {rows}=await pool.query(`WITH selected AS (
      SELECT p.*,COALESCE(c.status,'NOT_RESEARCHED') AS coverage_status,
        COALESCE(a.final_count,0) AS final_count,COALESCE(a.prisons,0) AS prisons,
        CASE WHEN c.status IN ('PARTIAL','REVIEWED') OR COALESCE(a.published,0)>0 THEN true ELSE false END AS known,
        CASE WHEN c.status='REVIEWED' THEN 'REVIEWED' WHEN c.status='PARTIAL' OR COALESCE(a.published,0)>0 THEN 'PARTIAL' ELSE 'NOT_RESEARCHED' END AS effective_status
      FROM politicos p LEFT JOIN judicial_coverage c ON c.politico_id=p.id
      LEFT JOIN (SELECT politico_id,count(*) AS published,count(*) FILTER(WHERE kind='CONVICTION' AND category=$1 AND payload->>'convictionStatus'='FINAL') AS final_count,
        count(*) FILTER(WHERE kind='IMPRISONMENT' AND payload->>'custodyConfirmed'='true') AS prisons FROM judicial_records WHERE verification='VERIFIED' GROUP BY politico_id) a ON a.politico_id=p.id
      WHERE ($2='todos' OR ($2='ativo' AND COALESCE(p.ativo,true)) OR ($2='inativo' AND p.ativo=false))
        AND ($3='' OR p.nome ILIKE '%'||$3||'%' OR p.sigla_partido ILIKE '%'||$3||'%' OR p.sigla_uf ILIKE '%'||$3||'%')
        AND (NOT $4::boolean OR COALESCE(a.prisons,0)>0)
    ), paged AS (SELECT * FROM selected ORDER BY known DESC,
      CASE WHEN $5='asc' THEN final_count END ASC,CASE WHEN $5='desc' THEN final_count END DESC,nome ASC,id ASC LIMIT $6 OFFSET $7)
    SELECT (SELECT count(*)::int FROM politicos) AS total_cadastrados,(SELECT count(*)::int FROM selected) AS total,
      (SELECT jsonb_build_object('reviewed',count(*) FILTER(WHERE effective_status='REVIEWED'),'partial',count(*) FILTER(WHERE effective_status='PARTIAL'),'notResearched',count(*) FILTER(WHERE effective_status='NOT_RESEARCHED')) FROM selected) AS coverage,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',p.id::text,'nome',p.nome,'partido',p.sigla_partido,'estado',p.sigla_uf,'foto',p.url_foto,'ativo',COALESCE(p.ativo,true),'situacao',p.situacao,
        'coverage',CASE WHEN c.politico_id IS NULL THEN NULL ELSE ${coverageJson} END,
        'records',COALESCE((SELECT jsonb_agg(${recordJson()}) FROM judicial_records r WHERE r.politico_id=p.id AND r.verification='VERIFIED'),'[]'::jsonb))
        ORDER BY p.known DESC,CASE WHEN $5='asc' THEN p.final_count END ASC,CASE WHEN $5='desc' THEN p.final_count END DESC,p.nome ASC,p.id ASC)
        FROM paged p LEFT JOIN judicial_coverage c ON c.politico_id=p.id),'[]'::jsonb) AS items`,[filters.category,filters.status,filters.search,filters.prisonOnly,filters.direction,filters.limit,filters.offset]);
  const row=rows[0];return {items:row.items.map(({records,coverage,...p})=>({...p,judicial:summarizeJudicial(records,coverage)})),total:row.total,totalCadastrados:row.total_cadastrados,coverage:row.coverage,revision};
}
