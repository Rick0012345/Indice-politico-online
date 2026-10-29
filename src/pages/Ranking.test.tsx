import React from 'react';
import {act, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, expect, it, vi} from 'vitest';
import {renderWithProviders} from '../test/render';
import {Ranking} from './Ranking';
const json=(data:unknown)=>({ok:true,json:async()=>data}) as Response;
const politico=(i:number,nome=`Pessoa ${i}`)=>({id:String(i),nome,partido:'ABC',estado:'SP',cargo:'Deputado Federal',foto:'x',notaMedia:3,totalAvaliacoes:1,totalDespesas:5,totalVotacoes:1});
afterEach(()=>vi.unstubAllGlobals());
it('reconcilia o prefixo carregado com novos IDs e ordem sem perder os filtros',async()=>{
 let update!: (event: {data:string})=>void; let changed=false;
 vi.stubGlobal('EventSource',class {addEventListener(name:string,fn:typeof update){if(name==='catalogo') update=fn;}close(){}});
 vi.stubGlobal('fetch',vi.fn(async(input)=>{
  const url=new URL(String(input),'http://localhost');
  if(url.pathname.includes('/partidos')) return json({items:[]});
  const all=Array.from({length:130},(_,i)=>politico(i));
  if(changed) all.unshift(politico(999,'Nova liderança'));
  const offset=Number(url.searchParams.get('offset')); const limit=Number(url.searchParams.get('limit'));
  return json({items:all.slice(offset,offset+limit)});
 }));
 const user=userEvent.setup(); renderWithProviders(<Ranking/>);
 await user.click(await screen.findByRole('button',{name:'Carregar mais'}));
 await screen.findAllByText('Pessoa 99');
 changed=true; act(()=>update({data:JSON.stringify({revision:'new'})}));
 await screen.findAllByText('Nova liderança', {}, {timeout:5000});
 expect(document.querySelector('tbody tr')?.textContent).toContain('Nova liderança');
 expect(screen.queryByText('Pessoa 99')).not.toBeInTheDocument();
 expect(screen.getAllByText('Pessoa 98')).toHaveLength(2);
 expect(vi.mocked(fetch).mock.calls.some(([input])=>String(input).includes('limit=101'))).toBe(true);
 expect(screen.getByRole('combobox',{name:'Status'})).toHaveValue('ativo');
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
  if(url.searchParams.get('offset')!=='0') return new Promise<Response>(resolve=>{resolvePage=resolve;});
  return json({items:url.searchParams.get('search') ? [politico(999,'Resultado atual')] : Array.from({length:51},(_,i)=>politico(i))});
 }));
 const user=userEvent.setup();renderWithProviders(<Ranking/>);
 const more=await screen.findByRole('button',{name:'Carregar mais'});
 await user.dblClick(more);
 expect(vi.mocked(fetch).mock.calls.filter(([input])=>new URL(String(input),'http://localhost').searchParams.get('offset')==='50')).toHaveLength(1);
 await user.type(screen.getByPlaceholderText('Buscar por nome, partido, UF ou cargo'),'Nova');
 await screen.findAllByText('Resultado atual');
 await act(async()=>{ resolvePage(json({items:[politico(666,'Resultado obsoleto')]})); });
 await waitFor(()=>expect(screen.queryByText('Resultado obsoleto')).not.toBeInTheDocument());
});
