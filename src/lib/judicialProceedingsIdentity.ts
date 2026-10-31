import type {ProceedingAnchor} from './judicialProceedingsTypes';
import type {JudicialIngestionPerson} from './judicialIngestionTypes';
import {judicialPersonNames} from './judicialEvidence';
const normal=(value:string)=>value.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[\t ]+/g,' ').trim();
const escape=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const classes:Record<string,string>={ap:'AP',inq:'Inq',pet:'Pet',ms:'MS',rcl:'Rcl',hc:'HC',rhc:'RHC',re:'RE',are:'ARE',ar:'AR',rvc:'RvC',ep:'EP'};
/** Establishes identity in a case only. Charges, acquittals and requests here are
 * never evidence of a conviction. The collector independently checks the party. */
export function anchorsFromOfficialNews(document:{text:string;url:string},person:JudicialIngestionPerson):ProceedingAnchor[]{
 let url:URL;try{url=new URL(document.url);}catch{return [];}
 if(url.protocol!=='https:'||url.hostname!=='noticias.stf.jus.br'||url.username||url.password||url.port)return [];
 const names=judicialPersonNames(person).map(normal);const result=new Map<string,ProceedingAnchor>();
 const office='(?:(?:ex|entao)[ -])?deputad[oa](?: federal| estadual)?';
 for(const raw of document.text.split(/\r?\n/)){
  const excerpt=raw.trim();if(!excerpt||excerpt.length>1600)continue;
  const text=normal(excerpt);
  const refs=new Set([...text.matchAll(/\b(ap|inq|pet|ms|rcl|hc|rhc|re|are|ar|rvc|ep)\s*\)?\s*(?:n[ºo.]?\s*)?(\d{1,9})(?!\d)/g)].map(match=>`${classes[match[1]]} ${Number(match[2])}`));
  if(refs.size!==1)continue;
  const caseNumber=[...refs][0];const [kind,number]=caseNumber.toLowerCase().split(' ');
  const reference=`(?:acao penal|inquerito|peticao|mandado de seguranca|reclamacao|habeas corpus|recurso extraordinario|execucao penal)?\\s*\\(?${escape(kind)}\\s*\\)?\\s*(?:n[ºo.]?\\s*)?${number}(?!\\d)`;
  const linked=names.some(name=>{
   const n=escape(name);
   const qualified=`(?:${office} ${n}|${n}, ${office})`;
   const nameEnd='(?=$|[,;:.!?()]| (?:por|na|no|em|foi|teve|sera|e|contra|que|responde|pediu|figura|esta|recebeu|apresentou|teria|com|sobre)\\b)';
   // Closed links: a deputy commenting on another person's case is not a party.
   const afterCase=new RegExp(`${reference}\\s*(?:(?:foi |e )?(?:instaurad[oa]|ajuizad[oa]|movid[oa]|propost[oa]|abert[oa]) )?(?:contra|em face de|envolvendo) (?:[oa] )?${qualified}${nameEnd}`);
   const beforeCase=new RegExp(`\\b${qualified}\\s*,?\\s*(?:\\([^)]{1,30}\\)\\s*)?(?:(?:(?:e|era|sera|foi|figura como) (?:reu|re|investigad[oa]|autor[a]?|requerid[oa]|parte|paciente|recorrente)|figura|responde) (?:na|no|a|ao|nos autos d[ao]) ${reference})(?=$|[\\s,;:.!?])`);
   return afterCase.test(text)||beforeCase.test(text);
  });
  if(linked)result.set(caseNumber,{court:'STF',caseNumber,sourceUrl:url.href,excerpt});
 }
 return [...result.values()];
}
