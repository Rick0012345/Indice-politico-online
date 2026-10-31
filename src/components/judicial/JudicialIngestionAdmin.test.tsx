import {render, screen, fireEvent, waitFor, act} from '@testing-library/react';
import {describe, it, expect, vi, afterEach} from 'vitest';
import {JudicialIngestionAdmin} from './JudicialIngestionAdmin';

const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), {status});
const run = {id: 'run-1', status: 'CANCELLED', config: {}, cursor: {personIndex: 0, sourceIndex: 0, page: 1}, people: [], processedPages: 0, candidatesFound: 0, errors: [], truncated: false, hasMorePoliticians: false};
const candidate = {id: 'candidate-1', politicoId: '100', politicoName: 'Pessoa candidata', sourceId: 'STF_NEWS', status: 'PENDING', version: 1, document: {title: 'Documento para conferência', text: 'Texto completo.', url: 'https://noticias.stf.jus.br/posts/noticia/teste/', publishedAt: null}};
const withCandidates = (items: unknown[]) => vi.fn(async (url: RequestInfo | URL) => response({items: String(url).includes('/candidates?') ? items : [], total: items.length}));
describe('coleta judicial privada', () => {
  it('publica fatos automaticamente e mantém documentos brutos em diagnóstico opcional', async () => {
    render(<JudicialIngestionAdmin adminFetch={withCandidates([])} person={null} onReview={vi.fn()} />);
    await screen.findByText(/Nenhum documento candidato/);
    expect(screen.getByText(/Os fatos comprovados são consolidados por processo e publicados automaticamente/)).toBeInTheDocument();
    const details = screen.getByText('Diagnóstico dos documentos e importação manual').closest('details');
    expect(details).not.toHaveAttribute('open');
    expect(screen.getByRole('button', {name: 'Atualizar dados dos documentos coletados'})).toBeEnabled();
  });

  it('consolida sem formulário e compartilha bloqueio, resultado incerto e repetição entre montagens', async () => {
    let finish!: (value: Response) => void;
    let writes = 0;
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).endsWith('/consolidate') && init?.method === 'PUT') {
        if (++writes === 1) return new Promise<Response>(resolve => {finish = resolve;});
        return response({created: 2, updated: 1, unchanged: 4, unresolved: 3, cases: 3});
      }
      return response({items: [], total: 0});
    });
    const props = {adminFetch: fetcher, person: null, onReview: vi.fn()};
    const first = render(<JudicialIngestionAdmin {...props} />);
    fireEvent.click(screen.getByRole('button', {name: 'Atualizar dados dos documentos coletados'}));
    first.unmount();
    render(<JudicialIngestionAdmin {...props} />);
    expect(screen.getByRole('button', {name: 'Atualizar dados dos documentos coletados'})).toBeDisabled();
    await act(async () => finish(response({}, 503)));
    fireEvent.click(await screen.findByRole('button', {name: 'Repetir a atualização dos dados'}));
    await screen.findByText(/2 novos registros · 1 atualizados · 4 sem alteração/);
    expect(screen.queryByRole('textbox', {name: 'Número do caso ou processo'})).not.toBeInTheDocument();
    const puts = fetcher.mock.calls.filter(([, init]) => init?.method === 'PUT');
    expect(puts).toHaveLength(2);
    expect(puts.every(([url, init]) => String(url).endsWith('/consolidate') && init?.body === '{}')).toBe(true);
  });

  afterEach(() => vi.useRealTimers());
  it.each([
    {kind: 'CONVICTION', excerpt: 'Pessoa candidata foi condenada pelo tribunal.', label: 'Relato de condenação'},
    {kind: 'IMPRISONMENT', excerpt: 'Pessoa candidata foi presa e levada à unidade prisional.', label: 'Relato de prisão cumprida'},
  ])('mostra o trecho de $kind e permite conferência sem presumir situação atual', async ({kind, excerpt, label}) => {
    const item = {...candidate, evidence: [{kind, excerpt, matchedName: 'Pessoa candidata', status: 'REPORTED'}]};
    const onReview = vi.fn();
    render(<JudicialIngestionAdmin adminFetch={withCandidates([item])} person={null} onReview={onReview} />);
    expect(await screen.findByText(label)).toBeInTheDocument();
    expect(screen.getByText(excerpt)).toBeInTheDocument();
    expect(screen.getByText(/A situação atual ainda exige conferência/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Diagnóstico dos documentos e importação manual'));
    fireEvent.click(screen.getByRole('button', {name: 'Revisar candidato'}));
    expect(onReview).toHaveBeenCalledWith(item);
  });

  it.each([{evidence: undefined}, {evidence: []}])('bloqueia revisão de candidato legado sem evidência $evidence, mantendo descarte disponível', async ({evidence}) => {
    const onReview = vi.fn();
    render(<JudicialIngestionAdmin adminFetch={withCandidates([{...candidate, evidence}])} person={null} onReview={onReview} />);
    await screen.findByText(/Sem evidência explícita/);
    fireEvent.click(screen.getByText('Diagnóstico dos documentos e importação manual'));
    const review = screen.getByRole('button', {name: 'Revisar candidato'});
    expect(review).toBeDisabled();
    fireEvent.click(review);
    expect(onReview).not.toHaveBeenCalled();
    expect(screen.getByText('Sem evidência explícita de condenação ou prisão cumprida neste documento.')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Descartar candidato'})).toBeEnabled();
  });

  it('identifica reversão e preserva a conferência do desfecho', async () => {
    render(<JudicialIngestionAdmin adminFetch={withCandidates([{...candidate, evidence: [{kind: 'CONVICTION', status: 'REVERSED', excerpt: 'A condenação de Pessoa candidata foi anulada.', matchedName: 'Pessoa candidata'}]}])} person={null} onReview={vi.fn()} />);
    expect(await screen.findByText('Condenação revertida/anulada — conferir desfecho')).toBeInTheDocument();
    expect(screen.getByText('A condenação de Pessoa candidata foi anulada.')).toBeInTheDocument();
    expect(screen.queryByText('Relato de condenação')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Diagnóstico dos documentos e importação manual'));
    expect(screen.getByRole('button', {name: 'Revisar candidato'})).toBeEnabled();
  });
  it('distingue pessoas processadas no acervo de páginas consultadas e mostra o resultado automático', async () => {
    const archived = {...run, archive: {source: 'STF'}, processedPages: 100, truncated: true, hasMorePoliticians: true, nextPoliticoId: '200', automation: {created: 2, updated: 3, unchanged: 4, unresolved: 5, cases: 3}};
    const fetcher = vi.fn(async (url: RequestInfo | URL) => response({items: String(url).endsWith('/runs') ? [archived] : [], total: 0}));
    render(<JudicialIngestionAdmin adminFetch={fetcher} person={null} onReview={vi.fn()} />);
    await screen.findByText(/Abrir execução/);
    fireEvent.click(screen.getByText('Execuções recentes'));
    fireEvent.click(screen.getByRole('button', {name: /Abrir execução/}));
    await screen.findByText(/Nenhum documento candidato/);
    expect(screen.getByText(/100 pessoas processadas no acervo/)).toBeInTheDocument();
    expect(screen.queryByText(/páginas consultadas/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Limite de páginas atingido/)).not.toBeInTheDocument();
    expect(screen.getByText(/Há mais políticos/)).toBeInTheDocument();
    expect(screen.getByText(/2 novos registros · 3 atualizados · 4 sem alteração/)).toBeInTheDocument();
    expect(screen.getByText(/5 documentos sem elementos suficientes/)).toBeInTheDocument();
  });

  it('repete o mesmo UUID e corpo após resultado incerto e recupera ao remontar', async () => {
    let writes = 0;
    const fetcher = vi.fn(async (url: RequestInfo | URL, options?: RequestInit) => {
      if (options?.method === 'PUT') {if (++writes === 1) throw new Error('rede'); return response(run);}
      return response({items: [], total: 0});
    });
    const props = {adminFetch: fetcher, person: null, onReview: vi.fn()};
    const first = render(<JudicialIngestionAdmin {...props} />);
    fireEvent.click(screen.getByRole('button', {name: 'Coletar documentos'}));
    fireEvent.click(screen.getByRole('button', {name: 'Coletar documentos'}));
    await screen.findByRole('button', {name: 'Repetir o mesmo envio da coleta'});
    first.unmount(); render(<JudicialIngestionAdmin {...props} />);
    fireEvent.click(screen.getByRole('button', {name: 'Repetir o mesmo envio da coleta'}));
    await waitFor(() => expect(writes).toBe(2));
    const puts = fetcher.mock.calls.filter(([, init]) => init?.method === 'PUT');
    expect(puts[0][0]).toBe(puts[1][0]);
    expect(puts[0][1]?.body).toBe(puts[1][1]?.body);
    expect(JSON.parse(String(puts[0][1]?.body))).toMatchObject({maxPoliticians: 25, maxPages: 2, status: 'ativo'});
  });

  it('retoma e cancela explicitamente a execução selecionada', async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') return response({...run, status: String(url).endsWith('/resume') ? 'RUNNING' : 'CANCELLED'});
      return response({items: String(url).endsWith('/runs') ? [run] : [], total: 0});
    });
    render(<JudicialIngestionAdmin adminFetch={fetcher} person={null} onReview={vi.fn()} />);
    await screen.findByText(/Abrir execução/);
    fireEvent.click(screen.getByText('Execuções recentes'));
    fireEvent.click(screen.getByRole('button', {name: /Abrir execução/}));
    fireEvent.click(screen.getByRole('button', {name: 'Retomar coleta'}));
    await screen.findByRole('button', {name: 'Cancelar coleta'});
    fireEvent.click(screen.getByRole('button', {name: 'Cancelar coleta'}));
    await screen.findByRole('button', {name: 'Retomar coleta'});
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PUT').map(([url]) => url)).toEqual(['/api/admin/judicial/ingestion/runs/run-1/resume', '/api/admin/judicial/ingestion/runs/run-1/cancel']);
  });

  it('descarta resposta atrasada ao trocar a pessoa selecionada', async () => {
    let resolveOld: (value: Response) => void = () => {};
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('politicoId=100')) return new Promise<Response>(resolve => {resolveOld = resolve;});
      return response({items: [], total: 0});
    });
    const view = render(<JudicialIngestionAdmin adminFetch={fetcher} person={{id: '100', nome: 'Anterior'}} onReview={vi.fn()} />);
    view.rerender(<JudicialIngestionAdmin adminFetch={fetcher} person={{id: '200', nome: 'Atual'}} onReview={vi.fn()} />);
    await screen.findByText(/Nenhum documento candidato/);
    await act(async () => resolveOld(response({items: [{id: 'old', politicoName: 'Pessoa antiga'}], total: 1})));
    expect(screen.queryByText('Pessoa antiga')).not.toBeInTheDocument();
    expect(screen.getByText('Documentos candidatos de Atual')).toBeInTheDocument();
  });

  it('não oferece retomada de lote parcial e permite retomar execução sem worker ativo', async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) => response({items: String(url).endsWith('/runs') ? [{...run, id: 'partial', status: 'PARTIAL'}, {...run, id: 'interrupted', status: 'RUNNING', active: false}] : [], total: 0}));
    render(<JudicialIngestionAdmin adminFetch={fetcher} person={null} onReview={vi.fn()} />);
    await screen.findByText(/Abrir execução partial/);
    fireEvent.click(screen.getByText('Execuções recentes'));
    fireEvent.click(screen.getByRole('button', {name: /Abrir execução partial/}));
    expect(screen.queryByRole('button', {name: 'Retomar coleta'})).not.toBeInTheDocument();
    expect(screen.getByText(/Este lote terminou com cobertura parcial/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: /Abrir execução interrupted/}));
    expect(screen.getByRole('button', {name: 'Retomar coleta'})).toBeEnabled();
    expect(screen.queryByRole('button', {name: 'Cancelar coleta'})).not.toBeInTheDocument();
  });

  it('resposta atrasada do polling não desfaz cancelamento e para de consultar estado terminal', async () => {
    vi.useFakeTimers(); let resolvePoll: (response: Response) => void = () => {};
    const current = {...run, status: 'RUNNING'};
    const fetcher = vi.fn(async (url: RequestInfo | URL, options?: RequestInit) => {
      if (options?.method === 'PUT') return response(run);
      if (String(url).endsWith('/runs/run-1')) return new Promise<Response>(resolve => {resolvePoll = resolve;});
      return response({items: String(url).endsWith('/runs') ? [current] : [], total: 0});
    });
    render(<JudicialIngestionAdmin adminFetch={fetcher} person={null} onReview={vi.fn()} />);
    await act(async () => {});
    fireEvent.click(screen.getByText('Execuções recentes'));
    fireEvent.click(screen.getByRole('button', {name: /Abrir execução/}));
    await act(async () => {await vi.advanceTimersByTimeAsync(3000);});
    await act(async () => {fireEvent.click(screen.getByRole('button', {name: 'Cancelar coleta'}));});
    await act(async () => {resolvePoll(response(current));});
    expect(screen.getByRole('button', {name: 'Retomar coleta'})).toBeInTheDocument();
    const calls = fetcher.mock.calls.filter(([url]) => String(url).endsWith('/runs/run-1')).length;
    await act(async () => {await vi.advanceTimersByTimeAsync(9000);});
    expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/runs/run-1'))).toHaveLength(calls);
  });
});

it('pesquisa todos com a mesma operação compartilhada e mostra cobertura sem exigir formulário',async()=>{
 let writes=0;
 const fetcher=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
  if(init?.method==='PUT'){writes++;return response({...run,status:'COMPLETED'});}
  if(String(url).endsWith('/coverage'))return response({total:1252,researched:writes?30:20,complete:10,partial:8,failed:2,notResearched:1232,confirmedCases:5,unresolved:3});
  return response({items:[],total:0});
 });
 render(<JudicialIngestionAdmin adminFetch={fetcher} person={null} onReview={vi.fn()}/>);
 expect(await screen.findByText(/20 de 1.252 deputados pesquisados/)).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Pesquisar todos os deputados'}));
 await screen.findByText(/30 de 1.252 deputados pesquisados/);
 const put=fetcher.mock.calls.find(([,init])=>init?.method==='PUT');
 expect(String(put?.[0])).toMatch(/\/runs\/[a-f0-9-]{36}$/);
 expect(JSON.parse(String(put?.[1]?.body))).toMatchObject({sources:['STF_CASES'],status:'todos',maxPoliticians:10000,maxPages:500});
 expect(screen.queryByRole('textbox',{name:'Número do caso ou processo'})).not.toBeInTheDocument();
});

it('mostra falha global da fonte como texto e preserva a retomada da execução',async()=>{
 const failed={...run,status:'FAILED',lastError:'Fonte oficial indisponível: HTTP 403 <script>não executar</script>'};
 const fetcher=vi.fn(async(url:RequestInfo|URL)=>response({items:String(url).endsWith('/runs')?[failed]:[],total:0}));
 render(<JudicialIngestionAdmin adminFetch={fetcher} person={null} onReview={vi.fn()}/>);
 await screen.findByText(/Abrir execução/);fireEvent.click(screen.getByText('Execuções recentes'));fireEvent.click(screen.getByRole('button',{name:/Abrir execução/}));
 await screen.findByText(/Nenhum documento candidato/);
 expect(screen.getByText(failed.lastError)).toBeInTheDocument();expect(document.querySelector('script')).toBeNull();
 expect(screen.getByRole('button',{name:'Retomar coleta'})).toBeEnabled();
});
