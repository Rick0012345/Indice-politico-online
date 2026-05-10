import React, {useEffect, useState} from 'react';
import {ChevronLeft, ExternalLink, FileText} from 'lucide-react';
import {Link, useParams} from 'react-router-dom';

type Proposicao = {
  id: string;
  siglaTipo: string | null;
  numero: number | null;
  ano: number | null;
  ementa: string | null;
  ementaDetalhada: string | null;
  descricaoTipo: string | null;
  dataApresentacao: string | null;
  keywords: string | null;
  urlInteiroTeor: string | null;
  texto: string | null;
  justificativa: string | null;
  situacao: string | null;
};

type Autor = {nome: string | null; tipo: string | null; ordemAssinatura: number | null; proponente: number | null};
type Tema = {tema: string | null; relevancia: number | null};
type Tramitacao = {sequencia: number; dataHora: string | null; siglaOrgao: string | null; regime: string | null; descricaoTramitacao: string | null; descricaoSituacao: string | null; despacho: string | null; url: string | null};
type Relacionada = {id: string; siglaTipo: string | null; numero: number | null; ano: number | null; ementa: string | null};

const formatDate = (value: string | null) => {
  if (!value) return 'Data indisponivel';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data indisponivel';
  return date.toLocaleDateString('pt-BR', {timeZone: 'UTC'});
};

const EmptyBlock = ({children}: {children: React.ReactNode}) => (
  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
    {children}
  </div>
);

export const ProposicaoDetail = () => {
  const {id} = useParams();
  const [proposicao, setProposicao] = useState<Proposicao | null>(null);
  const [autores, setAutores] = useState<Autor[]>([]);
  const [temas, setTemas] = useState<Tema[]>([]);
  const [tramitacoes, setTramitacoes] = useState<Tramitacao[]>([]);
  const [relacionadas, setRelacionadas] = useState<Relacionada[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const proposicaoId = id?.trim();
    if (!proposicaoId) return;
    const controller = new AbortController();

    const run = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(`/api/camara/proposicoes/${encodeURIComponent(proposicaoId)}`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          setProposicao(null);
          return;
        }
        const data = (await response.json()) as {
          proposicao?: Proposicao;
          autores?: Autor[];
          temas?: Tema[];
          tramitacoes?: Tramitacao[];
          relacionadas?: Relacionada[];
        };
        setProposicao(data.proposicao ?? null);
        setAutores(data.autores ?? []);
        setTemas(data.temas ?? []);
        setTramitacoes(data.tramitacoes ?? []);
        setRelacionadas(data.relacionadas ?? []);
      } catch {
        setProposicao(null);
      } finally {
        setIsLoading(false);
      }
    };

    run();
    return () => controller.abort();
  }, [id]);

  if (isLoading) {
    return <div className="mx-auto max-w-5xl px-4 py-12 text-sm text-slate-500">Carregando proposicao...</div>;
  }

  if (!proposicao) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-12">
        <Link to="/camara" className="inline-flex items-center gap-2 text-sm font-bold text-blue-600 hover:underline dark:text-blue-400"><ChevronLeft size={16} /> Voltar</Link>
        <div className="mt-8 rounded-3xl border border-slate-200 bg-white p-8 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">Proposicao nao encontrada.</div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
      <Link to="/camara" className="mb-8 inline-flex items-center gap-2 text-sm font-bold text-blue-600 hover:underline dark:text-blue-400"><ChevronLeft size={16} /> Voltar para Atuacao Parlamentar</Link>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase text-slate-400 dark:text-slate-500">
              <span>{proposicao.siglaTipo} {proposicao.numero}/{proposicao.ano}</span>
              {proposicao.situacao && <span className="rounded-full bg-blue-50 px-2.5 py-1 text-blue-700 dark:bg-blue-950 dark:text-blue-300">{proposicao.situacao}</span>}
            </div>
            <h1 className="mt-4 text-3xl font-extrabold text-slate-900 dark:text-slate-50">{proposicao.ementa || 'Proposicao sem ementa'}</h1>
            <p className="mt-4 text-sm font-medium text-slate-500 dark:text-slate-400">{proposicao.descricaoTipo || 'Tipo nao informado'} • {formatDate(proposicao.dataApresentacao)}</p>
          </div>
          {proposicao.urlInteiroTeor && (
            <a href={proposicao.urlInteiroTeor} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-sm font-bold text-white hover:bg-blue-700">
              Inteiro teor <ExternalLink size={16} />
            </a>
          )}
        </div>

        {proposicao.ementaDetalhada && <p className="mt-6 rounded-2xl bg-slate-50 p-4 text-sm leading-relaxed text-slate-700 dark:bg-slate-800 dark:text-slate-300">{proposicao.ementaDetalhada}</p>}
      </section>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-extrabold text-slate-900 dark:text-slate-50"><FileText size={18} /> Autores</h2>
          {autores.length === 0 ? <EmptyBlock>Autores ainda nao sincronizados.</EmptyBlock> : (
            <div className="space-y-3">{autores.map((autor, index) => <div key={`${autor.nome}-${index}`} className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-800"><div className="font-bold text-slate-900 dark:text-slate-50">{autor.nome || 'Autor'}</div><div className="text-xs text-slate-500 dark:text-slate-400">{autor.tipo || 'Tipo nao informado'}</div></div>)}</div>
          )}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
          <h2 className="mb-4 text-lg font-extrabold text-slate-900 dark:text-slate-50">Temas</h2>
          {temas.length === 0 ? <EmptyBlock>Temas ainda nao sincronizados.</EmptyBlock> : (
            <div className="flex flex-wrap gap-2">{temas.map((tema, index) => <span key={`${tema.tema}-${index}`} className="rounded-full bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 dark:bg-blue-950 dark:text-blue-300">{tema.tema || 'Tema'}</span>)}</div>
          )}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
          <h2 className="mb-4 text-lg font-extrabold text-slate-900 dark:text-slate-50">Relacionadas</h2>
          {relacionadas.length === 0 ? <EmptyBlock>Sem proposicoes relacionadas por enquanto.</EmptyBlock> : (
            <div className="space-y-3">{relacionadas.map((item) => <Link key={item.id} to={`/camara/proposicoes/${item.id}`} className="block rounded-2xl bg-slate-50 p-3 text-sm font-bold text-slate-800 hover:text-blue-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:text-blue-400">{item.siglaTipo} {item.numero}/{item.ano}</Link>)}</div>
          )}
        </section>
      </div>

      <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
        <h2 className="mb-5 text-lg font-extrabold text-slate-900 dark:text-slate-50">Tramitacao</h2>
        {tramitacoes.length === 0 ? <EmptyBlock>Tramitacoes ainda nao sincronizadas.</EmptyBlock> : (
          <div className="space-y-4">
            {tramitacoes.map((item) => (
              <article key={item.sequencia} className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
                <div className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase text-slate-400 dark:text-slate-500">
                  <span>{formatDate(item.dataHora)}</span>
                  {item.siglaOrgao && <span>{item.siglaOrgao}</span>}
                  {item.descricaoSituacao && <span>{item.descricaoSituacao}</span>}
                </div>
                <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-slate-50">{item.descricaoTramitacao || item.despacho || 'Movimentacao registrada'}</p>
                {item.despacho && <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{item.despacho}</p>}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
