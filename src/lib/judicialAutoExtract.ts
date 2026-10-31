import {assessJudicialEvidence,matchJudicialNames,judicialPersonNames} from './judicialEvidence';
import type {JudicialIngestionPerson,JudicialSourceDocument} from './judicialIngestionTypes';
import type {JudicialExtractedFact,JudicialExtraction} from './judicialAutomationTypes';

const normalize=(value:string)=>value.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/\s+/g,' ').trim();
function identifiedPerson(text:string,person:JudicialIngestionPerson){
  const value=normalize(text).replace(/[^\p{L}\p{N}]+/gu,' ');
  return judicialPersonNames(person).some(name=>new RegExp(`\\b(?:deputad[oa]|senador[a]?|presidente|prefeit[oa]|governador[a]?|parlamentar|vereadora?)(?: federal| estadual)?(?: licenciado| licenciada)? ${normalize(name).replace(/[^\p{L}\p{N}]+/gu,' ')}(?= |$)`,'u').test(value));
}
const fragments=(text:string)=>text.split(/(?<=[.!?])\s+|[\r\n;]+/u).map(s=>s.trim()).filter(Boolean);
type CaseReference={number:string;evidence:string};
function cases(text:string):CaseReference[]{
  const refs:CaseReference[]=[];
  for(const evidence of fragments(text)){
    const patterns=[/\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/g,/\b(?:(Aç(?:ão|ões)\s+Pena(?:l|is)|Inquéritos?|Petiç(?:ão|ões)|Execuç(?:ão|ões)\s+Pena(?:l|is))\s*(?:\(\s*(?:AP|INQ|PET|EP)s?\s*\))?|\(?(AP|INQ|PET|EP)s?\)?)(?:\s*(?:n[º°.]?|número)\s*)?\s*(\d[\d.]*)(?![\d])/gi];
    for(const [index,pattern] of patterns.entries())for(const match of evidence.matchAll(pattern)){
      const prefix=index===0?'':match[2]?.toUpperCase()??(/^a/i.test(match[1])?'AP':/^i/i.test(match[1])?'INQ':/^p/i.test(match[1])?'PET':'EP');
      const number=index===0?match[0]:`${prefix} ${match[3].replace(/\./g,'')}`;
      if(!refs.some(ref=>ref.number===number))refs.push({number,evidence});
      if(index!==0){
        let remainder=evidence.slice(match.index!+match[0].length);let next:RegExpMatchArray|null;
        while((next=remainder.match(/^\s*(?:,|e)\s*(\d[\d.]*)(?![\d])/))){
          const additional=`${prefix} ${next[1].replace(/\./g,'')}`;
          if(!refs.some(ref=>ref.number===additional))refs.push({number:additional,evidence});
          remainder=remainder.slice(next[0].length);
        }
      }
    }
  }
  return refs;
}
const months=['janeiro','fevereiro','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
function dateIn(text:string):string|null{
  const value=normalize(text);
  const numeric=value.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  const written=value.match(/\b(\d{1,2}) de (janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro) de (\d{4})\b/);
  if(!numeric&&!written)return null;
  const year=Number((numeric??written)![3]);const month=numeric?Number(numeric[2]):months.indexOf(written![2])+1;const day=Number((numeric??written)![1]);
  const date=new Date(Date.UTC(year,month-1,day));
  return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day?date.toISOString().slice(0,10):null;
}
function eventDate(excerpt:string):string|null{
  // Only a date directly following the event predicate; dates of crimes stay out.
  const match=normalize(excerpt).match(/\b(?:condenad[oa]|pres[oa]|detid[oa]|anulad[oa]|condenou) (?:em|no dia) (.+)/);
  return match?dateIn(match[1].split(/\b(?:por|pelo|pela|na|no)\b/)[0]):null;
}
function groundsIn(excerpt:string):string{
  const match=excerpt.match(/\bpor (crime contra .+)/i)??excerpt.match(/\b(?:pelos? crimes? de|pela prática d[eo](?: crime de)?|por crimes? (?:de|contra)|pel[ao])\s+((?:invasão|adulteração|corrupção|peculato|falsidade|porte|constrangimento|Sistema Financeiro).+)/i)??excerpt.match(/\b(?:pelos? crimes? de|pela prática d[eo](?: crime de)?|por crimes? (?:de|contra))\s+(.+)/i)??excerpt.match(/\bpor\s+(?!maioria\b|unanimidade\b)(.+)/i);
  return match?match[1].replace(/\s+(?:na|no)\s+(?:Ação Penal|AP)\b.*$/i,'').replace(/,\s+a\s+.+$/i,'').replace(/[.!]+$/,'').trim():'';
}
type SentenceUpdate='REVISED'|'SUSPENDED'|'EXTINGUISHED'|'EXECUTION';
function sentenceUpdate(excerpt:string,context:string):SentenceUpdate|null{
  const value=normalize(excerpt);
  if(/\b(?:suspendeu|suspende) (?:os )?efeitos (?:da )?condenacao\b/.test(value))return 'SUSPENDED';
  if(/\b(?:declarou extintas|extinguiu) (?:as )?penas\b|\bdeclarou extinta a punibilidade\b/.test(value))return 'EXTINGUISHED';
  if(/\bacolheu recursos .+ contra as penas\b/.test(value))return 'REVISED';
  if(/\bdeterminou o inicio do cumprimento da pena\b/.test(value))return 'EXECUTION';
  if(/\banulou a condenacao\b/.test(value)&&fragments(context).some(part=>/^foi mantida contudo a condenacao pelo delito de/.test(normalize(part).replace(/,/g,''))))return 'REVISED';
  return null;
}
function sentenceDetails(text:string,update:SentenceUpdate,reference:CaseReference,person:JudicialIngestionPerson,eventExcerpt:string){
  const documentCases=cases(text);
  const eventCases=cases(eventExcerpt);
  // An explicit dispositive may apply the same extinction to multiple cases.
  // Otherwise an anonymous continuation cannot connect different proceedings.
  const sharedExtinction=update==='EXTINGUISHED'&&eventCases.some(ref=>ref.number===reference.number)&&documentCases.every(ref=>eventCases.some(eventRef=>eventRef.number===ref.number));
  const parts=fragments(text).filter(part=>{
    if(attributedToOtherParty(part,person))return false;
    const refs=cases(part);
    return refs.length?refs.every(ref=>ref.number===reference.number):documentCases.length===1||sharedExtinction;
  });
  const history=parts.filter(part=>{const refs=cases(part);return refs.length===1&&refs[0].number===reference.number&&/\b(?:condenad[oa]|sentenca)\b/.test(normalize(part));});
  const remaining=update==='REVISED'?parts.filter(part=>/^permanece(?:m)? (?:a|as) pena|^foi mantida contudo a condenacao pelo delito de/.test(normalize(part).replace(/,/g,''))):[];
  const detail=update==='EXTINGUISHED'?parts.filter(part=>/^o indulto abrange/.test(normalize(part))):update==='REVISED'?parts.filter(part=>/\b(?:foi declarada a prescricao|desclassificar o delito)\b/.test(normalize(part))):update==='EXECUTION'?parts.filter(part=>/\bcondenacao se tornou definitiva\b/.test(normalize(part))):[];
  const remainingGround=remaining[0]?.match(/\bpelo (?:crime|delito)(?: de)?\s+(.+?)(?:,|\.|$)/i)?.[1]?.trim();
  return {grounds:update==='REVISED'?remainingGround??'':history.map(groundsIn).find(Boolean)??'',details:[...detail,...remaining],history};
}
function namedParticipants(text:string):string[]{
  // Capture parties through their procedural role, never every capitalized name:
  // a named judge or rapporteur is an authority, not the subject of the case.
  const name='[\\p{Lu}][\\p{L}]+(?: (?:(?:da|de|do|das|dos) )?[\\p{Lu}][\\p{L}]+)+';
  const office='(?:(?:ex[- ]|então )?(?:deputad[oa]|senador[a]?|presidente|prefeit[oa]|governador[a]?|parlamentar|vereadora?)(?: federal| estadual)?(?: licenciad[oa])? )?';
  const patterns=[
    new RegExp(`(?:[Rr]ecursos?|[Pp]edidos?|[Pp]enas?|[Aa]ção|[Dd]enúncia|[Cc]ondenação|[Ss]entença|[Dd]ecisão)(?: definitiva)? (?:de|do|da|contra|em nome de|apresentad[oa] por|interpost[oa] por) ${office}(${name})`,'gu'),
    new RegExp(`(${name}) (?:recorreu|recorre|apresentou|apresenta|requereu|requer)\\b`,'gu'),
    new RegExp(`(?:[Rr]ecorrente|[Rr]éu|[Rr]é|[Aa]cusad[oa]) ${office}(${name})`,'gu'),
  ];
  const result:string[]=[];
  for(const pattern of patterns)for(const match of text.matchAll(pattern)){
    const prefix=text.slice(Math.max(0,match.index!-35),match.index);
    if(/\b(?:ministro|ministra|juiz|juíza|relator|relatora|desembargador|desembargadora),?\s*$/iu.test(prefix))continue;
    result.push(match[1]);
  }
  return result;
}
function attributedToOtherParty(text:string,person:JudicialIngestionPerson){
  const parties=namedParticipants(text);
  return parties.length>0&&!parties.some(name=>matchJudicialNames(name,person).length);
}
function categoryIn(text:string,reference:string):JudicialExtractedFact['category']|null{
  const value=normalize(text);
  if(/\bimprobidade\b/.test(value))return 'IMPROBITY';
  if(/\b(?:crime eleitoral|crimes eleitorais|justica eleitoral|abuso de poder politico|abuso de poder economico)\b/.test(value))return 'ELECTORAL';
  if(/\b(?:tribunal de contas|contas publicas|contas irregulares)\b/.test(value))return 'ACCOUNTS';
  if(/\b(?:civel|indenizacao civil|indenizacao civel)\b/.test(value)&&!(/\b(?:crime|crimes|criminal|reclusao)\b/.test(value)))return null;
  if(/^(?:AP|EP) /.test(reference)||/\b(?:crime|crimes|criminal|penal|reclusao|corrupcao|peculato|falsidade|ameacas|flagrante)\b/.test(value))return 'CRIMINAL';
  return null;
}
function attributedCourt(text:string,event:string,reference:CaseReference,person:JudicialIngestionPerson):string|null{
  const related=[event,reference.evidence,...fragments(text).filter(part=>matchJudicialNames(part,person).length||cases(part).some(ref=>ref.number===reference.number)||/\btribunal responsavel pelo processo\b/.test(normalize(part)))].join('\n');
  const value=normalize(related);
  if(/\b(?:tribunal de justica|tribunal regional|tj[a-z]{2}|trf\s*[1-6]|tre\b|justica estadual|primeira instancia)\b/.test(value))return null;
  const courts=new Set<string>();
  if(/\b(?:stf|supremo tribunal federal)\b/.test(value))courts.add('STF');
  if(/\b(?:stj|superior tribunal de justica)\b/.test(value))courts.add('STJ');
  return courts.size===1?[...courts][0]:null;
}
function statusIn(text:string,reversed:boolean,person:JudicialIngestionPerson):{status:JudicialExtractedFact['convictionStatus'];date:string|null}{
  if(reversed)return {status:'ANNULLED',date:null};
  const hasOtherEvent=[...text.matchAll(/\b([\p{Lu}][\p{L}]+(?: [\p{Lu}][\p{L}]+)+) (?:foi|havia sido|tinha sido) (?:condenad[oa]|sentenciad[oa])/gu)].some(match=>!matchJudicialNames(match[1],person).length);
  for(const part of fragments(text)){
    const value=normalize(part);
    if(attributedToOtherParty(part,person))continue;
    if(hasOtherEvent&&!matchJudicialNames(part,person).length)continue;
    const finalityIndex=value.search(/\b(?:transito em julgado|transitou em julgado|condenacao definitiva)\b/);
    const prefix=finalityIndex>=0?value.slice(0,finalityIndex):value;
    if(/\b(?:nao|ainda|apos|quando|se|pedido|requer|solicita|devera|podera|futuro)\b/.test(prefix.replace(/\bse tornou\b/g,'tornou')))continue;
    if(/\b(?:declarou|declarado|determinou|certificou|certificado|reconheceu) (?:o )?transito em julgado\b|\b(?:condenacao|decisao|sentenca) transitou em julgado\b|\bcondenacao (?:se tornou )?definitiva\b/.test(value)){
      const dated=value.match(/\b(?:transito em julgado(?: da (?:decisao|condenacao|sentenca))?|transitou em julgado)\)? (?:em|no dia) (.+)/);
      return {status:'FINAL',date:dated?dateIn(dated[1]):null};
    }
    if(/\b(?:cabe recurso|sujeita a recurso|ainda cabe recurso|pode recorrer)\b/.test(value))return {status:'APPEAL',date:null};
  }
  return {status:'UNKNOWN',date:null};
}

/** Deterministic extraction: every public assertion retains its literal source evidence. */
export function extractJudicialFacts(document:JudicialSourceDocument,person:JudicialIngestionPerson):JudicialExtraction{
  const facts:JudicialExtractedFact[]=[];const issues:string[]=[];
  let host='';try{host=new URL(document.url).hostname;}catch{/* invalid URL is rejected below */}
  const sourceCourt=document.sourceId==='STF_NEWS'?'STF':'STJ';
  if(![`${sourceCourt.toLowerCase()}.jus.br`,`www.${sourceCourt.toLowerCase()}.jus.br`,...(sourceCourt==='STF'?['noticias.stf.jus.br','portal.stf.jus.br']:[])].includes(host))return {facts,issues:['A URL não pertence ao tribunal oficial da fonte.']};
  const allText=`${document.title}\n${document.text}`;
  const refs=cases(allText);
  const evidence=assessJudicialEvidence(document,person);
  if(!evidence.length)return {facts,issues:['Nenhum evento judicial afirmativo foi atribuído nominalmente à pessoa.']};
  for(const event of evidence){
    if(!identifiedPerson(allText,person)){issues.push('O documento não associa nominalmente o cargo à pessoa.');continue;}
    const local=cases(event.excerpt);
    const update=sentenceUpdate(event.excerpt,refs.length===1?allText:event.excerpt);
    const references=local.length===1?local:local.length===0&&refs.length===1?refs:update==='EXTINGUISHED'&&local.length>1?local:[];
    if(!references.length){issues.push('Processo ausente ou associação ambígua entre múltiplos processos.');continue;}
    for(const reference of references){
    if(attributedToOtherParty(reference.evidence,person)){issues.push('O processo identifica participante distinto da pessoa pesquisada.');continue;}
    const court=attributedCourt(allText,event.excerpt,reference,person);
    if(!court){issues.push('Tribunal de origem ausente, conflitante ou distinto do tribunal explicitamente suportado.');continue;}
    if(event.kind==='CONVICTION'&&reference.number.startsWith('EP ')){issues.push('A execução penal não identifica uma nova condenação; a ação penal de origem precisa estar explícita.');continue;}
    // A process attached to another named defendant cannot be borrowed from elsewhere.
    if(!update&&!local.length&&/\b(?:condenou|condenad[oa]|pres[oa]|prendeu)\b/i.test(normalize(reference.evidence))&&!matchJudicialNames(reference.evidence,person).length){issues.push('O processo está associado a evento de outra pessoa.');continue;}
    const context=refs.length===1?allText:event.excerpt;
    const category=categoryIn(`${event.excerpt}\n${reference.evidence}`,reference.number);
    if(!category){issues.push('Categoria judicial não demonstrada no contexto do processo.');continue;}
    const prescribed=update==='EXTINGUISHED'&&/^com base na prescricao da pretensao punitiva do estado\b/.test(normalize(event.excerpt))&&/\bdeclarou extinta a punibilidade\b/.test(normalize(event.excerpt));
    const conviction=prescribed?{status:'PRESCRIBED' as const,date:null}:update==='SUSPENDED'?{status:'SUSPENDED' as const,date:null}:event.kind==='CONVICTION'?statusIn(context,event.status==='REVERSED'&&!update,person):{status:null,date:null};
    const status=conviction.status;
    const details=update?sentenceDetails(allText,update,reference,person,event.excerpt):null;
    const ground=update==='REVISED'?details?.grounds??'':details?.grounds||groundsIn(event.excerpt);
    const supportingEvidence=details?.details??[];
    const combinedEvidence=[event.excerpt,...supportingEvidence].join('\n');
    const extinction=update==='EXTINGUISHED'?/punibilidade/.test(normalize(event.excerpt))?'Punibilidade extinta.':/indulto/.test(normalize(combinedEvidence))?'Penas privativas de liberdade extintas por indulto.':'Penas extintas.':'';
    const outcome=update==='EXTINGUISHED'?`${extinction} ${combinedEvidence}`:update==='SUSPENDED'?`Efeitos da condenação suspensos. ${event.excerpt}`:update==='REVISED'?`Penas redefinidas. ${combinedEvidence}`:update==='EXECUTION'?`Cumprimento de pena determinado. ${combinedEvidence}`:event.status==='REVERSED'?'Condenação anulada conforme a fonte.':event.kind==='CONVICTION'?'Condenação relatada na fonte oficial.':'Prisão efetiva relatada na fonte oficial.';
    const kind=event.kind;
    const duplicate=facts.find(f=>f.caseNumber===reference.number&&f.kind===kind);
    if(duplicate){
      if((!duplicate.grounds&&ground)||event.excerpt.length>duplicate.eventEvidence.length){duplicate.grounds=ground||duplicate.grounds;duplicate.eventEvidence=event.excerpt;duplicate.description=event.excerpt;}
      if(status==='ANNULLED')duplicate.convictionStatus=status;
      if(!duplicate.eventDate)duplicate.eventDate=eventDate(event.excerpt);
      continue;
    }
    const value=normalize(event.excerpt);
    const custodyType:JudicialExtractedFact['custodyType']=kind==='IMPRISONMENT'?(/\bpreventiva\b/.test(value)?'PREVENTIVE':/\btemporaria\b/.test(value)?'TEMPORARY':/\bdomiciliar\b/.test(value)?'HOUSE_ARREST':/\bflagrante\b/.test(value)?'FLAGRANT':/\bcumprimento (?:da|de) pena\b/.test(value)?'SENTENCE':'UNKNOWN'):null;
    facts.push({kind,category,caseNumber:reference.number,court,title:`${kind==='CONVICTION'?'Condenação':'Prisão'} — ${reference.number}`,description:combinedEvidence,eventDate:eventDate(event.excerpt),convictionStatus:status,finalityDate:conviction.date,custodyType,custodyConfirmed:kind==='IMPRISONMENT',releasedAt:null,grounds:ground,outcome,sourceUrl:document.url,sourceLabel:`${sourceCourt} — ${document.title}`.slice(0,200),eventEvidence:event.excerpt,supportingEvidence,caseEvidence:reference.evidence});
    }
  }
  return {facts,issues:[...new Set(issues)]};
}
