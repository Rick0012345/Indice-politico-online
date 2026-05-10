import React, {useEffect, useMemo, useState} from 'react';
import {Link} from 'react-router-dom';
import {Building2, ChevronRight, ExternalLink, Search, Star, Users, Vote, X} from 'lucide-react';
import {cn} from '../lib/utils';
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
    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-50 text-sm font-black text-blue-700 ring-1 ring-inset ring-blue-100 dark:bg-blue-950 dark:text-blue-300 dark:ring-blue-900">
      {partido.partido.slice(0, 4)}
    </div>
  );
};

const StatPill: React.FC<{icon: React.ReactNode; label: string; value: string}> = ({icon, label, value}) => (
  <div className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-800">
    <div className="flex items-center gap-2 text-xs font-bold uppercase text-slate-400 dark:text-slate-500">
      {icon}
      <span>{label}</span>
    </div>
    <div className="mt-1 text-sm font-extrabold tabular-nums text-slate-900 dark:text-slate-50">{value}</div>
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
      'w-full cursor-pointer rounded-3xl border bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-200 dark:bg-slate-900 dark:focus:ring-blue-900',
      isSelected
        ? 'border-blue-300 ring-2 ring-blue-100 dark:border-blue-700 dark:ring-blue-950'
        : 'border-slate-200 dark:border-slate-700',
    )}
  >
    <div className="flex items-start gap-3">
      <PartidoLogo partido={partido} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-extrabold text-slate-900 dark:text-slate-50">{partido.partido}</h2>
          {partido.numeroEleitoral != null && (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {partido.numeroEleitoral}
            </span>
          )}
        </div>
        <p className="mt-1 break-words text-sm font-medium text-slate-600 dark:text-slate-400">{partido.nome}</p>
      </div>
    </div>

    <div className="mt-4 grid grid-cols-2 gap-3">
      <StatPill icon={<Users size={14} />} label="Parlamentares" value={partido.totalPoliticos.toLocaleString('pt-BR')} />
      <StatPill icon={<Vote size={14} />} label="Votacoes" value={partido.totalVotacoes.toLocaleString('pt-BR')} />
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
          className="inline-flex items-center gap-1 font-bold text-blue-600 hover:underline dark:text-blue-400"
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
  money: Intl.NumberFormat;
  onClose: () => void;
}> = ({partido, deputados, isLoading, money, onClose}) => (
  <section className="mb-8 overflow-hidden rounded-3xl border border-blue-200 bg-white shadow-sm dark:border-blue-900 dark:bg-slate-900">
    <div className="flex flex-col gap-4 border-b border-slate-200 bg-blue-50 px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6 dark:border-slate-700 dark:bg-blue-950/40">
      <div className="flex items-center gap-3">
        <PartidoLogo partido={partido} />
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 dark:text-slate-50">
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
      {isLoading ? (
        <div className="text-sm font-medium text-slate-500 dark:text-slate-400">Carregando deputados...</div>
      ) : deputados.length === 0 ? (
        <div className="text-sm font-medium text-slate-500 dark:text-slate-400">
          Nenhum deputado encontrado para este partido com o filtro atual.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {deputados.map((deputado) => (
            <Link
              key={deputado.id}
              to={`/politico/${deputado.id}`}
              className="group rounded-2xl border border-slate-200 p-4 transition-all hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-sm dark:border-slate-700 dark:hover:border-blue-900"
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
                      <h3 className="break-words font-extrabold text-slate-900 group-hover:text-blue-600 dark:text-slate-50 dark:group-hover:text-blue-400">
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
                  <div className="text-[10px] font-bold uppercase text-slate-400 dark:text-slate-500">Nota</div>
                  <div className="mt-1 font-extrabold tabular-nums text-slate-900 dark:text-slate-50">
                    {deputado.notaMedia.toFixed(1)}
                  </div>
                </div>
                <div className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-800">
                  <div className="text-[10px] font-bold uppercase text-slate-400 dark:text-slate-500">Votos</div>
                  <div className="mt-1 font-extrabold tabular-nums text-slate-900 dark:text-slate-50">
                    {deputado.totalVotacoes.toLocaleString('pt-BR')}
                  </div>
                </div>
                <div className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-800">
                  <div className="text-[10px] font-bold uppercase text-slate-400 dark:text-slate-500">Gastos</div>
                  <div className="mt-1 truncate text-xs font-extrabold tabular-nums text-slate-900 dark:text-slate-50">
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
  const [items, setItems] = useState<PartidoItem[]>([]);
  const [selectedPartido, setSelectedPartido] = useState<PartidoItem | null>(null);
  const [deputados, setDeputados] = useState<PartidoPoliticoItem[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<PoliticoStatusFilter>('ativo');
  const [sort, setSort] = useState<(typeof sortOptions)[number]['value']>('partido');
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc');
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingDeputados, setIsLoadingDeputados] = useState(false);

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

    const run = async () => {
      setIsLoading(true);

      try {
        const params = new URLSearchParams({
          limit: '500',
          status,
          sort,
          direction,
        });
        const trimmedSearch = search.trim();
        if (trimmedSearch.length > 0) params.set('search', trimmedSearch);

        const response = await fetch(`/api/partidos?${params.toString()}`, {
          signal: controller.signal,
        });

        if (!response.ok) return;

        const data = (await response.json()) as {items?: PartidoItem[]};
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
      } finally {
        setIsLoading(false);
      }
    };

    const timeoutId = setTimeout(run, 250);
    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [search, status, sort, direction]);

  useEffect(() => {
    if (!selectedPartido) {
      setDeputados([]);
      return;
    }

    const controller = new AbortController();

    const run = async () => {
      setIsLoadingDeputados(true);

      try {
        const params = new URLSearchParams({
          limit: '500',
          status,
        });

        const response = await fetch(
          `/api/partidos/${encodeURIComponent(selectedPartido.partido)}/politicos?${params.toString()}`,
          {signal: controller.signal},
        );

        if (!response.ok) return;

        const data = (await response.json()) as {items?: PartidoPoliticoItem[]};
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
      } finally {
        setIsLoadingDeputados(false);
      }
    };

    run();
    return () => controller.abort();
  }, [selectedPartido, status]);

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
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="mb-10">
        <h1 className="text-4xl font-extrabold text-slate-900 dark:text-slate-50">Analise de Partidos</h1>
        <p className="mt-4 max-w-3xl text-lg text-slate-600 dark:text-slate-400">
          Visualize todos os partidos cadastrados e compare suas informacoes oficiais com os dados agregados dos parlamentares.
        </p>
      </div>

      <section className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatPill icon={<Building2 size={16} />} label="Partidos" value={totals.partidos.toLocaleString('pt-BR')} />
        <StatPill icon={<Users size={16} />} label="Parlamentares" value={totals.politicos.toLocaleString('pt-BR')} />
        <StatPill icon={<Vote size={16} />} label="Votacoes" value={totals.votacoes.toLocaleString('pt-BR')} />
        <StatPill icon={<Building2 size={16} />} label="Despesas" value={money.format(totals.despesas)} />
      </section>

      <section className="mb-8 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
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
              className="w-full rounded-xl border-slate-200 pl-10 text-sm font-medium focus:ring-blue-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            />
          </label>

          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as PoliticoStatusFilter)}
            className="w-full rounded-xl border-slate-200 text-sm font-medium focus:ring-blue-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
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
            className="w-full rounded-xl border-slate-200 text-sm font-medium focus:ring-blue-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
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
                'flex-1 rounded-xl px-4 py-2 text-sm font-bold transition-all',
                direction === 'asc'
                  ? 'bg-white text-blue-600 shadow-sm dark:bg-slate-700'
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200',
              )}
            >
              A-Z
            </button>
            <button
              type="button"
              onClick={() => setDirection('desc')}
              className={cn(
                'flex-1 rounded-xl px-4 py-2 text-sm font-bold transition-all',
                direction === 'desc'
                  ? 'bg-white text-blue-600 shadow-sm dark:bg-slate-700'
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
          money={money}
          onClose={() => setSelectedPartido(null)}
        />
      )}

      {isLoading ? (
        <div className="rounded-3xl border border-slate-200 bg-white px-6 py-8 text-center text-sm font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
          Carregando partidos...
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-3xl border border-slate-200 bg-white px-6 py-8 text-center text-sm font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
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

          <div className="hidden overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm lg:block dark:border-slate-700 dark:bg-slate-900">
            <div className="overflow-x-auto">
              <table className="min-w-[980px] w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                    <th className="px-6 py-4 text-xs font-bold uppercase text-slate-500 dark:text-slate-400">Partido</th>
                    <th className="px-6 py-4 text-xs font-bold uppercase text-slate-500 dark:text-slate-400">Nome</th>
                    <th className="px-6 py-4 text-right text-xs font-bold uppercase text-slate-500 dark:text-slate-400">Numero</th>
                    <th className="px-6 py-4 text-right text-xs font-bold uppercase text-slate-500 dark:text-slate-400">Parlamentares</th>
                    <th className="px-6 py-4 text-right text-xs font-bold uppercase text-slate-500 dark:text-slate-400">Nota</th>
                    <th className="px-6 py-4 text-right text-xs font-bold uppercase text-slate-500 dark:text-slate-400">Despesas</th>
                    <th className="px-6 py-4 text-right text-xs font-bold uppercase text-slate-500 dark:text-slate-400">Votacoes</th>
                    <th className="px-6 py-4 text-right text-xs font-bold uppercase text-slate-500 dark:text-slate-400">Site</th>
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
                          <span className="font-extrabold text-slate-900 dark:text-slate-50">{partido.partido}</span>
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
                      <td className="px-6 py-5 text-right text-sm tabular-nums text-slate-600 dark:text-slate-400">
                        {partido.numeroEleitoral ?? '-'}
                      </td>
                      <td className="px-6 py-5 text-right text-sm tabular-nums text-slate-600 dark:text-slate-400">
                        {partido.totalPoliticos.toLocaleString('pt-BR')}
                      </td>
                      <td className="px-6 py-5 text-right text-sm tabular-nums text-slate-600 dark:text-slate-400">
                        {partido.notaMedia.toFixed(1)}
                      </td>
                      <td className="px-6 py-5 text-right text-sm tabular-nums text-slate-600 dark:text-slate-400">
                        {money.format(partido.totalDespesas)}
                      </td>
                      <td className="px-6 py-5 text-right text-sm tabular-nums text-slate-600 dark:text-slate-400">
                        {partido.totalVotacoes.toLocaleString('pt-BR')}
                      </td>
                      <td className="px-6 py-5 text-right">
                        {partido.websiteUrl ? (
                          <a
                            href={partido.websiteUrl}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(event) => event.stopPropagation()}
                            className="inline-flex items-center gap-1 text-sm font-bold text-blue-600 hover:underline dark:text-blue-400"
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
