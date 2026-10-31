import {Router,type Express,type RequestHandler,type Request,type Response} from 'express';
import type {Pool} from 'pg';
import {JudicialError,expectedVersion} from './judicialRules';
import {judicialIngestionSources} from './judicialIngestionTypes';
import {createOfficialJudicialCollector} from './officialJudicialCollector';
import {consolidateJudicialCandidates} from './judicialAutomation';
import {createArchivedJudicialCollector} from './judicialArchive';
import {createStfMovementReconciler} from './judicialStfMovements';
import {createJudicialIngestionWorker} from './judicialIngestionWorker';
import {withProceedingsCollector} from './judicialProceedingsCollector';
import {getProceedingCoverageStats} from './judicialProceedingsRepository';
import {createJudicialIngestionRun,dismissJudicialCandidate,getJudicialIngestionRun,importJudicialCandidate,ingestionPoliticoId,ingestionUuid,listJudicialCandidates,requestJudicialIngestionCancel,validateJudicialIngestionConfig} from './judicialIngestionRepository';

export function attachJudicialIngestionRoutes(app:Express,pool:Pool,authorize:RequestHandler,collectorFactory=createOfficialJudicialCollector){
  const worker=createJudicialIngestionWorker(pool,run=>withProceedingsCollector(pool,run.archive?createArchivedJudicialCollector(run.archive):collectorFactory()),createStfMovementReconciler);const admin=Router();admin.use(authorize);
  const run=(fn:(req:Request,res:Response)=>Promise<unknown>):RequestHandler=>(req,res)=>{res.setHeader('Cache-Control','no-store');void fn(req,res).catch(error=>{
    if(error instanceof JudicialError){res.status(error.status).json({error:error.message,code:error.code});return;}
    console.error('[judicial-ingestion]',{code:(error as {code?:string})?.code??'STORAGE_ERROR',path:req.route?.path});res.status(500).json({error:'Não foi possível executar esta operação de coleta.',code:'JUDICIAL_STORAGE_ERROR'});
  });};
  admin.get('/sources',run(async(_req,res)=>res.json({items:Object.entries(judicialIngestionSources).map(([id,s])=>({id,...s}))})));
  admin.get('/coverage',run(async(_req,res)=>res.json(await getProceedingCoverageStats(pool))));
  admin.put('/consolidate',run(async(_req,res)=>res.json(await consolidateJudicialCandidates(pool,createStfMovementReconciler()))));
  admin.get('/runs',run(async(_req,res)=>{const rows=(await pool.query('SELECT id FROM judicial_ingestion_runs ORDER BY created_at DESC LIMIT 30')).rows;res.json({items:await Promise.all(rows.map(r=>getJudicialIngestionRun(pool,r.id)))});}));
  admin.get('/runs/:id',run(async(req,res)=>res.json(await getJudicialIngestionRun(pool,ingestionUuid(req.params.id)))));
  admin.put('/runs/:id',run(async(req,res)=>{
    const id=ingestionUuid(req.params.id);const config=validateJudicialIngestionConfig(req.body);const saved=await createJudicialIngestionRun(pool,id,config);
    res.json(saved.status==='QUEUED'?await worker.start(id):await getJudicialIngestionRun(pool,id));
  }));
  admin.put('/runs/:id/resume',run(async(req,res)=>res.json(await worker.start(ingestionUuid(req.params.id),true))));
  admin.put('/runs/:id/cancel',run(async(req,res)=>{const id=ingestionUuid(req.params.id);const saved=await requestJudicialIngestionCancel(pool,id);worker.cancel(id);res.json(saved);}));
  admin.get('/candidates',run(async(req,res)=>{
    const status=req.query.status??'PENDING';if(typeof status!=='string'||!['PENDING','IMPORTED','DISMISSED','ALL'].includes(status))throw new JudicialError('Estado inválido.');
    const integer=(key:string,fallback:number,min:number,max:number)=>{const raw=req.query[key]??String(fallback);if(typeof raw!=='string'||!/^\d+$/.test(raw)||Number(raw)<min||Number(raw)>max)throw new JudicialError('Paginação inválida.');return Number(raw);};
    res.json(await listJudicialCandidates(pool,req.query.politicoId?ingestionPoliticoId(req.query.politicoId):null,status,integer('limit',25,1,100),integer('offset',0,0,1000000)));
  }));
  admin.put('/candidates/:id/dismiss',run(async(req,res)=>{
    const note=req.body.reviewNote;if(typeof note!=='string'||note.length>8000)throw new JudicialError('Nota inválida.');
    res.json(await dismissJudicialCandidate(pool,ingestionUuid(req.params.id),expectedVersion(req.body.expectedVersion),note.trim()));
  }));
  admin.put('/candidates/:id/import',run(async(req,res)=>res.json(await importJudicialCandidate(pool,ingestionUuid(req.params.id),req.body))));
  app.use('/api/admin/judicial/ingestion',admin);return worker;
}
