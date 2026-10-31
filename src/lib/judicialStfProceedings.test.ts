import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe,it,expect,vi} from 'vitest';
import {createStfProceedingsCollector,createStfProceedingsNominalCollector} from './judicialStfProceedings';
import {createOfficialJudicialHttp} from './officialJudicialHttp';
import type {ProceedingPerson} from './judicialProceedingsTypes';
const signal=new AbortController().signal;
const person:ProceedingPerson={id:'1',nome:'Celso Jacob',nomeCivil:'CELSO ALENCAR RAMOS JACOB',birthDate:'1957-07-21',anchors:[{court:'STF',caseNumber:'AP 971',sourceUrl:'https://noticias.stf.jus.br/postsnoticias/caso/',excerpt:'O deputado federal Celso Alencar Ramos Jacob foi condenado na AP 971.'}]};
const cnj='0008812-20.2015.1.00.0000';
const row=(incident=4910640,number='AP 971',name=person.nomeCivil!,cnjNumber=cnj)=>({id:incident+10,pessoaId:incident===4910640?2760403:2481225,pessoaNome:name,processoId:incident,processoIdentificacao:number,processoNumeroUnico:cnjNumber,processoDataAutuacao:'23/12/2015',processoMeio:'Físico',processoPublicidade:'Público',processoEmTramitacao:incident===4910640?'Não':'Sim'});
const detail=(number='AP 971',incident=4910640,cnjNumber=cnj)=>`<input id="classe-numero-processo" value="${number}"><input id="incidente" value="${incident}"><div class="processo-rotulo">Número Único: ${cnjNumber}</div>`;
const parts=(name=person.nomeCivil!,role='RÉU(É)(S)')=>`<div id="todas-partes"><div class="processo-partes"><div class="detalhe-parte">${role}</div><div class="nome-parte">${name}</div></div></div><div id="partes-resumidas">${name}</div>`;
function mock(active=[row(5070859,'Pet 6341')],closed=[row()]){
  return vi.fn(async(input:RequestInfo|URL)=>{
    const url=new URL(String(input));
    if(url.hostname==='digital.stf.jus.br'){const open=url.searchParams.get('processosEmTramitacao')==='sim';const rows=open?active:closed;return Response.json({totalDePaginas:rows.length?1:0,totalDeRegistros:rows.length,partes:rows.map(row=>({...row,processoEmTramitacao:open?'Sim':'Não'}))});}
    if(url.pathname.endsWith('listarProcessos.asp'))return new Response(detail());
    if(url.pathname.endsWith('detalhe.asp')){const incident=Number(url.searchParams.get('incidente'));const found=[...active,...closed].find(row=>row.processoId===incident);return new Response(detail(found?.processoIdentificacao??'AP 971',incident,found?.processoNumeroUnico??cnj));}
    if(url.pathname.endsWith('abaAndamentos.asp'))return new Response('<div class="processo-andamentos"></div>');
    if(url.pathname.endsWith('abaPartes.asp'))return new Response(parts());
    if(url.pathname.endsWith('abaInformacoes.asp'))return new Response('<div id="informacoes-completas"><div class="informacoes__assunto"><ul><li>DIREITO PENAL | Falsidade</li></ul></div></div>');
    throw new Error('Unexpected URL '+url);
  });
}
describe('descoberta processual STF com prova de identidade',()=>{
  // The 17 MiB body is parsed by Cheerio: isolated local runs with a 1536 MiB
  // heap took 3.90 s and 4.98 s. Allow headroom on the 1.5-CPU validation host;
  // keep the production transport limits and the oversized-body assertions.
  it('lê andamentos públicos maiores que 16 MiB e mantém o limite de 40 MiB',async()=>{
    for(const oversized of [false,true]){
      const original=mock([row(222,'AP 222',person.nomeCivil!,'0000001-01.2000.1.00.0000')],[]);
      const html=`<div class="processo-andamentos"><div class="andamento-item"><div class="andamento-data">10/01/2020</div><div class="col-md-9 p-0">Decisão: Intime-se o deputado federal ${person.nomeCivil} para manifestação.</div></div></div>`;
      const fetcher=vi.fn(async(input:RequestInfo|URL)=>String(input).includes('abaAndamentos')?new Response(oversized?html:html+' '.repeat(17*1024*1024),oversized?{headers:{'content-length':String(41*1024*1024)}}:{}):String(input).includes('detalhe.asp')?new Response(detail('AP 222',222)):original(input));
      const result=await createStfProceedingsCollector({fetcher,intervalMs:1,attempts:1})({...person,anchors:[]},1,signal);
      if(oversized){expect(result.proceedings.observations).toEqual([]);expect(result.proceedings.errors).toHaveLength(1);}
      else{expect(result.proceedings.observations[0].identity).toBe('CONFIRMED');expect(result.proceedings.errors).toEqual([]);}
    }
  },20_000);
  it('usa a sigla oficial Pet na consulta por número mesmo quando a âncora está em maiúsculas',async()=>{
    const original=mock([],[]);
    const fetcher=vi.fn(async(input:RequestInfo|URL)=>{
      const url=new URL(String(input));
      if(url.pathname.endsWith('listarProcessos.asp'))return new Response(url.searchParams.get('classe')==='Pet'?detail('Pet 9456',6115695):'<html>Consulta sem identificação</html>');
      return original(input);
    });
    const result=await createStfProceedingsCollector({fetcher,intervalMs:1})({...person,anchors:[{...person.anchors[0],caseNumber:'PET 9456'}]},1,signal);
    expect(result.proceedings.errors).toEqual([]);
    expect(result.proceedings.observations).toEqual([expect.objectContaining({sourceKey:'6115695',caseNumber:'Pet 9456',identity:'CONFIRMED'})]);
  });
  it('consulta ambas partições e vincula reautuação pelo CNJ da âncora verificada sem exigir mesmo pessoaId',async()=>{
    const collect=createStfProceedingsCollector({fetcher:mock(),intervalMs:1});
    const result=await collect(person,1,signal);
    expect(result.proceedings.nominalMatches).toBe(2);
    expect(result.proceedings.observations).toHaveLength(2);
    expect(result.proceedings.observations).toEqual(expect.arrayContaining([expect.objectContaining({caseNumber:'Pet 6341',identity:'CONFIRMED',cnjNumber:cnj,sourcePersonId:'2481225',roles:[{role:'DEFENDANT',label:'RÉU(É)(S)'}]})]));
    expect(result.proceedings.observations.every(x=>x.identityEvidence.length>0)).toBe(true);
    expect(result.hasMore).toBe(false);
  });
  it('não confirma nome exato ou pessoaId da âncora em processo de CNJ diferente',async()=>{
    const unknown={...row(222,'RE 123','CELSO ALENCAR RAMOS JACOB','0000001-01.2000.1.00.0000'),pessoaId:2760403};
    const result=await createStfProceedingsCollector({fetcher:mock([unknown],[]),intervalMs:1})(person,1,signal);
    expect(result.proceedings.observations.find(x=>x.sourceKey==='222')).toMatchObject({identity:'UNRESOLVED',identityEvidence:[]});
  });
  it('filtra nome parcial e conserva autor/recorrente com seus papéis próprios',async()=>{
    const fetcher=mock([row(11,'MS 1','OUTRO CELSO ALENCAR RAMOS JACOB')],[]);
    const original=mock([row()],[]);
    fetcher.mockImplementation(async(input)=>String(input).includes('abaPartes')?new Response(parts(person.nomeCivil!,'IMPTE.(S)')):original(input));
    const result=await createStfProceedingsCollector({fetcher,intervalMs:1})(person,1,signal);
    expect(result.proceedings.observations[0].roles).toEqual([{role:'AUTHOR',label:'IMPTE.(S)'}]);
  });
  it('recupera caso âncora ausente na busca nominal e recusa nominal que diverge nas partes',async()=>{
    const result=await createStfProceedingsCollector({fetcher:mock([],[]),intervalMs:1})(person,1,signal);
    expect(result.proceedings.observations).toHaveLength(1);
    expect(result.proceedings.observations[0]).toMatchObject({caseNumber:'AP 971',identity:'CONFIRMED',sourcePersonId:null});
    const fetcher=mock();const original=mock();fetcher.mockImplementation(async(input)=>String(input).includes('abaPartes')?new Response(parts('OUTRO HOMÔNIMO')):original(input));
    const divergent=await createStfProceedingsCollector({fetcher,intervalMs:1})(person,1,signal);
    expect(divergent.proceedings.observations.every(x=>x.identity==='UNRESOLVED')).toBe(true);
  });
  it('cronologia incompatível impede confirmação mesmo com caso da âncora',async()=>{
    const old={...row(),processoDataAutuacao:'15/06/1950'};
    const result=await createStfProceedingsCollector({fetcher:mock([old],[]),intervalMs:1})(person,1,signal);
    expect(result.proceedings.observations[0].identity).toBe('UNRESOLVED');
  });
  it('confirma somente contexto parlamentar nominal do corpo do andamento de caso passivo',async()=>{
    const original=mock([row(222,'AP 222',person.nomeCivil!,'0000001-01.2000.1.00.0000')],[]);
    const fetcher=vi.fn(async(input:RequestInfo|URL)=>String(input).includes('abaAndamentos')?new Response(`<div class="processo-andamentos"><div class="andamento-item"><div class="andamento-data">10/01/2020</div><div class="col-md-9 p-0">Decisão: Intime-se o deputado federal ${person.nomeCivil} para manifestação.</div></div></div>`):String(input).includes('detalhe.asp')?new Response(detail('AP 222',222,'0000001-01.2000.1.00.0000')):original(input));
    const result=await createStfProceedingsCollector({fetcher,intervalMs:1})({...person,anchors:[]},1,signal);
    expect(result.proceedings.observations[0]).toMatchObject({identity:'CONFIRMED',identityEvidence:[expect.objectContaining({method:'OFFICIAL_CONTEXT'})]});
  });
  it('contexto de outro nome, cabeçalho ou placeholder sigiloso não identifica pessoa',async()=>{
    for(const text of ['Decisão: O deputado federal OUTRO NOME foi ouvido.',`<h2>deputado federal ${person.nomeCivil}</h2>`,`Decisão (segredo de justiça): deputado federal ${person.nomeCivil}`]){
      const original=mock([row(222,'AP 222',person.nomeCivil!,'0000001-01.2000.1.00.0000')],[]);
      const fetcher=vi.fn(async(input:RequestInfo|URL)=>String(input).includes('abaAndamentos')?new Response(`<div class="processo-andamentos"><div class="andamento-item"><div class="andamento-data">10/01/2020</div><div class="col-md-9 p-0">${text}</div></div></div>`):String(input).includes('detalhe.asp')?new Response(detail('AP 222',222)):original(input));
      expect((await createStfProceedingsCollector({fetcher,intervalMs:1})({...person,anchors:[]},1,signal)).proceedings.observations[0].identity).toBe('UNRESOLVED');
    }
  });
  it.each([
    ['Citação','Em 20/09/2011, do Exmo. Deputado Federal Sílvio Serafim Costa, para apresentar defesa prévia no prazo de 5 (cinco) dias.','SÍLVIO SERAFIM COSTA','SILVIO COSTA'],
    ['Notificação','de sua Excelência o Senhor Sílvio Serafim Costa, Deputado Federal, para, querendo, apresentar, em quinze dias, defesa.','SÍLVIO SERAFIM COSTA','SILVIO COSTA'],
    ['Devolução de mandado','(Em 18/12/2014) Do , Deputado Federal Izalci Lucas Ferreira','IZALCI LUCAS FERREIRA','IZALCI LUCAS'],
  ])('confirma identidade em certidão pessoal fechada %s sem inferir condenação',async(title,text,civil,nome)=>{
    const target={...person,nome,nomeCivil:civil,anchors:[],birthDate:'1950-01-01'};
    const original=mock([row(222,'AP 222',civil,'0000001-01.2000.1.00.0000')],[]);
    const fetcher=vi.fn(async(input:RequestInfo|URL)=>String(input).includes('abaAndamentos')?new Response(`<div class="processo-andamentos"><div class="andamento-item"><div class="andamento-data">10/01/2020</div><h5 class="andamento-nome">${title}</h5><div class="col-md-9 p-0">${text}</div></div></div>`):String(input).includes('abaPartes')?new Response(parts(civil)):original(input));
    const result=await createStfProceedingsCollector({fetcher,intervalMs:1})(target,1,signal);
    expect(result.proceedings.observations[0]).toMatchObject({identity:'CONFIRMED',identityEvidence:[{method:'OFFICIAL_CONTEXT',url:expect.any(String),excerpt:text}],subjects:['DIREITO PENAL | Falsidade']});
    expect(result.proceedings.observations[0]).not.toHaveProperty('convictionStatus');
  });
  it.each([
    ['Citação','Citação de precedente: na AP 123, o deputado federal Sílvio Serafim Costa apresentou defesa.'],
    ['Citação','Em 20/09/2011, do Exmo. Deputado Federal Sílvio Serafim Costa Filho, para apresentar defesa prévia no prazo de 5 (cinco) dias.'],
    ['Juntada','Em 20/09/2011, do Exmo. Deputado Federal Sílvio Serafim Costa, para apresentar defesa prévia no prazo de 5 (cinco) dias.'],
    ['Devolução de mandado','(Em 18/12/2014) Do , Deputado Federal Sílvio Serafim Costa Junior'],
    ['Notificação','Transcrição de outro processo: de sua Excelência o Senhor Sílvio Serafim Costa, Deputado Federal, para, querendo, apresentar, em quinze dias, defesa.'],
  ])('não usa precedente, nomes maiores ou outro ato para identidade: %s',async(title,text)=>{
    const civil='SÍLVIO SERAFIM COSTA';const target={...person,nome:'SILVIO COSTA',nomeCivil:civil,anchors:[]};
    const original=mock([row(222,'AP 222',civil,'0000001-01.2000.1.00.0000')],[]);
    const fetcher=vi.fn(async(input:RequestInfo|URL)=>String(input).includes('abaAndamentos')?new Response(`<div class="processo-andamentos"><div class="andamento-item"><div class="andamento-data">10/01/2020</div><h5 class="andamento-nome">${title}</h5><div class="col-md-9 p-0">${text}</div></div></div>`):String(input).includes('abaPartes')?new Response(parts(civil)):original(input));
    const result=await createStfProceedingsCollector({fetcher,intervalMs:1})(target,1,signal);
    expect(result.proceedings.observations[0]).toMatchObject({identity:'UNRESOLVED',subjects:[]});
    expect(fetcher.mock.calls.some(([url])=>String(url).includes('abaInformacoes'))).toBe(false);
  });
  it('não consulta assuntos de autor sem identidade comprovada',async()=>{
    const original=mock([row(222,'MS 222',person.nomeCivil!,'0000001-01.2000.1.00.0000')],[]);
    const fetcher=vi.fn(async(input:RequestInfo|URL)=>String(input).includes('abaPartes')?new Response(parts(person.nomeCivil!,'IMPTE.(S)')):original(input));
    const result=await createStfProceedingsCollector({fetcher,intervalMs:1})({...person,anchors:[]},1,signal);
    expect(result.proceedings.observations[0]).toMatchObject({identity:'UNRESOLVED',subjects:[],roles:[{role:'AUTHOR',label:'IMPTE.(S)'}]});
    expect(fetcher.mock.calls.some(([url])=>String(url).includes('abaInformacoes')||String(url).includes('abaAndamentos'))).toBe(false);
  });
  it('não inventa zero quando servidor falha, formato muda ou há cancelamento',async()=>{
    for(const response of [new Response('bloqueado',{status:403}),new Response('<html>sem resultados</html>')]){
      await expect(createStfProceedingsCollector({fetcher:vi.fn(async()=>response.clone()),intervalMs:1,attempts:1})({...person,anchors:[]},1,signal)).rejects.toThrow();
    }
    const controller=new AbortController();controller.abort(new Error('Cancelado pelo usuário'));
    const fetcher=mock();await expect(createStfProceedingsCollector({fetcher,intervalMs:1})(person,1,controller.signal)).rejects.toThrow(/Cancelado/);expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([['4910640','Pet 6341'],['5070859','AP 971']])('preserva caso bem-sucedido quando incidente %s falha com HTTP502 sem vazar o corpo',async(failedIncident,expectedCase)=>{
    const original=mock();const fetcher=vi.fn(async(input:RequestInfo|URL)=>String(input).includes('abaPartes.asp?incidente='+failedIncident)?new Response('CORPO_PRIVADO_NAO_PUBLICAR',{status:502}):original(input));
    const result=await createStfProceedingsCollector({fetcher,intervalMs:1,attempts:1})(person,1,signal);
    expect(result.proceedings.observations).toHaveLength(1);
    expect(result.proceedings.observations[0]).toMatchObject({caseNumber:expectedCase,identity:'CONFIRMED'});
    expect(result.proceedings.errors).toEqual([expect.stringMatching(new RegExp(failedIncident+'.*partes.*502'))]);
    expect(JSON.stringify(result)).not.toContain('CORPO_PRIVADO');
    expect(result.proceedings.nominalMatches).toBe(2);
  });
  it('isola mudança de estrutura ao incidente e etapa que falhou',async()=>{
    const original=mock();const fetcher=vi.fn(async(input:RequestInfo|URL)=>String(input).includes('abaPartes.asp?incidente=4910640')?new Response('<article>ESTRUTURA_PRIVADA</article>'):original(input));
    const result=await createStfProceedingsCollector({fetcher,intervalMs:1,attempts:1})(person,1,signal);
    expect(result.proceedings.observations).toHaveLength(1);
    expect(result.proceedings.errors).toEqual([expect.stringMatching(/4910640.*partes.*DOCUMENT_INVALID/)]);
    expect(JSON.stringify(result)).not.toContain('ESTRUTURA_PRIVADA');
  });
  it.each([403,429])('propaga bloqueio HTTP%s de caso posterior sem devolver página aparentemente concluída',async status=>{
    const original=mock();const fetcher=vi.fn(async(input:RequestInfo|URL)=>String(input).includes('abaPartes.asp?incidente=4910640')?new Response('bloqueado',{status}):original(input));
    await expect(createStfProceedingsCollector({fetcher,intervalMs:1,attempts:1})(person,1,signal)).rejects.toMatchObject({status});
  });
  it('propaga cancelamento durante um incidente mesmo após outro ter concluído',async()=>{
    const controller=new AbortController();const original=mock();
    const fetcher=vi.fn(async(input:RequestInfo|URL)=>{if(String(input).includes('abaPartes.asp?incidente=4910640'))controller.abort(new Error('Cancelado durante o caso'));return original(input);});
    await expect(createStfProceedingsCollector({fetcher,intervalMs:1,attempts:1})(person,1,controller.signal)).rejects.toThrow(/Cancelado durante o caso/);
  });
  it('pagina partições independentemente e não refaz partição esgotada',async()=>{
    const fetcher=vi.fn(async(input:RequestInfo|URL)=>{const url=new URL(String(input));const active=url.searchParams.get('processosEmTramitacao')==='sim';const page=Number(url.searchParams.get('pagina'));
      return Response.json(active?{totalDePaginas:1,totalDeRegistros:1,partes:page===1?[{...row(),processoEmTramitacao:'Sim'}]:[]}:{totalDePaginas:2,totalDeRegistros:21,partes:(page===1?Array.from({length:20},(_,i)=>row(100+i,'Pet '+i)):[row(999,'Pet 999')]).map(row=>({...row,processoEmTramitacao:'Não'}))});});
    const collect=createStfProceedingsNominalCollector({fetcher,intervalMs:1});
    expect((await collect(person,1,signal)).hasMore).toBe(true);
    const second=await collect(person,2,signal);expect(second.rows).toHaveLength(1);expect(second.hasMore).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('reaproveita cache verificado e recusa corrupção de snapshot',async()=>{
    const cacheDir=await mkdtemp(join(tmpdir(),'stf-proceedings-'));const fetcher=mock([],[]);
    await createStfProceedingsNominalCollector({fetcher,intervalMs:1,cacheDir,resume:true})(person,1,signal);
    await createStfProceedingsNominalCollector({fetcher:vi.fn(async()=>{throw new Error('Rede desnecessária');}),intervalMs:1,cacheDir,resume:true})(person,1,signal);
    const {readdir}=await import('node:fs/promises');const file=join(cacheDir,(await readdir(cacheDir))[0]);const data=JSON.parse(await readFile(file,'utf8'));data.text='alterado';await writeFile(file,JSON.stringify(data));
    await expect(createStfProceedingsNominalCollector({fetcher,intervalMs:1,cacheDir,resume:true})(person,1,signal)).rejects.toThrow(/cache|hash/i);
  });
  it('limita snapshots em memória e relê entrada expulsa ao percorrer muitas pessoas',async()=>{
    const fetcher=mock();const collect=createStfProceedingsNominalCollector({fetcher,intervalMs:1});
    for(let index=0;index<5;index++)await collect({...person,nomeCivil:'PESSOA NUMERO '+index},1,signal);
    await collect({...person,nomeCivil:'PESSOA NUMERO 0'},1,signal);
    expect(fetcher).toHaveBeenCalledTimes(12);
  });
  it('não aceita CPF, params duplicados, hosts e classes arbitrárias no transporte',async()=>{
    const http=createOfficialJudicialHttp({fetcher:vi.fn(async()=>new Response('{}')),intervalMs:1});
    for(const url of ['https://digital.stf.jus.br/integracoes-processos/api/public/partes/processos?nome=ABC&cpf=1','https://digital.stf.jus.br/integracoes-processos/api/public/partes/processos?nome=ABC&nome=DEF&processosPorPagina=20&pagina=1&processosEmTramitacao=sim&tipoPesquisa=PARTE','https://portal.stf.jus.br/processos/abaPartes.asp?incidente=1&url=https://evil.example'])await expect(http(url,signal)).rejects.toThrow(/permitid|inválid/i);
  });
});
