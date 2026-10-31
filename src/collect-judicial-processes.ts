import {appendFile,mkdir,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {writeFileAtomic} from './lib/atomicFile';
import {createStfProceedingsNominalCollector} from './lib/judicialStfProceedings';
import type {ProceedingPerson} from './lib/judicialProceedingsTypes';
const args=process.argv.slice(2);
const option=(name:string,fallback:string)=>{const index=args.indexOf(name);return index<0?fallback:args[index+1]??fallback;};
if(!args.includes('--nominal-only'))throw new Error('Este coletor apenas consulta nomes; informe --nominal-only. Não grava no banco.');
const peopleFile=resolve(option('--people','output/judicial-ingestion/archive-people.json'));
const cacheDir=resolve(option('--cache-dir','output/process-discovery/cache'));
const intervalMs=Number(option('--interval-ms','1000'));
if(!Number.isFinite(intervalMs)||intervalMs<1000)throw new Error('Intervalo mínimo de 1000ms.');
const people=JSON.parse(await readFile(peopleFile,'utf8')) as ProceedingPerson[];
if(!Array.isArray(people)||people.some(p=>typeof p.id!=='string'||typeof p.nome!=='string'))throw new Error('Arquivo de população inválido.');
await mkdir(cacheDir,{recursive:true});const controller=new AbortController();process.on('SIGINT',()=>controller.abort(new Error('Coleta interrompida.')));
const collect=createStfProceedingsNominalCollector({cacheDir,resume:args.includes('--resume'),intervalMs});
const startedAt=new Date().toISOString();const results:Array<{id:string;status:string;pages:number;nominalMatches:number;errors:string[]}> = [];
const save=async()=>{const path=join(cacheDir,'manifest.json');const manifest={version:1,startedAt,updatedAt:new Date().toISOString(),population:people.length,processed:results.length,completed:results.filter(r=>r.status==='COMPLETE').length,failed:results.filter(r=>r.status==='FAILED').length,partial:results.filter(r=>r.status==='PARTIAL').length,nominalMatches:results.reduce((sum,r)=>sum+r.nominalMatches,0),intervalMs,results};await writeFileAtomic(path,JSON.stringify(manifest,null,2));return manifest;};
for(const person of people){
  const result={id:person.id,status:'COMPLETE',pages:0,nominalMatches:0,errors:[] as string[]};
  try{
    for(let page=1;page<=500;page++){
      const found=await collect({...person,anchors:[]},page,controller.signal);result.pages=page;result.nominalMatches+=found.nominalMatches;result.errors.push(...found.errors);
      if(!found.hasMore)break;
    }
    if(result.errors.length)result.status='PARTIAL';
  }catch(error){result.status='FAILED';result.errors.push(error instanceof Error?error.message:String(error));}
  results.push(result);await appendFile(join(cacheDir,'people-checks.jsonl'),JSON.stringify({...result,checkedAt:new Date().toISOString()})+'\n');
  const manifest=await save();
  if(results.length%50===0||results.length===people.length||result.status==='FAILED')console.log(JSON.stringify({processed:manifest.processed,population:people.length,completed:manifest.completed,failed:manifest.failed,partial:manifest.partial,nominalMatches:manifest.nominalMatches,lastId:person.id,updatedAt:manifest.updatedAt}));
  if(controller.signal.aborted||result.errors.some(e=>/HTTP 403|HTTP 401|limite de consultas|captcha|desafio/i.test(e))){console.error('Coleta interrompida por cancelamento ou bloqueio da fonte; preservar cache e retomar após resolver a condição.');process.exitCode=1;break;}
}
