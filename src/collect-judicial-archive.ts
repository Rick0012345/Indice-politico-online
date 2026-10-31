import 'dotenv/config';
import {Pool} from 'pg';
import {createOfficialJudicialHttp} from './lib/officialJudicialHttp';
import {judicialPersonNames} from './lib/judicialEvidence';
import {load} from 'cheerio';

import {mkdir,readFile,writeFile} from 'node:fs/promises';
const out='output/judicial-ingestion';
const normalize=(x:string)=>x.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
const pool=new Pool({connectionString:process.env.DATABASE_URL,host:process.env.DATABASE_URL?undefined:process.env.APP_DB_HOST??'db',port:process.env.DATABASE_URL?undefined:Number(process.env.APP_DB_PORT??5432),user:process.env.DATABASE_URL?undefined:process.env.APP_DB_USER??'app',password:process.env.DATABASE_URL?undefined:process.env.APP_DB_PASSWORD??'app',database:process.env.DATABASE_URL?undefined:process.env.APP_DB_NAME??'app',options:'-c search_path=catalogo,public'});
let people:Array<{id:string;nome:string;nomeCivil:string|null}>;
try {people=(await pool.query('SELECT id::text,nome,nome_civil AS "nomeCivil" FROM politicos ORDER BY politicos.id')).rows;} finally {await pool.end();}
await mkdir(out,{recursive:true});
const resume=process.argv.includes('--resume');
await writeFile(`${out}/archive-people.json`,JSON.stringify(people));
const aliases=people.flatMap((p:any)=>judicialPersonNames(p).map(name=>({id:p.id,name,key:` ${normalize(name)} `})));
const get=createOfficialJudicialHttp();const signal=new AbortController().signal;
const manifest:any={startedAt:new Date().toISOString(),source:'STF noticias WordPress official archive',coverage:'Queries are document discovery only; name occurrence is not identity or judicial evidence.',cataloguePeople:people.length,queries:[],errors:[]};
const all=new Map<number,any>();
async function persist(){manifest.updatedAt=new Date().toISOString();manifest.uniqueDocuments=all.size;manifest.matchedDocuments=[...all.values()].filter(x=>x.matches.length).length;manifest.matchedPeople=new Set([...all.values()].flatMap(x=>x.matches.map((m:any)=>m.politicoId))).size;await writeFile(`${out}/archive-manifest.json`,JSON.stringify(manifest,null,2));await writeFile(`${out}/archive-matched.json`,JSON.stringify([...all.values()].filter(x=>x.matches.length)));}
async function collect(search:string,probeOnly=false){
 const slug=search.replaceAll(' ','-');const dir=`${out}/archive-${slug}`;await mkdir(dir,{recursive:true});
 const q:any={search,startedAt:new Date().toISOString(),total:null,totalPages:null,successPages:[],failedPages:[],cachedPages:[],complete:false};manifest.queries.push(q);
 let page=1;let pages=1;
 for(;page<=pages;page++){
  const url=new URL('https://noticias.stf.jus.br/wp-json/wp/v2/posts');url.search=new URLSearchParams({search,per_page:'100',page:String(page),orderby:'date',order:'desc',_fields:'id,date,date_gmt,modified,modified_gmt,link,title,content'}).toString();
  const path=`${dir}/page-${String(page).padStart(3,'0')}.json`;let raw:any[];let meta:any;
  try{
   try{if(!resume)throw new Error('Nova consulta solicitada.');raw=JSON.parse(await readFile(path,'utf8'));meta=JSON.parse(await readFile(`${path}.meta.json`,'utf8'));q.cachedPages.push(page);}
   catch{const result=await get(url.href,signal);raw=JSON.parse(result.text);meta={query:search,page,requestUrl:url.href,responseUrl:result.url,fetchedAt:new Date().toISOString(),total:Number(result.headers.get('x-wp-total')),totalPages:Number(result.headers.get('x-wp-totalpages'))};if(!Array.isArray(raw)||!Number.isInteger(meta.totalPages)||meta.totalPages<1)throw new Error('Invalid archive result or missing pagination');await writeFile(path,result.text);await writeFile(`${path}.meta.json`,JSON.stringify(meta,null,2));}
   q.total=meta.total;q.totalPages=meta.totalPages;pages=meta.totalPages;
   if(probeOnly&&pages>200){q.skippedBroadQuery=true;q.skipReason='More than 200 pages; scoped parliamentary discovery will be used.';console.log(JSON.stringify({query:search,total:q.total,pages,skipped:true}));await persist();return false;}
   for(const item of raw){const existing=all.get(item.id);if(existing){if(!existing.queries.includes(search))existing.queries.push(search);continue;}
    const text=` ${normalize(load(`${item.title?.rendered??''}\n${item.content?.rendered??''}`).text())} `;
    const byPerson=new Map<string,string[]>();for(const alias of aliases){if(text.includes(alias.key)){const list=byPerson.get(alias.id)??[];list.push(alias.name);byPerson.set(alias.id,list);}}
    all.set(item.id,{raw:item,queries:[search],matches:[...byPerson].map(([politicoId,matchedNames])=>({politicoId,matchedNames}))});
   }
   q.successPages.push(page);console.log(JSON.stringify({query:search,page,pages,uniqueDocuments:all.size,matchedDocuments:[...all.values()].filter(x=>x.matches.length).length}));
  }catch(error){const message=error instanceof Error?error.message:String(error);q.failedPages.push({page,error:message});manifest.errors.push({search,page,error:message});console.log(JSON.stringify({query:search,page,error:message}));if(page===1)break;}
  if(page%5===0||page===pages)await persist();
 }
 q.complete=q.successPages.length===q.totalPages&&q.failedPages.length===0;q.finishedAt=new Date().toISOString();await persist();return q.complete;
}
await collect('conden');
if(!await collect('preso',true)){const q=manifest.queries.at(-1);if(q?.skippedBroadQuery){await collect('preso deputado');await collect('presa deputada');}}
manifest.finishedAt=new Date().toISOString();manifest.complete=manifest.queries.filter((q:any)=>!q.skippedBroadQuery).every((q:any)=>q.complete);await persist();console.log(JSON.stringify(manifest));
