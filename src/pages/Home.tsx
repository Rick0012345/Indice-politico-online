import React, {useEffect, useState} from 'react';
import {Search, Star, TrendingUp, TrendingDown, ChevronRight, Sparkles} from 'lucide-react';
import {Link} from 'react-router-dom';
import {cn} from '../lib/utils';
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
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 transition-all hover:-translate-y-1 hover:shadow-lg"
    >
      <div className="flex items-center gap-4">
        <div className="relative h-16 w-16 overflow-hidden rounded-full border-2 border-slate-100">
          <img
            src={politico.foto}
            alt={politico.nome}
            className="h-full w-full object-cover"
            referrerPolicy="no-referrer"
          />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="break-words font-bold text-slate-900 transition-colors group-hover:text-blue-600">
            {politico.nome}
          </h3>
          <p className="truncate text-xs text-slate-500">
            {politico.partido} / {politico.estado}
          </p>
          <div className="mt-1 flex items-center gap-1">
            <Star size={14} className="fill-yellow-400 text-yellow-400" />
            <span className="text-sm font-bold text-slate-700">{politico.notaMedia.toFixed(1)}</span>
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
            type === 'best' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600',
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
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 transition-all hover:-translate-y-1 hover:shadow-lg"
    >
      <div className="flex items-center gap-4">
        <div className="relative h-16 w-16 overflow-hidden rounded-full border-2 border-slate-100">
          <img
            src={politico.foto}
            alt={politico.nome}
            className="h-full w-full object-cover"
            referrerPolicy="no-referrer"
          />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="break-words font-bold text-slate-900 transition-colors">{politico.nome}</h3>
          <p className="truncate text-xs text-slate-500">
            {politico.partido} / {politico.estado}
          </p>
          <div className="mt-1 flex items-center gap-1">
            <Star size={14} className="fill-yellow-400 text-yellow-400" />
            <span className="text-sm font-bold text-slate-700">{politico.notaMedia.toFixed(1)}</span>
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
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-blue-600">
          <Sparkles size={16} />
        </div>
      </div>
    </Link>
  );
};

export const Home = () => {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<PoliticoStatusFilter>('ativo');
  const [novosCadastrados, setNovosCadastrados] = useState<PoliticoCardModel[]>([]);
  const [bestPoliticos, setBestPoliticos] = useState<PoliticoCardModel[]>([]);
  const [worstPoliticos, setWorstPoliticos] = useState<PoliticoCardModel[]>([]);
  const [searchResults, setSearchResults] = useState<PoliticoCardModel[]>([]);
  const trimmedSearch = search.trim();
  const showSearchFeedback = trimmedSearch.length >= 2;
  const topSearchSuggestion = searchResults[0] ?? null;
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

    const run = async () => {
      try {
        const [bestRes, worstRes] = await Promise.all([
          fetch(`/api/politicos/ranking?filter=best&limit=4&status=${encodeURIComponent(status)}`, {
            signal: controller.signal,
          }),
          fetch(`/api/politicos/ranking?filter=worst&limit=4&status=${encodeURIComponent(status)}`, {
            signal: controller.signal,
          }),
        ]);

        if (bestRes.ok) {
          const data = (await bestRes.json()) as {items?: PoliticoCardModel[]};
          setBestPoliticos(
            (data.items ?? []).map((p) => ({
              ...p,
              foto: p.foto || `https://picsum.photos/seed/${p.id}/400/400`,
            })),
          );
        }

        if (worstRes.ok) {
          const data = (await worstRes.json()) as {items?: PoliticoCardModel[]};
          setWorstPoliticos(
            (data.items ?? []).map((p) => ({
              ...p,
              foto: p.foto || `https://picsum.photos/seed/${p.id}/400/400`,
            })),
          );
        }
      } catch {
      }
    };

    run();
    return () => controller.abort();
  }, [status]);

  useEffect(() => {
    const controller = new AbortController();

    const run = async () => {
      try {
        const response = await fetch(
          `/api/politicos/novos?limit=6&status=${encodeURIComponent(status)}`,
          {signal: controller.signal},
        );
        if (!response.ok) return;

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

        setNovosCadastrados(items);
      } catch {
      }
    };

    run();
    return () => controller.abort();
  }, [status]);

  useEffect(() => {
    const controller = new AbortController();

    const run = async () => {
      const q = trimmedSearch;
      if (q.length < 2) {
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
        if (!response.ok) return;

        const data = (await response.json()) as {items?: PoliticoCardModel[]};
        setSearchResults(
          (data.items ?? []).map((p) => ({
            ...p,
            foto: p.foto || `https://picsum.photos/seed/${p.id}/400/400`,
          })),
        );
      } catch {
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
    <div className="flex flex-col gap-16 pb-20">
      <section className="relative overflow-hidden bg-slate-50 py-12 sm:py-16">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(45rem_50rem_at_top,theme(colors.blue.100),theme(colors.white))] opacity-20" />
        <div className="mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
          <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-6xl">
            Transparencia que gera <span className="text-blue-600">mudanca</span>.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-slate-600">
            Acompanhe votos, gastos e o desempenho dos seus representantes. O poder da
            informacao em suas maos.
          </p>

          <div className="mt-10 flex flex-col items-center gap-4">
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
                  <div className="flex items-center gap-2 rounded-full bg-slate-900/5 px-2 py-1 text-xs font-semibold text-slate-600 ring-1 ring-inset ring-slate-200">
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
                className="block w-full rounded-2xl border-0 bg-white/95 py-4 pl-12 pr-5 text-slate-900 shadow-xl ring-1 ring-inset ring-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:pr-24 sm:text-sm sm:leading-6"
                placeholder="Busque por nome, partido ou estado"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleSearchKeyDown}
              />
            </div>

            {showSearchFeedback ? (
              <div className="w-full max-w-2xl text-left">
                {topSearchSuggestion ? (
                  <div className="overflow-hidden rounded-3xl border border-slate-200/80 bg-white/95 shadow-xl ring-1 ring-inset ring-white/70 backdrop-blur">
                    <button
                      type="button"
                      onClick={() => setSearch(topSearchSuggestion.nome)}
                      className="flex w-full items-center gap-4 border-b border-slate-200/80 px-4 py-4 text-left transition-colors hover:bg-slate-50"
                    >
                      <img
                        src={topSearchSuggestion.foto}
                        alt={topSearchSuggestion.nome}
                        className="h-14 w-14 rounded-2xl border border-slate-100 object-cover"
                        referrerPolicy="no-referrer"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-black uppercase tracking-[0.2em] text-blue-600">
                          Sugestao em tempo real
                        </p>
                        <p className="truncate text-base font-black text-slate-900 sm:text-lg">
                          {topSearchSuggestion.nome}
                        </p>
                        <p className="truncate text-sm text-slate-500">
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
                            className="flex min-w-0 max-w-full items-center gap-2 rounded-full bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-200"
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
                  <div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 text-sm font-medium text-slate-500 shadow-sm backdrop-blur">
                    Nenhum deputado encontrado para "{trimmedSearch}".
                  </div>
                )}
              </div>
            ) : null}

            <div className="flex flex-wrap justify-center gap-2">
              <span className="py-2 text-sm font-medium text-slate-500">Status:</span>
              {politicoStatusOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setStatus(option.value)}
                  className={cn(
                    'rounded-full px-4 py-1.5 text-xs font-semibold shadow-sm ring-1 ring-inset transition-colors',
                    status === option.value
                      ? 'bg-blue-600 text-white ring-blue-600'
                      : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {searchResults.length > 0 && (
        <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Search className="text-slate-600" />
              <h2 className="text-2xl font-bold text-slate-900">Resultados</h2>
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
              <h2 className="text-2xl font-bold text-slate-900">Novos cadastrados</h2>
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
                <h2 className="text-2xl font-bold text-slate-900">Mais bem avaliados</h2>
              </div>
              <Link
                to="/ranking"
                className="flex items-center gap-1 text-sm font-semibold text-blue-600 hover:underline"
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
                <h2 className="text-2xl font-bold text-slate-900">Piores da semana</h2>
              </div>
              <Link
                to="/ranking"
                className="flex items-center gap-1 text-sm font-semibold text-blue-600 hover:underline"
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
