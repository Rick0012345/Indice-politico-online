import React from 'react';
import {act, fireEvent, screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, expect, it, vi} from 'vitest';
import {renderWithProviders} from '../test/render';
import {Ranking} from './Ranking';
import {clearCatalogResources} from '../lib/catalogResource';
import type {ExpenseCoverage} from '../lib/expenseAnalyticsTypes';
const json=(data:unknown)=>({ok:true,json:async()=>data}) as Response;
const politico=(i:number,nome=`Pessoa ${i}`)=>({id:String(i),nome,partido:'ABC',estado:'SP',cargo:'Deputado Federal',foto:'x',notaMedia:3,totalAvaliacoes:1,totalDespesas:5,totalVotacoes:1});
afterEach(()=>{clearCatalogResources();vi.unstubAllGlobals();});
const expenseCard = () => within(screen.getByRole('region', {name:'Resumo do ranking'})).getByText('Despesas').parentElement!;
const currency = (value:number) => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(value).replace(/\u00a0/g,' ');
const coverage = (overrides:Partial<ExpenseCoverage>={}):ExpenseCoverage => ({status:'complete',periods:12,expectedPeriods:12,missing:0,completed:12,empty:0,pending:0,running:0,failed:0,cancelled:0,politicians:1,withoutCheckpoints:0,from:'2025-01-01',to:'2025-12-31',lastUpdatedAt:'2026-10-30T03:00:00Z',...overrides});

it('filtra as despesas por ano e intervalo de meses, preservando o total ao ordenar e paginar',async()=>{
  vi.stubGlobal('fetch',vi.fn(async input=>{
    const url=new URL(String(input),'http://localhost');
    if(url.pathname==='/api/despesas/anos')return json({items:[2026,2025,2024]});
    if(url.pathname.includes('/partidos'))return json({items:[]});
    const all=Array.from({length:130},(_,i)=>politico(i));
    const offset=Number(url.searchParams.get('offset')),limit=Number(url.searchParams.get('limit'));
    return json({items:all.slice(offset,offset+limit),total:130,totalCadastrados:630,totalDespesas:url.searchParams.get('ano')==='2025'?250:1000,cobertura:coverage(),totalAvaliacoes:0,notaMedia:0,totalVotacoes:0,votacoesDisponiveis:false});
  }));
  const user=userEvent.setup();renderWithProviders(<Ranking/>);
  await screen.findByRole('option',{name:'2025'});
  expect(screen.getByRole('combobox',{name:'Mês inicial'})).toBeDisabled();
  await user.selectOptions(screen.getByRole('combobox',{name:'Ano das despesas'}),'2025');
  await user.selectOptions(screen.getByRole('combobox',{name:'Mês final'}),'10');
  await waitFor(()=>expect(expenseCard()).toHaveTextContent(currency(250)));
  await user.click(screen.getByRole('button',{name:'Gastos'}));
  await screen.findByRole('button',{name:'Carregar mais'});
  await user.click(screen.getByRole('button',{name:'Carregar mais'}));
  await screen.findByText('Exibindo 100 de 130 parlamentares');
  expect(expenseCard()).toHaveTextContent(currency(250));
  const requests=vi.mocked(fetch).mock.calls.map(([input])=>new URL(String(input),'http://localhost')).filter(url=>url.pathname==='/api/politicos/ranking'&&url.searchParams.get('ano')==='2025'&&url.searchParams.get('mesFim')==='10');
  expect(requests.some(url=>url.searchParams.get('metric')==='despesas'&&url.searchParams.get('offset')==='50'&&url.searchParams.get('mesInicio')==='1')).toBe(true);
  expect(screen.getByRole('region',{name:'Cobertura dos gastos'})).toHaveTextContent('Consultas do período concluídas');
},15000);

it('distingue ausência de avaliações e de votações de uma nota zero',async()=>{
  vi.stubGlobal('fetch',vi.fn(async input=>{
    const url=new URL(String(input),'http://localhost');
    if(url.pathname==='/api/despesas/anos'||url.pathname.includes('/partidos'))return json({items:[]});
    return json({items:[{...politico(1),notaMedia:0,totalAvaliacoes:0,totalVotacoes:0}],total:1,totalCadastrados:1,totalDespesas:5,totalAvaliacoes:0,notaMedia:0,totalVotacoes:0,votacoesDisponiveis:false,cobertura:coverage()});
  }));
  renderWithProviders(<Ranking/>);
  await screen.findAllByText('Pessoa 1');
  const summary=screen.getByRole('region',{name:'Resumo do ranking'});
  expect(within(summary).getByText('Sem avaliações')).toBeInTheDocument();
  expect(within(summary).getByText('Dados ainda não importados')).toBeInTheDocument();
  expect(within(summary).queryByText('0,0')).not.toBeInTheDocument();
});

it('diferencia consultas pendentes, ausência de importação e zero consultado',async()=>{
  vi.stubGlobal('fetch',vi.fn(async input=>{
    const url=new URL(String(input),'http://localhost');
    if(url.pathname==='/api/despesas/anos')return json({items:[2026,2025]});
    if(url.pathname.includes('/partidos'))return json({items:[]});
    const year=url.searchParams.get('ano');
    return json({items:[{...politico(1),totalDespesas:0}],total:1,totalCadastrados:1,totalDespesas:0,cobertura:year==='2025'?coverage({status:'not_imported',periods:0,completed:0,missing:12,withoutCheckpoints:1}):year==='2026'?coverage({empty:12}):coverage({status:'partial',completed:10,failed:2})});
  }));
  const user=userEvent.setup();renderWithProviders(<Ranking/>);
  await screen.findByText('Dados parciais no período');
  expect(screen.getByRole('region',{name:'Cobertura dos gastos'})).toHaveTextContent('2 consultas com falha');
  await user.selectOptions(screen.getByRole('combobox',{name:'Ano das despesas'}),'2025');
  await waitFor(()=>expect(expenseCard()).toHaveTextContent('Sem dados importados'));
  expect(screen.getAllByText('Dados não importados').length).toBeGreaterThan(0);
  expect(document.querySelector('tbody tr')).not.toHaveTextContent(currency(0));
  await user.selectOptions(screen.getByRole('combobox',{name:'Ano das despesas'}),'2026');
  await waitFor(()=>expect(expenseCard()).toHaveTextContent(currency(0)));
  expect(screen.getByRole('region',{name:'Cobertura dos gastos'})).toHaveTextContent('12 consultas concluídas sem registros');
});

it('descarta o total e a cobertura de um ano antigo após trocar o período',async()=>{
  let finish!:(value:Response)=>void;
  vi.stubGlobal('fetch',vi.fn(async input=>{
    const url=new URL(String(input),'http://localhost');
    if(url.pathname==='/api/despesas/anos')return json({items:[2026,2025]});
    if(url.pathname.includes('/partidos'))return json({items:[]});
    if(url.searchParams.get('ano')==='2025')return new Promise<Response>(resolve=>{finish=resolve;});
    return json({items:[politico(1)],total:1,totalCadastrados:1,totalDespesas:2000,cobertura:coverage()});
  }));
  const user=userEvent.setup();renderWithProviders(<Ranking/>);
  await screen.findByRole('option',{name:'2025'});
  await user.selectOptions(screen.getByRole('combobox',{name:'Ano das despesas'}),'2025');
  await waitFor(()=>expect(finish).toBeTypeOf('function'));
  await user.selectOptions(screen.getByRole('combobox',{name:'Ano das despesas'}),'2026');
  await waitFor(()=>expect(expenseCard()).toHaveTextContent(currency(2000)));
  await act(async()=>finish(json({items:[],total:1,totalCadastrados:1,totalDespesas:99999,cobertura:coverage({status:'partial',failed:12,completed:0})})));
  expect(expenseCard()).toHaveTextContent(currency(2000));
  expect(screen.queryByText('Dados parciais no período')).not.toBeInTheDocument();
});

it('soma todos os parlamentares do filtro e mantém o total ao paginar e ordenar', async () => {
  const all=Array.from({length:130},(_,i)=>({...politico(i),totalDespesas:(i+1)*10+(i===0?0.55:0)}));
  vi.stubGlobal('fetch',vi.fn(async input=>{
    const url=new URL(String(input),'http://localhost');
    if(url.pathname.includes('/partidos'))return json({items:[]});
    const ordered=url.searchParams.get('metric')==='despesas'?[...all].reverse():all;
    if(url.searchParams.get('direction')==='asc')ordered.reverse();
    const offset=Number(url.searchParams.get('offset')),limit=Number(url.searchParams.get('limit'));
    return json({items:ordered.slice(offset,offset+limit),total:130,totalCadastrados:630,totalDespesas:85150.55});
  }));
  const user=userEvent.setup();renderWithProviders(<Ranking/>);
  await screen.findByText('Exibindo 50 de 130 parlamentares');
  expect(expenseCard()).toHaveTextContent(currency(85150.55));
  expect(expenseCard()).toHaveTextContent('Todos os parlamentares do filtro');
  await user.click(screen.getByRole('button',{name:'Carregar mais'}));
  await screen.findByText('Exibindo 100 de 130 parlamentares');
  expect(expenseCard()).toHaveTextContent(currency(85150.55));
  await user.click(screen.getByRole('button',{name:'Gastos'}));
  expect(expenseCard()).toHaveTextContent(currency(85150.55));
  await waitFor(()=>expect(document.querySelector('tbody tr')?.textContent).toContain('Pessoa 129'));
  expect(expenseCard()).toHaveTextContent(currency(85150.55));
  await user.click(screen.getByRole('button',{name:'Menor'}));
  expect(expenseCard()).toHaveTextContent(currency(85150.55));
  await waitFor(()=>expect(document.querySelector('tbody tr')?.textContent).toContain('Pessoa 0'));
  expect(expenseCard()).toHaveTextContent(currency(85150.55));
},15000);

it('associa o total ao filtro e aceita estornos e filtros vazios',async()=>{
  let finish!:(value:Response)=>void;
  vi.stubGlobal('fetch',vi.fn(async input=>{
    const url=new URL(String(input),'http://localhost');
    if(url.pathname.includes('/partidos'))return json({items:[]});
    if(url.searchParams.get('status')==='inativo'&&url.searchParams.get('view')==='summary')return new Promise<Response>(resolve=>{finish=resolve;});
    return json(url.searchParams.get('status')==='todos'
      ?{items:[],total:0,totalCadastrados:630,totalDespesas:0}
      :{items:[politico(1)],total:513,totalCadastrados:630,totalDespesas:1000});
  }));
  const user=userEvent.setup();renderWithProviders(<Ranking/>);
  await waitFor(()=>expect(expenseCard()).toHaveTextContent(currency(1000)));
  await user.selectOptions(screen.getByRole('combobox',{name:'Status'}),'inativo');
  await waitFor(()=>expect(finish).toBeTypeOf('function'));
  expect(expenseCard()).not.toHaveTextContent(currency(1000));
  expect(expenseCard()).toHaveTextContent('—');
  await act(async()=>finish(json({items:[politico(2)],total:1,totalCadastrados:630,totalDespesas:-25.5})));
  await waitFor(()=>expect(expenseCard()).toHaveTextContent(currency(-25.5)));
  await user.selectOptions(screen.getByRole('combobox',{name:'Status'}),'todos');
  await waitFor(()=>expect(expenseCard()).toHaveTextContent(currency(0)));
  await user.selectOptions(screen.getByRole('combobox',{name:'Cargo'}),'Senador');
  expect(expenseCard()).toHaveTextContent(currency(0));
});

it('não usa soma parcial quando o total global está ausente',async()=>{
  vi.stubGlobal('fetch',vi.fn(async input=>json(String(input).includes('/partidos')?{items:[]}:{items:[politico(1)],total:1,totalCadastrados:630})));
  renderWithProviders(<Ranking/>);
  await screen.findAllByText('Pessoa 1');
  expect(expenseCard()).toHaveTextContent('—');
  expect(expenseCard()).not.toHaveTextContent(currency(5));
});

it('separa o total cadastrado dos resultados filtrados e da página carregada', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname.includes('/partidos')) return json({items: []});
    const all = Array.from({length: url.searchParams.get('search') ? 3 : 130}, (_, i) => politico(i));
    const offset = Number(url.searchParams.get('offset'));
    const limit = Number(url.searchParams.get('limit'));
    return json({items: all.slice(offset, offset + limit), total: all.length, totalCadastrados: 630});
  }));
  const user = userEvent.setup();
  renderWithProviders(<Ranking />);
  const summary = screen.getByRole('region', {name: 'Resumo do ranking'});
  await waitFor(() => expect(within(summary).getByText('630')).toBeInTheDocument());
  expect(screen.getByText('Exibindo 50 de 130 parlamentares')).toBeInTheDocument();
  expect(document.querySelectorAll('tbody tr')).toHaveLength(50);
  await user.click(screen.getByRole('button', {name: 'Carregar mais'}));
  await screen.findByText('Exibindo 100 de 130 parlamentares');
  expect(within(summary).getByText('630')).toBeInTheDocument();
  await user.click(screen.getByRole('searchbox', {name: 'Buscar parlamentares'}));
  // Executa o debounce explicitamente, sem disputar a janela de polling
  // de 1s com a renderização das 100 linhas já carregadas sob carga.
  vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']});
  try {
    fireEvent.change(screen.getByRole('searchbox', {name: 'Buscar parlamentares'}), {target: {value: 'ABC'}});
    await act(async () => {await vi.advanceTimersByTimeAsync(250);});
    expect(screen.getByText('Exibindo 3 de 3 parlamentares')).toBeInTheDocument();
    expect(document.querySelectorAll('tbody tr')).toHaveLength(3);
    const filteredPages = vi.mocked(fetch).mock.calls
      .map(([input]) => new URL(String(input), 'http://localhost'))
      .filter(url => url.pathname === '/api/politicos/ranking' && url.searchParams.get('view') === 'items' && url.searchParams.get('search') === 'ABC');
    expect(filteredPages).toHaveLength(1);
    expect(filteredPages[0].searchParams.get('offset')).toBe('0');
  } finally {
    vi.useRealTimers();
  }
  expect(within(summary).getByText('630')).toBeInTheDocument();
}, 15000);

it('mantém o total cadastrado em buscas sem resultados e não inventa total sem metadados', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname.includes('/partidos')) return json({items: []});
    return json(url.searchParams.get('search')
      ? {items: [], total: 0, totalCadastrados: 630}
      : {items: [politico(1)]});
  }));
  const user = userEvent.setup();
  renderWithProviders(<Ranking />);
  await screen.findAllByText('Pessoa 1');
  const summary = screen.getByRole('region', {name: 'Resumo do ranking'});
  expect(within(summary).getByText('Total indisponível')).toBeInTheDocument();
  await user.type(screen.getByRole('searchbox', {name: 'Buscar parlamentares'}), 'inexistente');
  await screen.findByText('Exibindo 0 de 0 parlamentares');
  expect(within(summary).getByText('630')).toBeInTheDocument();
});

it('mantém a aba de partidos e sua descrição ordenadas por gastos', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({items: []})));
  const user = userEvent.setup();
  renderWithProviders(<Ranking />);
  await user.click(screen.getByRole('button', {name: 'Partidos'}));
  expect(screen.getByRole('button', {name: 'Gastos'})).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText(/Comparando por/)).toHaveTextContent('gastos declarados');
});

it('reconcilia o prefixo carregado com novos IDs e ordem sem perder os filtros',async()=>{
 let update!: (event: {data:string})=>void; let changed=false;
 vi.stubGlobal('EventSource',class {addEventListener(name:string,fn:typeof update){if(name==='catalogo') update=fn;}close(){}});
 vi.stubGlobal('fetch',vi.fn(async(input)=>{
  const url=new URL(String(input),'http://localhost');
  if(url.pathname.includes('/partidos')) return json({items:[]});
  const all=Array.from({length:130},(_,i)=>politico(i));
  if(changed) all.unshift(politico(999,'Nova liderança'));
  const offset=Number(url.searchParams.get('offset')); const limit=Number(url.searchParams.get('limit'));
  return json({items:all.slice(offset,offset+limit), total:all.length, totalCadastrados:changed ? 631 : 630,totalDespesas:changed?999:650});
 }));
 const user=userEvent.setup(); renderWithProviders(<Ranking/>);
 await user.click(await screen.findByRole('button',{name:'Carregar mais'}));
 await screen.findAllByText('Pessoa 99');
 expect(expenseCard()).toHaveTextContent(currency(650));
 changed=true; act(()=>update({data:JSON.stringify({revision:'new'})}));
 await screen.findAllByText('Nova liderança', {}, {timeout:5000});
 expect(document.querySelector('tbody tr')?.textContent).toContain('Nova liderança');
 expect(screen.queryByText('Pessoa 99')).not.toBeInTheDocument();
 expect(screen.getAllByText('Pessoa 98')).toHaveLength(2);
 expect(vi.mocked(fetch).mock.calls.some(([input])=>String(input).includes('limit=101'))).toBe(true);
 expect(screen.getByRole('combobox',{name:'Status'})).toHaveValue('ativo');
 expect(within(screen.getByRole('region', {name:'Resumo do ranking'})).getByText('631')).toBeInTheDocument();
 expect(screen.getByText('Exibindo 100 de 131 parlamentares')).toBeInTheDocument();
 expect(expenseCard()).toHaveTextContent(currency(999));
},15000);
it('aguarda a página pendente antes de reconciliar e preserva sua quantidade',async()=>{
 let update!:(event:{data:string})=>void; let finish!:(value:Response)=>void; let changed=false;
 vi.stubGlobal('EventSource',class {addEventListener(name:string,fn:typeof update){if(name==='catalogo')update=fn;}close(){}});
 vi.stubGlobal('fetch',vi.fn(async(input)=>{
  const url=new URL(String(input),'http://localhost');
  if(url.pathname.includes('/partidos'))return json({items:[]});
  if(url.searchParams.get('offset')==='50')return new Promise<Response>(resolve=>{finish=resolve;});
  const all=Array.from({length:130},(_,i)=>politico(i));
  if(changed)all.unshift(politico(999,'Nova liderança'));
  return json({items:all.slice(0,Number(url.searchParams.get('limit')))});
 }));
 const user=userEvent.setup(); renderWithProviders(<Ranking/>);
 await user.click(await screen.findByRole('button',{name:'Carregar mais'}));
 changed=true; act(()=>update({data:JSON.stringify({revision:'b'})}));
 await new Promise(resolve=>setTimeout(resolve,500));
 expect(vi.mocked(fetch).mock.calls.filter(([input])=>String(input).includes('limit=101'))).toHaveLength(0);
 await act(async()=>finish(json({items:Array.from({length:51},(_,i)=>politico(i+50))})));
 await screen.findAllByText('Nova liderança', {}, {timeout:5000});
 expect(document.querySelectorAll('tbody tr')).toHaveLength(100);
 expect(vi.mocked(fetch).mock.calls.filter(([input])=>String(input).includes('limit=101'))).toHaveLength(1);
},15000);
it('mantém os cards dos partidos durante recarga lenta e serializa novos avisos',async()=>{
 let update!:(event:{data:string})=>void; let slow=false;
 const pending:Array<()=>void>=[]; const signals:AbortSignal[]=[];
 vi.stubGlobal('EventSource',class {addEventListener(name:string,fn:typeof update){if(name==='catalogo')update=fn;}close(){}});
 vi.stubGlobal('fetch',vi.fn(async(input,init)=>{
  const url=new URL(String(input),'http://localhost');
  if(url.pathname.includes('/partidos')){
   const response=()=>json({items:[{partido:'PARTIDO PRESENTE',totalDespesas:slow?200:100,totalPoliticos:10}]});
   if(slow){signals.push(init!.signal as AbortSignal);return new Promise<Response>(resolve=>pending.push(()=>resolve(response())));}
   return response();
  }
  return json({items:[politico(1)]});
 }));
 const user=userEvent.setup(); renderWithProviders(<Ranking/>);
 await user.click(screen.getByRole('button',{name:'Partidos'}));
 await screen.findByText('PARTIDO PRESENTE');
 slow=true; act(()=>update({data:JSON.stringify({revision:'a'})}));
 await waitFor(()=>expect(pending).toHaveLength(1));
 expect(screen.getByText('PARTIDO PRESENTE')).toBeInTheDocument();
 act(()=>update({data:JSON.stringify({revision:'b'})}));
 await new Promise(resolve=>setTimeout(resolve,1700));
 expect(pending).toHaveLength(1); expect(signals[0].aborted).toBe(false);
 await act(async()=>pending[0]());
 expect(screen.getByText('PARTIDO PRESENTE')).toBeInTheDocument();
},15000);
it('ignora paginação antiga após pesquisa e impede duplicação por clique duplo',async()=>{
 let resolvePage!:(value:Response)=>void;
 vi.stubGlobal('fetch',vi.fn(async(input)=>{
  const url=new URL(String(input),'http://localhost');
  if(url.pathname.includes('/partidos')) return json({items:[]});
  if(url.searchParams.get('view')==='items'&&url.searchParams.get('offset')!=='0') return new Promise<Response>(resolve=>{resolvePage=resolve;});
  return json({items:url.searchParams.get('search') ? [politico(999,'Resultado atual')] : Array.from({length:51},(_,i)=>politico(i)), total:url.searchParams.get('search') ? 1 : 130, totalCadastrados:630,totalDespesas:url.searchParams.get('search')?321.45:650});
 }));
 const user=userEvent.setup();renderWithProviders(<Ranking/>);
 const more=await screen.findByRole('button',{name:'Carregar mais'});
 await user.dblClick(more);
 expect(vi.mocked(fetch).mock.calls.filter(([input])=>new URL(String(input),'http://localhost').searchParams.get('offset')==='50')).toHaveLength(1);
 await user.type(screen.getByPlaceholderText('Buscar por nome, partido, UF ou cargo'),'Nova');
 await screen.findAllByText('Resultado atual');
 await act(async()=>{ resolvePage(json({items:[politico(666,'Resultado obsoleto')],total:9999,totalCadastrados:9999,totalDespesas:999999})); });
 await waitFor(()=>expect(screen.queryByText('Resultado obsoleto')).not.toBeInTheDocument());
 expect(within(screen.getByRole('region', {name:'Resumo do ranking'})).getByText('630')).toBeInTheDocument();
 expect(screen.getByText('Exibindo 1 de 1 parlamentares')).toBeInTheDocument();
 expect(expenseCard()).toHaveTextContent(currency(321.45));
});
it('mostra as linhas enquanto o resumo está pendente e permite repetir só o resumo',async()=>{
 let rejectSummary!:(reason:Error)=>void;
 vi.stubGlobal('fetch',vi.fn(async input=>{
  const url=new URL(String(input),'http://localhost');
  if(url.pathname==='/api/despesas/anos')return json({items:[]});
  if(url.pathname!=='/api/politicos/ranking')return json({items:[]});
  if(url.searchParams.get('view')==='summary')return new Promise<Response>((_,reject)=>{rejectSummary=reject;});
  return json({items:[politico(1)],total:1,revision:'r1'});
 }));
 renderWithProviders(<Ranking/>);
 await screen.findAllByText('Pessoa 1');
 expect(rejectSummary).toBeTypeOf('function');
 expect(expenseCard()).toHaveTextContent('—');
 await act(async()=>rejectSummary(new Error('HTTP')));
 expect(await screen.findByRole('button',{name:'Repetir resumo'})).toBeInTheDocument();
 expect(screen.getAllByText('Pessoa 1')).toHaveLength(2);
 expect(vi.mocked(fetch).mock.calls.some(([input])=>String(input).includes('/api/partidos/gastos'))).toBe(false);
});

it('não transforma disponibilidade desconhecida em gastos e votos zerados',async()=>{
 vi.stubGlobal('fetch',vi.fn(async input=>{
  const url=new URL(String(input),'http://localhost');
  if(url.searchParams.get('view')==='summary')return new Promise<Response>(()=>{});
  if(url.searchParams.get('view')==='items')return json({items:[{...politico(1),totalDespesas:0,totalVotacoes:0}],total:1,revision:'r1'});
  return json({items:[]});
 }));
 renderWithProviders(<Ranking/>);
 await screen.findAllByText('Pessoa 1');
 expect(document.querySelector('tbody tr')).not.toHaveTextContent(currency(0));
 expect(screen.queryByText('0 votações')).not.toBeInTheDocument();
 const cells=document.querySelectorAll('tbody tr td');
 expect(cells[6]).toHaveTextContent('—');
 expect(cells[7]).toHaveTextContent('—');
});

it('não consulta a aba antiga quando um aviso aguardava a página anterior',async()=>{
 vi.useFakeTimers();
 let update!:(event:{data:string})=>void;
 const calls:string[]=[];
 vi.stubGlobal('EventSource',class {addEventListener(name:string,fn:typeof update){if(name==='catalogo')update=fn;}close(){}});
 vi.stubGlobal('fetch',vi.fn(async input=>{
  const url=String(input);calls.push(url);
  if(url.includes('view=items'))return new Promise<Response>(()=>{});
  return json({items:[]});
 }));
 renderWithProviders(<Ranking/>);
 act(()=>update({data:JSON.stringify({revision:'r2'})}));
 await act(async()=>{await vi.advanceTimersByTimeAsync(400);});
 const before=calls.filter(url=>url.includes('/api/politicos/ranking')).length;
 await act(async()=>{screen.getByRole('button',{name:'Partidos'}).click();});
 await act(async()=>{await vi.advanceTimersByTimeAsync(100);});
 expect(calls.filter(url=>url.includes('/api/politicos/ranking'))).toHaveLength(before);
 vi.useRealTimers();
});

it('agrupa digitação e não repete o resumo quando muda a ordem',async()=>{
 vi.stubGlobal('fetch',vi.fn(async input=>{
  const url=new URL(String(input),'http://localhost');
  return json(url.pathname==='/api/politicos/ranking'?{items:[politico(1)],total:1,totalDespesas:5,revision:'r1'}:{items:[]});
 }));
 const user=userEvent.setup();renderWithProviders(<Ranking/>);
 await screen.findAllByText('Pessoa 1');
 await user.type(screen.getByRole('searchbox',{name:'Buscar parlamentares'}),'Nova');
 expect(vi.mocked(fetch).mock.calls.filter(([input])=>String(input).includes('search='))).toHaveLength(0);
 await waitFor(()=>expect(vi.mocked(fetch).mock.calls.filter(([input])=>String(input).includes('view=summary')&&String(input).includes('search=Nova'))).toHaveLength(1));
 const summaryCount=vi.mocked(fetch).mock.calls.filter(([input])=>String(input).includes('view=summary')).length;
 await user.click(screen.getByRole('button',{name:'Menor'}));
 await waitFor(()=>expect(vi.mocked(fetch).mock.calls.some(([input])=>String(input).includes('direction=asc'))).toBe(true));
 expect(vi.mocked(fetch).mock.calls.filter(([input])=>String(input).includes('view=summary'))).toHaveLength(summaryCount);
});
it('abre partidos sem consultar a lista parlamentar nem seu resumo',async()=>{
 vi.stubGlobal('fetch',vi.fn(async input=>json(String(input).includes('/partidos/gastos')?{items:[{partido:'Visão inicial',totalDespesas:10,totalPoliticos:1}]}:{items:[]})));
 renderWithProviders(<Ranking/>,{route:'/ranking?ver=partidos'});
 await screen.findByText('Visão inicial');
 expect(vi.mocked(fetch).mock.calls.some(([input])=>String(input).includes('/api/politicos/ranking'))).toBe(false);
});

it('reconcilia revisões divergentes antes de exibir totais do resumo',async()=>{
 let itemCalls=0;
 vi.stubGlobal('fetch',vi.fn(async input=>{
  const url=new URL(String(input),'http://localhost');
  if(url.pathname!=='/api/politicos/ranking')return json({items:[]});
  if(url.searchParams.get('view')==='summary')return json({total:1,totalDespesas:200,revision:'r2'});
  itemCalls++;
  return json({items:[politico(1)],total:1,revision:itemCalls===1?'r1':'r2'});
 }));
 renderWithProviders(<Ranking/>);
 await waitFor(()=>expect(expenseCard()).toHaveTextContent(currency(200)));
 expect(itemCalls).toBe(2);
 expect(screen.queryByText(/Resumo em atualização/)).not.toBeInTheDocument();
});
it('recarrega o prefixo quando a próxima página pertence a outra revisão',async()=>{
 let changed=false;
 vi.stubGlobal('fetch',vi.fn(async input=>{
  const url=new URL(String(input),'http://localhost');
  if(url.pathname!=='/api/politicos/ranking')return json({items:[]});
  const all=Array.from({length:130},(_,i)=>politico(i));
  if(changed)all.unshift(politico(999,'Liderança atual'));
  if(url.searchParams.get('view')==='summary')return json({total:all.length,totalDespesas:200,revision:changed?'r2':'r1'});
  const offset=Number(url.searchParams.get('offset')),limit=Number(url.searchParams.get('limit'));
  return json({items:all.slice(offset,offset+limit),total:all.length,revision:changed?'r2':'r1'});
 }));
 const user=userEvent.setup();renderWithProviders(<Ranking/>);
 const button=await screen.findByRole('button',{name:'Carregar mais'});
 changed=true;
 await user.click(button);
 await screen.findByText('Exibindo 100 de 131 parlamentares');
 expect(document.querySelectorAll('tbody tr')).toHaveLength(100);
 expect(document.querySelector('tbody tr')).toHaveTextContent('Liderança atual');
 expect(screen.queryByText('Pessoa 99')).not.toBeInTheDocument();
});

it('atualiza linhas ao voltar de partidos após aviso mesmo com resumo pendente',async()=>{
 let update!:(event:{data:string})=>void;let changed=false;let parties=0;
 vi.stubGlobal('EventSource',class {addEventListener(name:string,fn:typeof update){if(name==='catalogo')update=fn;}close(){}});
 vi.stubGlobal('fetch',vi.fn(async input=>{
  const url=new URL(String(input),'http://localhost');
  if(url.pathname==='/api/partidos/gastos'){parties++;return json({items:[]});}
  if(url.searchParams.get('view')==='summary')return changed?new Promise<Response>(()=>{}):json({total:1,totalDespesas:5,revision:'r1'});
  if(url.searchParams.get('view')==='items')return json({items:[politico(1,changed?'Nome atualizado':'Nome anterior')],total:1,revision:changed?'r2':'r1'});
  return json({items:[]});
 }));
 const user=userEvent.setup();renderWithProviders(<Ranking/>);
 await screen.findAllByText('Nome anterior');
 await user.click(screen.getByRole('button',{name:'Partidos'}));
 changed=true;act(()=>update({data:JSON.stringify({revision:'r2'})}));
 await waitFor(()=>expect(parties).toBe(2));
 await user.click(screen.getByRole('button',{name:'Parlamentares'}));
 await screen.findAllByText('Nome atualizado');
 expect(screen.queryByText('Nome anterior')).not.toBeInTheDocument();
});
