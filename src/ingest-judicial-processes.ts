import 'dotenv/config';
import {mkdir,readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {createOfficialJudicialCollector} from './lib/officialJudicialCollector';
import {withProceedingsCollector} from './lib/judicialProceedingsCollector';
import {createJudicialIngestionWorker} from './lib/judicialIngestionWorker';
import {createJudicialIngestionRun,getJudicialIngestionRun,requestJudicialIngestionCancel,validateJudicialIngestionConfig} from './lib/judicialIngestionRepository';
import {getProceedingCoverageStats} from './lib/judicialProceedingsRepository';
import {writeFileAtomic} from './lib/atomicFile';

const args=new Set(process.argv.slice(2));
const directory='output/judicial-ingestion';const stateFile=`${directory}/processes-current-run.json`;
await mkdir(directory,{recursive:true});
const pool=new Pool({connectionString:process.env.DATABASE_URL,host:process.env.DATABASE_URL?undefined:process.env.APP_DB_HOST??'db',port:process.env.DATABASE_URL?undefined:Number(process.env.APP_DB_PORT??5432),user:process.env.DATABASE_URL?undefined:process.env.APP_DB_USER??'app',password:process.env.DATABASE_URL?undefined:process.env.APP_DB_PASSWORD??'app',database:process.env.DATABASE_URL?undefined:process.env.APP_DB_NAME??'app',options:'-c search_path=catalogo,public'});
const worker=createJudicialIngestionWorker(pool,()=>withProceedingsCollector(pool,createOfficialJudicialCollector(),{cacheDir:'output/process-discovery/cache',resume:args.has('--use-cache')}));
let stopping=false;
const stop=()=>{if(!stopping){stopping=true;void worker.close();}};
process.once('SIGINT',stop);process.once('SIGTERM',stop);
let timer:ReturnType<typeof setInterval>|undefined;
try{
 let id=randomUUID();
 if(args.has('--resume')){const state=JSON.parse(await readFile(stateFile,'utf8'));id=state.id;}
 else{
  // Keep an unfinished run reviewable; the caller must explicitly resume it.
  let previous:{id:string}|undefined;
  try{previous=JSON.parse(await readFile(stateFile,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  if(previous){
   const run=await getJudicialIngestionRun(pool,previous.id);
   const restarting=args.has('--restart')&&!run.active&&['FAILED','CANCELLED'].includes(run.status);
   if(!['COMPLETED','PARTIAL'].includes(run.status)&&!restarting)throw new Error('Há uma pesquisa incompleta. Use --resume para continuar o mesmo checkpoint ou --restart após sua interrupção para uma nova passagem.');
  }
  await writeFileAtomic(stateFile,JSON.stringify({id,previousRunId:previous?.id??null,createdAt:new Date().toISOString()},null,2));
 }
 const config=validateJudicialIngestionConfig({sources:['STF_CASES'],status:'todos',maxPoliticians:10000,maxPages:500});
 const current=await createJudicialIngestionRun(pool,id,config);
 if(stopping){await requestJudicialIngestionCancel(pool,id);throw new Error('Pesquisa cancelada antes do início.');}
 if(!['COMPLETED','PARTIAL'].includes(current.status)){
  await worker.start(id,current.status!=='QUEUED');
  if(stopping){await requestJudicialIngestionCancel(pool,id);await worker.close();}
  let lastProgress=0;let readingProgress=false;
  timer=setInterval(()=>{
   if(readingProgress)return;readingProgress=true;
   void getJudicialIngestionRun(pool,id).then(run=>{
    if(run.cancelRequested)worker.cancel(id);
    if(Date.now()-lastProgress>=30_000){lastProgress=Date.now();console.log(JSON.stringify({id:run.id,status:run.status,processed:run.cursor.personIndex,total:run.people.length,page:run.cursor.page,errors:run.errors.length}));}
   }).catch(()=>undefined).finally(()=>{readingProgress=false;});
  },2000);
  await worker.wait(id);
 }
 const result=await getJudicialIngestionRun(pool,id);const coverage=await getProceedingCoverageStats(pool);
 const report={id,status:result.status,processed:result.cursor.personIndex,total:result.people.length,errors:result.errors.length,sourceTruncated:result.sourceTruncated??false,coverage};
 await writeFileAtomic(`${directory}/processes-result.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 if(!['COMPLETED','PARTIAL'].includes(result.status))process.exitCode=1;
}finally{if(timer)clearInterval(timer);process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);await worker.close();await pool.end();}
