import {createHash} from 'node:crypto';
import {load} from 'cheerio';
import {createOfficialJudicialHttp,type OfficialJudicialHttpOptions} from './officialJudicialHttp';
import type {JudicialIngestionPerson} from './judicialIngestionTypes';

export type StfMovementReconciliation={
  caseNumber:string;incidentId:string;sourceUrl:string;sourceLabel:string;checkedAt:string;
  /** Hashes of the full fetched HTML snapshots, independent of execution time. */
  snapshotHash:string;lookupSnapshotHash:string;lookupUrl:string;
  outcome:string;convictionStatus:'OVERTURNED';
  /** Docket entry date, never the date of the crime or of the original conviction. */
  movementDate:string;eventEvidence:string;finalityDate:string|null;finalityEvidence:string|null;
};
export type StfMovementReconciler=(person:JudicialIngestionPerson,caseNumber:string,signal:AbortSignal)=>Promise<StfMovementReconciliation|null>;
const normal=(value:string)=>value.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/\s+/g,' ').trim();
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const escaped=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const secret=(value:string)=>/(?:segredo de justica|processo sigiloso|acesso restrito)/.test(normal(value));
function isoDate(value:string):string|null{
  const match=value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);if(!match)return null;
  const [day,month,year]=match.slice(1).map(Number);const date=new Date(Date.UTC(year,month-1,day));
  return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day?date.toISOString().slice(0,10):null;
}
type Movement={date:string;title:string;judge:string;text:string;order:number};
function parseMovements(html:string):Movement[]{
  const $=load(html);$('script,style,svg,.dropdown').remove();
  if($('.processo-andamentos').length!==1)return [];
  return $('.processo-andamentos .andamento-item').toArray().flatMap((node,order)=>{
    const item=$(node);const date=isoDate(item.find('.andamento-data').text());
    const texts=item.find('.col-md-9.p-0').toArray().map(n=>$(n).text().replace(/\s+/g,' ').trim()).filter(Boolean);
    // A public docket may contain placeholders for unrelated sealed decisions.
    // Ignore those entries without requesting any protected document.
    if(!date||texts.length!==1||secret(item.find('.andamento-nome').text())||secret(texts[0]))return [];
    return [{date,title:item.find('.andamento-nome').text().replace(/\s+/g,' ').trim(),judge:normal(item.find('.andamento-julgador').text()),text:texts[0],order}];
  }).sort((a,b)=>b.date.localeCompare(a.date)||a.order-b.order);
}
const collegial=(entry:Movement)=>/^(?:[12]ª|primeira|segunda) turma\b|^plenario\b/.test(entry.judge);
function totalAcquittal(entry:Movement,name:string){
  if(!collegial(entry))return false;
  const text=normal(entry.text);
  // Anchor to the majority's completed dispositive. A dissenting vote, request,
  // hypothetical result or partial acquittal must never reverse the entire case.
  if(/\b(?:parcialmente|parcial|pedido|requereu|pediu|poderia|podera|seria|caso|seja|absolveria)\b/.test(text))return false;
  if(/\b(?:manteve|mantida|mantendo) (?:a )?condenacao\b|\b(?:apenas|somente) (?:quanto|em relacao)\b/.test(text))return false;
  const beginning=/^decisao: (?:a turma|o plenario), por (?:maioria|unanimidade), (?:acolheu|julgou)\b/;
  if(!beginning.test(text))return false;
  const device=new RegExp(`\\bpara julgar improcedente a acao penal promovida contra ${escaped(name)} e absolve-lo da pratica dos crimes\\b`);
  return device.test(text);
}
function laterContradictingDevice(entry:Movement){
  if(!collegial(entry))return false;
  const text=normal(entry.text);
  return /^decisao: (?:a turma|o plenario), por (?:maioria|unanimidade), (?:acolheu|julgou|condenou|reformou|cassou|anulou)\b/.test(text)
    && /\b(?:condenou|condenar|condenacao|procedente a acao penal|cassou a absolvicao|anulou a absolvicao)\b/.test(text);
}

/** Closed adapter for an existing AP case: it only proves a nominal, total
 * collegiate reversal. It creates neither a new conviction nor custody evidence.
 * Null means no supported update, never affirmation of an older conviction. */
export function createStfMovementReconciler(options:OfficialJudicialHttpOptions={}):StfMovementReconciler{
  // Long public dockets embed repeated SVG help icons: AP 1044 returns 9.6 MB
  // in both normal and printing modes (997 entries). Keep the measured headroom
  // and explicit 16 MiB cap confined to this connector; transport errors propagate.
  const http=createOfficialJudicialHttp({maxBytes:16*1024*1024,...options});
  return async(person,caseNumber,signal)=>{
    const number=caseNumber.trim().match(/^AP\s+(\d{1,7})$/i)?.[1];
    const civil=normal(person.nomeCivil??'');
    if(!number||Number(number)<=0||civil.split(' ').length<3)return null;
    const canonical=`AP ${Number(number)}`;
    const lookupUrl=`https://portal.stf.jus.br/processos/listarProcessos.asp?classe=AP&numeroProcesso=${Number(number)}`;
    const lookup=await http(lookupUrl,signal);const $=load(lookup.text);$('script,style').remove();
    // The public detail page can classify the case as sealed while still exposing
    // identifiers and selected public docket entries. Its badge grants no access
    // to protected documents; only the openly returned dispositive is considered.
    $('.badge.bg-warning').filter((_,node)=>normal($(node).text())==='segredo de justica').remove();
    if(secret($.root().text())||$('#classe-numero-processo').length!==1||$('#incidente').length!==1)return null;
    if(normal(String($('#classe-numero-processo').val()??''))!==normal(canonical))return null;
    const incidentId=String($('#incidente').val()??'');if(!/^\d{1,12}$/.test(incidentId))return null;
    // Exact process and its incident are both read from the official detail page.
    if(!/numero unico:\s*\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/.test(normal($.root().text())))return null;
    const sourceUrl=`https://portal.stf.jus.br/processos/abaAndamentos.asp?incidente=${incidentId}&imprimir=`;
    const response=await http(sourceUrl,signal);const entries=parseMovements(response.text);
    const index=entries.findIndex(entry=>totalAcquittal(entry,civil));if(index<0)return null;
    const decision=entries[index];
    if(entries.slice(0,index).some(laterContradictingDevice))return null;
    const finality=entries.slice(0,index).find(entry=>normal(entry.title)==='transitado(a) em julgado'&&entry.date>=decision.date);
    // The certificate's explicit date is distinct from the docket entry date.
    const explicitFinality=finality?.text.match(/^(?:Certidão de trânsito em julgado em )?(\d{2}\/\d{2}\/\d{4})\.?$/i)?.[1];
    const finalityDate=explicitFinality?isoDate(explicitFinality):null;
    return {
      caseNumber:canonical,incidentId,sourceUrl,sourceLabel:`STF — andamentos oficiais de ${canonical}`,
      checkedAt:new Date().toISOString(),snapshotHash:hash(response.text),lookupSnapshotHash:hash(lookup.text),lookupUrl:lookup.url,
      outcome:'Ação penal julgada improcedente com absolvição nominal em decisão colegiada.',
      convictionStatus:'OVERTURNED',movementDate:decision.date,eventEvidence:decision.text,
      finalityDate:finalityDate&&finalityDate>=decision.date&&finalityDate<=finality!.date?finalityDate:null,
      finalityEvidence:finality?`${finality.title}: ${finality.text}`:null,
    };
  };
}
