import {Router,type Express,type RequestHandler,type Request,type Response} from 'express';
import type {Pool} from 'pg';
import type {CatalogEvents} from './catalogEvents';
import {JudicialError,expectedVersion,validateCoverage,validateJudicialRecord} from './judicialRules';
import {getJudicialProfile,getJudicialAudit,getJudicialRanking,saveJudicialCoverage,saveJudicialRecord,type JudicialRankingFilters} from './judicialRepository';
import {judicialCategories} from './judicialTypes';
function politicoId(req:Request):string {const value=req.params.politicoId;if(!/^[1-9]\d{0,18}$/.test(value)||BigInt(value)>9223372036854775807n)throw new JudicialError('Identificador de político inválido.');return value;}
function recordId(req:Request):string {const id=req.params.recordId;if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))throw new JudicialError('Identificador de registro inválido.');return id;}
export function parseJudicialRankingQuery(query:Request['query']):JudicialRankingFilters {
  const get=(key:string,fallback:string)=>{const raw=query[key];if(raw===undefined)return fallback;if(typeof raw!=='string')throw new JudicialError(`Filtro ${key} inválido.`);return raw;};
  const category=get('category','CRIMINAL');if(!Object.hasOwn(judicialCategories,category))throw new JudicialError('Categoria inválida.');
  const direction=get('direction','desc');if(!['asc','desc'].includes(direction))throw new JudicialError('Direção inválida.');
  const status=get('status','ativo');if(!['ativo','inativo','todos'].includes(status))throw new JudicialError('Situação inválida.');
  const prison=get('prisonOnly','false');if(!['true','false'].includes(prison))throw new JudicialError('Filtro de prisão inválido.');
  const integer=(key:string,fallback:string,min:number,max:number)=>{const raw=get(key,fallback);const n=Number(raw);if(!/^\d+$/.test(raw)||!Number.isSafeInteger(n)||n<min||n>max)throw new JudicialError(`Paginação ${key} inválida.`);return n;};
  const search=get('search','').trim();if(search.length>200)throw new JudicialError('Pesquisa muito longa.');
  return {category,direction:direction as 'asc'|'desc',status:status as JudicialRankingFilters['status'],prisonOnly:prison==='true',search,limit:integer('limit','50',1,100),offset:integer('offset','0',0,1000000)};
}
export function attachJudicialRoutes(app:Express,pool:Pool,authorize:RequestHandler,events:CatalogEvents) {
  const run=(operation:(req:Request,res:Response)=>Promise<unknown>):RequestHandler=>(req,res)=>{res.setHeader('Cache-Control','no-store');void operation(req,res).catch(error=>{
    if(error instanceof JudicialError){res.status(error.status).json({error:error.message,code:error.code});return;}
    // Never expose SQL, database details or private evidence in errors or request logs.
    console.error('[judicial]',{code:(error as {code?:string})?.code??'JUDICIAL_STORAGE_ERROR',method:req.method,path:req.route?.path});
    res.status(500).json({error:'Não foi possível consultar ou salvar o histórico judicial.',code:'JUDICIAL_STORAGE_ERROR'});
  });};
  app.get('/api/politicos/:politicoId/judicial',run(async(req,res)=>{res.json(await getJudicialProfile(pool,politicoId(req)));}));
  app.get('/api/judicial/ranking',run(async(req,res)=>{res.json(await getJudicialRanking(pool,parseJudicialRankingQuery(req.query),events.revision));}));
  const admin=Router();admin.use(authorize);
  admin.get('/politicos/:politicoId',run(async(req,res)=>{res.json(await getJudicialProfile(pool,politicoId(req),true));}));
  admin.get('/politicos/:politicoId/audit',run(async(req,res)=>{res.json(await getJudicialAudit(pool,politicoId(req)));}));
  admin.put('/politicos/:politicoId/records/:recordId',run(async(req,res)=>{
    const id=politicoId(req);const record=recordId(req);const input=validateJudicialRecord(req.body);const version=expectedVersion(req.body.expectedVersion);
    const saved=await saveJudicialRecord(pool,id,record,input,version);events.invalidate();res.json(saved);
  }));
  admin.put('/politicos/:politicoId/coverage',run(async(req,res)=>{
    const id=politicoId(req);const input=validateCoverage(req.body);const version=expectedVersion(req.body.expectedVersion);
    const saved=await saveJudicialCoverage(pool,id,input,version);events.invalidate();res.json(saved);
  }));
  app.use('/api/admin/judicial',admin);
}
