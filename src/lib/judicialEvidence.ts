import type {JudicialIngestionPerson} from './judicialIngestionTypes';

/** REPORTED describes the source's historical report; it asserts no present/final legal status. */
export type JudicialEvidence={kind:'CONVICTION'|'IMPRISONMENT';excerpt:string;matchedName:string;status:'REPORTED'|'REVERSED'};
const normalized=(value:string)=>value.normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
export function judicialPersonNames(person:JudicialIngestionPerson){
  const seen=new Set<string>();
  return [person.nomeCivil,person.nome].filter((name):name is string=>{
    if(!name)return false;
    const key=normalized(name);
    if(key.length<5||key.split(' ').length<2||seen.has(key))return false;
    seen.add(key);return true;
  });
}
/** Exact textual occurrence is candidate discovery only, never identity verification. */
export function matchJudicialNames(text:string,person:JudicialIngestionPerson){
  const haystack=` ${normalized(text)} `;
  return judicialPersonNames(person).filter(name=>haystack.includes(` ${normalized(name)} `));
}

// Deliberately closed grammar: neither arbitrary text before a name nor a window of
// nearby keywords may establish who suffered the event. Unrecognised prose stays out.
const role='(?:(?:o|a) )?(?:(?:(?:ex|entao) )?(?:deputado|deputada|senador|senadora|presidente|prefeito|prefeita|governador|governadora|parlamentar|vereador|vereadora)(?: federal| estadual)?(?: licenciado| licenciada)? )?';
const courtName='(?:supremo tribunal federal|superior tribunal de justica|stf|stj)';
const court='(?:(?:o|a) )?(?:stf|stj|supremo(?: tribunal federal)?|superior tribunal de justica|tribunal(?: de justica)?|(?:primeira|segunda|terceira|quarta|quinta|sexta|[1-6]ª) turma(?: do '+courtName+')?|plenario(?: do '+courtName+')?|justica(?: federal)?)';
const manner='(?: por unanimidade| por maioria)?';
const decisionStart='^(?:por unanimidade |por maioria )?';
const auxiliary='(?:e|foi|era|havia sido|tinha sido|ja havia sido|ja tinha sido|ja foi)';
const convict='condenad[oa]';
const reversed='(?:anulad[oa]|revertid[oa]|desconstituid[oa]|cassad[oa])';
const objectEnd='(?= (?:por|a|ao|aos|em|pelo|pela|pelos|pelas|no|na|nos|nas|e) |$)';

export function assessJudicialEvidence(doc:{title:string;text:string},person:JudicialIngestionPerson):JudicialEvidence[]{
  const result:JudicialEvidence[]=[];const seen=new Set<string>();
  for(const source of [doc.title,doc.text]){
    for(const fragment of source.split(/(?<=[.!?])\s+|[\n\r;]+/u)){
      const excerpt=fragment.trim();if(!excerpt)continue;
      // Only known institutional acronyms and party/state annotations are removed.
      // Arbitrary parentheticals may contain a denial and must remain visible.
      const text=normalized(excerpt.replace(/\((?:STF|STJ|(?:[A-Z]{2,10}|Solidariedade)-[A-Z]{2})\)/g,' '))
        .replace(/\brecursos embargos de declaracao\b/g,'recursos')
        .replace(/\bpor (maioria|unanimidade) de votos\b/g,'por $1');
      // A negative/modal/request/vote clause cannot itself prove an actual event.
      // A separate affirmative historical sentence remains eligible.
      if(/[?]/.test(excerpt)||/\b(?:nao|nunca|jamais|se|caso|hipotese|poderia|pudesse|seria|sera|serao|devera|deveria|pede|pedem|pediu|pedido|pedidos|requer|requereu|requerimento|solicita|solicitou|propos|proposta|vota|votou|voto|votos|votaram|opina|opinou|defende|defendeu)\b/.test(text))continue;
      for(const matchedName of matchJudicialNames(excerpt,person)){
        const name=normalized(matchedName);
        const subject=`^${role}${name} `;
        const namedObject=`(?:de|do|da) ${role}${name}`;
        const subjectReversal=new RegExp(`${subject}(?:teve|tem) (?:a |sua )?condenacao ${reversed}\\b`);
        const passiveReversal=new RegExp(`^(?:a )?condenacao ${namedObject} ${auxiliary} ${reversed}\\b`);
        const activeReversal=new RegExp(`${decisionStart}${court}${manner} (?:anulou|anula|reverteu|reverte|desconstituiu|cassa|cassou)${manner} (?:a )?condenacao ${namedObject}${objectEnd}`);
        const continuedReversal=new RegExp(`${subject}${auxiliary} ${convict}(?: em \\d{4})? (?:mas|e) teve (?:a sua|sua|a) condenacao ${reversed}\\b`);
        const decisionReversal=new RegExp(`${subject}${auxiliary} ${convict} em (?:uma )?decisao (?:posteriormente )?${reversed}\\b`);
        const isReversed=subjectReversal.test(text)||passiveReversal.test(text)||activeReversal.test(text)||continuedReversal.test(text)||decisionReversal.test(text);
        const passiveConviction=new RegExp(`${subject}${auxiliary} ${convict}\\b`);
        const activeConviction=new RegExp(`${decisionStart}${court}${manner} (?:condenou|condena)${manner} ${role}${name}${objectEnd}`);
        const maintainedConviction=new RegExp(`${decisionStart}(?:(?:foi|fica) mantida|mantida|${court}${manner} (?:manteve|mantem|confirmou|confirma))${manner} (?:a )?condenacao ${namedObject}${objectEnd}`);
        const rejectedConvictionAppeal=new RegExp(`${decisionStart}${court}${manner} (?:rejeitou|rejeita|negou) (?:os )?recursos ${namedObject}(?: e (?:do|da) hacker [a-z ]+)? contra a condenacao\\b`);
        const suspendedEffects=new RegExp(`${decisionStart}${court}${manner} (?:suspendeu|suspende) (?:os )?efeitos (?:da )?condenacao ${namedObject}${objectEnd}`);
        const revisedStart='^(?:na sessao desta (?:segunda|terca|quarta|quinta|sexta) feira (?:\\d{1,2} )?)?';
        const revisedSentence=new RegExp(`${revisedStart}${court}${manner} acolheu recursos ${namedObject}(?: e (?:do|da) engenheiro [a-z ]+)? contra as penas\\b`);
        const authority=`(?:${court}|(?:(?:o|a) )?ministr[oa] [a-z ]{3,80} d[oa] ${courtName})`;
        const extinguishedSentence=new RegExp(`${decisionStart}${authority} (?:declarou extintas|extinguiu) (?:as )?penas(?: privativas de liberdade)? (?:impostas )?(?:ao|a|do|da|de) ${role}${name}${objectEnd}`);
        const prescribedSentence=new RegExp(`^(?:com base na prescricao da pretensao punitiva do estado )?${authority} declarou extinta a punibilidade ${namedObject}(?: (?:ac|al|ap|am|ba|ce|df|es|go|ma|mt|ms|mg|pa|pb|pr|pe|pi|rj|rn|rs|ro|rr|sc|sp|se|to))?(?= condenado| condenada| na | no | por |$)`);
        const orderedSentence=new RegExp(`${decisionStart}${authority} determinou o inicio do cumprimento da pena imposta (?:ao|a) ${role}${name}${objectEnd}`);
        const passivePrison=new RegExp(`${subject}${auxiliary} (?:pres[oa]|detid[oa]|recolhid[oa] (?:a prisao|ao carcere))\\b`);
        const activePrison=new RegExp(`^(?:a )?policia(?: federal| civil| militar)? (?:prendeu|deteve) ${role}${name}${objectEnd}`);
        const kinds:JudicialEvidence['kind'][]=[];
        const ambiguousReversal=!isReversed&&/\b(?:anulad[oa]|revertid[oa]|desconstituid[oa]|cassad[oa])\b/.test(text);
        if(isReversed||(!ambiguousReversal&&(passiveConviction.test(text)||activeConviction.test(text)||maintainedConviction.test(text)||rejectedConvictionAppeal.test(text)||suspendedEffects.test(text)||revisedSentence.test(text)||extinguishedSentence.test(text)||prescribedSentence.test(text)||orderedSentence.test(text))))kinds.push('CONVICTION');
        if(passivePrison.test(text)||activePrison.test(text))kinds.push('IMPRISONMENT');
        for(const kind of kinds){
          const status=kind==='CONVICTION'&&isReversed?'REVERSED':'REPORTED';
          const key=JSON.stringify([kind,status,matchedName,excerpt]);if(seen.has(key))continue;seen.add(key);
          result.push({kind,excerpt,matchedName,status});
        }
      }
    }
  }
  return result;
}
