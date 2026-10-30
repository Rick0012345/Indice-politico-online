import type {Pool,PoolClient} from 'pg';
import {IngestionCancelledError} from './ingestionLifecycle';
import {accumulateExpensePage,expenseQueryParams,readExpensePageProgress,type ExpensePageProgress} from './expenseIngestion';
import type {Expense} from './expensePersistence';

export type ExpenseCheckpoint = {id:string;entity_id:string;period_start:string;period_end:string;progress_json?:unknown;items_count?:number};
export type ExpenseBatchResult = {finalized:true;itemsCount:number;completedIds:string[];completed:Array<{checkpoint:ExpenseCheckpoint;itemsCount:number}>};
export class ExpenseBatchHandledError extends Error {
  constructor(message:string) {super(message);this.name='ExpenseBatchHandledError';}
}
export class ExpenseBatchCleanupError extends Error {
  constructor(message:string) {super(message);this.name='ExpenseBatchCleanupError';}
}
type Database = Pick<Pool,'query'|'connect'>;
const fresh = (cp:ExpenseCheckpoint) => (cp.items_count ?? 0) === 0 && cp.progress_json != null &&
  typeof cp.progress_json === 'object' && !Array.isArray(cp.progress_json) && Object.keys(cp.progress_json).length === 0;
const period = (cp:ExpenseCheckpoint) => expenseQueryParams(Number(cp.period_start.slice(0,4)),Number(cp.period_start.slice(5,7)));

export async function claimExpenseBatch(db:Database,leader:ExpenseCheckpoint,options:{from:string;to:string;maxAttempts:number;limit:number}) {
  if (options.limit <= 1 || !fresh(leader)) return [leader];
  const p = period(leader);
  const transition = p.ano % 4 === 3;
  const startMonth = transition && p.mes > 1 ? 2 : 1;
  const endMonth = transition && p.mes === 1 ? 1 : 12;
  const conditions=`cp.source='camara' AND cp.dataset='despesas' AND cp.entity_id=$1
    AND cp.status IN ('pending','failed') AND cp.attempts<$2
    AND cp.period_start >= $3::date AND cp.period_end <= $4::date
    AND cp.period_start >= $5::date AND cp.period_start < $6::date
    AND EXTRACT(MONTH FROM cp.period_start) <> $7
    AND cp.items_count=0 AND cp.progress_json='{}'::jsonb`;
  const values=[leader.entity_id,options.maxAttempts,options.from,options.to,
      `${p.ano}-${String(startMonth).padStart(2,'0')}-01`,
      endMonth===12 ? `${p.ano+1}-01-01` : `${p.ano}-02-01`,p.mes];
  const client=await db.connect();
  try {
    await client.query('BEGIN');
    const current=await client.query<{status:string;progress_json:unknown;items_count:number}>(
      'SELECT status,progress_json,items_count FROM ingestion_checkpoints WHERE id=$1 FOR UPDATE',[leader.id]);
    if(current.rows[0]?.status!=='running') throw new IngestionCancelledError();
    if(!fresh({...leader,...current.rows[0]})) {await client.query('COMMIT');return [leader];}
    const candidates=await client.query<ExpenseCheckpoint>(`SELECT cp.id,cp.entity_id,cp.period_start::text,cp.period_end::text,cp.progress_json,cp.items_count
      FROM ingestion_checkpoints cp WHERE ${conditions} ORDER BY cp.period_start,cp.entity_id,cp.id FOR UPDATE SKIP LOCKED`,values);
    const months=new Set<number>();
    const selected=candidates.rows.filter(cp=>{const month=period(cp).mes;if(months.has(month)||months.size>=Math.min(12,options.limit)-1)return false;months.add(month);return true;});
    const result=await client.query<ExpenseCheckpoint>(`UPDATE ingestion_checkpoints cp
      SET status='running',attempts=cp.attempts+1,locked_at=CURRENT_TIMESTAMP,
        started_at=COALESCE(cp.started_at,CURRENT_TIMESTAMP),last_error=NULL,updated_at=CURRENT_TIMESTAMP
      WHERE cp.id=ANY($8::uuid[]) AND ${conditions}
      RETURNING cp.id,cp.entity_id,cp.period_start::text,cp.period_end::text,cp.progress_json,cp.items_count`,[...values,selected.map(cp=>cp.id)]);
    if(result.rows.length!==selected.length) throw new IngestionCancelledError();
    await client.query('COMMIT');
    return [leader,...result.rows].sort((a,b)=>a.period_start.localeCompare(b.period_start));
  } catch(error) {await client.query('ROLLBACK').catch(()=>undefined);throw error;}
  finally {client.release();}
}

export async function runExpenseBatch(db:Database,members:ExpenseCheckpoint[],callbacks:{
  pages:(params:{ano:number;mes:string;idLegislatura:number})=>AsyncIterable<{items:Expense[]}>;
  persist:(client:PoolClient,checkpoint:ExpenseCheckpoint,progress:ExpensePageProgress,requestParams:Record<string,unknown>)=>Promise<void>;
}) : Promise<ExpenseBatchResult> {
  const ids = members.map(cp=>cp.id);
  const first = period(members[0]);
  const months = members.map(cp=>period(cp).mes);
  const params = {ano:first.ano,mes:months.join(','),idLegislatura:first.idLegislatura};
  const states = new Map<number,{checkpoint:ExpenseCheckpoint;progress:ExpensePageProgress}>();
  const assertRunning = async (query:Pick<Pool,'query'>,lock=false) => {
    const result = await query.query<{id:string;status:string}>(`SELECT id,status FROM ingestion_checkpoints WHERE id=ANY($1::uuid[]) ${lock?'ORDER BY id FOR UPDATE':''}`,[ids]);
    if (result.rows.length!==ids.length || result.rows.some(row=>row.status!=='running')) throw new IngestionCancelledError();
  };
  try {
    if (!members.length || members.length>12 || new Set(months).size!==members.length) throw new Error('Grupo de despesas possui meses repetidos ou quantidade inválida.');
    for (const cp of members) {
      const p = period(cp);
      if (!fresh(cp) || cp.entity_id!==members[0].entity_id || p.ano!==first.ano || p.idLegislatura!==first.idLegislatura) throw new Error('Grupo de despesas possui contexto ou progresso incompatível.');
      states.set(p.mes,{checkpoint:cp,progress:readExpensePageProgress({},`/deputados/${cp.entity_id}/despesas`,p)});
    }
    await assertRunning(db);
    let pages=0,items=0;
    for await (const page of callbacks.pages(params)) {
      if (++pages>200 || (items+=page.items.length)>20000) throw new Error('Grupo de despesas excedeu o limite de 200 páginas ou 20000 lançamentos.');
      await assertRunning(db);
      const perMonth = new Map<number,Expense[]>();
      for (const entry of page.items) {
        if (entry.ano!==first.ano || !Number.isInteger(entry.mes) || !states.has(entry.mes!)) throw new Error('Despesa recebida sem competência explícita ou fora dos meses do grupo.');
        const list = perMonth.get(entry.mes!) ?? []; list.push(entry); perMonth.set(entry.mes!,list);
      }
      for (const [month,entries] of perMonth) {
        const state=states.get(month)!;
        const accumulated=accumulateExpensePage(state.progress,entries);
        state.progress={...state.progress,expenseAggregation:accumulated.expenseAggregation,itemsCount:state.progress.itemsCount+entries.length};
      }
    }
    const client=await db.connect();
    try {
      await client.query('BEGIN');
      await assertRunning(client,true);
      for (const state of states.values()) await callbacks.persist(client,state.checkpoint,state.progress,params);
      const completed=[...states.values()].map(state=>({checkpoint:state.checkpoint,itemsCount:state.progress.itemsCount}));
      const updated=await client.query(`UPDATE ingestion_checkpoints cp SET status='done',items_count=item.count,
        progress_json='{}'::jsonb,last_error=NULL,locked_at=NULL,finished_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
        FROM jsonb_to_recordset($1::jsonb) AS item(id uuid,count integer)
        WHERE cp.id=item.id AND cp.status='running'`,[JSON.stringify(completed.map(item=>({id:item.checkpoint.id,count:item.itemsCount})))]);
      if (updated.rowCount!==members.length) throw new IngestionCancelledError();
      await client.query('COMMIT');
      return {finalized:true,itemsCount:items,completedIds:ids,completed};
    } catch(error) {await client.query('ROLLBACK').catch(()=>undefined);throw error;}
    finally {client.release();}
  } catch(error) {
    // This cleanup must run even when the request's cancellation guard has already fired.
    const message=error instanceof Error?error.message:String(error);
    try {
      await db.query(`UPDATE ingestion_checkpoints SET status=$2,locked_at=NULL,last_error=$3,updated_at=CURRENT_TIMESTAMP
        WHERE id=ANY($1::uuid[]) AND status='running'`,[ids,error instanceof IngestionCancelledError?'pending':'failed',message]);
    } catch(cleanupError) {
      throw new ExpenseBatchCleanupError(`${message}; falha ao liberar membros do lote: ${cleanupError instanceof Error?cleanupError.message:String(cleanupError)}`);
    }
    if(error instanceof IngestionCancelledError) throw error;
    throw new ExpenseBatchHandledError(message);
  }
}
