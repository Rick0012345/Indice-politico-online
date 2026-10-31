import {ExpenseCoverageNotice} from '../components/ExpenseCoverageNotice';
import {ExpenseBreakdown} from '../components/ExpenseBreakdown';
import type {ExpenseAnalysis} from '../lib/expenseAnalyticsTypes';
import {useCatalogRefresh} from '../hooks/useCatalogRefresh';
import React, {Suspense, lazy, useEffect, useMemo, useRef, useState} from 'react';
import { useParams, Link, useSearchParams, useLocation, useNavigate } from 'react-router-dom';
import {JudicialProfile} from '../components/judicial/JudicialProfile';
import {JudicialAttributes} from '../components/judicial/JudicialAttributes';
import type {JudicialSummary} from '../lib/judicialTypes';
import {
  Star,
  ChevronRight,
  ChevronLeft,
  Calendar,
  FileText,
  DollarSign,
  AlertCircle,
  CheckCircle2,
  XCircle,
  MinusCircle,
  ExternalLink,
  BarChart3,
  Landmark,
  Users,
  BriefcaseBusiness,
  ArrowLeftRight,
  Check,
} from 'lucide-react';
import {compareHref, useCompare} from '../lib/compare';
import {brlCompact, fetchIndicadores, formatPercent, type Indicadores, type MediaCamara} from '../lib/indicadores';
import {RaioXGastos} from '../components/profile/RaioXGastos';
import { cn } from '../lib/utils';
import {
  getPoliticoSituacaoLabel,
  getPoliticoStatusClasses,
  getPoliticoStatusLabel,
} from '../lib/politicoStatus';

const EvaluationModal = lazy(() =>
  import('../components/EvaluationModal').then((module) => ({default: module.EvaluationModal})),
);
const SpendingChart = lazy(() =>
  import('../components/SpendingChart').then((module) => ({default: module.SpendingChart})),
);

type PoliticoDetail = {
  judicial?: JudicialSummary;
  id: string;
  nome: string;
  partido: string;
  estado: string;
  cargo: string;
  foto: string;
  notaMedia: number;
  totalAvaliacoes: number;
  votacoesDisponiveis?: boolean;
  ativo?: boolean | null;
  situacao?: string | null;
  presenca?: number | null;
  alinhamentoGoverno?: number | null;
  nomeCivil?: string | null;
  dataNascimento?: string | null;
  sexo?: string | null;
  email?: string | null;
  telefone?: string | null;
  idLegislatura?: number | null;
  dataUltimoStatus?: string | null;
  nomeEleitoral?: string | null;
  condicaoEleitoral?: string | null;
  urlWebsite?: string | null;
  redesSociais?: string[];
  escolaridade?: string | null;
  municipioNascimento?: string | null;
  ufNascimento?: string | null;
  gabineteNome?: string | null;
  gabinetePredio?: string | null;
  gabineteSala?: string | null;
  gabineteAndar?: string | null;
};

type VotacaoItem = {
  votoId: string;
  politicoId: string;
  votacaoId: string;
  siglaTipo: string | null;
  numero: number | null;
  ano: number | null;
  ementa: string | null;
  resultado?: string | null;
  proposicaoObjeto?: string | null;
  uriProposicaoObjeto?: string | null;
  proposicaoId?: string | null;
  proposicaoSiglaTipo?: string | null;
  proposicaoNumero?: number | null;
  proposicaoAno?: number | null;
  proposicaoEmenta?: string | null;
  tituloPublico?: string | null;
  resumoLeigo?: string | null;
  tipoVotacao: string;
  ehSubvotacao: boolean;
  classificacaoFonte: string;
  classificacaoConfianca: string;
  classificacaoVersao: string;
  classificacaoJustificativa?: string | null;
  proposicaoPrincipalId?: string | null;
  proposicaoPrincipalSiglaTipo?: string | null;
  proposicaoPrincipalNumero?: number | null;
  proposicaoPrincipalAno?: number | null;
  proposicaoPrincipalEmenta?: string | null;
  dataVotacao: string | null;
  voto: string;
};

type VotacaoDetail = {
  votacaoId: string;
  textoOficial: string | null;
  proposicaoObjeto: string | null;
  tipoVotacao: string;
  ehSubvotacao: boolean;
  classificacaoFonte: string;
  classificacaoConfianca: string;
  classificacaoVersao: string;
  classificacaoJustificativa: string | null;
  objetosPossiveis: Array<{id: string | null; siglaTipo: string | null; numero: number | null; ano: number | null; ementa: string | null}>;
  proposicoesAfetadas: Array<{id: string | null; siglaTipo: string | null; numero: number | null; ano: number | null; ementa: string | null; efeito: string | null}>;
};

type DespesaItem = {
  id: string;
  ano: number;
  mes: number;
  tipo: string;
  valor: number;
  urlDocumento: string | null;
  fornecedor: string | null;
};

type AtuacaoOrgao = {
  orgaoId: string;
  siglaOrgao: string | null;
  nomeOrgao: string | null;
  nomePublicacao: string | null;
  titulo: string | null;
  dataInicio: string | null;
  dataFim: string | null;
  tipoOrgao: string | null;
};

type AtuacaoEvento = {
  id: string;
  dataHoraInicio: string | null;
  situacao: string | null;
  descricaoTipo: string | null;
  descricao: string | null;
  localExterno: string | null;
  localCamara: {nome?: string; predio?: string; sala?: string} | null;
  urlRegistro: string | null;
};

type AtuacaoFrente = {
  id: string;
  titulo: string | null;
  idLegislatura: number | null;
  uri: string | null;
};

type AtuacaoHistorico = {
  titulo: string | null;
  entidade?: string | null;
  entidadeUf?: string | null;
  entidadePais?: string | null;
  anoInicio?: number | null;
  anoFim?: number | null;
  dataHora?: string | null;
};

type AtuacaoProposicao = {
  id: string;
  siglaTipo: string | null;
  numero: number | null;
  ano: number | null;
  ementa: string | null;
  dataApresentacao: string | null;
  urlInteiroTeor: string | null;
  situacao: string | null;
};

type AtuacaoData = {
  orgaos: AtuacaoOrgao[];
  eventos: AtuacaoEvento[];
  frentes: AtuacaoFrente[];
  profissoes: AtuacaoHistorico[];
  ocupacoes: AtuacaoHistorico[];
  proposicoes: AtuacaoProposicao[];
};

const ResponsiveExpenseCard: React.FC<{
  despesa: DespesaItem;
  currencyFormatter: Intl.NumberFormat;
}> = ({despesa, currencyFormatter}) => {
  const data = `${String(despesa.mes).padStart(2, '0')}/${despesa.ano}`;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Competência</div>
          <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-50">{data}</div>
        </div>
        <div className="text-right">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Valor</div>
          <div className="mt-1 text-sm font-bold text-slate-900 dark:text-slate-50">
            {currencyFormatter.format(despesa.valor)}
          </div>
        </div>
      </div>

      <div className="mt-4">
        <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Tipo</div>
        <div className="mt-1 break-words text-sm font-semibold text-slate-900 dark:text-slate-50">
          {despesa.tipo}
        </div>
      </div>

      {despesa.fornecedor && (
        <div className="mt-4">
          <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Fornecedor
          </div>
          <div className="mt-1 break-words text-sm text-slate-600 dark:text-slate-400">{despesa.fornecedor}</div>
        </div>
      )}

      {despesa.urlDocumento && (
        <a
          href={despesa.urlDocumento}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-brand-700 hover:underline dark:text-brand-300"
        >
          Ver documento <ExternalLink size={14} />
        </a>
      )}
    </div>
  );
};

export const PoliticoProfile = () => {
  const { id } = useParams();
  const [profileParams, setProfileParams] = useSearchParams();
  const tabParam = profileParams.get('tab');
  const activeTab = tabParam && ['geral', 'atuacao', 'votacoes', 'despesas', 'noticias'].includes(tabParam) ? tabParam : 'geral';
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (tabParam !== 'judicial') return;
    const params = new URLSearchParams(profileParams);
    params.set('tab', 'geral');
    navigate({pathname: location.pathname, search: params.toString(), hash: '#historico-judicial'}, {replace: true});
  }, [tabParam, profileParams, location.pathname, navigate]);
  const setActiveTab = (tab: string) => setProfileParams(previous => {const next = new URLSearchParams(previous); next.set('tab', tab); return next;});
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [politico, setPolitico] = useState<PoliticoDetail | null>(null);
  const [votacoes, setVotacoes] = useState<VotacaoItem[]>([]);
  const [despesas, setDespesas] = useState<DespesaItem[]>([]);
  const [isLoadingPolitico, setIsLoadingPolitico] = useState(true);
  useEffect(() => {
    if (isLoadingPolitico || activeTab !== 'geral' || location.hash !== '#historico-judicial') return;
    document.getElementById('historico-judicial')?.scrollIntoView?.({block: 'start'});
  }, [isLoadingPolitico, activeTab, location.hash]);
  const tabsContainer = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = tabsContainer.current;
    const selected = container?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
    if (!container || !selected) return;
    const left = selected.offsetLeft - container.offsetLeft;
    if (left < container.scrollLeft) container.scrollLeft = left;
    else if (left + selected.offsetWidth > container.scrollLeft + container.clientWidth) container.scrollLeft = left + selected.offsetWidth - container.clientWidth;
  }, [activeTab, isLoadingPolitico]);
  const [isLoadingVotacoes, setIsLoadingVotacoes] = useState(false);
  const [isLoadingDespesas, setIsLoadingDespesas] = useState(false);
  const [isLoadingMoreVotacoes, setIsLoadingMoreVotacoes] = useState(false);
  const [isLoadingMoreDespesas, setIsLoadingMoreDespesas] = useState(false);
  const [expandedVotoId, setExpandedVotoId] = useState<string | null>(null);
  const [votacoesFiltro, setVotacoesFiltro] = useState({
    texto: '',
    voto: '',
    tipo: '',
    ano: '',
  });
  const [despesasFiltro, setDespesasFiltro] = useState({
    tipo: '',
    ano: '',
    mes: '',
    valorMin: '',
    valorMax: '',
    fornecedorId: '',
  });
  const [votacoesNextCursor, setVotacoesNextCursor] = useState<string | null>(null);
  const [votacaoDetails, setVotacaoDetails] = useState<Record<string, VotacaoDetail>>({});
  const [loadingVotacaoDetailId, setLoadingVotacaoDetailId] = useState<string | null>(null);
  const [fornecedorLabel, setFornecedorLabel] = useState('');
  const [expenseAnalysis, setExpenseAnalysis] = useState<{context: string; data: ExpenseAnalysis} | null>(null);
  const [isLoadingAnalysis, setIsLoadingAnalysis] = useState(false);
  const [despesasOffset, setDespesasOffset] = useState(0);
  const [despesasQuantidade, setDespesasQuantidade] = useState<number | null>(null);
  const [despesasTotal, setDespesasTotal] = useState<number | null>(null);
  const [despesasOpcoesTipo, setDespesasOpcoesTipo] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [atuacaoLoaded, setAtuacaoLoaded] = useState(false);
  const contextKey = JSON.stringify([id, activeTab, despesasFiltro, votacoesFiltro]);
  const context = useRef(contextKey);
  context.current = contextKey;
  const pages = useRef<{despesas?: AbortController; votacoes?: AbortController}>({});
  useEffect(() => {
    setIsLoadingMoreDespesas(false);
    setIsLoadingMoreVotacoes(false);
    pages.current = {};
    return () => { pages.current.despesas?.abort(); pages.current.votacoes?.abort(); };
  }, [contextKey]);
  useEffect(() => {
    setAtuacao({orgaos: [], eventos: [], frentes: [], profissoes: [], ocupacoes: [], proposicoes: []});
    setAtuacaoLoaded(false);
    setIsModalOpen(false);
    setErrors({});
    setExpandedVotoId(null);
    setVotacaoDetails({});
  }, [id]);
  const reportError = (area: string, message: string) => setErrors(current => ({...current, [area]: message}));
  const expenseParams = (offset: number) => {
    const params = new URLSearchParams({limit: '200', offset: String(offset)});
    (Object.entries(despesasFiltro) as [string, string][]).forEach(([key, value]) => { if (value.trim()) params.set(key, key === 'tipo' ? value.trim() : value.trim().replace(',', '.')); });
    return params;
  };
  const [votacoesHasMore, setVotacoesHasMore] = useState(false);
  const [despesasHasMore, setDespesasHasMore] = useState(false);
  const [votacoesAnosDisponiveis, setVotacoesAnosDisponiveis] = useState<number[]>([]);
  const [votacoesTiposDisponiveis, setVotacoesTiposDisponiveis] = useState<string[]>([]);
  const [votacoesVotosDisponiveis, setVotacoesVotosDisponiveis] = useState<string[]>([]);
  const [despesasAnosDisponiveis, setDespesasAnosDisponiveis] = useState<number[]>([]);
  const [despesasResumo, setDespesasResumo] = useState<{ano: number; mes: number; total: number}[]>([]);
  const [despesasMedia, setDespesasMedia] = useState<{ano: number; mes: number; media: number; participantes: number}[]>([]);
  const [atuacao, setAtuacao] = useState<AtuacaoData>({
    orgaos: [],
    eventos: [],
    frentes: [],
    profissoes: [],
    ocupacoes: [],
    proposicoes: [],
  });
  const [isLoadingAtuacao, setIsLoadingAtuacao] = useState(false);
  const {revision, refreshing} = useCatalogRefresh(contextKey, isLoadingPolitico || (activeTab === 'votacoes' && (isLoadingVotacoes || isLoadingMoreVotacoes)) || (activeTab === 'despesas' && (isLoadingDespesas || isLoadingMoreDespesas || isLoadingAnalysis)) || (activeTab === 'atuacao' && isLoadingAtuacao));
  const extent = useRef({context: contextKey, despesas: 0, votacoes: 0});
  if (extent.current.context !== contextKey) extent.current = {context: contextKey, despesas: 0, votacoes: 0};
  else {extent.current.despesas = Math.max(extent.current.despesas, despesas.length); extent.current.votacoes = Math.max(extent.current.votacoes, votacoes.length);}


  const formatarData = (value: string | null | undefined) => {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
  };

  const formatarDataVotacao = (value: string | null) => formatarData(value);

  const normalizeVoteText = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();

  const isGenericVoteSummary = (value: string | null | undefined) => {
    const text = normalizeVoteText(value).toLowerCase();
    if (!text) return true;
    return (
      /^aprovad[oa]s?(,|\s|\.|$)/.test(text) ||
      /^rejeitad[oa]s?(,|\s|\.|$)/.test(text) ||
      /^prejudicad[oa]s?(,|\s|\.|$)/.test(text) ||
      /^retirad[oa]s?(,|\s|\.|$)/.test(text)
    );
  };

  const buildTemaPublicoVotacao = (v: VotacaoItem) => {
    const text = normalizeVoteText(
      `${v.proposicaoObjeto ?? ''} ${v.proposicaoEmenta ?? ''} ${v.ementa ?? ''}`,
    ).toLowerCase();

    if (text.includes('6x1') || (text.includes('escala') && text.includes('jornada'))) {
      return 'Redução da jornada de trabalho e fim da escala 6x1';
    }

    if (text.includes('violência doméstica') || text.includes('violencia domestica') || text.includes('agressores')) {
      return 'Monitoramento de agressores em casos de violência doméstica';
    }

    if (text.includes('simples nacional')) {
      return 'Mudanças no Simples Nacional';
    }

    if (
      text.includes('alimentação escolar') ||
      text.includes('alimentacao escolar') ||
      text.includes('programa nacional de alimentação escolar') ||
      text.includes('programa nacional de alimentacao escolar')
    ) {
      return 'Alimentação escolar nas escolas públicas';
    }

    return null;
  };

  const buildVotacaoDisplay = (v: VotacaoItem) => {
    const tituloPublico = normalizeVoteText(v.tituloPublico);
    const resumoLeigo = normalizeVoteText(v.resumoLeigo);
    const assunto = normalizeVoteText(v.proposicaoEmenta);
    const objeto = normalizeVoteText(v.proposicaoObjeto);
    const decisao = normalizeVoteText(v.resultado ?? v.ementa);
    const temaPublico = buildTemaPublicoVotacao(v);
    const identificador =
      objeto ||
      (v.proposicaoSiglaTipo && v.proposicaoNumero && v.proposicaoAno
        ? `${v.proposicaoSiglaTipo} ${v.proposicaoNumero}/${v.proposicaoAno}`
        : v.siglaTipo && v.numero && v.ano
          ? `${v.siglaTipo} ${v.numero}/${v.ano}`
          : '');

    if (tituloPublico) {
      return {
        titulo: tituloPublico,
        contexto: resumoLeigo && resumoLeigo !== tituloPublico ? resumoLeigo : decisao || null,
        assunto: resumoLeigo || tituloPublico,
        identificador,
      };
    }

    if (temaPublico) {
      return {
        titulo: temaPublico,
        contexto: assunto || decisao || null,
        assunto: temaPublico,
        identificador,
      };
    }

    if (assunto) {
      return {
        titulo: identificador ? `${identificador}: ${assunto}` : assunto,
        contexto: decisao && decisao !== assunto ? decisao : null,
        assunto,
        identificador,
      };
    }

    if (objeto && decisao) {
      return {titulo: `${objeto}: ${decisao}`, contexto: null, assunto: decisao, identificador: objeto};
    }

    if (decisao && !isGenericVoteSummary(decisao)) {
      return {titulo: decisao, contexto: null, assunto: decisao, identificador};
    }

    return {
      titulo: identificador ? `Votação sobre ${identificador}` : decisao || 'Votação',
      contexto: decisao || null,
      assunto: decisao || null,
      identificador,
    };
  };

  const formatarLinkLabel = (value: string, fallback: string) => {
    try {
      return new URL(value).hostname.replace(/^www\./, '');
    } catch {
      return fallback;
    }
  };

  useEffect(() => {
    const politicoId = id?.trim();
    if (!politicoId) return;

    const controller = new AbortController();
    if (!refreshing) setPolitico(null);
    setIsLoadingPolitico(true);

    const run = async () => {
      try {
        const politicoRes = await fetch(`/api/politicos/${encodeURIComponent(politicoId)}`, {
          signal: controller.signal,
        });
        if (politicoRes.ok) {
          const data = (await politicoRes.json()) as {politico?: PoliticoDetail};
          if (controller.signal.aborted) return;
          if (data.politico) {
            setPolitico({
              ...data.politico,
              foto: data.politico.foto || `https://picsum.photos/seed/${data.politico.id}/400/400`,
              redesSociais: Array.isArray(data.politico.redesSociais)
                ? data.politico.redesSociais.filter(
                    (item): item is string => typeof item === 'string' && item.trim().length > 0,
                  )
                : [],
            });
          } else {
            setPolitico(null);
          }
        } else {
          if (!controller.signal.aborted) { if (!refreshing) setPolitico(null); if (politicoRes.status !== 404) reportError('perfil', 'Não foi possível carregar o perfil. Tente novamente.'); }
        }
      } catch {
        if (!controller.signal.aborted) { if (!refreshing) setPolitico(null); reportError('perfil', 'Não foi possível carregar o perfil. Tente novamente.'); }
      } finally {
        if (!controller.signal.aborted) setIsLoadingPolitico(false);
      }
    };

    run();
    return () => controller.abort();
  }, [id, revision]);

  useEffect(() => {
    const politicoId = id?.trim();
    if (!politicoId || activeTab !== 'despesas') return;
    reportError('anos', '');
    reportError('grafico', '');

    const controller = new AbortController();

    const run = async () => {
      try {
        const normalizarAnos = (items?: unknown[]) => {
          const parsed = (items ?? [])
            .map((value) => {
              if (typeof value === 'number') return value;
              if (typeof value === 'string') return Number(value);
              return Number.NaN;
            })
            .filter((v) => Number.isFinite(v));
          return Array.from(new Set<number>(parsed)).sort((a, b) => b - a);
        };

        const despesasAnosRes = await fetch(
          `/api/politicos/${encodeURIComponent(politicoId)}/despesas/anos`,
          {signal: controller.signal},
        );

        if (despesasAnosRes.ok) {
          const data = (await despesasAnosRes.json()) as {items?: unknown[]};
          if (!controller.signal.aborted) setDespesasAnosDisponiveis(normalizarAnos(data.items));
        } else {
          if (!controller.signal.aborted) reportError('anos', 'Não foi possível carregar os anos disponíveis.');
        }
      } catch {
        if (!controller.signal.aborted) reportError('anos', 'Não foi possível carregar os anos disponíveis.');
      }
    };

    run();
    return () => controller.abort();
  }, [activeTab, id, revision]);

  useEffect(() => {
    const politicoId = id?.trim();
    if (!politicoId || activeTab !== 'votacoes') return;

    const controller = new AbortController();
    const pageSize = 30;
    const ano = votacoesFiltro.ano ? Number(votacoesFiltro.ano) : null;

    setIsLoadingVotacoes(true);
    reportError('votacoes', '');
    if (!refreshing) {
      setVotacoes([]);
      setVotacoesNextCursor(null);
      setVotacoesHasMore(false);
    }

    const run = async () => {
      try {
        const params = new URLSearchParams();
        params.set('limit', String(pageSize));
        if (ano != null && Number.isFinite(ano)) params.set('ano', String(ano));
        if (votacoesFiltro.voto) params.set('voto', votacoesFiltro.voto);
        if (votacoesFiltro.tipo) params.set('tipoVotacao', votacoesFiltro.tipo);
        if (votacoesFiltro.texto.trim()) params.set('q', votacoesFiltro.texto.trim());

        const target = refreshing ? Math.max(pageSize, extent.current.votacoes) : pageSize;
        const items: VotacaoItem[] = [];
        let data: {items?: VotacaoItem[]; nextCursor?: string | null; meta?: {anos?: number[]; tiposVotacao?: string[]; votos?: string[]}} = {};
        do {
          params.set('limit', String(Math.min(50, target - items.length)));
          const res = await fetch(`/api/politicos/${encodeURIComponent(politicoId)}/votacoes?${params.toString()}`, {signal: controller.signal});
          if (!res.ok) throw new Error('HTTP');
          data = await res.json();
          if (controller.signal.aborted) return;
          const page = data.items ?? [];
          items.push(...page);
          if (!page.length || !data.nextCursor || data.nextCursor === params.get('cursor')) break;
          params.set('cursor', data.nextCursor);
        } while (refreshing && items.length < target);
        setVotacoes(items);
        setVotacoesNextCursor(data.nextCursor ?? null);
        setVotacoesHasMore(Boolean(data.nextCursor));
        setVotacoesAnosDisponiveis(data.meta?.anos ?? []);
        setVotacoesTiposDisponiveis(data.meta?.tiposVotacao ?? []);
        setVotacoesVotosDisponiveis(data.meta?.votos ?? []);
      } catch {
        if (!controller.signal.aborted) { if (!refreshing) setVotacoes([]); reportError('votacoes', 'Não foi possível carregar votações. Tente novamente.'); }
      } finally {
        if (!controller.signal.aborted) setIsLoadingVotacoes(false);
      }
    };

    const timer = window.setTimeout(run, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [activeTab, id, votacoesFiltro.ano, votacoesFiltro.texto, votacoesFiltro.tipo, votacoesFiltro.voto, revision]);

  useEffect(() => {
    const politicoId = id?.trim();
    if (!politicoId || activeTab !== 'despesas') return;

    const controller = new AbortController();
    setIsLoadingDespesas(true);
    if (!refreshing) {
      setDespesas([]);
      setDespesasOffset(0);
      setDespesasHasMore(false);
      setDespesasTotal(null);
      setDespesasQuantidade(null);
    }
    reportError('despesas', '');
    const run = async () => {
      try {
        const target = refreshing ? Math.max(200, extent.current.despesas) : 200;
        const items: DespesaItem[] = [];
        let data;
        do {
          const params = expenseParams(items.length);
          params.set('limit', String(Math.min(2000, target - items.length)));
          const res = await fetch(`/api/politicos/${encodeURIComponent(politicoId)}/despesas?${params}`, {signal: controller.signal});
          if (!res.ok) throw new Error('HTTP');
          data = await res.json();
          if (controller.signal.aborted) return;
          const page = data.items ?? [];
          items.push(...page);
          if (!page.length || data.hasMore !== true) break;
        } while (refreshing && items.length < target);
        setDespesas(items);
        setDespesasOffset(items.length);
        setDespesasHasMore(data.hasMore === true);
        setDespesasTotal(data.totalValor);
        setDespesasQuantidade(data.total);
        setDespesasOpcoesTipo(data.tiposDisponiveis ?? []);
      } catch {
        if (!controller.signal.aborted) reportError('despesas', 'Não foi possível carregar despesas. Tente novamente.');
      } finally {
        if (!controller.signal.aborted) setIsLoadingDespesas(false);
      }
    };
    const timer = window.setTimeout(run, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [activeTab, id, despesasFiltro.ano, despesasFiltro.mes, despesasFiltro.tipo, despesasFiltro.valorMin, despesasFiltro.valorMax, despesasFiltro.fornecedorId, revision]);

  useEffect(() => {
    const politicoId = id?.trim();
    if (!politicoId || activeTab !== 'despesas') return;
    const controller = new AbortController();
    const key = contextKey;
    setIsLoadingAnalysis(true);
    reportError('grafico', '');
    reportError('analise', '');
    if (!refreshing) {setDespesasResumo([]); setDespesasMedia([]);}
    const run = async () => {
      const params = expenseParams(0);
      params.delete('limit'); params.delete('offset');
      const read = async (url: string) => {
        const response = await fetch(url, {signal: controller.signal});
        if (!response.ok) throw new Error('HTTP');
        return response.json();
      };
      try {
        await Promise.all([
          (async () => {
            try {
              const data = await read(`/api/politicos/${encodeURIComponent(politicoId)}/despesas/analise?${params}`) as ExpenseAnalysis;
              if (!data.cobertura || !Array.isArray(data.categorias) || !Array.isArray(data.fornecedores)) throw new Error('Formato');
              if (!controller.signal.aborted && context.current === key) setExpenseAnalysis({context:key,data});
            } catch {
              if (!controller.signal.aborted && context.current === key) reportError('analise', 'Não foi possível atualizar a análise e a cobertura. Os dados disponíveis podem estar parciais.');
            }
          })(),
          (async () => {
            try {
              const [resumo,media] = await Promise.all([
                read(`/api/politicos/${encodeURIComponent(politicoId)}/despesas/resumo?${params}`),
                read(`/api/despesas/media?${params}`),
              ]);
              if (!controller.signal.aborted && context.current === key) {setDespesasResumo(resumo.items ?? []); setDespesasMedia(media.items ?? []);}
            } catch {
              if (!controller.signal.aborted && context.current === key) reportError('grafico', 'Não foi possível carregar o gráfico comparativo.');
            }
          })(),
        ]);
      } finally {if (!controller.signal.aborted && context.current === key) setIsLoadingAnalysis(false);}
    };
    const timer = window.setTimeout(run,250);
    return () => {window.clearTimeout(timer); controller.abort();};
  }, [activeTab, id, despesasFiltro.ano, despesasFiltro.mes, despesasFiltro.tipo, despesasFiltro.valorMin, despesasFiltro.valorMax, despesasFiltro.fornecedorId, revision]);

  useEffect(() => {
    const politicoId = id?.trim();
    if (!politicoId || activeTab !== 'atuacao') return;

    const controller = new AbortController();
    setIsLoadingAtuacao(true);
    reportError('atuacao', '');

    const run = async () => {
      try {
        const response = await fetch(`/api/politicos/${encodeURIComponent(politicoId)}/atuacao`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('HTTP');
        const data = (await response.json()) as Partial<AtuacaoData>;
        if (controller.signal.aborted) return;
        setAtuacaoLoaded(true);
        setAtuacao({
          orgaos: Array.isArray(data.orgaos) ? data.orgaos : [],
          eventos: Array.isArray(data.eventos) ? data.eventos : [],
          frentes: Array.isArray(data.frentes) ? data.frentes : [],
          profissoes: Array.isArray(data.profissoes) ? data.profissoes : [],
          ocupacoes: Array.isArray(data.ocupacoes) ? data.ocupacoes : [],
          proposicoes: Array.isArray(data.proposicoes) ? data.proposicoes : [],
        });
      } catch {
        if (!controller.signal.aborted) { if (!refreshing) setAtuacaoLoaded(false); reportError('atuacao', 'Não foi possível carregar a atuação. Tente novamente.'); }
      } finally {
        if (!controller.signal.aborted) setIsLoadingAtuacao(false);
      }
    };

    run();
    return () => controller.abort();
  }, [activeTab, id, revision]);

  const toggleVotacaoDetail = async (votacao: VotacaoItem) => {
    if (expandedVotoId === votacao.votoId) {
      setExpandedVotoId(null);
      return;
    }

    setExpandedVotoId(votacao.votoId);
    if (votacaoDetails[votacao.votacaoId]) return;

    const key = contextKey;
    setLoadingVotacaoDetailId(votacao.votacaoId);
    try {
      const response = await fetch(`/api/votacoes/${encodeURIComponent(votacao.votacaoId)}`);
      if (!response.ok) throw new Error('HTTP');
      const payload = (await response.json()) as {votacao: VotacaoDetail};
      if (context.current !== key) return;
      const detail = payload.votacao;
      setVotacaoDetails((current) => ({...current, [votacao.votacaoId]: detail}));
    } catch {
      if (context.current === key) reportError('votacoes', 'Não foi possível carregar detalhes da votação. Tente novamente.');
    } finally {
      setLoadingVotacaoDetailId((current) => current === votacao.votacaoId ? null : current);
    }
  };

  const getVoteTypeLabel = (votacao: VotacaoItem) => {
    if (votacao.classificacaoConfianca === 'ambigua') return 'Objeto não identificado';
    const labels: Record<string, string> = {
      principal: 'Votação principal',
      requerimento: 'Requerimento',
      destaque: 'Destaque',
      emenda: 'Emenda',
      substitutivo: 'Substitutivo',
      parecer: 'Parecer',
      procedimental: 'Procedimental',
    };
    return labels[votacao.tipoVotacao] ?? 'Votação';
  };

  const loadMoreVotacoes = async () => {
    const politicoId = id?.trim();
    if (!politicoId) return;
    if (isLoadingMoreVotacoes || isLoadingVotacoes || !votacoesHasMore || pages.current.votacoes) return;
    const key = contextKey;
    const controller = new AbortController();
    pages.current.votacoes = controller;
    reportError('votacoes', '');

    const pageSize = 30;
    const ano = votacoesFiltro.ano ? Number(votacoesFiltro.ano) : null;

    setIsLoadingMoreVotacoes(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', String(pageSize));
      if (votacoesNextCursor) params.set('cursor', votacoesNextCursor);
      if (ano != null && Number.isFinite(ano)) params.set('ano', String(ano));
      if (votacoesFiltro.voto) params.set('voto', votacoesFiltro.voto);
      if (votacoesFiltro.tipo) params.set('tipoVotacao', votacoesFiltro.tipo);
      if (votacoesFiltro.texto.trim()) params.set('q', votacoesFiltro.texto.trim());

      const res = await fetch(
        `/api/politicos/${encodeURIComponent(politicoId)}/votacoes?${params.toString()}`,
        {signal: controller.signal},
      );
      if (!res.ok) throw new Error('HTTP');

      const data = (await res.json()) as {items?: VotacaoItem[]; nextCursor?: string | null};
      if (controller.signal.aborted || context.current !== key) return;
      const items = data.items ?? [];

      setVotacoes((curr) => {
        const seen = new Set(curr.map((v) => v.votoId));
        const appended = items.filter((v) => !seen.has(v.votoId));
        return appended.length === 0 ? curr : [...curr, ...appended];
      });
      setVotacoesNextCursor(data.nextCursor ?? null);
      setVotacoesHasMore(Boolean(data.nextCursor));
    } catch {
      if (!controller.signal.aborted && context.current === key) reportError('votacoes', 'Não foi possível carregar mais votações. Tente novamente.');
    } finally {
      if (pages.current.votacoes === controller) { pages.current.votacoes = undefined; if (context.current === key) setIsLoadingMoreVotacoes(false); }
    }
  };

  const loadMoreDespesas = async () => {
    if (!id || isLoadingDespesas || !despesasHasMore || pages.current.despesas) return;
    const controller = new AbortController();
    pages.current.despesas = controller;
    const key = contextKey;
    const nextOffset = despesasOffset;
    setIsLoadingMoreDespesas(true);
    reportError('despesas', '');
    try {
      const res = await fetch(`/api/politicos/${encodeURIComponent(id)}/despesas?${expenseParams(nextOffset)}`, {signal: controller.signal});
      if (!res.ok) throw new Error('HTTP');
      const data = await res.json();
      if (controller.signal.aborted || context.current !== key) return;
      setDespesas(current => {
        const seen = new Set(current.map(item => item.id));
        return [...current, ...(data.items ?? []).filter((item: DespesaItem) => !seen.has(item.id))];
      });
      setDespesasOffset(nextOffset + (data.items ?? []).length);
      setDespesasHasMore(data.hasMore === true);
      setDespesasTotal(data.totalValor);
      setDespesasQuantidade(data.total);
      setDespesasOpcoesTipo(data.tiposDisponiveis ?? []);
    } catch {
      if (!controller.signal.aborted && context.current === key) reportError('despesas', 'Não foi possível carregar mais despesas. Tente novamente.');
    } finally {
      if (pages.current.despesas === controller) { pages.current.despesas = undefined; if (context.current === key) setIsLoadingMoreDespesas(false); }
    }
  };

  const votacoesHasFiltro = Boolean(
    votacoesFiltro.texto.trim() || votacoesFiltro.voto || votacoesFiltro.tipo || votacoesFiltro.ano,
  );
  const despesasHasFiltro = Boolean(
    despesasFiltro.tipo.trim() ||
      despesasFiltro.ano ||
      despesasFiltro.mes ||
      despesasFiltro.fornecedorId ||
      despesasFiltro.valorMin.trim() ||
      despesasFiltro.valorMax.trim(),
  );

  const votacoesOpcoesVoto = votacoesVotosDisponiveis;
  const votacoesOpcoesTipo = votacoesTiposDisponiveis;
  const votacoesOpcoesAno = votacoesAnosDisponiveis;
  const votacoesFiltradas = votacoes;

  const despesasOpcoesAno = useMemo(() => {
    const values: number[] = despesas
      .map((d) => d.ano)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    return Array.from(new Set<number>([...despesasAnosDisponiveis, ...values])).sort((a, b) => b - a);
  }, [despesas, despesasAnosDisponiveis]);

  const despesasOpcoesMes = Array.from({length: 12}, (_, index) => index + 1);
  const despesasFiltradas = despesas;

  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      }),
    [],
  );

  const handleEvaluationSaved = (payload: {notaMedia: number; totalAvaliacoes: number}) => {
    setPolitico((current) =>
      current
        ? {
            ...current,
            notaMedia: payload.notaMedia,
            totalAvaliacoes: payload.totalAvaliacoes,
          }
        : current,
    );
  };

  const compare = useCompare();
  const [indicadoresPerfil, setIndicadoresPerfil] = useState<Indicadores | null>(null);
  const [mediaCamara, setMediaCamara] = useState<MediaCamara>(null);
  const [loadingIndicadores, setLoadingIndicadores] = useState(true);

  useEffect(() => {
    const politicoId = id?.trim();
    if (!politicoId) return;
    const controller = new AbortController();
    setLoadingIndicadores(true);
    fetchIndicadores([politicoId], {signal: controller.signal})
      .then((result) => {
        if (controller.signal.aborted) return;
        setIndicadoresPerfil(result.items.get(politicoId) ?? null);
        setMediaCamara(result.media);
      })
      .catch(() => {
        if (!controller.signal.aborted) setIndicadoresPerfil(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingIndicadores(false);
      });
    return () => controller.abort();
  }, [id]);

  const tabs = [
    { id: 'geral', label: 'Visão Geral', icon: BarChart3 },
    { id: 'atuacao', label: 'Atuação', icon: Landmark },
    { id: 'votacoes', label: 'Votações', icon: CheckCircle2 },
    { id: 'despesas', label: 'Despesas', icon: DollarSign },
    { id: 'noticias', label: 'Notícias', icon: FileText },
  ];

  if (isLoadingPolitico && !politico) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-slate-200/80 bg-white p-8 text-center text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          Carregando perfil...
        </div>
      </div>
    );
  }

  if (!politico) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
        <h2 role={errors.perfil ? 'alert' : undefined} className="text-2xl font-bold text-slate-900 dark:text-slate-50">{errors.perfil || 'Político não encontrado'}</h2>
        <Link to="/" className="text-brand-700 hover:underline dark:text-brand-300">Voltar para o início</Link>
      </div>
    );
  }

  const votacoesIndisponiveis = politico.votacoesDisponiveis === false;
  const presencaNumero = votacoesIndisponiveis ? null : politico.presenca ?? indicadoresPerfil?.participacao ?? null;
  const alinhamentoNumero = votacoesIndisponiveis ? null : politico.alinhamentoGoverno ?? indicadoresPerfil?.alinhamentoGoverno ?? null;
  const presencaLabel = presencaNumero == null ? 'n/d' : formatPercent(presencaNumero);
  const alinhamentoLabel = alinhamentoNumero == null ? 'n/d' : formatPercent(alinhamentoNumero);
  const gastoTotal = indicadoresPerfil?.totalDespesas ?? null;
  const gastoDiff =
    gastoTotal != null && mediaCamara?.gastoPorDeputado
      ? Math.round(((gastoTotal - mediaCamara.gastoPorDeputado) / mediaCamara.gastoPorDeputado) * 100)
      : null;
  const naComparacao = compare.has(politico.id);
  const situacaoLabel = getPoliticoSituacaoLabel(politico);
  const sexoLabel =
    politico.sexo === 'M' ? 'Masculino' : politico.sexo === 'F' ? 'Feminino' : politico.sexo;
  const localNascimento = [politico.municipioNascimento, politico.ufNascimento]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' - ');
  const nascimentoLabel = [formatarData(politico.dataNascimento), localNascimento]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' - ');
  const contatoLabel = [politico.email, politico.telefone]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' • ');
  const gabineteLabel = [
    politico.gabineteNome,
    politico.gabinetePredio ? `Predio ${politico.gabinetePredio}` : null,
    politico.gabineteSala ? `Sala ${politico.gabineteSala}` : null,
    politico.gabineteAndar ? `Andar ${politico.gabineteAndar}` : null,
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' - ');
  const redesSociais = (politico.redesSociais ?? []).filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  );
  const dadosOficiais = [
    {label: 'Nome civil', value: politico.nomeCivil},
    {label: 'Nome eleitoral', value: politico.nomeEleitoral},
    {label: 'Sexo', value: sexoLabel},
    {label: 'Nascimento', value: nascimentoLabel || null},
    {label: 'Escolaridade', value: politico.escolaridade},
    {label: 'Condição eleitoral', value: politico.condicaoEleitoral},
    {
      label: 'Legislatura',
      value: politico.idLegislatura != null ? String(politico.idLegislatura) : null,
    },
    {
      label: 'Ultimo status oficial',
      value: formatarData(politico.dataUltimoStatus),
    },
    {label: 'Contato', value: contatoLabel || null},
    {label: 'Gabinete', value: gabineteLabel || null},
  ].filter(
    (item): item is {label: string; value: string} =>
      typeof item.value === 'string' && item.value.trim().length > 0,
  );
  const temDadosOficiais = dadosOficiais.length > 0 || Boolean(politico.urlWebsite) || redesSociais.length > 0;
  const currentAnalysis = expenseAnalysis?.context === contextKey ? expenseAnalysis.data : undefined;
  const expenseScopeLabel = [despesasFiltro.ano ? `Ano ${despesasFiltro.ano}` : 'Todos os anos', despesasFiltro.mes && `Mês ${despesasFiltro.mes}`, despesasFiltro.tipo, despesasFiltro.fornecedorId && `Fornecedor: ${fornecedorLabel}`, despesasFiltro.valorMin && `A partir de ${despesasFiltro.valorMin}`, despesasFiltro.valorMax && `Até ${despesasFiltro.valorMax}`].filter(Boolean).join(' · ');
  const resumoCards: Array<{label: string; value: string; hint: string; icon: typeof Star; bar: number | null; marker: number | null; tone: 'brand' | 'good' | 'warn'}> = [
    {
      label: 'Nota popular',
      value: politico.totalAvaliacoes === 0 ? 'Sem avaliações' : politico.notaMedia.toFixed(1),
      hint: `${politico.totalAvaliacoes.toLocaleString('pt-BR')} avaliações registradas`,
      icon: Star,
      bar: (politico.notaMedia / 5) * 100,
      marker: null,
      tone: 'brand',
    },
    {
      label: 'Participação em votações',
      value: loadingIndicadores && presencaNumero == null ? '…' : presencaLabel,
      hint: indicadoresPerfil
        ? `${indicadoresPerfil.votosRegistrados.toLocaleString('pt-BR')} de ${indicadoresPerfil.votacoesPossiveis.toLocaleString('pt-BR')} votações nominais`
        : 'Votos registrados nas votações nominais',
      icon: Calendar,
      bar: presencaNumero,
      marker: null,
      tone: 'good',
    },
    {
      label: 'Alinhamento com o governo',
      value: loadingIndicadores && alinhamentoNumero == null ? '…' : alinhamentoLabel,
      hint: 'Votos iguais à orientação do governo',
      icon: Landmark,
      bar: alinhamentoNumero,
      marker: null,
      tone: 'brand',
    },
    {
      label: 'Cota parlamentar',
      value: gastoTotal == null ? (loadingIndicadores ? '…' : 'n/d') : brlCompact.format(gastoTotal),
      hint:
        gastoDiff == null
          ? 'Total de despesas na base'
          : `${gastoDiff > 0 ? '+' : ''}${gastoDiff}% em relação à média da Câmara`,
      icon: BriefcaseBusiness,
      bar: gastoTotal != null && mediaCamara?.gastoPorDeputado ? Math.min(100, (gastoTotal / (mediaCamara.gastoPorDeputado * 2)) * 100) : null,
      marker: mediaCamara?.gastoPorDeputado ? 50 : null,
      tone: gastoDiff != null && gastoDiff > 10 ? 'warn' : 'good',
    },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <Link to="/" className="mb-6 flex items-center gap-2 text-sm font-medium text-slate-500 transition-colors hover:text-brand-700 sm:mb-8 dark:text-slate-400 dark:hover:text-blue-400">
        <ChevronLeft size={16} />
        Voltar para a busca
      </Link>

      {/* Header Section */}
      <section className="reveal-card surface relative mb-6 overflow-hidden p-5 sm:p-8">
        <div className="dot-grid pointer-events-none absolute inset-0 opacity-60" aria-hidden="true" />
        <div className="relative flex flex-col items-center gap-6 md:flex-row md:items-center md:gap-8">
          <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-2xl ring-1 ring-slate-200 sm:h-32 sm:w-32 dark:ring-slate-700">
            <img
              src={politico.foto}
              alt={politico.nome}
              className="h-full w-full object-cover"
              referrerPolicy="no-referrer"
            />
          </div>
          <div className="min-w-0 flex-1 text-center md:text-left">
            <div className="flex flex-wrap items-center justify-center gap-2 md:justify-start">
              <span
                className={cn(
                  'inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset',
                  getPoliticoStatusClasses(politico),
                )}
              >
                {getPoliticoStatusLabel(politico)}
              </span>
              {situacaoLabel && (
                <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  Situação: {situacaoLabel}
                </span>
              )}
              <span className="text-xs text-slate-500 dark:text-slate-400">{politico.cargo}</span>
            </div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl dark:text-slate-50">{politico.nome}</h1>
            <p className="mt-1 text-base text-slate-600 dark:text-slate-400">
              {politico.partido} / {politico.estado}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-center gap-3 md:items-end">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-0.5" aria-hidden="true">
                {politico.totalAvaliacoes > 0 && [1, 2, 3, 4, 5].map((s) => (
                  <Star
                    key={s}
                    size={18}
                    className={s <= Math.round(politico.notaMedia) ? 'fill-amber-400 text-amber-400' : 'text-slate-200 dark:text-slate-700'}
                  />
                ))}
              </div>
              <span className="tabular font-mono text-2xl font-semibold text-slate-900 dark:text-slate-50">{politico.totalAvaliacoes === 0 ? 'Sem avaliações' : politico.notaMedia.toFixed(1)}</span>
              <span className="text-xs text-slate-500 dark:text-slate-400">{politico.totalAvaliacoes.toLocaleString('pt-BR')} avaliacoes</span>
            </div>
            <div className="flex flex-wrap justify-center gap-2 md:justify-end">
              <button
                onClick={() => setIsModalOpen(true)}
                className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 active:scale-[0.98] dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
              >
                Avalie este político
              </button>
              <button
                type="button"
                aria-pressed={naComparacao}
                disabled={!naComparacao && compare.isFull}
                onClick={() => compare.toggle({id: politico.id, nome: politico.nome, partido: politico.partido, estado: politico.estado, foto: politico.foto})}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-xl border px-4 py-2.5 text-sm font-semibold transition active:scale-[0.98] disabled:opacity-50',
                  naComparacao
                    ? 'border-brand-300 bg-brand-50 text-brand-800 dark:border-brand-700 dark:bg-brand-950 dark:text-brand-200'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200',
                )}
              >
                {naComparacao ? <Check size={15} aria-hidden="true" /> : <ArrowLeftRight size={15} aria-hidden="true" />}
                {naComparacao ? 'Na comparação' : 'Comparar'}
              </button>
              {naComparacao && compare.items.length > 1 && (
                <Link
                  to={compareHref(compare.items.map((item) => item.id))}
                  className="inline-flex items-center rounded-xl px-3 py-2.5 text-sm font-semibold text-brand-700 hover:underline dark:text-brand-300"
                >
                  Abrir comparador
                </Link>
              )}
            </div>
          </div>
        </div>
      </section>

      {Object.entries(errors).filter(([area, message]) => area !== 'despesas' && Boolean(message) && (area === activeTab || (activeTab === 'despesas' && ['anos', 'grafico'].includes(area)))).map(([area, message]) => <p role="alert" key={area} className="mb-4 rounded-xl bg-rose-50 p-4 text-rose-800">{message}</p>)}
      <section aria-label="Indicadores do parlamentar" className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {resumoCards.map((card, index) => (
          <div
            key={card.label}
            className="reveal-card surface p-5"
            style={{animationDelay: `${index * 70}ms`}}
          >
            <div className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-400">
              <card.icon size={15} aria-hidden="true" className="text-slate-400" />
              {card.label}
            </div>
            <div className="tabular mt-2 font-mono text-2xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">{card.value}</div>
            {card.bar != null && (
              <div className="relative mt-3 h-1.5" aria-hidden="true">
                <span
                  className={cn(
                    'grow-bar absolute inset-y-0 left-0 rounded-full',
                    card.tone === 'good' && 'bg-emerald-500',
                    card.tone === 'warn' && 'bg-orange-500',
                    card.tone === 'brand' && 'bg-brand-500',
                  )}
                  style={{width: `${Math.max(2, Math.min(100, card.bar))}%`}}
                />
                {card.marker != null && (
                  <span className="absolute -top-1 h-3.5 w-0.5 rounded bg-slate-900 dark:bg-white" style={{left: `${card.marker}%`}} />
                )}
              </div>
            )}
            <div className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">{card.hint}</div>
          </div>
        ))}
      </section>

      <JudicialAttributes summary={politico.judicial} detailsHref={`?tab=geral#historico-judicial`} />

      {/* Tabs Section */}
      <div ref={tabsContainer} className="mb-8 -mx-4 flex gap-1 overflow-x-auto border-b border-slate-200 px-4 no-scrollbar sm:mx-0 sm:px-0 dark:border-slate-800">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            aria-pressed={activeTab === tab.id}
            className={cn(
              "-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition-colors sm:px-4",
              activeTab === tab.id
                ? "border-brand-600 text-slate-950 dark:border-brand-400 dark:text-slate-50"
                : "border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
            )}
          >
            <tab.icon size={18} />
            {tab.label}
            {tab.id === 'votacoes' && (
              <span
                className={cn(
                  "ml-1 inline-flex min-w-6 items-center justify-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
                  activeTab === tab.id
                    ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
                    : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
                )}
              >
                {votacoesHasFiltro ? `${votacoesFiltradas.length}/${votacoes.length}` : votacoes.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="min-h-[400px]">
        {activeTab === 'geral' && (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-8">
            <RaioXGastos indicadores={indicadoresPerfil} media={mediaCamara} loading={loadingIndicadores} />

            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 sm:p-8 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-slate-50">Dados oficiais</h3>
                  <p className="mt-2 max-w-md text-sm text-slate-500 dark:text-slate-400">
                    Dados enriquecidos a partir da API oficial da Câmara dos Deputados.
                  </p>
                </div>
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-brand-700 dark:bg-blue-950 dark:text-brand-300">
                  <FileText size={22} />
                </div>
              </div>

              {temDadosOficiais ? (
                <>
                  <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {dadosOficiais.map((item) => (
                      <div key={item.label} className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800">
                        <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                          {item.label}
                        </div>
                        <div className="mt-1 break-words text-sm font-semibold text-slate-900 dark:text-slate-50">
                          {item.value}
                        </div>
                      </div>
                    ))}
                  </div>

                  {(politico.urlWebsite || redesSociais.length > 0) && (
                    <div className="mt-6 rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
                      <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        Links institucionais
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {politico.urlWebsite && (
                          <a
                            href={politico.urlWebsite}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                          >
                            Site oficial <ExternalLink size={12} />
                          </a>
                        )}
                        {redesSociais.map((link, index) => (
                          <a
                            key={link}
                            href={link}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 transition-colors hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-300 dark:hover:bg-blue-900"
                          >
                            {formatarLinkLabel(link, `Rede ${index + 1}`)} <ExternalLink size={12} />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="mt-6 flex gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800">
                  <AlertCircle size={20} className="shrink-0 text-slate-500 dark:text-slate-400" />
                  <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                    Ainda não há dados oficiais detalhados disponíveis para este parlamentar.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'geral' && <div id="historico-judicial" className="mt-6 min-w-0 scroll-mt-24 md:mt-8">{id && <JudicialProfile politicoId={id} />}</div>}

        {activeTab === 'atuacao' && (!errors.atuacao || atuacaoLoaded) && (
          <div className="space-y-6">
            {isLoadingAtuacao && !atuacaoLoaded ? (
              <div className="rounded-2xl border border-slate-200/80 bg-white p-8 text-center text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                Carregando atuação parlamentar...
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
                  {[
                    {label: 'Orgaos', value: atuacao.orgaos.length, icon: Landmark},
                    {label: 'Frentes', value: atuacao.frentes.length, icon: Users},
                    {label: 'Eventos', value: atuacao.eventos.length, icon: Calendar},
                    {label: 'Historico', value: atuacao.profissoes.length + atuacao.ocupacoes.length, icon: BriefcaseBusiness},
                    {label: 'Proposicoes', value: atuacao.proposicoes.length, icon: FileText},
                  ].map((item) => (
                    <div key={item.label} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                      <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                        <item.icon size={15} />
                        {item.label}
                      </div>
                      <div className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-50">{item.value}</div>
                    </div>
                  ))}
                </div>

                <section className="rounded-2xl border border-slate-200/80 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Orgaos e comissoes</h3>
                  {atuacao.orgaos.length === 0 ? (
                    <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      Nenhum registro disponível na base importada.
                    </div>
                  ) : (
                    <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                      {atuacao.orgaos.map((orgao) => (
                        <article key={`${orgao.orgaoId}-${orgao.titulo}-${orgao.dataInicio}`} className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
                          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{orgao.tipoOrgao || orgao.siglaOrgao || 'Orgao'}</div>
                          <h4 className="mt-1 font-semibold text-slate-900 dark:text-slate-50">{orgao.nomeOrgao || orgao.nomePublicacao || orgao.siglaOrgao}</h4>
                          {orgao.titulo && <p className="mt-2 text-sm font-semibold text-brand-700 dark:text-brand-300">{orgao.titulo}</p>}
                          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                            {formatarData(orgao.dataInicio) || 'Inicio nao informado'} - {formatarData(orgao.dataFim) || 'Atual'}
                          </p>
                        </article>
                      ))}
                    </div>
                  )}
                </section>

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  <section className="rounded-2xl border border-slate-200/80 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Frentes parlamentares</h3>
                    {atuacao.frentes.length === 0 ? (
                      <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        Nenhum registro disponível na base importada.
                      </div>
                    ) : (
                      <div className="mt-4 space-y-3">
                        {atuacao.frentes.map((frente) => (
                          <article key={frente.id} className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800">
                            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Legislatura {frente.idLegislatura ?? '-'}</div>
                            <h4 className="mt-1 font-bold text-slate-900 dark:text-slate-50">{frente.titulo || 'Frente parlamentar'}</h4>
                          </article>
                        ))}
                      </div>
                    )}
                  </section>

                  <section className="rounded-2xl border border-slate-200/80 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Historico profissional</h3>
                    {atuacao.profissoes.length + atuacao.ocupacoes.length === 0 ? (
                      <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        Nenhum registro disponível na base importada.
                      </div>
                    ) : (
                      <div className="mt-4 space-y-3">
                        {[...atuacao.profissoes, ...atuacao.ocupacoes].map((item, index) => (
                          <article key={`${item.titulo}-${index}`} className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800">
                            <h4 className="font-bold text-slate-900 dark:text-slate-50">{item.titulo || 'Registro profissional'}</h4>
                            {item.entidade && <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{item.entidade}</p>}
                            {(item.anoInicio || item.anoFim) && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{item.anoInicio ?? '?'} - {item.anoFim ?? 'Atual'}</p>}
                          </article>
                        ))}
                      </div>
                    )}
                  </section>
                </div>

                <section className="rounded-2xl border border-slate-200/80 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Eventos vinculados</h3>
                  {atuacao.eventos.length === 0 ? (
                    <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      Nenhum registro disponível na base importada.
                    </div>
                  ) : (
                    <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                      {atuacao.eventos.map((evento) => (
                        <article key={evento.id} className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
                          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{formatarData(evento.dataHoraInicio)} {evento.situacao ? `- ${evento.situacao}` : ''}</div>
                          <h4 className="mt-1 font-semibold text-slate-900 dark:text-slate-50">{evento.descricaoTipo || 'Evento'}</h4>
                          <p className="mt-2 line-clamp-3 text-sm text-slate-600 dark:text-slate-400">{evento.descricao || 'Descricao indisponivel'}</p>
                          {evento.urlRegistro && <a href={evento.urlRegistro} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-sm font-bold text-brand-700 hover:underline dark:text-brand-300">Registro oficial <ExternalLink size={14} /></a>}
                        </article>
                      ))}
                    </div>
                  )}
                </section>

                <section className="rounded-2xl border border-slate-200/80 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Proposicoes relacionadas</h3>
                  {atuacao.proposicoes.length === 0 ? (
                    <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      Nenhum registro disponível na base importada.
                    </div>
                  ) : (
                    <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                      {atuacao.proposicoes.map((proposicao) => (
                        <Link key={proposicao.id} to={`/camara/proposicoes/${proposicao.id}`} className="rounded-2xl border border-slate-200 p-4 transition-colors hover:border-brand-200 dark:border-slate-700 dark:hover:border-blue-900">
                          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{proposicao.siglaTipo} {proposicao.numero}/{proposicao.ano}</div>
                          <h4 className="mt-1 line-clamp-3 font-semibold text-slate-900 dark:text-slate-50">{proposicao.ementa || 'Proposicao'}</h4>
                          {proposicao.situacao && <p className="mt-2 text-xs font-bold text-brand-700 dark:text-brand-300">{proposicao.situacao}</p>}
                        </Link>
                      ))}
                    </div>
                  )}
                </section>
              </>
            )}
          </div>
        )}

        {activeTab === 'votacoes' && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-col gap-4 md:flex-row md:items-end">
                <div className="flex-1">
                  <label className="text-xs font-bold text-slate-600 dark:text-slate-400">Buscar</label>
                  <input
                    type="text"
                    className="mt-1 block w-full rounded-2xl border-0 py-2 px-3 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-brand-500 sm:text-sm sm:leading-6 dark:bg-slate-800 dark:text-slate-50 dark:ring-slate-700 dark:placeholder:text-slate-500"
                    placeholder="Ementa, tipo, número/ano..."
                    value={votacoesFiltro.texto}
                    onChange={(e) => setVotacoesFiltro((curr) => ({...curr, texto: e.target.value}))}
                  />
                </div>
                <div className="w-full md:w-48">
                  <label className="text-xs font-bold text-slate-600 dark:text-slate-400">Voto</label>
                  <select
                    className="mt-1 block w-full rounded-2xl border-0 py-2 px-3 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-200 focus:ring-2 focus:ring-inset focus:ring-brand-500 sm:text-sm sm:leading-6 dark:bg-slate-800 dark:text-slate-50 dark:ring-slate-700"
                    value={votacoesFiltro.voto}
                    onChange={(e) => setVotacoesFiltro((curr) => ({...curr, voto: e.target.value}))}
                  >
                    <option value="">Todos</option>
                    {votacoesOpcoesVoto.map((voto) => (
                      <option key={voto} value={voto}>{voto}</option>
                    ))}
                  </select>
                </div>
                <div className="w-full md:w-40">
                  <label className="text-xs font-bold text-slate-600 dark:text-slate-400">Tipo</label>
                  <select
                    className="mt-1 block w-full rounded-2xl border-0 py-2 px-3 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-200 focus:ring-2 focus:ring-inset focus:ring-brand-500 sm:text-sm sm:leading-6 dark:bg-slate-800 dark:text-slate-50 dark:ring-slate-700"
                    value={votacoesFiltro.tipo}
                    onChange={(e) => setVotacoesFiltro((curr) => ({...curr, tipo: e.target.value}))}
                  >
                    <option value="">Todos</option>
                    {votacoesOpcoesTipo.map((tipo) => (
                      <option key={tipo} value={tipo}>{tipo}</option>
                    ))}
                  </select>
                </div>
                <div className="w-full md:w-32">
                  <label className="text-xs font-bold text-slate-600 dark:text-slate-400">Ano</label>
                  <select
                    className="mt-1 block w-full rounded-2xl border-0 py-2 px-3 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-200 focus:ring-2 focus:ring-inset focus:ring-brand-500 sm:text-sm sm:leading-6 dark:bg-slate-800 dark:text-slate-50 dark:ring-slate-700"
                    value={votacoesFiltro.ano}
                    onChange={(e) => setVotacoesFiltro((curr) => ({...curr, ano: e.target.value}))}
                  >
                    <option value="">Todos</option>
                    {votacoesOpcoesAno.map((ano) => (
                      <option key={ano} value={String(ano)}>{ano}</option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  disabled={!votacoesHasFiltro}
                  onClick={() => setVotacoesFiltro({texto: '', voto: '', tipo: '', ano: ''})}
                  className="w-full rounded-2xl bg-slate-100 px-5 py-2 text-sm font-bold text-slate-700 hover:bg-slate-200 disabled:opacity-50 disabled:hover:bg-slate-100 md:w-auto dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:disabled:hover:bg-slate-800"
                >
                  Limpar
                </button>
              </div>
              <div className="mt-3 text-xs font-medium text-slate-500 dark:text-slate-400">
                Mostrando {votacoesFiltradas.length} de {votacoes.length}
              </div>
            </div>

            {isLoadingVotacoes && (
              <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                Carregando votações...
              </div>
            )}

            {!isLoadingVotacoes && !errors.votacoes && votacoesFiltradas.length === 0 && (
              <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                {politico.votacoesDisponiveis === false ? 'Dados ainda não importados' : 'Nenhuma votação encontrada com esses filtros.'}
              </div>
            )}

            {votacoesFiltradas.map((v) => {
              const display = buildVotacaoDisplay(v);
              const isExpanded = expandedVotoId === v.votoId;
              const detail = votacaoDetails[v.votacaoId];
              return (
              <div key={v.votoId} className="vote-list-item rounded-2xl border border-slate-200 bg-white transition-colors hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-600">
                <button
                  onClick={() => void toggleVotacaoDetail(v)}
                  className="flex w-full items-start justify-between gap-4 p-4 text-left sm:p-6"
                >
                  <div className="flex min-w-0 gap-4 items-start">
                    <div className={cn(
                      "mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                      v.voto === 'Sim'
                        ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400"
                        : v.voto === 'Não'
                          ? "bg-rose-50 text-rose-600 dark:bg-rose-950 dark:text-rose-400"
                          : "bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                    )}>
                      {v.voto === 'Sim' ? <CheckCircle2 size={20} /> :
                       v.voto === 'Não' ? <XCircle size={20} /> : <MinusCircle size={20} />}
                    </div>
                    <div className="min-w-0">
                      <div className="mb-2 flex flex-wrap gap-2">
                        <span className={cn(
                          'rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide',
                          v.classificacaoConfianca === 'ambigua'
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                            : 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
                        )}>
                          {getVoteTypeLabel(v)}
                        </span>
                        {v.ehSubvotacao && v.classificacaoConfianca !== 'ambigua' && (
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            Subvotação
                          </span>
                        )}
                      </div>
                      <h4 className="break-words font-bold text-slate-900 dark:text-slate-50">{display.titulo}</h4>
                      {display.contexto && (
                        <p className="mt-1 break-words text-sm text-slate-600 dark:text-slate-300">
                          Resumo: {display.contexto}
                        </p>
                      )}
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                        <span className="flex items-center gap-1">
                          <Calendar size={12} />{' '}
                          {formatarDataVotacao(v.dataVotacao) ?? 'Data indisponível'}
                        </span>
                        <span className={cn(
                          "font-bold uppercase tracking-wider",
                          v.voto === 'Sim'
                            ? "text-emerald-600 dark:text-emerald-400"
                            : v.voto === 'Não'
                              ? "text-rose-600 dark:text-rose-400"
                              : "text-slate-600 dark:text-slate-400"
                        )}>Votou: {v.voto}</span>
                      </div>
                    </div>
                  </div>
                  <span className={cn("text-slate-400 transition-transform", isExpanded ? "rotate-90" : "rotate-0")}>
                    <ChevronRight size={18} />
                  </span>
                </button>

                {isExpanded && (
                  <div className="border-t border-slate-100 px-4 py-5 sm:px-6 dark:border-slate-800">
                    {loadingVotacaoDetailId === v.votacaoId && (
                      <div className="mb-3 text-sm font-medium text-slate-500">Carregando contexto oficial...</div>
                    )}
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800">
                        <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Assunto em linguagem simples</div>
                        <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-50">{display.assunto || 'Sem resumo disponível'}</div>
                        {display.identificador && (
                          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">{display.identificador}</div>
                        )}
                      </div>
                      <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800">
                        <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Texto oficial da votação</div>
                        <div className="mt-2 grid grid-cols-1 gap-1 text-xs text-slate-600 dark:text-slate-400">
                          <div className="text-sm font-semibold text-slate-900 dark:text-slate-50">{detail?.textoOficial || v.ementa || 'Sem texto oficial disponível'}</div>
                          <div><span className="font-bold text-slate-800 dark:text-slate-200">Seu parlamentar votou:</span> {v.voto}</div>
                          <div><span className="font-bold text-slate-800 dark:text-slate-200">Voto ID:</span> {v.votoId}</div>
                          <div><span className="font-bold text-slate-800 dark:text-slate-200">Votação ID:</span> {v.votacaoId}</div>
                          <div><span className="font-bold text-slate-800 dark:text-slate-200">Político ID:</span> {v.politicoId}</div>
                        </div>
                      </div>
                      <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800">
                        <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Classificação e proveniência</div>
                        <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-50">{getVoteTypeLabel(v)}</div>
                        <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                          Fonte: {v.classificacaoFonte} · confiança: {v.classificacaoConfianca} · versão: {v.classificacaoVersao}
                        </div>
                        {(detail?.classificacaoJustificativa || v.classificacaoJustificativa) && (
                          <div className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                            {detail?.classificacaoJustificativa || v.classificacaoJustificativa}
                          </div>
                        )}
                      </div>
                      <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800">
                        <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Número/Ano</div>
                        <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-50">
                          {v.numero != null && v.ano != null ? `${v.numero}/${v.ano}` : '-'}
                        </div>
                      </div>
                      {detail && (detail.objetosPossiveis.length > 0 || detail.proposicoesAfetadas.length > 0) && (
                        <div className="rounded-2xl bg-amber-50 p-4 md:col-span-2 dark:bg-amber-950/40">
                          <div className="text-[10px] font-bold uppercase tracking-widest text-amber-700 dark:text-amber-300">Contexto oficial relacionado</div>
                          {detail.objetosPossiveis.length > 0 && (
                            <div className="mt-2 text-xs text-slate-700 dark:text-slate-300">
                              <span className="font-bold">Objetos possíveis:</span>{' '}
                              {detail.objetosPossiveis.map((item) => item.siglaTipo && item.numero && item.ano ? `${item.siglaTipo} ${item.numero}/${item.ano}` : item.ementa || 'não identificado').join('; ')}
                            </div>
                          )}
                          {detail.proposicoesAfetadas.length > 0 && (
                            <div className="mt-2 text-xs text-slate-700 dark:text-slate-300">
                              <span className="font-bold">Proposições afetadas:</span>{' '}
                              {detail.proposicoesAfetadas.map((item) => item.siglaTipo && item.numero && item.ano ? `${item.siglaTipo} ${item.numero}/${item.ano}` : item.ementa || 'não identificada').join('; ')}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
              );
            })}

            {votacoesHasMore && (
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={loadMoreVotacoes}
                  disabled={isLoadingMoreVotacoes}
                  className="rounded-2xl bg-slate-100 px-6 py-3 text-sm font-bold text-slate-700 hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  {isLoadingMoreVotacoes ? 'Carregando...' : 'Carregar mais'}
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'despesas' && (
          <div className="space-y-4">
            {errors.despesas && <p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-800">{errors.despesas}</p>}
            <Suspense fallback={<div className="rounded-2xl bg-white p-6 text-slate-500 dark:bg-slate-900">Carregando gráfico...</div>}>
              <SpendingChart
                resumo={despesasResumo}
                media={despesasMedia}
                scopeLabel={expenseScopeLabel}
                nomePolitico={politico.nome}
              />
            </Suspense>
            <ExpenseCoverageNotice coverage={currentAnalysis?.cobertura} loading={isLoadingAnalysis} error={Boolean(errors.analise)} />
            {currentAnalysis && <ExpenseBreakdown analysis={currentAnalysis} onCategory={tipo=>setDespesasFiltro(current=>({...current,tipo}))} onSupplier={(fornecedorId,nome)=>{setFornecedorLabel(nome);setDespesasFiltro(current=>({...current,fornecedorId}));}} />}
            {despesasFiltro.fornecedorId && <div className="flex flex-wrap items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-800 dark:bg-blue-950"><span className="min-w-0 break-words">Fornecedor: {fornecedorLabel}</span><button type="button" onClick={()=>{setFornecedorLabel('');setDespesasFiltro(current=>({...current,fornecedorId:''}));}} className="font-semibold text-blue-700 hover:underline dark:text-blue-300">Limpar fornecedor</button></div>}


            <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-col gap-4 md:flex-row md:items-end">
                <div className="flex-1">
                  <label className="text-xs font-bold text-slate-600 dark:text-slate-400">Tipo</label>
                  <input
                    type="text"
                    className="mt-1 block w-full rounded-2xl border-0 py-2 px-3 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-brand-500 sm:text-sm sm:leading-6 dark:bg-slate-800 dark:text-slate-50 dark:ring-slate-700 dark:placeholder:text-slate-500"
                    placeholder="Ex: Divulgação, Passagens..."
                    aria-label="Tipo"
                    value={despesasFiltro.tipo}
                    onChange={(e) => setDespesasFiltro((curr) => ({...curr, tipo: e.target.value}))}
                    list="despesas-tipos"
                  />
                  <datalist id="despesas-tipos">
                    {despesasOpcoesTipo.map((tipo) => (
                      <option key={tipo} value={tipo} />
                    ))}
                  </datalist>
                </div>
                <div className="w-full md:w-28">
                  <label className="text-xs font-bold text-slate-600 dark:text-slate-400">Ano</label>
                  <select
                    className="mt-1 block w-full rounded-2xl border-0 py-2 px-3 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-200 focus:ring-2 focus:ring-inset focus:ring-brand-500 sm:text-sm sm:leading-6 dark:bg-slate-800 dark:text-slate-50 dark:ring-slate-700"
                    aria-label="Ano"
                    value={despesasFiltro.ano}
                    onChange={(e) => setDespesasFiltro((curr) => ({...curr, ano: e.target.value}))}
                  >
                    <option value="">Todos</option>
                    {despesasOpcoesAno.map((ano) => (
                      <option key={ano} value={String(ano)}>{ano}</option>
                    ))}
                  </select>
                </div>
                <div className="w-full md:w-28">
                  <label className="text-xs font-bold text-slate-600 dark:text-slate-400">Mês</label>
                  <select
                    className="mt-1 block w-full rounded-2xl border-0 py-2 px-3 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-200 focus:ring-2 focus:ring-inset focus:ring-brand-500 sm:text-sm sm:leading-6 dark:bg-slate-800 dark:text-slate-50 dark:ring-slate-700"
                    aria-label="Mês"
                    value={despesasFiltro.mes}
                    onChange={(e) => setDespesasFiltro((curr) => ({...curr, mes: e.target.value}))}
                  >
                    <option value="">Todos</option>
                    {despesasOpcoesMes.map((mes) => (
                      <option key={mes} value={String(mes)}>{String(mes).padStart(2, '0')}</option>
                    ))}
                  </select>
                </div>
                <div className="w-full md:w-40">
                  <label className="text-xs font-bold text-slate-600 dark:text-slate-400">Valor mín.</label>
                  <input
                    inputMode="decimal"
                    className="mt-1 block w-full rounded-2xl border-0 py-2 px-3 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-brand-500 sm:text-sm sm:leading-6 dark:bg-slate-800 dark:text-slate-50 dark:ring-slate-700 dark:placeholder:text-slate-500"
                    placeholder="0"
                    aria-label="Valor mín."
                    value={despesasFiltro.valorMin}
                    onChange={(e) => setDespesasFiltro((curr) => ({...curr, valorMin: e.target.value}))}
                  />
                </div>
                <div className="w-full md:w-40">
                  <label className="text-xs font-bold text-slate-600 dark:text-slate-400">Valor máx.</label>
                  <input
                    inputMode="decimal"
                    className="mt-1 block w-full rounded-2xl border-0 py-2 px-3 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-brand-500 sm:text-sm sm:leading-6 dark:bg-slate-800 dark:text-slate-50 dark:ring-slate-700 dark:placeholder:text-slate-500"
                    placeholder="0"
                    aria-label="Valor máx."
                    value={despesasFiltro.valorMax}
                    onChange={(e) => setDespesasFiltro((curr) => ({...curr, valorMax: e.target.value}))}
                  />
                </div>
                <button
                  type="button"
                  disabled={!despesasHasFiltro}
                  onClick={() => setDespesasFiltro({tipo: '', ano: '', mes: '', valorMin: '', valorMax: '', fornecedorId: ''})}
                  className="w-full rounded-2xl bg-slate-100 px-5 py-2 text-sm font-bold text-slate-700 hover:bg-slate-200 disabled:opacity-50 disabled:hover:bg-slate-100 md:w-auto dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:disabled:hover:bg-slate-800"
                >
                  Limpar
                </button>
              </div>
              <div className="mt-3 text-xs font-medium text-slate-500 dark:text-slate-400">
                {despesasQuantidade == null ? 'Carregando total...' : `Mostrando ${despesas.length} de ${despesasQuantidade}`}
              </div>
            </div>

            <div className="space-y-3 md:hidden">
              {isLoadingDespesas && despesas.length === 0 ? (
                <div className="rounded-2xl border border-slate-200/80 bg-white p-8 text-center text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                  Carregando despesas...
                </div>
              ) : errors.despesas && despesas.length === 0 ? null : despesasFiltradas.length === 0 ? (
                <div className="rounded-2xl border border-slate-200/80 bg-white p-8 text-center text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                  {currentAnalysis?.cobertura.status === 'not_imported' ? 'Aguardando importação para consultar as despesas.' : 'Nenhuma despesa encontrada com esses filtros.'}
                </div>
              ) : (
                <>
                  {despesasFiltradas.map((d) => (
                    <ResponsiveExpenseCard
                      key={d.id}
                      despesa={d}
                      currencyFormatter={currencyFormatter}
                    />
                  ))}
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800">
                    <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      Total com os filtros
                    </div>
                    <div className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-50">
                      {despesasTotal == null ? '—' : currencyFormatter.format(despesasTotal)}
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="hidden overflow-hidden rounded-2xl border border-slate-200/80 bg-white md:block dark:border-slate-800 dark:bg-slate-900">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 dark:bg-slate-800 dark:border-slate-700">
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider dark:text-slate-400">Competência</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider dark:text-slate-400">Tipo de Despesa</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right dark:text-slate-400">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {isLoadingDespesas && despesas.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-6 py-8 text-center text-sm text-slate-600 dark:text-slate-400">
                        Carregando despesas...
                      </td>
                    </tr>
                  ) : errors.despesas && despesas.length === 0 ? null : despesasFiltradas.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-6 py-8 text-center text-sm text-slate-600 dark:text-slate-400">
                        {currentAnalysis?.cobertura.status === 'not_imported' ? 'Aguardando importação para consultar as despesas.' : 'Nenhuma despesa encontrada com esses filtros.'}
                      </td>
                    </tr>
                  ) : (
                    despesasFiltradas.map((d) => (
                      <tr key={d.id} className="hover:bg-slate-50/50 transition-colors dark:hover:bg-slate-800/50">
                        <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-400">
                          {`${String(d.mes).padStart(2, '0')}/${d.ano}`}
                        </td>
                        <td className="px-6 py-4 text-sm font-medium text-slate-900 dark:text-slate-50">
                          {d.tipo}
                          <div className="mt-1 break-words text-xs font-normal text-slate-500 dark:text-slate-400">{d.fornecedor || 'Fornecedor não informado'}</div>
                          {d.urlDocumento ? <a href={d.urlDocumento} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-blue-700 hover:underline dark:text-blue-300">Ver documento <ExternalLink size={12} /></a> : <span className="mt-1 block text-xs font-normal text-slate-500 dark:text-slate-400">Documento não disponibilizado</span>}
                        </td>
                        <td className="px-6 py-4 text-sm font-bold text-slate-900 text-right dark:text-slate-50">
                          {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(d.valor)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 font-bold dark:bg-slate-800">
                    <td colSpan={2} className="px-6 py-4 text-sm text-slate-900 dark:text-slate-50">Total com os filtros</td>
                    <td className="px-6 py-4 text-sm text-slate-900 text-right dark:text-slate-50">
                      {despesasTotal == null ? '—' : currencyFormatter.format(despesasTotal)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {despesasHasMore && (
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={loadMoreDespesas}
                  disabled={isLoadingMoreDespesas}
                  className="rounded-2xl bg-slate-100 px-6 py-3 text-sm font-bold text-slate-700 hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  {isLoadingMoreDespesas ? 'Carregando...' : 'Carregar mais'}
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'noticias' && (
          <div className="rounded-2xl border border-slate-200/80 bg-white p-8 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
            Notícias em breve.
          </div>
        )}
      </div>

      {isModalOpen && (
        <Suspense fallback={null}>
          <EvaluationModal
            isOpen={isModalOpen}
            onClose={() => setIsModalOpen(false)}
            politicoId={politico.id}
            politicoName={politico.nome}
            onEvaluationSaved={handleEvaluationSaved}
          />
        </Suspense>
      )}
    </div>
  );
};

const Info = ({ size, className }: { size: number, className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
  </svg>
);
