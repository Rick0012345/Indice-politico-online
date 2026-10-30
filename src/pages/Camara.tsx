import React, {useEffect, useMemo, useState} from 'react';
import {CalendarDays, ExternalLink, FileText, Landmark, Search, Users} from 'lucide-react';
import {Link} from 'react-router-dom';
import {cn} from '../lib/utils';
import {useCatalogRefresh} from '../hooks/useCatalogRefresh';
import {useDebouncedValue} from '../hooks/useDebouncedValue';
import {fetchCatalogJson} from '../lib/catalogResource';

type TabId = 'proposicoes' | 'eventos' | 'orgaos' | 'frentes';

type ProposicaoItem = {
  id: string;
  siglaTipo: string | null;
  numero: number | null;
  ano: number | null;
  ementa: string | null;
  descricaoTipo: string | null;
  dataApresentacao: string | null;
  urlInteiroTeor: string | null;
  situacao: string | null;
  totalTemas: number;
  totalAutores: number;
  totalTramitacoes: number;
};

type EventoItem = {
  id: string;
  dataHoraInicio: string | null;
  situacao: string | null;
  descricaoTipo: string | null;
  descricao: string | null;
  localExterno: string | null;
  localCamara: {nome?: string; predio?: string; sala?: string} | null;
  orgaos: Array<{sigla?: string; nome?: string}> | null;
  urlRegistro: string | null;
};

type OrgaoItem = {
  id: string;
  sigla: string | null;
  nome: string | null;
  apelido: string | null;
  tipoOrgao: string | null;
  nomePublicacao: string | null;
  nomeResumido: string | null;
};

type FrenteItem = {
  id: string;
  titulo: string | null;
  idLegislatura: number | null;
  uri: string | null;
};

const tabs: Array<{id: TabId; label: string; icon: React.ComponentType<{size?: number; className?: string}>}> = [
  {id: 'proposicoes', label: 'Proposições', icon: FileText},
  {id: 'eventos', label: 'Eventos', icon: CalendarDays},
  {id: 'orgaos', label: 'Órgãos', icon: Landmark},
  {id: 'frentes', label: 'Frentes', icon: Users},
];

const formatDate = (value: string | null) => {
  if (!value) return 'Data indisponivel';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data indisponivel';
  return date.toLocaleDateString('pt-BR', {timeZone: 'UTC'});
};

const EmptyState = () => (
  <div className="rounded-2xl border border-dashed border-slate-300 px-6 py-14 text-center dark:border-slate-700">
    <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">Nenhum registro encontrado</p>
    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Ajuste a busca ou os filtros. Só aparecem dados já importados da Câmara.</p>
  </div>
);

const CardSkeleton = () => (
  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" aria-hidden="true">
    {[0, 1, 2, 3].map((key) => (
      <div key={key} className="surface space-y-3 p-5">
        <div className="skeleton h-4 w-32" />
        <div className="skeleton h-5 w-4/5" />
        <div className="skeleton h-4 w-3/5" />
        <div className="skeleton h-3 w-1/2" />
      </div>
    ))}
  </div>
);

const cardClass = 'surface lift-card group flex flex-col gap-3 p-5';
const tagClass = 'tabular inline-flex rounded-md bg-brand-50 px-2 py-0.5 font-mono text-xs font-semibold text-brand-800 dark:bg-brand-950 dark:text-brand-200';

export const Camara = () => {
  const [requestError, setRequestError] = useState('');
  const [activeTab, setActiveTab] = useState<TabId>('proposicoes');
  const [search, setSearch] = useState('');
  const querySearch = useDebouncedValue(search);
  const [year, setYear] = useState('');
  const [kind, setKind] = useState('');
  const [items, setItems] = useState<Array<ProposicaoItem | EventoItem | OrgaoItem | FrenteItem>>([]);
  const [isLoading, setIsLoading] = useState(false);

  const {revision, refreshing} = useCatalogRefresh(JSON.stringify([activeTab, querySearch, year, kind]), isLoading);

  useEffect(() => {
    const controller = new AbortController();
    setRequestError('');

    const run = async () => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams({limit: '120'});
        const trimmedSearch = querySearch.trim();
        const trimmedKind = kind.trim();
        if (trimmedSearch) params.set('search', trimmedSearch);
        if (trimmedKind) params.set(activeTab === 'frentes' ? 'legislatura' : 'tipo', trimmedKind);
        if (activeTab === 'proposicoes' && year.trim()) params.set('ano', year.trim());

        const data = await fetchCatalogJson<{items?: Array<ProposicaoItem | EventoItem | OrgaoItem | FrenteItem>}>(`/api/camara/${activeTab}?${params.toString()}`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setItems(data.items ?? []);
      } catch {
        if (controller.signal.aborted) return;
        setRequestError('Não foi possível carregar os dados. Tente novamente.');
        if (controller.signal.aborted) return;
        if (!refreshing) setItems([]);
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    };

    void run();
    return () => {
      controller.abort();
    };
  }, [activeTab, querySearch, year, kind, revision]);

  useEffect(() => {
    setItems([]);
    setSearch('');
    setYear('');
    setKind('');
  }, [activeTab]);

  const placeholder = useMemo(() => {
    if (activeTab === 'proposicoes') return 'Buscar por ementa, palavra-chave ou texto';
    if (activeTab === 'eventos') return 'Buscar por descricao, tipo ou local';
    if (activeTab === 'orgaos') return 'Buscar por sigla, nome ou apelido';
    return 'Buscar por titulo da frente';
  }, [activeTab]);

  return (
    <div className="mx-auto max-w-7xl px-4 pb-24 pt-10 sm:px-6 lg:px-8">
      {requestError && <p role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200">{requestError}</p>}
      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl dark:text-slate-50">Atuação parlamentar</h1>
        <p className="mt-2 max-w-3xl text-slate-600 dark:text-slate-400">
          O que está sendo proposto, discutido e organizado na Câmara, com link para o registro oficial.
        </p>
      </div>

      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div role="tablist" aria-label="Tipo de registro" className="no-scrollbar flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-2 whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium transition-colors',
                activeTab === tab.id
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-slate-50'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-50',
              )}
            >
              <tab.icon size={16} aria-hidden="true" />
              {tab.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(240px,1fr)_150px_110px] lg:min-w-[560px]">
          <label className="relative block">
            <span className="sr-only">Buscar</span>
            <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={placeholder}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-500 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-400"
            />
          </label>
          <label className="block">
            <span className="sr-only">{activeTab === 'frentes' ? 'Legislatura' : 'Tipo'}</span>
            <input
              value={kind}
              onChange={(event) => setKind(event.target.value)}
              placeholder={activeTab === 'frentes' ? 'Legislatura' : 'Tipo'}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-500 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-400"
            />
          </label>
          <label className="block">
            <span className="sr-only">Ano</span>
            <input
              value={year}
              disabled={activeTab !== 'proposicoes'}
              onChange={(event) => setYear(event.target.value)}
              placeholder="Ano"
              inputMode="numeric"
              className="tabular h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono text-sm text-slate-900 placeholder:text-slate-500 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:disabled:bg-slate-800/50"
            />
          </label>
        </div>
      </div>

      {isLoading && (!refreshing || items.length === 0) ? (
        <CardSkeleton />
      ) : requestError && items.length === 0 ? null : items.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {activeTab === 'proposicoes' &&
            (items as ProposicaoItem[]).map((item) => (
              <Link key={item.id} to={`/camara/proposicoes/${item.id}`} className={cardClass}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={tagClass}>{item.siglaTipo} {item.numero}/{item.ano}</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">{formatDate(item.dataApresentacao)}</span>
                </div>
                <h2 className="line-clamp-3 text-base font-semibold leading-snug text-slate-900 group-hover:text-brand-700 dark:text-slate-50 dark:group-hover:text-brand-300">{item.ementa || 'Proposição sem ementa'}</h2>
                <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-400">
                  <span className="flex items-center gap-1.5">
                    {item.situacao && <span aria-hidden="true" className="h-2 w-2 rounded-full bg-brand-500" />}
                    {item.situacao || 'Situação não informada'}
                  </span>
                  <span className="tabular font-mono">{item.totalAutores} autores · {item.totalTemas} temas · {item.totalTramitacoes} tramitações</span>
                </div>
              </Link>
            ))}

          {activeTab === 'eventos' &&
            (items as EventoItem[]).map((item) => (
              <article key={item.id} className={cardClass}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={tagClass}>{formatDate(item.dataHoraInicio)}</span>
                  {item.situacao && <span className="text-xs text-slate-500 dark:text-slate-400">{item.situacao}</span>}
                </div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-50">{item.descricaoTipo || 'Evento'}</h2>
                <p className="line-clamp-3 text-sm leading-6 text-slate-600 dark:text-slate-400">{item.descricao || 'Descrição indisponível'}</p>
                <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-400">
                  <span>{item.localExterno || item.localCamara?.nome || 'Local não informado'}</span>
                  {item.urlRegistro && <a href={item.urlRegistro} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline dark:text-brand-300">Registro oficial <ExternalLink size={13} /></a>}
                </div>
              </article>
            ))}

          {activeTab === 'orgaos' &&
            (items as OrgaoItem[]).map((item) => (
              <article key={item.id} className={cardClass}>
                <span className="text-xs text-slate-500 dark:text-slate-400">{item.tipoOrgao || 'Órgão'}</span>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">{item.sigla || item.nomeResumido || item.id}</h2>
                <p className="text-sm text-slate-600 dark:text-slate-400">{item.nome || item.nomePublicacao || item.apelido || 'Nome indisponível'}</p>
              </article>
            ))}

          {activeTab === 'frentes' &&
            (items as FrenteItem[]).map((item) => (
              <article key={item.id} className={cardClass}>
                <span className="text-xs text-slate-500 dark:text-slate-400">Legislatura {item.idLegislatura ?? '-'}</span>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-50">{item.titulo || 'Frente parlamentar'}</h2>
                {item.uri && <a href={item.uri} target="_blank" rel="noreferrer" className="mt-auto inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">Fonte oficial <ExternalLink size={13} /></a>}
              </article>
            ))}
        </div>
      )}
    </div>
  );
};
