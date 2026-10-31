import React from 'react';
import {act, render, screen, waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import {afterEach, expect, it, vi} from 'vitest';
import {renderWithProviders} from '../../test/render';
import {JudicialProfile} from './JudicialProfile';
import {Ranking} from '../../pages/Ranking';
import type {JudicialProfile as Profile} from '../../lib/judicialTypes';
import {clearCatalogResources} from '../../lib/catalogResource';

const json = (data: unknown) => ({ok: true, json: async () => data}) as Response;
const profile = (known = false): Profile => ({summary: {
  finalConvictions: known ? 0 : null, appealConvictions: known ? 0 : null,
  confirmedImprisonments: known ? 0 : null, prisonHistory: known ? 'NO_RECORDS' : 'NOT_RESEARCHED',
  counts: {CRIMINAL: {final: 0, appeal: 0}, IMPROBITY: {final: 0, appeal: 0}, ELECTORAL: {final: 0, appeal: 0}, ACCOUNTS: {final: 0, appeal: 0}},
  coverage: {status: known ? 'REVIEWED' : 'NOT_RESEARCHED', scope: '', sources: [], checkedAt: null, version: 0}, lastCheckedAt: null,
}, records: []});
afterEach(() => {clearCatalogResources(); vi.unstubAllGlobals();});
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

it('integra condenações ao ranking parlamentar e mantém filtros de links antigos', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => json({items: [], total: 0, totalCadastrados: 2, coverage: {reviewed: 0, partial: 0, notResearched: 2}, revision: '1'})));
  renderWithProviders(<Ranking />, {route: '/ranking?view=judicial'});
  await screen.findByRole('heading', {name: 'Ranking parlamentar'});
  expect(screen.queryByRole('navigation', {name: 'Tipo de ranking'})).not.toBeInTheDocument();
  expect(screen.getByRole('button', {name: 'Condenações'})).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('combobox', {name: 'Categoria judicial'})).toHaveValue('CRIMINAL');
  await userEvent.selectOptions(screen.getByRole('combobox', {name: 'Categoria judicial'}), 'ELECTORAL');
  await userEvent.click(screen.getByRole('checkbox', {name: 'Somente com prisão confirmada'}));
  await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes('category=ELECTORAL') && String(input).includes('prisonOnly=true'))).toBe(true));
  expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).includes('/api/politicos/ranking?') && String(input).includes('metric=condenacoes'))).toBe(true);
  expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input).startsWith('/api/judicial/ranking?'))).toBe(false);
});

it('descarta ranking atrasado quando a categoria muda', async () => {
  let finish!: (value: Response) => void;
  const response = (name: string) => ({items: [{id: 'ficticio-a', nome: name, partido: 'TESTE', estado: 'SP', cargo: 'Deputado Federal', notaMedia: 0, totalAvaliacoes: 0, totalDespesas: 0, totalVotacoes: 0, foto: null, ativo: true, situacao: null, judicial: profile(true).summary}], total: 1, totalCadastrados: 1, revision: '1'});
  vi.stubGlobal('fetch', vi.fn(async input => String(input).includes('category=CRIMINAL') ? new Promise<Response>(resolve => {finish = resolve;}) : json(response('Pessoa fictícia atual'))));
  renderWithProviders(<Ranking />, {route: '/ranking?view=judicial'});
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  await userEvent.selectOptions(screen.getByRole('combobox', {name: 'Categoria judicial'}), 'ACCOUNTS');
  await screen.findAllByText('Pessoa fictícia atual');
  await act(async () => finish(json(response('Resposta fictícia antiga'))));
  expect(screen.queryByText('Resposta fictícia antiga')).not.toBeInTheDocument();
  expect(screen.getByRole('link', {name: 'Ver histórico judicial de Pessoa fictícia atual'})).toHaveAttribute('href', '/politico/ficticio-a#historico-judicial');
});

it('não atribui classificação a perfil não pesquisado e separa recursos', async () => {
  const unknown = profile().summary;
  const researched = profile(true).summary;
  researched.counts.CRIMINAL.appeal = 2;
  researched.appealConvictions = 2;
  vi.stubGlobal('fetch', vi.fn(async () => json({items: [
    {id: 'ficticio-a', nome: 'Pessoa fictícia pesquisada', partido: 'TESTE', estado: 'SP', cargo: 'Deputado Federal', notaMedia: 0, totalAvaliacoes: 0, totalDespesas: 0, totalVotacoes: 0, ativo: true, judicial: researched},
    {id: 'ficticio-b', nome: 'Pessoa fictícia sem pesquisa', partido: 'TESTE', estado: 'SP', cargo: 'Deputado Federal', notaMedia: 0, totalAvaliacoes: 0, totalDespesas: 0, totalVotacoes: 0, ativo: true, judicial: unknown},
  ], total: 2, totalCadastrados: 2, coverage: {reviewed: 1, partial: 0, notResearched: 1}, revision: '1'})));
  renderWithProviders(<Ranking />, {route: '/ranking?view=judicial'});
  await screen.findAllByText('Pessoa fictícia sem pesquisa');
  expect(screen.getAllByLabelText('Sem classificação').every(item => item.textContent === '—')).toBe(true);
  expect(screen.getAllByText('2 sujeitas a recurso').length).toBeGreaterThan(0);
});

it('mostra atributos judiciais junto dos gastos mesmo quando ordena por nota', async () => {
  const judicial = profile(true).summary;
  judicial.coverage.status = 'PARTIAL';
  judicial.counts.CRIMINAL.final = judicial.finalConvictions = 3;
  judicial.confirmedImprisonments = 1;
  judicial.prisonHistory = 'CONFIRMED';
  vi.stubGlobal('fetch', vi.fn(async () => json({items: [{id: '99', nome: 'Pessoa fictícia integrada', partido: 'TESTE', estado: 'SP', cargo: 'Deputado Federal', notaMedia: 3, totalAvaliacoes: 1, totalDespesas: 250, totalVotacoes: 4, judicial}], total: 1, totalCadastrados: 1})));
  renderWithProviders(<Ranking />);
  await screen.findAllByText('Pessoa fictícia integrada');
  expect(screen.queryByRole('navigation', {name: 'Tipo de ranking'})).not.toBeInTheDocument();
  expect(screen.getAllByText('3 definitivas').length).toBeGreaterThan(0);
  expect(screen.getAllByText('1 registro(s) de prisão confirmada').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Pesquisa parcial · escopo limitado').length).toBeGreaterThan(0);
  expect(document.querySelector('tbody tr')).toHaveTextContent('250,00');
  expect(document.querySelector('tbody tr')).toHaveTextContent('3 definitivas');
});

it('exporta atributos judiciais sem transformar pesquisa ausente em zero', async () => {
  let csv = '';
  const OriginalBlob = Blob;
  vi.stubGlobal('Blob', class extends OriginalBlob {
    constructor(parts: BlobPart[], options?: BlobPropertyBag) {super(parts, options); csv = parts.join('');}
  });
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = () => 'blob:teste-judicial';
    static revokeObjectURL = () => {};
  });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const known = profile(true).summary;
  known.counts.ELECTORAL = {final: 2, appeal: 1};
  vi.stubGlobal('fetch', vi.fn(async input => {
    if (!String(input).startsWith('/api/politicos/ranking?')) return json({items: []});
    return json({items: [
      {id: '1', nome: 'Fictício pesquisado', partido: 'TESTE', estado: 'SP', notaMedia: 3, totalDespesas: 5, totalVotacoes: 1, judicial: known},
      {id: '2', nome: 'Fictício desconhecido', partido: 'TESTE', estado: 'SP', notaMedia: 3, totalDespesas: 5, totalVotacoes: 1, judicial: profile().summary},
    ], total: 2, totalCadastrados: 2});
  }));
  try {
    renderWithProviders(<Ranking />, {route: '/ranking?metrica=condenacoes&category=ELECTORAL'});
    await screen.findAllByText('Fictício pesquisado');
    await userEvent.click(screen.getByRole('button', {name: 'Exportar CSV'}));
    const [header, researched, unknown] = csv.trimStart().split('\n').map(line => line.split(';'));
    expect(researched[header.indexOf('categoria_judicial')]).toBe('Eleitoral');
    expect(researched[header.indexOf('condenacoes_definitivas')]).toBe('2');
    expect(researched[header.indexOf('condenacoes_em_recurso')]).toBe('1');
    expect(unknown[header.indexOf('posicao')]).toBe('');
    expect(unknown[header.indexOf('condenacoes_definitivas')]).toBe('');
    expect(unknown[header.indexOf('prisoes_confirmadas')]).toBe('');
    expect(unknown[header.indexOf('cobertura_judicial')]).toBe('NOT_RESEARCHED');
  } finally {click.mockRestore();}
});


it('reúne condenação e prisão do mesmo processo com todas as fontes e situação desconhecida explícita', async () => {
  const value = profile(true);
  const common = {politicoId: 'ficticio-a', version: 1, category: 'CRIMINAL' as const, caseNumber: 'AP 1044', court: 'STF', title: 'Fato documentado', description: 'Motivo documentado nas fontes oficiais.', eventDate: null, convictionStatus: 'UNKNOWN' as const, finalityDate: null, custodyType: null, custodyConfirmed: false, releasedAt: null, grounds: '', outcome: '', sourceUrl: 'https://noticias.stf.jus.br/posts/noticia/a', sourceLabel: 'Fonte A', sources: [{url: 'https://noticias.stf.jus.br/posts/noticia/b', label: 'Fonte B'}], verification: 'VERIFIED' as const, checkedAt: '2026-01-01', updatedAt: '2026-01-01'};
  value.summary.identifiedConvictions = 1;
  value.summary.counts.CRIMINAL.identified = 1;
  value.records = [{...common, id: 'c', kind: 'CONVICTION'}, {...common, id: 'p', kind: 'IMPRISONMENT', caseNumber: 'AP-1044', court: 'Supremo Tribunal Federal', convictionStatus: null, custodyType: 'UNKNOWN', custodyConfirmed: true, grounds: 'Fundamento documentado'}];
  vi.stubGlobal('fetch', vi.fn(async () => json(value)));
  renderProfile('ficticio-a');
  await screen.findByText(/Situação atual não identificada/);
  expect(screen.getByRole('list', {name: 'Casos judiciais'}).children).toHaveLength(1);
  expect(screen.getByText(/Modalidade não identificada/)).toBeInTheDocument();
  expect(screen.getAllByRole('link', {name: /Fonte A/})).toHaveLength(1);
  expect(screen.getAllByRole('link', {name: /Fonte B/})).toHaveLength(1);
  expect(screen.getByText('Fundamento documentado')).toBeInTheDocument();
  expect(screen.getByText('1 identificadas')).toBeInTheDocument();
  expect(screen.getAllByText('Não informada')).toHaveLength(2);
});

it('apresenta processo confirmado com papéis, CNJ e aliases sem inferir condenação',async()=>{
 const value=profile(true);
 value.summary.proceedings={identified:1,againstPerson:0,activeAgainstPerson:0,investigations:0,enforcements:0,coverage:{status:'PARTIAL',scope:'Processos públicos do STF',sourceLabel:'STF',sourceUrl:'https://portal.stf.jus.br/',checkedAt:'2026-10-30',attemptedAt:'2026-10-30',unresolved:1}};
 value.cases=[{id:'case1',court:'STF',caseNumber:'AP 971',cnjNumber:'0001234-56.2020.1.00.0000',aliases:['AP 971','PET 6341'],phase:'ACTION',status:'ACTIVE',filedAt:null,subjects:['Assunto documentado'],roles:[{role:'AUTHOR',label:'Autor'}],countsAgainstPerson:false,sources:[{url:'https://portal.stf.jus.br/processos/detalhe.asp?incidente=1',label:'Consulta oficial STF'}],checkedAt:'2026-10-30'}];
 vi.stubGlobal('fetch',vi.fn(async()=>json(value)));renderProfile('processual');
 const list=await screen.findByRole('list',{name:'Processos identificados'});
 expect(list.children).toHaveLength(1);
 expect(screen.getByText('0001234-56.2020.1.00.0000')).toBeInTheDocument();
 expect(screen.getByText('PET 6341')).toBeInTheDocument();
 expect(screen.getByText('Autor')).toBeInTheDocument();
 expect(screen.getByText('Assunto documentado')).toBeInTheDocument();
 expect(screen.getByText(/não entra na contagem de processos contra/)).toBeInTheDocument();
 expect(screen.getByRole('link',{name:/Consulta oficial STF/})).toHaveAttribute('target','_blank');
});
