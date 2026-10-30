import React, {useCallback, useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {Link} from 'react-router-dom';
import {judicialCategories, convictionStatuses, custodyTypes, type JudicialAdminProfile, type JudicialAdminRecord, type JudicialRecordInput, type JudicialCoverage} from '../../lib/judicialTypes';
import {getJudicialAction, reconcileJudicialAction, saveJudicialAction, subscribeJudicialAction, type JudicialAdminFetch, type JudicialSaveRequest} from '../../lib/judicialAdminActions';

const inputClass = 'mt-1 min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-2 focus:outline-blue-600 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100';
const buttonClass = 'min-h-11 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:hover:bg-slate-800';
const dateLabel = (value?: string | null) => value ? new Date(value).toLocaleDateString('pt-BR', {timeZone: 'UTC'}) : 'Não informado';
const newRecord = (): JudicialRecordInput => ({
  kind: 'CONVICTION', category: 'CRIMINAL', caseNumber: '', court: '', title: '', description: '', eventDate: '',
  convictionStatus: 'APPEAL', finalityDate: null, custodyType: null, custodyConfirmed: false, releasedAt: null,
  grounds: '', outcome: '', sourceUrl: '', sourceLabel: '', verification: 'DRAFT', identityEvidence: '', reviewNote: '',
});
type Person = {id: string; nome: string; partido: string; estado: string};
type Audit = {id: string; recordId: string | null; action: string; createdAt: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null};

async function readJson<T>(fetcher: JudicialAdminFetch, url: string, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, {once: true});
  if (signal?.aborted) cancel();
  const timeout = setTimeout(cancel, 20_000);
  try {
    const response = await fetcher(url, {signal: controller.signal, cache: 'no-store'});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? 'Não foi possível consultar os registros.');
    return data;
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) throw new Error('A consulta demorou mais que o esperado. Tente novamente.');
    throw error;
  } finally {clearTimeout(timeout); signal?.removeEventListener('abort', cancel);}
}

export function JudicialAdmin({adminFetch}: {adminFetch: JudicialAdminFetch}) {
  const [search, setSearch] = useState('');
  const [people, setPeople] = useState<Person[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchDone, setSearchDone] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [person, setPerson] = useState<Person | null>(null);
  const searchController = useRef<AbortController | null>(null);
  useEffect(() => () => searchController.current?.abort(), []);
  const findPeople = async (event: React.FormEvent) => {
    event.preventDefault(); searchController.current?.abort();
    const controller = new AbortController(); searchController.current = controller;
    setSearching(true); setSearchError(''); setPeople([]); setSearchDone(false);
    try {
      const data = await readJson<{items: Person[]}>(fetch, `/api/politicos?status=todos&limit=20&search=${encodeURIComponent(search.trim())}`, controller.signal);
      if (!controller.signal.aborted) {setPeople(data.items); setSearchDone(true);}
    } catch (error) {if (!controller.signal.aborted) setSearchError(error instanceof Error ? error.message : 'Falha na busca.');}
    finally {if (!controller.signal.aborted) setSearching(false);}
  };
  return <section className="space-y-5 text-slate-800 dark:text-slate-100" aria-labelledby="judicial-admin-title">
    <div><h2 id="judicial-admin-title" className="text-xl font-semibold">Histórico judicial</h2>
      <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">Cadastre evidências oficiais, confira a identidade e publique os registros revisados. A coleta parlamentar não pesquisa condenações ou prisões automaticamente.</p></div>
    <form onSubmit={findPeople} className="surface flex flex-wrap items-end gap-3 p-4">
      <label className="min-w-0 flex-1 text-sm font-medium">Buscar político<input className={inputClass} value={search} minLength={2} required onChange={event => setSearch(event.target.value)} placeholder="Nome do parlamentar" /></label>
      <button className={buttonClass} disabled={searching || search.trim().length < 2}>{searching ? 'Buscando…' : 'Buscar'}</button>
    </form>
    {searchError && <p role="alert">{searchError}</p>}
    {searchDone && !people.length && <p role="status">Nenhum político encontrado para essa busca.</p>}
    {!!people.length && <ul className="grid gap-2 sm:grid-cols-2">{people.map(item => <li key={item.id}><button type="button" className={`${buttonClass} w-full text-left`} onClick={() => setPerson(item)} aria-pressed={person?.id === item.id}>{item.nome} · {item.partido}/{item.estado}</button></li>)}</ul>}
    {person && <PersonJudicialEditor key={person.id} person={person} adminFetch={adminFetch} />}
  </section>;
}

const PersonJudicialEditor: React.FC<{person: Person; adminFetch: JudicialAdminFetch}> = ({person, adminFetch}) => {
  const [profile, setProfile] = useState<JudicialAdminProfile | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creatingId, setCreatingId] = useState<string | null>(null);
  const creatingRef = useRef<string | null>(null);
  creatingRef.current = creatingId;
  const [audit, setAudit] = useState<Audit[] | null>(null);
  const [auditError, setAuditError] = useState('');
  const [auditLoading, setAuditLoading] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const auditController = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const subscribe = useCallback((listener: () => void) => subscribeJudicialAction(adminFetch, person.id, listener), [adminFetch, person.id]);
  const snapshot = useCallback(() => getJudicialAction(adminFetch, person.id), [adminFetch, person.id]);
  const action = useSyncExternalStore(subscribe, snapshot, snapshot);
  const base = `/api/admin/judicial/politicos/${person.id}`;
  const refresh = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController(); controllerRef.current = controller;
    setLoading(true); setError('');
    try {
      const current = await readJson<JudicialAdminProfile>(adminFetch, base, controller.signal);
      if (!controller.signal.aborted && mounted.current) {
        setProfile(current); reconcileJudicialAction(adminFetch, person.id, current);
        if (creatingRef.current && current.records.some(item => item.id === creatingRef.current)) {
          setEditingId(creatingRef.current); setCreatingId(null);
        }
      }
    } catch (cause) {
      if (!controller.signal.aborted && mounted.current) {setProfile(null); setError(cause instanceof Error ? cause.message : 'Falha na consulta.');}
    } finally {if (!controller.signal.aborted && mounted.current) setLoading(false);}
  }, [adminFetch, base, person.id]);
  useEffect(() => {
    mounted.current = true; void refresh();
    return () => {mounted.current = false; controllerRef.current?.abort(); auditController.current?.abort();};
  }, [refresh]);
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && action.status === 'idle') {setAudit(null); void refresh();}
    wasPending.current = action.status === 'pending';
  }, [action.status, refresh]);
  const save = async (request: JudicialSaveRequest) => {
    await saveJudicialAction(adminFetch, person.id, request);
    if (mounted.current && getJudicialAction(adminFetch, person.id).saved) {
      if (request.recordId) {setEditingId(request.recordId); setCreatingId(null);}
    }
  };
  const loadAudit = async () => {
    auditController.current?.abort(); const controller = new AbortController(); auditController.current = controller;
    setAuditLoading(true); setAuditError('');
    try {const data = await readJson<{items: Audit[]}>(adminFetch, `${base}/audit`, controller.signal); if (!controller.signal.aborted) setAudit(data.items);}
    catch (cause) {if (!controller.signal.aborted) setAuditError(cause instanceof Error ? cause.message : 'Falha ao consultar revisões.');}
    finally {if (!controller.signal.aborted) setAuditLoading(false);}
  };
  const record = profile?.records.find(item => item.id === editingId);
  const disabled = action.status !== 'idle' || loading;
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-semibold">{person.nome} · {person.partido}/{person.estado}</h3><Link className="text-sm font-semibold text-blue-700 underline dark:text-blue-300" to={`/politico/${person.id}?tab=judicial`}>Ver perfil público</Link></div>
    {action.message && <div role="status" className="surface space-y-3 p-4"><p>{action.message}</p>
      {action.status === 'uncertain' && <div className="flex flex-wrap gap-2"><button type="button" className={buttonClass} onClick={() => void refresh()} disabled={loading}>Conferir resultado</button><button type="button" className={buttonClass} onClick={() => void saveJudicialAction(adminFetch, person.id, action.request!, true)}>Repetir o mesmo envio</button></div>}
    </div>}
    {loading && <p role="status">Consultando histórico…</p>}
    {error && <div role="alert" className="surface space-y-2 p-4"><p>{error}</p><button type="button" className={buttonClass} onClick={() => void refresh()}>Tentar novamente</button></div>}
    {profile && <>
      <section className="surface space-y-4 p-4 sm:p-5" aria-label="Registros cadastrados">
        <div className="flex flex-wrap justify-between gap-2"><h4 className="font-semibold">Registros cadastrados</h4><button type="button" className={buttonClass} disabled={disabled} onClick={() => {setEditingId(null); setCreatingId(crypto.randomUUID());}}>Novo registro</button></div>
        {!profile.records.length && <p className="text-sm">Nenhum registro cadastrado.</p>}
        <ul className="space-y-3">{profile.records.map(item => <li key={item.id} className="flex flex-wrap items-start justify-between gap-3 border-t border-slate-200 pt-3 dark:border-slate-700"><div className="min-w-0 flex-1"><p className="break-words font-medium">{item.title}</p><p className="mt-1 text-sm">{item.kind === 'IMPRISONMENT' ? 'Prisão' : judicialCategories[item.category]} · {item.verification === 'VERIFIED' ? 'Revisado e publicado' : 'Rascunho'} · {dateLabel(item.eventDate)}</p><p className="mt-1 break-words text-xs text-slate-500">{item.court} · {item.caseNumber}</p></div><button type="button" className={buttonClass} disabled={disabled} onClick={() => {setCreatingId(null); setEditingId(item.id);}}>Editar registro</button></li>)}</ul>
      </section>
      {(record || creatingId) && <RecordForm key={`${record?.id ?? creatingId}:${record?.version ?? 0}`} record={record} disabled={disabled} onSave={value => save({url: `${base}/records/${record?.id ?? creatingId}`, recordId: record?.id ?? creatingId!, body: {...value, expectedVersion: record?.version ?? 0}})} onClose={() => {setEditingId(null); setCreatingId(null);}} />}
      <CoverageForm key={profile.summary.coverage.version} coverage={profile.summary.coverage} disabled={disabled} onSave={coverage => save({url: `${base}/coverage`, body: {...coverage, expectedVersion: profile.summary.coverage.version}})} />
      <section className="surface space-y-3 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><h4 className="font-semibold">Histórico de revisões</h4><button type="button" className={buttonClass} onClick={() => void loadAudit()} disabled={auditLoading}>{auditLoading ? 'Consultando…' : 'Consultar revisões'}</button></div>
        <p className="text-sm text-slate-600 dark:text-slate-300">As revisões e as evidências de identidade são privadas. São exibidas até as 100 alterações mais recentes.</p>
        {auditError && <p role="alert">{auditError}</p>}
        {audit?.length === 0 && <p>Nenhuma revisão registrada.</p>}
        {audit && <ol className="space-y-2">{audit.map(item => <li key={item.id} className="border-t border-slate-200 pt-3 text-sm dark:border-slate-700"><p>{dateLabel(item.createdAt)} · {item.recordId ? 'Alteração de registro' : 'Alteração da cobertura'}</p><details className="mt-1"><summary className="cursor-pointer py-2 font-medium">Ver revisão</summary><p className="break-words">{String(item.after?.title ?? item.after?.scope ?? 'Cobertura de pesquisa')}</p><p>Situação anterior: {String(item.before?.verification ?? item.before?.status ?? 'Cadastro inicial')}</p><p>Situação registrada: {String(item.after?.verification ?? item.after?.status ?? 'Atualização')}</p>{item.after?.reviewNote && <p className="mt-2 break-words">{String(item.after.reviewNote)}</p>}</details></li>)}</ol>}
      </section>
    </>}
  </div>;
}

const RecordForm: React.FC<{record?: JudicialAdminRecord; disabled: boolean; onSave: (value: JudicialRecordInput) => Promise<void>; onClose: () => void}> = ({record, disabled, onSave, onClose}) => {
  const [form, setForm] = useState<JudicialRecordInput>(() => record ? {...record} : newRecord());
  const [confirmedReview, setConfirmedReview] = useState(false);
  const set = <K extends keyof JudicialRecordInput>(key: K, value: JudicialRecordInput[K]) => setForm(current => ({...current, [key]: value}));
  const field = (key: 'caseNumber' | 'court' | 'title' | 'description' | 'grounds' | 'outcome' | 'sourceUrl' | 'sourceLabel' | 'identityEvidence' | 'reviewNote', label: string, required = true, minLength?: number, multiline = false) => <label className="min-w-0 text-sm font-medium">{label}{multiline ? <textarea className={inputClass} value={form[key]} onChange={event => set(key, event.target.value)} rows={3} required={required} minLength={minLength} maxLength={5000} /> : <input className={inputClass} type={key === 'sourceUrl' ? 'url' : 'text'} value={form[key]} onChange={event => set(key, event.target.value)} required={required} minLength={minLength} maxLength={key === 'sourceUrl' ? 2000 : 500} />}</label>;
  return <form className="surface space-y-4 p-4 sm:p-5" onSubmit={event => {event.preventDefault(); if (!disabled) void onSave(form);}}>
    <h4 className="font-semibold">{record ? 'Editar evidência' : 'Nova evidência'}</h4>
    <fieldset disabled={disabled} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Tipo de registro<select className={inputClass} value={form.kind} disabled={Boolean(record)} onChange={event => {
        const prison = event.target.value === 'IMPRISONMENT';
        setForm(current => ({...current, kind: prison ? 'IMPRISONMENT' : 'CONVICTION', category: 'CRIMINAL', convictionStatus: prison ? null : 'APPEAL', finalityDate: null, custodyType: prison ? 'PREVENTIVE' : null, custodyConfirmed: false, releasedAt: null, grounds: ''}));
      }}><option value="CONVICTION">Condenação</option><option value="IMPRISONMENT">Prisão</option></select></label>
        <label className="text-sm font-medium">Categoria<select className={inputClass} value={form.category} disabled={form.kind === 'IMPRISONMENT'} onChange={event => set('category', event.target.value as JudicialRecordInput['category'])}>{Object.entries(judicialCategories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {field('caseNumber', 'Número do caso ou processo')}{field('court', 'Tribunal ou órgão responsável')}
      </div>
      {field('title', 'Título objetivo do registro', true, 5)}
      <p className="text-xs text-slate-600 dark:text-slate-300">Descreva o que a fonte comprova. Em prisão cautelar, identifique o fato investigado como investigação.</p>
      <div className="grid gap-4 sm:grid-cols-2">{field('description', form.kind === 'IMPRISONMENT' ? 'Motivo e fato investigado' : 'Conduta reconhecida na decisão', true, 10, true)}{field('outcome', 'Desfecho e situação atual', false, undefined, true)}</div>
      <div className="grid gap-4 sm:grid-cols-2"><label className="min-w-0 text-sm font-medium">{form.kind === 'IMPRISONMENT' ? 'Data da prisão' : 'Data da decisão'}<input type="date" required className={inputClass} value={form.eventDate} onChange={event => set('eventDate', event.target.value)} /></label>
        {form.kind === 'CONVICTION' ? <><label className="text-sm font-medium">Situação da condenação<select className={inputClass} value={form.convictionStatus ?? 'APPEAL'} onChange={event => {set('convictionStatus', event.target.value as JudicialRecordInput['convictionStatus']); if (event.target.value !== 'FINAL') set('finalityDate', null);}}>{Object.entries(convictionStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          {form.convictionStatus === 'FINAL' && <label className="min-w-0 text-sm font-medium">Data do trânsito em julgado<input type="date" className={inputClass} required min={form.eventDate} value={form.finalityDate ?? ''} onChange={event => set('finalityDate', event.target.value || null)} /></label>}</> : <>
          <label className="text-sm font-medium">Modalidade da prisão<select className={inputClass} value={form.custodyType ?? 'PREVENTIVE'} onChange={event => set('custodyType', event.target.value as JudicialRecordInput['custodyType'])}>{Object.entries(custodyTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="min-w-0 text-sm font-medium">Data da soltura (se confirmada)<input type="date" className={inputClass} min={form.eventDate} value={form.releasedAt ?? ''} onChange={event => set('releasedAt', event.target.value || null)} /></label>
          {field('grounds', 'Fundamento da prisão', true, 10, true)}
        </>}
      </div>
      {form.kind === 'IMPRISONMENT' && <label className="flex items-start gap-3 py-2 text-sm"><input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={form.custodyConfirmed} onChange={event => set('custodyConfirmed', event.target.checked)} required={form.verification === 'VERIFIED'} />Cumprimento da prisão comprovado na fonte</label>}
      <div className="grid gap-4 sm:grid-cols-2">{field('sourceLabel', 'Nome da fonte oficial', true, 3)}{field('sourceUrl', 'Link do documento oficial')}</div>
      <p className="text-xs text-slate-600 dark:text-slate-300">Use documento público em domínio oficial do Judiciário, governo, Ministério Público ou Legislativo. Um mandado pendente não comprova prisão efetiva.</p>
      <div className="grid gap-4 sm:grid-cols-2">{field('identityEvidence', 'Evidência de identidade (privada)', form.verification === 'VERIFIED', form.verification === 'VERIFIED' ? 20 : undefined, true)}{field('reviewNote', 'Nota desta revisão (privada)', form.verification === 'VERIFIED', form.verification === 'VERIFIED' ? 10 : undefined, true)}</div>
      <p className="text-xs text-slate-600 dark:text-slate-300">Explique como a fonte vincula o registro à pessoa; apenas coincidência de nome não basta. Evite copiar dados pessoais desnecessários.</p>
      <label className="block text-sm font-medium">Publicação<select className={inputClass} value={form.verification} onChange={event => {set('verification', event.target.value as 'DRAFT' | 'VERIFIED'); setConfirmedReview(false);}}><option value="DRAFT">Rascunho — não aparece ao público</option><option value="VERIFIED">Revisado — aparece ao público</option></select></label>
      {record?.verification === 'VERIFIED' && form.verification === 'DRAFT' && <p className="text-sm">Ao salvar como rascunho, este registro sairá do perfil público e das contagens. A revisão será preservada.</p>}
      {form.verification === 'VERIFIED' && <label className="flex items-start gap-3 py-2 text-sm"><input type="checkbox" required className="mt-1 h-5 w-5 shrink-0" checked={confirmedReview} onChange={event => setConfirmedReview(event.target.checked)} />Conferi identidade, fonte oficial e situação atual desta decisão ou prisão.</label>}
      <div className="flex flex-wrap gap-3"><button type="submit" className={`${buttonClass} bg-blue-700 text-white hover:bg-blue-800`}>Salvar registro</button><button type="button" className={buttonClass} onClick={onClose}>Fechar edição</button></div>
    </fieldset>
  </form>;
}

const CoverageForm: React.FC<{coverage: JudicialCoverage; disabled: boolean; onSave: (coverage: Pick<JudicialCoverage, 'status' | 'scope' | 'sources'>) => Promise<void>}> = ({coverage, disabled, onSave}) => {
  const [status, setStatus] = useState(coverage.status);
  const [scope, setScope] = useState(coverage.scope);
  const [sources, setSources] = useState(coverage.sources);
  return <form className="surface space-y-4 p-4 sm:p-5" onSubmit={event => {event.preventDefault(); if (!disabled) void onSave({status, scope, sources: sources.filter(source => source.url.trim())});}}>
    <h4 className="font-semibold">Cobertura da pesquisa</h4>
    <p className="text-sm text-slate-600 dark:text-slate-300">Declare quais fontes, períodos e categorias foram pesquisados. Pesquisa revisada não significa cobertura de toda a vida da pessoa. Última conferência: {dateLabel(coverage.checkedAt)}.</p>
    <fieldset disabled={disabled} className="space-y-4"><label className="block text-sm font-medium">Situação da pesquisa<select className={inputClass} value={status} onChange={event => setStatus(event.target.value as JudicialCoverage['status'])}><option value="NOT_RESEARCHED">Ainda não pesquisado</option><option value="PARTIAL">Pesquisa parcial</option><option value="REVIEWED">Pesquisa revisada no escopo descrito</option></select></label>
      <label className="block text-sm font-medium">Fontes, período e categorias cobertos<textarea className={inputClass} value={scope} onChange={event => setScope(event.target.value)} rows={3} required={status !== 'NOT_RESEARCHED'} minLength={status !== 'NOT_RESEARCHED' ? 10 : undefined} maxLength={5000} /></label>
      {sources.map((source, index) => <div key={index} className="grid items-end gap-3 sm:grid-cols-[1fr_2fr_auto]"><label className="min-w-0 text-sm font-medium">Nome da fonte {index + 1}<input className={inputClass} value={source.label} required minLength={3} maxLength={200} onChange={event => setSources(current => current.map((item, position) => position === index ? {...item, label: event.target.value} : item))} /></label><label className="min-w-0 text-sm font-medium">Link da fonte {index + 1}<input type="url" className={inputClass} value={source.url} required maxLength={2000} onChange={event => setSources(current => current.map((item, position) => position === index ? {...item, url: event.target.value} : item))} /></label><button type="button" className={buttonClass} onClick={() => setSources(current => current.filter((_, position) => position !== index))} aria-label={`Remover fonte ${index + 1}`}>Remover</button></div>)}
      <div className="flex flex-wrap gap-3"><button type="button" className={buttonClass} disabled={sources.length >= 10} onClick={() => setSources(current => [...current, {label: '', url: ''}])}>Adicionar fonte consultada</button><button type="submit" className={buttonClass}>Salvar cobertura</button></div>
    </fieldset>
  </form>;
}
