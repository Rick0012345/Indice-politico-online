import {randomUUID} from 'node:crypto';
import {mkdir,readFile,rename,writeFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import type {Pool} from 'pg';
import {buildIngestionPlan,type DatasetPlan,type IngestionPlanConfig} from './ingestionPlan';
import type {IngestionRunProgress,RunDatasetStage,RunStatus,RunTaskProgress} from './ingestionRunTypes';

type Db=Pick<Pool,'query'>;
type Phase={stage:RunDatasetStage;seeded:boolean;baselineCompleted:number};
type StoredRun={version:1;id:string;config:IngestionPlanConfig;lockPid:number;startedAt:string;updatedAt:string;finishedAt:string|null;status:RunStatus;currentDataset:string|null;estimationComplete:boolean;plan:DatasetPlan[];phases:Record<string,Phase>;finalSnapshot?:IngestionRunProgress};
type Count={dataset:string;status:string;total:number;emptyTotal?:number};
const filename='camara-run-current.json';
export const ingestionRunDirectory = () => process.env.INGESTION_RUN_DIR ?? join(process.cwd(),'logs');

// Match the worker's eligible scope and add planned keys which have not been seeded yet.
const countsSql=`
WITH definitions AS (
  SELECT * FROM jsonb_to_recordset($1::jsonb) AS p(dataset text,"entityIds" jsonb,windows jsonb,seeded boolean)
), planned AS (
  SELECT p.dataset,e.value AS entity_id,(w.value->>'start')::date AS period_start,(w.value->>'end')::date AS period_end,p.seeded
  FROM definitions p CROSS JOIN LATERAL jsonb_array_elements_text(p."entityIds") e(value)
  CROSS JOIN LATERAL jsonb_array_elements(p.windows) w(value)
), existing AS (
  SELECT c.*,CASE WHEN $4::boolean AND c.status='done' AND c.items_count=0 AND EXISTS (
    SELECT 1 FROM planned p WHERE p.dataset=c.dataset AND p.entity_id=c.entity_id
      AND p.period_start=c.period_start AND p.period_end=c.period_end AND NOT p.seeded
  ) THEN 'pending' ELSE c.status END AS effective_status
  FROM ingestion_checkpoints c
  WHERE c.source='camara' AND c.dataset IN (SELECT dataset FROM definitions)
    AND c.period_start >= $2::date AND c.period_end <= $3::date
), missing AS (
  SELECT p.dataset FROM planned p WHERE NOT EXISTS (
    SELECT 1 FROM existing e WHERE e.dataset=p.dataset AND e.entity_id=p.entity_id AND e.period_start=p.period_start AND e.period_end=p.period_end
  )
), counts AS (
  SELECT dataset,effective_status AS status,COUNT(*)::int AS total,
    COUNT(*) FILTER(WHERE effective_status='done' AND items_count=0)::int AS "emptyTotal"
  FROM existing GROUP BY dataset,effective_status
  UNION ALL SELECT dataset,'missing',COUNT(*)::int,0 FROM missing GROUP BY dataset
)
SELECT COALESCE((SELECT json_agg(counts) FROM counts),'[]'::json) AS counts,
EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND granted AND classid=0 AND objid=7710042 AND objsubid=1
  AND database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND pid=$5::int) AS active
`;

const observe = async(db:Db,run:StoredRun):Promise<IngestionRunProgress> => {
  const definitions=run.plan.map(plan=>({...plan,seeded:run.phases[plan.dataset].seeded}));
  const result=await db.query<{counts:Count[];active:boolean}>(countsSql,[JSON.stringify(definitions),run.config.from,run.config.to,run.config.resetEmpty===true,run.lockPid]);
  const counts=result.rows[0]?.counts??[];
  const byDataset=run.plan.map(plan=>{
    const rows=counts.filter(row=>row.dataset===plan.dataset);
    const count=(status:string)=>rows.filter(row=>row.status===status).reduce((sum,row)=>sum+Number(row.total),0);
    const estimatedTotal=rows.reduce((sum,row)=>sum+Number(row.total),0);
    const completed=count('done');const notCreated=count('missing');
    const phase=run.phases[plan.dataset];
    const reused=Math.min(completed,phase.baselineCompleted);
    return {dataset:plan.dataset,stage:phase.stage,estimatedTotal,completed,reused,remaining:estimatedTotal-completed,running:count('running'),pending:count('pending')+notCreated,failed:count('failed'),cancelled:count('cancelled'),notCreated,percent:estimatedTotal>0?completed/estimatedTotal*100:0};
  });
  const sum=(key:keyof RunTaskProgress)=>byDataset.reduce((total,row)=>total+row[key],0);
  const estimatedTotal=sum('estimatedTotal'),completed=sum('completed');
  return {id:run.id,from:run.config.from,to:run.config.to,datasets:[...run.config.datasets],startedAt:run.startedAt,updatedAt:run.updatedAt,finishedAt:run.finishedAt,status:run.status==='running'&&!result.rows[0]?.active?'interrupted':run.status,currentDataset:run.currentDataset,estimationComplete:run.estimationComplete,byDataset,estimatedTotal,completed,reused:sum('reused'),remaining:sum('remaining'),running:sum('running'),pending:sum('pending'),failed:sum('failed'),cancelled:sum('cancelled'),notCreated:sum('notCreated'),percent:estimatedTotal>0?completed/estimatedTotal*100:0};
};

const readStored=async(directory:string):Promise<StoredRun|null>=>{
  try{
    const value=JSON.parse(await readFile(join(directory,filename),'utf8')) as StoredRun;
    if(value.version!==1||typeof value.id!=='string'||!Array.isArray(value.plan)||!value.config||!value.phases)throw new Error('Planejamento de ingestão inválido.');
    return value;
  }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
};

export const loadCurrentIngestionRun=async(db:Db,directory=ingestionRunDirectory()):Promise<IngestionRunProgress|null>=>{
  const run=await readStored(directory);
  if(!run)return null;
  return run.finalSnapshot??observe(db,run);
};

export const createIngestionTracker=async(db:Db,config:IngestionPlanConfig,lockPid:number,directory=ingestionRunDirectory(),politicoIds:string[]=[])=>{
  const now=new Date().toISOString();
  const run:StoredRun={version:1,id:randomUUID(),config:{...config,datasets:[...new Set(config.datasets)]},lockPid,startedAt:now,updatedAt:now,finishedAt:null,status:'running',currentDataset:null,estimationComplete:!config.datasets.includes('despesas')||(!config.datasets.includes('deputados')&&politicoIds.length>0),plan:buildIngestionPlan(config,politicoIds),phases:{}};
  for(const plan of run.plan)run.phases[plan.dataset]={stage:'waiting',seeded:false,baselineCompleted:0};
  let queue=Promise.resolve();
  let published=false;
  const persist=()=>{
    const content=JSON.stringify(run);
    queue=queue.then(async()=>{
      await mkdir(directory,{recursive:true});
      const current=await readStored(directory);
      if(published&&current?.id!==run.id)throw new Error('Outra execução substituiu o planejamento.');
      const temporary=join(directory,filename+'.'+run.id+'.tmp');
      try{await writeFile(temporary,content,{mode:0o600});await rename(temporary,join(directory,filename));published=true;}
      finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
    });
    return queue;
  };
  const baseline=async()=>{
    const snapshot=await observe(db,run);
    for(const row of snapshot.byDataset)if(!run.phases[row.dataset].seeded)run.phases[row.dataset].baselineCompleted=row.completed;
  };
  await baseline();await persist();
  return {
    async beginDataset(dataset:string){run.currentDataset=dataset;run.phases[dataset].stage='seeding';run.updatedAt=new Date().toISOString();await persist();},
    async seeded(dataset:string){
      // No checkpoint worker has started for this dataset yet: completions here are reuse.
      run.phases[dataset].seeded=true;
      const snapshot=await observe(db,run);
      run.phases[dataset].baselineCompleted=snapshot.byDataset.find(row=>row.dataset===dataset)?.completed??0;
      run.phases[dataset].stage='running';run.updatedAt=new Date().toISOString();await persist();
    },
    async completedDataset(dataset:string){run.phases[dataset].stage='completed';run.updatedAt=new Date().toISOString();await persist();},
    async refreshPoliticians(ids:string[]){run.plan=buildIngestionPlan(run.config,ids);run.estimationComplete=!run.config.datasets.includes('despesas')||ids.length>0;await baseline();run.updatedAt=new Date().toISOString();await persist();},
    async finish(status:Exclude<RunStatus,'running'|'interrupted'>){
      run.status=status;run.finishedAt=new Date().toISOString();run.updatedAt=run.finishedAt;
      run.finalSnapshot=await observe(db,run);await persist();
    },
  };
};
