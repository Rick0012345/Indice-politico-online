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
  presenca?: number | null;
  alinhamentoGoverno?: number | null;
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

export const PoliticoProfile = () => {
  const { id } = useParams();
  const [activeTab, setActiveTab] = useState('geral');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [politico, setPolitico] = useState<PoliticoDetail | null>(null);
  const [votacoes, setVotacoes] = useState<VotacaoItem[]>([]);
  const [despesas, setDespesas] = useState<DespesaItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
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

  useEffect(() => {
    const politicoId = id?.trim();
    if (!politicoId) return;

    const controller = new AbortController();
    setIsLoading(true);

    const run = async () => {
      try {
        const [politicoRes, votacoesRes, despesasRes] = await Promise.all([
          fetch(`/api/politicos/${encodeURIComponent(politicoId)}`, {signal: controller.signal}),
          fetch(`/api/politicos/${encodeURIComponent(politicoId)}/votacoes?limit=50`, {signal: controller.signal}),
          fetch(`/api/politicos/${encodeURIComponent(politicoId)}/despesas?limit=50`, {signal: controller.signal}),
        ]);

        if (politicoRes.ok) {
          const data = (await politicoRes.json()) as {politico?: PoliticoDetail};
          if (data.politico) {
            setPolitico({
              ...data.politico,
              foto: data.politico.foto || `https://picsum.photos/seed/${data.politico.id}/400/400`,
            });
          } else {
            setPolitico(null);
          }
        } else {
          setPolitico(null);
        }

        if (votacoesRes.ok) {
          const data = (await votacoesRes.json()) as {items?: VotacaoItem[]};
          setVotacoes(data.items ?? []);
        } else {
          setVotacoes([]);
        }

        if (despesasRes.ok) {
          const data = (await despesasRes.json()) as {items?: DespesaItem[]};
          setDespesas(data.items ?? []);
        } else {
          setDespesas([]);
        }
      } catch {
        setPolitico(null);
        setVotacoes([]);
        setDespesas([]);
      } finally {
        setIsLoading(false);
      }
    };

    run();
    return () => controller.abort();
  }, [id]);

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
    return Array.from(new Set<number>(values)).sort((a, b) => b - a);
  }, [votacoes]);

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
    return Array.from(new Set<number>(values)).sort((a, b) => b - a);
  }, [despesas]);

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

  const tabs = [
    { id: 'geral', label: 'Visão Geral', icon: BarChart3 },
    { id: 'votacoes', label: 'Votações', icon: CheckCircle2 },
    { id: 'despesas', label: 'Despesas', icon: DollarSign },
    { id: 'noticias', label: 'Notícias', icon: FileText },
  ];

  if (isLoading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center text-slate-600">
          Carregando perfil…
        </div>
      </div>
    );
  }

  if (!politico) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
        <h2 className="text-2xl font-bold text-slate-900">Político não encontrado</h2>
        <Link to="/" className="text-blue-600 hover:underline">Voltar para o início</Link>
      </div>
    );
  }

  const presencaLabel = politico.presenca == null ? '—' : `${politico.presenca}%`;
  const presencaValue = politico.presenca ?? 0;
  const alinhamentoLabel = politico.alinhamentoGoverno == null ? '—' : `${politico.alinhamentoGoverno}%`;
  const alinhamentoValue = politico.alinhamentoGoverno ?? 0;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <Link to="/" className="mb-8 flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-blue-600 transition-colors">
        <ChevronLeft size={16} />
        Voltar para a busca
      </Link>

      {/* Header Section */}
      <div className="relative mb-12 overflow-hidden rounded-3xl border border-slate-200 bg-white p-6 sm:p-10 shadow-sm">
        <div className="flex flex-col md:flex-row gap-8 items-center md:items-start">
          <div className="relative h-40 w-40 shrink-0 overflow-hidden rounded-2xl border-4 border-slate-50 shadow-md">
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
                <h1 className="text-3xl font-extrabold text-slate-900">{politico.nome}</h1>
                <p className="text-lg font-medium text-slate-500">
                  {politico.partido} • {politico.estado} • {politico.cargo}
                </p>
              </div>
              <div className="flex flex-col items-center md:items-end gap-1">
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Star 
                      key={s} 
                      size={20} 
                      className={s <= Math.round(politico.notaMedia) ? "fill-yellow-400 text-yellow-400" : "text-slate-200"} 
                    />
                  ))}
                </div>
                <span className="text-2xl font-black text-slate-900">{politico.notaMedia.toFixed(1)}</span>
                <span className="text-[10px] uppercase tracking-widest font-bold text-slate-400">Nota Média</span>
              </div>
            </div>
            
            <div className="mt-8 flex flex-wrap justify-center md:justify-start gap-4">
              <button 
                onClick={() => setIsModalOpen(true)}
                className="rounded-2xl bg-blue-600 px-8 py-3 text-sm font-bold text-white shadow-lg shadow-blue-200 hover:bg-blue-700 transition-all"
              >
                Avalie este político
              </button>
              <button className="rounded-2xl bg-slate-100 px-8 py-3 text-sm font-bold text-slate-600 hover:bg-slate-200 transition-all">
                Seguir atualizações
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs Section */}
      <div className="mb-8 flex border-b border-slate-200 overflow-x-auto no-scrollbar">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-2 border-b-2 px-6 py-4 text-sm font-bold transition-all whitespace-nowrap",
              activeTab === tab.id 
                ? "border-blue-600 text-blue-600" 
                : "border-transparent text-slate-400 hover:text-slate-600"
            )}
          >
            <tab.icon size={18} />
            {tab.label}
            {tab.id === 'votacoes' && (
              <span
                className={cn(
                  "ml-1 inline-flex min-w-6 items-center justify-center rounded-full px-2 py-0.5 text-[11px] font-black",
                  activeTab === tab.id ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600",
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="rounded-3xl border border-slate-200 bg-white p-8">
              <h3 className="text-lg font-bold text-slate-900 mb-6">Desempenho Parlamentar</h3>
              <div className="space-y-8">
                <div>
                  <div className="flex justify-between mb-2">
                    <span className="text-sm font-medium text-slate-600">Presença em Sessões</span>
                    <span className="text-sm font-bold text-slate-900">{presencaLabel}</span>
                  </div>
                  <div className="h-3 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div 
                      className="h-full bg-emerald-500 rounded-full transition-all duration-1000" 
                      style={{ width: `${presencaValue}%` }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between mb-2">
                    <span className="text-sm font-medium text-slate-600">Alinhamento com o Governo</span>
                    <span className="text-sm font-bold text-slate-900">{alinhamentoLabel}</span>
                  </div>
                  <div className="h-3 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div 
                      className="h-full bg-blue-500 rounded-full transition-all duration-1000" 
                      style={{ width: `${alinhamentoValue}%` }}
                    />
                  </div>
                </div>
              </div>
              <div className="mt-10 p-4 rounded-2xl bg-blue-50 border border-blue-100 flex gap-3">
                <Info size={20} className="text-blue-600 shrink-0" />
                <p className="text-xs text-blue-800 leading-relaxed">
                  O alinhamento é calculado com base na convergência dos votos do parlamentar com a orientação da liderança do governo no Congresso.
                </p>
              </div>
            </div>
            
            <div className="rounded-3xl border border-slate-200 bg-white p-8 flex flex-col items-center justify-center text-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-yellow-50 text-yellow-600">
                <AlertCircle size={32} />
              </div>
              <h3 className="text-lg font-bold text-slate-900">Histórico de Escândalos</h3>
              <p className="mt-2 text-sm text-slate-500 max-w-xs">
                Nenhum processo judicial ou escândalo grave registrado recentemente para este parlamentar em fontes oficiais.
              </p>
            </div>
          </div>
        )}

        {activeTab === 'votacoes' && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex flex-col gap-4 md:flex-row md:items-end">
                <div className="flex-1">
                  <label className="text-xs font-bold text-slate-600">Buscar</label>
                  <input
                    type="text"
                    className="mt-1 block w-full rounded-2xl border-0 py-2 px-3 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm sm:leading-6"
                    placeholder="Ementa, tipo, número/ano…"
                    value={votacoesFiltro.texto}
                    onChange={(e) => setVotacoesFiltro((curr) => ({...curr, texto: e.target.value}))}
                  />
                </div>
                <div className="w-full md:w-48">
                  <label className="text-xs font-bold text-slate-600">Voto</label>
                  <select
                    className="mt-1 block w-full rounded-2xl border-0 py-2 px-3 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-200 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm sm:leading-6"
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
                  <label className="text-xs font-bold text-slate-600">Tipo</label>
                  <select
                    className="mt-1 block w-full rounded-2xl border-0 py-2 px-3 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-200 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm sm:leading-6"
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
                  <label className="text-xs font-bold text-slate-600">Ano</label>
                  <select
                    className="mt-1 block w-full rounded-2xl border-0 py-2 px-3 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-200 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm sm:leading-6"
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
                  className="w-full rounded-2xl bg-slate-100 px-5 py-2 text-sm font-bold text-slate-700 hover:bg-slate-200 disabled:opacity-50 disabled:hover:bg-slate-100 md:w-auto"
                >
                  Limpar
                </button>
              </div>
              <div className="mt-3 text-xs font-medium text-slate-500">
                Mostrando {votacoesFiltradas.length} de {votacoes.length}
              </div>
            </div>

            {votacoesFiltradas.length === 0 && (
              <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-600">
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
              <div key={v.votoId} className="rounded-2xl border border-slate-200 bg-white transition-all hover:border-slate-300">
                <button
                  onClick={() => setExpandedVotoId((curr) => (curr === v.votoId ? null : v.votoId))}
                  className="flex w-full items-center justify-between p-6 text-left"
                >
                  <div className="flex gap-4 items-start">
                    <div className={cn(
                      "mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
                      v.voto === 'Sim' ? "bg-emerald-50 text-emerald-600" : 
                      v.voto === 'Não' ? "bg-rose-50 text-rose-600" : "bg-slate-50 text-slate-600"
                    )}>
                      {v.voto === 'Sim' ? <CheckCircle2 size={20} /> : 
                       v.voto === 'Não' ? <XCircle size={20} /> : <MinusCircle size={20} />}
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-900">{titulo}</h4>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                        <span className="flex items-center gap-1">
                          <Calendar size={12} />{' '}
                          {v.dataVotacao ? new Date(v.dataVotacao).toLocaleDateString('pt-BR') : 'Data indisponível'}
                        </span>
                        <span className={cn(
                          "font-bold uppercase tracking-wider",
                          v.voto === 'Sim' ? "text-emerald-600" : 
                          v.voto === 'Não' ? "text-rose-600" : "text-slate-600"
                        )}>Votou: {v.voto}</span>
                      </div>
                    </div>
                  </div>
                  <span className={cn("text-slate-400 transition-transform", isExpanded ? "rotate-90" : "rotate-0")}>
                    <ChevronRight size={18} />
                  </span>
                </button>

                {isExpanded && (
                  <div className="border-t border-slate-100 px-6 py-5">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div className="rounded-2xl bg-slate-50 p-4">
                        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Ementa</div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">{v.ementa || '—'}</div>
                      </div>
                      <div className="rounded-2xl bg-slate-50 p-4">
                        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Identificadores</div>
                        <div className="mt-2 grid grid-cols-1 gap-1 text-xs text-slate-600">
                          <div><span className="font-bold text-slate-800">Voto ID:</span> {v.votoId}</div>
                          <div><span className="font-bold text-slate-800">Votação ID:</span> {v.votacaoId}</div>
                          <div><span className="font-bold text-slate-800">Político ID:</span> {v.politicoId}</div>
                        </div>
                      </div>
                      <div className="rounded-2xl bg-slate-50 p-4">
                        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Tipo</div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">{v.siglaTipo || '—'}</div>
                      </div>
                      <div className="rounded-2xl bg-slate-50 p-4">
                        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Número/Ano</div>
                        <div className="mt-1 text-sm font-semibold text-slate-900">
                          {v.numero != null && v.ano != null ? `${v.numero}/${v.ano}` : '—'}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              );
            })}
          </div>
        )}

        {activeTab === 'despesas' && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex flex-col gap-4 md:flex-row md:items-end">
                <div className="flex-1">
                  <label className="text-xs font-bold text-slate-600">Tipo</label>
                  <input
                    type="text"
                    className="mt-1 block w-full rounded-2xl border-0 py-2 px-3 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm sm:leading-6"
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
                  <label className="text-xs font-bold text-slate-600">Ano</label>
                  <select
                    className="mt-1 block w-full rounded-2xl border-0 py-2 px-3 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-200 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm sm:leading-6"
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
                  <label className="text-xs font-bold text-slate-600">Mês</label>
                  <select
                    className="mt-1 block w-full rounded-2xl border-0 py-2 px-3 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-200 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm sm:leading-6"
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
                  <label className="text-xs font-bold text-slate-600">Valor mín.</label>
                  <input
                    inputMode="decimal"
                    className="mt-1 block w-full rounded-2xl border-0 py-2 px-3 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm sm:leading-6"
                    placeholder="0"
                    value={despesasFiltro.valorMin}
                    onChange={(e) => setDespesasFiltro((curr) => ({...curr, valorMin: e.target.value}))}
                  />
                </div>
                <div className="w-full md:w-40">
                  <label className="text-xs font-bold text-slate-600">Valor máx.</label>
                  <input
                    inputMode="decimal"
                    className="mt-1 block w-full rounded-2xl border-0 py-2 px-3 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-200 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm sm:leading-6"
                    placeholder="0"
                    value={despesasFiltro.valorMax}
                    onChange={(e) => setDespesasFiltro((curr) => ({...curr, valorMax: e.target.value}))}
                  />
                </div>
                <button
                  type="button"
                  disabled={!despesasHasFiltro}
                  onClick={() => setDespesasFiltro({tipo: '', ano: '', mes: '', valorMin: '', valorMax: ''})}
                  className="w-full rounded-2xl bg-slate-100 px-5 py-2 text-sm font-bold text-slate-700 hover:bg-slate-200 disabled:opacity-50 disabled:hover:bg-slate-100 md:w-auto"
                >
                  Limpar
                </button>
              </div>
              <div className="mt-3 text-xs font-medium text-slate-500">
                Mostrando {despesasFiltradas.length} de {despesas.length}
              </div>
            </div>

            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Data</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Tipo de Despesa</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {despesasFiltradas.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-6 py-8 text-center text-sm text-slate-600">
                        Nenhuma despesa encontrada com esses filtros.
                      </td>
                    </tr>
                  ) : (
                    despesasFiltradas.map((d) => (
                      <tr key={d.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-6 py-4 text-sm text-slate-600">
                          {new Date(`${d.ano}-${String(d.mes).padStart(2, '0')}-01`).toLocaleDateString('pt-BR')}
                        </td>
                        <td className="px-6 py-4 text-sm font-medium text-slate-900">{d.tipo}</td>
                        <td className="px-6 py-4 text-sm font-bold text-slate-900 text-right">
                          {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(d.valor)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 font-bold">
                    <td colSpan={2} className="px-6 py-4 text-sm text-slate-900">Total no período</td>
                    <td className="px-6 py-4 text-sm text-slate-900 text-right">
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(
                        despesasTotal
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'noticias' && (
          <div className="rounded-3xl border border-slate-200 bg-white p-8 text-slate-600">
            Notícias em breve.
          </div>
        )}
      </div>

      <EvaluationModal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        politicoName={politico.nome} 
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
