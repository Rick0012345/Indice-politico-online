import React, { useEffect, useMemo, useState } from 'react';
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
  BarChart3
} from 'lucide-react';
import { cn } from '../lib/utils';
import {
  getPoliticoSituacaoLabel,
  getPoliticoStatusClasses,
  getPoliticoStatusLabel,
} from '../lib/politicoStatus';
import { EvaluationModal } from '../components/EvaluationModal';

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
  dataVotacao: string | null;
  voto: string;
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

const ResponsiveExpenseCard: React.FC<{
  despesa: DespesaItem;
  currencyFormatter: Intl.NumberFormat;
}> = ({despesa, currencyFormatter}) => {
  const data = new Date(
    `${despesa.ano}-${String(despesa.mes).padStart(2, '0')}-01`,
  ).toLocaleDateString('pt-BR');

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Data</div>
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
  const [votacoesOffset, setVotacoesOffset] = useState(0);
  const [despesasOffset, setDespesasOffset] = useState(0);
  const [votacoesHasMore, setVotacoesHasMore] = useState(false);
  const [despesasHasMore, setDespesasHasMore] = useState(false);
  const [votacoesAnosDisponiveis, setVotacoesAnosDisponiveis] = useState<number[]>([]);
  const [despesasAnosDisponiveis, setDespesasAnosDisponiveis] = useState<number[]>([]);

  const formatarData = (value: string | null | undefined) => {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
  };

  const formatarDataVotacao = (value: string | null) => formatarData(value);

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
    setIsLoadingPolitico(true);

    const run = async () => {
      try {
        const politicoRes = await fetch(`/api/politicos/${encodeURIComponent(politicoId)}`, {
          signal: controller.signal,
        });
        if (politicoRes.ok) {
          const data = (await politicoRes.json()) as {politico?: PoliticoDetail};
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
          setPolitico(null);
        }
      } catch {
        setPolitico(null);
      } finally {
        setIsLoadingPolitico(false);
      }
    };

    run();
    return () => controller.abort();
  }, [id]);

  useEffect(() => {
    const politicoId = id?.trim();
    if (!politicoId) return;

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

        const [votacoesAnosRes, despesasAnosRes] = await Promise.all([
          fetch(`/api/politicos/${encodeURIComponent(politicoId)}/votacoes/anos`, {signal: controller.signal}),
          fetch(`/api/politicos/${encodeURIComponent(politicoId)}/despesas/anos`, {signal: controller.signal}),
        ]);

        if (votacoesAnosRes.ok) {
          const data = (await votacoesAnosRes.json()) as {items?: unknown[]};
          setVotacoesAnosDisponiveis(normalizarAnos(data.items));
        } else {
          setVotacoesAnosDisponiveis([]);
        }

        if (despesasAnosRes.ok) {
          const data = (await despesasAnosRes.json()) as {items?: unknown[]};
          setDespesasAnosDisponiveis(normalizarAnos(data.items));
        } else {
          setDespesasAnosDisponiveis([]);
        }
      } catch {
        setVotacoesAnosDisponiveis([]);
        setDespesasAnosDisponiveis([]);
      }
    };

    run();
    return () => controller.abort();
  }, [id]);

  useEffect(() => {
    const politicoId = id?.trim();
    if (!politicoId) return;

    const controller = new AbortController();
    const pageSize = 200;
    const ano = votacoesFiltro.ano ? Number(votacoesFiltro.ano) : null;

    setIsLoadingVotacoes(true);
    setVotacoes([]);
    setVotacoesOffset(0);
    setVotacoesHasMore(false);

    const run = async () => {
      try {
        const params = new URLSearchParams();
        params.set('limit', String(pageSize));
        params.set('offset', '0');
        if (ano != null && Number.isFinite(ano)) params.set('ano', String(ano));

        const res = await fetch(
          `/api/politicos/${encodeURIComponent(politicoId)}/votacoes?${params.toString()}`,
          {signal: controller.signal},
        );
        if (!res.ok) {
          setVotacoes([]);
          return;
        }

        const data = (await res.json()) as {items?: VotacaoItem[]};
        const items = data.items ?? [];
        setVotacoes(items);
        setVotacoesHasMore(items.length === pageSize);
      } catch {
        setVotacoes([]);
      } finally {
        setIsLoadingVotacoes(false);
      }
    };

    run();
    return () => controller.abort();
  }, [id, votacoesFiltro.ano]);

  useEffect(() => {
    const politicoId = id?.trim();
    if (!politicoId) return;

    const controller = new AbortController();
    const pageSize = 200;
    const ano = despesasFiltro.ano ? Number(despesasFiltro.ano) : null;
    const mes = despesasFiltro.mes ? Number(despesasFiltro.mes) : null;

    setIsLoadingDespesas(true);
    setDespesas([]);
    setDespesasOffset(0);
    setDespesasHasMore(false);

    const run = async () => {
      try {
        const params = new URLSearchParams();
        params.set('limit', String(pageSize));
        params.set('offset', '0');
        if (ano != null && Number.isFinite(ano)) params.set('ano', String(ano));
        if (mes != null && Number.isFinite(mes)) params.set('mes', String(mes));

        const res = await fetch(
          `/api/politicos/${encodeURIComponent(politicoId)}/despesas?${params.toString()}`,
          {signal: controller.signal},
        );
        if (!res.ok) {
          setDespesas([]);
          return;
        }

        const data = (await res.json()) as {items?: DespesaItem[]};
        const items = data.items ?? [];
        setDespesas(items);
        setDespesasHasMore(items.length === pageSize);
      } catch {
        setDespesas([]);
      } finally {
        setIsLoadingDespesas(false);
      }
    };

    run();
    return () => controller.abort();
  }, [id, despesasFiltro.ano, despesasFiltro.mes]);

  const loadMoreVotacoes = async () => {
    const politicoId = id?.trim();
    if (!politicoId) return;
    if (isLoadingMoreVotacoes || isLoadingVotacoes || !votacoesHasMore) return;

    const pageSize = 200;
    const ano = votacoesFiltro.ano ? Number(votacoesFiltro.ano) : null;
    const nextOffset = votacoesOffset + pageSize;

    setIsLoadingMoreVotacoes(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', String(pageSize));
      params.set('offset', String(nextOffset));
      if (ano != null && Number.isFinite(ano)) params.set('ano', String(ano));

      const res = await fetch(
        `/api/politicos/${encodeURIComponent(politicoId)}/votacoes?${params.toString()}`,
      );
      if (!res.ok) return;

      const data = (await res.json()) as {items?: VotacaoItem[]};
      const items = data.items ?? [];

      setVotacoes((curr) => {
        const seen = new Set(curr.map((v) => v.votoId));
        const appended = items.filter((v) => !seen.has(v.votoId));
        return appended.length === 0 ? curr : [...curr, ...appended];
      });
      setVotacoesOffset(nextOffset);
      setVotacoesHasMore(items.length === pageSize);
    } finally {
      setIsLoadingMoreVotacoes(false);
    }
  };

  const loadMoreDespesas = async () => {
    const politicoId = id?.trim();
    if (!politicoId) return;
    if (isLoadingMoreDespesas || isLoadingDespesas || !despesasHasMore) return;

    const pageSize = 200;
    const ano = despesasFiltro.ano ? Number(despesasFiltro.ano) : null;
    const mes = despesasFiltro.mes ? Number(despesasFiltro.mes) : null;
    const nextOffset = despesasOffset + pageSize;

    setIsLoadingMoreDespesas(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', String(pageSize));
      params.set('offset', String(nextOffset));
      if (ano != null && Number.isFinite(ano)) params.set('ano', String(ano));
      if (mes != null && Number.isFinite(mes)) params.set('mes', String(mes));

      const res = await fetch(
        `/api/politicos/${encodeURIComponent(politicoId)}/despesas?${params.toString()}`,
      );
      if (!res.ok) return;

      const data = (await res.json()) as {items?: DespesaItem[]};
      const items = data.items ?? [];

      setDespesas((curr) => {
        const seen = new Set(curr.map((d) => d.id));
        const appended = items.filter((d) => !seen.has(d.id));
        return appended.length === 0 ? curr : [...curr, ...appended];
      });
      setDespesasOffset(nextOffset);
      setDespesasHasMore(items.length === pageSize);
    } finally {
      setIsLoadingMoreDespesas(false);
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

  const votacoesOpcoesVoto = useMemo(() => {
    const values: string[] = votacoes.map((v) => v.voto).filter((v) => typeof v === 'string' && v.trim().length > 0);
    return Array.from(new Set<string>(values)).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [votacoes]);

  const votacoesOpcoesTipo = useMemo(() => {
    const values: string[] = votacoes
      .map((v) => v.siglaTipo)
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
    return Array.from(new Set<string>(values)).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [votacoes]);

  const votacoesOpcoesAno = useMemo(() => {
    const values: number[] = votacoes
      .map((v) => v.ano)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    return Array.from(new Set<number>([...votacoesAnosDisponiveis, ...values])).sort((a, b) => b - a);
  }, [votacoes, votacoesAnosDisponiveis]);

  const votacoesFiltradas = useMemo(() => {
    const texto = votacoesFiltro.texto.trim().toLowerCase();
    const ano = votacoesFiltro.ano ? Number(votacoesFiltro.ano) : null;

    return votacoes.filter((v) => {
      if (votacoesFiltro.voto && v.voto !== votacoesFiltro.voto) return false;
      if (votacoesFiltro.tipo && v.siglaTipo !== votacoesFiltro.tipo) return false;
      if (ano != null && Number.isFinite(ano) && v.ano !== ano) return false;
      if (texto) {
        const haystack = `${v.siglaTipo ?? ''} ${v.numero ?? ''}/${v.ano ?? ''} ${v.ementa ?? ''}`.toLowerCase();
        if (!haystack.includes(texto)) return false;
      }
      return true;
    });
  }, [votacoes, votacoesFiltro]);

  const despesasOpcoesTipo = useMemo(() => {
    const values: string[] = despesas.map((d) => d.tipo).filter((v) => typeof v === 'string' && v.trim().length > 0);
    return Array.from(new Set<string>(values)).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [despesas]);

  const despesasOpcoesAno = useMemo(() => {
    const values: number[] = despesas
      .map((d) => d.ano)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    return Array.from(new Set<number>([...despesasAnosDisponiveis, ...values])).sort((a, b) => b - a);
  }, [despesas, despesasAnosDisponiveis]);

  const despesasOpcoesMes = useMemo(() => {
    const values: number[] = despesas
      .map((d) => d.mes)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    return Array.from(new Set<number>(values)).sort((a, b) => a - b);
  }, [despesas]);

  const despesasFiltradas = useMemo(() => {
    const tipo = despesasFiltro.tipo.trim().toLowerCase();
    const ano = despesasFiltro.ano ? Number(despesasFiltro.ano) : null;
    const mes = despesasFiltro.mes ? Number(despesasFiltro.mes) : null;
    const valorMin = despesasFiltro.valorMin.trim() ? Number(despesasFiltro.valorMin) : null;
    const valorMax = despesasFiltro.valorMax.trim() ? Number(despesasFiltro.valorMax) : null;

    return despesas.filter((d) => {
      if (tipo) {
        if (!d.tipo?.toLowerCase().includes(tipo)) return false;
      }
      if (ano != null && Number.isFinite(ano) && d.ano !== ano) return false;
      if (mes != null && Number.isFinite(mes) && d.mes !== mes) return false;
      if (valorMin != null && Number.isFinite(valorMin) && d.valor < valorMin) return false;
      if (valorMax != null && Number.isFinite(valorMax) && d.valor > valorMax) return false;
      return true;
    });
  }, [despesas, despesasFiltro]);

  const despesasTotal = useMemo(() => {
    return despesasFiltradas.reduce((acc, curr) => acc + (Number.isFinite(curr.valor) ? curr.valor : 0), 0);
  }, [despesasFiltradas]);

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
    { id: 'votacoes', label: 'Votações', icon: CheckCircle2 },
    { id: 'despesas', label: 'Despesas', icon: DollarSign },
    { id: 'noticias', label: 'Notícias', icon: FileText },
  ];

  if (isLoadingPolitico) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
          Carregando perfil…
        </div>
      </div>
    );
  }

  if (!politico) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-50">Político não encontrado</h2>
        <Link to="/" className="text-blue-600 hover:underline dark:text-blue-400">Voltar para o início</Link>
      </div>
    );
  }

  const presencaLabel = politico.presenca == null ? '—' : `${politico.presenca}%`;
  const presencaValue = politico.presenca ?? 0;
  const alinhamentoLabel = politico.alinhamentoGoverno == null ? '—' : `${politico.alinhamentoGoverno}%`;
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

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <Link to="/" className="mb-6 flex items-center gap-2 text-sm font-medium text-slate-500 transition-colors hover:text-blue-600 sm:mb-8 dark:text-slate-400 dark:hover:text-blue-400">
        <ChevronLeft size={16} />
        Voltar para a busca
      </Link>

      {/* Header Section */}
      <div className="relative mb-10 overflow-hidden rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:mb-12 sm:p-10 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-col items-center gap-6 md:flex-row md:items-start md:gap-8">
          <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-2xl border-4 border-slate-50 shadow-md sm:h-40 sm:w-40 dark:border-slate-800">
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
                className="w-full rounded-2xl bg-blue-600 px-8 py-3 text-sm font-bold text-white shadow-lg shadow-blue-200 transition-all hover:bg-blue-700 sm:w-auto"
              >
                Avalie este político
              </button>
              <button className="w-full rounded-2xl bg-slate-100 px-8 py-3 text-sm font-bold text-slate-600 transition-all hover:bg-slate-200 sm:w-auto dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700">
                Seguir atualizações
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs Section */}
      <div className="mb-8 -mx-4 flex overflow-x-auto border-b border-slate-200 px-4 no-scrollbar sm:mx-0 sm:px-0 dark:border-slate-700">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-bold transition-all sm:px-6 sm:py-4",
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
                      className="h-full bg-emerald-500 rounded-full transition-all duration-1000"
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
                      className="h-full bg-blue-500 rounded-full transition-all duration-1000"
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

        {activeTab === 'votacoes' && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-700 dark:bg-slate-900">
              <div className="flex flex-col gap-4 md:flex-row md:items-end">
                <div className="flex-1">
                  <label className="text-xs font-bold text-slate-600 dark:text-slate-400">Buscar</label>
                  <input
                    type="text"
                    className="mt-1 block w-full rounded-2xl border-0 py-2 px-3 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm sm:leading-6 dark:bg-slate-800 dark:text-slate-50 dark:ring-slate-700 dark:placeholder:text-slate-500"
                    placeholder="Ementa, tipo, número/ano…"
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
                Carregando votações…
              </div>
            )}

            {!isLoadingVotacoes && votacoesFiltradas.length === 0 && (
              <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                Nenhuma votação encontrada com esses filtros.
              </div>
            )}

            {votacoesFiltradas.map((v) => {
              const titulo =
                v.siglaTipo && v.numero && v.ano
                  ? `${v.siglaTipo} ${v.numero}/${v.ano}${v.ementa ? ` - ${v.ementa}` : ''}`
                  : v.ementa || 'Votação';
              const isExpanded = expandedVotoId === v.votoId;
              return (
              <div key={v.votoId} className="rounded-2xl border border-slate-200 bg-white transition-all hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600">
                <button
                  onClick={() => setExpandedVotoId((curr) => (curr === v.votoId ? null : v.votoId))}
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
                      <h4 className="break-words font-bold text-slate-900 dark:text-slate-50">{titulo}</h4>
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
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800">
                        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Ementa</div>
                        <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-50">{v.ementa || '—'}</div>
                      </div>
                      <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800">
                        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Identificadores</div>
                        <div className="mt-2 grid grid-cols-1 gap-1 text-xs text-slate-600 dark:text-slate-400">
                          <div><span className="font-bold text-slate-800 dark:text-slate-200">Voto ID:</span> {v.votoId}</div>
                          <div><span className="font-bold text-slate-800 dark:text-slate-200">Votação ID:</span> {v.votacaoId}</div>
                          <div><span className="font-bold text-slate-800 dark:text-slate-200">Político ID:</span> {v.politicoId}</div>
                        </div>
                      </div>
                      <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800">
                        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Tipo</div>
                        <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-50">{v.siglaTipo || '—'}</div>
                      </div>
                      <div className="rounded-2xl bg-slate-50 p-4 dark:bg-slate-800">
                        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Número/Ano</div>
                        <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-50">
                          {v.numero != null && v.ano != null ? `${v.numero}/${v.ano}` : '—'}
                        </div>
                      </div>
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
                  {isLoadingMoreVotacoes ? 'Carregando…' : 'Carregar mais'}
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'despesas' && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 dark:border-slate-700 dark:bg-slate-900">
              <div className="flex flex-col gap-4 md:flex-row md:items-end">
                <div className="flex-1">
                  <label className="text-xs font-bold text-slate-600 dark:text-slate-400">Tipo</label>
                  <input
                    type="text"
                    className="mt-1 block w-full rounded-2xl border-0 py-2 px-3 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm sm:leading-6 dark:bg-slate-800 dark:text-slate-50 dark:ring-slate-700 dark:placeholder:text-slate-500"
                    placeholder="Ex: Divulgação, Passagens…"
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
                Mostrando {despesasFiltradas.length} de {despesas.length}
              </div>
            </div>

            <div className="space-y-3 md:hidden">
              {isLoadingDespesas ? (
                <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                  Carregando despesas...
                </div>
              ) : despesasFiltradas.length === 0 ? (
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
                      Total no periodo
                    </div>
                    <div className="mt-1 text-lg font-black text-slate-900 dark:text-slate-50">
                      {currencyFormatter.format(despesasTotal)}
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="hidden overflow-hidden rounded-3xl border border-slate-200 bg-white md:block dark:border-slate-700 dark:bg-slate-900">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 dark:bg-slate-800 dark:border-slate-700">
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider dark:text-slate-400">Data</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider dark:text-slate-400">Tipo de Despesa</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right dark:text-slate-400">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {isLoadingDespesas ? (
                    <tr>
                      <td colSpan={3} className="px-6 py-8 text-center text-sm text-slate-600 dark:text-slate-400">
                        Carregando despesas…
                      </td>
                    </tr>
                  ) : despesasFiltradas.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-6 py-8 text-center text-sm text-slate-600 dark:text-slate-400">
                        Nenhuma despesa encontrada com esses filtros.
                      </td>
                    </tr>
                  ) : (
                    despesasFiltradas.map((d) => (
                      <tr key={d.id} className="hover:bg-slate-50/50 transition-colors dark:hover:bg-slate-800/50">
                        <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-400">
                          {new Date(`${d.ano}-${String(d.mes).padStart(2, '0')}-01`).toLocaleDateString('pt-BR')}
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
                    <td colSpan={2} className="px-6 py-4 text-sm text-slate-900 dark:text-slate-50">Total no período</td>
                    <td className="px-6 py-4 text-sm text-slate-900 text-right dark:text-slate-50">
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
                        despesasTotal
                      )}
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
                  {isLoadingMoreDespesas ? 'Carregando…' : 'Carregar mais'}
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

      <EvaluationModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        politicoId={politico.id}
        politicoName={politico.nome}
        onEvaluationSaved={handleEvaluationSaved}
      />
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
