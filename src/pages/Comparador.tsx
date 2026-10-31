import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Link, useSearchParams} from 'react-router-dom';
import {ArrowLeft, Link2, Plus, Search, X} from 'lucide-react';
import {cn} from '../lib/utils';
import {COMPARE_LIMIT, useCompare, type CompareEntry} from '../lib/compare';
import {
  brlCompact,
  brlFull,
  fetchIndicadores,
  formatPercent,
  mesCurto,
  tituloCategoria,
  type Indicadores,
  type MediaCamara,
} from '../lib/indicadores';
import {Avatar} from '../components/DataBits';
import {fetchCatalogJson} from '../lib/catalogResource';
import type {JudicialSummary} from '../lib/judicialTypes';
import {judicialAttributeValues, proceedingCoverageText} from '../components/judicial/JudicialAttributes';
import {PrisonHistory} from '../components/judicial/JudicialDetails';

type Perfil = CompareEntry & {notaMedia: number | null; totalAvaliacoes: number | null; ativo?: boolean | null; judicial?: JudicialSummary};

type Concordancia = {
  total: number;
  iguais: number;
  items: Array<{votacaoId: string; titulo: string; referencia: string | null; data: string | null; votoA: string; votoB: string}>;
};

// Cores por posição: diferem em matiz e luminosidade (legíveis para daltônicos).
const CORES = [
  {bar: 'bg-brand-600 dark:bg-brand-400', ring: 'ring-brand-600 dark:ring-brand-400', hex: '#2450e0'},
  {bar: 'bg-orange-500 dark:bg-orange-400', ring: 'ring-orange-500 dark:ring-orange-400', hex: '#f97316'},
  {bar: 'bg-teal-700 dark:bg-teal-400', ring: 'ring-teal-700 dark:ring-teal-400', hex: '#0f766e'},
];

const anoAtual = new Date().getFullYear();
const ANOS = [null, anoAtual, anoAtual - 1, anoAtual - 2, anoAtual - 3] as const;

const parseIds = (raw: string | null) =>
  Array.from(new Set((raw ?? '').split(',').map((id) => id.trim()).filter((id) => /^\d{1,18}$/.test(id)))).slice(0, COMPARE_LIMIT);

const votoClasses = (voto: string) => {
  const v = voto.trim().toLocaleLowerCase('pt-BR');
  if (v === 'sim') return 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300';
  if (v === 'não' || v === 'nao') return 'bg-rose-50 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300';
  return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
};

const AddDeputado: React.FC<{onAdd: (entry: CompareEntry) => void; excluded: string[]}> = ({onAdd, excluded}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CompareEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const trimmed = query.trim();

  useEffect(() => {
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/politicos?search=${encodeURIComponent(trimmed)}&limit=6&status=todos`, {signal: controller.signal});
        if (!response.ok) throw new Error('HTTP');
        const data = (await response.json()) as {items?: Array<Record<string, unknown>>};
        if (controller.signal.aborted) return;
        setResults(
          (data.items ?? [])
            .filter((item) => typeof item.id === 'string' && typeof item.nome === 'string')
            .map((item) => ({
              id: item.id as string,
              nome: item.nome as string,
              partido: typeof item.partido === 'string' ? item.partido : undefined,
              estado: typeof item.estado === 'string' ? item.estado : undefined,
              foto: typeof item.foto === 'string' ? item.foto : null,
            })),
        );
      } catch {
        if (!controller.signal.aborted) setResults([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [trimmed]);

  return (
    <div className="relative">
      <label className="relative block">
        <span className="sr-only">Adicionar parlamentar à comparação</span>
        <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Adicionar: nome, partido ou UF"
          className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-500 focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50 dark:placeholder:text-slate-400"
        />
      </label>
      {trimmed.length >= 2 && (
        <div className="absolute inset-x-0 top-12 z-20 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
          {loading && results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">Buscando...</p>
          ) : results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">Nenhum parlamentar encontrado.</p>
          ) : (
            <ul>
              {results.map((result) => {
                const already = excluded.includes(result.id);
                return (
                  <li key={result.id}>
                    <button
                      type="button"
                      disabled={already}
                      onClick={() => {
                        onAdd(result);
                        setQuery('');
                      }}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50 disabled:opacity-50 dark:hover:bg-slate-800"
                    >
                      <Avatar nome={result.nome} foto={result.foto} size={32} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-slate-900 dark:text-slate-50">{result.nome}</span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">{[result.partido, result.estado].filter(Boolean).join(' / ')}</span>
                      </span>
                      <span className="text-xs font-medium text-brand-700 dark:text-brand-300">{already ? 'Já está' : 'Adicionar'}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export const Comparador = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const compare = useCompare();
  const urlIds = parseIds(searchParams.get('ids'));
  const ids = urlIds.length > 0 ? urlIds : compare.items.map((item) => item.id);
  const idsKey = ids.join(',');
  const anoParam = Number(searchParams.get('ano'));
  const ano = Number.isInteger(anoParam) && anoParam > 2000 ? anoParam : null;

  const [perfis, setPerfis] = useState<Map<string, Perfil>>(() => new Map());
  const [perfilStates, setPerfilStates] = useState<Map<string, 'loading' | 'ready' | 'error'>>(() => new Map());
  const perfilController = useRef<AbortController | null>(null);
  const indicatorsKey = `${idsKey}:${ano ?? 'todos'}`;
  const [indicatorResult, setIndicatorResult] = useState<{key: string; items: Map<string, Indicadores>; media: MediaCamara; state: 'loading' | 'ready' | 'error'} | null>(null);
  const [indicatorRetry, setIndicatorRetry] = useState(0);
  const indicadores = indicatorResult?.key === indicatorsKey ? indicatorResult.items : new Map<string, Indicadores>();
  const media = indicatorResult?.key === indicatorsKey ? indicatorResult.media : null;
  const state = indicatorResult?.key === indicatorsKey ? indicatorResult.state : 'loading';
  const [par, setPar] = useState<[number, number]>([0, 1]);
  const [concordanciaResult, setConcordanciaResult] = useState<{key: string; data: Concordancia | null; state: 'ready' | 'error'} | null>(null);
  const [concordanciaRetry, setConcordanciaRetry] = useState(0);
  const [soDivergencias, setSoDivergencias] = useState(false);
  const [copied, setCopied] = useState(false);

  const setIds = (next: string[]) => {
    const params = new URLSearchParams(searchParams);
    if (next.length) params.set('ids', next.join(','));
    else params.delete('ids');
    setSearchParams(params, {replace: true});
  };

  // Mantém a seleção global sincronizada com o que está na URL (links compartilhados também alimentam a bandeja).
  useEffect(() => {
    if (urlIds.length === 0 && compare.items.length > 0) setIds(compare.items.map((item) => item.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadPerfil = async (id: string, signal: AbortSignal, force = false) => {
    setPerfilStates(current => new Map(current).set(id, 'loading'));
    try {
      const data = await fetchCatalogJson<{politico?: Record<string, unknown>}>(`/api/politicos/${encodeURIComponent(id)}`, {signal, force});
      const p = data.politico;
      if (!p || typeof p.nome !== 'string') throw new Error('Perfil indisponível');
      const perfil: Perfil = {
        id,
        nome: p.nome,
        partido: typeof p.partido === 'string' ? p.partido : undefined,
        estado: typeof p.estado === 'string' ? p.estado : undefined,
        foto: typeof p.foto === 'string' ? p.foto : null,
        notaMedia: typeof p.notaMedia === 'number' ? p.notaMedia : null,
        totalAvaliacoes: typeof p.totalAvaliacoes === 'number' ? p.totalAvaliacoes : null,
        ativo: typeof p.ativo === 'boolean' ? p.ativo : null,
        judicial: p.judicial as JudicialSummary | undefined,
      };
      if (signal.aborted) return;
      setPerfis(current => new Map(current).set(id, perfil));
      setPerfilStates(current => new Map(current).set(id, 'ready'));
    } catch {
      if (!signal.aborted) setPerfilStates(current => new Map(current).set(id, 'error'));
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    perfilController.current = controller;
    ids.forEach(id => {if (!perfis.has(id)) void loadPerfil(id, controller.signal);});
    return () => controller.abort();
    // Perfis são independentes do período e publicados individualmente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  useEffect(() => {
    if (!ids.length) return;
    const controller = new AbortController();
    setIndicatorResult({key: indicatorsKey, items: new Map(), media: null, state: 'loading'});
    fetchIndicadores(ids, {ano, signal: controller.signal, force: indicatorRetry > 0}).then(ind => {
      if (!controller.signal.aborted) setIndicatorResult({key: indicatorsKey, ...ind, state: 'ready'});
    }).catch(() => {
      if (!controller.signal.aborted) setIndicatorResult({key: indicatorsKey, items: new Map(), media: null, state: 'error'});
    });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, ano, indicatorRetry]);

  useEffect(() => {
    setPar([0, 1]);
  }, [idsKey]);

  const parA = ids[par[0]];
  const parB = ids[par[1]];
  const concordanciaKey = `${parA}:${parB}`;
  const concordancia = concordanciaResult?.key === concordanciaKey ? concordanciaResult.data : null;
  const concordanciaState = concordanciaResult?.key === concordanciaKey ? concordanciaResult.state : 'loading';
  useEffect(() => {
    if (!parA || !parB) {
      setConcordanciaResult(null);
      return;
    }
    const controller = new AbortController();
    setConcordanciaResult(null);
    (async () => {
      try {
        const data = await fetchCatalogJson<Concordancia>(`/api/politicos/concordancia?a=${parA}&b=${parB}`, {signal: controller.signal, force: concordanciaRetry > 0});
        if (!controller.signal.aborted) setConcordanciaResult({key: concordanciaKey, state: 'ready', data: {total: data.total ?? 0, iguais: data.iguais ?? 0, items: Array.isArray(data.items) ? data.items : []}});
      } catch {
        if (!controller.signal.aborted) setConcordanciaResult({key: concordanciaKey, data: null, state: 'error'});
      }
    })();
    return () => controller.abort();
  }, [parA, parB, concordanciaRetry]);

  const deps = ids.map((id) => perfis.get(id) ?? compare.items.find((item) => item.id === id) ?? {id, nome: `Parlamentar ${id}`});

  const add = (entry: CompareEntry) => {
    if (ids.includes(entry.id) || ids.length >= COMPARE_LIMIT) return;
    if (!compare.has(entry.id)) compare.toggle(entry);
    setIds([...ids, entry.id]);
  };
  const remove = (id: string) => {
    compare.remove(id);
    setIds(ids.filter((current) => current !== id));
  };

  type Linha = {label: string; hint: string; values: Array<number | null>; format: (v: number | null) => string; better: 'higher' | 'lower' | null; signed?: boolean};
  const linhas: Linha[] = useMemo(() => {
    const ind = ids.map((id) => indicadores.get(id));
    const per = ids.map((id) => perfis.get(id));
    const gasto = ind.map((i) => (i ? i.totalDespesas : null));
    return [
      {label: 'Nota popular', hint: 'média das avaliações, de 1 a 5', values: per.map((p) => (p ? p.notaMedia : null)), format: (v) => (v == null ? 'n/d' : v.toFixed(1)), better: 'higher'},
      {label: 'Avaliações recebidas', hint: 'quantidade de notas', values: per.map((p) => (p ? p.totalAvaliacoes : null)), format: (v) => (v == null ? 'n/d' : v.toLocaleString('pt-BR')), better: null},
      {label: 'Participação em votações', hint: 'votos / votações nominais no período', values: ind.map((i) => i?.participacao ?? null), format: formatPercent, better: 'higher'},
      {label: 'Alinhamento com o governo', hint: 'votos iguais à orientação do governo', values: ind.map((i) => i?.alinhamentoGoverno ?? null), format: formatPercent, better: null},
      {label: 'Despesas da cota', hint: ano ? `em ${ano}` : 'todo o período na base', values: gasto, format: (v) => (v == null ? 'n/d' : brlFull.format(v)), better: 'lower'},
      {
        label: 'Despesas vs média',
        hint: media ? `média: ${brlCompact.format(media.gastoPorDeputado)}` : 'média indisponível',
        values: gasto.map((g) => (g == null || !media?.gastoPorDeputado ? null : Math.round(((g - media.gastoPorDeputado) / media.gastoPorDeputado) * 100))),
        format: (v) => (v == null ? 'n/d' : `${v > 0 ? '+' : ''}${v}%`),
        better: 'lower',
        signed: true,
      },
      {label: 'Votos registrados', hint: 'votações nominais', values: ind.map((i) => (i ? i.votosRegistrados : null)), format: (v) => (v == null ? 'n/d' : v.toLocaleString('pt-BR')), better: null},
      {label: 'Proposições de autoria', hint: 'como autor ou coautor', values: ind.map((i) => (i ? i.proposicoes : null)), format: (v) => (v == null ? 'n/d' : v.toLocaleString('pt-BR')), better: 'higher'},
    ];
  }, [ids, indicadores, perfis, media, ano]);

  const categorias = useMemo(() => {
    const totals = new Map<string, Array<number | null>>();
    ids.forEach((id, index) => {
      indicadores.get(id)?.gastosCategorias.forEach((c) => {
        const row = totals.get(c.tipo) ?? ids.map(current => indicadores.has(current) ? 0 : null);
        row[index] = c.total;
        totals.set(c.tipo, row);
      });
    });
    const rows = Array.from(totals.entries())
      .map(([tipo, values]) => ({tipo, values, soma: values.reduce<number>((a, b) => a + (b ?? 0), 0)}))
      .sort((a, b) => b.soma - a.soma)
      .slice(0, 7);
    const max = Math.max(1, ...rows.flatMap((row) => row.values.map(value => value ?? 0)));
    return {rows, max};
  }, [ids, indicadores]);

  const votos = concordancia ? concordancia.items.filter((item) => !soDivergencias || item.votoA.trim().toLocaleLowerCase('pt-BR') !== item.votoB.trim().toLocaleLowerCase('pt-BR')) : [];
  const pct = concordancia && concordancia.total > 0 ? Math.round((concordancia.iguais / concordancia.total) * 100) : null;
  const pares: Array<[number, number]> = ids.length === 3 ? [[0, 1], [0, 2], [1, 2]] : [[0, 1]];

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 pb-24 pt-8 sm:px-6 lg:px-8">
      <Link to="/ranking" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">
        <ArrowLeft size={15} aria-hidden="true" /> Voltar ao ranking
      </Link>
      <div className="mt-3 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl dark:text-slate-50">Comparar parlamentares</h1>
          <p className="mt-2 text-slate-600 dark:text-slate-400">Mesmo período e mesmas regras de cálculo, até {COMPARE_LIMIT} lado a lado.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
            Período
            <select
              value={ano ?? ''}
              onChange={(event) => {
                const params = new URLSearchParams(searchParams);
                if (event.target.value) params.set('ano', event.target.value);
                else params.delete('ano');
                setSearchParams(params, {replace: true});
              }}
              className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
            >
              {ANOS.map((value) => (
                <option key={value ?? 'todos'} value={value ?? ''}>
                  {value ?? 'Todos os anos'}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={copyLink}
            disabled={ids.length === 0}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:border-slate-300 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <Link2 size={15} aria-hidden="true" /> {copied ? 'Link copiado' : 'Copiar link'}
          </button>
        </div>
      </div>

      {ids.length === 0 ? (
        <div className="surface mt-8 flex flex-col items-center px-6 py-16 text-center">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Escolha quem comparar</h2>
          <p className="mt-2 max-w-md text-sm text-slate-600 dark:text-slate-400">
            Busque abaixo ou marque parlamentares na tabela do ranking. A seleção fica guardada enquanto você navega.
          </p>
          <div className="mt-6 w-full max-w-md text-left">
            <AddDeputado onAdd={add} excluded={ids} />
          </div>
        </div>
      ) : (
        <>
          {state === 'error' && (
            <p role="alert" className="mt-6 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200">
              Não foi possível carregar os indicadores.{' '}
              <button type="button" onClick={() => setIndicatorRetry(current => current + 1)}>Tentar novamente indicadores</button>
            </p>
          )}

          <section aria-label="Indicadores lado a lado" className="surface mt-8 overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left">
              <thead>
                <tr>
                  <th scope="col" className="w-56 px-5 py-4 align-bottom text-xs font-medium text-slate-500 dark:text-slate-400">Indicador</th>
                  {deps.map((dep, index) => (
                    <th key={dep.id} scope="col" className="border-l border-slate-100 px-5 py-4 dark:border-slate-800">
                      <div className="flex items-center gap-3">
                        <Avatar nome={dep.nome} foto={dep.foto} size={48} className={cn('ring-[3px]', CORES[index].ring)} />
                        <div className="min-w-0 flex-1">
                          <Link to={`/politico/${dep.id}`} className="block truncate text-base font-semibold text-slate-900 hover:text-brand-700 dark:text-slate-50">
                            {dep.nome}
                          </Link>
                          {!perfis.has(dep.id) && (perfilStates.get(dep.id) === 'error' ? (
                            <span role="alert" className="block text-xs text-rose-700">
                              Perfil indisponível.{' '}
                              <button type="button" aria-label={`Tentar novamente perfil ${dep.id}`} onClick={() => {
                                if (perfilController.current) void loadPerfil(dep.id, perfilController.current.signal, true);
                              }}>Tentar novamente</button>
                            </span>
                          ) : <span className="block text-xs text-slate-500">Carregando perfil...</span>)}
                          <span className="text-xs font-normal text-slate-500 dark:text-slate-400">{[dep.partido, dep.estado].filter(Boolean).join(' / ')}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => remove(dep.id)}
                          aria-label={`Remover ${dep.nome} da comparação`}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-50"
                        >
                          <X size={15} />
                        </button>
                      </div>
                    </th>
                  ))}
                  {ids.length < COMPARE_LIMIT && (
                    <th scope="col" className="w-72 border-l border-slate-100 px-4 py-4 align-middle font-normal dark:border-slate-800">
                      <div className="flex items-center gap-2 pb-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                        <Plus size={13} aria-hidden="true" /> Adicionar parlamentar
                      </div>
                      <AddDeputado onAdd={add} excluded={ids} />
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {[...judicialAttributeValues(), {id: 'prisonHistory', label: 'Histórico de prisão', value: '', proceedings: false}].map(attribute => (
                  <tr key={attribute.id} className="border-t border-slate-100 dark:border-slate-800">
                    <th scope="row" className="px-5 py-3.5 align-top"><span className="block text-sm font-medium text-slate-800 dark:text-slate-200">{attribute.label}</span><span className="text-xs font-normal text-slate-500 dark:text-slate-400">Escopo pesquisado; não altera a nota</span></th>
                    {ids.map(id => {
                      const summary = perfis.get(id)?.judicial;
                      return <td key={id} className="border-l border-slate-100 px-5 py-3.5 align-top text-sm text-slate-900 dark:border-slate-800 dark:text-slate-50">
                        {!perfis.has(id) && perfilStates.get(id) !== 'error' ? 'Carregando...' : attribute.id === 'prisonHistory' ? summary ? <PrisonHistory summary={summary}/> : 'Indisponível' : judicialAttributeValues(summary).find(item => item.id === attribute.id)?.value ?? 'Indisponível'}
                        {summary && <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{attribute.proceedings ? proceedingCoverageText(summary.proceedings) : summary.coverage.status === 'PARTIAL' ? 'Pesquisa parcial' : summary.coverage.status === 'REVIEWED' ? 'Pesquisa revisada' : 'Pesquisa não realizada'}</span>}
                        <Link to={`/politico/${id}?tab=geral#historico-judicial`} className="mt-1 inline-flex min-h-11 items-center text-xs font-medium text-brand-700 underline dark:text-brand-300">Ver fontes</Link>
                      </td>;
                    })}
                    {ids.length < COMPARE_LIMIT && <td className="border-l border-slate-100 dark:border-slate-800"/>}
                  </tr>
                ))}
                {linhas.map((linha) => {
                  const numeric = linha.values.filter((v): v is number => v != null);
                  const best =
                    linha.better && numeric.length > 1 && new Set(numeric).size > 1
                      ? linha.better === 'higher'
                        ? Math.max(...numeric)
                        : Math.min(...numeric)
                      : null;
                  const scale = Math.max(1, ...numeric.map((v) => Math.abs(v)));
                  return (
                    <tr key={linha.label} className="border-t border-slate-100 dark:border-slate-800">
                      <th scope="row" className="px-5 py-3.5 text-left align-top">
                        <span className="block text-sm font-medium text-slate-800 dark:text-slate-200">{linha.label}</span>
                        <span className="text-xs font-normal text-slate-500 dark:text-slate-400">{linha.hint}</span>
                      </th>
                      {linha.values.map((value, index) => (
                        <td key={ids[index]} className={cn('border-l border-slate-100 px-5 py-3.5 align-top dark:border-slate-800', value != null && value === best && 'bg-emerald-50/50 dark:bg-emerald-950/20')}>
                          {(linha.label === 'Nota popular' || linha.label === 'Avaliações recebidas') ? (
                            <span className="tabular font-mono text-base font-semibold text-slate-900 dark:text-slate-50">{!perfis.has(ids[index]) && perfilStates.get(ids[index]) !== 'error' ? 'Carregando...' : linha.format(value)}</span>
                          ) : state === 'loading' ? (
                            <span className="text-sm text-slate-500">Carregando...</span>
                          ) : (
                            <>
                              <span className="tabular font-mono text-base font-semibold text-slate-900 dark:text-slate-50">{linha.format(value)}</span>
                              {value != null && value === best && (
                                <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200">melhor</span>
                              )}
                              {value != null && !linha.signed && (
                                <span aria-hidden="true" className={cn('mt-2 block h-1.5 rounded-full', CORES[index].bar)} style={{width: `${Math.max(3, (Math.abs(value) / scale) * 100)}%`}} />
                              )}
                            </>
                          )}
                        </td>
                      ))}
                      {ids.length < COMPARE_LIMIT && <td className="border-l border-slate-100 dark:border-slate-800" />}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section className="surface p-5 sm:p-6">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Gastos por categoria</h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Onde cada um usa a cota parlamentar{ano ? ` em ${ano}` : ''}.</p>
              <div className="mt-4 flex flex-wrap gap-4 text-xs text-slate-700 dark:text-slate-300">
                {deps.map((dep, index) => (
                  <span key={dep.id} className="flex items-center gap-1.5">
                    <span aria-hidden="true" className={cn('h-2.5 w-2.5 rounded-sm', CORES[index].bar)} />
                    {dep.nome}
                  </span>
                ))}
              </div>
              {categorias.rows.length === 0 ? (
                <p className="mt-8 rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  {state === 'loading' ? 'Carregando despesas...' : state === 'error' ? 'Despesas indisponíveis.' : indicadores.size === 0 ? 'Dados de despesas indisponíveis para o período.' : 'Sem despesas registradas para o período.'}
                </p>
              ) : (
                <ul className="mt-5 space-y-4">
                  {categorias.rows.map((row) => (
                    <li key={row.tipo}>
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{tituloCategoria(row.tipo)}</p>
                      <div className="mt-1.5 space-y-1">
                        {row.values.map((value, index) => (
                          <div key={ids[index]} className="flex items-center gap-2">
                            {value != null && <span aria-hidden="true" className={cn('grow-bar h-2.5 rounded-full', CORES[index].bar)} style={{width: `${Math.max(1, (value / categorias.max) * 85)}%`}} />}
                            <span className="tabular font-mono text-xs text-slate-600 dark:text-slate-300">
                              <span className="sr-only">{deps[index]?.nome}: </span>
                              {value == null ? 'n/d' : brlCompact.format(value)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="surface p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Como votaram juntos</h2>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Votações nominais em que os dois votaram.</p>
                </div>
                <div role="group" aria-label="Filtro de votos" className="flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
                  {[
                    {value: false, label: 'Todas'},
                    {value: true, label: 'Só divergências'},
                  ].map((option) => (
                    <button
                      key={option.label}
                      type="button"
                      aria-pressed={soDivergencias === option.value}
                      onClick={() => setSoDivergencias(option.value)}
                      className={cn(
                        'rounded-lg px-3 py-1.5 text-xs font-medium',
                        soDivergencias === option.value ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-slate-50' : 'text-slate-600 dark:text-slate-400',
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              {ids.length < 2 ? (
                <p className="mt-8 rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  Adicione mais um parlamentar para ver a concordância nos votos.
                </p>
              ) : (
                <>
                  {pares.length > 1 && (
                    <div role="group" aria-label="Par comparado" className="mt-4 flex flex-wrap gap-2">
                      {pares.map(([a, b]) => (
                        <button
                          key={`${a}-${b}`}
                          type="button"
                          aria-pressed={par[0] === a && par[1] === b}
                          onClick={() => setPar([a, b])}
                          className={cn(
                            'rounded-full border px-3 py-1 text-xs font-medium',
                            par[0] === a && par[1] === b
                              ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900'
                              : 'border-slate-200 text-slate-700 dark:border-slate-700 dark:text-slate-300',
                          )}
                        >
                          {deps[a]?.nome.split(' ')[0]} × {deps[b]?.nome.split(' ')[0]}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="mt-5 flex items-center gap-4">
                    <span className="tabular font-mono text-5xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">{pct == null ? 'n/d' : `${pct}%`}</span>
                    <span className="max-w-xs text-sm text-slate-600 dark:text-slate-400">
                      de concordância em <span className="tabular font-mono">{concordancia ? concordancia.total.toLocaleString('pt-BR') : 'n/d'}</span> votações em comum.
                    </span>
                  </div>
                  {pct != null && (
                    <div className="mt-3" aria-hidden="true">
                      <div className="flex h-2.5 overflow-hidden rounded-full">
                        <span className="bg-brand-600 dark:bg-brand-400" style={{width: `${pct}%`}} />
                        <span className="bg-orange-500 dark:bg-orange-400" style={{width: `${100 - pct}%`}} />
                      </div>
                      <div className="mt-1 flex justify-between text-[11px] text-slate-500 dark:text-slate-400">
                        <span>votaram igual</span>
                        <span>votaram diferente</span>
                      </div>
                    </div>
                  )}
                  <ul className="mt-5">
                    <li className="grid grid-cols-[minmax(0,1fr)_72px_72px] gap-3 pb-2 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      <span>Votação</span>
                      <span className="truncate text-center">{deps[par[0]]?.nome.split(' ')[0]}</span>
                      <span className="truncate text-center">{deps[par[1]]?.nome.split(' ')[0]}</span>
                    </li>
                    {votos.length === 0 ? (
                      <li className="border-t border-slate-100 py-6 text-center text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
                        {concordanciaState === 'loading' ? 'Carregando votações em comum...' : concordanciaState === 'error' ? (
                          <span role="alert">Votações em comum indisponíveis. <button type="button" onClick={() => setConcordanciaRetry(current => current + 1)}>Tentar novamente votações</button></span>
                        ) : soDivergencias ? 'Nenhuma divergência entre as votações recentes.' : 'Nenhuma votação em comum encontrada.'}
                      </li>
                    ) : (
                      votos.slice(0, 12).map((voto) => (
                        <li key={voto.votacaoId} className="grid grid-cols-[minmax(0,1fr)_72px_72px] items-center gap-3 border-t border-slate-100 py-2.5 dark:border-slate-800">
                          <span className="min-w-0">
                            <span className="line-clamp-2 text-sm font-medium text-slate-800 dark:text-slate-200">{voto.titulo}</span>
                            <span className="tabular font-mono text-[11px] text-slate-500 dark:text-slate-400">
                              {[voto.referencia, voto.data ? new Date(voto.data).toLocaleDateString('pt-BR') : null].filter(Boolean).join(' · ')}
                            </span>
                          </span>
                          <span className={cn('rounded-lg py-1 text-center text-xs font-semibold', votoClasses(voto.votoA))}>{voto.votoA}</span>
                          <span className={cn('rounded-lg py-1 text-center text-xs font-semibold', votoClasses(voto.votoB))}>{voto.votoB}</span>
                        </li>
                      ))
                    )}
                  </ul>
                </>
              )}
            </section>
          </div>

          <section className="surface mt-6 p-5 sm:p-6">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Gastos mês a mês</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Últimos meses com despesas registradas.</p>
            <div className="mt-5 grid grid-cols-1 gap-6 md:grid-cols-3">
              {deps.map((dep, index) => {
                const mensal = indicadores.get(dep.id)?.gastosMensais ?? [];
                const max = Math.max(1, ...mensal.map((m) => m.total));
                return (
                  <div key={dep.id}>
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{dep.nome}</p>
                    {mensal.length === 0 ? (
                      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{state === 'loading' ? 'Carregando despesas...' : state === 'error' || !indicadores.has(dep.id) ? 'Despesas indisponíveis.' : 'Sem despesas no período.'}</p>
                    ) : (
                      <div className="mt-3 flex h-28 items-end gap-1" role="img" aria-label={`Gastos mensais de ${dep.nome}`}>
                        {mensal.map((m) => (
                          <div key={`${m.ano}-${m.mes}`} className="flex flex-1 flex-col items-center gap-1">
                            <span className={cn('w-full rounded-t-[4px]', CORES[index].bar)} style={{height: `${Math.max(3, (m.total / max) * 96)}px`}} title={`${mesCurto(m.mes)}/${m.ano}: ${brlFull.format(m.total)}`} />
                            <span className="text-[10px] text-slate-500 dark:text-slate-400">{mesCurto(m.mes)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <p className="mt-6 text-xs text-slate-500 dark:text-slate-400">
            Como calculamos: participação = votos registrados / votações nominais no período do parlamentar; alinhamento = votos iguais à
            orientação do governo quando ela foi Sim ou Não. <Link to="/metodologia" className="font-medium text-brand-700 hover:underline dark:text-brand-300">Ver metodologia</Link>
          </p>
        </>
      )}
    </div>
  );
};
