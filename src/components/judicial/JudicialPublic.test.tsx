import React from 'react';
import {act, render, screen, waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import {afterEach, expect, it, vi} from 'vitest';
import {renderWithProviders} from '../../test/render';
import {JudicialProfile} from './JudicialProfile';
import {Ranking} from '../../pages/Ranking';
import type {JudicialProfile as Profile} from '../../lib/judicialTypes';

const json = (data: unknown) => ({ok: true, json: async () => data}) as Response;
const profile = (known = false): Profile => ({summary: {
  finalConvictions: known ? 0 : null, appealConvictions: known ? 0 : null,
  confirmedImprisonments: known ? 0 : null, prisonHistory: known ? 'NO_RECORDS' : 'NOT_RESEARCHED',
  counts: {CRIMINAL: {final: 0, appeal: 0}, IMPROBITY: {final: 0, appeal: 0}, ELECTORAL: {final: 0, appeal: 0}, ACCOUNTS: {final: 0, appeal: 0}},
  coverage: {status: known ? 'REVIEWED' : 'NOT_RESEARCHED', scope: '', sources: [], checkedAt: null, version: 0}, lastCheckedAt: null,
}, records: []});
afterEach(() => vi.unstubAllGlobals());
const renderProfile = (id: string) => render(<JudicialProfile politicoId={id} />, {wrapper: ({children}) => <MemoryRouter>{children}</MemoryRouter>});

it('distingue pesquisa ausente de zero pesquisado no perfil', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json(profile())));
  const view = renderProfile('ficticio-a');
  await screen.findByText('Pesquisa não realizada');
  expect(screen.getByText('Sem pesquisa publicada para este perfil.')).toBeInTheDocument();
  expect(screen.queryByText('Nenhum registro encontrado no escopo pesquisado.')).not.toBeInTheDocument();
  vi.mocked(fetch).mockImplementation(async () => json(profile(true)));
  view.rerender(<JudicialProfile politicoId="ficticio-b" />);
  await screen.findByText('Nenhum registro encontrado no escopo pesquisado.');
});

it('exibe erro recuperável sem tratar falha como ausência de registros', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue(json(profile(true))));
  renderWithProviders(<JudicialProfile politicoId="ficticio-a" />);
  await screen.findByRole('alert');
  expect(screen.queryByText('Nenhum registro encontrado no escopo pesquisado.')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', {name: 'Tentar novamente'}));
  await screen.findByText('Nenhum registro encontrado no escopo pesquisado.');
});

it('ignora resposta antiga após trocar o perfil', async () => {
  let finish!: (value: Response) => void;
  vi.stubGlobal('fetch', vi.fn(async input => String(input).includes('ficticio-a') ? new Promise<Response>(resolve => {finish = resolve;}) : json(profile(true))));
  const view = renderProfile('ficticio-a');
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  view.rerender(<JudicialProfile politicoId="ficticio-b" />);
  await screen.findByText('Nenhum registro encontrado no escopo pesquisado.');
  await act(async () => finish(json(profile())));
  expect(screen.queryByText('Pesquisa não realizada')).not.toBeInTheDocument();
});

it('mostra fundamento, soltura e desfecho de prisão sem apresentá-la como condenação', async () => {
  const value = profile(true);
  value.summary.confirmedImprisonments = 1;
  value.summary.prisonHistory = 'CONFIRMED';
  value.records = [{id: 'registro-ficticio', politicoId: 'ficticio-a', version: 1, kind: 'IMPRISONMENT', category: 'CRIMINAL', caseNumber: 'PROCESSO-FICTICIO', court: 'Órgão fictício', title: 'Registro fictício de teste', description: 'Exemplo exclusivamente de teste.', eventDate: '2024-02-01', convictionStatus: null, finalityDate: null, custodyType: 'PREVENTIVE', custodyConfirmed: true, releasedAt: '2024-02-10', grounds: 'Fundamento fictício documentado', outcome: 'Soltura registrada; sem decisão final cadastrada.', sourceUrl: 'https://www.cnj.jus.br/fonte-ficticia', sourceLabel: 'Documento oficial de teste', verification: 'VERIFIED', checkedAt: '2025-01-01', updatedAt: '2025-01-01'}];
  vi.stubGlobal('fetch', vi.fn(async () => json(value)));
  renderProfile('ficticio-a');
  await screen.findByText('Prisão efetiva confirmada');
  expect(screen.getByText('Fundamento fictício documentado')).toBeInTheDocument();
  expect(screen.getByText('10/02/2024')).toBeInTheDocument();
  expect(screen.getByText('Soltura registrada; sem decisão final cadastrada.')).toBeInTheDocument();
  const source = screen.getByRole('link', {name: /Documento oficial de teste/});
  expect(source).toHaveAttribute('target', '_blank');
  expect(source).toHaveAttribute('rel', 'noopener noreferrer');
  expect(screen.getAllByText('definitivas')[0].parentElement).toHaveTextContent('0 definitivas');
});

it('abre ranking judicial criminal sem carregar endpoints das outras visões e compartilha filtros', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({items: [], total: 0, totalCadastrados: 2, coverage: {reviewed: 0, partial: 0, notResearched: 2}, revision: '1'})));
  renderWithProviders(<Ranking />, {route: '/ranking?view=judicial'});
  await screen.findByText('Nenhum perfil encontrado para estes filtros.');
  expect(screen.getByRole('combobox', {name: 'Categoria judicial'})).toHaveValue('CRIMINAL');
  await userEvent.selectOptions(screen.getByRole('combobox', {name: 'Categoria judicial'}), 'ELECTORAL');
  await userEvent.click(screen.getByRole('checkbox', {name: 'Somente com prisão confirmada'}));
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes('category=ELECTORAL') && String(input).includes('prisonOnly=true'))).toBe(true));
  expect(vi.mocked(fetch).mock.calls.every(([input]) => String(input).startsWith('/api/judicial/ranking?'))).toBe(true);
});

it('descarta ranking atrasado quando a categoria muda', async () => {
  let finish!: (value: Response) => void;
  const response = (name: string) => ({items: [{id: 'ficticio-a', nome: name, partido: 'TESTE', estado: 'SP', foto: null, ativo: true, situacao: null, judicial: profile(true).summary}], total: 1, totalCadastrados: 1, coverage: {reviewed: 1, partial: 0, notResearched: 0}, revision: '1'});
  vi.stubGlobal('fetch', vi.fn(async input => String(input).includes('category=CRIMINAL') ? new Promise<Response>(resolve => {finish = resolve;}) : json(response('Pessoa fictícia atual'))));
  renderWithProviders(<Ranking />, {route: '/ranking?view=judicial'});
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  await userEvent.selectOptions(screen.getByRole('combobox', {name: 'Categoria judicial'}), 'ACCOUNTS');
  await screen.findByText('Pessoa fictícia atual');
  await act(async () => finish(json(response('Resposta fictícia antiga'))));
  expect(screen.queryByText('Resposta fictícia antiga')).not.toBeInTheDocument();
  expect(screen.getByRole('link', {name: /Pessoa fictícia atual/})).toHaveAttribute('href', '/politico/ficticio-a?tab=judicial');
});

it('não atribui classificação a perfil não pesquisado e separa recursos', async () => {
  const unknown = profile().summary;
  const researched = profile(true).summary;
  researched.counts.CRIMINAL.appeal = 2;
  researched.appealConvictions = 2;
  vi.stubGlobal('fetch', vi.fn(async () => json({items: [
    {id: 'ficticio-a', nome: 'Pessoa fictícia pesquisada', partido: 'TESTE', estado: 'SP', ativo: true, judicial: researched},
    {id: 'ficticio-b', nome: 'Pessoa fictícia sem pesquisa', partido: 'TESTE', estado: 'SP', ativo: true, judicial: unknown},
  ], total: 2, totalCadastrados: 2, coverage: {reviewed: 1, partial: 0, notResearched: 1}, revision: '1'})));
  renderWithProviders(<Ranking />, {route: '/ranking?view=judicial'});
  await screen.findByText('Pessoa fictícia sem pesquisa');
  expect(screen.getByLabelText('Sem classificação')).toHaveTextContent('—');
  expect(screen.getByText('2 sujeitas a recurso · Criminal')).toBeInTheDocument();
});
