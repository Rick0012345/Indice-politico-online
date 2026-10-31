import {createHash} from 'node:crypto';
import {mkdir,readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {load} from 'cheerio';
import {createOfficialJudicialHttp,OfficialJudicialSourceError,type OfficialJudicialHttpOptions} from './officialJudicialHttp';
import {writeFileAtomic} from './atomicFile';
import type {ProceedingPerson,ProceedingPage,ProceedingObservation,ProceedingRole,ProceedingIdentityEvidence} from './judicialProceedingsTypes';

export type StfProceedingsOptions=OfficialJudicialHttpOptions&{cacheDir?:string;resume?:boolean};
export type StfProceedingsCollector=(person:ProceedingPerson,page:number,signal:AbortSignal)=>Promise<{proceedings:ProceedingPage;hasMore:boolean;scope:string}>;
type NominalRow={id:number;pessoaId:number;pessoaNome:string;processoId:number;processoIdentificacao:string;processoNumeroUnico:string;processoDataAutuacao:string;processoMeio:string;processoPublicidade:string;processoEmTramitacao:string};
type NominalPage={totalDePaginas:number;totalDeRegistros:number;partes:NominalRow[]};
type Snapshot={requestUrl:string;url:string;text:string;hash:string;fetchedAt:string};
const normalized=(s:string)=>s.normalize('NFD').replace(/\p{M}/gu,'').toUpperCase().replace(/\s+/g,' ').trim();
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const caseKey=(s:string)=>normalized(s).replace(/\./g,'').replace(/\s+/g,'');
const cnj=(s:string)=>/^\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$/.test(s.trim())?s.trim():null;
const portal='https://portal.stf.jus.br/processos/';
export const STF_PROCEEDINGS_SCOPE='STF: processos públicos pesquisáveis por nome civil; inclui em trâmite e fora de trâmite. A fonte pode omitir processos sigilosos e não cobre outros tribunais.';
function isoDate(value:string){const match=value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);if(!match)return null;const [day,month,year]=match.slice(1).map(Number);const date=new Date(Date.UTC(year,month-1,day));return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day?date.toISOString().slice(0,10):null;}
function createSnapshots(options:StfProceedingsOptions){
  const http=createOfficialJudicialHttp(options);const memory=new Map<string,Snapshot>();const maxBytes=options.maxBytes??4*1024*1024;
  let memoryBytes=0;
  const remember=(url:string,entry:Snapshot)=>{
    if(memory.has(url)){memoryBytes-=Buffer.byteLength(memory.get(url)!.text);memory.delete(url);}
    memory.set(url,entry);memoryBytes+=Buffer.byteLength(entry.text);
    // Disk snapshots provide durable reuse; large docket HTML must not accumulate
    // across the full population. Enforce both byte and entry bounds on this LRU.
    while(memory.size>8||memoryBytes>32*1024*1024){const first=memory.keys().next().value!;memoryBytes-=Buffer.byteLength(memory.get(first)!.text);memory.delete(first);}
  };
  return async(url:string,signal:AbortSignal):Promise<Snapshot>=>{
    signal.throwIfAborted();if(memory.has(url)){const entry=memory.get(url)!;remember(url,entry);return entry;}
    const file=options.cacheDir?join(options.cacheDir,sha(url)+'.json'):null;
    if(file&&options.resume){
      try{
        if((await stat(file)).size>maxBytes*1.15+8192)throw new Error('Cache excede o limite de tamanho.');
        const entry=JSON.parse(await readFile(file,'utf8')) as Snapshot;
        if(entry.requestUrl!==url||typeof entry.text!=='string'||Buffer.byteLength(entry.text)>maxBytes||entry.hash!==sha(entry.text)||typeof entry.fetchedAt!=='string'||!Number.isFinite(Date.parse(entry.fetchedAt)))throw new Error('Hash ou estrutura do cache inválida.');
        const final=new URL(entry.url);if(final.protocol!=='https:'||!['digital.stf.jus.br','portal.stf.jus.br'].includes(final.hostname))throw new Error('URL de cache inválida.');
        signal.throwIfAborted();remember(url,entry);return entry;
      }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    }
    const response=await http(url,signal);const entry={requestUrl:url,url:response.url,text:response.text,hash:sha(response.text),fetchedAt:new Date().toISOString()};signal.throwIfAborted();
    if(file){await mkdir(options.cacheDir!,{recursive:true});await writeFileAtomic(file,JSON.stringify(entry));}
    remember(url,entry);return entry;
  };
}
type ReadSnapshot=ReturnType<typeof createSnapshots>;
function parseNominal(text:string,partition:'sim'|'nao',page:number):NominalPage{
  let data:NominalPage;try{data=JSON.parse(text);}catch{throw new OfficialJudicialSourceError('Formato inesperado na consulta processual STF.');}
  if(!data||!Number.isInteger(data.totalDePaginas)||data.totalDePaginas<0||!Number.isInteger(data.totalDeRegistros)||data.totalDeRegistros<0||!Array.isArray(data.partes)||data.partes.length>20)throw new OfficialJudicialSourceError('Estrutura inesperada na consulta processual STF.');
  if((data.totalDeRegistros===0)!==(data.totalDePaginas===0)||data.totalDePaginas!==Math.ceil(data.totalDeRegistros/20))throw new OfficialJudicialSourceError('Paginação inconsistente na consulta processual STF.');
  if(page<=data.totalDePaginas&&data.partes.length!==Math.min(20,data.totalDeRegistros-(page-1)*20))throw new OfficialJudicialSourceError('Página processual incompleta na fonte STF.');
  for(const row of data.partes){
    if(!row||!Number.isSafeInteger(row.id)||!Number.isSafeInteger(row.pessoaId)||!Number.isSafeInteger(row.processoId)||row.processoId<1||typeof row.pessoaNome!=='string'||typeof row.processoIdentificacao!=='string'||typeof row.processoNumeroUnico!=='string'||typeof row.processoDataAutuacao!=='string'||typeof row.processoPublicidade!=='string'||row.processoEmTramitacao!==(partition==='sim'?'Sim':'Não'))throw new OfficialJudicialSourceError('Associação processual inválida na fonte STF.');
  }
  return data;
}
function createNominal(read:ReadSnapshot){
  const partitions=new Map<string,NominalPage>();
  return async(person:ProceedingPerson,page:number,signal:AbortSignal)=>{
    signal.throwIfAborted();if(!Number.isInteger(page)||page<1||page>500)throw new Error('Página processual inválida.');
    const name=person.nomeCivil?.trim();if(!name||normalized(name).split(' ').length<2)throw new Error('Nome civil completo ausente para consulta processual.');
    const rows:NominalRow[]=[];const snapshots:Snapshot[]=[];const provenance=new Map<number,Snapshot>();const errors:string[]=[];let hasMore=false;let nominalMatches=0;
    for(const partition of ['sim','nao'] as const){
      const key=normalized(name)+'|'+partition;const previous=partitions.get(key);if(previous&&page>previous.totalDePaginas)continue;
      const params=new URLSearchParams({nome:name,processosPorPagina:'20',pagina:String(page),processosEmTramitacao:partition,tipoPesquisa:'PARTE'});
      const snapshot=await read('https://digital.stf.jus.br/integracoes-processos/api/public/partes/processos?'+params,signal);const data=parseNominal(snapshot.text,partition,page);
      if(previous&&(previous.totalDeRegistros!==data.totalDeRegistros||previous.totalDePaginas!==data.totalDePaginas))errors.push('A população de processos mudou durante a paginação; cobertura parcial.');
      partitions.set(key,data);snapshots.push(snapshot);nominalMatches+=data.partes.length;rows.push(...data.partes);
      for(const row of data.partes)provenance.set(row.processoId,snapshot);
      if(data.totalDePaginas>500||data.totalDeRegistros>10000)errors.push('Consulta nominal STF truncada no limite público de 10000 registros.');
      if(page<Math.min(500,data.totalDePaginas))hasMore=true;
    }
    return {rows,snapshots,provenance,nominalMatches,hasMore,errors,scope:STF_PROCEEDINGS_SCOPE};
  };
}
/** Nominal-only entry point for durable prefetch: no detail, party or subject reads. */
export function createStfProceedingsNominalCollector(options:StfProceedingsOptions={}){return createNominal(createSnapshots(options));}
function role(label:string):ProceedingRole{
  const value=normalized(label);if(/^REU|^RE\(/.test(value))return 'DEFENDANT';if(/^INVEST/.test(value))return 'INVESTIGATED';if(/^REQDO|^RECLDO|^IMPDO/.test(value))return 'RESPONDENT';if(/^AUTOR|^REQTE|^RECLTE|^IMPTE/.test(value))return 'AUTHOR';if(/^RECTE|^AGTE|^EMBTE/.test(value))return 'APPELLANT';if(/^RECDO|^AGDO|^EMBDO/.test(value))return 'APPELLEE';if(/^PACTE/.test(value))return 'PATIENT';if(/^TEST/.test(value))return 'WITNESS';return 'OTHER';
}
function phase(caseNumber:string):ProceedingObservation['phase']{const prefix=caseNumber.split(' ')[0].toUpperCase();return prefix==='INQ'?'INVESTIGATION':prefix==='EP'?'ENFORCEMENT':['AP','MS','RCL','RE','ARE','AI','AR','RVC','HC','AO','ACO','ADI','ADPF','ADC','ADO','MI'].includes(prefix)?'ACTION':'OTHER';}
function trustedAnchorUrl(value:string){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&['noticias.stf.jus.br','portal.stf.jus.br','www.stf.jus.br','www.stj.jus.br'].includes(u.hostname);}catch{return false;}}
function parliamentaryContext(html:string,person:ProceedingPerson):string|null{
  const $=load(html);$('script,style,svg,.dropdown').remove();
  if($('.processo-andamentos').length!==1)return null;
  const names=[person.nomeCivil,person.nome].filter((n):n is string=>!!n&&normalized(n).split(' ').length>=2);
  for(const node of $('.processo-andamentos .andamento-item').toArray()){
    const item=$(node);if(!isoDate(item.find('.andamento-data').text().trim()))continue;
    const title=normalized(item.find('.andamento-nome').text());
    if(/SEGREDO DE JUSTICA|SIGILOSO|ACESSO RESTRITO/.test(title))continue;
    for(const content of item.find('.col-md-9.p-0').toArray()){
      const body=$(content).clone();body.find('h1,h2,h3,h4,h5,h6').remove();
      const excerpt=body.text().replace(/\s+/g,' ').trim();const text=normalized(excerpt);
      if(/SEGREDO DE JUSTICA|SIGILOSO|ACESSO RESTRITO/.test(text))continue;
      for(const name of names){
        const escaped=normalized(name).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
        if(/^(?:DECISAO|DESPACHO):/.test(text)){
          const pattern=new RegExp(`(?:\\bDEPUTAD[OA] FEDERAL ${escaped}(?=[,.;:]|$| (?:PARA|FOI|SERA|ESTA|APRESENTOU|REQUEREU|INTERPOS|EM|NA|NO|E O|E A)\\b)|\\b${escaped}, DEPUTAD[OA] FEDERAL\\b)`);
          if(pattern.test(text))return excerpt;
        }
        // Personal service certificates identify the recipient directly. These
        // three observed forms are anchored to the entire body, so a quotation
        // from a precedent, another process or a longer civil name stays out.
        const certificate=title==='CITACAO'
          ?new RegExp(`^EM \\d{2}/\\d{2}/\\d{4}, DO EXMO\\. DEPUTAD[OA] FEDERAL ${escaped}, PARA APRESENTAR DEFESA PREVIA NO PRAZO DE \\d+ \\([\\p{L} ]+\\) DIAS\\.$`,'u')
          :title==='NOTIFICACAO'
            ?new RegExp(`^DE SUA EXCELENCIA O SENHOR ${escaped}, DEPUTAD[OA] FEDERAL, PARA, QUERENDO, APRESENTAR, EM QUINZE DIAS, DEFESA\\.$`)
            :title==='DEVOLUCAO DE MANDADO'
              ?new RegExp(`^\\(EM \\d{2}/\\d{2}/\\d{4}\\) DO , DEPUTAD[OA] FEDERAL ${escaped}\\.?$`)
              :null;
        if(certificate?.test(text))return excerpt;
      }
    }
  }
  return null;
}

export function createStfProceedingsCollector(options:StfProceedingsOptions={}):StfProceedingsCollector{
  // Measured public dockets return 23.2–31.4 MB of decoded HTML. Keep bounded
  // headroom in this connector; news/RSS transport limits remain independent.
  const read=createSnapshots({maxBytes:40*1024*1024,...options});const nominal=createNominal(read);
  return async(person,page,signal)=>{
    const found=await nominal(person,page,signal);const errors=[...found.errors];
    const verified:Array<{caseNumber:string;incident:string;cnj:string|null;snapshot:Snapshot;evidence:ProceedingIdentityEvidence}>=[];
    for(const anchor of person.anchors){
      if(anchor.court.toUpperCase()!=='STF'||!trustedAnchorUrl(anchor.sourceUrl))continue;
      const match=anchor.caseNumber.trim().match(/^([A-Za-z]{1,8})\s+(\d[\d.]*)$/);if(!match)continue;
      const canonical=match[1].toUpperCase()+' '+match[2].replace(/\./g,'');
      // STF's lookup distinguishes the official mixed-case Pet abbreviation;
      // uppercase PET returns a search page without the process identifiers.
      const lookupClass=match[1].toUpperCase()==='PET'?'Pet':match[1];
      const snapshot=await read(portal+'listarProcessos.asp?'+new URLSearchParams({classe:lookupClass,numeroProcesso:match[2].replace(/\./g,'')}),signal);const $=load(snapshot.text);
      const incident=String($('#incidente').val()??'');const actual=String($('#classe-numero-processo').val()??'');
      if($('#incidente').length!==1||$('#classe-numero-processo').length!==1||!/^\d+$/.test(incident)||caseKey(actual)!==caseKey(canonical)){errors.push('Não foi possível verificar a identificação da âncora '+canonical+'.');continue;}
      const number=cnj($('.processo-rotulo').text().replace(/^\s*Número Único:\s*/i,''));
      verified.push({caseNumber:actual,incident,cnj:number,snapshot,evidence:{method:'VERIFIED_CASE',url:anchor.sourceUrl,excerpt:anchor.excerpt}});
    }
    const candidates=new Map<string,{row:NominalRow;nominal?:Snapshot;synthetic?:boolean}>();
    for(const row of found.rows){
      if(normalized(row.pessoaNome)!==normalized(person.nomeCivil!))continue;
      const snapshot=found.provenance.get(row.processoId);
      candidates.set(String(row.processoId),{row,nominal:snapshot});
    }
    if(page===1)for(const anchor of verified)if(!candidates.has(anchor.incident))candidates.set(anchor.incident,{synthetic:true,row:{id:0,pessoaId:0,pessoaNome:person.nomeCivil!,processoId:Number(anchor.incident),processoIdentificacao:anchor.caseNumber,processoNumeroUnico:anchor.cnj??'',processoDataAutuacao:'',processoMeio:'',processoPublicidade:'Público',processoEmTramitacao:''}});
    const observations:ProceedingObservation[]=[];
    for(const [incident,candidate] of candidates){
      signal.throwIfAborted();const {row}=candidate;const sourceUrl=portal+'detalhe.asp?incidente='+incident;
      let stage='partes';
      try{
      const parties=await read(portal+'abaPartes.asp?incidente='+incident,signal);const $=load(parties.text);$('script,style').remove();
      if($('#todas-partes').length!==1)throw new OfficialJudicialSourceError('Estrutura de partes do STF mudou no processo '+row.processoIdentificacao+'.');
      const roles:Array<{role:ProceedingRole;label:string}>=[];
      $('#todas-partes .nome-parte').each((_,node)=>{if(normalized($(node).text())!==normalized(person.nomeCivil!))return;const label=$(node).prev('.detalhe-parte').text().trim();if(label&&!roles.some(r=>r.label===label))roles.push({role:role(label),label});});
      let subjects:string[]=[];
      const number=cnj(row.processoNumeroUnico);const filedAt=isoDate(row.processoDataAutuacao);
      const anchor=verified.find(a=>a.incident===incident&&caseKey(a.caseNumber)===caseKey(row.processoIdentificacao))??verified.find(a=>number&&a.cnj===number);
      const chronologyInvalid=!!(filedAt&&person.birthDate&&filedAt<person.birthDate.slice(0,10));
      const evidence:ProceedingIdentityEvidence[]=anchor&&roles.length&&!chronologyInvalid?(anchor.incident===incident?[anchor.evidence]:[anchor.evidence,{method:'OFFICIAL_CASE_LINK',url:anchor.snapshot.url,excerpt:`${anchor.caseNumber} e ${row.processoIdentificacao} compartilham o número único ${number}; nome civil confirmado na lista pública de partes.`}]):[];
      if(chronologyInvalid)errors.push('Autuação anterior ao nascimento; associação não confirmada: '+row.processoIdentificacao+'.');
      const snapshots=[candidate.nominal,parties,anchor?.snapshot].filter((x):x is Snapshot=>!!x);
      // Spend large docket reads only on unanchored passive/investigated parties.
      // This establishes identity, never conviction, custody or case disposition.
      if(!evidence.length&&!chronologyInvalid&&roles.some(r=>['DEFENDANT','RESPONDENT','INVESTIGATED'].includes(r.role))){
        stage='detalhe';
        const detail=await read(sourceUrl,signal);const page=load(detail.text);
        if(String(page('#incidente').val())!==incident||caseKey(String(page('#classe-numero-processo').val()??''))!==caseKey(row.processoIdentificacao))throw new OfficialJudicialSourceError('Identificação do detalhe processual divergiu da consulta nominal STF.');
        stage='andamentos';
        const docket=await read(portal+'abaAndamentos.asp?incidente='+incident+'&imprimir=',signal);const excerpt=parliamentaryContext(docket.text,person);snapshots.push(detail,docket);
        if(excerpt)evidence.push({method:'OFFICIAL_CONTEXT',url:docket.url,excerpt});
      }
      // Subject metadata does not establish identity. Avoid a further request
      // for private unresolved observations, including unanchored authors.
      if(evidence.length){
        stage='informacoes';
        const information=await read(portal+'abaInformacoes.asp?incidente='+incident,signal);const info=load(information.text);
        if(info('#informacoes-completas').length!==1)throw new OfficialJudicialSourceError('Estrutura de informações do STF mudou no processo '+row.processoIdentificacao+'.');
        subjects=info('.informacoes__assunto li').toArray().map(n=>info(n).text().replace(/\s+/g,' ').trim()).filter(Boolean);
        snapshots.push(information);
      }
      observations.push({sourceId:'STF_CASES',sourceKey:incident,sourcePersonId:candidate.synthetic?null:String(row.pessoaId),court:'STF',caseNumber:row.processoIdentificacao,cnjNumber:number,phase:phase(row.processoIdentificacao),status:row.processoEmTramitacao==='Sim'?'ACTIVE':row.processoEmTramitacao==='Não'?'INACTIVE':'UNKNOWN',filedAt,subjects,roles,sourceUrl,sourceLabel:'STF — consulta pública de processos e partes',fetchedAt:parties.fetchedAt,contentHash:sha(snapshots.map(s=>s.hash).join('|')),identity:evidence.length?'CONFIRMED':'UNRESOLVED',identityEvidence:evidence});
      }catch(error){
        // A blocked source or cancellation must still abort the whole page so
        // the worker retains its checkpoint. Other failures concern this case;
        // keep independently completed observations and mark coverage partial.
        signal.throwIfAborted();
        if(error instanceof OfficialJudicialSourceError&&[403,429].includes(error.status??0))throw error;
        const status=error instanceof OfficialJudicialSourceError?error.status:undefined;
        const type=status?'HTTP_ERROR':error instanceof OfficialJudicialSourceError&&/^(?:Estrutura|Identificação)/.test(error.message)?'DOCUMENT_INVALID':'SOURCE_ERROR';
        // Neither raw response bodies nor arbitrary exception messages belong
        // in persisted diagnostics, even when the underlying document is public.
        errors.push(`STF incidente ${incident}: etapa ${stage}; status ${status??'UNKNOWN'}; tipo ${type}.`);
      }
    }
    return {proceedings:{observations,nominalMatches:found.nominalMatches,errors},hasMore:found.hasMore,scope:STF_PROCEEDINGS_SCOPE};
  };
}
