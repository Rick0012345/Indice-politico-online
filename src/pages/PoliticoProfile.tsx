import React, {Suspense, lazy, useEffect, useMemo, useRef, useState} from 'react';
import { useParams, Link } from 'react-router-dom';
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
  BriefcaseBusiness
} from 'lucide-react';
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
  id: string;
  nome: string;
  partido: string;
  estado: string;
  cargo: string;
  foto: string;
  notaMedia: number;
  totalAvaliacoes: number;
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
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Competência</div>
          <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-50">{data}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Valor</div>
          <div className="mt-1 text-sm font-bold text-slate-900 dark:text-slate-50">
            {currencyFormatter.format(despesa.valor)}
          </div>
        </div>
      </div>

      <div className="mt-4">
        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Tipo</div>
        <div className="mt-1 break-words text-sm font-semibold text-slate-900 dark:text-slate-50">
          {despesa.tipo}
        </div>
      </div>

      {despesa.fornecedor && (
        <div className="mt-4">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
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
          className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-blue-600 hover:underline dark:text-blue-400"
        >
          Abrir documento <ExternalLink size={14} />
        </a>
      )}
    </div>
  );
};

export const PoliticoProfile = () => {
  const { id } = useParams();
  const [activeTab, setActiveTab] = useState('geral');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [politico, setPolitico] = useState<PoliticoDetail | null>(null);
  const [votacoes, setVotacoes] = useState<VotacaoItem[]>([]);
  const [despesas, setDespesas] = useState<DespesaItem[]>([]);
  const [isLoadingPolitico, setIsLoadingPolitico] = useState(true);
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
  });
  const [votacoesNextCursor, setVotacoesNextCursor] = useState<string | null>(null);
  const [votacaoDetails, setVotacaoDetails] = useState<Record<string, VotacaoDetail>>({});
  const [loadingVotacaoDetailId, setLoadingVotacaoDetailId] = useState<string | null>(null);
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
  const [despesasMedia, setDespesasMedia] = useState<{ano: number; mes: number; media: number}[]>([]);
  const [atuacao, setAtuacao] = useState<AtuacaoData>({
    orgaos: [],
    eventos: [],
    frentes: [],
    profissoes: [],
    ocupacoes: [],
    proposicoes: [],
  });
  const [isLoadingAtuacao, setIsLoadingAtuacao] = useState(false);

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
    setPolitico(null);
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
          if (!controller.signal.aborted) { setPolitico(null); if (politicoRes.status !== 404) reportError('perfil', 'Não foi possível carregar o perfil. Tente novamente.'); }
        }
      } catch {
        if (!controller.signal.aborted) { setPolitico(null); reportError('perfil', 'Não foi possível carregar o perfil. Tente novamente.'); }
      } finally {
        if (!controller.signal.aborted) setIsLoadingPolitico(false);
      }
    };

    run();
    return () => controller.abort();
  }, [id]);

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
  }, [activeTab, id]);

  useEffect(() => {
    const politicoId = id?.trim();
    if (!politicoId || activeTab !== 'votacoes') return;

    const controller = new AbortController();
    const pageSize = 30;
    const ano = votacoesFiltro.ano ? Number(votacoesFiltro.ano) : null;

    setIsLoadingVotacoes(true);
    reportError('votacoes', '');
    setVotacoes([]);
    setVotacoesNextCursor(null);
    setVotacoesHasMore(false);

    const run = async () => {
      try {
        const params = new URLSearchParams();
        params.set('limit', String(pageSize));
        if (ano != null && Number.isFinite(ano)) params.set('ano', String(ano));
        if (votacoesFiltro.voto) params.set('voto', votacoesFiltro.voto);
        if (votacoesFiltro.tipo) params.set('tipoVotacao', votacoesFiltro.tipo);
        if (votacoesFiltro.texto.trim()) params.set('q', votacoesFiltro.texto.trim());

        const res = await fetch(
          `/api/politicos/${encodeURIComponent(politicoId)}/votacoes?${params.toString()}`,
          {signal: controller.signal},
        );
        if (!res.ok) throw new Error('HTTP');

        const data = (await res.json()) as {
          items?: VotacaoItem[];
          nextCursor?: string | null;
          meta?: {anos?: number[]; tiposVotacao?: string[]; votos?: string[]};
        };
        if (controller.signal.aborted) return;
        const items = data.items ?? [];
        setVotacoes(items);
        setVotacoesNextCursor(data.nextCursor ?? null);
        setVotacoesHasMore(Boolean(data.nextCursor));
        setVotacoesAnosDisponiveis(data.meta?.anos ?? []);
        setVotacoesTiposDisponiveis(data.meta?.tiposVotacao ?? []);
        setVotacoesVotosDisponiveis(data.meta?.votos ?? []);
      } catch {
        if (!controller.signal.aborted) { setVotacoes([]); reportError('votacoes', 'Não foi possível carregar votações. Tente novamente.'); }
      } finally {
        if (!controller.signal.aborted) setIsLoadingVotacoes(false);
      }
    };

    const timer = window.setTimeout(run, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [activeTab, id, votacoesFiltro.ano, votacoesFiltro.texto, votacoesFiltro.tipo, votacoesFiltro.voto]);

  useEffect(() => {
    const politicoId = id?.trim();
    if (!politicoId || activeTab !== 'despesas') return;

    const controller = new AbortController();
    setIsLoadingDespesas(true);
    setDespesas([]);
    setDespesasOffset(0);
    setDespesasHasMore(false);
    setDespesasTotal(null);
    setDespesasQuantidade(null);
    reportError('despesas', '');
    const run = async () => {
      try {
        const res = await fetch(`/api/politicos/${encodeURIComponent(politicoId)}/despesas?${expenseParams(0)}`, {signal: controller.signal});
        if (!res.ok) throw new Error('HTTP');
        const data = await res.json();
        if (controller.signal.aborted) return;
        setDespesas(data.items ?? []);
        setDespesasOffset((data.items ?? []).length);
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
  }, [activeTab, id, despesasFiltro.ano, despesasFiltro.mes, despesasFiltro.tipo, despesasFiltro.valorMin, despesasFiltro.valorMax]);

  useEffect(() => {
    const politicoId = id?.trim();
    if (!politicoId || activeTab !== 'despesas') return;

    const controller = new AbortController();
    setDespesasResumo([]);
    setDespesasMedia([]);
    reportError('grafico', '');
    const ano = despesasFiltro.ano ? Number(despesasFiltro.ano) : null;

    const run = async () => {
      try {
        const resumoParams = new URLSearchParams();
        if (ano != null && Number.isFinite(ano)) resumoParams.set('ano', String(ano));

        const mediaParams = new URLSearchParams();
        if (ano != null && Number.isFinite(ano)) mediaParams.set('ano', String(ano));

        const [resumoRes, mediaRes] = await Promise.all([
          fetch(`/api/politicos/${encodeURIComponent(politicoId)}/despesas/resumo?${resumoParams}`, {
            signal: controller.signal,
          }),
          fetch(`/api/despesas/media?${mediaParams}`, {signal: controller.signal}),
        ]);

        if (resumoRes.ok) {
          const data = (await resumoRes.json()) as {items?: {ano: number; mes: number; total: number}[]};
          if (!controller.signal.aborted) setDespesasResumo(data.items ?? []);
        } else {
          if (!controller.signal.aborted) reportError('grafico', 'Não foi possível carregar o gráfico comparativo.');
        }

        if (mediaRes.ok) {
          const data = (await mediaRes.json()) as {items?: {ano: number; mes: number; media: number}[]};
          if (!controller.signal.aborted) setDespesasMedia(data.items ?? []);
        } else {
          if (!controller.signal.aborted) reportError('grafico', 'Não foi possível carregar o gráfico comparativo.');
        }
      } catch {
        if (!controller.signal.aborted) reportError('grafico', 'Não foi possível carregar o gráfico comparativo.');
      }
    };

    run();
    return () => controller.abort();
  }, [activeTab, id, despesasFiltro.ano]);

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
        if (!controller.signal.aborted) { setAtuacaoLoaded(false); reportError('atuacao', 'Não foi possível carregar a atuação. Tente novamente.'); }
      } finally {
        if (!controller.signal.aborted) setIsLoadingAtuacao(false);
      }
    };

    run();
    return () => controller.abort();
  }, [activeTab, id]);

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

  const tabs = [
    { id: 'geral', label: 'Visão Geral', icon: BarChart3 },
    { id: 'atuacao', label: 'Atuação', icon: Landmark },
    { id: 'votacoes', label: 'Votações', icon: CheckCircle2 },
    { id: 'despesas', label: 'Despesas', icon: DollarSign },
    { id: 'noticias', label: 'Notícias', icon: FileText },
  ];

  if (isLoadingPolitico) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
          Carregando perfil...
        </div>
      </div>
    );
  }

  if (!politico) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
        <h2 role={errors.perfil ? 'alert' : undefined} className="text-2xl font-bold text-slate-900 dark:text-slate-50">{errors.perfil || 'Político não encontrado'}</h2>
        <Link to="/" className="text-blue-600 hover:underline dark:text-blue-400">Voltar para o início</Link>
      </div>
    );
  }

  const presencaLabel = politico.presenca == null ? '-' : `${politico.presenca}%`;
  const presencaValue = politico.presenca ?? 0;
  const alinhamentoLabel = politico.alinhamentoGoverno == null ? '-' : `${politico.alinhamentoGoverno}%`;
  const alinhamentoValue = politico.alinhamentoGoverno ?? 0;
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
  const resumoCards = [
    {
      label: 'Nota popular',
      value: politico.notaMedia.toFixed(1),
      hint: `${politico.totalAvaliacoes.toLocaleString('pt-BR')} avaliações registradas`,
      icon: Star,
    },
    {
      label: 'Presença',
      value: presencaLabel,
      hint: 'Sessões com presença registrada',
      icon: Calendar,
    },
    {
      label: 'Alinhamento',
      value: alinhamentoLabel,
      hint: 'Comparado à orientação do governo',
      icon: Landmark,
    },
    {
      label: 'Atuação mapeada',
      value: atuacaoLoaded ? String(atuacao.proposicoes.length + atuacao.orgaos.length + atuacao.frentes.length) : '—',
      hint: 'Proposições, órgãos e frentes vinculadas',
      icon: BriefcaseBusiness,
    },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <Link to="/" className="mb-6 flex items-center gap-2 text-sm font-medium text-slate-500 transition-colors hover:text-blue-600 sm:mb-8 dark:text-slate-400 dark:hover:text-blue-400">
        <ChevronLeft size={16} />
        Voltar para a busca
      </Link>

      {/* Header Section */}
      <div className="reveal-card relative mb-10 overflow-hidden rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:mb-12 sm:p-10 dark:border-slate-700 dark:bg-slate-900">
        <div className="civic-mesh opacity-40 dark:opacity-30" aria-hidden="true">
          <span className="civic-node left-[18%] top-[22%]" />
          <span className="civic-node left-[72%] top-[20%]" />
          <span className="civic-node left-[58%] top-[74%]" />
        </div>
        <div className="relative flex flex-col items-center gap-6 md:flex-row md:items-start md:gap-8">
          <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-2xl border-4 border-slate-50 shadow-xl shadow-blue-900/10 sm:h-40 sm:w-40 dark:border-slate-800">
            <img
              src={politico.foto}
              alt={politico.nome}
              className="h-full w-full object-cover"
              referrerPolicy="no-referrer"
            />
          </div>
          <div className="flex-1 text-center md:text-left">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-extrabold text-slate-900 sm:text-3xl dark:text-slate-50">{politico.nome}</h1>
                <div className="mt-3 flex flex-wrap items-center justify-center gap-2 md:justify-start">
                  <span
                    className={cn(
                      'inline-flex rounded-full px-3 py-1 text-xs font-bold ring-1 ring-inset',
                      getPoliticoStatusClasses(politico),
                    )}
                  >
                    {getPoliticoStatusLabel(politico)}
                  </span>
                  {situacaoLabel && (
                    <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700 ring-1 ring-inset ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700">
                      Situacao: {situacaoLabel}
                    </span>
                  )}
                </div>
                <p className="text-base font-medium text-slate-500 sm:text-lg dark:text-slate-400">
                  {politico.partido} • {politico.estado} • {politico.cargo}
                </p>
              </div>
              <div className="flex flex-col items-center md:items-end gap-1">
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Star
                      key={s}
                      size={20}
                      className={s <= Math.round(politico.notaMedia) ? "fill-yellow-400 text-yellow-400" : "text-slate-200 dark:text-slate-700"}
                    />
                  ))}
                </div>
                <span className="text-2xl font-black text-slate-900 dark:text-slate-50">{politico.notaMedia.toFixed(1)}</span>
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  {politico.totalAvaliacoes.toLocaleString('pt-BR')} avaliacoes
                </span>
                <span className="text-[10px] uppercase tracking-widest font-bold text-slate-400 dark:text-slate-500">Nota Média</span>
              </div>
            </div>

            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row sm:flex-wrap md:justify-start">
              <button
                onClick={() => setIsModalOpen(true)}
                className="w-full rounded-2xl bg-blue-600 px-8 py-3 text-sm font-bold text-white shadow-lg shadow-blue-200 transition-colors hover:bg-blue-700 sm:w-auto"
              >
                Avalie este político
              </button>

            </div>
          </div>
        </div>
      </div>

      {Object.entries(errors).filter(([area, message]) => area !== 'despesas' && Boolean(message) && (area === activeTab || (activeTab === 'despesas' && ['anos', 'grafico'].includes(area)))).map(([area, message]) => <p role="alert" key={area} className="mb-4 rounded-xl bg-rose-50 p-4 text-rose-800">{message}</p>)}
      <section className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {resumoCards.map((card, index) => (
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

      {/* Tabs Section */}
      <div className="mb-8 -mx-4 flex overflow-x-auto border-b border-slate-200 px-4 no-scrollbar sm:mx-0 sm:px-0 dark:border-slate-700">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-bold transition-colors sm:px-6 sm:py-4",
              activeTab === tab.id
                ? "border-blue-600 text-blue-600 dark:text-blue-400"
                : "border-transparent text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
            )}
          >
            <tab.icon size={18} />
            {tab.label}
            {tab.id === 'votacoes' && (
              <span
                className={cn(
                  "ml-1 inline-flex min-w-6 items-center justify-center rounded-full px-2 py-0.5 text-[11px] font-black",
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
            <div className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-8 dark:border-slate-700 dark:bg-slate-900">
              <h3 className="text-lg font-bold text-slate-900 mb-6 dark:text-slate-50">Desempenho Parlamentar</h3>
              <div className="space-y-8">
                <div>
                  <div className="flex justify-between mb-2">
                    <span className="text-sm font-medium text-slate-600 dark:text-slate-400">Presença em Sessões</span>
                    <span className="text-sm font-bold text-slate-900 dark:text-slate-50">{presencaLabel}</span>
                  </div>
                  <div className="h-3 w-full rounded-full bg-slate-100 overflow-hidden dark:bg-slate-700">
                    <div
                      className="data-bar h-full rounded-full bg-emerald-500 transition-[width] duration-500"
                      style={{ width: `${presencaValue}%` }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between mb-2">
                    <span className="text-sm font-medium text-slate-600 dark:text-slate-400">Alinhamento com o Governo</span>
                    <span className="text-sm font-bold text-slate-900 dark:text-slate-50">{alinhamentoLabel}</span>
                  </div>
                  <div className="h-3 w-full rounded-full bg-slate-100 overflow-hidden dark:bg-slate-700">
                    <div
                      className="data-bar h-full rounded-full bg-blue-500 transition-[width] duration-500"
                      style={{ width: `${alinhamentoValue}%` }}
                    />
                  </div>
                </div>
              </div>
              <div className="mt-10 flex gap-3 rounded-2xl border border-blue-100 bg-blue-50 p-4 dark:border-blue-900 dark:bg-blue-950">
                <Info size={20} className="text-blue-600 shrink-0 dark:text-blue-400" />
                <p className="text-xs text-blue-800 leading-relaxed dark:text-blue-300">
                  O alinhamento é calculado com base na convergência dos votos do parlamentar com a orientação da liderança do governo no Congresso.
                </p>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-8 dark:border-slate-700 dark:bg-slate-900">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-slate-50">Dados oficiais</h3>
                  <p className="mt-2 max-w-md text-sm text-slate-500 dark:text-slate-400">
                    Dados enriquecidos a partir da API oficial da Câmara dos Deputados.
                  </p>
                </div>
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
                  <FileText size={22} />
                </div>
              </div>

              {temDadosOficiais ? (
                <>
                  <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {dadosOficiais.map((item) => (
                      <div key={item.label} className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800">
                        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
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
                      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
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

        {activeTab === 'atuacao' && !errors.atuacao && (
          <div className="space-y-6">
            {isLoadingAtuacao ? (
              <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
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
                    <div key={item.label} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                      <div className="flex items-center gap-2 text-xs font-bold uppercase text-slate-400 dark:text-slate-500">
                        <item.icon size={15} />
                        {item.label}
                      </div>
                      <div className="mt-2 text-2xl font-black text-slate-900 dark:text-slate-50">{item.value}</div>
                    </div>
                  ))}
                </div>

                <section className="rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
                  <h3 className="text-lg font-extrabold text-slate-900 dark:text-slate-50">Orgaos e comissoes</h3>
                  {atuacao.orgaos.length === 0 ? (
                    <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      Nenhum registro disponível na base importada.
                    </div>
                  ) : (
                    <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                      {atuacao.orgaos.map((orgao) => (
                        <article key={`${orgao.orgaoId}-${orgao.titulo}-${orgao.dataInicio}`} className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
                          <div className="text-xs font-bold uppercase text-slate-400 dark:text-slate-500">{orgao.tipoOrgao || orgao.siglaOrgao || 'Orgao'}</div>
                          <h4 className="mt-1 font-extrabold text-slate-900 dark:text-slate-50">{orgao.nomeOrgao || orgao.nomePublicacao || orgao.siglaOrgao}</h4>
                          {orgao.titulo && <p className="mt-2 text-sm font-semibold text-blue-600 dark:text-blue-400">{orgao.titulo}</p>}
                          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                            {formatarData(orgao.dataInicio) || 'Inicio nao informado'} - {formatarData(orgao.dataFim) || 'Atual'}
                          </p>
                        </article>
                      ))}
                    </div>
                  )}
                </section>

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  <section className="rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
                    <h3 className="text-lg font-extrabold text-slate-900 dark:text-slate-50">Frentes parlamentares</h3>
                    {atuacao.frentes.length === 0 ? (
                      <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        Nenhum registro disponível na base importada.
                      </div>
                    ) : (
                      <div className="mt-4 space-y-3">
                        {atuacao.frentes.map((frente) => (
                          <article key={frente.id} className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800">
                            <div className="text-xs font-bold uppercase text-slate-400 dark:text-slate-500">Legislatura {frente.idLegislatura ?? '-'}</div>
                            <h4 className="mt-1 font-bold text-slate-900 dark:text-slate-50">{frente.titulo || 'Frente parlamentar'}</h4>
                          </article>
                        ))}
                      </div>
                    )}
                  </section>

                  <section className="rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
                    <h3 className="text-lg font-extrabold text-slate-900 dark:text-slate-50">Historico profissional</h3>
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

                <section className="rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
                  <h3 className="text-lg font-extrabold text-slate-900 dark:text-slate-50">Eventos vinculados</h3>
                  {atuacao.eventos.length === 0 ? (
                    <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      Nenhum registro disponível na base importada.
                    </div>
                  ) : (
                    <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                      {atuacao.eventos.map((evento) => (
                        <article key={evento.id} className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
                          <div className="text-xs font-bold uppercase text-slate-400 dark:text-slate-500">{formatarData(evento.dataHoraInicio)} {evento.situacao ? `- ${evento.situacao}` : ''}</div>
                          <h4 className="mt-1 font-extrabold text-slate-900 dark:text-slate-50">{evento.descricaoTipo || 'Evento'}</h4>
                          <p className="mt-2 line-clamp-3 text-sm text-slate-600 dark:text-slate-400">{evento.descricao || 'Descricao indisponivel'}</p>
                          {evento.urlRegistro && <a href={evento.urlRegistro} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-sm font-bold text-blue-600 hover:underline dark:text-blue-400">Registro oficial <ExternalLink size={14} /></a>}
                        </article>
                      ))}
                    </div>
                  )}
                </section>

                <section className="rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
                  <h3 className="text-lg font-extrabold text-slate-900 dark:text-slate-50">Proposicoes relacionadas</h3>
                  {atuacao.proposicoes.length === 0 ? (
                    <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      Nenhum registro disponível na base importada.
                    </div>
                  ) : (
                    <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                      {atuacao.proposicoes.map((proposicao) => (
                        <Link key={proposicao.id} to={`/camara/proposicoes/${proposicao.id}`} className="rounded-2xl border border-slate-200 p-4 transition-colors hover:border-blue-200 dark:border-slate-700 dark:hover:border-blue-900">
                          <div className="text-xs font-bold uppercase text-slate-400 dark:text-slate-500">{proposicao.siglaTipo} {proposicao.numero}/{proposicao.ano}</div>
                          <h4 className="mt-1 line-clamp-3 font-extrabold text-slate-900 dark:text-slate-50">{proposicao.ementa || 'Proposicao'}</h4>
                          {proposicao.situacao && <p className="mt-2 text-xs font-bold text-blue-600 dark:text-blue-400">{proposicao.situacao}</p>}
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
            <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-700 dark:bg-slate-900">
              <div className="flex flex-col gap-4 md:flex-row md:items-end">
                <div className="flex-1">
                  <label className="text-xs font-bold text-slate-600 dark:text-slate-400">Buscar</label>
                  <input
                    type="text"
                    className="mt-1 block w-full rounded-2xl border-0 py-2 px-3 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm sm:leading-6 dark:bg-slate-800 dark:text-slate-50 dark:ring-slate-700 dark:placeholder:text-slate-500"
                    placeholder="Ementa, tipo, número/ano..."
                    value={votacoesFiltro.texto}
                    onChange={(e) => setVotacoesFiltro((curr) => ({...curr, texto: e.target.value}))}
                  />
                </div>
                <div className="w-full md:w-48">
                  <label className="text-xs font-bold text-slate-600 dark:text-slate-400">Voto</label>
                  <select
                    className="mt-1 block w-full rounded-2xl border-0 py-2 px-3 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-200 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm sm:leading-6 dark:bg-slate-800 dark:text-slate-50 dark:ring-slate-700"
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
                    className="mt-1 block w-full rounded-2xl border-0 py-2 px-3 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-200 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm sm:leading-6 dark:bg-slate-800 dark:text-slate-50 dark:ring-slate-700"
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
                    className="mt-1 block w-full rounded-2xl border-0 py-2 px-3 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-200 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm sm:leading-6 dark:bg-slate-800 dark:text-slate-50 dark:ring-slate-700"
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
              <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                Carregando votações...
              </div>
            )}

            {!isLoadingVotacoes && !errors.votacoes && votacoesFiltradas.length === 0 && (
              <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                Nenhuma votação encontrada com esses filtros.
              </div>
            )}

            {votacoesFiltradas.map((v) => {
              const display = buildVotacaoDisplay(v);
              const isExpanded = expandedVotoId === v.votoId;
              const detail = votacaoDetails[v.votacaoId];
              return (
              <div key={v.votoId} className="vote-list-item rounded-2xl border border-slate-200 bg-white transition-colors hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600">
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
                          'rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide',
                          v.classificacaoConfianca === 'ambigua'
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                            : 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
                        )}>
                          {getVoteTypeLabel(v)}
                        </span>
                        {v.ehSubvotacao && v.classificacaoConfianca !== 'ambigua' && (
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300">
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
                        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Assunto em linguagem simples</div>
                        <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-50">{display.assunto || 'Sem resumo disponível'}</div>
                        {display.identificador && (
                          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">{display.identificador}</div>
                        )}
                      </div>
                      <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800">
                        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Texto oficial da votação</div>
                        <div className="mt-2 grid grid-cols-1 gap-1 text-xs text-slate-600 dark:text-slate-400">
                          <div className="text-sm font-semibold text-slate-900 dark:text-slate-50">{detail?.textoOficial || v.ementa || 'Sem texto oficial disponível'}</div>
                          <div><span className="font-bold text-slate-800 dark:text-slate-200">Seu parlamentar votou:</span> {v.voto}</div>
                          <div><span className="font-bold text-slate-800 dark:text-slate-200">Voto ID:</span> {v.votoId}</div>
                          <div><span className="font-bold text-slate-800 dark:text-slate-200">Votação ID:</span> {v.votacaoId}</div>
                          <div><span className="font-bold text-slate-800 dark:text-slate-200">Político ID:</span> {v.politicoId}</div>
                        </div>
                      </div>
                      <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800">
                        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Classificação e proveniência</div>
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
                        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Número/Ano</div>
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
                nomePolitico={politico.nome}
              />
            </Suspense>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-700 dark:bg-slate-900">
              <div className="flex flex-col gap-4 md:flex-row md:items-end">
                <div className="flex-1">
                  <label className="text-xs font-bold text-slate-600 dark:text-slate-400">Tipo</label>
                  <input
                    type="text"
                    className="mt-1 block w-full rounded-2xl border-0 py-2 px-3 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm sm:leading-6 dark:bg-slate-800 dark:text-slate-50 dark:ring-slate-700 dark:placeholder:text-slate-500"
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
                    className="mt-1 block w-full rounded-2xl border-0 py-2 px-3 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-200 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm sm:leading-6 dark:bg-slate-800 dark:text-slate-50 dark:ring-slate-700"
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
                    className="mt-1 block w-full rounded-2xl border-0 py-2 px-3 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-200 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm sm:leading-6 dark:bg-slate-800 dark:text-slate-50 dark:ring-slate-700"
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
                    className="mt-1 block w-full rounded-2xl border-0 py-2 px-3 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm sm:leading-6 dark:bg-slate-800 dark:text-slate-50 dark:ring-slate-700 dark:placeholder:text-slate-500"
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
                    className="mt-1 block w-full rounded-2xl border-0 py-2 px-3 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm sm:leading-6 dark:bg-slate-800 dark:text-slate-50 dark:ring-slate-700 dark:placeholder:text-slate-500"
                    placeholder="0"
                    aria-label="Valor máx."
                    value={despesasFiltro.valorMax}
                    onChange={(e) => setDespesasFiltro((curr) => ({...curr, valorMax: e.target.value}))}
                  />
                </div>
                <button
                  type="button"
                  disabled={!despesasHasFiltro}
                  onClick={() => setDespesasFiltro({tipo: '', ano: '', mes: '', valorMin: '', valorMax: ''})}
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
              {isLoadingDespesas ? (
                <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                  Carregando despesas...
                </div>
              ) : errors.despesas ? null : despesasFiltradas.length === 0 ? (
                <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                  Nenhuma despesa encontrada com esses filtros.
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
                    <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                      Total com os filtros
                    </div>
                    <div className="mt-1 text-lg font-black text-slate-900 dark:text-slate-50">
                      {despesasTotal == null ? '—' : currencyFormatter.format(despesasTotal)}
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="hidden overflow-hidden rounded-3xl border border-slate-200 bg-white md:block dark:border-slate-700 dark:bg-slate-900">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 dark:bg-slate-800 dark:border-slate-700">
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider dark:text-slate-400">Competência</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider dark:text-slate-400">Tipo de Despesa</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right dark:text-slate-400">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {isLoadingDespesas ? (
                    <tr>
                      <td colSpan={3} className="px-6 py-8 text-center text-sm text-slate-600 dark:text-slate-400">
                        Carregando despesas...
                      </td>
                    </tr>
                  ) : errors.despesas ? null : despesasFiltradas.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-6 py-8 text-center text-sm text-slate-600 dark:text-slate-400">
                        Nenhuma despesa encontrada com esses filtros.
                      </td>
                    </tr>
                  ) : (
                    despesasFiltradas.map((d) => (
                      <tr key={d.id} className="hover:bg-slate-50/50 transition-colors dark:hover:bg-slate-800/50">
                        <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-400">
                          {`${String(d.mes).padStart(2, '0')}/${d.ano}`}
                        </td>
                        <td className="px-6 py-4 text-sm font-medium text-slate-900 dark:text-slate-50">{d.tipo}</td>
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
          <div className="rounded-3xl border border-slate-200 bg-white p-8 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
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
