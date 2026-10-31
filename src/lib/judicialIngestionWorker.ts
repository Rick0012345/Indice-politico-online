import type {Pool,PoolClient} from 'pg';
import {acquireIngestionLock} from './ingestionLifecycle';
import {JudicialError} from './judicialRules';
import {judicialTransaction} from './judicialRepository';
import {getJudicialIngestionRun,persistJudicialIngestionRun,storeJudicialDocuments} from './judicialIngestionRepository';
import type {JudicialIngestionRun,JudicialPageCollector} from './judicialIngestionTypes';
import {consolidateJudicialPerson,emptyAutomationResult} from './judicialAutomation';
import type {JudicialAutomationResult} from './judicialAutomationTypes';
import type {StfMovementReconciler} from './judicialStfMovements';
import {storeProceedingPage} from './judicialProceedingsRepository';
import {OfficialJudicialSourceError} from './officialJudicialHttp';

export function createJudicialIngestionWorker(pool:Pool,createCollector:(run:JudicialIngestionRun)=>JudicialPageCollector,createReconciler?:()=>StfMovementReconciler){
  const active=new Map<string,{controller:AbortController;done:Promise<void>;cancelPersistently:()=>Promise<void>}>();
  async function start(id:string,resume=false){
    if(active.has(id))return getJudicialIngestionRun(pool,id);
    const controller=new AbortController();let lockLost=false;let ownerPid:number|undefined;
    const loseLock=()=>{lockLost=true;controller.abort();};
    let lockClient:PoolClient|undefined;
    const lock=await acquireIngestionLock({connect:async()=>{lockClient=await pool.connect();lockClient.on('error',loseLock);lockClient.on('end',loseLock);return lockClient;}});
    if(!lock){lockClient?.removeListener('error',loseLock);lockClient?.removeListener('end',loseLock);throw new JudicialError('Outra ingestão ou limpeza está em andamento. Retome a execução após sua conclusão.',409,'INGESTION_BUSY');}
    // A row lock serializes claims/checkpoints. The owner PID fences any previous
    // worker after a new session acquires the maintenance lock and resumes this run.
    async function assertOwnership(client:PoolClient){
      if(lockLost)throw new Error('INGESTION_LOCK_LOST');
      const result=await client.query(`SELECT lock_pid=$2 AND EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=0 AND objid=7710042 AND objsubid=1 AND granted AND pid=$2) AS owned FROM judicial_ingestion_runs WHERE id=$1`,[id,ownerPid]);
      if(!result.rows[0]?.owned){loseLock();throw new Error('INGESTION_LOCK_LOST');}
    }
    async function release(){try{await lock!.release();}catch(error){if(!lockLost)throw error;}finally{lockClient?.removeListener('error',loseLock);lockClient?.removeListener('end',loseLock);}}
    let run:JudicialIngestionRun;let claimed=false;
    try {
      run=await judicialTransaction(pool,async client=>{
        const current=await getJudicialIngestionRun(client,id,true);
        if(!resume&&current.status!=='QUEUED')return current;
        if(resume&&['COMPLETED','PARTIAL'].includes(current.status))throw new JudicialError('Execução finalizada. Inicie outro lote para pesquisar novamente.',409);
        claimed=true;current.status='RUNNING';current.cancelRequested=false;current.finishedAt=null;current.lastError=null;current.startedAt??=new Date().toISOString();current.heartbeatAt=new Date().toISOString();
        await persistJudicialIngestionRun(client,current);
        ownerPid=(await lockClient!.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        await client.query('UPDATE judicial_ingestion_runs SET lock_pid=$2 WHERE id=$1',[id,ownerPid]);return current;
      });
      if(!claimed){await release();return run;}
    }catch(error){await release();throw error;}
    const done=execute(run!,controller.signal,assertOwnership).catch(async(error)=>{
      // Never overwrite a newer owner's checkpoint/status. A lost owner remains
      // RUNNING but inactive until an explicit resume acquires a fresh lock.
      if(lockLost)return;
      console.error('[judicial-ingestion]',{runId:id,code:'CONSOLIDATION_FAILED',reason:error?.name==='OfficialJudicialSourceError'?error.message:'A consolidação automática não pôde ser concluída.'});
      await judicialTransaction(pool,async client=>{const current=await getJudicialIngestionRun(client,id,true);await assertOwnership(client);current.status=current.cancelRequested?'CANCELLED':'FAILED';current.lastError=error instanceof OfficialJudicialSourceError?error.message:'A coleta não pôde ser concluída. O ponto de retomada foi preservado.';current.finishedAt=new Date().toISOString();await persistJudicialIngestionRun(client,current);});
    }).finally(async()=>{active.delete(id);await release();});
    const cancelPersistently=async()=>{if(lockLost)return;await judicialTransaction(pool,async client=>{const current=await getJudicialIngestionRun(client,id,true);await assertOwnership(client);current.cancelRequested=true;await persistJudicialIngestionRun(client,current);});controller.abort();};
    active.set(id,{controller,done,cancelPersistently});void done.catch(error=>console.error('[judicial-ingestion]',{code:(error as {code?:string})?.code??'WORKER_FAILED',runId:id}));
    return getJudicialIngestionRun(pool,id);
  }
  async function execute(run:JudicialIngestionRun,signal:AbortSignal,assertOwnership:(client:PoolClient)=>Promise<void>){
    const collect=createCollector(run);
    const reconcile=createReconciler?.();
    while(run.cursor.personIndex<run.people.length){
      signal.throwIfAborted();
      const current=await getJudicialIngestionRun(pool,run.id);
      if(current.cancelRequested){await finalize('CANCELLED');return;}
      const person=run.people[run.cursor.personIndex],source=run.config.sources[run.cursor.sourceIndex];
      let page:Awaited<ReturnType<JudicialPageCollector>>|null=null;let errorMessage:string|null=null;
      try {
        page=await collect(source,person,run.cursor.page,signal);
        if(source==='STF_CASES'&&!page.proceedings)throw new Error('PROCESS_PAGE_MISSING');
      }catch(error){
        signal.throwIfAborted();
        // A blocked official source is a run-level pause/failure. Do not hammer
        // the same gate for every person, advance the cursor or fabricate zeros.
        if(source==='STF_CASES'&&error instanceof OfficialJudicialSourceError&&[403,429].includes(error.status??0))throw error;
        page=null;errorMessage='A fonte oficial não pôde ser consultada nesta página. Uma nova pesquisa pode tentar novamente.';
      }
      signal.throwIfAborted();
      const committed=await judicialTransaction(pool,async client=>{
        const persisted=await getJudicialIngestionRun(client,run.id,true);
        await assertOwnership(client);
        if(persisted.cancelRequested){persisted.status='CANCELLED';persisted.finishedAt=new Date().toISOString();await persistJudicialIngestionRun(client,persisted);return false;}
        if(source==='STF_CASES'){
          await storeProceedingPage(client,{runId:run.id,politicoId:person.id,page:run.cursor.page,
            result:page?.proceedings??null,done:!page?.hasMore||run.cursor.page>=run.config.maxPages,
            truncated:!!page?.hasMore&&run.cursor.page>=run.config.maxPages,error:errorMessage});
          if(page?.proceedings?.errors.length)run.errors.push({politicoId:person.id,source,message:'Parte dos dados processuais não pôde ser confirmada nesta consulta.'});
        }else if(page)run.candidatesFound+=await storeJudicialDocuments(client,run,person.id,[...page.documents,...(page.observedDocuments??[])]);
        if(errorMessage)run.errors.push({politicoId:person.id,source,message:errorMessage});
        run.processedPages++;
        if(page?.hasMore&&run.cursor.page<run.config.maxPages)run.cursor.page++;
        else {
          if(page?.hasMore){run.truncated=true;run.sourceTruncated=true;}
          run.cursor.page=1;run.cursor.sourceIndex++;
          if(run.cursor.sourceIndex>=run.config.sources.length){
            if(run.config.sources.some(item=>item!=='STF_CASES')){
              const consolidated=await consolidateJudicialPerson(client,person,reconcile,signal);
              run.automation??=emptyAutomationResult();
              for(const field of Object.keys(consolidated) as Array<keyof JudicialAutomationResult>)run.automation[field]+=consolidated[field];
            }
            run.cursor.sourceIndex=0;run.cursor.personIndex++;
          }
        }
        run.heartbeatAt=new Date().toISOString();signal.throwIfAborted();await assertOwnership(client);await persistJudicialIngestionRun(client,run);return true;
      });
      if(!committed)return;
    }
    await finalize(run.errors.length||run.sourceTruncated?'PARTIAL':'COMPLETED');
    async function finalize(status:JudicialIngestionRun['status']){await judicialTransaction(pool,async client=>{
      const latest=await getJudicialIngestionRun(client,run.id,true);await assertOwnership(client);latest.status=latest.cancelRequested?'CANCELLED':status;latest.finishedAt=new Date().toISOString();latest.heartbeatAt=latest.finishedAt;await persistJudicialIngestionRun(client,latest);
    });}
  }
  return {start,cancel(id:string){active.get(id)?.controller.abort();},async wait(id:string){await active.get(id)?.done;},async close(){const jobs=[...active.values()];await Promise.allSettled(jobs.map(x=>x.cancelPersistently()));await Promise.allSettled(jobs.map(x=>x.done));}};
}
