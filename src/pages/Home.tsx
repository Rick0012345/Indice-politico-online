import React, {useEffect, useRef, useState} from 'react';
import {
  ArrowUpRight,
  ChevronRight,
  Landmark,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  TrendingDown,
  TrendingUp,
  Vote,
} from 'lucide-react';
import {Link} from 'react-router-dom';
import {cn} from '../lib/utils';
import {fetchCatalogJson} from '../lib/catalogResource';
import {catalogConnectionLabels, useCatalogUpdates} from '../hooks/useCatalogUpdates';
import {
  getPoliticoStatusClasses,
  getPoliticoStatusLabel,
  type PoliticoStatusFilter,
  politicoStatusOptions,
} from '../lib/politicoStatus';
import {BrazilTileMap, PanoramaStrip, PartySpendingBars} from '../components/home/HomePanels';

type PoliticoCardModel = {
  id: string;
  nome: string;
  partido: string;
  estado: string;
  foto: string;
  notaMedia: number;
  ativo?: boolean | null;
  situacao?: string | null;
};

const StatusBadge: React.FC<{politico: PoliticoCardModel}> = ({politico}) => (
  <span
    className={cn(
      'inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
      getPoliticoStatusClasses(politico),
    )}
  >
    {getPoliticoStatusLabel(politico)}
  </span>
);

const Avatar: React.FC<{politico: PoliticoCardModel; size?: 'sm' | 'md' | 'lg'}> = ({politico, size = 'md'}) => (
  <img
    src={politico.foto}
    alt={politico.nome}
    loading="lazy"
    referrerPolicy="no-referrer"
    className={cn(
      'shrink-0 rounded-full bg-slate-100 object-cover ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700',
      size === 'sm' && 'h-10 w-10',
      size === 'md' && 'h-12 w-12',
      size === 'lg' && 'h-16 w-16',
    )}
  />
);

/** Nota de 0 a 5 com barra proporcional (sem trilho de fundo). */
const NotaMeter: React.FC<{nota: number; tone: 'good' | 'bad' | 'neutral'}> = ({nota, tone}) => (
  <div className="flex w-24 flex-col items-end gap-1.5">
    <span className="tabular flex items-center gap-1 font-mono text-sm font-semibold text-slate-900 dark:text-slate-50">
      <Star size={12} className="fill-amber-400 text-amber-400" aria-hidden="true" />
      {nota.toFixed(1)}
    </span>
    <span
      aria-hidden="true"
      className={cn(
        'grow-bar h-1 rounded-full',
        tone === 'good' && 'bg-emerald-500',
        tone === 'bad' && 'bg-rose-500',
        tone === 'neutral' && 'bg-brand-500',
      )}
      style={{width: `${Math.max((nota / 5) * 100, 4)}%`}}
    />
  </div>
);

/** Linha ranqueada usada nos destaques (melhores / piores). */
const RankedRow: React.FC<{politico: PoliticoCardModel; rank: number; type: 'best' | 'worst'}> = ({
  politico,
  rank,
  type,
}) => (
  <li>
    <Link
      to={`/politico/${politico.id}`}
      className="group flex items-center gap-4 rounded-xl px-3 py-3 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
    >
      <span className="tabular w-5 text-center font-mono text-sm font-medium text-slate-400 dark:text-slate-500">{rank}</span>
      <Avatar politico={politico} />
      <div className="min-w-0 flex-1">
        <h3 className="truncate font-semibold text-slate-900 transition-colors group-hover:text-brand-700 dark:text-slate-50 dark:group-hover:text-brand-300">
          {politico.nome}
        </h3>
        <div className="mt-0.5 flex items-center gap-2">
          <span className="truncate text-xs text-slate-500 dark:text-slate-400">
            {politico.partido} / {politico.estado}
          </span>
          <StatusBadge politico={politico} />
        </div>
      </div>
      <NotaMeter nota={politico.notaMedia} tone={type === 'best' ? 'good' : 'bad'} />
    </Link>
  </li>
);

const PoliticoCard: React.FC<{politico: PoliticoCardModel}> = ({politico}) => (
  <Link
    to={`/politico/${politico.id}`}
    className="surface lift-card group flex items-center gap-4 p-4"
  >
    <Avatar politico={politico} size="lg" />
    <div className="min-w-0 flex-1">
      <h3 className="break-words font-semibold text-slate-900 group-hover:text-brand-700 dark:text-slate-50 dark:group-hover:text-brand-300">
        {politico.nome}
      </h3>
      <p className="truncate text-xs text-slate-500 dark:text-slate-400">
        {politico.partido} / {politico.estado}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <StatusBadge politico={politico} />
      </div>
    </div>
    <NotaMeter nota={politico.notaMedia} tone="neutral" />
  </Link>
);

const NovoPoliticoCard: React.FC<{politico: PoliticoCardModel}> = ({politico}) => (
  <Link
    to={`/politico/${politico.id}`}
    className="surface lift-card group flex w-[240px] shrink-0 snap-start flex-col gap-4 p-4 sm:w-[260px]"
  >
    <div className="flex items-center justify-between">
      <Avatar politico={politico} size="lg" />
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-300">
        <Sparkles size={15} />
      </span>
    </div>
    <div className="min-w-0">
      <h3 className="break-words font-semibold text-slate-900 dark:text-slate-50">{politico.nome}</h3>
      <p className="truncate text-xs text-slate-500 dark:text-slate-400">
        {politico.partido} / {politico.estado}
      </p>
    </div>
    <div className="mt-auto flex items-center justify-between">
      <StatusBadge politico={politico} />
      <span className="tabular flex items-center gap-1 font-mono text-sm font-semibold text-slate-700 dark:text-slate-300">
        <Star size={12} className="fill-amber-400 text-amber-400" aria-hidden="true" />
        {politico.notaMedia.toFixed(1)}
      </span>
    </div>
  </Link>
);

const RankedSkeleton = () => (
  <div className="space-y-1 px-3 py-2" aria-hidden="true">
    {[0, 1, 2, 3].map((key) => (
      <div key={key} className="flex items-center gap-4 py-2">
        <div className="skeleton h-4 w-4" />
        <div className="skeleton h-12 w-12 rounded-full" />
        <div className="flex-1 space-y-2">
          <div className="skeleton h-3 w-2/3" />
          <div className="skeleton h-2.5 w-1/3" />
        </div>
        <div className="skeleton h-4 w-12" />
      </div>
    ))}
  </div>
);

export const Home = () => {
  const reloaders = useRef<Record<string, (force?: boolean) => Promise<void>>>({});
  const requests = useRef<Record<string, Promise<void>>>({});
  const [requestErrors, setRequestErrors] = useState<Record<string, string>>({});
  const reportError = (area: string, message: string) => setRequestErrors(current => ({...current, [area]: message}));
  const [searchResultKey, setSearchResultKey] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<PoliticoStatusFilter>('ativo');
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const statusContext = useRef({status, generation: 0});
  if (statusContext.current.status !== status) {
    statusContext.current = {status, generation: statusContext.current.generation + 1};
  }
  const catalogConnection = useCatalogUpdates(async () => {
    const generation = statusContext.current.generation;
    await Promise.all(Object.values(requests.current));
    if (statusContext.current.generation !== generation) return;
    await Promise.all(Object.values<() => Promise<void>>(reloaders.current).map(reload => reload()));
  });
  const [novosCadastrados, setNovosCadastrados] = useState<PoliticoCardModel[]>([]);
  const [bestPoliticos, setBestPoliticos] = useState<PoliticoCardModel[]>([]);
  const [worstPoliticos, setWorstPoliticos] = useState<PoliticoCardModel[]>([]);
  const [searchResults, setSearchResults] = useState<PoliticoCardModel[]>([]);
  const trimmedSearch = search.trim();
  const showSearchFeedback = trimmedSearch.length >= 2;
  const searchKey = JSON.stringify([trimmedSearch, status]);
  const searchIsCurrent = searchResultKey === searchKey;
  const topSearchSuggestion = searchIsCurrent ? searchResults[0] ?? null : null;
  const secondarySearchSuggestions = searchResults.slice(1, 5);

  const inlineSearchCompletion =
    topSearchSuggestion &&
    showSearchFeedback &&
    topSearchSuggestion.nome.toLocaleLowerCase('pt-BR').startsWith(
      trimmedSearch.toLocaleLowerCase('pt-BR'),
    )
      ? topSearchSuggestion.nome.slice(trimmedSearch.length)
      : '';

  useEffect(() => {
    const controller = new AbortController();
    setBestPoliticos([]); setWorstPoliticos([]);
    setLoaded(current => ({...current, best: false, worst: false}));
    const run = async (kind: 'best' | 'worst', force = false) => {
      reportError(kind, '');
      setBusy(current => ({...current, [kind]: true}));
      try {
        const data = await fetchCatalogJson<{items?: PoliticoCardModel[]}>(`/api/politicos/ranking?view=cards&filter=${kind}&limit=4&status=${encodeURIComponent(status)}`, {signal: controller.signal, force});
        if (controller.signal.aborted) return;
        const setter = kind === 'best' ? setBestPoliticos : setWorstPoliticos;
        setter((data.items ?? []).map(p => ({...p, foto: p.foto || `https://picsum.photos/seed/${p.id}/400/400`})));
      } catch {
        if (!controller.signal.aborted) reportError(kind, `Não foi possível carregar ${kind === 'best' ? 'os mais bem avaliados' : 'os piores avaliados'}.`);
      } finally {
        if (!controller.signal.aborted) {
          setLoaded(current => ({...current, [kind]: true}));
          setBusy(current => ({...current, [kind]: false}));
        }
      }
    };
    for (const kind of ['best', 'worst'] as const) {
      const reload = (force = false) => {const request = run(kind, force); requests.current[kind] = request; return request;};
      reloaders.current[kind] = reload;
      void reload();
    }
    return () => {controller.abort(); for (const kind of ['best', 'worst']) {delete reloaders.current[kind]; delete requests.current[kind];}};
  }, [status]);

  useEffect(() => {
    const controller = new AbortController();
    reportError('novos', '');
    setLoaded(current => ({...current, novos: false}));
    setNovosCadastrados([]);

    const run = async (force = false) => {
      reportError('novos', '');
      try {
        const data = await fetchCatalogJson<{items?: Array<Partial<PoliticoCardModel>>}>(
          `/api/politicos/novos?limit=6&status=${encodeURIComponent(status)}`,
          {signal: controller.signal, force},
        );

        const items = (data.items ?? [])
          .filter((p): p is Omit<PoliticoCardModel, 'foto'> & {foto?: string | null} => {
            return (
              typeof p.id === 'string' &&
              typeof p.nome === 'string' &&
              typeof p.partido === 'string' &&
              typeof p.estado === 'string' &&
              typeof p.notaMedia === 'number'
            );
          })
          .map((p) => ({
            id: p.id,
            nome: p.nome,
            partido: p.partido,
            estado: p.estado,
            notaMedia: p.notaMedia,
            foto: p.foto || `https://picsum.photos/seed/${p.id}/400/400`,
            ativo: typeof p.ativo === 'boolean' ? p.ativo : null,
            situacao: typeof p.situacao === 'string' ? p.situacao : null,
          }));

        if (controller.signal.aborted) return;
        setNovosCadastrados(items);
      } catch {
        if (!controller.signal.aborted) reportError('novos', 'Não foi possível carregar os novos cadastros. Tente novamente.');
      } finally {
        if (!controller.signal.aborted) setLoaded(current => ({...current, novos: true}));
      }
    };

    const reload = (force = false) => { const request = run(force); requests.current.novos = request; return request; };
    reloaders.current.novos = reload;
    void reload();
    return () => { controller.abort(); delete reloaders.current.novos; };
  }, [status]);

  useEffect(() => {
    const controller = new AbortController();
    reportError('busca', '');
    setIsSearching(trimmedSearch.length >= 2);
    setSearchResults([]);

    const run = async () => {
      const q = trimmedSearch;
      if (q.length < 2) {
        if (controller.signal.aborted) return;
        setSearchResults([]);
        return;
      }

      try {
        const data = await fetchCatalogJson<{items?: PoliticoCardModel[]}>(
          `/api/politicos?search=${encodeURIComponent(q)}&limit=12&status=${encodeURIComponent(status)}`,
          {
            signal: controller.signal,
          },
        );
        if (controller.signal.aborted) return;
        setSearchResultKey(searchKey);
        setSearchResults(
          (data.items ?? []).map((p) => ({
            ...p,
            foto: p.foto || `https://picsum.photos/seed/${p.id}/400/400`,
          })),
        );
      } catch {
        if (!controller.signal.aborted) reportError('busca', 'Não foi possível carregar os resultados da busca. Tente novamente.');
      } finally {
        if (!controller.signal.aborted) setIsSearching(false);
      }
    };

    const timeoutId = setTimeout(run, 250);
    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [trimmedSearch, status]);

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const isCursorAtEnd =
      event.currentTarget.selectionStart === event.currentTarget.value.length &&
      event.currentTarget.selectionEnd === event.currentTarget.value.length;

    if (
      topSearchSuggestion &&
      inlineSearchCompletion &&
      isCursorAtEnd &&
      (event.key === 'Tab' || event.key === 'ArrowRight')
    ) {
      event.preventDefault();
      setSearch(topSearchSuggestion.nome);
    }
  };

  return (
    <div className="flex flex-col gap-16 pb-24">
      {Boolean(requestErrors.novos) ? (
        <div className="mx-auto w-full max-w-7xl space-y-2 px-4 pt-6 sm:px-6 lg:px-8">
          {Object.entries(requestErrors).filter(([area, message]) => area === 'novos' && Boolean(message)).map(([area, message]) => (
            <p key={area} role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200">
              {message}
              <button type="button" className="ml-3 underline" onClick={() => void reloaders.current[area]?.(true)}>Tentar novamente</button>
            </p>
          ))}
        </div>
      ) : null}

      {/* HERO: proposta de valor à esquerda, console de busca à direita */}
      <section className="relative overflow-hidden border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
        <div className="dot-grid pointer-events-none absolute inset-0" aria-hidden="true" />
        <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-[minmax(0,1fr)_440px] lg:px-8 lg:py-20">
          <div className="reveal-card">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
              <ShieldCheck size={14} className="text-brand-600 dark:text-brand-400" />
              Dados oficiais organizados para leitura cidadã
            </div>
            <h1 className="max-w-3xl text-4xl font-semibold leading-[1.05] tracking-tight text-slate-950 md:text-5xl lg:text-6xl dark:text-slate-50">
              Entenda políticos, votos e gastos sem decifrar planilhas públicas.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-slate-600 dark:text-slate-400">
              Busque um parlamentar, compare o ranking e acompanhe a atuação na Câmara com linguagem
              mais direta.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/ranking"
                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 active:scale-[0.98] dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
              >
                Ver ranking <ChevronRight size={16} />
              </Link>
              <Link
                to="/camara"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 active:scale-[0.98] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Projetos da Câmara
              </Link>
            </div>
          </div>

          <div className="surface reveal-card p-4 sm:p-5" style={{animationDelay: '120ms'}}>
            <div className="mb-3 flex items-center justify-between px-1">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">Comece por um nome</h2>
              <span className="hidden items-center gap-1 text-xs text-slate-500 sm:flex dark:text-slate-400">
                <span className="kbd">Tab</span> completa
              </span>
            </div>
            <div className="relative w-full">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                <Search className="h-5 w-5 text-slate-400" />
              </div>
              {inlineSearchCompletion ? (
                <div className="pointer-events-none absolute inset-0 flex items-center pl-12 pr-5 text-left sm:pr-24">
                  <span className="truncate text-sm text-slate-400 sm:text-base">
                    <span className="select-none text-transparent">{search}</span>
                    <span className="select-none">{inlineSearchCompletion}</span>
                  </span>
                </div>
              ) : null}
              {topSearchSuggestion ? (
                <div className="pointer-events-none absolute inset-y-0 right-0 hidden items-center pr-3 sm:flex">
                  <div className="flex items-center gap-2 rounded-full bg-slate-900/5 px-2 py-1 text-xs font-semibold text-slate-600 ring-1 ring-inset ring-slate-200 dark:bg-white/5 dark:text-slate-400 dark:ring-slate-700">
                    <img
                      src={topSearchSuggestion.foto}
                      alt={topSearchSuggestion.nome}
                      className="h-7 w-7 rounded-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                    <span className="hidden sm:inline">
                      {topSearchSuggestion.nome.split(' ')[0]}
                    </span>
                  </div>
                </div>
              ) : null}
              <label htmlFor="home-search" className="sr-only">
                Buscar parlamentar
              </label>
              <input
                id="home-search"
                type="text"
                autoComplete="off"
                className="block w-full rounded-xl border-0 bg-slate-50 py-4 pl-12 pr-5 text-slate-900 ring-1 ring-inset ring-slate-200 placeholder:text-slate-500 focus:bg-white focus:ring-2 focus:ring-inset focus:ring-brand-600 sm:pr-24 sm:text-sm sm:leading-6 dark:bg-slate-950 dark:text-slate-50 dark:ring-slate-700 dark:placeholder:text-slate-400"
                placeholder="Busque por nome, partido ou estado"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleSearchKeyDown}
              />
            </div>

            {showSearchFeedback ? (
              <div className="mt-3 w-full text-left">
                {isSearching || (!searchIsCurrent && !requestErrors.busca) ? (
                  <p role="status" className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600 dark:bg-slate-950 dark:text-slate-300">Buscando parlamentares...</p>
                ) : requestErrors.busca ? (
                  <p role="alert" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-800 dark:bg-rose-950/50 dark:text-rose-200">{requestErrors.busca}</p>
                ) : topSearchSuggestion ? (
                  <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
                    <Link
                      to={`/politico/${topSearchSuggestion.id}`}
                      className="flex w-full items-center gap-4 border-b border-slate-200 px-4 py-3.5 text-left transition-colors hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                    >
                      <img
                        src={topSearchSuggestion.foto}
                        alt={topSearchSuggestion.nome}
                        className="h-12 w-12 rounded-xl object-cover"
                        referrerPolicy="no-referrer"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-brand-700 dark:text-brand-300">Melhor correspondência</p>
                        <p className="truncate text-base font-semibold text-slate-900 dark:text-slate-50">
                          {topSearchSuggestion.nome}
                        </p>
                        <p className="truncate text-sm text-slate-500 dark:text-slate-400">
                          {topSearchSuggestion.partido} / {topSearchSuggestion.estado}
                          {inlineSearchCompletion ? ' - Tab completa o nome' : ''}
                        </p>
                      </div>
                      <ArrowUpRight className="h-5 w-5 text-slate-400" />
                    </Link>

                    {secondarySearchSuggestions.length > 0 ? (
                      <div className="flex flex-wrap gap-2 px-4 py-3">
                        {secondarySearchSuggestions.map((politico) => (
                          <button
                            key={politico.id}
                            type="button"
                            onClick={() => setSearch(politico.nome)}
                            className="flex min-w-0 max-w-full items-center gap-2 rounded-full bg-slate-100 py-1 pl-1 pr-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                          >
                            <img
                              src={politico.foto}
                              alt={politico.nome}
                              className="h-6 w-6 rounded-full object-cover"
                              referrerPolicy="no-referrer"
                            />
                            <span className="truncate">{politico.nome}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400">
                    Nenhum deputado encontrado para "{trimmedSearch}".
                  </div>
                )}
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Status</span>
              <div role="group" aria-label="Filtrar por status" className="flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
                {politicoStatusOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={status === option.value}
                    onClick={() => setStatus(option.value)}
                    className={cn(
                      'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                      status === option.value
                        ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-slate-50'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-50',
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PANORAMA */}
      <section className="mx-auto -mt-8 w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-3 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span
            aria-hidden="true"
            className={cn(
              'h-2 w-2 rounded-full',
              catalogConnection === 'live' ? 'bg-emerald-500' : catalogConnection === 'connecting' ? 'bg-amber-400' : 'bg-slate-400',
            )}
          />
          <p aria-live="polite">{catalogConnectionLabels[catalogConnection]}</p>
        </div>
        <PanoramaStrip />
      </section>

      {searchResults.length > 0 && (
        <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-5 flex items-baseline justify-between gap-4">
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">Resultados</h2>
            <span className="tabular font-mono text-sm text-slate-500 dark:text-slate-400">{searchResults.length} encontrados</span>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {searchResults.map((p) => (
              <PoliticoCard key={p.id} politico={p} />
            ))}
          </div>
        </section>
      )}

      {/* DESTAQUES */}
      <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {([
            {key: 'best', title: 'Mais bem avaliados', icon: TrendingUp, tone: 'text-emerald-600 dark:text-emerald-400', items: bestPoliticos},
            {key: 'worst', title: 'Piores da semana', icon: TrendingDown, tone: 'text-rose-600 dark:text-rose-400', items: worstPoliticos},
          ] as const).map((block) => (
            <div key={block.key} className="surface p-2 sm:p-3" aria-busy={Boolean(busy[block.key])}>
              <div className="flex items-center justify-between gap-3 px-3 pb-2 pt-3">
                <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-slate-50">
                  <block.icon size={18} className={block.tone} />
                  {block.title}
                </h2>
                <Link
                  to="/ranking"
                  className="flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline dark:text-brand-300"
                >
                  Ver ranking completo <ChevronRight size={16} />
                </Link>
              </div>
              {requestErrors[block.key] && <p role="alert" className="px-3 py-2 text-sm text-rose-700 dark:text-rose-300">{requestErrors[block.key]} <button type="button" disabled={busy[block.key]} className="underline disabled:opacity-50" onClick={() => void reloaders.current[block.key]?.(true)}>Tentar novamente</button></p>}
              {busy[block.key] && block.items.length > 0 && <p className="px-3 text-xs text-slate-500" aria-live="polite">Atualizando…</p>}
              {!loaded[block.key] && block.items.length === 0 ? (
                <RankedSkeleton />
              ) : block.items.length > 0 ? (
                <ol className="divide-y divide-slate-100 dark:divide-slate-800/70">
                  {block.items.map((p, index) => (
                    <RankedRow key={p.id} politico={p} rank={index + 1} type={block.key} />
                  ))}
                </ol>
              ) : !requestErrors[block.key] ? (
                <p className="px-3 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                  Ainda sem avaliações suficientes para este filtro.
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      {/* DINHEIRO PÚBLICO: mapa por UF + partidos */}
      <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-6 max-w-2xl">
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl dark:text-slate-50">
            Para onde vai a cota parlamentar
          </h2>
          <p className="mt-2 text-slate-600 dark:text-slate-400">
            Despesas registradas pelos deputados em exercício, por estado e por partido.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <BrazilTileMap />
          </div>
          <div className="lg:col-span-5">
            <PartySpendingBars />
          </div>
        </div>
      </section>

      {(!loaded.novos || novosCadastrados.length > 0) && (
        <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-5 flex items-center justify-between gap-4">
            <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
              <Sparkles size={20} className="text-brand-600 dark:text-brand-400" />
              Novos cadastrados
            </h2>
          </div>
          <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
            {!loaded.novos && novosCadastrados.length === 0 && <div className="grid w-full grid-cols-2 gap-4 sm:grid-cols-3" aria-label="Carregando novos cadastros" aria-busy="true">{[0,1,2].map(key => <div key={key} className="skeleton h-48" />)}</div>}
            {novosCadastrados.map((p) => (
              <NovoPoliticoCard key={p.id} politico={p} />
            ))}
          </div>
        </section>
      )}

      {/* EXPLORAR: bento assimétrico */}
      <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:grid-rows-2">
          <Link
            to="/ranking"
            className="lift-card group relative flex min-h-[240px] flex-col justify-between overflow-hidden rounded-2xl bg-slate-900 p-6 text-white md:col-span-2 md:row-span-2 dark:bg-slate-800"
          >
            <div className="dot-grid pointer-events-none absolute inset-0 opacity-40" aria-hidden="true" />
            <span className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-white/10">
              <TrendingUp size={20} />
            </span>
            <div className="relative">
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Comparar parlamentares</h2>
              <p className="mt-2 max-w-md text-slate-300">Veja notas, gastos e participação lado a lado.</p>
              <span className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-brand-300 group-hover:underline">
                Abrir ranking <ArrowUpRight size={15} />
              </span>
            </div>
          </Link>
          {[
            {to: '/camara', title: 'Projetos em discussão', desc: 'Explore proposições, eventos e frentes da Câmara.', icon: Landmark},
            {to: '/partidos', title: 'Analisar partidos', desc: 'Entenda gastos e composição por sigla.', icon: Vote},
          ].map((card) => (
            <Link key={card.to} to={card.to} className="surface lift-card group flex flex-col justify-between gap-6 p-5">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300">
                <card.icon size={20} />
              </span>
              <div>
                <h2 className="text-lg font-semibold text-slate-900 group-hover:text-brand-700 dark:text-slate-50 dark:group-hover:text-brand-300">
                  {card.title}
                </h2>
                <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-400">{card.desc}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
};
