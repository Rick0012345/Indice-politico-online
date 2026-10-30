import React from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {Admin} from './Admin';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {'Content-Type': 'application/json'},
});

const successfulResponse = (input: RequestInfo | URL) => {
  if (String(input).endsWith('/summary')) return json({checkpoints: [], periods: []});
  if (String(input).endsWith('/logs')) return json({log: ''});
  return json({enabled: true, groqModel: 'llama-3.3-70b-versatile', hasGroqApiKey: false});
};

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('autorização administrativa', () => {
  it.each([false, true])('solicita reconsulta de vazios apenas por escolha explícita: %s', async (reprocessEmpty) => {
    window.sessionStorage.setItem('admin_api_token', 'token-atual');
    const requests: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input, init) => {
      if (init?.method === 'POST' && String(input).endsWith('/ingestion/run')) {
        requests.push(JSON.parse(String(init.body)));
        return json({message:'Coleta iniciada.'});
      }
      return successfulResponse(input);
    }));
    const user = userEvent.setup();
    render(<Admin />);
    const option = await screen.findByRole('checkbox', {name:'Reconsultar períodos já concluídos sem registros'});
    expect(option).not.toBeChecked();
    if (reprocessEmpty) await user.click(option);
    await user.click(screen.getByRole('button', {name:'Iniciar coleta'}));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({reprocessEmpty});
  });

  it('distingue tarefas concluídas sem registros no progresso da coleta', async () => {
    window.sessionStorage.setItem('admin_api_token', 'token-atual');
    vi.stubGlobal('fetch', vi.fn(async (input) => String(input).endsWith('/summary')
      ? json({checkpoints:[{dataset:'despesas',status:'done',total:7,itemsCount:100,emptyTotal:3,periodStart:'2020-01-01',periodEnd:'2020-01-31'}],periods:[]})
      : successfulResponse(input)));
    render(<Admin />);
    expect(await screen.findByText('3 concluídas sem registros')).toBeInTheDocument();
  });

  it('aguarda o token sem consultar a API nem mostrar as operações', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<Admin />);

    expect(screen.getByRole('heading', {name: 'Acesso administrativo'})).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Limpar Tudo'})).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('valida o token antes de salvá-lo ou liberar limpeza e ingestão', async () => {
    let finishValidation!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {finishValidation = resolve;}));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<Admin />);

    await user.type(screen.getByPlaceholderText('Token administrativo'), 'token-incorreto');
    await user.click(screen.getByRole('button', {name: 'Entrar'}));

    expect(window.sessionStorage.getItem('admin_api_token')).toBeNull();
    expect(screen.queryByRole('button', {name: 'Iniciar coleta'})).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: /Verificando/})).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {finishValidation(json({error: 'Acesso administrativo nao autorizado.'}, 401));});

    expect(await screen.findByRole('alert')).toHaveTextContent(/token.*incorreto|token.*atual/i);
    expect(window.sessionStorage.getItem('admin_api_token')).toBeNull();
    expect(screen.getByRole('button', {name: 'Entrar'})).toBeEnabled();
  });

  it('remove o token salvo recusado e permite entrar novamente com o token atual', async () => {
    window.sessionStorage.setItem('admin_api_token', 'token-antigo');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (new Headers(init?.headers).get('Authorization') === 'Bearer token-antigo') {
        return json({error: 'Acesso administrativo nao autorizado.'}, 401);
      }
      return successfulResponse(input);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<Admin />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/token/i);
    expect(window.sessionStorage.getItem('admin_api_token')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await user.type(screen.getByPlaceholderText('Token administrativo'), '  token-atual  ');
    await user.click(screen.getByRole('button', {name: 'Entrar'}));

    expect(await screen.findByRole('button', {name: 'Iniciar coleta'})).toBeEnabled();
    expect(window.sessionStorage.getItem('admin_api_token')).toBe('token-atual');
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/summary'))).toBe(true));
    for (const [, init] of fetchMock.mock.calls.slice(1)) {
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token-atual');
    }
  });

  it.each([
    ['limpeza', '/api/admin/database/clear', 'Limpar Despesas'],
    ['ingestão', '/api/admin/ingestion/run', 'Iniciar coleta'],
    ['configuração de IA', '/api/admin/settings/ai', 'Salvar IA'],
  ])('encerra o acesso ao receber 401 na %s e não repete a operação após novo login', async (_name, endpoint, button) => {
    window.sessionStorage.setItem('admin_api_token', 'token-atual');
    let unauthorized = true;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === endpoint && init?.method === 'POST' && unauthorized) {
        return json({error: 'Acesso administrativo nao autorizado.'}, 401);
      }
      return successfulResponse(input);
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    render(<Admin />);
    await screen.findByRole('button', {name: 'Iniciar coleta'});
    if (button === 'Salvar IA') await user.click(screen.getByRole('button', {name: 'IA'}));
    await user.click(screen.getByRole('button', {name: button}));

    expect(await screen.findByRole('heading', {name: 'Acesso administrativo'})).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/token/i);
    expect(window.sessionStorage.getItem('admin_api_token')).toBeNull();

    unauthorized = false;
    await user.type(screen.getByPlaceholderText('Token administrativo'), 'outro-token');
    await user.click(screen.getByRole('button', {name: 'Entrar'}));
    await screen.findByRole('button', {name: 'Iniciar coleta'});
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });

  it.each(['/api/admin/ingestion/summary', '/api/admin/ingestion/logs'])('encerra o acesso também quando %s retorna 401', async (endpoint) => {
    window.sessionStorage.setItem('admin_api_token', 'token-atual');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input) === endpoint
      ? json({error: 'Acesso administrativo nao autorizado.'}, 401)
      : successfulResponse(input)));
    render(<Admin />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/token/i);
    expect(screen.getByRole('heading', {name: 'Acesso administrativo'})).toBeInTheDocument();
    expect(window.sessionStorage.getItem('admin_api_token')).toBeNull();
  });

  it('interrompe as consultas automáticas ao sair da aba de logs', async () => {
    window.sessionStorage.setItem('admin_api_token', 'token-atual');
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => successfulResponse(input));
    vi.stubGlobal('fetch', fetchMock);
    render(<Admin />);
    await screen.findByRole('button', {name: 'Iniciar coleta'});
    fireEvent.click(screen.getByRole('button', {name: 'Logs'}));
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', {name: 'Sair'}));
    const requestsBefore = fetchMock.mock.calls.length;

    await act(async () => {vi.advanceTimersByTime(15000);});

    expect(fetchMock).toHaveBeenCalledTimes(requestsBefore);
    expect(window.sessionStorage.getItem('admin_api_token')).toBeNull();
  });

  it('mantém a nova sessão quando uma consulta antiga retorna 401 após novo login', async () => {
    window.sessionStorage.setItem('admin_api_token', 'token-antigo');
    let finishOldRequest!: (response: Response) => void;
    let delayOldRequest = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (delayOldRequest && String(input).endsWith('/summary') && new Headers(init?.headers).get('Authorization') === 'Bearer token-antigo') {
        return new Promise<Response>((resolve) => {finishOldRequest = resolve;});
      }
      return successfulResponse(input);
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<Admin />);
    await screen.findByRole('button', {name: 'Iniciar coleta'});
    await waitFor(() => expect(screen.getByRole('button', {name: 'Atualizar'})).toBeEnabled());
    delayOldRequest = true;
    await user.click(screen.getByRole('button', {name: 'Atualizar'}));
    await user.click(screen.getByRole('button', {name: 'Sair'}));
    await user.type(screen.getByPlaceholderText('Token administrativo'), 'token-novo');
    await user.click(screen.getByRole('button', {name: 'Entrar'}));
    await screen.findByRole('button', {name: 'Iniciar coleta'});

    await act(async () => {finishOldRequest(json({error: 'Acesso administrativo nao autorizado.'}, 401));});

    expect(screen.getByRole('button', {name: 'Iniciar coleta'})).toBeInTheDocument();
    expect(window.sessionStorage.getItem('admin_api_token')).toBe('token-novo');
  });

  it('mostra falha de configuração do servidor sem liberar o painel', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({error: 'Token administrativo nao configurado no servidor.'}, 503)));
    const user = userEvent.setup();
    render(<Admin />);
    await user.type(screen.getByPlaceholderText('Token administrativo'), 'token-atual');
    await user.click(screen.getByRole('button', {name: 'Entrar'}));

    expect(await screen.findByRole('alert')).toHaveTextContent('Token administrativo nao configurado no servidor.');
    expect(screen.queryByRole('button', {name: 'Iniciar coleta'})).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem('admin_api_token')).toBeNull();
  });

  it('preserva a sessão quando a limpeza é bloqueada por uma ingestão em andamento', async () => {
    window.sessionStorage.setItem('admin_api_token', 'token-atual');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => init?.method === 'POST'
      ? json({error: 'Existe uma ingestão em andamento.'}, 409)
      : successfulResponse(input)));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    render(<Admin />);
    await user.click(await screen.findByRole('button', {name: 'Limpar Despesas'}));

    expect(await screen.findByText('Existe uma ingestão em andamento.')).toBeInTheDocument();
    expect(window.sessionStorage.getItem('admin_api_token')).toBe('token-atual');
  });
});
