import {judicialCategories,convictionStatuses,custodyTypes} from './judicialTypes';
import {officialJudicialUrl} from './judicialSources';
import type {JudicialRecordInput,JudicialAdminRecord,JudicialCoverage,JudicialSummary} from './judicialTypes';
export class JudicialError extends Error { constructor(message:string,public status=400,public code='JUDICIAL_INVALID') { super(message); } }
function text(value:unknown,name:string,max=4000,required=false):string {
  if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new JudicialError(`${name} inválido.`);
  const result=value.trim(); if(required&&!result) throw new JudicialError(`${name} obrigatório.`); return result;
}
function oneOf<T extends string>(value:unknown,options:readonly T[],name:string):T {
  if(typeof value!=='string'||!options.includes(value as T)) throw new JudicialError(`${name} inválido.`); return value as T;
}
export function officialSource(value:unknown):string {
  const url=officialJudicialUrl(text(value,'Fonte',2048,true));
  if(!url) throw new JudicialError('A fonte deve usar HTTPS em domínio oficial brasileiro, sem credenciais ou porta alternativa.');
  return url;
}
function date(value:unknown,name:string,nullable=false):string|null {
  if(nullable&&value===null)return null;
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new JudicialError(`${name} inválida.`);
  const stamp=new Date(value+'T00:00:00Z');
  if(!Number.isFinite(stamp.getTime())||stamp.toISOString().slice(0,10)!==value||value>new Date().toISOString().slice(0,10))throw new JudicialError(`${name} inválida ou futura.`);
  return value;
}
export function normalizeCase(value:string):string { return value.normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g,''); }
export function validateJudicialRecord(value:unknown):JudicialRecordInput {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new JudicialError('Registro inválido.');
  const v=value as Record<string,unknown>;
  const kind=oneOf(v.kind,['CONVICTION','IMPRISONMENT'],'Tipo');
  const verification=oneOf(v.verification,['DRAFT','VERIFIED'],'Revisão');
  const result:JudicialRecordInput={kind,verification,category:oneOf(v.category,Object.keys(judicialCategories),'Categoria') as JudicialRecordInput['category'],
    caseNumber:text(v.caseNumber,'Processo',120,true),court:text(v.court,'Tribunal',200,true),title:text(v.title,'Título',300,true),description:text(v.description,'Descrição',8000),
    eventDate:date(v.eventDate,'Data da decisão/prisão')!,finalityDate:date(v.finalityDate,'Trânsito em julgado',true),releasedAt:date(v.releasedAt,'Soltura',true),
    convictionStatus:v.convictionStatus===null?null:oneOf(v.convictionStatus,Object.keys(convictionStatuses),'Situação da condenação') as JudicialRecordInput['convictionStatus'],
    custodyType:v.custodyType===null?null:oneOf(v.custodyType,Object.keys(custodyTypes),'Modalidade') as JudicialRecordInput['custodyType'],custodyConfirmed:v.custodyConfirmed as boolean,
    grounds:text(v.grounds,'Fundamento',8000),outcome:text(v.outcome,'Desfecho',4000),sourceUrl:officialSource(v.sourceUrl),sourceLabel:text(v.sourceLabel,'Nome da fonte',200,true),
    identityEvidence:text(v.identityEvidence,'Evidência de identidade',8000,verification==='VERIFIED'),reviewNote:text(v.reviewNote,'Nota de revisão',8000)};
  if(normalizeCase(result.caseNumber).length<3)throw new JudicialError('Número do processo inválido.');
  if(result.title.length<5||result.description.length<10||result.sourceLabel.length<3)throw new JudicialError('Título, descrição ou nome da fonte insuficiente.');
  if(verification==='VERIFIED'&&(result.identityEvidence.length<20||result.reviewNote.length<10))throw new JudicialError('Publicação exige evidência de identidade e nota de revisão suficientes.');
  if(typeof v.custodyConfirmed!=='boolean')throw new JudicialError('Confirmação de prisão inválida.');
  if(result.finalityDate&&result.finalityDate<result.eventDate)throw new JudicialError('Trânsito anterior à decisão.');
  if(result.releasedAt&&result.releasedAt<result.eventDate)throw new JudicialError('Soltura anterior à prisão.');
  if(kind==='CONVICTION'&&(!result.convictionStatus||result.custodyType||result.custodyConfirmed||result.releasedAt))throw new JudicialError('Campos incompatíveis com condenação.');
  if(kind==='CONVICTION'&&result.convictionStatus==='FINAL'&&!result.finalityDate)throw new JudicialError('Condenação definitiva exige trânsito em julgado.');
  if(kind==='IMPRISONMENT'&&(!result.custodyType||result.convictionStatus||result.finalityDate))throw new JudicialError('Campos incompatíveis com prisão.');
  if(kind==='IMPRISONMENT'&&verification==='VERIFIED'&&(!result.custodyConfirmed||result.grounds.length<10))throw new JudicialError('Prisão publicada exige cumprimento confirmado e fundamento.');
  return result;
}
export function validateCoverage(value:unknown):JudicialCoverage {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new JudicialError('Cobertura inválida.');
  const v=value as Record<string,unknown>;const status=oneOf(v.status,['NOT_RESEARCHED','PARTIAL','REVIEWED'],'Cobertura');
  if(!Array.isArray(v.sources)||v.sources.length>30)throw new JudicialError('Fontes inválidas.');
  const sources=v.sources.map(s=>{if(!s||typeof s!=='object')throw new JudicialError('Fonte inválida.');const label=text(s.label,'Nome da fonte',200,true);if(label.length<3)throw new JudicialError('Nome da fonte insuficiente.');return {label,url:officialSource(s.url)};});
  const scope=text(v.scope,'Escopo',4000,status!=='NOT_RESEARCHED');
  if(status!=='NOT_RESEARCHED'&&!sources.length)throw new JudicialError('Pesquisa exige ao menos uma fonte oficial.');
  return {status,scope,sources,version:0,checkedAt:status==='NOT_RESEARCHED'?null:new Date().toISOString()};
}
export const emptyCoverage=():JudicialCoverage=>({status:'NOT_RESEARCHED',scope:'',sources:[],version:0,checkedAt:null});
export function summarizeJudicial(records:JudicialAdminRecord[],coverage:JudicialCoverage|null):JudicialSummary {
  const published=records.filter(r=>r.verification==='VERIFIED');
  const effective={...(coverage??emptyCoverage())};
  if(published.length&&effective.status==='NOT_RESEARCHED')effective.status='PARTIAL';
  const counts=Object.fromEntries(Object.keys(judicialCategories).map(c=>[c,{final:0,appeal:0}])) as JudicialSummary['counts'];
  const convictions=new Set<string>();const imprisonments=new Set<string>();
  for(const r of published){const key=`${r.category}:${normalizeCase(r.caseNumber)}`;
    if(r.kind==='CONVICTION'&&!convictions.has(key)){convictions.add(key);if(r.convictionStatus==='FINAL')counts[r.category].final++;if(r.convictionStatus==='APPEAL')counts[r.category].appeal++;}
    if(r.kind==='IMPRISONMENT'&&r.custodyConfirmed)imprisonments.add(`${normalizeCase(r.caseNumber)}:${r.eventDate}:${r.custodyType}`);
  }
  const known=effective.status!=='NOT_RESEARCHED';const checks=[effective.checkedAt,...published.map(r=>r.checkedAt)].filter(Boolean).sort();
  return {finalConvictions:known?counts.CRIMINAL.final:null,appealConvictions:known?counts.CRIMINAL.appeal:null,confirmedImprisonments:known?imprisonments.size:null,
    prisonHistory:imprisonments.size?'CONFIRMED':known?'NO_RECORDS':'NOT_RESEARCHED',counts,coverage:effective,lastCheckedAt:checks.at(-1)??null};
}
export function publicRecord(record:JudicialAdminRecord) { const {identityEvidence:_identity,reviewNote:_review,...result}=record;return result; }
export function expectedVersion(value:unknown):number {if(!Number.isSafeInteger(value)||Number(value)<0)throw new JudicialError('Versão esperada inválida.');return Number(value);}
