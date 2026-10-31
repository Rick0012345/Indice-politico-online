// @vitest-environment node
import {describe,it,expect,vi} from 'vitest';
import {createOfficialJudicialCollector,matchJudicialNames,parseStjDate,parseStjFeed,parseStfPosts} from './officialJudicialCollector';
import {createOfficialJudicialHttp} from './officialJudicialHttp';

const person={id:'11',nome:'João Exemplo',nomeCivil:'João de Exemplo Teste'};
const post=(id=1,html='<p>João Exemplo teve sua condenação anulada.</p>')=>({id,date:'2026-10-01T10:00:00',date_gmt:'2026-10-01T13:00:00',modified_gmt:'2026-10-02T13:00:00',link:`https://noticias.stf.jus.br/postsnoticias/teste-${id}/`,title:{rendered:'Decisão &amp; recurso'},content:{rendered:html}});
const feed=`<rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><item><guid>abc</guid><title>Notícia de teste</title><link>https://www.stj.jus.br/sites/portalp/Paginas/Comunicacao/Noticias/2026/teste.aspx</link><pubDate>Qui, out 29 2026 13:58:00</pubDate><content:encoded><![CDATA[<p>João Exemplo teve pedido de prisão negado.</p>]]></content:encoded></item></channel></rss>`;

describe('documentos judiciais oficiais',()=>{
  it('associa somente nome completo delimitado e não trata texto como verificação',()=>{
    expect(matchJudicialNames('Decisão sobre JOÃO EXEMPLO.',person)).toEqual(['João Exemplo']);
    expect(matchJudicialNames('João Exemplar e João Exemplos',person)).toEqual([]);
    expect(matchJudicialNames('João de Exemplo Teste foi citado.',person)).toEqual(['João de Exemplo Teste']);
    const docs=parseStfPosts([post()],person);
    expect(docs[0]).toMatchObject({title:'Decisão & recurso',publishedAt:'2026-10-01T13:00:00.000Z',signals:['CONVICTION','REVERSAL']});
    expect(docs[0]).not.toHaveProperty('convictionStatus');
    expect(docs[0]).not.toHaveProperty('custodyConfirmed');
    expect(docs[0]).not.toHaveProperty('eventDate');
  });
  it('remove scripts, exige tema judicial e preserva hash estável',()=>{
    expect(parseStfPosts([post(1,'<p>João Exemplo inaugurou uma biblioteca.</p>')],person)).toEqual([]);
    const docs=parseStfPosts([post(1,'<script>João Exemplo prisão</script><p>Uma notícia qualquer.</p>')],person);
    expect(docs).toEqual([]);
    expect(parseStfPosts([post()],person)[0].contentHash).toBe(parseStfPosts([post()],person)[0].contentHash);
    expect(()=>parseStfPosts({error:'bad'},person)).toThrow(/formato/i);
    expect(()=>parseStfPosts([{...post(),link:'https://evil.example/fonte'}],person)).toThrow(/oficial/i);
  });
  it('lê XML e data portuguesa do STJ somente com prisão relatada como cumprida',()=>{
    expect(parseStjFeed(feed,person)).toEqual([]);
    const docs=parseStjFeed(feed.replace('teve pedido de prisão negado','foi preso'),person);
    expect(docs[0]).toMatchObject({sourceId:'STJ_NEWS',sourceKey:'abc',publishedAt:'2026-10-29T16:58:00.000Z',signals:['CUSTODY']});
    expect(parseStjDate('data inválida')).toBeNull();
    expect(()=>parseStjFeed('<html>Bloqueado</html>',person)).toThrow(/formato/i);
    expect(()=>parseStjFeed('<rss><channel>',person)).toThrow(/XML/i);
    expect(()=>parseStjFeed(feed.replace('</channel></rss>',''),person)).toThrow(/XML/i);
    expect(()=>parseStjFeed('<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss><channel/></rss>',person)).toThrow(/XML/i);
  });
  it('não usa fatos de terceiros, denúncias ou votos para gerar sinais da associação',()=>{
    const rejected=[
      'João Exemplo foi denunciado. Pedro Outro foi condenado.',
      'O ministro votou pela condenação de João Exemplo.',
      'A prisão de João Exemplo foi determinada.',
      'O irmão de João Exemplo foi preso.',
    ];
    for(const text of rejected)expect(parseStfPosts([post(1,`<p>${text}</p>`)],person)).toEqual([]);
    const [doc]=parseStfPosts([post(1,'<p>João Exemplo foi condenado. Pedro Outro foi preso e teve condenação anulada.</p>')],person);
    expect(doc.signals).toEqual(['CONVICTION']);
    expect(doc.matchedNames).toEqual(['João Exemplo']);
  });
  it('pagina o acervo nominal e baixa o feed STJ uma vez por execução',async()=>{
    const calls:string[]=[];
    const fetcher=vi.fn(async(input:RequestInfo|URL)=>{
      const url=new URL(String(input));calls.push(url.href);
      if(url.hostname==='res.stj.jus.br')return new Response(feed,{headers:{'content-type':'application/xml'}});
      return new Response(JSON.stringify([post(Number(url.searchParams.get('page')))]),{headers:{'content-type':'application/json','x-wp-totalpages':'2'}});
    });
    const collect=createOfficialJudicialCollector({fetcher,intervalMs:1});
    const signal=new AbortController().signal;
    const first=await collect('STF_NEWS',person,1,signal);
    expect(first.hasMore).toBe(true);expect(first.documents).toHaveLength(1);
    expect((await collect('STF_NEWS',person,2,signal)).hasMore).toBe(false);
    await collect('STJ_NEWS',person,1,signal);
    await collect('STJ_NEWS',{...person,id:'12'},1,signal);
    expect(calls.filter(url=>url.includes('RSS.xml'))).toHaveLength(1);
    expect(calls.some(url=>new URL(url).searchParams.get('search')==='João de Exemplo Teste')).toBe(true);
  });
  it('preserva snapshots inelegíveis observados sem criar sinal positivo',async()=>{
    const changed=post(1,'<p>João Exemplo foi citado; a notícia não confirma condenação.</p>');
    expect(parseStfPosts([changed],person)).toEqual([]);
    expect(parseStfPosts([changed],person,true)).toMatchObject([{sourceKey:'1',signals:[],matchedNames:['João Exemplo']}]);
    expect(parseStjFeed(feed,person,true)).toMatchObject([{sourceKey:'abc',signals:[],matchedNames:['João Exemplo']}]);
    const correctedFeed=feed.replaceAll('João Exemplo','Terceiro Diverso');
    expect(parseStjFeed(correctedFeed,person)).toEqual([]);
    expect(parseStjFeed(correctedFeed,person,true)).toMatchObject([{sourceKey:'abc',signals:[],matchedNames:[],text:'Terceiro Diverso teve pedido de prisão negado.'}]);
    const collect=createOfficialJudicialCollector({intervalMs:1,fetcher:async()=>new Response(JSON.stringify([changed]),{headers:{'content-type':'application/json','x-wp-totalpages':'1'}})});
    const result=await collect('STF_NEWS',person,1,new AbortController().signal);
    expect(result.documents).toEqual([]);
    expect(result.observedDocuments).toMatchObject([{sourceKey:'1',signals:[],text:'João Exemplo foi citado; a notícia não confirma condenação.'}]);
  });
  it('observa correção do mesmo guid STJ quando a fonte passa a apontar outro sujeito',async()=>{
    const corrected=feed.replace('João Exemplo teve pedido de prisão negado','Terceiro Diverso foi condenado');
    const collect=createOfficialJudicialCollector({intervalMs:1,fetcher:async()=>new Response(corrected,{headers:{'content-type':'application/xml'}})});
    const result=await collect('STJ_NEWS',person,1,new AbortController().signal);
    expect(result.documents).toEqual([]);
    expect(result.observedDocuments).toMatchObject([{sourceKey:'abc',matchedNames:[],signals:[],text:'Terceiro Diverso foi condenado.'}]);
  });
});

describe('fronteira HTTP oficial',()=>{
  const stf='https://noticias.stf.jus.br/wp-json/wp/v2/posts?per_page=20';
  it('recusa URLs/redirects fora das rotas permitidas antes de transmitir',async()=>{
    const fetcher=vi.fn(async()=>new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}}));
    const get=createOfficialJudicialHttp({fetcher,intervalMs:1});
    await expect(get('https://evil.example',new AbortController().signal)).rejects.toThrow(/permitida/i);
    expect(fetcher).not.toHaveBeenCalled();
    await expect(get(stf,new AbortController().signal)).rejects.toThrow(/permitida/i);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('recusa corpo excessivo e timeout, sem interpretar como lista vazia',async()=>{
    const get=createOfficialJudicialHttp({fetcher:async()=>new Response('x'.repeat(100)),intervalMs:1,maxBytes:30});
    await expect(get(stf,new AbortController().signal)).rejects.toThrow(/limite/i);
    const timeout=createOfficialJudicialHttp({fetcher:async(_url,options)=>new Promise<Response>((_resolve,reject)=>options!.signal!.addEventListener('abort',()=>reject(options!.signal!.reason))),intervalMs:1,timeoutMs:15,attempts:1});
    await expect(timeout(stf,new AbortController().signal)).rejects.toThrow(/tempo/i);
  });
  it('respeita cancelamento e não insiste em 429 com espera longa',async()=>{
    const fetcher=vi.fn(async()=>new Response('',{status:429,headers:{'retry-after':'3600'}}));
    const get=createOfficialJudicialHttp({fetcher,intervalMs:1});
    await expect(get(stf,new AbortController().signal)).rejects.toThrow(/limite de consultas/i);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const abort=new AbortController();abort.abort();
    await expect(get(stf,abort.signal)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
