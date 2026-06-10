import React, {useEffect, useMemo, useState} from 'react';
import {BarChart3, ChevronRight, Landmark, Search, Star, TrendingDown, TrendingUp, Users} from 'lucide-react';
import {Link} from 'react-router-dom';
import {cn} from '../lib/utils';
import {
  getPoliticoStatusClasses,
  getPoliticoStatusLabel,
  type PoliticoStatusFilter,
  politicoStatusOptions,
} from '../lib/politicoStatus';

type RankingView = 'parlamentares' | 'partidos';

type PoliticoRankingItem = {
  id: string;
  nome: string;
  partido: string;
  estado: string;
  cargo: string;
  foto: string;
  notaMedia: number;
  totalDespesas: number;
  totalVotacoes: number;
  ativo?: boolean | null;
  situacao?: string | null;
};

type PartidoGastosItem = {
  partido: string;
  totalDespesas: number;
  totalPoliticos: number;
};

const metricOptions = [
  {value: 'nota', label: 'Nota', description: 'média das avaliações populares'},
  {value: 'despesas', label: 'Gastos', description: 'total declarado na base'},
  {value: 'votacoes', label: 'Votações', description: 'registros de votação encontrados'},
] as const;

const getMetricValue = (politico: PoliticoRankingItem, metric: (typeof metricOptions)[number]['value']) => {
  if (metric === 'despesas') return politico.totalDespesas ?? 0;
  if (metric === 'votacoes') return politico.totalVotacoes ?? 0;
  return politico.notaMedia ?? 0;
};

const RankingMobileCard: React.FC<{
  politico: PoliticoRankingItem;
  index: number;
  metric: (typeof metricOptions)[number]['value'];
  money: Intl.NumberFormat;
}> = ({politico, index, metric, money}) => {
  const metricLabel =
    metric === 'despesas'
      ? money.format(politico.totalDespesas ?? 0)
      : metric === 'votacoes'
        ? `${(politico.totalVotacoes ?? 0).toLocaleString('pt-BR')} votações`
        : `${politico.notaMedia.toFixed(1)} de nota`;

  return (
    <Link
      to={`/politico/${politico.id}`}
      className="block reveal-card lift-card rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-blue-900"
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-black',
            index === 0
              ? 'bg-yellow-100 text-yellow-700'
              : index === 1
                ? 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                : index === 2
                  ? 'bg-orange-100 text-orange-700'
                  : 'bg-slate-50 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
          )}
        >
          {index + 1}
        </span>

        <img
          src={politico.foto}
          alt={politico.nome}
          className="h-12 w-12 shrink-0 rounded-xl border border-slate-100 object-cover dark:border-slate-700"
          referrerPolicy="no-referrer"
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="break-words font-bold text-slate-900 dark:text-slate-50">{politico.nome}</h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {politico.partido} / {politico.estado}
              </p>
              <p className="mt-1 text-xs font-medium uppercase text-slate-400 dark:text-slate-500">
                #{index + 1} por {metricLabel}
              </p>
            </div>

            <div className="shrink-0 rounded-xl bg-slate-50 px-3 py-2 text-center dark:bg-slate-800">
              <div className="flex items-center justify-center gap-1">
                <Star size={14} className="fill-yellow-400 text-yellow-400" />
                <span className="font-bold text-slate-900 dark:text-slate-50">{politico.notaMedia.toFixed(1)}</span>
              </div>
              <span className="text-[10px] font-bold uppercase text-slate-400 dark:text-slate-500">Nota</span>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <span
              className={cn(
                'inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ring-inset',
                getPoliticoStatusClasses(politico),
              )}
            >
              {getPoliticoStatusLabel(politico)}
            </span>
            <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {money.format(politico.totalDespesas ?? 0)}
            </span>
            <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {(politico.totalVotacoes ?? 0).toLocaleString('pt-BR')} votações
            </span>
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-end text-sm font-bold text-blue-600 dark:text-blue-400">
        Ver perfil <ChevronRight size={16} />
      </div>
    </Link>
  );
};

export const Ranking = () => {
  const [activeView, setActiveView] = useState<RankingView>('parlamentares');
  const [metric, setMetric] = useState<(typeof metricOptions)[number]['value']>('nota');
  const [direction, setDirection] = useState<'desc' | 'asc'>('desc');
  const [cargo, setCargo] = useState('Todos');
  const [status, setStatus] = useState<PoliticoStatusFilter>('ativo');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<PoliticoRankingItem[]>([]);
  const [partidos, setPartidos] = useState<PartidoGastosItem[]>([]);
  const [isLoadingPartidos, setIsLoadingPartidos] = useState(false);

  const money = useMemo(
    () =>
      new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        maximumFractionDigits: 2,
      }),
    [],
  );

  const selectedCargo = cargo === 'Todos' || cargo === 'Todos os Cargos' ? '' : cargo;
  const isUnsupportedCargo = Boolean(selectedCargo && selectedCargo !== 'Deputado Federal');

  useEffect(() => {
    const controller = new AbortController();

    const run = async () => {
      if (isUnsupportedCargo) {
        setItems([]);
        return;
      }

      try {
        const params = new URLSearchParams({
          metric,
          direction,
          limit: '1000',
          status,
        });

        const response = await fetch(`/api/politicos/ranking?${params.toString()}`, {
          signal: controller.signal,
        });

        if (!response.ok) return;

        const data = (await response.json()) as {items?: PoliticoRankingItem[]};
        setItems(
          (data.items ?? []).map((p) => ({
            ...p,
            foto: p.foto || `https://picsum.photos/seed/${p.id}/400/400`,
          })),
        );
      } catch {
      }
    };

    run();
    return () => controller.abort();
  }, [direction, isUnsupportedCargo, metric, status]);

  useEffect(() => {
    const controller = new AbortController();

    const run = async () => {
      if (isUnsupportedCargo) {
        setPartidos([]);
        return;
      }

      setIsLoadingPartidos(true);

      try {
        const params = new URLSearchParams({
          limit: '10',
          direction,
          status,
        });

        const response = await fetch(`/api/partidos/gastos?${params.toString()}`, {
          signal: controller.signal,
        });

        if (!response.ok) return;

        const data = (await response.json()) as {items?: PartidoGastosItem[]};
        setPartidos(
          (data.items ?? []).filter(
            (p): p is PartidoGastosItem =>
              typeof p.partido === 'string' &&
              typeof p.totalDespesas === 'number' &&
              typeof p.totalPoliticos === 'number',
          ),
        );
      } catch {
      } finally {
        setIsLoadingPartidos(false);
      }
    };

    run();
    return () => controller.abort();
  }, [direction, isUnsupportedCargo, status]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('pt-BR');
    const filtered = q
      ? items.filter((p) =>
          [p.nome, p.partido, p.estado, p.cargo].some((value) =>
            value.toLocaleLowerCase('pt-BR').includes(q),
          ),
        )
      : items;

    return [...filtered].sort((a, b) => {
      const diff = getMetricValue(a, metric) - getMetricValue(b, metric);
      return direction === 'asc' ? diff : -diff;
    });
  }, [direction, items, metric, search]);

  const filteredPartidos = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('pt-BR');
    return q ? partidos.filter((p) => p.partido.toLocaleLowerCase('pt-BR').includes(q)) : partidos;
  }, [partidos, search]);

  const rankingSummary = useMemo(() => {
    const totalDespesas = filteredItems.reduce((sum, item) => sum + Number(item.totalDespesas ?? 0), 0);
    const totalVotacoes = filteredItems.reduce((sum, item) => sum + Number(item.totalVotacoes ?? 0), 0);
    const notaMedia =
      filteredItems.length > 0
        ? filteredItems.reduce((sum, item) => sum + Number(item.notaMedia ?? 0), 0) / filteredItems.length
        : 0;

    return {
      totalParlamentares: filteredItems.length,
      notaMedia,
      totalDespesas,
      totalVotacoes,
    };
  }, [filteredItems]);

  const maxDespesaPartido = useMemo(() => {
    return filteredPartidos.length > 0 ? Math.max(0, ...filteredPartidos.map((p) => p.totalDespesas ?? 0)) : 0;
  }, [filteredPartidos]);

  const activeMetric = metricOptions.find((option) => option.value === metric) ?? metricOptions[0];
  const activeStatusLabel = politicoStatusOptions.find((option) => option.value === status)?.label ?? status;

  const summaryCards = [
    {
      label: 'Parlamentares',
      value: rankingSummary.totalParlamentares.toLocaleString('pt-BR'),
      hint: `${activeStatusLabel} no filtro atual`,
      icon: Users,
    },
    {
      label: 'Nota média',
      value: rankingSummary.notaMedia.toFixed(1),
      hint: 'média dos resultados visíveis',
      icon: Star,
    },
    {
      label: 'Despesas',
      value: money.format(rankingSummary.totalDespesas),
      hint: 'soma dos parlamentares listados',
      icon: BarChart3,
    },
    {
      label: 'Votações',
      value: rankingSummary.totalVotacoes.toLocaleString('pt-BR'),
      hint: 'registros encontrados na base',
      icon: Landmark,
    },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="mb-8 max-w-3xl">
        <div className="mb-3 text-xs font-black uppercase text-blue-600 dark:text-blue-400">
          Comparação pública
        </div>
        <h1 className="text-4xl font-extrabold text-slate-900 dark:text-slate-50">Ranking de transparência</h1>
        <p className="mt-4 text-lg leading-8 text-slate-600 dark:text-slate-400">
          Compare parlamentares e partidos por nota popular, gastos declarados e participação em votações.
          O ranking atual usa <strong>{activeMetric.description}</strong>, do{' '}
          {direction === 'desc' ? 'maior para o menor' : 'menor para o maior'}.
        </p>
      </div>

      <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1 dark:bg-slate-800 sm:w-fit">
            {[
              {id: 'parlamentares' as const, label: 'Parlamentares'},
              {id: 'partidos' as const, label: 'Partidos'},
            ].map((view) => (
              <button
                key={view.id}
                type="button"
                onClick={() => setActiveView(view.id)}
                className={cn(
                  'rounded-lg px-4 py-2 text-sm font-black transition',
                  activeView === view.id
                    ? 'bg-white text-blue-600 shadow-sm dark:bg-slate-700 dark:text-blue-300'
                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200',
                )}
              >
                {view.label}
              </button>
            ))}
          </div>

          <div className="grid gap-3 md:grid-cols-[minmax(220px,1fr)_auto] xl:w-[720px]">
            <label className="relative block">
              <Search
                size={18}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={activeView === 'partidos' ? 'Buscar partido' : 'Buscar por nome, partido, UF ou cargo'}
                className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-10 pr-3 text-sm font-medium text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-blue-950"
              />
            </label>

            {search.trim() && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-bold text-slate-600 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                Limpar
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_auto_auto] xl:items-end">
          <div>
            <div className="mb-2 text-xs font-black uppercase text-slate-500 dark:text-slate-400">
              Métrica
            </div>
            <div className="flex flex-wrap gap-2">
              {metricOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setMetric(option.value)}
                  disabled={activeView === 'partidos' && option.value !== 'despesas'}
                  className={cn(
                    'rounded-xl px-4 py-2 text-sm font-black ring-1 ring-inset transition disabled:cursor-not-allowed disabled:opacity-45',
                    metric === option.value
                      ? 'bg-blue-600 text-white ring-blue-600'
                      : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50 dark:bg-slate-950 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs font-black uppercase text-slate-500 dark:text-slate-400">
              Ordem
            </div>
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
              {[
                {value: 'desc' as const, label: 'Maior', icon: TrendingUp},
                {value: 'asc' as const, label: 'Menor', icon: TrendingDown},
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setDirection(option.value)}
                  className={cn(
                    'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-black transition',
                    direction === option.value
                      ? 'bg-white text-blue-600 shadow-sm dark:bg-slate-700 dark:text-blue-300'
                      : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200',
                  )}
                >
                  <option.icon size={16} />
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
            <label className="text-xs font-black uppercase text-slate-500 dark:text-slate-400">
              Cargo
              <select
                value={cargo}
                onChange={(event) => setCargo(event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium normal-case text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-blue-950"
              >
                <option>Todos os Cargos</option>
                <option>Deputado Federal</option>
                <option>Senador</option>
              </select>
            </label>

            <label className="text-xs font-black uppercase text-slate-500 dark:text-slate-400">
              Status
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as PoliticoStatusFilter)}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium normal-case text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-blue-950"
              >
                {politicoStatusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </section>

      {activeView === 'parlamentares' && (
        <section className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {summaryCards.map((card, index) => (
            <div
              key={card.label}
              className="reveal-card lift-card rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900"
              style={{animationDelay: `${index * 70}ms`}}
            >
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-300">
                <card.icon size={20} />
              </div>
              <div className="text-xs font-black uppercase text-slate-500 dark:text-slate-400">{card.label}</div>
              <div className="mt-2 text-2xl font-black text-slate-950 dark:text-slate-50">{card.value}</div>
              <div className="mt-1 text-sm leading-5 text-slate-500 dark:text-slate-400">{card.hint}</div>
            </div>
          ))}
        </section>
      )}

      {activeView === 'partidos' ? (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6 dark:border-slate-700 dark:bg-slate-800">
            <div>
              <h2 className="text-lg font-extrabold text-slate-900 dark:text-slate-50">
                {direction === 'desc' ? 'Partidos que mais gastam' : 'Partidos que menos gastam'}
              </h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                Total de despesas somadas por partido, considerando o status selecionado.
              </p>
            </div>
            <div className="text-sm font-semibold tabular-nums text-slate-500 dark:text-slate-400">
              {filteredPartidos.length.toLocaleString('pt-BR')} partidos
            </div>
          </div>

          <div className="px-4 py-6 sm:px-6">
            {isLoadingPartidos ? (
              <div className="text-sm font-medium text-slate-500 dark:text-slate-400">Carregando...</div>
            ) : filteredPartidos.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 px-6 py-10 text-center text-sm font-medium text-slate-500 dark:border-slate-700 dark:text-slate-400">
                Nenhum partido encontrado para os filtros atuais.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {filteredPartidos.map((p, index) => {
                  const pct =
                    maxDespesaPartido > 0
                      ? Math.max(0, Math.min(100, (p.totalDespesas / maxDespesaPartido) * 100))
                      : 0;

                  return (
                    <div
                      key={`${p.partido}-${index}`}
                      className="reveal-card lift-card rounded-2xl border border-slate-200 p-4 dark:border-slate-700"
                      style={{animationDelay: `${index * 55}ms`}}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          <span className="text-xs font-black tabular-nums text-slate-400 dark:text-slate-500">
                            #{index + 1}
                          </span>
                          <span className="text-base font-extrabold text-slate-900 dark:text-slate-50">
                            {p.partido}
                          </span>
                          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                            {p.totalPoliticos.toLocaleString('pt-BR')} parlamentares
                          </span>
                        </div>
                        <div className="text-sm font-extrabold tabular-nums text-slate-900 dark:text-slate-50">
                          {money.format(p.totalDespesas ?? 0)}
                        </div>
                      </div>

                      <div
                        className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700"
                        aria-hidden="true"
                      >
                        <div
                          className="data-bar h-full rounded-full bg-blue-600 transition-[width] duration-700 ease-out"
                          style={{width: `${pct}%`}}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
          {filteredItems.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <div className="text-base font-black text-slate-900 dark:text-slate-50">
                Nenhum parlamentar encontrado com esse filtro.
              </div>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500 dark:text-slate-400">
                {isUnsupportedCargo
                  ? 'No momento, a base local está populada com deputados federais. Troque o cargo para Deputado Federal ou Todos os Cargos.'
                  : 'Tente alterar a busca, o status, a métrica ou a ordem do ranking.'}
              </p>
              {isUnsupportedCargo && (
                <button
                  type="button"
                  onClick={() => setCargo('Deputado Federal')}
                  className="mt-5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-black text-white transition hover:bg-blue-700"
                >
                  Usar Deputado Federal
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="space-y-3 p-4 sm:p-6 lg:hidden">
                {filteredItems.map((p, index) => (
                  <RankingMobileCard key={p.id} politico={p} index={index} metric={metric} money={money} />
                ))}
              </div>

              <div className="hidden overflow-x-auto lg:block">
                <table className="min-w-[900px] w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
                      <th className="w-20 px-6 py-4 text-xs font-bold uppercase text-slate-500 dark:text-slate-400">
                        Posição
                      </th>
                      <th className="px-6 py-4 text-xs font-bold uppercase text-slate-500 dark:text-slate-400">
                        Político
                      </th>
                      <th className="px-6 py-4 text-xs font-bold uppercase text-slate-500 dark:text-slate-400">
                        Partido/UF
                      </th>
                      <th className="px-6 py-4 text-center text-xs font-bold uppercase text-slate-500 dark:text-slate-400">
                        Nota
                        <span className="block text-[10px] font-semibold normal-case text-slate-400">
                          avaliação popular
                        </span>
                      </th>
                      <th className="px-6 py-4 text-right text-xs font-bold uppercase text-slate-500 dark:text-slate-400">
                        Despesas
                        <span className="block text-[10px] font-semibold normal-case text-slate-400">
                          total declarado
                        </span>
                      </th>
                      <th className="px-6 py-4 text-right text-xs font-bold uppercase text-slate-500 dark:text-slate-400">
                        Votações
                        <span className="block text-[10px] font-semibold normal-case text-slate-400">
                          registros na base
                        </span>
                      </th>
                      <th className="px-6 py-4 text-right text-xs font-bold uppercase text-slate-500 dark:text-slate-400">
                        Ação
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {filteredItems.map((p, index) => (
                    <tr
                      key={p.id}
                      className="reveal-card group transition-colors hover:bg-slate-50/50 dark:hover:bg-slate-800/50"
                      style={{animationDelay: `${Math.min(index, 12) * 28}ms`}}
                    >
                        <td className="px-6 py-6">
                          <span
                            className={cn(
                              'flex h-8 w-8 items-center justify-center rounded-full text-sm font-black',
                              index === 0
                                ? 'bg-yellow-100 text-yellow-700'
                                : index === 1
                                  ? 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                                  : index === 2
                                    ? 'bg-orange-100 text-orange-700'
                                    : 'text-slate-400 dark:text-slate-500',
                            )}
                          >
                            {index + 1}
                          </span>
                        </td>
                        <td className="px-6 py-6">
                          <div className="flex items-center gap-3">
                            <img
                              src={p.foto}
                              alt={p.nome}
                              className="h-10 w-10 rounded-full border border-slate-100 object-cover dark:border-slate-700"
                              referrerPolicy="no-referrer"
                            />
                            <div>
                              <div className="font-bold text-slate-900 transition-colors group-hover:text-blue-600 dark:text-slate-50">
                                {p.nome}
                              </div>
                              <div className="mt-1 flex flex-wrap gap-2">
                                <span
                                  className={cn(
                                    'inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ring-inset',
                                    getPoliticoStatusClasses(p),
                                  )}
                                >
                                  {getPoliticoStatusLabel(p)}
                                </span>
                                <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                  {p.cargo}
                                </span>
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-6 text-sm text-slate-600 dark:text-slate-400">
                          {p.partido} / {p.estado}
                        </td>
                        <td className="px-6 py-6">
                          <div className="flex items-center justify-center gap-1">
                            <Star size={14} className="fill-yellow-400 text-yellow-400" />
                            <span className="font-bold text-slate-900 dark:text-slate-50">
                              {p.notaMedia.toFixed(1)}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-6 text-right text-sm tabular-nums text-slate-600 dark:text-slate-400">
                          {money.format(p.totalDespesas ?? 0)}
                        </td>
                        <td className="px-6 py-6 text-right text-sm tabular-nums text-slate-600 dark:text-slate-400">
                          {(p.totalVotacoes ?? 0).toLocaleString('pt-BR')}
                        </td>
                        <td className="px-6 py-6 text-right">
                          <Link
                            to={`/politico/${p.id}`}
                            className="inline-flex items-center gap-1 text-sm font-bold text-blue-600 hover:underline dark:text-blue-400"
                          >
                            Ver perfil <ChevronRight size={14} />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
