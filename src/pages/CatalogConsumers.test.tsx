import React from 'react';
import {act, screen, waitFor} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {renderWithProviders} from '../test/render';
import userEvent from '@testing-library/user-event';
import {Camara} from './Camara';
import {Partidos} from './Partidos';
import {invalidateCatalogResources} from '../lib/catalogResource';

let update: () => Promise<void>;
vi.mock('../hooks/useCatalogUpdates', () => ({useCatalogUpdates: (callback: typeof update) => {update = async () => {invalidateCatalogResources(); await callback();}; return 'live';}}));
afterEach(() => vi.unstubAllGlobals());
const json = (data: unknown) => ({ok: true, json: async () => data}) as Response;
it.each([Camara, Partidos])('inicia consulta na abertura sem aguardar debounce de texto', async Component => {
 vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({items: []})));
 renderWithProviders(<Component/>);
 expect(fetch).toHaveBeenCalledTimes(1);
 await act(async () => {});
});

it('atualiza a Câmara por catálogo sem apagar resultados válidos enquanto consulta', async () => {
 let resolve!: (response: Response) => void;
 vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({items: [{id: '1', siglaTipo: 'PL', numero: 1, ano: 2026, ementa: 'Texto inicial'}]})).mockImplementationOnce(() => new Promise<Response>(r => {resolve = r;})));
 renderWithProviders(<Camara/>);
 await screen.findByText('Texto inicial');
 await act(async () => {await update();});
 await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
 expect(screen.getByText('Texto inicial')).toBeInTheDocument();
 await act(async () => {resolve(json({items: [{id: '2', siglaTipo: 'PL', numero: 2, ano: 2026, ementa: 'Texto novo'}]}));});
 await screen.findByText('Texto novo');
 expect(screen.queryByText('Texto inicial')).not.toBeInTheDocument();
 vi.mocked(fetch).mockResolvedValueOnce({ok: false, status: 500} as Response);
 await act(async () => {await update();});
 await screen.findByRole('alert');
 expect(screen.getByText('Texto novo')).toBeInTheDocument();
});

it('atualiza totais de partidos quando o catálogo muda', async () => {
 const partido = {partido: 'ABC', nome: 'Partido inicial', totalPoliticos: 1, totalAtivos: 1, totalEstados: 1, totalDespesas: 10, totalVotacoes: 2, notaMedia: 0, totalAvaliacoes: 0};
 vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({items: [partido]})).mockResolvedValue(json({items: [{...partido, nome: 'Partido atualizado', totalPoliticos: 2}]})));
 renderWithProviders(<Partidos/>);
 await screen.findAllByText('Partido inicial');
 await act(async () => {await update();});
 await screen.findAllByText('Partido atualizado');
});

it('preserva detalhes abertos e os deputados válidos quando o refresh falha', async () => {
 const partido = {partido:'ABC', nome:'Partido exemplo', totalPoliticos:1, totalAtivos:1, totalEstados:1, totalDespesas:10, totalVotacoes:2, notaMedia:0, totalAvaliacoes:0};
 let fail = false;
 vi.stubGlobal('fetch', vi.fn(async (input) => {
  if (String(input).includes('/politicos?')) return fail ? {ok:false, status:500} as Response : json({items:[{id:'1', nome:'Deputada preservada', partido:'ABC', estado:'SP', cargo:'Deputado Federal', notaMedia:0, totalAvaliacoes:0, totalDespesas:10, totalVotacoes:2}]});
  return json({items:[partido]});
 }));
 const user = userEvent.setup();
 renderWithProviders(<Partidos/>);
 await user.click((await screen.findAllByRole('button', {name:'ABC ABC'}))[0]);
 await screen.findByText('Deputada preservada');
 fail = true;
 await act(async () => {await update();});
 await screen.findByRole('alert');
 expect(screen.getByText('Deputada preservada')).toBeInTheDocument();
 expect(screen.getByRole('heading', {name:'Deputados do ABC'})).toBeInTheDocument();
});
