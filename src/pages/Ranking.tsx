import React, {useEffect, useMemo, useState} from 'react';
import {Star, ChevronRight} from 'lucide-react';
import {Link} from 'react-router-dom';
import {cn} from '../lib/utils';
import {
  getPoliticoStatusClasses,
  getPoliticoStatusLabel,
  type PoliticoStatusFilter,
  politicoStatusOptions,
} from '../lib/politicoStatus';

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

const RankingMobileCard: React.FC<{
  politico: PoliticoRankingItem;
  index: number;
  money: Intl.NumberFormat;
}> = ({politico, index, money}) => {
  return (
    <Link
      to={`/politico/${politico.id}`}
      className="block rounded-3xl border border-slate-200 bg-white p-4 transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-sm sm:p-5"
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-black',
            index === 0
              ? 'bg-yellow-100 text-yellow-700'
              : index === 1
                ? 'bg-slate-100 text-slate-700'
                : index === 2
                  ? 'bg-orange-100 text-orange-700'
                  : 'bg-slate-50 text-slate-500',
          )}
        >
          {index + 1}
        </span>

        <img
          src={politico.foto}
          alt={politico.nome}
          className="h-12 w-12 shrink-0 rounded-2xl border border-slate-100 object-cover"
          referrerPolicy="no-referrer"
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="break-words font-bold text-slate-900">{politico.nome}</h3>
              <p className="mt-1 text-sm text-slate-500">
                {politico.partido} / {politico.estado}
              </p>
              <p className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-400">
                {politico.cargo}
              </p>
            </div>

            <div className="shrink-0 rounded-2xl bg-slate-50 px-3 py-2 text-center">
              <div className="flex items-center justify-center gap-1">
                <Star size={14} className="fill-yellow-400 text-yellow-400" />
                <span className="font-bold text-slate-900">{politico.notaMedia.toFixed(1)}</span>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Nota
              </span>
            </div>
          </div>

          <span
            className={cn(
              'mt-3 inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ring-inset',
              getPoliticoStatusClasses(politico),
            )}
          >
            {getPoliticoStatusLabel(politico)}
          </span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-slate-50 p-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
            Despesas
          </div>
          <div className="mt-1 text-sm font-bold text-slate-900">
            {money.format(politico.totalDespesas ?? 0)}
          </div>
        </div>
        <div className="rounded-2xl bg-slate-50 p-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
            Votacoes
          </div>
          <div className="mt-1 text-sm font-bold text-slate-900">
            {(politico.totalVotacoes ?? 0).toLocaleString('pt-BR')}
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-end text-sm font-bold text-blue-600">
        Ver perfil <ChevronRight size={16} />
      </div>
    </Link>
  );
};

export const Ranking = () => {
  const [metric, setMetric] = useState<'nota' | 'despesas' | 'votacoes'>('nota');
  const [direction, setDirection] = useState<'desc' | 'asc'>('desc');
  const [cargo, setCargo] = useState('Todos');
  const [status, setStatus] = useState<PoliticoStatusFilter>('ativo');
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

  useEffect(() => {
    const controller = new AbortController();

    const run = async () => {
      const selectedCargo = cargo === 'Todos' || cargo === 'Todos os Cargos' ? '' : cargo;

      if (selectedCargo && selectedCargo !== 'Deputado Federal') {
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
  }, [metric, direction, cargo, status]);

  useEffect(() => {
    const controller = new AbortController();

    const run = async () => {
      const selectedCargo = cargo === 'Todos' || cargo === 'Todos os Cargos' ? '' : cargo;

      if (selectedCargo && selectedCargo !== 'Deputado Federal') {
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
  }, [cargo, direction, status]);

  const maxDespesaPartido = useMemo(() => {
    return partidos.length > 0 ? Math.max(0, ...partidos.map((p) => p.totalDespesas ?? 0)) : 0;
  }, [partidos]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="mb-12 text-center">
        <h1 className="text-4xl font-extrabold text-slate-900">Ranking de Transparencia</h1>
        <p className="mt-4 text-lg text-slate-600">
          Veja quem sao os politicos mais bem avaliados pela populacao brasileira.
        </p>
      </div>

      <div className="mb-8 flex flex-col items-stretch gap-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm md:flex-row md:items-center md:justify-between">
        <div className="flex w-full rounded-2xl bg-slate-100 p-1 md:w-auto">
          <button
            onClick={() => setDirection('desc')}
            className={cn(
              'flex-1 rounded-xl px-6 py-2 text-sm font-bold transition-all md:flex-none',
              direction === 'desc'
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-slate-500 hover:text-slate-700',
            )}
          >
            Maior
          </button>
          <button
            onClick={() => setDirection('asc')}
            className={cn(
              'flex-1 rounded-xl px-6 py-2 text-sm font-bold transition-all md:flex-none',
              direction === 'asc'
                ? 'bg-white text-rose-600 shadow-sm'
                : 'text-slate-500 hover:text-slate-700',
            )}
          >
            Menor
          </button>
        </div>

        <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 md:flex md:w-auto md:flex-row md:gap-4">
          <select
            value={metric}
            onChange={(e) => setMetric(e.target.value as typeof metric)}
            className="w-full rounded-xl border-slate-200 text-sm font-medium focus:ring-blue-600 md:w-auto"
          >
            <option value="nota">Nota</option>
            <option value="despesas">Despesas</option>
            <option value="votacoes">Votacoes</option>
          </select>
          <select
            value={cargo}
            onChange={(e) => setCargo(e.target.value)}
            className="w-full rounded-xl border-slate-200 text-sm font-medium focus:ring-blue-600 md:w-auto"
          >
            <option>Todos os Cargos</option>
            <option>Deputado Federal</option>
            <option>Senador</option>
          </select>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as PoliticoStatusFilter)}
            className="w-full rounded-xl border-slate-200 text-sm font-medium focus:ring-blue-600 sm:col-span-2 md:w-auto"
          >
            {politicoStatusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <section className="mb-10 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <h2 className="text-lg font-extrabold text-slate-900">
              {direction === 'desc' ? 'Partidos que mais gastam' : 'Partidos que menos gastam'}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Total de despesas somadas por partido, considerando o status selecionado.
            </p>
          </div>
          <div className="text-sm font-semibold tabular-nums text-slate-500">
            Top {Math.max(0, partidos.length)}
          </div>
        </div>

        <div className="px-4 py-6 sm:px-6">
          {isLoadingPartidos ? (
            <div className="text-sm font-medium text-slate-500">Carregando...</div>
          ) : partidos.length === 0 ? (
            <div className="text-sm font-medium text-slate-500">Sem dados para exibir.</div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">
              {partidos.map((p, index) => {
                const pct =
                  maxDespesaPartido > 0
                    ? Math.max(0, Math.min(100, (p.totalDespesas / maxDespesaPartido) * 100))
                    : 0;

                return (
                  <div
                    key={`${p.partido}-${index}`}
                    className="rounded-2xl border border-slate-200 p-4"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="text-xs font-black tabular-nums text-slate-400">
                          #{index + 1}
                        </span>
                        <span className="text-base font-extrabold text-slate-900">{p.partido}</span>
                        <span className="text-xs font-semibold text-slate-500">
                          {p.totalPoliticos.toLocaleString('pt-BR')} parlamentares
                        </span>
                      </div>
                      <div className="text-sm font-extrabold tabular-nums text-slate-900">
                        {money.format(p.totalDespesas ?? 0)}
                      </div>
                    </div>

                    <div
                      className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100"
                      aria-hidden="true"
                    >
                      <div className="h-full rounded-full bg-blue-600" style={{width: `${pct}%`}} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        {items.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm font-medium text-slate-500">
            Nenhum politico encontrado com esse filtro.
          </div>
        ) : (
          <>
            <div className="space-y-3 p-4 sm:p-6 lg:hidden">
              {items.map((p, index) => (
                <RankingMobileCard key={p.id} politico={p} index={index} money={money} />
              ))}
            </div>

            <div className="hidden overflow-x-auto lg:block">
              <table className="min-w-[860px] w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="w-20 px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">
                      Posicao
                    </th>
                    <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">
                      Politico
                    </th>
                    <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">
                      Partido/UF
                    </th>
                    <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500">
                      Cargo
                    </th>
                    <th className="px-6 py-4 text-center text-xs font-bold uppercase tracking-wider text-slate-500">
                      Nota
                    </th>
                    <th className="px-6 py-4 text-right text-xs font-bold uppercase tracking-wider text-slate-500">
                      Despesas
                    </th>
                    <th className="px-6 py-4 text-right text-xs font-bold uppercase tracking-wider text-slate-500">
                      Votacoes
                    </th>
                    <th className="px-6 py-4 text-right text-xs font-bold uppercase tracking-wider text-slate-500">
                      Acao
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((p, index) => (
                    <tr key={p.id} className="group transition-colors hover:bg-slate-50/50">
                      <td className="px-6 py-6">
                        <span
                          className={cn(
                            'flex h-8 w-8 items-center justify-center rounded-full text-sm font-black',
                            index === 0
                              ? 'bg-yellow-100 text-yellow-700'
                              : index === 1
                                ? 'bg-slate-100 text-slate-700'
                                : index === 2
                                  ? 'bg-orange-100 text-orange-700'
                                  : 'text-slate-400',
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
                            className="h-10 w-10 rounded-full border border-slate-100 object-cover"
                            referrerPolicy="no-referrer"
                          />
                          <div>
                            <div className="font-bold text-slate-900 transition-colors group-hover:text-blue-600">
                              {p.nome}
                            </div>
                            <span
                              className={cn(
                                'mt-1 inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ring-inset',
                                getPoliticoStatusClasses(p),
                              )}
                            >
                              {getPoliticoStatusLabel(p)}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-6 text-sm text-slate-600">
                        {p.partido} / {p.estado}
                      </td>
                      <td className="px-6 py-6 text-sm text-slate-600">{p.cargo}</td>
                      <td className="px-6 py-6">
                        <div className="flex items-center justify-center gap-1">
                          <Star size={14} className="fill-yellow-400 text-yellow-400" />
                          <span className="font-bold text-slate-900">{p.notaMedia.toFixed(1)}</span>
                        </div>
                      </td>
                      <td className="px-6 py-6 text-right text-sm tabular-nums text-slate-600">
                        {money.format(p.totalDespesas ?? 0)}
                      </td>
                      <td className="px-6 py-6 text-right text-sm tabular-nums text-slate-600">
                        {(p.totalVotacoes ?? 0).toLocaleString('pt-BR')}
                      </td>
                      <td className="px-6 py-6 text-right">
                        <Link
                          to={`/politico/${p.id}`}
                          className="inline-flex items-center gap-1 text-sm font-bold text-blue-600 hover:underline"
                        >
                          Ver Perfil <ChevronRight size={14} />
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
    </div>
  );
};
