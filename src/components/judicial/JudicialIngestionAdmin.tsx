import React, {useCallback, useEffect, useState, useSyncExternalStore} from 'react';
import type {JudicialAdminFetch} from '../../lib/judicialAdminActions';
import {judicialIngestionSources, type JudicialCandidate, type JudicialIngestionConfig, type JudicialIngestionRun, type JudicialSourceId} from '../../lib/judicialIngestionTypes';

const base = '/api/admin/judicial/ingestion';
const button = 'min-h-11 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800';
const input = 'mt-1 min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-950';
type Operation = {url: string; body: string};
type State = {run: JudicialIngestionRun | null; pending: boolean; uncertain?: Operation; message: string};
type Session = {state: State; listeners: Set<() => void>; revision: number};
const sessions = new WeakMap<JudicialAdminFetch, Session>();
function session(fetcher: JudicialAdminFetch) {
  let value = sessions.get(fetcher);
  if (!value) {value = {state: {run: null, pending: false, message: ''}, listeners: new Set(), revision: 0}; sessions.set(fetcher, value);}
  return value;
}
function publish(value: Session, state: State) {value.state = state; value.listeners.forEach(listener => listener());}
async function read<T>(fetcher: JudicialAdminFetch, url: string, signal: AbortSignal): Promise<T> {
  const controller = new AbortController(); const cancel = () => controller.abort();
  signal.addEventListener('abort', cancel, {once: true}); if (signal.aborted) cancel();
  const timeout = setTimeout(cancel, 20_000);
  try {
    const response = await fetcher(url, {signal: controller.signal, cache: 'no-store'});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? 'Falha ao consultar a coleta.');
    return data;
  } catch (cause) {if (controller.signal.aborted && !signal.aborted) throw new Error('A consulta da coleta demorou mais que o esperado. Atualize para tentar novamente.'); throw cause;}
  finally {clearTimeout(timeout); signal.removeEventListener('abort', cancel);}
}
async function write(fetcher: JudicialAdminFetch, operation: Operation, retry = false) {
  const value = session(fetcher);
  if (value.state.pending || (value.state.uncertain && !retry)) return;
  const original = value.state.uncertain ?? operation;
  value.revision++;
  publish(value, {...value.state, pending: true, message: 'Enviando solicitação…'});
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 40_000);
  try {
    const response = await fetcher(original.url, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: original.body, signal: controller.signal});
    const data = await response.json();
    if (response.ok) {
      const consolidation = original.url.endsWith('/consolidate');
      publish(value, {run: consolidation ? value.state.run : data, pending: false, message: consolidation
        ? `${data.created} novos registros · ${data.updated} atualizados · ${data.unchanged} sem alteração. ${data.unresolved} documentos sem elementos suficientes para publicação. As fontes do mesmo processo foram reunidas.`
        : 'Solicitação confirmada. A coleta processa e publica automaticamente os fatos comprovados.'});
    }
    else if (response.status < 500) publish(value, {...value.state, pending: false, uncertain: undefined, message: data.error ?? 'Confira os dados antes de tentar novamente.'});
    else throw new Error('Resposta inconclusiva');
  } catch {publish(value, {...value.state, pending: false, uncertain: original, message: 'Resultado incerto. Repita o mesmo envio para conferir a operação.'});}
  finally {clearTimeout(timeout);}
}
export function safeJudicialDocumentUrl(candidate: JudicialCandidate) {
  try {
    const url = new URL(candidate.document.url);
    const host = candidate.sourceId === 'STF_NEWS' ? 'noticias.stf.jus.br' : 'www.stj.jus.br';
    return url.protocol === 'https:' && url.hostname === host && !url.username && !url.password && (!url.port || url.port === '443') ? url.href : null;
  } catch {return null;}
}
const pendingStatus = (run: JudicialIngestionRun | null) => run?.status === 'QUEUED' || run?.status === 'RUNNING';
const active = (run: JudicialIngestionRun | null) => pendingStatus(run) && (!run || !('active' in run) || run.active !== false);
const resumable = (run: JudicialIngestionRun) => ['CANCELLED', 'FAILED'].includes(run.status) || (pendingStatus(run) && !active(run));
const labels: Record<JudicialIngestionRun['status'], string> = {QUEUED: 'Na fila', RUNNING: 'Em andamento', COMPLETED: 'Concluída', PARTIAL: 'Parcial', FAILED: 'Falhou', CANCELLED: 'Cancelada'};

export function JudicialIngestionAdmin({adminFetch, person, onReview, refreshKey}: {adminFetch: JudicialAdminFetch; person: {id: string; nome: string} | null; onReview: (candidate: JudicialCandidate) => void; refreshKey?: string}) {
  const store = session(adminFetch);
  const subscribe = useCallback((listener: () => void) => {store.listeners.add(listener); return () => {store.listeners.delete(listener);};}, [store]);
  const get = useCallback(() => store.state, [store]);
  const state = useSyncExternalStore(subscribe, get, get);
  const [sources, setSources] = useState<JudicialSourceId[]>(['STF_NEWS', 'STJ_NEWS']);
  const [scope, setScope] = useState('batch');
  const [status, setStatus] = useState<'ativo' | 'todos'>('ativo');
  const [max, setMax] = useState(25); const [pages, setPages] = useState(2); const [after, setAfter] = useState('');
  const [runs, setRuns] = useState<JudicialIngestionRun[]>([]);
  const [items, setItems] = useState<JudicialCandidate[]>([]); const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState('PENDING'); const [offset, setOffset] = useState(0);
  const [error, setError] = useState(''); const [listError, setListError] = useState('');
  const [refresh, setRefresh] = useState(0); const [loading, setLoading] = useState(true);
  const [dismissing, setDismissing] = useState<string | null>(null); const [dismissError, setDismissError] = useState('');
  const [sourceError, setSourceError] = useState('');
  const [coverage, setCoverage] = useState<{total:number;researched:number;complete:number;partial:number;failed:number;notResearched:number;confirmedCases:number;unresolved:number}|null>(null);
  const [coverageError, setCoverageError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setCoverageError('');
    void read<NonNullable<typeof coverage>>(adminFetch, `${base}/coverage`, controller.signal)
      .then(data => {if (!controller.signal.aborted) setCoverage(data);})
      .catch(cause => {if (!controller.signal.aborted) setCoverageError(cause.message);});
    return () => controller.abort();
  }, [adminFetch, refresh, state.run?.id, state.run?.status]);
  useEffect(() => {
    const controller = new AbortController();
    void read<{items: unknown[]}>(adminFetch, `${base}/sources`, controller.signal).catch(cause => {if (!controller.signal.aborted) setSourceError(cause.message);});
    return () => controller.abort();
  }, [adminFetch]);
  useEffect(() => {setOffset(0);}, [person?.id, filter]);
  useEffect(() => {
    const controller = new AbortController();
    setItems([]); setLoading(true); setError('');
    const query = new URLSearchParams({status: filter, limit: '20', offset: String(offset)});
    if (person) query.set('politicoId', person.id);
    void read<{items: JudicialCandidate[]; total: number}>(adminFetch, `${base}/candidates?${query}`, controller.signal)
      .then(data => {if (!controller.signal.aborted) {setItems(data.items ?? []); setTotal(data.total ?? 0);}})
      .catch(cause => {if (!controller.signal.aborted) setError(cause.message);})
      .finally(() => {if (!controller.signal.aborted) setLoading(false);});
    return () => controller.abort();
  }, [adminFetch, person?.id, filter, offset, refresh, refreshKey, state.run?.candidatesFound]);
  useEffect(() => {
    const controller = new AbortController();
    void read<{items: JudicialIngestionRun[]}>(adminFetch, `${base}/runs`, controller.signal).then(data => {if (!controller.signal.aborted) setRuns(data.items ?? []);}).catch(cause => {if (!controller.signal.aborted) setListError(cause.message);});
    return () => controller.abort();
  }, [adminFetch, refresh, state.run?.status]);
  useEffect(() => {
    if (!active(state.run)) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const revision = store.revision;
      try {
        const run = await read<JudicialIngestionRun>(adminFetch, `${base}/runs/${state.run!.id}`, controller.signal);
        if (!controller.signal.aborted && store.revision === revision && store.state.run?.id === run.id) publish(store, {...store.state, run});
      } catch (cause) {if (!controller.signal.aborted) setListError(cause instanceof Error ? cause.message : 'Falha ao atualizar progresso.');}
      finally {if (!controller.signal.aborted) timer = setTimeout(poll, 3000);}
    };
    timer = setTimeout(poll, 3000);
    return () => {clearTimeout(timer); controller.abort();};
  }, [adminFetch, store, state.run?.id, state.run?.status, active(state.run)]);
  const start = (event: React.FormEvent) => {
    event.preventDefault();
    const individual = scope === 'person' && person;
    const config: JudicialIngestionConfig = {sources, status: individual ? 'todos' : status, maxPoliticians: individual ? 1 : max, maxPages: pages, afterId: individual ? null : after.trim() || null, ...(individual ? {politicoIds: [person.id]} : {})};
    void write(adminFetch, {url: `${base}/runs/${crypto.randomUUID()}`, body: JSON.stringify(config)});
  };
  const control = (action: 'cancel' | 'resume') => void write(adminFetch, {url: `${base}/runs/${state.run!.id}/${action}`, body: '{}'});
  const dismiss = async (candidate: JudicialCandidate) => {
    if (dismissing) return;
    setDismissing(candidate.id); setDismissError('');
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 40_000);
    try {
      const response = await adminFetch(`${base}/candidates/${candidate.id}/dismiss`, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({expectedVersion: candidate.version, reviewNote: 'Descartado na triagem administrativa.'}), signal: controller.signal});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Não foi possível confirmar o descarte. Atualize os candidatos.');
      setRefresh(value => value + 1);
    } catch (cause) {setDismissError(cause instanceof Error ? cause.message : 'Resultado incerto do descarte; atualize antes de tentar novamente.');}
    finally {clearTimeout(timer); setDismissing(null);}
  };
  const blocked = state.pending || !!state.uncertain || active(state.run);
  return <section className="surface min-w-0 space-y-4 p-4 sm:p-5" aria-labelledby="ingestion-title">
    <div><h3 id="ingestion-title" className="text-lg font-semibold">Coleta de documentos oficiais</h3><p className="mt-2 text-sm">A consulta processual identifica processos, papéis e situações documentados no STF. A coleta de notícias seleciona relatos explícitos de condenação, prisão cumprida ou reversão de condenação. Meras denúncias, processos, pedidos e mandados não cumpridos não comprovam condenação ou prisão. Os fatos comprovados são consolidados por processo e publicados automaticamente, com motivos e fontes reunidas. Documentos sem elementos suficientes permanecem no diagnóstico privado. A quantidade de notícias não representa a quantidade de casos.</p></div>
    <section aria-label="Cobertura da pesquisa de processos" className="space-y-3 rounded-lg border border-slate-200 p-4 dark:border-slate-700">
      <h4 className="font-semibold">Processos dos deputados</h4>
      <p className="text-sm">Pesquisa os processos públicos do STF, em tramitação e fora de tramitação, de todos os deputados cadastrados. Vínculos sem confirmação de identidade não são publicados. A pesquisa não equivale a cobertura nacional completa e não infere condenações ou prisões.</p>
      {coverage && typeof coverage.total === 'number' && typeof coverage.researched === 'number' && <div className="space-y-1 text-sm"><p className="font-semibold">{coverage.researched.toLocaleString('pt-BR')} de {coverage.total.toLocaleString('pt-BR')} deputados pesquisados</p><p>{coverage.complete.toLocaleString('pt-BR')} consultas completas · {coverage.partial.toLocaleString('pt-BR')} parciais · {coverage.failed.toLocaleString('pt-BR')} com falha · {coverage.notResearched.toLocaleString('pt-BR')} não pesquisados</p><p>{coverage.confirmedCases.toLocaleString('pt-BR')} processos confirmados · {coverage.unresolved.toLocaleString('pt-BR')} vínculos pendentes de confirmação</p></div>}
      {coverageError && <p role="alert">Não foi possível consultar a cobertura: {coverageError}</p>}
      <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={blocked} onClick={() => void write(adminFetch, {url: `${base}/runs/${crypto.randomUUID()}`, body: JSON.stringify({sources:['STF_CASES'],status:'todos',maxPoliticians:10000,maxPages:500,afterId:null})})}>Pesquisar todos os deputados</button><button type="button" className={button} onClick={() => setRefresh(value => value + 1)}>Atualizar cobertura</button></div>
    </section>
    <button type="button" className={button} disabled={blocked} onClick={() => void write(adminFetch, {url: `${base}/consolidate`, body: '{}'})}>Atualizar dados dos documentos coletados</button>
    <form onSubmit={start} className="space-y-4">
      <fieldset disabled={blocked} className="space-y-4"><legend className="font-medium">Fontes da coleta</legend>
        {Object.entries(judicialIngestionSources).map(([id, source]) => <label key={id} className="flex items-start gap-3 text-sm"><input className="mt-1 h-5 w-5 shrink-0" type="checkbox" checked={sources.includes(id as JudicialSourceId)} onChange={event => setSources(current => event.target.checked ? [...current, id as JudicialSourceId] : current.filter(item => item !== id))} /><span><span className="font-semibold">{source.label}</span><span className="mt-1 block text-slate-600 dark:text-slate-300">{source.scope}</span></span></label>)}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="min-w-0 text-sm">Pessoas a pesquisar<select className={input} value={scope} onChange={event => setScope(event.target.value)}><option value="batch">Lote de políticos</option><option value="person" disabled={!person}>Pessoa selecionada{person ? `: ${person.nome}` : ''}</option></select></label>
          {scope === 'batch' && <><label className="text-sm">Situação dos políticos<select className={input} value={status} onChange={event => setStatus(event.target.value as 'ativo' | 'todos')}><option value="ativo">Ativos</option><option value="todos">Todos</option></select></label><label className="text-sm">Máximo de políticos<input type="number" className={input} min={1} max={100} required value={max} onChange={event => setMax(Number(event.target.value))} /></label><label className="text-sm">Continuar após o ID<input className={input} value={after} onChange={event => setAfter(event.target.value)} placeholder="Opcional" /></label></>}
          <label className="text-sm">Páginas por fonte e pessoa<input className={input} type="number" min={1} max={5} required value={pages} onChange={event => setPages(Number(event.target.value))} /></label>
        </div>
        <button className={button} disabled={!sources.length || (scope === 'person' && !person)}>Coletar documentos</button>
      </fieldset>
    </form>
    {sourceError && <p role="alert">Catálogo de fontes indisponível: {sourceError}</p>}
    <div role="status" className="space-y-2 text-sm">{state.message && <p>{state.message}</p>}{state.uncertain && <button className={button} disabled={state.pending} onClick={() => void write(adminFetch, state.uncertain!, true)}>{state.uncertain.url.endsWith('/consolidate') ? 'Repetir a atualização dos dados' : 'Repetir o mesmo envio da coleta'}</button>}</div>
    {state.run && <div className="space-y-3 border-t border-slate-200 pt-3 dark:border-slate-700"><p className="font-medium">Coleta {labels[state.run.status]}</p><p className="break-all text-xs">Identificador: {state.run.id}</p><p className="text-sm">{state.run.processedPages} {state.run.archive ? 'pessoas processadas no acervo' : 'páginas consultadas'} · {state.run.candidatesFound} candidatos · {state.run.cursor.personIndex}/{state.run.people.length} pessoas percorridas</p>
      {state.run.automation && <div className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800"><p className="font-semibold">Dados consolidados automaticamente</p><p>{state.run.automation.created} novos registros · {state.run.automation.updated} atualizados · {state.run.automation.unchanged} sem alteração</p><p>{state.run.automation.unresolved} documentos sem elementos suficientes para publicação. Notícias do mesmo processo são reunidas nas fontes do caso.</p></div>}
      {state.run.lastError && <p role="alert" className="break-words text-sm text-rose-700 dark:text-rose-300">{state.run.lastError}</p>}
      {state.run.errors.length > 0 && <details><summary className="cursor-pointer py-2">{state.run.errors.length} falhas de fonte</summary><ul>{state.run.errors.map((failure, index) => <li key={index} className="break-words text-sm">{failure.source} · Pessoa {failure.politicoId}: {failure.message}</li>)}</ul></details>}
      {state.run.truncated && !state.run.archive && <p className="text-sm">Limite de páginas atingido. Há documentos fora do escopo deste lote.</p>}
      {state.run.status === 'PARTIAL' && <p className="text-sm">Este lote terminou com cobertura parcial. Confira as falhas e inicie uma nova coleta com o escopo desejado.</p>}
      {state.run.hasMorePoliticians && <p className="text-sm">Há mais políticos. Para o próximo lote, continue após o ID {state.run.nextPoliticoId}.</p>}
      {state.run.cancelRequested && active(state.run) && <p role="status">Cancelamento solicitado; aguardando o checkpoint.</p>}
      {(active(state.run) || resumable(state.run)) && <button className={button} disabled={state.pending || !!state.uncertain || (active(state.run) && state.run.cancelRequested)} onClick={() => control(active(state.run) ? 'cancel' : 'resume')}>{active(state.run) ? 'Cancelar coleta' : 'Retomar coleta'}</button>}
    </div>}
    <details><summary className="cursor-pointer py-2 font-medium">Execuções recentes</summary><ul className="space-y-2">{runs.map(run => <li key={run.id}><button className={`${button} max-w-full break-all text-left`} disabled={state.pending || !!state.uncertain || active(state.run)} onClick={() => publish(store, {...state, run})}>Abrir execução {run.id} · {labels[run.status]}</button></li>)}</ul></details>
    {listError && <p role="alert">{listError}</p>}
    <details className="space-y-4"><summary className="cursor-pointer py-2 font-medium">Diagnóstico dos documentos e importação manual</summary><p className="text-sm">Ferramentas opcionais para conferir documentos e corrigir registros. A coleta automática não exige revisão ou preenchimento manual.</p>
    <div className="flex flex-wrap items-end justify-between gap-3"><h4 className="font-semibold">Documentos candidatos {person ? `de ${person.nome}` : 'de todos os políticos'}</h4><label className="text-sm">Triagem<select className={input} value={filter} onChange={event => setFilter(event.target.value)}><option value="PENDING">Pendentes</option><option value="IMPORTED">Importados</option><option value="DISMISSED">Descartados</option></select></label><button className={button} onClick={() => {setRefresh(value => value + 1); setListError('');}}>Atualizar candidatos</button></div>
    {loading && <p role="status">Consultando candidatos…</p>}{error && <p role="alert">{error}</p>}{dismissError && <p role="alert">{dismissError}</p>}
    {!loading && !error && !items.length && <p className="text-sm">Nenhum documento candidato neste filtro. Isso não comprova ausência de antecedentes.</p>}
    <ul className="space-y-4">{items.map(candidate => {const url = safeJudicialDocumentUrl(candidate); return <li key={candidate.id} className="min-w-0 space-y-2 border-t border-slate-200 pt-4 dark:border-slate-700"><p className="font-medium">{candidate.politicoName}</p><h5 className="break-words font-semibold">{candidate.document.title}</h5><p className="text-xs">{judicialIngestionSources[candidate.sourceId].label} · Publicação: {candidate.document.publishedAt ? new Date(candidate.document.publishedAt).toLocaleDateString('pt-BR', {timeZone: 'UTC'}) : 'não informada'} · A publicação não é a data do fato.</p>{candidate.evidence?.length ? <div className="space-y-2 text-sm"><ul className="space-y-2">{candidate.evidence.map((evidence, index) => <li key={index} className="space-y-1"><p className="font-semibold">{evidence.status === 'REVERSED' ? 'Condenação revertida/anulada — conferir desfecho' : evidence.kind === 'CONVICTION' ? 'Relato de condenação' : 'Relato de prisão cumprida'}</p><blockquote className="break-words border-l-2 border-slate-300 pl-3 dark:border-slate-600">{evidence.excerpt}</blockquote></li>)}</ul><p>A situação atual ainda exige conferência quando não está descrita na fonte. O trecho bruto é um diagnóstico; os fatos com elementos suficientes são publicados automaticamente.</p></div> : <p className="text-sm">Sem evidência explícita de condenação ou prisão cumprida neste documento.</p>}{candidate.contentChanged && <p className="text-sm font-semibold">Documento alterado desde a coleta anterior. Confira novamente a evidência.</p>}<details><summary className="cursor-pointer py-2 text-sm font-semibold">Ler documento coletado</summary><p className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-sm">{candidate.document.text}</p></details>{url ? <a className="inline-flex min-h-11 items-center break-all text-sm text-blue-700 underline dark:text-blue-300" href={url} target="_blank" rel="noopener noreferrer">Abrir fonte oficial</a> : <p className="text-sm">Link não reconhecido como fonte oficial desta coleta.</p>}{candidate.status === 'PENDING' && <div className="flex flex-wrap gap-2"><button className={button} disabled={!candidate.evidence?.length} onClick={() => {if (candidate.evidence?.length) onReview(candidate);}}>Revisar candidato</button><button className={button} disabled={!!dismissing} onClick={() => void dismiss(candidate)}>{dismissing === candidate.id ? 'Descartando…' : 'Descartar candidato'}</button></div>}</li>;})}</ul>
    {total > 20 && <div className="flex flex-wrap items-center gap-3"><button className={button} disabled={loading || offset === 0} onClick={() => setOffset(value => Math.max(0, value - 20))}>Anteriores</button><p className="text-sm">{offset + 1}–{Math.min(offset + 20, total)} de {total}</p><button className={button} disabled={loading || offset + 20 >= total} onClick={() => setOffset(value => value + 20)}>Próximos</button></div>}
    </details>
  </section>;
}
