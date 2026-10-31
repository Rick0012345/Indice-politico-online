import {createHttpRateLimiter} from './ingestionRateLimiter';

export class OfficialJudicialSourceError extends Error {
  constructor(message: string, public status?: number, public body?: string) {super(message); this.name='OfficialJudicialSourceError';}
}
export type OfficialJudicialHttpOptions = {fetcher?: typeof fetch; intervalMs?: number; timeoutMs?: number; maxBytes?: number; attempts?: number};
const permittedPaths: Record<string,string[]> = {
  'noticias.stf.jus.br':['/wp-json/wp/v2/posts'],
  'res.stj.jus.br':['/hrestp-c-portalp/RSS.xml'],
  'portal.stf.jus.br':['/processos/listarProcessos.asp','/processos/detalhe.asp','/processos/abaAndamentos.asp','/processos/abaPartes.asp','/processos/abaInformacoes.asp'],
  'digital.stf.jus.br':['/integracoes-processos/api/public/partes/processos'],
};
const processClasses=new Set(['AP','INQ','PET','MS','RCL','RE','ARE','AI','AR','RVC','HC','AC','EP','ADPF','ADI','ADC','ADO','MI','AO','ACO','IF','SL','SS','STA','SIS','RHC','RMS','EI','TPA']);
function permitted(value: string) {
  let url:URL;
  try {url=new URL(value);} catch {throw new OfficialJudicialSourceError('Rota de coleta não permitida.');}
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||!permittedPaths[url.hostname]?.includes(url.pathname))
    throw new OfficialJudicialSourceError('Rota de coleta não permitida.');
  if(url.hostname==='portal.stf.jus.br'){
    if([...url.searchParams.keys()].some(key=>url.searchParams.getAll(key).length!==1))throw new OfficialJudicialSourceError('Parâmetro processual duplicado não permitido.');
    const lookup=url.pathname==='/processos/listarProcessos.asp';
    if(lookup?(!processClasses.has((url.searchParams.get('classe')??'').toUpperCase())||!/^\d{1,12}$/.test(url.searchParams.get('numeroProcesso')??'')):!/^\d{1,12}$/.test(url.searchParams.get('incidente')??''))
      throw new OfficialJudicialSourceError('Identificação processual inválida.');
    const allowed=lookup?['classe','numeroProcesso']:['incidente','imprimir'];
    if([...url.searchParams.keys()].some(key=>!allowed.includes(key)))throw new OfficialJudicialSourceError('Parâmetro processual não permitido.');
    if(url.searchParams.has('imprimir')&&!['','true','false'].includes(url.searchParams.get('imprimir')!))throw new OfficialJudicialSourceError('Parâmetro de impressão inválido.');
  }
  if(url.hostname==='digital.stf.jus.br'){
    const allowed=['nome','processosPorPagina','pagina','processosEmTramitacao','tipoPesquisa'];
    if([...url.searchParams.keys()].some(key=>!allowed.includes(key)||url.searchParams.getAll(key).length!==1)||allowed.some(key=>!url.searchParams.has(key)))throw new OfficialJudicialSourceError('Parâmetro de consulta nominal não permitido.');
    const name=url.searchParams.get('nome')??'';
    if(name.length<3||name.length>100||/[\x00-\x1f]/.test(name)||url.searchParams.get('processosPorPagina')!=='20'||!/^\d{1,3}$/.test(url.searchParams.get('pagina')??'')||Number(url.searchParams.get('pagina'))<1||Number(url.searchParams.get('pagina'))>500||!['sim','nao'].includes(url.searchParams.get('processosEmTramitacao')??'')||url.searchParams.get('tipoPesquisa')!=='PARTE')throw new OfficialJudicialSourceError('Consulta nominal inválida.');
  }
  return url;
}
async function boundedText(response: Response,maxBytes:number) {
  if(Number(response.headers.get('content-length'))>maxBytes){await response.body?.cancel();throw new OfficialJudicialSourceError('Documento excede o limite de tamanho da coleta.');}
  if(!response.body)return '';
  const reader=response.body.getReader();const parts:Uint8Array[]=[];let size=0;
  try {
    for(;;){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;
      if(size>maxBytes){await reader.cancel();throw new OfficialJudicialSourceError('Documento excede o limite de tamanho da coleta.');}parts.push(item.value);}
    return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts));
  } finally {reader.releaseLock();}
}

/** Only fixed official connector routes can be fetched, including redirects. */
export function createOfficialJudicialHttp(options:OfficialJudicialHttpOptions={}) {
  const {fetcher=fetch,intervalMs=1000,timeoutMs=20_000,maxBytes=4*1024*1024,attempts=2}=options;
  const rate=createHttpRateLimiter({intervalMs});
  return async (input:string,signal:AbortSignal):Promise<{text:string;headers:Headers;url:string}>=>{
    const initial=permitted(input);
    for(let attempt=0;attempt<attempts;attempt++){
      signal.throwIfAborted();await rate.waitForSlot();signal.throwIfAborted();
      const controller=new AbortController();let timedOut=false;
      const cancel=()=>controller.abort(signal.reason);
      signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
      const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
      try {
        let url=initial;
        for(let redirects=0;redirects<=3;redirects++){
          const response=await fetcher(url.href,{method:'GET',redirect:'manual',signal:controller.signal,headers:{Accept:'application/json, application/xml, text/html, text/xml;q=0.9','User-Agent':'CatalogoPolitico/1.0 (coleta de fontes oficiais)'}});
          if(response.status>=300&&response.status<400){
            const location=response.headers.get('location');await response.body?.cancel();
            if(!location||redirects===3)throw new OfficialJudicialSourceError('Redirecionamento inválido na fonte oficial.');
            url=permitted(new URL(location,url).href);continue;
          }
          if(response.status===429){
            const retry=response.headers.get('retry-after');await response.body?.cancel();
            const seconds=retry&&/^\d+$/.test(retry)?Number(retry)*1000:retry?Date.parse(retry)-Date.now():2000;
            const delay=Number.isFinite(seconds)?Math.max(1000,seconds):2000;
            if(delay>10_000||attempt===attempts-1)throw new OfficialJudicialSourceError('A fonte oficial atingiu o limite de consultas. Retome a coleta mais tarde.',429);
            rate.cooldown(delay);break;
          }
          const text=await boundedText(response,maxBytes);
          if(!response.ok){
            if(response.status>=500&&attempt<attempts-1){rate.cooldown(1000*(attempt+1));break;}
            throw new OfficialJudicialSourceError(`Fonte oficial indisponível (HTTP ${response.status}).`,response.status,text);
          }
          return {text,headers:response.headers,url:url.href};
        }
      } catch(error){
        if(signal.aborted)throw signal.reason??new Error('Coleta cancelada.');
        if(error instanceof OfficialJudicialSourceError)throw error;
        if(attempt===attempts-1)throw new OfficialJudicialSourceError(timedOut?'A fonte oficial excedeu o tempo de resposta.':'Não foi possível acessar a fonte oficial.');
        rate.cooldown(1000*(attempt+1));
      } finally {clearTimeout(timer);signal.removeEventListener('abort',cancel);}
    }
    throw new OfficialJudicialSourceError('Não foi possível acessar a fonte oficial.');
  };
}
