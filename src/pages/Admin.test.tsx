import React from 'react';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
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
  vi.useRealTimers();
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('autorização administrativa', () => {
  it('invalida a execução dos logs após falha de leitura e preserva o histórico', async () => {
    window.sessionStorage.setItem('admin_api_token', 'token-atual');
    let failLogs = false;
    const event = {stage:'checkpoint_start', source:'ingestion', label:'Deputados em processamento', dataset:'deputados', timestamp:'2026-10-31T12:00:00Z'};
    vi.stubGlobal('fetch', vi.fn(async input => {
      if (String(input).endsWith('/summary')) return json({checkpoints:[{dataset:'deputados', status:'running', total:2}], periods:[], execution:{processActive:true, maintenanceActive:true}});
      if (String(input).endsWith('/logs')) return failLogs ? json({error:'Falha'}, 500) : json({file:'ingest-history.log', log:'Histórico preservado', execution:{processActive:true, maintenanceActive:true}, events:[event], currentStatus:[event]});
      return successfulResponse(input);
    }));
    render(<Admin />);
    fireEvent.click(await screen.findByRole('button', {name:'Logs'}));
    const status = await screen.findByRole('region', {name:'Status operacional dos logs'});
    await waitFor(() => expect(status).toHaveTextContent('Coleta em execução'));
    expect(within(status).getByText('Deputados em processamento')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', {name:'Atualizar logs'})).toBeEnabled());
    failLogs = true;
    fireEvent.click(screen.getByRole('button', {name:'Atualizar logs'}));
    await waitFor(() => expect(status).toHaveTextContent('Execução não confirmada'));
    expect(status).not.toHaveTextContent('Coleta em execução');
    expect(within(status).queryByText('Deputados em processamento')).not.toBeInTheDocument();
    expect(screen.getByText('Histórico preservado')).toBeInTheDocument();
    expect(screen.getByText('Não foi possível carregar os eventos recentes da ingestão. Tente atualizar os logs.')).toBeInTheDocument();
  });

  it.each([
    [false, false, 'Execução não confirmada'],
    [false, true, 'Operação em andamento'],
    [true, true, 'Coleta em execução'],
  ])('mostra o estado confirmado dos logs separadamente do histórico (%s, %s)', async (processActive, maintenanceActive, label) => {
    window.sessionStorage.setItem('admin_api_token', 'token-atual');
    vi.stubGlobal('fetch', vi.fn(async input => {
      if (String(input).endsWith('/summary')) return json({checkpoints:[{dataset:'deputados', status:'running', total:2}], periods:[], execution:{processActive, maintenanceActive}});
      if (String(input).endsWith('/logs')) return json({file:'ingest-history.log', log:'coleta antiga', execution:{processActive, maintenanceActive}, events:[{stage:'checkpoint_start', source:'ingestion', label:'Deputados', timestamp:'2020-01-01T00:00:00Z'}], currentStatus:[]});
      return successfulResponse(input);
    }));
    render(<Admin />);
    fireEvent.click(await screen.findByRole('button', {name:'Logs'}));
    const status = await screen.findByRole('region', {name:'Status operacional dos logs'});
    await waitFor(() => expect(status).toHaveTextContent(label));
    expect(status).toHaveTextContent('Histórico recente');
    expect(status).not.toHaveTextContent('fluxo(s) ativo(s) agora');
  });

  it('começa sem seleção e envia somente Votações quando escolhida', async () => {
    window.sessionStorage.setItem('admin_api_token', 'token-atual');
    const requests: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input, init) => {
      if (init?.method === 'POST' && String(input).endsWith('/ingestion/run')) {
        requests.push(JSON.parse(String(init.body)));
        return json({message:'Coleta iniciada.', datasets:['votacoes']});
      }
      return successfulResponse(input);
    }));
    const user = userEvent.setup();
    render(<Admin />);
    expect(await screen.findByRole('button', {name:'Iniciar coleta'})).toBeDisabled();
    expect(screen.getByRole('button', {name:'Deputados'})).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', {name:'Votações'}));
    expect(screen.getByRole('button', {name:'Votações'})).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Selecionados: Votações')).toBeInTheDocument();
    await user.click(screen.getByRole('button', {name:'Iniciar coleta'}));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({datasets:['votacoes']});
    expect(await screen.findByText('Coleta iniciada. Dados confirmados pelo servidor: Votações.')).toBeInTheDocument();
  });

  it('preenche o período suportado até hoje e acompanha a virada do dia em Brasília', async () => {
    vi.useFakeTimers({toFake:['Date']});
    vi.setSystemTime(new Date('2026-10-31T01:30:00Z'));
    window.sessionStorage.setItem('admin_api_token','token-atual');
    vi.stubGlobal('fetch',vi.fn(async input=>successfulResponse(input)));
    render(<Admin />);
    await screen.findByRole('button',{name:'Iniciar coleta'});
    expect(screen.getByLabelText('Inicio')).toHaveValue('2015-01-01');
    expect(screen.getByLabelText('Fim')).toHaveValue('2026-10-30');
    vi.setSystemTime(new Date('2026-10-31T03:01:00Z'));
    fireEvent.focus(window);
    expect(screen.getByLabelText('Fim')).toHaveValue('2026-10-31');
  });

  it('preserva um fim escolhido manualmente e volta a hoje ao reabrir o painel', async () => {
    vi.useFakeTimers({toFake:['Date']});
    vi.setSystemTime(new Date('2026-12-31T20:00:00Z'));
    window.sessionStorage.setItem('admin_api_token','token-atual');
    vi.stubGlobal('fetch',vi.fn(async input=>successfulResponse(input)));
    const view=render(<Admin />);
    await screen.findByRole('button',{name:'Iniciar coleta'});
    fireEvent.change(screen.getByLabelText('Fim'),{target:{value:'2026-12-15'}});
    vi.setSystemTime(new Date('2027-01-01T12:00:00Z'));
    fireEvent.focus(window);
    expect(screen.getByLabelText('Fim')).toHaveValue('2026-12-15');
    view.unmount();
    render(<Admin />);
    await screen.findByRole('button',{name:'Iniciar coleta'});
    expect(screen.getByLabelText('Fim')).toHaveValue('2027-01-01');
  });

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
    await user.click(screen.getByRole('button', {name:'Votações'}));
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
    const summary = await screen.findByRole('region', {name: 'Resumo da ingestão'});
    await waitFor(() => expect(within(summary).getByText('Sem registros').parentElement).toHaveTextContent('3'));
    expect(within(summary).getByText('Com registros').parentElement).toHaveTextContent('4');
  });

  it('atualiza automaticamente após reabrir o painel, mesmo sem fila inicial', async () => {
    vi.useFakeTimers({toFake: ['setInterval', 'clearInterval']});
    window.sessionStorage.setItem('admin_api_token', 'token-atual');
    let active = false;
    vi.stubGlobal('fetch', vi.fn(async (input) => String(input).endsWith('/summary')
      ? json({checkpoints: active ? [{dataset:'despesas',status:'running',total:2}] : [], periods: [], execution:{processActive:active,maintenanceActive:active}})
      : successfulResponse(input)));
    render(<Admin />);
    await screen.findByRole('button', {name: 'Iniciar coleta'});
    await screen.findByText('Nenhuma tarefa registrada');
    expect(screen.getByText('Atualização automática a cada 5 s')).toBeInTheDocument();
    active = true;
    await act(async () => {await vi.advanceTimersByTimeAsync(5000);});
    expect(screen.getByText('Coleta em execução')).toBeInTheDocument();
    expect(screen.queryByText('Monitoramento parado')).not.toBeInTheDocument();
    expect(screen.queryByText('Criacao da fila')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Progresso'}));
    expect(screen.getByRole('region', {name: 'Resumo da ingestão'})).toHaveTextContent('Coleta em execução');
  });

  it('preserva os números e informa leitura desatualizada até a conexão voltar', async () => {
    vi.useFakeTimers({toFake: ['setInterval', 'clearInterval']});
    window.sessionStorage.setItem('admin_api_token', 'token-atual');
    let fail = false;
    vi.stubGlobal('fetch', vi.fn(async (input) => String(input).endsWith('/summary')
      ? fail ? json({error:'Indisponível'}, 500) : json({checkpoints:[{dataset:'despesas',status:'done',total:7,emptyTotal:3}], periods:[]})
      : successfulResponse(input)));
    render(<Admin />);
    const summary = await screen.findByRole('region', {name: 'Resumo da ingestão'});
    await waitFor(() => expect(summary).toHaveTextContent('7 de 7 tarefas concluídas'));
    fail = true;
    await act(async () => {await vi.advanceTimersByTimeAsync(5000);});
    expect(summary).toHaveTextContent('Status desatualizado');
    expect(summary).toHaveTextContent('7 de 7 tarefas concluídas');
    fail = false;
    await act(async () => {await vi.advanceTimersByTimeAsync(5000);});
    expect(summary).not.toHaveTextContent('Status desatualizado');
  });

  it('compartilha a leitura em andamento entre Atualizar logs e Atualizar', async () => {
    window.sessionStorage.setItem('admin_api_token', 'token-atual');
    let holdLogs = false;
    const releases: Array<(response: Response) => void> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (holdLogs && String(input).endsWith('/logs')) return new Promise<Response>(resolve => {releases.push(resolve);});
      return successfulResponse(input);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<Admin />);
    await screen.findByRole('button', {name: 'Iniciar coleta'});
    await waitFor(() => expect(screen.getByRole('button', {name: 'Atualizar'})).toBeEnabled());
    fireEvent.click(screen.getByRole('button', {name: 'Logs'}));
    holdLogs = true;
    try {
      await act(async () => {fireEvent.click(screen.getByRole('button', {name: 'Atualizar logs'}));});
      await act(async () => {fireEvent.click(screen.getByRole('button', {name: 'Atualizar'}));});
      expect(releases).toHaveLength(1);
    } finally {
      await act(async () => {releases.forEach(resolve => resolve(json({log: ''})));});
    }
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

    expect(await screen.findByRole('button', {name: 'Iniciar coleta'})).toBeDisabled();
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
    if (button === 'Iniciar coleta') await user.click(screen.getByRole('button', {name:'Votações'}));
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
