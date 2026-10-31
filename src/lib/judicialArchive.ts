import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parseStfPosts} from './officialJudicialCollector';
import type {JudicialPageCollector} from './judicialIngestionTypes';
export const JUDICIAL_ARCHIVE_FILE='output/judicial-ingestion/archive-matched.json';
export type JudicialArchiveScope={sha256:string;queries:string[];documentCount:number};
type Entry={raw:unknown;matches:Array<{politicoId:string}>};
export function createArchivedJudicialCollector(scope:JudicialArchiveScope):JudicialPageCollector {
  let loaded:Promise<Map<string,unknown[]>>|undefined;
  const load=()=>loaded??=(async()=>{const content=await readFile(JUDICIAL_ARCHIVE_FILE,'utf8');if(createHash('sha256').update(content).digest('hex')!==scope.sha256)throw new Error('O acervo desta execução foi alterado; não retomar com outras evidências.');const entries:Entry[]=JSON.parse(content.replace(/^\uFEFF/,''));const people=new Map<string,unknown[]>();for(const entry of entries)for(const match of entry.matches){const docs=people.get(match.politicoId)??[];docs.push(entry.raw);people.set(match.politicoId,docs);}return people;})();
  return async(source,person,page,signal)=>{signal.throwIfAborted();if(source!=='STF_NEWS'||page!==1)throw new Error('Escopo de acervo inválido.');const raw=(await load()).get(person.id)??[];signal.throwIfAborted();const documents=parseStfPosts(raw,person,true);return {documents:documents.filter(d=>d.signals.length),observedDocuments:documents.filter(d=>!d.signals.length),hasMore:false,scope:`Acervo oficial do STF: consultas ${scope.queries.join(', ')}. Correspondência e dados limitados às fontes coletadas.`};};
}
