import React, {useEffect, useRef, useState} from 'react';
import {
  Search,
  Star,
  TrendingUp,
  TrendingDown,
  ChevronRight,
  Sparkles,
  Landmark,
  ShieldCheck,
  Vote,
} from 'lucide-react';
import {Link} from 'react-router-dom';
import {cn} from '../lib/utils';
import {catalogConnectionLabels, useCatalogUpdates} from '../hooks/useCatalogUpdates';
import {
  getPoliticoStatusClasses,
  getPoliticoStatusLabel,
  type PoliticoStatusFilter,
  politicoStatusOptions,
} from '../lib/politicoStatus';

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

const PoliticoCard: React.FC<{politico: PoliticoCardModel; type: 'best' | 'worst'}> = ({
  politico,
  type,
}) => {
  return (
    <Link
      to={`/politico/${politico.id}`}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 transition-colors hover:border-blue-200 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-blue-900 dark:hover:bg-slate-800/60"
    >
      <div className="flex items-center gap-4">
        <div className="relative h-16 w-16 overflow-hidden rounded-full border-2 border-slate-100 dark:border-slate-700">
          <img
            src={politico.foto}
            alt={politico.nome}
            className="h-full w-full object-cover"
            referrerPolicy="no-referrer"
          />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="break-words font-bold text-slate-900 transition-colors group-hover:text-blue-600 dark:text-slate-50">
            {politico.nome}
          </h3>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">
            {politico.partido} / {politico.estado}
          </p>
          <div className="mt-1 flex items-center gap-1">
            <Star size={14} className="fill-yellow-400 text-yellow-400" />
            <span className="text-sm font-bold text-slate-700 dark:text-slate-300">{politico.notaMedia.toFixed(1)}</span>
          </div>
          <span
            className={cn(
              'mt-2 inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ring-inset',
              getPoliticoStatusClasses(politico),
            )}
          >
            {getPoliticoStatusLabel(politico)}
          </span>
        </div>
        <div
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-full',
            type === 'best'
              ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400'
              : 'bg-rose-50 text-rose-600 dark:bg-rose-950 dark:text-rose-400',
          )}
        >
          {type === 'best' ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
        </div>
      </div>
    </Link>
  );
};

const NovoPoliticoCard: React.FC<{politico: PoliticoCardModel}> = ({politico}) => {
  return (
    <Link
      to={`/politico/${politico.id}`}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 transition-colors hover:border-blue-200 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-blue-900 dark:hover:bg-slate-800/60"
    >
      <div className="flex items-center gap-4">
        <div className="relative h-16 w-16 overflow-hidden rounded-full border-2 border-slate-100 dark:border-slate-700">
          <img
            src={politico.foto}
            alt={politico.nome}
            className="h-full w-full object-cover"
            referrerPolicy="no-referrer"
          />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="break-words font-bold text-slate-900 transition-colors dark:text-slate-50">{politico.nome}</h3>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">
            {politico.partido} / {politico.estado}
          </p>
          <div className="mt-1 flex items-center gap-1">
            <Star size={14} className="fill-yellow-400 text-yellow-400" />
            <span className="text-sm font-bold text-slate-700 dark:text-slate-300">{politico.notaMedia.toFixed(1)}</span>
          </div>
          <span
            className={cn(
              'mt-2 inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ring-inset',
              getPoliticoStatusClasses(politico),
            )}
          >
            {getPoliticoStatusLabel(politico)}
          </span>
        </div>
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
          <Sparkles size={16} />
        </div>
      </div>
    </Link>
  );
};

export const Home = () => {
  const reloaders = useRef<Record<string, () => Promise<void>>>({});
  const requests = useRef<Record<string, Promise<void>>>({});
  const [requestErrors, setRequestErrors] = useState<Record<string, string>>({});
  const reportError = (area: string, message: string) => setRequestErrors(current => ({...current, [area]: message}));
  const [searchResultKey, setSearchResultKey] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<PoliticoStatusFilter>('ativo');
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
    reportError('ranking', '');

    const run = async () => {
      reportError('ranking', '');
      try {
        const [bestRes, worstRes] = await Promise.all([
          fetch(`/api/politicos/ranking?filter=best&limit=4&status=${encodeURIComponent(status)}`, {
            signal: controller.signal,
          }),
          fetch(`/api/politicos/ranking?filter=worst&limit=4&status=${encodeURIComponent(status)}`, {
            signal: controller.signal,
          }),
        ]);

        if (!bestRes.ok || !worstRes.ok) throw new Error('HTTP');
        if (bestRes.ok) {
          const data = (await bestRes.json()) as {items?: PoliticoCardModel[]};
          if (controller.signal.aborted) return;
          setBestPoliticos(
            (data.items ?? []).map((p) => ({
              ...p,
              foto: p.foto || `https://picsum.photos/seed/${p.id}/400/400`,
            })),
          );
        }

        if (worstRes.ok) {
          const data = (await worstRes.json()) as {items?: PoliticoCardModel[]};
          if (controller.signal.aborted) return;
          setWorstPoliticos(
            (data.items ?? []).map((p) => ({
              ...p,
              foto: p.foto || `https://picsum.photos/seed/${p.id}/400/400`,
            })),
          );
        }
      } catch {
        if (!controller.signal.aborted) reportError('ranking', 'Não foi possível carregar o ranking. Tente novamente.');
      }
    };

    const reload = () => { const request = run(); requests.current.ranking = request; return request; };
    reloaders.current.ranking = reload;
    void reload();
    return () => { controller.abort(); delete reloaders.current.ranking; };
  }, [status]);

  useEffect(() => {
    const controller = new AbortController();
    reportError('novos', '');

    const run = async () => {
      reportError('novos', '');
      try {
        const response = await fetch(
          `/api/politicos/novos?limit=6&status=${encodeURIComponent(status)}`,
          {signal: controller.signal},
        );
        if (!response.ok) throw new Error('HTTP');

        const data = (await response.json()) as {items?: Array<Partial<PoliticoCardModel>>};

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
      }
    };

    const reload = () => { const request = run(); requests.current.novos = request; return request; };
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
        const response = await fetch(
          `/api/politicos?search=${encodeURIComponent(q)}&limit=12&status=${encodeURIComponent(status)}`,
          {
            signal: controller.signal,
          },
        );
        if (!response.ok) throw new Error('HTTP');

        const data = (await response.json()) as {items?: PoliticoCardModel[]};
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

  const discoveryCards = [
    {
      to: '/ranking',
      title: 'Comparar parlamentares',
      desc: 'Veja notas, gastos e participação lado a lado.',
      icon: TrendingUp,
    },
    {
      to: '/camara',
      title: 'Projetos em discussão',
      desc: 'Explore proposições, eventos e frentes da Câmara.',
      icon: Landmark,
    },
    {
      to: '/partidos',
      title: 'Analisar partidos',
      desc: 'Entenda gastos e composição por sigla.',
      icon: Vote,
    },
  ];

  return (
    <div className="flex flex-col gap-14 pb-20">
      {Object.entries(requestErrors).filter(([area, message]) => area !== 'busca' && Boolean(message)).map(([area, message]) => <p key={area} role="alert" className="mb-4 rounded-xl bg-rose-50 p-4 text-rose-800">{message}</p>)}
      <section className="relative overflow-hidden border-b border-slate-200 bg-white py-10 dark:border-slate-800 dark:bg-slate-950 sm:py-14">
        <div className="civic-mesh opacity-90 dark:opacity-70" aria-hidden="true">
          <span className="civic-node left-[18%] top-[24%]" />
          <span className="civic-node left-[70%] top-[18%]" />
          <span className="civic-node left-[58%] top-[72%]" />
        </div>
        <div className="relative mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:px-8">
          <div className="reveal-card">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-bold uppercase text-blue-700 ring-1 ring-inset ring-blue-100 dark:bg-blue-950 dark:text-blue-300 dark:ring-blue-900">
              <ShieldCheck size={14} />
              Dados oficiais organizados para leitura cidadã
            </div>
            <h1 className="max-w-4xl text-4xl font-extrabold tracking-tight text-slate-950 sm:text-6xl dark:text-slate-50">
              Entenda políticos, votos e gastos sem decifrar planilhas públicas.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600 dark:text-slate-400">
              Busque um parlamentar, compare o ranking e acompanhe a atuação na Câmara com linguagem
              mais direta.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/ranking"
                className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
              >
                Ver ranking <ChevronRight size={16} />
              </Link>
              <Link
                to="/camara"
                className="inline-flex items-center gap-2 rounded-2xl bg-slate-100 px-5 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                Projetos da Câmara
              </Link>
            </div>
          </div>

          <div className="reveal-card rounded-3xl border border-slate-200 bg-slate-50/90 p-4 shadow-xl shadow-slate-200/50 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90 dark:shadow-black/20">
            <div className="mb-3 px-1">
              <h2 className="text-sm font-black uppercase text-slate-500 dark:text-slate-400">
                Comece por um nome
              </h2>
            </div>
            <div className="relative w-full max-w-2xl">
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
              <input
                type="text"
                className="block w-full rounded-2xl border-0 bg-white/95 py-4 pl-12 pr-5 text-slate-900 shadow-xl ring-1 ring-inset ring-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:pr-24 sm:text-sm sm:leading-6 dark:bg-slate-900/95 dark:text-slate-50 dark:ring-slate-700 dark:placeholder:text-slate-500"
                placeholder="Busque por nome, partido ou estado"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleSearchKeyDown}
              />
            </div>

            {showSearchFeedback ? (
              <div className="w-full max-w-2xl text-left">
                {isSearching || (!searchIsCurrent && !requestErrors.busca) ? (
                  <p role="status" className="rounded-2xl bg-white p-4 text-sm text-slate-600 dark:bg-slate-900 dark:text-slate-300">Buscando parlamentares...</p>
                ) : requestErrors.busca ? (
                  <p role="alert" className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-800">{requestErrors.busca}</p>
                ) : topSearchSuggestion ? (
                  <div className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white/95 shadow-xl ring-1 ring-inset ring-white/70 backdrop-blur dark:border-slate-700/80 dark:bg-slate-900/95 dark:ring-slate-800/70">
                    <button
                      type="button"
                      onClick={() => setSearch(topSearchSuggestion.nome)}
                      className="flex w-full items-center gap-4 border-b border-slate-200/80 px-4 py-4 text-left transition-colors hover:bg-slate-50 dark:border-slate-700/80 dark:hover:bg-slate-800"
                    >
                      <img
                        src={topSearchSuggestion.foto}
                        alt={topSearchSuggestion.nome}
                        className="h-14 w-14 rounded-2xl border border-slate-100 object-cover dark:border-slate-700"
                        referrerPolicy="no-referrer"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-black uppercase tracking-[0.2em] text-blue-600">
                          Sugestão em tempo real
                        </p>
                        <p className="truncate text-base font-black text-slate-900 sm:text-lg dark:text-slate-50">
                          {topSearchSuggestion.nome}
                        </p>
                        <p className="truncate text-sm text-slate-500 dark:text-slate-400">
                          {topSearchSuggestion.partido} / {topSearchSuggestion.estado}
                          {inlineSearchCompletion ? ' - Tab completa o nome' : ''}
                        </p>
                      </div>
                      <ChevronRight className="h-5 w-5 text-slate-400" />
                    </button>

                    {secondarySearchSuggestions.length > 0 ? (
                      <div className="flex flex-wrap gap-2 px-4 py-4">
                        {secondarySearchSuggestions.map((politico) => (
                          <button
                            key={politico.id}
                            type="button"
                            onClick={() => setSearch(politico.nome)}
                            className="flex min-w-0 max-w-full items-center gap-2 rounded-full bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                          >
                            <img
                              src={politico.foto}
                              alt={politico.nome}
                              className="h-7 w-7 rounded-full object-cover"
                              referrerPolicy="no-referrer"
                            />
                            <span className="truncate">{politico.nome}</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 text-sm font-medium text-slate-500 shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-400">
                    Nenhum deputado encontrado para "{trimmedSearch}".
                  </div>
                )}
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              <span className="py-2 text-sm font-medium text-slate-500 dark:text-slate-400">Status:</span>
              {politicoStatusOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setStatus(option.value)}
                  className={cn(
                    'rounded-full px-4 py-1.5 text-xs font-semibold shadow-sm ring-1 ring-inset transition-colors',
                    status === option.value
                      ? 'bg-blue-600 text-white ring-blue-600'
                      : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-700',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <p aria-live="polite" className="mb-4 text-xs text-slate-500 dark:text-slate-400">{catalogConnectionLabels[catalogConnection]}</p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {discoveryCards.map((card, index) => (
            <Link
              key={card.to}
              to={card.to}
              className="group reveal-card lift-card rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-blue-900"
              style={{animationDelay: `${120 + index * 90}ms`}}
            >
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-300">
                <card.icon size={20} />
              </div>
              <h2 className="text-lg font-black text-slate-900 group-hover:text-blue-600 dark:text-slate-50 dark:group-hover:text-blue-400">
                {card.title}
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">{card.desc}</p>
            </Link>
          ))}
        </div>
      </section>

      {searchResults.length > 0 && (
        <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Search className="text-slate-600 dark:text-slate-400" />
              <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Resultados</h2>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {searchResults.map((p) => (
              <PoliticoCard key={p.id} politico={p} type="best" />
            ))}
          </div>
        </section>
      )}

      {novosCadastrados.length > 0 && (
        <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="text-blue-600" />
              <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Novos cadastrados</h2>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {novosCadastrados.map((p) => (
              <NovoPoliticoCard key={p.id} politico={p} />
            ))}
          </div>
        </section>
      )}

      <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-2">
          <div>
            <div className="mb-6 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className="text-emerald-600" />
                <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Mais bem avaliados</h2>
              </div>
              <Link
                to="/ranking"
                className="flex items-center gap-1 text-sm font-semibold text-blue-600 hover:underline dark:text-blue-400"
              >
                Ver ranking completo <ChevronRight size={16} />
              </Link>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {bestPoliticos.map((p) => (
                <PoliticoCard key={p.id} politico={p} type="best" />
              ))}
            </div>
          </div>

          <div>
            <div className="mb-6 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <TrendingDown className="text-rose-600" />
                <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Piores da semana</h2>
              </div>
              <Link
                to="/ranking"
                className="flex items-center gap-1 text-sm font-semibold text-blue-600 hover:underline dark:text-blue-400"
              >
                Ver ranking completo <ChevronRight size={16} />
              </Link>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {worstPoliticos.map((p) => (
                <PoliticoCard key={p.id} politico={p} type="worst" />
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
