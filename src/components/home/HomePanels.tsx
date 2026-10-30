import React, {useEffect, useMemo, useState} from 'react';
import {Link} from 'react-router-dom';
import {ArrowUpRight, MapPinned, Wallet} from 'lucide-react';
import {cn} from '../../lib/utils';
import {fetchCatalogJson} from '../../lib/catalogResource';

/* ------------------------------------------------------------------ */
/* Formatadores                                                        */
/* ------------------------------------------------------------------ */

export const brlCompact = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
});

export const brlFull = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
});

export const intFormat = new Intl.NumberFormat('pt-BR');

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/* ------------------------------------------------------------------ */
/* Panorama: KPIs reais vindos de /api/politicos/ranking               */
/* ------------------------------------------------------------------ */

type Panorama = {total: number; totalCadastrados: number; totalDespesas: number};

export const PanoramaStrip: React.FC = () => {
  const [data, setData] = useState<Panorama | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const json = await fetchCatalogJson<Partial<Panorama>>('/api/politicos/ranking?view=summary&status=ativo', {signal: controller.signal});
        if (controller.signal.aborted) return;
        if (isFiniteNumber(json.total) && isFiniteNumber(json.totalDespesas)) {
          setData({
            total: json.total,
            totalCadastrados: isFiniteNumber(json.totalCadastrados) ? json.totalCadastrados : json.total,
            totalDespesas: json.totalDespesas,
          });
          setState('ready');
        } else {
          setState('error');
        }
      } catch {
        if (!controller.signal.aborted) setState('error');
      }
    })();
    return () => controller.abort();
  }, []);

  const kpis = [
    {
      label: 'Deputados em exercício',
      value: data ? intFormat.format(data.total) : null,
      hint: 'mandatos ativos monitorados',
    },
    {
      label: 'Perfis no catálogo',
      value: data ? intFormat.format(data.totalCadastrados) : null,
      hint: 'inclui quem saiu da ativa',
    },
    {
      label: 'Cota parlamentar registrada',
      value: data ? brlCompact.format(data.totalDespesas) : null,
      hint: 'soma das despesas dos ativos',
    },
    {
      label: 'Média por deputado',
      value: data && data.total > 0 ? brlCompact.format(data.totalDespesas / data.total) : null,
      hint: 'despesas registradas / mandato',
    },
  ];

  return (
    <div className="surface overflow-hidden">
      <div className="grid grid-cols-2 gap-px bg-slate-100 lg:grid-cols-4 dark:bg-slate-800">
      {kpis.map((kpi, index) => (
        <div
          key={kpi.label}
          className="reveal-card bg-white p-5 sm:p-6 dark:bg-slate-900"
          style={{animationDelay: `${index * 70}ms`}}
        >
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{kpi.label}</p>
          {state === 'loading' ? (
            <div className="skeleton mt-3 h-8 w-28" aria-hidden="true" />
          ) : (
            <p className="tabular mt-2 font-mono text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl dark:text-slate-50">
              {kpi.value ?? 'n/d'}
            </p>
          )}
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{kpi.hint}</p>
        </div>
      ))}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Mapa do Brasil em grade (tile map) por UF                           */
/* ------------------------------------------------------------------ */

const UF_TILES: Record<string, {r: number; c: number; nome: string}> = {
  RR: {r: 0, c: 2, nome: 'Roraima'},
  AP: {r: 0, c: 4, nome: 'Amapá'},
  AM: {r: 1, c: 1, nome: 'Amazonas'},
  PA: {r: 1, c: 3, nome: 'Pará'},
  MA: {r: 1, c: 4, nome: 'Maranhão'},
  CE: {r: 1, c: 5, nome: 'Ceará'},
  RN: {r: 1, c: 6, nome: 'Rio Grande do Norte'},
  AC: {r: 2, c: 0, nome: 'Acre'},
  RO: {r: 2, c: 1, nome: 'Rondônia'},
  MT: {r: 2, c: 2, nome: 'Mato Grosso'},
  TO: {r: 2, c: 3, nome: 'Tocantins'},
  PI: {r: 2, c: 4, nome: 'Piauí'},
  PE: {r: 2, c: 5, nome: 'Pernambuco'},
  PB: {r: 2, c: 6, nome: 'Paraíba'},
  MS: {r: 3, c: 2, nome: 'Mato Grosso do Sul'},
  GO: {r: 3, c: 3, nome: 'Goiás'},
  DF: {r: 3, c: 4, nome: 'Distrito Federal'},
  BA: {r: 3, c: 5, nome: 'Bahia'},
  AL: {r: 3, c: 6, nome: 'Alagoas'},
  PR: {r: 4, c: 2, nome: 'Paraná'},
  SP: {r: 4, c: 3, nome: 'São Paulo'},
  MG: {r: 4, c: 4, nome: 'Minas Gerais'},
  ES: {r: 4, c: 5, nome: 'Espírito Santo'},
  SE: {r: 4, c: 6, nome: 'Sergipe'},
  SC: {r: 5, c: 2, nome: 'Santa Catarina'},
  RJ: {r: 5, c: 4, nome: 'Rio de Janeiro'},
  RS: {r: 6, c: 2, nome: 'Rio Grande do Sul'},
};

type EstadoResumo = {uf: string; totalPoliticos: number; totalDespesas: number};
type MapMetric = 'media' | 'total' | 'bancada';

const metricLabels: Record<MapMetric, string> = {
  media: 'Gasto por deputado',
  total: 'Gasto total',
  bancada: 'Tamanho da bancada',
};

const SCALE = [
  'bg-brand-50 text-brand-900 dark:bg-brand-950 dark:text-brand-200',
  'bg-brand-100 text-brand-900 dark:bg-brand-900 dark:text-brand-100',
  'bg-brand-300 text-brand-950 dark:bg-brand-700 dark:text-white',
  'bg-brand-500 text-white dark:bg-brand-500 dark:text-white',
  'bg-brand-800 text-white dark:bg-brand-300 dark:text-brand-950',
];

const metricValue = (estado: EstadoResumo, metric: MapMetric) =>
  metric === 'media'
    ? estado.totalPoliticos > 0
      ? estado.totalDespesas / estado.totalPoliticos
      : 0
    : metric === 'total'
      ? estado.totalDespesas
      : estado.totalPoliticos;

const formatMetric = (value: number, metric: MapMetric) =>
  metric === 'bancada' ? `${intFormat.format(value)} dep.` : brlCompact.format(value);

export const BrazilTileMap: React.FC = () => {
  const [estados, setEstados] = useState<EstadoResumo[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [metric, setMetric] = useState<MapMetric>('media');
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const json = await fetchCatalogJson<{items?: Array<Partial<EstadoResumo>>}>('/api/estados/resumo?status=ativo', {signal: controller.signal});
        if (controller.signal.aborted) return;
        const items = (json.items ?? []).filter(
          (item): item is EstadoResumo =>
            typeof item.uf === 'string' &&
            item.uf.toUpperCase() in UF_TILES &&
            isFiniteNumber(item.totalPoliticos) &&
            isFiniteNumber(item.totalDespesas),
        );
        setEstados(items.map((item) => ({...item, uf: item.uf.toUpperCase()})));
        setState('ready');
      } catch {
        if (!controller.signal.aborted) setState('error');
      }
    })();
    return () => controller.abort();
  }, []);

  const byUf = useMemo(() => new Map(estados.map((estado) => [estado.uf, estado])), [estados]);

  const {sorted, bucketOf} = useMemo(() => {
    const values = estados.map((estado) => metricValue(estado, metric)).sort((a, b) => a - b);
    const bucket = (value: number) => {
      if (values.length === 0) return 0;
      const position = values.findIndex((candidate) => candidate >= value);
      const rank = position === -1 ? values.length - 1 : position;
      return Math.min(SCALE.length - 1, Math.floor((rank / Math.max(values.length, 1)) * SCALE.length));
    };
    const ordered = [...estados].sort((a, b) => metricValue(b, metric) - metricValue(a, metric));
    return {sorted: ordered, bucketOf: bucket};
  }, [estados, metric]);

  const activeUf = selected ?? sorted[0]?.uf ?? null;
  const active = activeUf ? byUf.get(activeUf) : undefined;
  const activeRank = active ? sorted.findIndex((estado) => estado.uf === active.uf) + 1 : 0;

  return (
    <div className="surface flex h-full flex-col p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-slate-50">
            <MapPinned size={18} className="text-brand-600 dark:text-brand-400" />
            Mapa da cota parlamentar
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Compare as bancadas de cada estado.</p>
        </div>
        <div role="group" aria-label="Métrica do mapa" className="flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
          {(Object.keys(metricLabels) as MapMetric[]).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={metric === key}
              onClick={() => setMetric(key)}
              className={cn(
                'rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors',
                metric === key
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-slate-50'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-50',
              )}
            >
              {metricLabels[key]}
            </button>
          ))}
        </div>
      </div>

      {state === 'error' || (state === 'ready' && estados.length === 0) ? (
        <div className="mt-6 flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 px-6 py-12 text-center dark:border-slate-700">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">Mapa indisponível no momento</p>
          <p className="mt-1 max-w-xs text-xs text-slate-500 dark:text-slate-400">
            Os dados por estado aparecem assim que a ingestão de despesas for concluída.
          </p>
        </div>
      ) : (
        <div className="mt-6 grid flex-1 grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_200px]">
          <div
            className="grid aspect-[7/7] w-full max-w-[440px] grid-cols-7 grid-rows-7 gap-1.5 justify-self-center"
            aria-label={`Mapa por estado: ${metricLabels[metric]}`}
          >
            {Object.entries(UF_TILES).map(([uf, tile]) => {
              const estado = byUf.get(uf);
              const isActive = uf === activeUf;
              if (state === 'loading') {
                return (
                  <div
                    key={uf}
                    aria-hidden="true"
                    className="skeleton rounded-lg"
                    style={{gridRow: tile.r + 1, gridColumn: tile.c + 1}}
                  />
                );
              }
              const value = estado ? metricValue(estado, metric) : 0;
              return (
                <button
                  key={uf}
                  type="button"
                  onMouseEnter={() => setSelected(uf)}
                  onFocus={() => setSelected(uf)}
                  onClick={() => setSelected(uf)}
                  aria-label={`${tile.nome}: ${estado ? formatMetric(value, metric) : 'sem dados'}`}
                  aria-pressed={isActive}
                  style={{gridRow: tile.r + 1, gridColumn: tile.c + 1}}
                  className={cn(
                    'flex items-center justify-center rounded-lg font-mono text-[11px] font-semibold transition-transform duration-200 sm:text-xs',
                    estado ? SCALE[bucketOf(value)] : 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500',
                    isActive && 'z-10 scale-110 ring-2 ring-slate-900 ring-offset-2 ring-offset-white dark:ring-white dark:ring-offset-slate-900',
                  )}
                >
                  {uf}
                </button>
              );
            })}
          </div>

          <div className="flex flex-col justify-between gap-4">
            {active ? (
              <div>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  {activeRank}º de {sorted.length} em {metricLabels[metric].toLocaleLowerCase('pt-BR')}
                </p>
                <p className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-50">{UF_TILES[active.uf].nome}</p>
                <dl className="mt-4 space-y-3 text-sm">
                  <div>
                    <dt className="text-xs text-slate-500 dark:text-slate-400">Bancada em exercício</dt>
                    <dd className="tabular font-mono font-semibold text-slate-900 dark:text-slate-50">
                      {intFormat.format(active.totalPoliticos)} deputados
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500 dark:text-slate-400">Gasto total registrado</dt>
                    <dd className="tabular font-mono font-semibold text-slate-900 dark:text-slate-50">
                      {brlFull.format(active.totalDespesas)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500 dark:text-slate-400">Média por deputado</dt>
                    <dd className="tabular font-mono font-semibold text-slate-900 dark:text-slate-50">
                      {brlFull.format(metricValue(active, 'media'))}
                    </dd>
                  </div>
                </dl>
              </div>
            ) : (
              <div className="space-y-2" aria-hidden="true">
                <div className="skeleton h-3 w-24" />
                <div className="skeleton h-6 w-32" />
                <div className="skeleton h-16 w-full" />
              </div>
            )}
            <div>
              <div className="flex gap-1" aria-hidden="true">
                {SCALE.map((tone) => (
                  <span key={tone} className={cn('h-2 flex-1 rounded-full', tone)} />
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[11px] text-slate-500 dark:text-slate-400">
                <span>menor</span>
                <span>maior</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Gastos por partido: barras ranqueadas                               */
/* ------------------------------------------------------------------ */

type PartidoGasto = {partido: string; totalDespesas: number; totalPoliticos: number};

export const PartySpendingBars: React.FC = () => {
  const [items, setItems] = useState<PartidoGasto[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [mode, setMode] = useState<'total' | 'media'>('total');

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const json = await fetchCatalogJson<{items?: Array<Partial<PartidoGasto>>}>('/api/partidos/gastos?limit=40&status=ativo', {signal: controller.signal});
        if (controller.signal.aborted) return;
        setItems(
          (json.items ?? []).filter(
            (item): item is PartidoGasto =>
              typeof item.partido === 'string' && isFiniteNumber(item.totalDespesas) && isFiniteNumber(item.totalPoliticos),
          ),
        );
        setState('ready');
      } catch {
        if (!controller.signal.aborted) setState('error');
      }
    })();
    return () => controller.abort();
  }, []);

  const rows = useMemo(() => {
    const value = (item: PartidoGasto) =>
      mode === 'total' ? item.totalDespesas : item.totalPoliticos > 0 ? item.totalDespesas / item.totalPoliticos : 0;
    const ordered = [...items].sort((a, b) => value(b) - value(a)).slice(0, 8);
    const max = Math.max(...ordered.map(value), 1);
    return ordered.map((item) => ({...item, value: value(item), ratio: value(item) / max}));
  }, [items, mode]);

  return (
    <div className="surface flex h-full flex-col p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-slate-50">
            <Wallet size={18} className="text-brand-600 dark:text-brand-400" />
            Gastos por partido
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">As 8 siglas que mais usam a cota.</p>
        </div>
        <div role="group" aria-label="Modo de comparação" className="flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
          {(['total', 'media'] as const).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={mode === key}
              onClick={() => setMode(key)}
              className={cn(
                'rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors',
                mode === key
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-slate-50'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-50',
              )}
            >
              {key === 'total' ? 'Total' : 'Por deputado'}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6 flex-1">
        {state === 'loading' ? (
          <div className="space-y-4" aria-hidden="true">
            {[0, 1, 2, 3, 4, 5].map((key) => (
              <div key={key} className="space-y-1.5">
                <div className="skeleton h-3 w-16" />
                <div className="skeleton h-2.5" style={{width: `${90 - key * 12}%`}} />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 px-6 py-12 text-center dark:border-slate-700">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">Sem despesas por partido ainda</p>
            <p className="mt-1 max-w-xs text-xs text-slate-500 dark:text-slate-400">Rode a ingestão de despesas no painel Admin.</p>
          </div>
        ) : (
          <ol className="space-y-3.5">
            {rows.map((row, index) => (
              <li key={row.partido}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="flex items-baseline gap-2">
                    <span className="tabular w-4 font-mono text-xs text-slate-400 dark:text-slate-500">{index + 1}</span>
                    <span className="font-semibold text-slate-900 dark:text-slate-50">{row.partido}</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">{row.totalPoliticos} dep.</span>
                  </span>
                  <span className="tabular font-mono text-xs font-medium text-slate-700 dark:text-slate-300">
                    {brlCompact.format(row.value)}
                  </span>
                </div>
                <div className="mt-1.5 pl-6">
                  <div
                    className={cn(
                      'grow-bar h-2 rounded-full',
                      index === 0 ? 'bg-brand-600 dark:bg-brand-400' : 'bg-brand-300 dark:bg-brand-700',
                    )}
                    style={{width: `${Math.max(row.ratio * 100, 2)}%`, animationDelay: `${index * 60}ms`}}
                  />
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      <Link
        to="/partidos"
        className="mt-6 inline-flex items-center gap-1 self-start text-sm font-medium text-brand-700 hover:underline dark:text-brand-300"
      >
        Análise completa dos partidos <ArrowUpRight size={14} />
      </Link>
    </div>
  );
};
