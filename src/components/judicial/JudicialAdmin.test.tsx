import {render, screen, fireEvent, act} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, it, expect, vi, afterEach} from 'vitest';
import {MemoryRouter} from 'react-router-dom';
import {JudicialAdmin} from './JudicialAdmin';
const empty = {records: [], summary: {coverage: {status: 'NOT_RESEARCHED', scope: '', sources: [], checkedAt: null, version: 0}}};
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), {status, headers: {'Content-Type': 'application/json'}});

describe('gestão de histórico judicial', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('permite selecionar pessoa e criar rascunho sem afirmar ausência de antecedentes', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({items: [{id: '100', nome: 'Pessoa fictícia', partido: 'TESTE', estado: 'SP'}]})));
    const adminFetch = vi.fn().mockImplementation((url: string) => Promise.resolve(response(url.endsWith('/audit') ? {items: []} : empty)));
    render(<MemoryRouter><JudicialAdmin adminFetch={adminFetch} /></MemoryRouter>);
    await user.type(screen.getByLabelText('Buscar político'), 'Pessoa');
    await user.click(screen.getByRole('button', {name: 'Buscar'}));
    await user.click(await screen.findByRole('button', {name: /Pessoa fictícia/}));
    expect(await screen.findByText('Nenhum registro cadastrado.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', {name: 'Novo registro'}));
    expect(screen.getByLabelText('Publicação')).toHaveValue('DRAFT');
    await user.selectOptions(screen.getByLabelText('Tipo de registro'), 'IMPRISONMENT');
    expect(screen.getByLabelText('Cumprimento da prisão comprovado na fonte')).toBeInTheDocument();
    expect(screen.getByLabelText('Fundamento da prisão')).toBeInTheDocument();
    expect(screen.queryByText('Nunca foi preso')).not.toBeInTheDocument();
    expect(adminFetch).toHaveBeenCalledWith('/api/admin/judicial/politicos/100', expect.any(Object));
  });

  it('falha de consulta não libera cadastro com versão desconhecida', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({items: [{id: '100', nome: 'Pessoa fictícia', partido: 'TESTE', estado: 'SP'}]})));
    const adminFetch = vi.fn().mockResolvedValue(response({error: 'Consulta indisponível'}, 503));
    render(<MemoryRouter><JudicialAdmin adminFetch={adminFetch} /></MemoryRouter>);
    await user.type(screen.getByLabelText('Buscar político'), 'Pessoa');
    await user.click(screen.getByRole('button', {name: 'Buscar'}));
    await user.click(await screen.findByRole('button', {name: /Pessoa fictícia/}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Consulta indisponível');
    expect(screen.queryByRole('button', {name: 'Novo registro'})).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Tentar novamente'})).toBeInTheDocument();
  });

  it('interrompe consulta sem resposta e permite tentar novamente', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({items: [{id: '100', nome: 'Pessoa fictícia', partido: 'TESTE', estado: 'SP'}]})));
    const adminFetch = vi.fn((_url: string, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('Abortado', 'AbortError')), {once: true});
    }));
    render(<MemoryRouter><JudicialAdmin adminFetch={adminFetch} /></MemoryRouter>);
    await user.type(screen.getByLabelText('Buscar político'), 'Pessoa');
    await user.click(screen.getByRole('button', {name: 'Buscar'}));
    const person = await screen.findByRole('button', {name: /Pessoa fictícia/});
    vi.useFakeTimers();
    fireEvent.click(person);
    expect(screen.getByText('Consultando histórico…')).toBeInTheDocument();
    await act(async () => {await vi.advanceTimersByTimeAsync(20_001);});
    expect(screen.getByRole('alert')).toHaveTextContent('A consulta demorou mais que o esperado');
    expect(screen.queryByText('Consultando histórico…')).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Tentar novamente'})).toBeEnabled();
  });

  it('publica edição com a versão lida e mantém a nota de revisão privada no envio administrativo', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({items: [{id: '100', nome: 'Pessoa fictícia', partido: 'TESTE', estado: 'SP'}]})));
    const record = {
      id: '00000000-0000-4000-8000-000000000001', politicoId: '100', version: 2,
      kind: 'CONVICTION', category: 'CRIMINAL', caseNumber: 'CASO-FICTICIO-001', court: 'Tribunal de teste',
      title: 'Condenação fictícia de teste', description: 'Descrição fictícia exclusivamente para teste.', eventDate: '2025-01-01',
      convictionStatus: 'FINAL', finalityDate: '2025-02-01', custodyType: null, custodyConfirmed: false, releasedAt: null,
      grounds: '', outcome: 'Pena informada na decisão de teste.', sourceLabel: 'Documento de teste', sourceUrl: 'https://www.cnj.jus.br/documento-de-teste',
      verification: 'DRAFT', identityEvidence: 'Identidade fictícia confirmada para este teste.', reviewNote: 'Revisão inicial de teste.',
      checkedAt: null, updatedAt: '2025-02-01T00:00:00Z',
    };
    const adminFetch = vi.fn().mockImplementation((_url: string, options?: RequestInit) => Promise.resolve(response(options?.method === 'PUT' ? {...record, version: 3} : {...empty, records: [record]})));
    render(<MemoryRouter><JudicialAdmin adminFetch={adminFetch} /></MemoryRouter>);
    await user.type(screen.getByLabelText('Buscar político'), 'Pessoa');
    await user.click(screen.getByRole('button', {name: 'Buscar'}));
    await user.click(await screen.findByRole('button', {name: /Pessoa fictícia/}));
    await user.click(await screen.findByRole('button', {name: 'Editar registro'}));
    await user.selectOptions(screen.getByLabelText('Publicação'), 'VERIFIED');
    await user.click(screen.getByLabelText('Conferi identidade, fonte oficial e situação atual desta decisão ou prisão.'));
    await user.click(screen.getByRole('button', {name: 'Salvar registro'}));
    const write = adminFetch.mock.calls.find(([, options]) => options?.method === 'PUT');
    expect(write?.[0]).toBe('/api/admin/judicial/politicos/100/records/00000000-0000-4000-8000-000000000001');
    expect(JSON.parse(write?.[1].body)).toMatchObject({expectedVersion: 2, verification: 'VERIFIED', identityEvidence: record.identityEvidence});
    expect(await screen.findByText(/Alteração salva/)).toBeInTheDocument();
  });
});
