import 'dotenv/config';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {JUDICIAL_ARCHIVE_FILE,createArchivedJudicialCollector} from './lib/judicialArchive';
import {createJudicialIngestionRun,validateJudicialIngestionConfig,persistJudicialIngestionRun,getJudicialIngestionRun} from './lib/judicialIngestionRepository';
import {createJudicialIngestionWorker} from './lib/judicialIngestionWorker';
import {judicialTransaction} from './lib/judicialRepository';
import {createStfMovementReconciler} from './lib/judicialStfMovements';
import {consolidateJudicialCandidates} from './lib/judicialAutomation';

const content=await readFile(JUDICIAL_ARCHIVE_FILE,'utf8');const entries=JSON.parse(content.replace(/^\uFEFF/,''));
const manifest=JSON.parse(await readFile('output/judicial-ingestion/archive-manifest.json','utf8'));
if(!manifest.complete||manifest.matchedDocuments!==entries.length||!manifest.queries?.filter((query:{skippedBroadQuery?:boolean})=>!query.skippedBroadQuery).every((query:{complete:boolean})=>query.complete))throw new Error('Acervo ainda incompleto; conclua a coleta antes de processar.');
const archive={sha256:createHash('sha256').update(content).digest('hex'),queries:manifest.queries.filter((query:{complete:boolean})=>query.complete).map((query:{search:string})=>query.search),documentCount:entries.length};
const stateFile=`output/judicial-ingestion/archive-processing-${archive.sha256.slice(0,16)}.json`;
let state:{sha256:string;afterId:string|null;runIds:string[];done:boolean;pendingId?:string};
try{state=JSON.parse(await readFile(stateFile,'utf8'));if(state.sha256!==archive.sha256)throw new Error('Manifesto de processamento pertence a outro acervo. Preserve-o antes de iniciar nova passagem.');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;state={sha256:archive.sha256,afterId:null,runIds:[],done:false};}
const save=()=>writeFile(stateFile,JSON.stringify(state,null,2));
const pool=new Pool({connectionString:process.env.DATABASE_URL,host:process.env.DATABASE_URL?undefined:process.env.APP_DB_HOST??'db',port:process.env.DATABASE_URL?undefined:Number(process.env.APP_DB_PORT??5432),user:process.env.DATABASE_URL?undefined:process.env.APP_DB_USER??'app',password:process.env.DATABASE_URL?undefined:process.env.APP_DB_PASSWORD??'app',database:process.env.DATABASE_URL?undefined:process.env.APP_DB_NAME??'app',options:'-c search_path=catalogo,public'});
const worker=createJudicialIngestionWorker(pool,run=>createArchivedJudicialCollector(run.archive!),createStfMovementReconciler);
try{
 // The news snapshot may be unchanged while the official docket has advanced.
 if(state.done)console.log(JSON.stringify({status:'RECONCILED',automation:await consolidateJudicialCandidates(pool,createStfMovementReconciler())}));
 while(!state.done){
  const id=state.pendingId??randomUUID();state.pendingId=id;await save();
  const run=await createJudicialIngestionRun(pool,id,validateJudicialIngestionConfig({sources:['STF_NEWS'],status:'todos',maxPoliticians:100,maxPages:1,afterId:state.afterId}));
  if(!run.archive){if(run.status!=='QUEUED')throw new Error('Execução incompatível com acervo.');run.archive=archive;await judicialTransaction(pool,client=>persistJudicialIngestionRun(client,run));}
  if(!['COMPLETED','PARTIAL'].includes(run.status)){await worker.start(id,run.status!=='QUEUED');await worker.wait(id);}
  const current=await getJudicialIngestionRun(pool,id);console.log(JSON.stringify({id,status:current.status,people:current.people.length,candidates:current.candidatesFound,errors:current.errors.length,automation:current.automation}));
  if(current.status!=='COMPLETED')throw new Error('Lote não concluído integralmente; estado preservado para reconciliação.');
  if(!state.runIds.includes(id))state.runIds.push(id);state.afterId=current.nextPoliticoId;state.done=!current.hasMorePoliticians;delete state.pendingId;await save();
 }
}finally{await worker.close();await pool.end();}
