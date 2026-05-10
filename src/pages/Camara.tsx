import React, {useEffect, useMemo, useState} from 'react';
import {CalendarDays, ExternalLink, FileText, Landmark, Search, Users} from 'lucide-react';
import {Link} from 'react-router-dom';
import {cn} from '../lib/utils';

type TabId = 'proposicoes' | 'eventos' | 'orgaos' | 'frentes';

type ProposicaoItem = {
  id: string;
  siglaTipo: string | null;
  numero: number | null;
  ano: number | null;
  ementa: string | null;
  descricaoTipo: string | null;
  dataApresentacao: string | null;
  urlInteiroTeor: string | null;
  situacao: string | null;
  totalTemas: number;
  totalAutores: number;
  totalTramitacoes: number;
};

type EventoItem = {
  id: string;
  dataHoraInicio: string | null;
  situacao: string | null;
  descricaoTipo: string | null;
  descricao: string | null;
  localExterno: string | null;
  localCamara: {nome?: string; predio?: string; sala?: string} | null;
  orgaos: Array<{sigla?: string; nome?: string}> | null;
  urlRegistro: string | null;
};

type OrgaoItem = {
  id: string;
  sigla: string | null;
  nome: string | null;
  apelido: string | null;
  tipoOrgao: string | null;
  nomePublicacao: string | null;
  nomeResumido: string | null;
};

type FrenteItem = {
  id: string;
  titulo: string | null;
  idLegislatura: number | null;
  uri: string | null;
};

const tabs: Array<{id: TabId; label: string; icon: React.ComponentType<{size?: number; className?: string}>}> = [
  {id: 'proposicoes', label: 'Proposicoes', icon: FileText},
  {id: 'eventos', label: 'Eventos', icon: CalendarDays},
  {id: 'orgaos', label: 'Orgaos', icon: Landmark},
  {id: 'frentes', label: 'Frentes', icon: Users},
];

const formatDate = (value: string | null) => {
  if (!value) return 'Data indisponivel';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data indisponivel';
  return date.toLocaleDateString('pt-BR', {timeZone: 'UTC'});
};

const EmptyState = () => (
  <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center text-sm font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
    Esses dados ainda estao sendo sincronizados pela API da Camara.
  </div>
);

export const Camara = () => {
  const [activeTab, setActiveTab] = useState<TabId>('proposicoes');
  const [search, setSearch] = useState('');
  const [year, setYear] = useState('');
  const [kind, setKind] = useState('');
  const [items, setItems] = useState<Array<ProposicaoItem | EventoItem | OrgaoItem | FrenteItem>>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    const run = async () => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams({limit: '120'});
        const trimmedSearch = search.trim();
        const trimmedKind = kind.trim();
        if (trimmedSearch) params.set('search', trimmedSearch);
        if (trimmedKind) params.set(activeTab === 'frentes' ? 'legislatura' : 'tipo', trimmedKind);
        if (activeTab === 'proposicoes' && year.trim()) params.set('ano', year.trim());

        const response = await fetch(`/api/camara/${activeTab}?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!response.ok) return;
        const data = (await response.json()) as {items?: Array<ProposicaoItem | EventoItem | OrgaoItem | FrenteItem>};
        setItems(data.items ?? []);
      } catch {
        setItems([]);
      } finally {
        setIsLoading(false);
      }
    };

    const timeoutId = setTimeout(run, 250);
    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [activeTab, search, year, kind]);

  useEffect(() => {
    setItems([]);
    setSearch('');
    setYear('');
    setKind('');
  }, [activeTab]);

  const placeholder = useMemo(() => {
    if (activeTab === 'proposicoes') return 'Buscar por ementa, palavra-chave ou texto';
    if (activeTab === 'eventos') return 'Buscar por descricao, tipo ou local';
    if (activeTab === 'orgaos') return 'Buscar por sigla, nome ou apelido';
    return 'Buscar por titulo da frente';
  }, [activeTab]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="mb-10">
        <h1 className="text-4xl font-extrabold text-slate-900 dark:text-slate-50">Atuacao Parlamentar</h1>
        <p className="mt-4 max-w-3xl text-lg text-slate-600 dark:text-slate-400">
          Explore proposicoes, eventos, orgaos e frentes com dados sincronizados da API da Camara.
        </p>
      </div>

      <div className="mb-8 -mx-4 flex overflow-x-auto border-b border-slate-200 px-4 no-scrollbar sm:mx-0 sm:px-0 dark:border-slate-700">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-bold transition-all sm:px-6 sm:py-4',
              activeTab === tab.id
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300',
            )}
          >
            <tab.icon size={18} />
            {tab.label}
          </button>
        ))}
      </div>

      <section className="mb-8 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(220px,1fr)_160px_180px]">
          <label className="relative block">
            <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={placeholder}
              className="w-full rounded-xl border-slate-200 pl-10 text-sm font-medium focus:ring-blue-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            />
          </label>
          <input
            value={kind}
            onChange={(event) => setKind(event.target.value)}
            placeholder={activeTab === 'frentes' ? 'Legislatura' : 'Tipo'}
            className="w-full rounded-xl border-slate-200 text-sm font-medium focus:ring-blue-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          />
          <input
            value={year}
            disabled={activeTab !== 'proposicoes'}
            onChange={(event) => setYear(event.target.value)}
            placeholder="Ano"
            className="w-full rounded-xl border-slate-200 text-sm font-medium focus:ring-blue-600 disabled:bg-slate-100 disabled:text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:disabled:bg-slate-800/50"
          />
        </div>
      </section>

      {isLoading ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center text-sm font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
          Carregando dados...
        </div>
      ) : items.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {activeTab === 'proposicoes' &&
            (items as ProposicaoItem[]).map((item) => (
              <Link key={item.id} to={`/camara/proposicoes/${item.id}`} className="group rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md dark:border-slate-700 dark:bg-slate-900 dark:hover:border-blue-900">
                <div className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase text-slate-400 dark:text-slate-500">
                  <span>{item.siglaTipo} {item.numero}/{item.ano}</span>
                  {item.situacao && <span className="rounded-full bg-blue-50 px-2 py-1 text-blue-700 dark:bg-blue-950 dark:text-blue-300">{item.situacao}</span>}
                </div>
                <h2 className="mt-3 line-clamp-3 text-lg font-extrabold text-slate-900 group-hover:text-blue-600 dark:text-slate-50 dark:group-hover:text-blue-400">{item.ementa || 'Proposicao sem ementa'}</h2>
                <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
                  <span>{formatDate(item.dataApresentacao)}</span>
                  <span>{item.totalAutores} autores</span>
                  <span>{item.totalTemas} temas</span>
                  <span>{item.totalTramitacoes} tramitacoes</span>
                </div>
              </Link>
            ))}

          {activeTab === 'eventos' &&
            (items as EventoItem[]).map((item) => (
              <article key={item.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                <div className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase text-slate-400 dark:text-slate-500">
                  <span>{formatDate(item.dataHoraInicio)}</span>
                  {item.situacao && <span>{item.situacao}</span>}
                </div>
                <h2 className="mt-3 text-lg font-extrabold text-slate-900 dark:text-slate-50">{item.descricaoTipo || 'Evento'}</h2>
                <p className="mt-2 line-clamp-3 text-sm text-slate-600 dark:text-slate-400">{item.descricao || 'Descricao indisponivel'}</p>
                <p className="mt-3 text-sm font-semibold text-slate-500 dark:text-slate-400">{item.localExterno || item.localCamara?.nome || 'Local nao informado'}</p>
                {item.urlRegistro && <a href={item.urlRegistro} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-blue-600 hover:underline dark:text-blue-400">Registro oficial <ExternalLink size={14} /></a>}
              </article>
            ))}

          {activeTab === 'orgaos' &&
            (items as OrgaoItem[]).map((item) => (
              <article key={item.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                <div className="text-xs font-bold uppercase text-slate-400 dark:text-slate-500">{item.tipoOrgao || 'Orgao'}</div>
                <h2 className="mt-2 text-xl font-extrabold text-slate-900 dark:text-slate-50">{item.sigla || item.nomeResumido || item.id}</h2>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{item.nome || item.nomePublicacao || item.apelido || 'Nome indisponivel'}</p>
              </article>
            ))}

          {activeTab === 'frentes' &&
            (items as FrenteItem[]).map((item) => (
              <article key={item.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                <div className="text-xs font-bold uppercase text-slate-400 dark:text-slate-500">Legislatura {item.idLegislatura ?? '-'}</div>
                <h2 className="mt-2 text-lg font-extrabold text-slate-900 dark:text-slate-50">{item.titulo || 'Frente parlamentar'}</h2>
                {item.uri && <a href={item.uri} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-blue-600 hover:underline dark:text-blue-400">Fonte oficial <ExternalLink size={14} /></a>}
              </article>
            ))}
        </div>
      )}
    </div>
  );
};
