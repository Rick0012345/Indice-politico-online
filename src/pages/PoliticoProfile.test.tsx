import React from 'react';
import {Routes, Route} from 'react-router-dom';
import {act, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {renderWithProviders} from '../test/render';
import {PoliticoProfile} from './PoliticoProfile';
vi.mock('../components/SpendingChart', () => ({default: () => null, SpendingChart: () => null}));
const expense = {id:'e1', ano:2026, mes:1, tipo:'Combustível', valor:10};
const json = (data:unknown) => ({ok:true,json:async()=>data}) as Response;
beforeEach(() => {
 vi.stubGlobal('fetch', vi.fn(async (input: string) => {
  if(input.includes('/despesas?')) return json({items:[expense],total:6260,totalValor:123456.78,tiposDisponiveis:['Combustível','Passagens'],hasMore:true});
  if(input.endsWith('/anos')) return json({items:[2026]});
  if(input.includes('/resumo') || input.includes('/media')) return json({items:[]});
  return json({politico:{id:'220554',nome:'Maria',partido:'ABC',estado:'SP',cargo:'Deputado Federal',foto:'x',notaMedia:0,totalAvaliacoes:0}});
 }));
});
afterEach(()=>vi.unstubAllGlobals());
const openExpenses=async()=>{
 const user=userEvent.setup();
 renderWithProviders(<Routes><Route path='/politico/:id' element={<PoliticoProfile/>}/></Routes>,{route:'/politico/220554'});
 await user.click(await screen.findByRole('button',{name:'Despesas'}));
 await screen.findByText('Mostrando 1 de 6260');
 return user;
};
it('usa total e quantidade globais da API e apresenta competência sem inventar dia',async()=>{
 await openExpenses();
 expect(screen.getAllByText(/123\.456,78/).length).toBeGreaterThan(0);
 expect(screen.getAllByText('01/2026').length).toBeGreaterThan(0);
 expect(screen.queryByText('01/01/2026')).not.toBeInTheDocument();
 expect(screen.getByRole('combobox',{name:'Mês'}).querySelectorAll('option')).toHaveLength(13);
});
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
 vi.mocked(fetch).mockImplementation(async(input)=>String(input).includes('/despesas?') ? ({ok:false,status:500} as Response) : json({politico:{id:'220554',nome:'Maria',partido:'ABC',estado:'SP',cargo:'Deputado Federal',foto:'x',notaMedia:0,totalAvaliacoes:0}}));
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
