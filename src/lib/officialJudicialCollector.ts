import {createHash} from 'node:crypto';
import {load} from 'cheerio';
import {SaxesParser} from 'saxes';
import {officialJudicialUrl} from './judicialSources';
import {createOfficialJudicialHttp,OfficialJudicialSourceError,type OfficialJudicialHttpOptions} from './officialJudicialHttp';
import {judicialIngestionSources,type JudicialIngestionPerson,type JudicialSourceDocument,type JudicialPageCollector} from './judicialIngestionTypes';
import {assessJudicialEvidence,judicialPersonNames as names,matchJudicialNames} from './judicialEvidence';
export {matchJudicialNames} from './judicialEvidence';

const normalized=(value:string)=>value.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
function plainText(html:string){
  const $=load(html,{},false);$('script,style,noscript,template,iframe,svg').remove();
  $('p,div,li,br,h1,h2,h3,h4,blockquote').append('\n');
  return $.root().text().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/[\t ]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
function iso(value:unknown,zone='Z'){
  if(typeof value!=='string'||!value)return null;
  const timestamp=Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/.test(value)?value:`${value}${zone}`);
  return Number.isFinite(timestamp)?new Date(timestamp).toISOString():null;
}
function sourceLink(value:unknown,source:'STF_NEWS'|'STJ_NEWS'){
  if(typeof value!=='string')throw new OfficialJudicialSourceError('Documento sem endereço oficial.');
  const https=value.replace(/^http:\/\//,'https://');const valid=officialJudicialUrl(https);
  const url=valid?new URL(valid):null;
  const hosts=source==='STF_NEWS'?['noticias.stf.jus.br']:['www.stj.jus.br','stj.jus.br'];
  if(!url||!hosts.includes(url.hostname))throw new OfficialJudicialSourceError('Documento com endereço fora da fonte oficial.');
  url.hash='';for(const key of [...url.searchParams.keys()])if(key.startsWith('utm_'))url.searchParams.delete(key);
  return url.href;
}
type DocumentData=Omit<JudicialSourceDocument,'matchedNames'|'signals'|'contentHash'>;
function candidate(data:DocumentData,person:JudicialIngestionPerson,includeIneligible=false):JudicialSourceDocument|null {
  if(data.title.length>1000||data.text.length>100_000||JSON.stringify(data.raw).length>250_000)throw new OfficialJudicialSourceError('Documento excede o limite de tamanho da coleta.');
  const evidence=assessJudicialEvidence(data,person);
  if(!evidence.length&&!includeIneligible)return null;
  const matchedNames=evidence.length?[...new Set(evidence.map(item=>item.matchedName))]:matchJudicialNames(`${data.title}\n${data.text}`,person);
  const signals:JudicialSourceDocument['signals']=[];
  if(evidence.some(item=>item.kind==='CONVICTION'))signals.push('CONVICTION');
  if(evidence.some(item=>item.kind==='IMPRISONMENT'))signals.push('CUSTODY');
  if(evidence.some(item=>item.status==='REVERSED'))signals.push('REVERSAL');
  const contentHash=createHash('sha256').update(JSON.stringify([data.url,data.title,data.text,data.publishedAt,data.modifiedAt])).digest('hex');
  return {...data,contentHash,matchedNames,signals};
}
export function parseStfPosts(value:unknown,person:JudicialIngestionPerson,includeIneligible=false):JudicialSourceDocument[]{
  if(!Array.isArray(value))throw new OfficialJudicialSourceError('A fonte STF retornou um formato inesperado.');
  return value.flatMap(post=>{
    if(!post||typeof post.id!=='number'||typeof post.title?.rendered!=='string'||typeof post.content?.rendered!=='string')throw new OfficialJudicialSourceError('A fonte STF retornou um formato inesperado.');
    const data=candidate({sourceId:'STF_NEWS',sourceKey:String(post.id),url:sourceLink(post.link,'STF_NEWS'),title:plainText(post.title.rendered),text:plainText(post.content.rendered),publishedAt:post.date_gmt?iso(post.date_gmt):iso(post.date,'-03:00'),modifiedAt:post.modified_gmt?iso(post.modified_gmt):iso(post.modified,'-03:00'),raw:post},person,includeIneligible);
    return data?[data]:[];
  });
}
export function parseStjDate(value:string):string|null {
  const months:Record<string,string>={jan:'01',fev:'02',mar:'03',abr:'04',mai:'05',jun:'06',jul:'07',ago:'08',set:'09',out:'10',nov:'11',dez:'12'};
  const text=normalized(value);const match=text.match(/\b([a-z]{3}) (\d{1,2}) (\d{4}) (\d{2}) (\d{2}) (\d{2})\b/);
  if(match&&months[match[1]])return iso(`${match[3]}-${months[match[1]]}-${match[2].padStart(2,'0')}T${match[4]}:${match[5]}:${match[6]}`,'-03:00');
  const rfc=Date.parse(value);return Number.isFinite(rfc)?new Date(rfc).toISOString():null;
}
export function parseStjFeed(xml:string,person:JudicialIngestionPerson,includeIneligible=false):JudicialSourceDocument[]{
  if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw new OfficialJudicialSourceError('Declaração XML não permitida na fonte.');
  // Cheerio deliberately recovers malformed XML; a truncated feed must fail first.
  try {new SaxesParser({xmlns:true}).write(xml).close();}
  catch {throw new OfficialJudicialSourceError('A fonte STJ retornou XML incompleto ou inválido.');}
  const $=load(xml,{xml:true});
  if(!$('rss > channel').length)throw new OfficialJudicialSourceError('A fonte STJ retornou um formato inesperado.');
  return $('channel > item').toArray().flatMap(item=>{
    const entry=$(item);const get=(name:string)=>entry.children().filter((_,node)=>node.type==='tag'&&node.name===name).first().text().trim();
    const content=get('content:encoded')||get('description');const title=get('title');const link=get('link');
    if(!content||!title||!link)throw new OfficialJudicialSourceError('A fonte STJ retornou um formato inesperado.');
    const data=candidate({sourceId:'STJ_NEWS',sourceKey:get('guid')||link,url:sourceLink(link,'STJ_NEWS'),title:plainText(title),text:plainText(content),publishedAt:parseStjDate(get('pubDate')),modifiedAt:null,raw:{title,link,guid:get('guid'),pubDate:get('pubDate'),content}},person,includeIneligible);
    return data?[data]:[];
  });
}

export function createOfficialJudicialCollector(options:OfficialJudicialHttpOptions={}):JudicialPageCollector {
  const get=createOfficialJudicialHttp(options);let stjFeed:Promise<string>|null=null;
  const totals=new Map<string,number>();
  return async(source,person,page,signal)=>{
    signal.throwIfAborted();
    if(!Number.isInteger(page)||page<1||page>5)throw new OfficialJudicialSourceError('Página de coleta inválida.');
    if(source==='STJ_NEWS'){
      if(!stjFeed)stjFeed=get('https://res.stj.jus.br/hrestp-c-portalp/RSS.xml',signal).then(result=>result.text).catch(error=>{stjFeed=null;throw error;});
      const snapshots=parseStjFeed(await stjFeed,person,true);
      return {documents:snapshots.filter(item=>item.signals.length>0),observedDocuments:snapshots.filter(item=>item.signals.length===0),hasMore:false,scope:judicialIngestionSources[source].scope};
    }
    if(source!=='STF_NEWS')throw new OfficialJudicialSourceError('Fonte de coleta inválida.');
    const documents=new Map<string,JudicialSourceDocument>();let hasMore=false;
    for(const name of names(person)){
      signal.throwIfAborted();const key=`${person.id}:${name}`;
      if(totals.has(key)&&page>totals.get(key)!)continue;
      const url=new URL('https://noticias.stf.jus.br/wp-json/wp/v2/posts');
      url.search=new URLSearchParams({search:name,per_page:'20',page:String(page),orderby:'date',order:'desc',_fields:'id,date,date_gmt,modified,modified_gmt,link,title,content'}).toString();
      try {
        const result=await get(url.href,signal);let parsed:unknown;
        try {parsed=JSON.parse(result.text);} catch {throw new OfficialJudicialSourceError('A fonte STF retornou um formato inesperado.');}
        const header=result.headers.get('x-wp-totalpages');
        if(!header||!/^\d+$/.test(header)||Number(header)>100_000)throw new OfficialJudicialSourceError('A fonte STF não informou a paginação esperada.');
        const total=Number(header);totals.set(key,total);hasMore||=page<total;
        for(const document of parseStfPosts(parsed,person,true))documents.set(document.sourceKey,document);
      } catch(error){
        if(error instanceof OfficialJudicialSourceError&&error.status===400){
          let code='';try{code=JSON.parse(error.body??'{}').code;}catch{/* retain source failure */}
          if(code==='rest_post_invalid_page_number'){totals.set(key,page-1);continue;}
        }
        throw error;
      }
    }
    const snapshots=[...documents.values()];
    return {documents:snapshots.filter(item=>item.signals.length>0),observedDocuments:snapshots.filter(item=>item.signals.length===0),hasMore,scope:judicialIngestionSources[source].scope};
  };
}
