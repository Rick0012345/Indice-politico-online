import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Check,
  ChevronRight,
  Download,
  Landmark,
  Link2,
  Rows3,
  Rows4,
  Search,
  Star,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import {Link, useSearchParams} from 'react-router-dom';
import {cn} from '../lib/utils';
import {fetchCatalogJson, getCatalogRevision} from '../lib/catalogResource';
import {useDebouncedValue} from '../hooks/useDebouncedValue';
import {catalogConnectionLabels, useCatalogUpdates} from '../hooks/useCatalogUpdates';
import {ExpenseCoverageNotice} from '../components/ExpenseCoverageNotice';
import type {ExpenseCoverage} from '../lib/expenseAnalyticsTypes';
import {
  getPoliticoStatusClasses,
  getPoliticoStatusLabel,
  type PoliticoStatusFilter,
  politicoStatusOptions,
} from '../lib/politicoStatus';
import {useCompare} from '../lib/compare';
import {fetchIndicadores, formatPercent, type Indicadores} from '../lib/indicadores';
import {CompareTray, Sparkline} from '../components/DataBits';
import {PrisonHistory} from '../components/judicial/JudicialDetails';
import {proceedingCount, proceedingCoverageText} from '../components/judicial/JudicialAttributes';
import {judicialCategories, type JudicialCategory, type JudicialSummary} from '../lib/judicialTypes';

type RankingView = 'parlamentares' | 'partidos';

type PoliticoRankingItem = {
  id: string;
  nome: string;
  partido: string;
  estado: string;
  cargo: string;
  foto: string;
  notaMedia: number;
  totalAvaliacoes?: number;
  totalDespesas: number;
  totalVotacoes: number;
  ativo?: boolean | null;
  situacao?: string | null;
  judicial?: JudicialSummary;
};

type PartidoGastosItem = {
  partido: string;
  totalDespesas: number;
  totalPoliticos: number;
};

type RankingResponse = {
  revision?: string;
  items?: PoliticoRankingItem[];
  total?: number;
  totalCadastrados?: number;
  totalDespesas?: number;
  totalAvaliacoes?: number;
  notaMedia?: number;
  totalVotacoes?: number;
  votacoesDisponiveis?: boolean;
  cobertura?: ExpenseCoverage;
};

const validTotal = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
const validExpenseTotal = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const metricOptions = [
  {value: 'nota', label: 'Nota', description: 'média das avaliações populares'},
  {value: 'despesas', label: 'Gastos', description: 'total declarado na base'},
  {value: 'votacoes', label: 'Votações', description: 'registros de votação encontrados'},
  {value: 'processos', label: 'Processos', description: 'processos identificados com papel de réu ou requerido'},
  {value: 'condenacoes', label: 'Condenações', description: 'condenações definitivas verificadas'},
] as const;

type MetricValue = (typeof metricOptions)[number]['value'];

const RANKING_PAGE_SIZE = 50;
const DENSITY_KEY = 'cp:ranking-densidade';

const isMetric = (value: string | null): value is MetricValue => metricOptions.some((option) => option.value === value);
const isStatus = (value: string | null): value is PoliticoStatusFilter =>
  politicoStatusOptions.some((option) => option.value === value);

const readDensity = (): 'compacta' | 'confortavel' => {
  try {
    return window.localStorage.getItem(DENSITY_KEY) === 'confortavel' ? 'confortavel' : 'compacta';
  } catch {
    return 'compacta';
  }
};

const csvCell = (value: unknown) => {
  const text = value == null ? '' : String(value);
  return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const hasRating = (politico:PoliticoRankingItem) => politico.totalAvaliacoes == null ? politico.notaMedia>0 : politico.totalAvaliacoes>0;
const expenseText = (value: number | undefined, imported: boolean | null | undefined, money: Intl.NumberFormat) =>
  value == null || (value === 0 && imported == null) ? '—' : value === 0 && !imported ? 'Dados não importados' : money.format(value);
const votesText = (value: number | undefined, available: boolean | null | undefined) =>
  value == null || (value === 0 && available == null) ? '—' : available === false ? 'Não importado' : value.toLocaleString('pt-BR');
const convictionCount = (summary: JudicialSummary | undefined, category: JudicialCategory) =>
  summary?.finalConvictions == null ? null : summary.counts[category].final;
const convictionText = (summary: JudicialSummary | undefined, category: JudicialCategory) =>
  summary == null ? 'Dados indisponíveis' : convictionCount(summary, category) == null ? 'Não pesquisado' : `${summary.counts[category].final.toLocaleString('pt-BR')} definitivas`;
const proceedingText = (summary?: JudicialSummary) => summary?.proceedings?.againstPerson == null ? 'Não apurado' : `${proceedingCount(summary.proceedings.againstPerson)} processos contra`;
const metricUnknown = (metric: MetricValue, summary: JudicialSummary | undefined, category: JudicialCategory) => metric === 'condenacoes' ? convictionCount(summary, category) === null : metric === 'processos' ? summary?.proceedings?.againstPerson == null : false;
const ProceedingsRankingAttributes = ({summary}: {summary?: JudicialSummary}) => !summary?.proceedings ? <div className="space-y-1 text-xs leading-5"><p>Não apurado</p><p className="text-slate-500 dark:text-slate-400">Consulta processual não realizada</p></div> : <div className="space-y-1 text-xs leading-5"><p className="font-semibold">{proceedingText(summary)}</p><p>{proceedingCount(summary?.proceedings?.activeAgainstPerson)} ativos contra · {proceedingCount(summary?.proceedings?.investigations)} investigações · {proceedingCount(summary?.proceedings?.enforcements)} execuções</p><p className="text-slate-500 dark:text-slate-400">{proceedingCoverageText(summary?.proceedings)}</p></div>;
const JudicialRankingAttributes = ({summary, category}: {summary?: JudicialSummary; category: JudicialCategory}) => <div className="space-y-1 text-xs leading-5">
  <div className="font-semibold text-slate-900 dark:text-slate-100">{convictionText(summary, category)}</div>
  <div className="text-slate-500 dark:text-slate-400">{judicialCategories[category]}{summary?.finalConvictions != null && <> · <span>{summary.counts[category].appeal.toLocaleString('pt-BR')} sujeitas a recurso</span></>}</div>
  <div className="text-slate-600 dark:text-slate-300">{summary ? <PrisonHistory summary={summary} /> : 'Histórico de prisão indisponível'}</div>
  {summary && <div className="text-slate-500 dark:text-slate-400">{summary.coverage.status === 'PARTIAL' ? 'Pesquisa parcial · escopo limitado' : summary.coverage.status === 'REVIEWED' ? 'Pesquisa revisada · escopo informado' : 'Pesquisa não realizada'}</div>}
</div>;

const RankingMobileCard: React.FC<{
  politico: PoliticoRankingItem;
  index: number;
  metric: MetricValue;
  money: Intl.NumberFormat;
  indicadores?: Indicadores;
  votesAvailable?: boolean | null;
  expensesImported?: boolean | null;
  category: JudicialCategory;
}> = ({politico, index, metric, money, indicadores, votesAvailable, expensesImported, category}) => {
  return (
    <Link
      to={`/politico/${politico.id}`}
      className="surface block p-4 transition-colors hover:border-brand-200 dark:hover:border-brand-900"
    >
      <div className="flex items-start gap-3">
        <span aria-label={metricUnknown(metric, politico.judicial, category) ? 'Sem classificação' : undefined} className="tabular mt-1 w-6 shrink-0 text-center font-mono text-sm text-slate-500 dark:text-slate-400">{metricUnknown(metric, politico.judicial, category) ? '—' : index + 1}</span>

        <img
          src={politico.foto}
          alt={politico.nome}
          className="h-12 w-12 shrink-0 rounded-full object-cover ring-1 ring-slate-200 dark:ring-slate-700"
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="break-words font-semibold text-slate-900 dark:text-slate-50">{politico.nome}</h3>
              <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                {politico.partido} / {politico.estado}
              </p>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {politico.cargo}
              </p>
            </div>

            <div className="max-w-full rounded-xl bg-slate-50 px-3 py-2 text-center dark:bg-slate-800">
              <div className="flex items-center justify-center gap-1">
                {metric === 'nota' && hasRating(politico) && <Star size={14} aria-hidden="true" className="fill-amber-400 text-amber-400" />}
                <span className="tabular font-mono text-sm font-semibold text-slate-900 dark:text-slate-50">{metric === 'processos' ? proceedingText(politico.judicial) : metric === 'condenacoes' ? convictionText(politico.judicial, category) : metric === 'nota' ? hasRating(politico) ? politico.notaMedia.toFixed(1) : 'Sem avaliações' : metric === 'despesas' ? expenseText(politico.totalDespesas, expensesImported, money) : votesText(politico.totalVotacoes, votesAvailable)}</span>
              </div>
              <span className="text-xs text-slate-500 dark:text-slate-400">{metric === 'processos' ? 'Réu ou requerido' : metric === 'condenacoes' ? judicialCategories[category] : metric === 'nota' ? 'Nota popular' : metric === 'despesas' ? 'Despesas' : 'Votações'}</span>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <span
              className={cn(
                'inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset',
                getPoliticoStatusClasses(politico),
              )}
            >
              {getPoliticoStatusLabel(politico)}
            </span>
            <span className="tabular inline-flex rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {expenseText(politico.totalDespesas, expensesImported, money)}
            </span>
            <span className="tabular inline-flex rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {votesAvailable===false ? 'Votações ainda não importadas' : `${votesText(politico.totalVotacoes, votesAvailable)} votações`}
            </span>
            {indicadores?.participacao != null && (
              <span className="tabular inline-flex rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {formatPercent(indicadores.participacao)} participação
              </span>
            )}
          </div>
          <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800"><span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">Condenações, prisões e processos</span><JudicialRankingAttributes summary={politico.judicial} category={category} /><div className="mt-2 border-t border-slate-100 pt-2 dark:border-slate-800"><ProceedingsRankingAttributes summary={politico.judicial}/></div></div>
        </div>
      </div>
    </Link>
  );
};

export const Ranking = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeView, setActiveView] = useState<RankingView>(() => (searchParams.get('ver') === 'partidos' ? 'partidos' : 'parlamentares'));
  const activeViewRef = useRef(activeView);
  activeViewRef.current = activeView;
  const [metric, setMetric] = useState<MetricValue>(() => {
    const raw = searchParams.get('metrica');
    return isMetric(raw) ? raw : searchParams.get('view') === 'judicial' ? 'condenacoes' : 'nota';
  });
  const [direction, setDirection] = useState<'desc' | 'asc'>(() => ((searchParams.get('ordem') ?? searchParams.get('direction')) === 'asc' ? 'asc' : 'desc'));
  const [category, setCategory] = useState<JudicialCategory>(() => {
    const raw = searchParams.get('category');
    return raw && Object.hasOwn(judicialCategories, raw) ? raw as JudicialCategory : 'CRIMINAL';
  });
  const [prisonOnly, setPrisonOnly] = useState(() => searchParams.get('prisonOnly') === 'true');
  const effectivePrisonOnly = activeView === 'parlamentares' && prisonOnly;
  const [cargo, setCargo] = useState('Todos os Cargos');
  const [status, setStatus] = useState<PoliticoStatusFilter>(() => {
    const raw = searchParams.get('status');
    return isStatus(raw) ? raw : 'ativo';
  });
  const [search, setSearch] = useState(() => searchParams.get('q') ?? searchParams.get('search') ?? '');
  const debouncedSearch = useDebouncedValue(search);
  const [density, setDensity] = useState<'compacta' | 'confortavel'>(readDensity);
  const [linkCopied, setLinkCopied] = useState(false);
  const [indicadores, setIndicadores] = useState<Map<string, Indicadores>>(() => new Map());
  const requestedIndicadores = useRef(new Set<string>());
  const loadedIndicadores = useRef(new Set<string>());
  const compare = useCompare();
  const [expenseYear,setExpenseYear] = useState('');
  const [firstMonth,setFirstMonth] = useState('1');
  const [lastMonth,setLastMonth] = useState('12');
  const [availableYears,setAvailableYears] = useState<number[]>([]);
  const [yearsError,setYearsError] = useState(false);
  const [items, setItems] = useState<PoliticoRankingItem[]>([]);
  const [totalCadastrados, setTotalCadastrados] = useState<number | null>(null);
  const [rankingTotal, setRankingTotal] = useState<{context: string; total: number | null} | null>(null);
  const [expenseTotal, setExpenseTotal] = useState<{filter:string;revision?:string;total:number|null;coverage?:ExpenseCoverage;rating:number|null;ratingCount:number|null;votes:number|null;votesAvailable:boolean|null} | null>(null);
  const [partidos, setPartidos] = useState<PartidoGastosItem[]>([]);
  const [hasMoreRankingItems, setHasMoreRankingItems] = useState(false);
  const [isLoadingRanking, setIsLoadingRanking] = useState(false);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState('');
  const [itemsRevision, setItemsRevision] = useState<string>();
  const itemsRevisionRef = useRef<string>();
  const [pageRevisionMismatch, setPageRevisionMismatch] = useState(false);
  const loadedContext = useRef<string | null>(null);
  const summaryController = useRef<AbortController | null>(null);
  const summaryContext = useRef('');
  const reconciliationAttempts = useRef(new Set<string>());
  const [isLoadingPartidos, setIsLoadingPartidos] = useState(false);
  const [lastSuccess, setLastSuccess] = useState<Date | null>(null);
  const reloadPartidos = useRef<(() => Promise<void>) | null>(null);
  const partidosOperation = useRef<Promise<void> | null>(null);
  const visibleCount = useRef(0);
  const reconciliationExtent = useRef(0);
  visibleCount.current = items.length;
  const currentOperation = useRef<Promise<void> | null>(null);

  const money = useMemo(
    () =>
      new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
        maximumFractionDigits: 2,
      }),
    [],
  );

  // Filtros refletidos na URL: o link copiado reabre exatamente a mesma visão.
  useEffect(() => {
    const next = new URLSearchParams();
    if (search.trim()) next.set('q', search.trim());
    if (status !== 'ativo') next.set('status', status);
    if (metric !== 'nota') next.set('metrica', metric);
    if (direction !== 'desc') next.set('ordem', direction);
    if (activeView !== 'parlamentares') next.set('ver', activeView);
    if (category !== 'CRIMINAL') next.set('category', category);
    if (prisonOnly) next.set('prisonOnly', 'true');
    if (next.toString() !== searchParams.toString()) setSearchParams(next, {replace: true});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, status, metric, direction, activeView, category, prisonOnly]);

  useEffect(() => {
    try {
      window.localStorage.setItem(DENSITY_KEY, density);
    } catch {
      // preferência só nesta sessão
    }
  }, [density]);

  const selectedCargo = cargo === 'Todos' || cargo === 'Todos os Cargos' ? '' : cargo;
  const isUnsupportedCargo = Boolean(selectedCargo && selectedCargo !== 'Deputado Federal');
  const rankingSearch = debouncedSearch.trim();
  const [error, setError] = useState('');
  const [partidosError, setPartidosError] = useState('');
  const contextKey = JSON.stringify([metric, direction, cargo, status, rankingSearch,expenseYear,firstMonth,lastMonth,category,effectivePrisonOnly]);
  const expenseFilterKey = JSON.stringify([cargo, status, rankingSearch,expenseYear,firstMonth,lastMonth,effectivePrisonOnly]);
  summaryContext.current = expenseFilterKey;
  const context = useRef(contextKey);
  context.current = contextKey;
  const pendingPage = useRef<AbortController | null>(null);
  useEffect(() => () => { pendingPage.current?.abort(); pendingPage.current = null; }, [contextKey]);

  useEffect(()=>{
    const controller=new AbortController();
    void (async()=>{
      try {
        const data=await fetchCatalogJson<{items?:unknown[]}>('/api/despesas/anos',{signal:controller.signal});
        if(!controller.signal.aborted)setAvailableYears((data.items??[]).filter((year):year is number=>typeof year==='number'&&Number.isSafeInteger(year)&&year>=2015&&year<=9999));
      } catch {if(!controller.signal.aborted)setYearsError(true);}
    })();
    return()=>controller.abort();
  },[]);

  const loadRankingPage = useCallback(
    async (offset: number, signal?: AbortSignal, prefixSize = RANKING_PAGE_SIZE, force = false) => {
      if (pendingPage.current) return;
      const key = contextKey;
      const controller = new AbortController();
      pendingPage.current = controller;
      const externalSignal = signal;
      const abort = () => controller.abort();
      externalSignal?.addEventListener('abort', abort, {once: true});
      if (externalSignal?.aborted) controller.abort();
      signal = controller.signal;
      setError('');
      try {
      const params = new URLSearchParams({
        view: 'items',
        metric,
        direction,
        limit: String(Math.min(prefixSize + 1, 2000)),
        offset: String(offset),
        status,
        category,
        prisonOnly: String(effectivePrisonOnly),
      });

      if (rankingSearch) params.set('search', rankingSearch);
      if (expenseYear) {params.set('ano',expenseYear);params.set('mesInicio',firstMonth);params.set('mesFim',lastMonth);}

      const collected: PoliticoRankingItem[] = [];
      let totals: RankingResponse = {};
      while (collected.length < prefixSize + 1) {
        const limit = Math.min(prefixSize + 1 - collected.length, 2000);
        params.set('limit', String(limit));
        params.set('offset', String(offset + collected.length));
        const data = await fetchCatalogJson<RankingResponse>(`/api/politicos/ranking?${params.toString()}`, {signal, force});
        totals = data;
        const page = data.items ?? [];
        collected.push(...page);
        if (page.length < limit || signal.aborted || context.current !== key) break;
      }
      if (signal?.aborted || context.current !== key) return;
      const nextItems = collected.map((p) => ({
        ...p,
        foto: p.foto || `https://picsum.photos/seed/${p.id}/400/400`,
      }));
      const visibleItems = nextItems.slice(0, prefixSize);

      if (validTotal(totals.totalCadastrados) !== null) setTotalCadastrados(validTotal(totals.totalCadastrados));
      if (offset > 0 && itemsRevisionRef.current && totals.revision && itemsRevisionRef.current !== totals.revision) {
        reconciliationExtent.current = offset + visibleItems.length;
        setPageRevisionMismatch(true);
        return;
      }
      itemsRevisionRef.current = totals.revision;
      setItemsRevision(totals.revision);
      if (offset === 0) {setPageRevisionMismatch(false); reconciliationExtent.current = 0;}
      loadedContext.current = key;
      setRankingTotal({context: key, total: validTotal(totals.total)});
      setHasMoreRankingItems(nextItems.length > prefixSize);
      setLastSuccess(new Date());
      // Keep the committed extent available before React flushes the next render.
      visibleCount.current = offset === 0 ? visibleItems.length : offset + visibleItems.length;
      setItems((current) => {
        if (offset === 0) return visibleItems;

        const seen = new Set(current.map((item) => item.id));
        return [...current, ...visibleItems.filter((item) => !seen.has(item.id))];
      });
      } catch {
        if (!signal?.aborted && context.current === key) setError('Não foi possível carregar o ranking. Tente novamente.');
      } finally {
        externalSignal?.removeEventListener('abort', abort);
        if (pendingPage.current === controller) pendingPage.current = null;
      }
    },
    [contextKey, direction, expenseFilterKey, expenseYear,firstMonth,lastMonth,metric, rankingSearch, status, category, effectivePrisonOnly],
  );

  const loadSummary = useCallback(async (force = false) => {
    summaryController.current?.abort();
    const controller = new AbortController();
    summaryController.current = controller;
    const key = expenseFilterKey;
    setIsLoadingSummary(true);
    setSummaryError('');
    const params = new URLSearchParams({view: 'summary', status, prisonOnly: String(effectivePrisonOnly)});
    if (rankingSearch) params.set('search', rankingSearch);
    if (expenseYear) {params.set('ano', expenseYear); params.set('mesInicio', firstMonth); params.set('mesFim', lastMonth);}
    try {
      const data = await fetchCatalogJson<RankingResponse>(`/api/politicos/ranking?${params}`, {signal: controller.signal, force});
      if (controller.signal.aborted || summaryContext.current !== key) return;
      setTotalCadastrados(validTotal(data.totalCadastrados));
      setExpenseTotal({filter:key,revision:data.revision,total:validExpenseTotal(data.totalDespesas),coverage:data.cobertura,rating:validExpenseTotal(data.notaMedia),ratingCount:validTotal(data.totalAvaliacoes),votes:validTotal(data.totalVotacoes),votesAvailable:typeof data.votacoesDisponiveis==='boolean'?data.votacoesDisponiveis:null});
    } catch {
      if (!controller.signal.aborted && summaryContext.current === key) setSummaryError('Não foi possível carregar o resumo do ranking.');
    } finally {
      if (!controller.signal.aborted && summaryContext.current === key) setIsLoadingSummary(false);
    }
  }, [expenseFilterKey, status, rankingSearch, expenseYear, firstMonth, lastMonth, effectivePrisonOnly]);

  useEffect(() => {
    if (isUnsupportedCargo || activeView !== 'parlamentares') return;
    void loadSummary();
    return () => summaryController.current?.abort();
  }, [isUnsupportedCargo, activeView, loadSummary]);

  const catalogConnection = useCatalogUpdates(async () => {
    const key = contextKey;
    await Promise.all([currentOperation.current, partidosOperation.current]);
    if (context.current !== key || activeViewRef.current !== activeView || isUnsupportedCargo) return;
    if (activeView === 'partidos') {await reloadPartidos.current?.(); return;}
    setIsLoadingRanking(true);
    const operation = loadRankingPage(0, undefined, Math.max(RANKING_PAGE_SIZE, visibleCount.current, reconciliationExtent.current));
    currentOperation.current = operation;
    void loadSummary();
    try { await operation; }
    finally { if (context.current === key) setIsLoadingRanking(false); }
  });

  const summaryMismatch = pageRevisionMismatch || Boolean(expenseTotal?.filter === expenseFilterKey && itemsRevision && expenseTotal.revision && itemsRevision !== expenseTotal.revision);
  useEffect(() => {
    if (!summaryMismatch) {reconciliationAttempts.current.clear(); return;}
    if (activeView !== 'parlamentares' || pendingPage.current || isLoadingSummary) return;
    const key = contextKey;
    const attemptKey = `${key}:${itemsRevision}:${expenseTotal?.revision}`;
    if (reconciliationAttempts.current.has(attemptKey)) return;
    // One reconciliation per context; continuous updates remain the responsibility of SSE.
    if (reconciliationAttempts.current.has(key)) return;
    reconciliationAttempts.current.add(key);
    reconciliationAttempts.current.add(attemptKey);
    setIsLoadingRanking(true);
    const operation = loadRankingPage(0, undefined, Math.max(RANKING_PAGE_SIZE, visibleCount.current, reconciliationExtent.current), true);
    currentOperation.current = operation;
    void Promise.all([operation, loadSummary(true)]).finally(() => {if (context.current === key) setIsLoadingRanking(false);});
  }, [summaryMismatch, activeView, contextKey, itemsRevision, expenseTotal?.revision, isLoadingSummary, loadRankingPage, loadSummary]);

  useEffect(() => {
    const controller = new AbortController();
    if (activeView !== 'parlamentares') return;
    if (isUnsupportedCargo) {
      setItems([]); setHasMoreRankingItems(false); setIsLoadingRanking(false); return;
    }
    const sameContext = loadedContext.current === contextKey;
    const latestRevision = getCatalogRevision();
    if (sameContext && (!latestRevision || itemsRevisionRef.current === latestRevision)) {setIsLoadingRanking(false); return;}
    setIsLoadingRanking(true);
    if (!sameContext) {
      setItems([]);
      setItemsRevision(undefined);
      itemsRevisionRef.current = undefined;
      reconciliationExtent.current = 0;
      setPageRevisionMismatch(false);
      setHasMoreRankingItems(false);
    }
    const operation = loadRankingPage(0, controller.signal, sameContext ? Math.max(RANKING_PAGE_SIZE, visibleCount.current, reconciliationExtent.current) : RANKING_PAGE_SIZE);
    currentOperation.current = operation;
    void operation.finally(() => {if (!controller.signal.aborted) setIsLoadingRanking(false);});
    return () => controller.abort();
  }, [isUnsupportedCargo, activeView, contextKey, loadRankingPage]);

  // Indicadores complementares (participação, alinhamento, proposições, gastos mensais) dos parlamentares
  // carregados. São buscados em lotes, uma vez por parlamentar, e não bloqueiam a tabela.
  useEffect(() => {
    const missing = items.map((item) => item.id).filter((id) => !requestedIndicadores.current.has(id));
    if (missing.length === 0) return;
    missing.forEach((id) => requestedIndicadores.current.add(id));
    const controller = new AbortController();
    const batches: string[][] = [];
    for (let index = 0; index < missing.length; index += 60) batches.push(missing.slice(index, index + 60));
    batches.forEach((batch) => {
      fetchIndicadores(batch, {signal: controller.signal})
        .then(({items: loaded}) => {
          if (controller.signal.aborted) return;
          batch.forEach((id) => loadedIndicadores.current.add(id));
          if (loaded.size === 0) return;
          setIndicadores((current) => {
            const next = new Map(current);
            loaded.forEach((value, id) => next.set(id, value));
            return next;
          });
        })
        .catch(() => {
          if (!controller.signal.aborted) batch.forEach((id) => requestedIndicadores.current.delete(id));
        });
    });
    return () => {
      controller.abort();
      missing.forEach((id) => {
        if (!loadedIndicadores.current.has(id)) requestedIndicadores.current.delete(id);
      });
    };
  }, [items]);

  useEffect(() => {
    if (activeView !== 'partidos') return;
    const controller = new AbortController();

    const run = async () => {
      if (isUnsupportedCargo) {
        setPartidos([]);
        return;
      }

      setIsLoadingPartidos(true);
      setPartidosError('');

      try {
        const params = new URLSearchParams({
          limit: '10',
          direction,
          status,
        });
        if(expenseYear){params.set('ano',expenseYear);params.set('mesInicio',firstMonth);params.set('mesFim',lastMonth);}

        const data = await fetchCatalogJson<{items?: PartidoGastosItem[]}>(`/api/partidos/gastos?${params.toString()}`, {signal: controller.signal});
        if (controller.signal.aborted) return;
        setPartidos(
          (data.items ?? []).filter(
            (p): p is PartidoGastosItem =>
              typeof p.partido === 'string' &&
              typeof p.totalDespesas === 'number' &&
              typeof p.totalPoliticos === 'number',
          ),
        );
      } catch {
        if (!controller.signal.aborted) setPartidosError('Não foi possível carregar os gastos dos partidos. Tente novamente.');
      } finally {
        if (!controller.signal.aborted) setIsLoadingPartidos(false);
      }
    };

    const reload = () => { const operation = run(); partidosOperation.current = operation; return operation; };
    reloadPartidos.current = reload;
    void reload();
    return () => { controller.abort(); reloadPartidos.current = null; };
  }, [activeView, direction, expenseYear,firstMonth,lastMonth,isUnsupportedCargo, status]);

  const filteredItems = items;

  const filteredPartidos = useMemo(() => {
    const q = rankingSearch.toLocaleLowerCase('pt-BR');
    return q ? partidos.filter((p) => p.partido.toLocaleLowerCase('pt-BR').includes(q)) : partidos;
  }, [partidos, rankingSearch]);

  const maxDespesaPartido = useMemo(() => {
    return filteredPartidos.length > 0 ? Math.max(0, ...filteredPartidos.map((p) => p.totalDespesas ?? 0)) : 0;
  }, [filteredPartidos]);

  const displayedMetric = activeView === 'partidos' ? 'despesas' : metric;
  const activeMetric = metricOptions.find((option) => option.value === displayedMetric) ?? metricOptions[0];
  const activeStatusLabel = politicoStatusOptions.find((option) => option.value === status)?.label ?? status;
  const filteredTotal = isUnsupportedCargo ? 0 : rankingTotal?.context === contextKey ? rankingTotal.total : null;
  const resultCount = filteredTotal === null
    ? `${items.length.toLocaleString('pt-BR')} parlamentares carregados`
    : `Exibindo ${items.length.toLocaleString('pt-BR')} de ${filteredTotal.toLocaleString('pt-BR')} parlamentares`;
  const filteredExpenseTotal = isUnsupportedCargo ? 0 : expenseTotal?.filter === expenseFilterKey && !summaryMismatch ? expenseTotal.total : null;
  const currentStats=expenseTotal?.filter===expenseFilterKey&&!summaryMismatch?expenseTotal:null;
  const expenseLabel = filteredExpenseTotal === null ? null : money.format(filteredExpenseTotal).split(/\s+/);
  const mediaPorDeputado =
    filteredExpenseTotal !== null && filteredTotal ? filteredExpenseTotal / filteredTotal : null;

  const summaryCards = [
    {
      label: 'Parlamentares cadastrados',
      value: summaryMismatch ? '—' : totalCadastrados?.toLocaleString('pt-BR') ?? '—',
      hint: totalCadastrados === null ? (isLoadingSummary ? 'Consultando a base…' : 'Total indisponível') : 'Total na base, incluindo inativos',
      icon: Users,
    },
    {
      label: 'Nota média',
      value: currentStats?.ratingCount===0 ? 'Sem avaliações' : currentStats?.rating==null ? '—' : currentStats.rating.toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1}),
      hint: 'Das avaliações populares do filtro',
      icon: Star,
    },
    {
      label: 'Despesas',
      value: filteredExpenseTotal===0&&currentStats?.coverage?.status==='not_imported' ? 'Sem dados importados' : expenseLabel === null ? '—' : <>{expenseLabel[0]}{' '}<span className="inline-block whitespace-nowrap">{expenseLabel[1]}</span></>,
      hint: 'Todos os parlamentares do filtro',
      icon: BarChart3,
    },
    {
      label: 'Média por parlamentar',
      value: mediaPorDeputado === null ? 'n/d' : money.format(mediaPorDeputado).replace(/,\d{2}$/, ''),
      hint: 'Despesas do filtro / parlamentares',
      icon: Wallet,
    },
    {
      label: 'Votações',
      value: currentStats?.votesAvailable===false ? 'Dados ainda não importados' : currentStats?.votes==null ? '—' : currentStats.votes.toLocaleString('pt-BR'),
      hint: 'Registros importados dos parlamentares do filtro',
      icon: Landmark,
    },
  ];

  const sortBy = (value: MetricValue) => {
    if (metric === value) setDirection((current) => (current === 'desc' ? 'asc' : 'desc'));
    else {
      setMetric(value);
      setDirection('desc');
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      setLinkCopied(false);
    }
  };

  const exportCsv = () => {
    const header = ['posicao', 'nome', 'partido', 'uf', 'nota', 'avaliacoes', 'despesas', 'votacoes', 'participacao_pct', 'alinhamento_governo_pct', 'proposicoes', 'categoria_judicial', 'condenacoes_definitivas', 'condenacoes_em_recurso', 'prisoes_confirmadas', 'cobertura_judicial', 'ultima_verificacao_judicial', 'processos_contra_identificados', 'processos_ativos_contra', 'investigacoes', 'cobertura_processos', 'data_consulta_processos'];
    const rows = filteredItems.map((p, index) => {
      const ind = indicadores.get(p.id);
      const expenseKnown = p.totalDespesas !== 0 || (currentStats?.coverage && currentStats.coverage.status !== 'not_imported');
      const votesKnown = p.totalVotacoes > 0 || currentStats?.votesAvailable === true;
      const finalCount = convictionCount(p.judicial, category);
      return [metricUnknown(metric, p.judicial, category) ? '' : index + 1, p.nome, p.partido, p.estado, p.notaMedia.toFixed(2), p.totalAvaliacoes ?? '', expenseKnown && p.totalDespesas != null ? p.totalDespesas.toFixed(2) : '', votesKnown ? p.totalVotacoes : '', ind?.participacao ?? '', ind?.alinhamentoGoverno ?? '', ind?.proposicoes ?? '', judicialCategories[category], finalCount ?? '', finalCount === null ? '' : p.judicial!.counts[category].appeal, p.judicial?.confirmedImprisonments ?? '', p.judicial?.coverage.status ?? 'UNAVAILABLE', p.judicial?.lastCheckedAt ?? '', p.judicial?.proceedings?.againstPerson ?? '', p.judicial?.proceedings?.activeAgainstPerson ?? '', p.judicial?.proceedings?.investigations ?? '', p.judicial?.proceedings?.coverage.status ?? 'NOT_RESEARCHED', p.judicial?.proceedings?.coverage.checkedAt ?? ''];
    });
    const csv = [header, ...rows].map((row) => row.map(csvCell).join(';')).join('\n');
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], {type: 'text/csv;charset=utf-8'}));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `ranking-parlamentar-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const cellPad = density === 'compacta' ? 'py-2.5' : 'py-4';

  const SortHeader: React.FC<{value: MetricValue; label: string; hint: string; align?: 'left' | 'right'}> = ({value, label, hint, align = 'right'}) => {
    const active = metric === value;
    return (
      <th
        aria-sort={active ? (direction === 'desc' ? 'descending' : 'ascending') : undefined}
        className={cn('px-3 py-3 text-xs font-medium text-slate-500 dark:text-slate-400', align === 'right' ? 'text-right' : 'text-left', active && 'text-slate-900 dark:text-slate-50')}
      >
        <button
          type="button"
          onClick={() => sortBy(value)}
          aria-label={`Ordenar por ${hint}`}
          className={cn('inline-flex items-center gap-1 rounded-md hover:text-slate-900 dark:hover:text-slate-50', align === 'right' && 'flex-row-reverse')}
        >
          <span>{label}</span>
          {active ? (direction === 'desc' ? <ArrowDown size={12} aria-hidden="true" /> : <ArrowUp size={12} aria-hidden="true" />) : null}
        </button>
      </th>
    );
  };

  return (
    <div className="ranking-page w-full px-4 py-6 pb-28 sm:px-6 sm:py-8 lg:px-8 xl:px-10" style={{overflowAnchor: 'none'}}>
      {(activeView === 'parlamentares' ? error : partidosError) && <p role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-200">{activeView === 'parlamentares' ? error : partidosError}</p>}
      <header className="mb-6 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl dark:text-slate-50">Ranking parlamentar</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 sm:text-base dark:text-slate-400">
            Compare avaliações populares, gastos, votações, processos e condenações verificadas de cada parlamentar. Marque até 3 para comparar.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 lg:items-end">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={copyLink}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              {linkCopied ? <Check size={15} aria-hidden="true" /> : <Link2 size={15} aria-hidden="true" />}
              {linkCopied ? 'Link copiado' : 'Copiar link do filtro'}
            </button>
            <button
              type="button"
              onClick={exportCsv}
              disabled={filteredItems.length === 0 || activeView !== 'parlamentares'}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:border-slate-300 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              <Download size={15} aria-hidden="true" /> Exportar CSV
            </button>
            <Link to="/metodologia" className="inline-flex h-9 items-center gap-1 px-2 text-sm font-medium text-brand-700 hover:underline dark:text-brand-300">
              Como funciona o ranking <ChevronRight size={16} aria-hidden="true" />
            </Link>
          </div>
          <p aria-live="polite" className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span aria-hidden="true" className={cn('h-1.5 w-1.5 shrink-0 rounded-full', catalogConnection === 'live' ? 'bg-emerald-500' : 'bg-amber-500')} />
            <span>{catalogConnectionLabels[catalogConnection]}{lastSuccess && ` às ${lastSuccess.toLocaleTimeString('pt-BR')}`}</span>
          </p>
        </div>
      </header>

      {activeView === 'parlamentares' && (
        <section aria-label="Resumo do ranking" className="surface mb-6 overflow-hidden">
          {summaryError && <p role="alert" className="px-4 py-3 text-sm text-rose-700 dark:text-rose-300">{summaryError} <button type="button" onClick={() => void loadSummary(true)} className="underline">Repetir resumo</button></p>}
          {summaryMismatch && <p role="status" className="px-4 py-3 text-sm text-amber-700 dark:text-amber-300">Resumo em atualização para acompanhar os resultados. <button type="button" onClick={() => {
              setIsLoadingRanking(true);
              const operation = loadRankingPage(0, undefined, Math.max(RANKING_PAGE_SIZE, visibleCount.current, reconciliationExtent.current), true);
              currentOperation.current = operation;
              const key = contextKey;
              void Promise.all([operation, loadSummary(true)]).finally(() => {if (context.current === key) setIsLoadingRanking(false);});
            }} className="underline">Atualizar resumo</button></p>}
          <dl className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-3 xl:grid-cols-5 dark:bg-slate-800">
            {summaryCards.map((card, index) => (
              <div key={card.label} className={cn('min-w-0 bg-white px-4 py-4 sm:px-5 dark:bg-slate-900', index === summaryCards.length - 1 && 'col-span-2 sm:col-span-1')}>
                <dt className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-400">
                  <card.icon size={15} aria-hidden="true" className={index === 0 ? 'text-brand-600 dark:text-brand-400' : 'text-slate-400'} />
                  {card.label}
                </dt>
                <dd className={cn('tabular mt-2 font-mono font-semibold tracking-tight text-slate-950 sm:text-2xl dark:text-slate-50', index === 2 ? cn('break-normal',expenseLabel&&expenseLabel[1].length>14?'text-xs min-[360px]:text-sm sm:text-base lg:text-lg xl:text-xl 2xl:text-2xl':'text-sm min-[360px]:text-base') : typeof card.value==='string'&&card.value.length>8 ? 'break-normal text-sm min-[360px]:text-base' : 'break-words text-xl')}>{card.value}</dd>
                <dd className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{card.hint}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section aria-label="Filtros do ranking" className="surface mb-5 p-4 sm:p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div role="group" aria-label="Comparar" className="grid shrink-0 grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
            {[
              {id: 'parlamentares' as const, label: 'Parlamentares'},
              {id: 'partidos' as const, label: 'Partidos'},
            ].map((view) => (
              <button
                key={view.id}
                type="button"
                onClick={() => setActiveView(view.id)}
                aria-pressed={activeView === view.id}
                className={cn(
                  'min-h-9 rounded-lg px-4 py-1.5 text-sm font-medium transition-colors',
                  activeView === view.id
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-slate-50'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-50',
                )}
              >
                {view.label}
              </button>
            ))}
          </div>

          <div className="flex w-full gap-2 md:max-w-xl">
            <label className="relative block min-w-0 flex-1">
              <span className="sr-only">{activeView === 'partidos' ? 'Buscar partidos' : 'Buscar parlamentares'}</span>
              <Search
                size={17}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={activeView === 'partidos' ? 'Buscar partido' : 'Buscar por nome, partido, UF ou cargo'}
                className="min-h-10 w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-10 pr-3 text-sm text-slate-900 placeholder:text-slate-500 focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-400 dark:focus:ring-brand-950"
              />
            </label>

            {search.trim() && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                Limpar
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_auto_minmax(320px,0.8fr)_auto] xl:items-end dark:border-slate-800">
          <div>
            <div className="mb-2 text-xs font-medium text-slate-600 dark:text-slate-400">
              Comparar por
            </div>
            <div role="group" aria-label="Métrica" className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
              {metricOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setMetric(option.value)}
                  aria-pressed={displayedMetric === option.value}
                  disabled={activeView === 'partidos' && option.value !== 'despesas'}
                  className={cn(
                    'min-h-9 flex-1 rounded-lg px-4 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45',
                    displayedMetric === option.value
                      ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-slate-50'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-50',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs font-medium text-slate-600 dark:text-slate-400">
              Ordem
            </div>
            <div role="group" aria-label="Ordem" className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
              {[
                {value: 'desc' as const, label: 'Maior', icon: TrendingUp},
                {value: 'asc' as const, label: 'Menor', icon: TrendingDown},
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setDirection(option.value)}
                  aria-pressed={direction === option.value}
                  className={cn(
                    'inline-flex min-h-9 items-center justify-center gap-2 rounded-lg px-4 py-1.5 text-sm font-medium transition-colors',
                    direction === option.value
                      ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-slate-50'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-50',
                  )}
                >
                  <option.icon size={15} />
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:col-span-2 xl:col-span-1">
            <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
              Cargo
              <select
                value={cargo}
                onChange={(event) => setCargo(event.target.value)}
                className="mt-2 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium normal-case text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-brand-950"
              >
                <option>Todos os Cargos</option>
                <option>Deputado Federal</option>
                <option>Senador</option>
              </select>
            </label>

            <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
              Status
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as PoliticoStatusFilter)}
                className="mt-2 min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium normal-case text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-brand-950"
              >
                {politicoStatusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {activeView === 'parlamentares' && (
            <div className="hidden lg:block">
              <div className="mb-2 text-xs font-medium text-slate-600 dark:text-slate-400">Densidade</div>
              <div role="group" aria-label="Densidade da tabela" className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
                {[
                  {value: 'compacta' as const, label: 'Compacta', icon: Rows4},
                  {value: 'confortavel' as const, label: 'Confortável', icon: Rows3},
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setDensity(option.value)}
                    aria-pressed={density === option.value}
                    className={cn(
                      'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                      density === option.value
                        ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-slate-50'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-50',
                    )}
                  >
                    <option.icon size={15} aria-hidden="true" />
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        {activeView === 'parlamentares' && <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-3 border-t border-slate-100 pt-4 dark:border-slate-800">
          <label className="w-full text-xs font-medium text-slate-600 sm:w-64 dark:text-slate-400">Categoria judicial
            <select value={category} onChange={event => setCategory(event.target.value as JudicialCategory)} className="mt-2 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
              {(Object.entries(judicialCategories) as Array<[JudicialCategory, string]>).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-300"><input type="checkbox" checked={prisonOnly} onChange={event => setPrisonOnly(event.target.checked)} className="h-4 w-4 accent-brand-600" />Somente com prisão confirmada</label>
          <p className="basis-full text-xs leading-5 text-slate-500 dark:text-slate-400">Condenações definitivas e decisões em recurso são contadas separadamente. Prisões não somam condenações. Processos contam casos únicos em que a pessoa é ré ou requerida; investigações e execuções ficam separadas. A cobertura atual é do STF e não é nacional. Não apurado não significa zero. <Link to="/metodologia#judicial" className="underline underline-offset-2">Critérios e cobertura</Link>.</p>
        </div>}
        <div role="group" aria-label="Período das despesas" className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-800">
          <p className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">Período das despesas</p>
          <div className="grid gap-3 sm:max-w-2xl sm:grid-cols-3">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">Ano das despesas
              <select value={expenseYear} onChange={event=>{setExpenseYear(event.target.value);setFirstMonth('1');setLastMonth('12');}} className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
                <option value="">Todos os anos</option>
                {availableYears.map(year=><option key={year} value={year}>{year}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">Mês inicial
              <select disabled={!expenseYear} value={firstMonth} onChange={event=>{setFirstMonth(event.target.value);if(Number(event.target.value)>Number(lastMonth))setLastMonth(event.target.value);}} className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-900 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
                {MONTHS.map((month,index)=><option key={month} value={index+1}>{month}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">Mês final
              <select disabled={!expenseYear} value={lastMonth} onChange={event=>{setLastMonth(event.target.value);if(Number(event.target.value)<Number(firstMonth))setFirstMonth(event.target.value);}} className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-medium text-slate-900 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
                {MONTHS.map((month,index)=><option key={month} value={index+1}>{month}</option>)}
              </select>
            </label>
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-500 dark:text-slate-400">O período selecionado se aplica aos gastos. Avaliações populares, votações e histórico judicial representam os dados disponíveis na base.</p>
          {yearsError && <p role="alert" className="mt-2 text-xs text-amber-700 dark:text-amber-300">Não foi possível carregar os anos disponíveis. A consulta de todos os anos continua disponível.</p>}
        </div>
      </section>

      {activeView==='parlamentares' && <div className="mb-5"><ExpenseCoverageNotice coverage={currentStats?.coverage} loading={isLoadingSummary} error={Boolean(summaryError)}/></div>}

      <div className="mb-3 flex flex-col justify-between gap-1 text-sm sm:flex-row sm:items-center sm:gap-4">
        {activeView === 'parlamentares' && <p aria-live="polite" className="tabular font-medium text-slate-700 dark:text-slate-200">{resultCount}<span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">{activeStatusLabel}</span></p>}
        <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">Comparando por <span className="font-semibold text-slate-700 dark:text-slate-300">{activeView === 'partidos' ? 'gastos declarados' : activeMetric.description}</span>, do {direction === 'desc' ? 'maior para o menor' : 'menor para o maior'}.</p>
      </div>

      {activeView === 'partidos' ? (
        <section className="surface overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6 dark:border-slate-800">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
                {direction === 'desc' ? 'Partidos que mais gastam' : 'Partidos que menos gastam'}
              </h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                Total de despesas somadas por partido, considerando o status selecionado.
              </p>
            </div>
            <div className="tabular font-mono text-sm text-slate-500 dark:text-slate-400">
              {filteredPartidos.length.toLocaleString('pt-BR')} partidos
            </div>
          </div>

          <div className="px-4 py-6 sm:px-6">
            {isLoadingPartidos && partidos.length === 0 ? (
              <div className="text-sm font-medium text-slate-500 dark:text-slate-400">Carregando...</div>
            ) : partidosError && partidos.length === 0 ? null : filteredPartidos.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 px-6 py-10 text-center text-sm font-medium text-slate-500 dark:border-slate-700 dark:text-slate-400">
                Nenhum partido encontrado para os filtros atuais.
              </div>
            ) : (
              <ol className="grid grid-cols-1 gap-x-10 gap-y-4 md:grid-cols-2">
                {filteredPartidos.map((p, index) => {
                  const pct =
                    maxDespesaPartido > 0
                      ? Math.max(0, Math.min(100, (p.totalDespesas / maxDespesaPartido) * 100))
                      : 0;

                  return (
                    <li key={`${p.partido}-${index}`}>
                      <div className="flex items-baseline justify-between gap-3">
                        <div className="flex flex-wrap items-baseline gap-x-2.5">
                          <span className="tabular w-6 font-mono text-xs text-slate-500 dark:text-slate-400">
                            {index + 1}
                          </span>
                          <Link to="/partidos" className="text-base font-semibold text-slate-900 hover:text-brand-700 dark:text-slate-50">
                            {p.partido}
                          </Link>
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            {p.totalPoliticos.toLocaleString('pt-BR')} parlamentares
                          </span>
                        </div>
                        <div className="tabular font-mono text-sm font-semibold text-slate-900 dark:text-slate-50">
                          {money.format(p.totalDespesas ?? 0)}
                        </div>
                      </div>
                      <div className="mt-2 pl-8" aria-hidden="true">
                        <div
                          className={cn('grow-bar h-2 rounded-full', index === 0 ? 'bg-brand-600 dark:bg-brand-400' : 'bg-brand-300 dark:bg-brand-700')}
                          style={{width: `${Math.max(pct, 1)}%`, animationDelay: `${index * 50}ms`}}
                        />
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </section>
      ) : (
        <div aria-busy={isLoadingRanking} className="surface overflow-hidden">
          {isLoadingRanking && filteredItems.length === 0 ? (
            <div className="space-y-3 px-6 py-6" aria-hidden="true">
              {Array.from({length: 8}, (_, index) => (
                <div key={index} className="flex items-center gap-4">
                  <div className="skeleton h-4 w-6" />
                  <div className="skeleton h-9 w-9 rounded-full" />
                  <div className="skeleton h-4 flex-1" />
                  <div className="skeleton h-4 w-24" />
                </div>
              ))}
              <span className="sr-only">Carregando ranking...</span>
            </div>
          ) : error && filteredItems.length === 0 ? null : filteredItems.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <div className="text-base font-semibold text-slate-900 dark:text-slate-50">
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
                  className="mt-5 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-900"
                >
                  Usar Deputado Federal
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="space-y-3 p-4 sm:p-6 lg:hidden">
                {filteredItems.map((p, index) => (
                  <RankingMobileCard key={p.id} politico={p} index={index} metric={metric} category={category} money={money} indicadores={indicadores.get(p.id)} votesAvailable={currentStats?.votesAvailable} expensesImported={currentStats?.coverage ? currentStats.coverage.status!=='not_imported' : null} />
                ))}
              </div>

              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full min-w-[1100px] border-collapse text-left">
                  <caption className="sr-only">Ranking parlamentar por {activeMetric.description}, em ordem {direction === 'desc' ? 'decrescente' : 'crescente'}</caption>
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/50">
                      <th className="w-10 px-3 py-3"><span className="sr-only">Comparar</span></th>
                      <th className="w-12 px-3 py-3 text-xs font-medium text-slate-500 dark:text-slate-400">#</th>
                      <th className="px-3 py-3 text-xs font-medium text-slate-500 dark:text-slate-400">Parlamentar</th>
                      <SortHeader value="nota" label="Nota" hint="nota popular" />
                      <th className="px-3 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400" title="Votos registrados / votações nominais no período do parlamentar">Participação</th>
                      <th className="px-3 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400" title="Votos iguais à orientação do governo">Alinh. governo</th>
                      <SortHeader value="despesas" label="Despesas" hint="despesas declaradas" />
                      <SortHeader value="condenacoes" label="Condenações" hint="condenações definitivas" />
                      <SortHeader value="processos" label="Processos" hint="processos contra identificados" />
                      <SortHeader value="votacoes" label="Votações" hint="número de votações" />
                      <th className="px-3 py-3 text-right text-xs font-medium text-slate-500 dark:text-slate-400">Proposições</th>
                      <th className="px-3 py-3 text-xs font-medium text-slate-500 dark:text-slate-400">Gastos 12 meses</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {filteredItems.map((p, index) => {
                      const ind = indicadores.get(p.id);
                      const selected = compare.has(p.id);
                      const diff = mediaPorDeputado ? Math.round(((p.totalDespesas - mediaPorDeputado) / mediaPorDeputado) * 100) : null;
                      return (
                    <tr
                      key={p.id}
                      className={cn('group transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40', selected && 'bg-brand-50/60 dark:bg-brand-950/30')}
                    >
                        <td className={cn('px-3', cellPad)}>
                          <input
                            type="checkbox"
                            checked={selected}
                            disabled={!selected && compare.isFull}
                            onChange={() => compare.toggle({id: p.id, nome: p.nome, partido: p.partido, estado: p.estado, foto: p.foto})}
                            aria-label={`Comparar ${p.nome}`}
                            className="h-4 w-4 cursor-pointer rounded accent-brand-600 disabled:cursor-not-allowed"
                          />
                        </td>
                        <td className={cn('tabular px-3 font-mono text-sm text-slate-500 dark:text-slate-400', cellPad)}>
                          {metricUnknown(metric, p.judicial, category) ? <span aria-label="Sem classificação">—</span> : index + 1}
                        </td>
                        <td className={cn('px-3', cellPad)}>
                          <Link to={`/politico/${p.id}`} className="flex items-center gap-3">
                            <img
                              src={p.foto}
                              alt={p.nome}
                              className={cn('rounded-full object-cover ring-1 ring-slate-200 dark:ring-slate-700', density === 'compacta' ? 'h-8 w-8' : 'h-10 w-10')}
                              loading="lazy"
                              decoding="async"
                              referrerPolicy="no-referrer"
                            />
                            <div className="min-w-0">
                              <div className="font-semibold text-slate-900 transition-colors group-hover:text-brand-700 dark:text-slate-50 dark:group-hover:text-brand-300">
                                {p.nome}
                              </div>
                              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                                <span>{p.partido} / {p.estado}</span>
                                <span
                                  className={cn(
                                    'inline-flex rounded-full px-1.5 py-px text-[10px] font-semibold ring-1 ring-inset',
                                    getPoliticoStatusClasses(p),
                                  )}
                                >
                                  {getPoliticoStatusLabel(p)}
                                </span>
                                <span className="sr-only">{p.cargo}</span>
                              </div>
                            </div>
                          </Link>
                        </td>
                        <td className={cn('px-3 text-right', cellPad)}>
                          <span className="tabular inline-flex items-center gap-1 font-mono text-sm font-semibold text-slate-900 dark:text-slate-50">
                            {hasRating(p) && <Star size={12} aria-hidden="true" className="fill-amber-400 text-amber-400" />}
                            {hasRating(p) ? p.notaMedia.toFixed(1) : <span className="font-sans text-xs font-normal text-slate-500 dark:text-slate-400">Sem avaliações</span>}
                          </span>
                          {typeof p.totalAvaliacoes === 'number' && (
                            <span className="block text-[11px] text-slate-500 dark:text-slate-400">{p.totalAvaliacoes.toLocaleString('pt-BR')} aval.</span>
                          )}
                        </td>
                        <td className={cn('px-3 text-right', cellPad)}>
                          <span className="tabular font-mono text-sm text-slate-700 dark:text-slate-300">{ind ? formatPercent(ind.participacao) : '…'}</span>
                          {ind?.participacao != null && (
                            <span aria-hidden="true" className="ml-auto mt-1 block h-[3px] rounded-full bg-emerald-500" style={{width: `${Math.min(64, ind.participacao * 0.64)}px`}} />
                          )}
                        </td>
                        <td className={cn('px-3 text-right', cellPad)}>
                          <span className="tabular font-mono text-sm text-slate-700 dark:text-slate-300">{ind ? formatPercent(ind.alinhamentoGoverno) : '…'}</span>
                          {ind?.alinhamentoGoverno != null && (
                            <span aria-hidden="true" className="ml-auto mt-1 block h-[3px] rounded-full bg-brand-500" style={{width: `${Math.min(64, ind.alinhamentoGoverno * 0.64)}px`}} />
                          )}
                        </td>
                        <td className={cn('px-3 text-right', cellPad)}>
                          <span className="tabular font-mono text-sm font-semibold text-slate-900 dark:text-slate-50">{expenseText(p.totalDespesas, currentStats?.coverage ? currentStats.coverage.status!=='not_imported' : null, money)}</span>
                          {diff !== null && (
                            <span className={cn('tabular block font-mono text-[11px]', diff > 10 ? 'text-rose-700 dark:text-rose-300' : diff < -10 ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-500 dark:text-slate-400')}>
                              {diff > 0 ? '+' : ''}{diff}% vs média
                            </span>
                          )}
                        </td>
                        <td className={cn('min-w-48 px-3 text-right', cellPad)}>
                          <Link to={`/politico/${p.id}#historico-judicial`} aria-label={`Ver histórico judicial de ${p.nome}`} className="block rounded-md hover:underline focus-visible:outline-2 focus-visible:outline-brand-500"><JudicialRankingAttributes summary={p.judicial} category={category} /></Link>
                        </td>
                        <td className={cn('min-w-52 px-3 text-right', cellPad)}><Link to={`/politico/${p.id}#historico-judicial`} aria-label={`Ver processos de ${p.nome}`} className="block rounded-md hover:underline focus-visible:outline-2 focus-visible:outline-brand-500"><ProceedingsRankingAttributes summary={p.judicial}/></Link></td>
                        <td className={cn('tabular px-3 text-right font-mono text-sm text-slate-700 dark:text-slate-300', cellPad)}>
                          {votesText(p.totalVotacoes, currentStats?.votesAvailable)}
                        </td>
                        <td className={cn('tabular px-3 text-right font-mono text-sm text-slate-700 dark:text-slate-300', cellPad)}>
                          {ind ? ind.proposicoes.toLocaleString('pt-BR') : '…'}
                        </td>
                        <td className={cn('px-3', cellPad)}>
                          {ind ? <Sparkline data={ind.gastosMensais} label={p.nome} /> : <span className="skeleton block h-5 w-20" aria-hidden="true" />}
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {hasMoreRankingItems && (
                <div className="border-t border-slate-100 px-4 py-5 text-center dark:border-slate-800 sm:px-6">
                  <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">{items.length.toLocaleString('pt-BR')} resultados carregados</p>
                  <button
                    type="button"
                    disabled={isLoadingRanking}
                    onClick={async () => {
                      if (pendingPage.current) return;
                      const key = contextKey;
                      setIsLoadingRanking(true);
                      try {
                        const operation = loadRankingPage(items.length);
                        currentOperation.current = operation;
                        await operation;
                      } finally {
                        if (context.current === key) setIsLoadingRanking(false);
                      }
                    }}
                    className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                  >
                    {isLoadingRanking ? 'Carregando...' : 'Carregar mais'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
      <CompareTray />
    </div>
  );
};
