import React from 'react';
import {act, fireEvent, screen, within} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import {renderWithProviders} from '../test/render';
import {Comparador} from './Comparador';

afterEach(() => vi.unstubAllGlobals());
const json = (value: unknown) => ({ok: true, json: async () => value}) as Response;
it('publica cada perfil sem esperar os demais ou os indicadores, isolando falhas e repetição', async () => {
  let failSecond!: (response: Response) => void;
  const fetcher = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url === '/api/politicos/1') return json({politico: {nome: 'Perfil pronto', notaMedia: 4.2}});
    if (url === '/api/politicos/2') return new Promise<Response>(resolve => {failSecond = resolve;});
    return new Promise<Response>(() => {});
  });
  vi.stubGlobal('fetch', fetcher);
  renderWithProviders(<Comparador />, {route: '/comparar?ids=1,2'});
  expect(await screen.findByRole('link', {name: 'Perfil pronto'})).toBeVisible();
  expect(screen.getByText('4.2')).toBeVisible();
  expect(screen.queryByText('Sem despesas no período.')).not.toBeInTheDocument();
  await act(async () => failSecond({ok: false, status: 500} as Response));
  expect(screen.getByRole('link', {name: 'Perfil pronto'})).toBeVisible();
  const retry = screen.getByRole('button', {name: 'Tentar novamente perfil 2'});
  act(() => retry.click());
  expect(fetcher.mock.calls.filter(([url]) => url === '/api/politicos/1')).toHaveLength(1);
});

it('descarta resposta atrasada de um ano anterior e permite repetir apenas indicadores com falha', async () => {
  let oldYear!: (response: Response) => void;
  let recovered = false;
  const year = new Date().getFullYear();
  const fetcher = vi.fn(async (input: unknown) => {
    const url = new URL(String(input), 'http://local');
    if (url.pathname === '/api/politicos/1') return json({politico: {nome: 'Perfil preservado'}});
    if (url.pathname.endsWith('/indicadores')) {
      if (url.searchParams.get('ano') === String(year - 1)) return new Promise<Response>(resolve => {oldYear = resolve;});
      return recovered ? json({items: [{id: '1', participacao: 88}]}) : {ok: false, status: 500} as Response;
    }
    return json({items: []});
  });
  vi.stubGlobal('fetch', fetcher);
  renderWithProviders(<Comparador />, {route: `/comparar?ids=1&ano=${year - 1}`});
  await screen.findByRole('link', {name: 'Perfil preservado'});
  fireEvent.change(screen.getByRole('combobox'), {target: {value: String(year)}});
  const retry = await screen.findByRole('button', {name: 'Tentar novamente indicadores'});
  await act(async () => oldYear(json({items: [{id: '1', participacao: 12}]})));
  expect(screen.queryByText('12%')).not.toBeInTheDocument();
  recovered = true;
  fireEvent.click(retry);
  expect(await screen.findByText('88%')).toBeVisible();
  expect(fetcher.mock.calls.filter(([url]) => url === '/api/politicos/1')).toHaveLength(1);
});

it('troca o período sem refazer perfis e retira indicadores anteriores enquanto aguarda', async () => {
  const fetcher = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes('/indicadores?')) {
      if (url.includes('ano=')) return new Promise<Response>(() => {});
      return json({items: [{id: '1', participacao: 77, gastosMensais: []}]});
    }
    if (url === '/api/politicos/1') return json({politico: {nome: 'Identidade estável'}});
    return json({items: []});
  });
  vi.stubGlobal('fetch', fetcher);
  renderWithProviders(<Comparador />, {route: '/comparar?ids=1'});
  expect(await screen.findByText('77%')).toBeVisible();
  act(() => {
    const select = screen.getByRole('combobox');
    (select as HTMLSelectElement).value = String(new Date().getFullYear());
    select.dispatchEvent(new Event('change', {bubbles: true}));
  });
  expect(screen.queryByText('77%')).not.toBeInTheDocument();
  expect(screen.getByRole('link', {name: 'Identidade estável'})).toBeVisible();
  expect(fetcher.mock.calls.filter(([url]) => url === '/api/politicos/1')).toHaveLength(1);
  expect(within(screen.getByRole('region', {name: 'Indicadores lado a lado'})).getAllByText('Carregando...').length).toBeGreaterThan(0);
});
