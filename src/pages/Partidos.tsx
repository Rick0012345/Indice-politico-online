import React, {useEffect, useMemo, useState} from 'react';
import {Link} from 'react-router-dom';
import {Building2, ChevronRight, ExternalLink, Search, Star, Users, Vote, X} from 'lucide-react';
import {cn} from '../lib/utils';
import {useCatalogRefresh} from '../hooks/useCatalogRefresh';
import {useDebouncedValue} from '../hooks/useDebouncedValue';
import {fetchCatalogJson} from '../lib/catalogResource';
import {type PoliticoStatusFilter, politicoStatusOptions} from '../lib/politicoStatus';

type PartidoItem = {
  id: string | null;
  partido: string;
  nome: string;
  numeroEleitoral: number | null;
  logoUrl: string | null;
  websiteUrl: string | null;
  facebookUrl: string | null;
  totalPoliticos: number;
  totalAtivos: number;
  totalEstados: number;
  totalDespesas: number;
  totalVotacoes: number;
  notaMedia: number;
  totalAvaliacoes: number;
  atualizadoEm: string | null;
  partidoAtualizadoEm: string | null;
};

type PartidoPoliticoItem = {
  id: string;
  nome: string;
  partido: string;
  estado: string;
  foto: string | null;
  ativo?: boolean | null;
  situacao?: string | null;
  notaMedia: number;
  totalAvaliacoes: number;
  totalDespesas: number;
  totalVotacoes: number;
  cargo: string;
};

const sortOptions = [
  {value: 'partido', label: 'Sigla'},
  {value: 'nome', label: 'Nome'},
  {value: 'politicos', label: 'Parlamentares'},
  {value: 'despesas', label: 'Despesas'},
  {value: 'votacoes', label: 'Votacoes'},
  {value: 'nota', label: 'Nota'},
] as const;

const PartidoLogo: React.FC<{partido: PartidoItem}> = ({partido}) => {
  if (partido.logoUrl) {
    return (
      <img
        src={partido.logoUrl}
        alt={partido.nome}
        className="h-12 w-12 rounded-2xl border border-slate-200 bg-white object-contain p-1 dark:border-slate-700"
        referrerPolicy="no-referrer"
      />
    );
  }

  return (
    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-sm font-semibold text-blue-700 ring-1 ring-inset ring-blue-100 dark:bg-blue-950 dark:text-blue-300 dark:ring-blue-900">
      {partido.partido.slice(0, 4)}
    </div>
  );
};

const StatPill: React.FC<{icon: React.ReactNode; label: string; value: string}> = ({icon, label, value}) => (
  <div className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-800">
    <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
      {icon}
      <span>{label}</span>
    </div>
    <div className="mt-1 text-sm font-semibold tabular-nums font-mono text-slate-900 dark:text-slate-50">{value}</div>
  </div>
);

const PartidoCard: React.FC<{
  partido: PartidoItem;
  money: Intl.NumberFormat;
  isSelected: boolean;
  onSelect: (partido: PartidoItem) => void;
}> = ({partido, money, isSelected, onSelect}) => (
  <article
    role="button"
    tabIndex={0}
    onClick={() => onSelect(partido)}
    onKeyDown={(event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onSelect(partido);
      }
    }}
    className={cn(
      'w-full cursor-pointer rounded-2xl border bg-white p-4 text-left shadow-sm transition-colors hover:border-brand-200 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-200 dark:bg-slate-900 dark:hover:border-blue-900 dark:hover:bg-slate-800/60 dark:focus:ring-blue-900',
      isSelected
        ? 'border-blue-300 ring-2 ring-blue-100 dark:border-blue-700 dark:ring-blue-950'
        : 'border-slate-200 dark:border-slate-700',
    )}
  >
    <div className="flex items-start gap-3">
      <PartidoLogo partido={partido} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">{partido.partido}</h2>
          {partido.numeroEleitoral != null && (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold tabular-nums font-mono text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {partido.numeroEleitoral}
            </span>
          )}
        </div>
        <p className="mt-1 break-words text-sm font-medium text-slate-600 dark:text-slate-400">{partido.nome}</p>
      </div>
    </div>

    <div className="mt-4 grid grid-cols-2 gap-3">
      <StatPill icon={<Users size={14} />} label="Parlamentares" value={partido.totalPoliticos.toLocaleString('pt-BR')} />
      <StatPill icon={<Vote size={14} />} label="Votações" value={partido.totalVotacoes.toLocaleString('pt-BR')} />
      <StatPill icon={<Star size={14} />} label="Nota" value={partido.notaMedia.toFixed(1)} />
      <StatPill icon={<Building2 size={14} />} label="Despesas" value={money.format(partido.totalDespesas)} />
    </div>

    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
      <span className="font-semibold text-slate-500 dark:text-slate-400">
        {partido.totalAtivos.toLocaleString('pt-BR')} ativos em {partido.totalEstados.toLocaleString('pt-BR')} UFs
      </span>
      {partido.websiteUrl && (
        <a
          href={partido.websiteUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => event.stopPropagation()}
          className="inline-flex items-center gap-1 font-bold text-brand-700 hover:underline dark:text-brand-300"
        >
          Site <ExternalLink size={14} />
        </a>
      )}
    </div>
  </article>
);

const DeputadosDoPartido: React.FC<{
  partido: PartidoItem;
  deputados: PartidoPoliticoItem[];
  isLoading: boolean;
  error: string;
  money: Intl.NumberFormat;
  onClose: () => void;
}> = ({partido, deputados, isLoading, error, money, onClose}) => (
  <section className="mb-8 overflow-hidden rounded-2xl border border-blue-200 bg-white shadow-sm dark:border-blue-900 dark:bg-slate-900">
    <div className="flex flex-col gap-4 border-b border-slate-200 bg-blue-50 px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6 dark:border-slate-700 dark:bg-blue-950/40">
      <div className="flex items-center gap-3">
        <PartidoLogo partido={partido} />
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
            Deputados do {partido.partido}
          </h2>
          <p className="mt-1 text-sm font-medium text-slate-600 dark:text-slate-400">{partido.nome}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Fechar detalhes do partido"
        className="inline-flex h-10 w-10 items-center justify-center rounded-full text-slate-600 transition-colors hover:bg-white dark:text-slate-300 dark:hover:bg-slate-800"
      >
        <X size={20} />
      </button>
    </div>

    <div className="p-4 sm:p-6">
      {error && <p role="alert" className="mb-3 text-sm text-rose-700 dark:text-rose-400">{error}</p>}
      {isLoading && deputados.length === 0 ? (
        <div className="text-sm font-medium text-slate-500 dark:text-slate-400">Carregando deputados...</div>
      ) : error && deputados.length === 0 ? null : deputados.length === 0 ? (
        <div className="text-sm font-medium text-slate-500 dark:text-slate-400">
          Nenhum deputado encontrado para este partido com o filtro atual.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {deputados.map((deputado) => (
            <Link
              key={deputado.id}
              to={`/politico/${deputado.id}`}
              className="group rounded-2xl border border-slate-200 p-4 transition-colors hover:border-brand-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:border-blue-900 dark:hover:bg-slate-800/60"
            >
              <div className="flex items-start gap-3">
                <img
                  src={deputado.foto || `https://picsum.photos/seed/${deputado.id}/400/400`}
                  alt={deputado.nome}
                  className="h-14 w-14 rounded-2xl border border-slate-100 object-cover dark:border-slate-700"
                  referrerPolicy="no-referrer"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="break-words font-semibold text-slate-900 group-hover:text-brand-700 dark:text-slate-50 dark:group-hover:text-blue-400">
                        {deputado.nome}
                      </h3>
                      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        {deputado.partido} / {deputado.estado}
                      </p>
                    </div>
                    <ChevronRight size={18} className="mt-1 shrink-0 text-slate-400" />
                  </div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2">
                <div className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-800">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Nota</div>
                  <div className="mt-1 font-semibold tabular-nums font-mono text-slate-900 dark:text-slate-50">
                    {deputado.notaMedia.toFixed(1)}
                  </div>
                </div>
                <div className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-800">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Votos</div>
                  <div className="mt-1 font-semibold tabular-nums font-mono text-slate-900 dark:text-slate-50">
                    {deputado.totalVotacoes.toLocaleString('pt-BR')}
                  </div>
                </div>
                <div className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-800">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Gastos</div>
                  <div className="mt-1 truncate text-xs font-semibold tabular-nums font-mono text-slate-900 dark:text-slate-50">
                    {money.format(deputado.totalDespesas)}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  </section>
);

export const Partidos = () => {
  const [requestError, setRequestError] = useState('');
  const [deputadosError, setDeputadosError] = useState('');
  const [items, setItems] = useState<PartidoItem[]>([]);
  const [selectedPartido, setSelectedPartido] = useState<PartidoItem | null>(null);
  const [deputados, setDeputados] = useState<PartidoPoliticoItem[]>([]);
  const [search, setSearch] = useState('');
  const querySearch = useDebouncedValue(search);
  const [status, setStatus] = useState<PoliticoStatusFilter>('ativo');
  const [sort, setSort] = useState<(typeof sortOptions)[number]['value']>('partido');
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc');
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingDeputados, setIsLoadingDeputados] = useState(false);

  const {revision, refreshing} = useCatalogRefresh(JSON.stringify([querySearch, status, sort, direction, selectedPartido?.partido]), isLoading || (Boolean(selectedPartido) && isLoadingDeputados));

  const money = useMemo(
    () =>
      new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        maximumFractionDigits: 2,
      }),
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    setRequestError('');

    const run = async () => {
      setIsLoading(true);

      try {
        const params = new URLSearchParams({
          limit: '500',
          status,
          sort,
          direction,
        });
        const trimmedSearch = querySearch.trim();
        if (trimmedSearch.length > 0) params.set('search', trimmedSearch);

        const data = await fetchCatalogJson<{items?: PartidoItem[]}>(`/api/partidos?${params.toString()}`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setItems(
          (data.items ?? []).filter(
            (item): item is PartidoItem =>
              typeof item.partido === 'string' &&
              typeof item.nome === 'string' &&
              typeof item.totalPoliticos === 'number' &&
              typeof item.totalDespesas === 'number',
          ),
        );
      } catch {
        if (!controller.signal.aborted) setRequestError('Não foi possível carregar os dados. Tente novamente.');
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    };

    void run();
    return () => {
      controller.abort();
    };
  }, [querySearch, status, sort, direction, revision]);

  useEffect(() => {
    if (!selectedPartido) {
      setDeputados([]);
      return;
    }

    const controller = new AbortController();
    setDeputadosError('');
    if (!refreshing) setDeputados([]);

    const run = async () => {
      setIsLoadingDeputados(true);

      try {
        const params = new URLSearchParams({
          limit: '500',
          status,
        });

        const data = await fetchCatalogJson<{items?: PartidoPoliticoItem[]}>(
          `/api/partidos/${encodeURIComponent(selectedPartido.partido)}/politicos?${params.toString()}`,
          {signal: controller.signal},
        );

        if (controller.signal.aborted) return;
        setDeputados(
          (data.items ?? []).filter(
            (item): item is PartidoPoliticoItem =>
              typeof item.id === 'string' &&
              typeof item.nome === 'string' &&
              typeof item.partido === 'string' &&
              typeof item.estado === 'string' &&
              typeof item.notaMedia === 'number',
          ),
        );
      } catch {
        if (!controller.signal.aborted) setDeputadosError('Não foi possível carregar os deputados do partido. Tente novamente.');
      } finally {
        if (!controller.signal.aborted) setIsLoadingDeputados(false);
      }
    };

    run();
    return () => controller.abort();
  }, [selectedPartido?.partido, status, revision]);

  useEffect(() => {
    if (!selectedPartido) return;
    const current = items.find((item) => item.partido === selectedPartido.partido);
    if (current && current !== selectedPartido) setSelectedPartido(current);
  }, [items, selectedPartido]);

  const totals = useMemo(
    () => ({
      partidos: items.length,
      politicos: items.reduce((sum, item) => sum + item.totalPoliticos, 0),
      despesas: items.reduce((sum, item) => sum + item.totalDespesas, 0),
      votacoes: items.reduce((sum, item) => sum + item.totalVotacoes, 0),
    }),
    [items],
  );

  const handleSelectPartido = (partido: PartidoItem) => {
    setSelectedPartido((current) => (current?.partido === partido.partido ? null : partido));
  };

  return (
    <div className="mx-auto max-w-7xl px-4 pb-24 pt-10 sm:px-6 lg:px-8">
      {requestError && <p role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200">{requestError}</p>}
      <div className="mb-10">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl dark:text-slate-50">Análise de partidos</h1>
        <p className="mt-4 max-w-3xl text-lg text-slate-600 dark:text-slate-400">
          Visualize todos os partidos cadastrados e compare suas informacoes oficiais com os dados agregados dos parlamentares.
        </p>
      </div>

      <section className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatPill icon={<Building2 size={16} />} label="Partidos" value={totals.partidos.toLocaleString('pt-BR')} />
        <StatPill icon={<Users size={16} />} label="Parlamentares" value={totals.politicos.toLocaleString('pt-BR')} />
        <StatPill icon={<Vote size={16} />} label="Votações" value={totals.votacoes.toLocaleString('pt-BR')} />
        <StatPill icon={<Building2 size={16} />} label="Despesas" value={money.format(totals.despesas)} />
      </section>

      <section className="mb-8 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(220px,1fr)_180px_180px_160px]">
          <label className="relative block">
            <Search
              size={18}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por sigla ou nome"
              className="w-full rounded-xl border-slate-200 pl-10 text-sm font-medium focus:ring-brand-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            />
          </label>

          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as PoliticoStatusFilter)}
            className="w-full rounded-xl border-slate-200 text-sm font-medium focus:ring-brand-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            {politicoStatusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as typeof sort)}
            className="w-full rounded-xl border-slate-200 text-sm font-medium focus:ring-brand-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <div className="flex rounded-2xl bg-slate-100 p-1 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setDirection('asc')}
              className={cn(
                'flex-1 rounded-xl px-4 py-2 text-sm font-bold transition-colors',
                direction === 'asc'
                  ? 'bg-white text-brand-700 shadow-sm dark:bg-slate-700'
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200',
              )}
            >
              A-Z
            </button>
            <button
              type="button"
              onClick={() => setDirection('desc')}
              className={cn(
                'flex-1 rounded-xl px-4 py-2 text-sm font-bold transition-colors',
                direction === 'desc'
                  ? 'bg-white text-brand-700 shadow-sm dark:bg-slate-700'
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200',
              )}
            >
              Z-A
            </button>
          </div>
        </div>
      </section>

      {selectedPartido && (
        <DeputadosDoPartido
          partido={selectedPartido}
          deputados={deputados}
          isLoading={isLoadingDeputados}
          error={deputadosError}
          money={money}
          onClose={() => setSelectedPartido(null)}
        />
      )}

      {isLoading && (!refreshing || items.length === 0) ? (
        <div className="rounded-2xl border border-slate-200/80 bg-white px-6 py-8 text-center text-sm font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          Carregando partidos...
        </div>
      ) : requestError && (!refreshing || items.length === 0) ? null : items.length === 0 ? (
        <div className="rounded-2xl border border-slate-200/80 bg-white px-6 py-8 text-center text-sm font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          Nenhum partido encontrado com esse filtro.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:hidden">
            {items.map((partido) => (
              <PartidoCard
                key={`${partido.partido}-${partido.id ?? 'sem-id'}`}
                partido={partido}
                money={money}
                isSelected={selectedPartido?.partido === partido.partido}
                onSelect={handleSelectPartido}
              />
            ))}
          </div>

          <div className="hidden overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm lg:block dark:border-slate-800 dark:bg-slate-900">
            <div className="overflow-x-auto">
              <table className="min-w-[980px] w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 dark:text-slate-400">Partido</th>
                    <th className="px-6 py-4 text-xs font-medium text-slate-500 dark:text-slate-400">Nome</th>
                    <th className="px-6 py-4 text-right text-xs font-medium text-slate-500 dark:text-slate-400">Número</th>
                    <th className="px-6 py-4 text-right text-xs font-medium text-slate-500 dark:text-slate-400">Parlamentares</th>
                    <th className="px-6 py-4 text-right text-xs font-medium text-slate-500 dark:text-slate-400">Nota</th>
                    <th className="px-6 py-4 text-right text-xs font-medium text-slate-500 dark:text-slate-400">Despesas</th>
                    <th className="px-6 py-4 text-right text-xs font-medium text-slate-500 dark:text-slate-400">Votações</th>
                    <th className="px-6 py-4 text-right text-xs font-medium text-slate-500 dark:text-slate-400">Site</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {items.map((partido) => (
                    <tr
                      key={`${partido.partido}-${partido.id ?? 'sem-id'}`}
                      className={cn(
                        'cursor-pointer hover:bg-slate-50/70 dark:hover:bg-slate-800/50',
                        selectedPartido?.partido === partido.partido && 'bg-blue-50/80 dark:bg-blue-950/30',
                      )}
                      onClick={() => handleSelectPartido(partido)}
                    >
                      <td className="px-6 py-5">
                        <button type="button" className="flex items-center gap-3 text-left">
                          <PartidoLogo partido={partido} />
                          <span className="font-semibold text-slate-900 dark:text-slate-50">{partido.partido}</span>
                          <ChevronRight
                            size={16}
                            className={cn(
                              'text-slate-400 transition-transform',
                              selectedPartido?.partido === partido.partido && 'rotate-90 text-blue-500',
                            )}
                          />
                        </button>
                      </td>
                      <td className="max-w-xs px-6 py-5 text-sm font-medium text-slate-700 dark:text-slate-300">
                        {partido.nome}
                      </td>
                      <td className="px-6 py-5 text-right text-sm tabular-nums font-mono text-slate-600 dark:text-slate-400">
                        {partido.numeroEleitoral ?? '-'}
                      </td>
                      <td className="px-6 py-5 text-right text-sm tabular-nums font-mono text-slate-600 dark:text-slate-400">
                        {partido.totalPoliticos.toLocaleString('pt-BR')}
                      </td>
                      <td className="px-6 py-5 text-right text-sm tabular-nums font-mono text-slate-600 dark:text-slate-400">
                        {partido.notaMedia.toFixed(1)}
                      </td>
                      <td className="px-6 py-5 text-right text-sm tabular-nums font-mono text-slate-600 dark:text-slate-400">
                        {money.format(partido.totalDespesas)}
                      </td>
                      <td className="px-6 py-5 text-right text-sm tabular-nums font-mono text-slate-600 dark:text-slate-400">
                        {partido.totalVotacoes.toLocaleString('pt-BR')}
                      </td>
                      <td className="px-6 py-5 text-right">
                        {partido.websiteUrl ? (
                          <a
                            href={partido.websiteUrl}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(event) => event.stopPropagation()}
                            className="inline-flex items-center gap-1 text-sm font-bold text-brand-700 hover:underline dark:text-brand-300"
                          >
                            Abrir <ExternalLink size={14} />
                          </a>
                        ) : (
                          <span className="text-sm text-slate-400 dark:text-slate-500">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
