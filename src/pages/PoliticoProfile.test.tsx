import React from 'react';
import {Routes, Route, useLocation} from 'react-router-dom';
import {act, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {renderWithProviders} from '../test/render';
import {PoliticoProfile} from './PoliticoProfile';
vi.mock('../components/SpendingChart', () => ({default: () => null, SpendingChart: () => null}));
let catalogUpdate: () => Promise<void>;
vi.mock('../hooks/useCatalogUpdates', () => ({useCatalogUpdates: (callback: typeof catalogUpdate) => {catalogUpdate = callback; return 'live';}}));
const expense = {id:'e1', ano:2026, mes:1, tipo:'Combustível', valor:10};
const json = (data:unknown) => ({ok:true,json:async()=>data}) as Response;
const judicialSummary = {finalConvictions:4,appealConvictions:3,confirmedImprisonments:1,prisonHistory:'CONFIRMED',counts:{CRIMINAL:{final:2,appeal:1},IMPROBITY:{final:2,appeal:2},ELECTORAL:{final:0,appeal:0},ACCOUNTS:{final:0,appeal:0}},coverage:{status:'PARTIAL',scope:'Tribunal consultado',sources:[],checkedAt:null,version:1},lastCheckedAt:null};
function ProfileLocation() {const location=useLocation();return <output aria-label="Endereço do perfil">{location.search}{location.hash}</output>;}
const analysis = {
 total:6260,totalValor:123456.78,
 categorias:[{tipo:'Combustível',total:100,quantidade:2,participacao:80},{tipo:'Estorno',total:-25,quantidade:1,participacao:-20}],
 fornecedores:[{id:'a'.repeat(32),nome:'Fornecedor agrupado',identificacao:'nome',total:100,quantidade:2,participacao:80}],
 outrosFornecedores:{total:-25,quantidade:1,fornecedores:1},
 cobertura:{status:'partial',periods:3,expectedPeriods:3,missing:0,completed:1,empty:0,pending:1,running:0,failed:1,cancelled:0,politicians:1,withoutCheckpoints:0,from:'2026-01-01',to:'2026-03-31',lastUpdatedAt:'2026-03-01T12:00:00Z'},
 periodo:{ano:null,mes:null,mesInicio:null,mesFim:null},
};
beforeEach(() => {
 vi.stubGlobal('fetch', vi.fn(async (input: string) => {
  if(input.endsWith('/judicial')) return json({summary:judicialSummary,records:[]});
  if(input.includes('/despesas/analise')) return json(analysis);
  if(input.includes('/despesas?')) return json({items:[expense],total:6260,totalValor:123456.78,tiposDisponiveis:['Combustível','Passagens'],hasMore:true});
  if(input.endsWith('/anos')) return json({items:[2026]});
  if(input.includes('/resumo') || input.includes('/media')) return json({items:[]});
  return json({politico:{id:'220554',nome:'Maria',partido:'ABC',estado:'SP',cargo:'Deputado Federal',foto:'x',notaMedia:0,totalAvaliacoes:0}});
 }));
});
it('integra atributos criminais e detalhe à visão geral, preservando o link legado', async()=>{
 const original=vi.mocked(fetch).getMockImplementation()!;
 vi.mocked(fetch).mockImplementation(async(input,init)=>String(input).endsWith('/220554') ? json({politico:{id:'220554',nome:'Maria',partido:'ABC',estado:'SP',cargo:'Deputado Federal',notaMedia:0,totalAvaliacoes:0,judicial:judicialSummary}}) : original(input,init));
 renderWithProviders(<><ProfileLocation/><Routes><Route path='/politico/:id' element={<PoliticoProfile/>}/></Routes></>,{route:'/politico/220554?tab=judicial&origem=ranking'});
 await screen.findByRole('heading',{name:'Maria'});
 expect(screen.queryByRole('button',{name:'Histórico judicial'})).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Visão Geral'})).toHaveAttribute('aria-pressed','true');
 const attributes=screen.getByRole('region',{name:'Atributos judiciais'});
 expect(attributes).toHaveTextContent('Condenações criminais definitivas2');
 expect(attributes).toHaveTextContent('Condenações criminais em recurso1');
 expect(attributes).toHaveTextContent('1 registro(s) de prisão confirmada');
 await screen.findByRole('heading',{name:'Histórico judicial'});
 expect(document.getElementById('historico-judicial')).toBeInTheDocument();
 expect(screen.getByLabelText('Endereço do perfil')).toHaveTextContent('?tab=geral&origem=ranking#historico-judicial');
});
it('mantém atributos indisponíveis e oferece repetição quando o detalhe judicial falha',async()=>{
 const original=vi.mocked(fetch).getMockImplementation()!;
 vi.mocked(fetch).mockImplementation(async(input,init)=>String(input).endsWith('/judicial') ? ({ok:false,status:500} as Response) : original(input,init));
 renderWithProviders(<Routes><Route path='/politico/:id' element={<PoliticoProfile/>}/></Routes>,{route:'/politico/220554'});
 await screen.findByRole('heading',{name:'Maria'});
 expect(screen.getByRole('region',{name:'Atributos judiciais'})).toHaveTextContent('Indisponível');
 expect(await screen.findByText('Não foi possível consultar os registros judiciais.')).toBeVisible();
 expect(screen.getByRole('button',{name:'Tentar novamente'})).toBeVisible();
});
it('exibe análise integral, estornos e fornecedor/documento também no desktop', async () => {
 const original=vi.mocked(fetch).getMockImplementation()!;
 vi.mocked(fetch).mockImplementation(async(input,init)=>String(input).includes('/despesas?') ? json({items:[{...expense,fornecedor:'Fornecedor do documento',urlDocumento:'https://example.org/documento.pdf'},{...expense,id:'e2',fornecedor:null,urlDocumento:null}],total:6260,totalValor:123456.78,hasMore:true}) : original(input,init));
 const user=userEvent.setup();
 renderWithProviders(<Routes><Route path='/politico/:id' element={<PoliticoProfile/>}/></Routes>,{route:'/politico/220554'});
 await user.click(await screen.findByRole('button',{name:'Despesas'}));
 await screen.findByRole('heading',{name:'Distribuição das despesas'});
 expect(screen.getByText('Dados parciais no período')).toBeInTheDocument();
 expect(screen.getByRole('button',{name:/Fornecedor agrupado/})).toBeInTheDocument();
 expect(screen.getAllByText(/Estorno/).length).toBeGreaterThan(0);
 expect(screen.getAllByRole('link',{name:'Ver documento'})).toHaveLength(2);
 expect(document.querySelector('tbody')?.textContent).toContain('Fornecedor do documento');
 expect(document.querySelector('tbody')?.textContent).toContain('Fornecedor não informado');
});

it('aplica drill-down de fornecedor e categoria ao mesmo escopo de lista, análise e gráfico', async () => {
 const user=await openExpenses();
 await user.click(await screen.findByRole('button',{name:/Fornecedor agrupado/}));
 await user.click(await screen.findByRole('button',{name:'Filtrar categoria Combustível'}));
 await user.selectOptions(screen.getByRole('combobox',{name:'Ano'}),'2026');
 await user.selectOptions(screen.getByRole('combobox',{name:'Mês'}),'1');
 await user.type(screen.getByRole('textbox',{name:'Valor mín.'}),'-5');
 await user.type(screen.getByRole('textbox',{name:'Valor máx.'}),'100');
 await waitFor(()=>{
  for(const path of ['/despesas?','/despesas/analise?','/despesas/resumo?','/despesas/media?']) {
   expect(vi.mocked(fetch).mock.calls.some(([input])=>{
    const url=new URL(String(input),'http://localhost');
    return url.pathname.concat('?').includes(path) && url.searchParams.get('fornecedorId')==='a'.repeat(32) && url.searchParams.get('tipo')==='Combustível' && url.searchParams.get('ano')==='2026' && url.searchParams.get('mes')==='1' && url.searchParams.get('valorMin')==='-5' && url.searchParams.get('valorMax')==='100';
   })).toBe(true);
  }
 });
 await user.click(screen.getByRole('button',{name:'Limpar fornecedor'}));
 await waitFor(()=>expect(screen.queryByRole('button',{name:'Limpar fornecedor'})).not.toBeInTheDocument());
});

it.each(['not_imported','complete'])('distingue ausência de coleta de consulta vazia: %s', async status=>{
 const original=vi.mocked(fetch).getMockImplementation()!;
 vi.mocked(fetch).mockImplementation(async(input,init)=>String(input).includes('/despesas/analise') ? json({...analysis,total:0,totalValor:0,categorias:[],fornecedores:[],cobertura:{...analysis.cobertura,status,periods:status==='complete'?1:0,completed:status==='complete'?1:0,empty:status==='complete'?1:0,pending:0,failed:0}}) : String(input).includes('/despesas?') ? json({items:[],total:0,totalValor:0,hasMore:false}) : original(input,init));
 const user=userEvent.setup();renderWithProviders(<Routes><Route path='/politico/:id' element={<PoliticoProfile/>}/></Routes>,{route:'/politico/220554'});
 await user.click(await screen.findByRole('button',{name:'Despesas'}));
 await screen.findByText(status==='complete'?'Sem despesas registradas no período consultado':'Dados de despesas ainda não importados para este período');
 expect(screen.getAllByText('Sem avaliações').length).toBeGreaterThan(0);
});

it('descarta análise de um filtro antigo mesmo que a resposta ignore cancelamento', async()=>{
 const original=vi.mocked(fetch).getMockImplementation()!;
 let finishOld!: (response:Response)=>void;
 vi.mocked(fetch).mockImplementation(async(input,init)=>{
  if(String(input).includes('/despesas/analise')) return new URL(String(input),'http://localhost').searchParams.has('tipo') ? json({...analysis,categorias:[{tipo:'Categoria atual',total:80,quantidade:1,participacao:null}]}) : new Promise<Response>(resolve=>{finishOld=resolve;});
  return original(input,init);
 });
 const user=await openExpenses();
 await user.type(screen.getByRole('combobox',{name:'Tipo'}),'Passagens');
 await screen.findByRole('button',{name:'Filtrar categoria Categoria atual'});
 await act(async()=>{finishOld(json({...analysis,categorias:[{tipo:'Categoria antiga',total:10,quantidade:1,participacao:100}]}));});
 expect(screen.queryByRole('button',{name:'Filtrar categoria Categoria antiga'})).not.toBeInTheDocument();
 expect(screen.getByText(/Participação indisponível/)).toBeInTheDocument();
});

it('não transforma falha de análise em distribuição zerada', async()=>{
 const original=vi.mocked(fetch).getMockImplementation()!;
 vi.mocked(fetch).mockImplementation(async(input,init)=>String(input).includes('/despesas/analise') ? ({ok:false,status:500} as Response) : original(input,init));
 await openExpenses();
 await screen.findByText('Não foi possível atualizar a cobertura da coleta.');
 expect(screen.queryByRole('heading',{name:'Distribuição das despesas'})).not.toBeInTheDocument();
 expect(screen.getByText('Mostrando 1 de 6260')).toBeInTheDocument();
});

it('identifica ausência de votações sem inventar nota popular', async()=>{
 const original=vi.mocked(fetch).getMockImplementation()!;
 vi.mocked(fetch).mockImplementation(async(input,init)=>String(input).endsWith('/220554') ? json({politico:{id:'220554',nome:'Maria',partido:'ABC',estado:'SP',cargo:'Deputado Federal',notaMedia:0,totalAvaliacoes:0,votacoesDisponiveis:false}}) : original(input,init));
 const user=userEvent.setup();renderWithProviders(<Routes><Route path='/politico/:id' element={<PoliticoProfile/>}/></Routes>,{route:'/politico/220554'});
 await user.click(await screen.findByRole('button',{name:/^Votações/}));
 await screen.findByText('Dados ainda não importados');
 expect(screen.getAllByText('Sem avaliações').length).toBeGreaterThan(0);
 expect(screen.queryByText('0.0')).not.toBeInTheDocument();
});
afterEach(()=>vi.unstubAllGlobals());
const openExpenses=async()=>{
 const user=userEvent.setup();
 renderWithProviders(<Routes><Route path='/politico/:id' element={<PoliticoProfile/>}/></Routes>,{route:'/politico/220554'});
 await user.click(await screen.findByRole('button',{name:'Despesas'}));
 await screen.findByText('Mostrando 1 de 6260');
 return user;
};
it('reconcilia despesas já paginadas por catálogo e mantém total global', async () => {
 const original = vi.mocked(fetch).getMockImplementation()!;
 let changed = false;
 vi.mocked(fetch).mockImplementation(async (input, init) => {
  const url = new URL(String(input), 'http://localhost');
  if (url.pathname.endsWith('/despesas')) {
   const all = Array.from({length: 450}, (_, i) => ({...expense, id: String(i), tipo: `${changed ? 'Atualizada' : 'Inicial'} ${i}`}));
   const offset = Number(url.searchParams.get('offset'));
   const limit = Number(url.searchParams.get('limit'));
   return json({items: all.slice(offset, offset + limit), total: 450, totalValor: 4500, tiposDisponiveis: [], hasMore: offset + limit < all.length});
  }
  return original(input, init);
 });
 const user = userEvent.setup();
 renderWithProviders(<Routes><Route path='/politico/:id' element={<PoliticoProfile/>}/></Routes>, {route:'/politico/220554'});
 await user.click(await screen.findByRole('button', {name:'Despesas'}));
 await screen.findByText('Mostrando 200 de 450');
 await user.click(screen.getByRole('button', {name:'Carregar mais'}));
 await screen.findByText('Mostrando 400 de 450');
 changed = true;
 await act(async () => {await catalogUpdate();});
 await screen.findAllByText('Atualizada 399');
 expect(screen.getByText('Mostrando 400 de 450')).toBeInTheDocument();
 expect(screen.queryByText('Inicial 0')).not.toBeInTheDocument();
}, 15000);
it('usa total e quantidade globais da API e apresenta competência sem inventar dia',async()=>{
 await openExpenses();
 expect(screen.getAllByText(/123\.456,78/).length).toBeGreaterThan(0);
 expect(screen.getAllByText('01/2026').length).toBeGreaterThan(0);
 expect(screen.queryByText('01/01/2026')).not.toBeInTheDocument();
 expect(screen.getByRole('combobox',{name:'Mês'}).querySelectorAll('option')).toHaveLength(13);
});
it('aguarda a segunda página de votos e reconcilia todo prefixo pelo cursor atual', async () => {
 const original = vi.mocked(fetch).getMockImplementation()!;
 let changed = false;
 let finishPage!: (response: Response) => void;
 const responsePage = (offset: number, limit: number) => {
  const items = Array.from({length: Math.min(limit, 90 - offset)}, (_, i) => ({votoId: String(offset + i), votacaoId: String(offset + i), ementa: `${changed ? 'Atual' : 'Anterior'} votação ${offset + i}`, voto: 'Sim', tipoVotacao: 'principal'}));
  return json({items, nextCursor: String(offset + items.length), meta: {anos:[2026], votos:['Sim'], tiposVotacao:['principal']}});
 };
 vi.mocked(fetch).mockImplementation(async (input, init) => {
  const url = new URL(String(input), 'http://localhost');
  if (url.pathname.endsWith('/votacoes')) {
   const offset = Number(url.searchParams.get('cursor'));
   if (offset === 30 && !changed) return new Promise<Response>(resolve => {finishPage = resolve;});
   return responsePage(offset, Number(url.searchParams.get('limit')));
  }
  return original(input, init);
 });
 const user = userEvent.setup();
 renderWithProviders(<Routes><Route path='/politico/:id' element={<PoliticoProfile/>}/></Routes>, {route:'/politico/220554'});
 await user.click(await screen.findByRole('button', {name:/^Votações/}));
 await user.click(await screen.findByRole('button', {name:'Carregar mais'}));
 let refresh!: Promise<void>;
 act(() => {refresh = catalogUpdate();});
 expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes('/votacoes?'))).toHaveLength(2);
 const oldPage = responsePage(30,30);
 changed = true;
 await act(async () => {finishPage(oldPage);});
 await act(async () => {await refresh;});
 await screen.findByText('Atual votação 59');
 expect(screen.getByText('Mostrando 60 de 60')).toBeInTheDocument();
 expect(screen.queryByText('Anterior votação 0')).not.toBeInTheDocument();
}, 15000);
it('envia tipo e limites de valor ao servidor e mantém tipos de todo o período',async()=>{
 const user=await openExpenses();
 await user.type(screen.getByRole('combobox',{name:'Tipo'}),'Passagens');
 await user.type(screen.getByRole('textbox',{name:'Valor mín.'}),'-5');
 await user.type(screen.getByRole('textbox',{name:'Valor máx.'}),'100');
 await waitFor(()=>expect(vi.mocked(fetch).mock.calls.some(([url])=>{
  const params=new URL(String(url),'http://localhost').searchParams;
  return params.get('tipo')==='Passagens' && params.get('valorMin')==='-5' && params.get('valorMax')==='100';
 })).toBe(true));
 expect(document.querySelector('#despesas-tipos option[value="Passagens"]')).toBeInTheDocument();
});
it('mostra erro de despesas sem confundir com resultado vazio',async()=>{
 const original=vi.mocked(fetch).getMockImplementation()!;
 vi.mocked(fetch).mockImplementation(async(input,init)=>String(input).includes('/despesas?') ? ({ok:false,status:500} as Response) : original(input,init));
 const user=userEvent.setup();
 renderWithProviders(<Routes><Route path='/politico/:id' element={<PoliticoProfile/>}/></Routes>,{route:'/politico/220554'});
 await user.click(await screen.findByRole('button',{name:'Despesas'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar despesas');
 expect(screen.queryByText('Nenhuma despesa encontrada com esses filtros.')).not.toBeInTheDocument();
});

it('descarta página antiga após troca de filtro e bloqueia clique duplo enquanto pendente',async()=>{
 const original=vi.mocked(fetch).getMockImplementation()!;
 let resolvePage!: (value:Response)=>void;
 vi.mocked(fetch).mockImplementation(async(input,init)=>{
  if(String(input).includes('/despesas?') && new URL(String(input),'http://localhost').searchParams.get('offset')==='1') return new Promise<Response>(resolve=>{resolvePage=resolve;});
  return original(input,init);
 });
 const user=await openExpenses();
 const more=screen.getByRole('button',{name:'Carregar mais'});
 await user.dblClick(more);
 expect(vi.mocked(fetch).mock.calls.filter(([url])=>String(url).includes('/despesas?') && new URL(String(url),'http://localhost').searchParams.get('offset')==='1')).toHaveLength(1);
 await user.type(screen.getByRole('combobox',{name:'Tipo'}),'Passagens');
 await act(async()=>{ resolvePage(json({items:[{...expense,id:'old',tipo:'Resultado obsoleto'}],total:10,totalValor:999,hasMore:false})); });
 await waitFor(()=>expect(screen.getByText('Mostrando 1 de 6260')).toBeInTheDocument());
 expect(screen.queryByText('Resultado obsoleto')).not.toBeInTheDocument();
});

it('descarta votação antiga ao sair da aba durante paginação',async()=>{
 const original=vi.mocked(fetch).getMockImplementation()!;
 let resolvePage!: (value:Response)=>void;
 vi.mocked(fetch).mockImplementation(async(input,init)=>{
  if(String(input).includes('/votacoes?')) {
   if(new URL(String(input),'http://localhost').searchParams.has('cursor')) return new Promise<Response>(resolve=>{resolvePage=resolve;});
   return json({items:[{votoId:'v1',votacaoId:'1',ementa:'Votação inicial',voto:'Sim',tipoVotacao:'principal'}],nextCursor:'next'});
  }
  return original(input,init);
 });
 const user=userEvent.setup();
 renderWithProviders(<Routes><Route path='/politico/:id' element={<PoliticoProfile/>}/></Routes>,{route:'/politico/220554'});
 await user.click(await screen.findByRole('button',{name:/^Votações/}));
 await user.click(await screen.findByRole('button',{name:'Carregar mais'}));
 await user.click(screen.getByRole('button',{name:'Visão Geral'}));
 await act(async()=>{ resolvePage(json({items:[{votoId:'v2',votacaoId:'2',ementa:'Votação antiga',voto:'Não',tipoVotacao:'principal'}],nextCursor:null})); });
 await user.click(screen.getByRole('button',{name:/^Votações/}));
 await screen.findByText('Votação inicial');
 expect(screen.queryByText('Votação antiga')).not.toBeInTheDocument();
});
