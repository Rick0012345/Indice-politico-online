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
  <p className="rounded-xl border border-dashed border-slate-200 px-4 py-5 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
    {children}
  </p>
);

export const ProposicaoDetail = () => {
  const [requestError, setRequestError] = useState('');
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
    setRequestError('');

    const run = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(`/api/camara/proposicoes/${encodeURIComponent(proposicaoId)}`, {
          signal: controller.signal,
        });
        if (response.status === 404) { if (!controller.signal.aborted) setProposicao(null); return; }
        if (!response.ok) throw new Error('HTTP');
        const data = (await response.json()) as {
          proposicao?: Proposicao;
          autores?: Autor[];
          temas?: Tema[];
          tramitacoes?: Tramitacao[];
          relacionadas?: Relacionada[];
        };
        if (controller.signal.aborted) return;
        setProposicao(data.proposicao ?? null);
        setAutores(data.autores ?? []);
        setTemas(data.temas ?? []);
        setTramitacoes(data.tramitacoes ?? []);
        setRelacionadas(data.relacionadas ?? []);
      } catch {
        if (controller.signal.aborted) return;
        setRequestError('Não foi possível carregar a proposição. Tente novamente.');
        setProposicao(null);
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    };

    run();
    return () => controller.abort();
  }, [id]);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl space-y-4 px-4 py-12 sm:px-6 lg:px-8" aria-busy="true">
        <span className="sr-only">Carregando proposição...</span>
        <div className="skeleton h-4 w-40" />
        <div className="skeleton h-10 w-3/4" />
        <div className="skeleton h-40 w-full" />
      </div>
    );
  }

  if (!proposicao) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-12">
        <Link to="/camara" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline dark:text-brand-300"><ChevronLeft size={16} /> Voltar</Link>
        <div role={requestError ? 'alert' : undefined} className="surface mt-8 p-8 text-slate-600 dark:text-slate-400">{requestError || 'Proposição não encontrada.'}</div>
      </div>
    );
  }

  const ultimaTramitacao = tramitacoes.length > 0 ? tramitacoes[tramitacoes.length - 1] : null;

  return (
    <div className="mx-auto max-w-7xl px-4 pb-24 pt-8 sm:px-6 lg:px-8">
      <Link to="/camara" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline dark:text-brand-300"><ChevronLeft size={16} /> Voltar para Atuação parlamentar</Link>

      <header className="mt-6">
        <div className="flex flex-wrap items-center gap-3">
          <span className="tabular rounded-lg bg-brand-50 px-2.5 py-1 font-mono text-sm font-semibold text-brand-800 dark:bg-brand-950 dark:text-brand-200">{proposicao.siglaTipo} {proposicao.numero}/{proposicao.ano}</span>
          {proposicao.situacao && <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-300"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-brand-500" />{proposicao.situacao}</span>}
          <span className="text-sm text-slate-500 dark:text-slate-400">{proposicao.descricaoTipo || 'Tipo não informado'} · apresentada em {formatDate(proposicao.dataApresentacao)}</span>
        </div>
        <h1 className="mt-4 max-w-4xl text-2xl font-semibold leading-tight tracking-tight text-slate-950 sm:text-3xl dark:text-slate-50" style={{textWrap: 'balance'}}>{proposicao.ementa || 'Proposição sem ementa'}</h1>
      </header>

      <div className="mt-8 flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 space-y-6">
          {proposicao.ementaDetalhada && (
            <section className="surface p-5 sm:p-6">
              <h2 className="text-sm font-semibold text-brand-700 dark:text-brand-300">Em detalhe</h2>
              <p className="mt-2 text-base leading-7 text-slate-800 dark:text-slate-200">{proposicao.ementaDetalhada}</p>
            </section>
          )}

          <section className="surface p-5 sm:p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Tramitação</h2>
              {ultimaTramitacao && <span className="text-xs text-slate-500 dark:text-slate-400">Última movimentação em {formatDate(ultimaTramitacao.dataHora)}</span>}
            </div>
            {tramitacoes.length === 0 ? <div className="mt-4"><EmptyBlock>Tramitações ainda não sincronizadas.</EmptyBlock></div> : (
              <ol className="relative mt-5 space-y-5 border-l border-slate-200 pl-6 dark:border-slate-800">
                {tramitacoes.map((item, index) => (
                  <li key={item.sequencia} className="relative">
                    <span
                      aria-hidden="true"
                      className={index === tramitacoes.length - 1
                        ? 'absolute -left-[31px] top-1 h-3 w-3 rounded-full bg-brand-600 ring-4 ring-brand-100 dark:bg-brand-400 dark:ring-brand-950'
                        : 'absolute -left-[30px] top-1.5 h-2.5 w-2.5 rounded-full bg-slate-300 dark:bg-slate-600'}
                    />
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                      <span className="tabular font-mono">{formatDate(item.dataHora)}</span>
                      {item.siglaOrgao && <span className="font-medium text-slate-700 dark:text-slate-300">{item.siglaOrgao}</span>}
                      {item.descricaoSituacao && <span>{item.descricaoSituacao}</span>}
                    </div>
                    <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-50">{item.descricaoTramitacao || item.despacho || 'Movimentação registrada'}</p>
                    {item.despacho && <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-400">{item.despacho}</p>}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <aside className="w-full space-y-6 lg:w-[360px] lg:shrink-0">
          {proposicao.urlInteiroTeor && (
            <a href={proposicao.urlInteiroTeor} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-2 rounded-2xl bg-slate-900 px-5 py-4 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-900">
              <span className="flex items-center gap-2"><FileText size={16} aria-hidden="true" /> Ler inteiro teor</span>
              <ExternalLink size={15} aria-hidden="true" />
            </a>
          )}

          <section className="surface p-5">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">Autores</h2>
            {autores.length === 0 ? <div className="mt-3"><EmptyBlock>Autores ainda não sincronizados.</EmptyBlock></div> : (
              <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
                {autores.map((autor, index) => (
                  <li key={`${autor.nome}-${index}`} className="py-2.5">
                    <span className="block text-sm font-medium text-slate-900 dark:text-slate-50">{autor.nome || 'Autor'}</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">{autor.tipo || 'Tipo não informado'}{autor.proponente ? ' · proponente' : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="surface p-5">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">Temas</h2>
            {temas.length === 0 ? <div className="mt-3"><EmptyBlock>Temas ainda não sincronizados.</EmptyBlock></div> : (
              <div className="mt-3 flex flex-wrap gap-2">{temas.map((tema, index) => <span key={`${tema.tema}-${index}`} className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-700 dark:border-slate-700 dark:text-slate-300">{tema.tema || 'Tema'}</span>)}</div>
            )}
          </section>

          <section className="surface p-5">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">Relacionadas</h2>
            {relacionadas.length === 0 ? <div className="mt-3"><EmptyBlock>Sem proposições relacionadas por enquanto.</EmptyBlock></div> : (
              <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
                {relacionadas.map((item) => (
                  <li key={item.id}>
                    <Link to={`/camara/proposicoes/${item.id}`} className="block py-2.5 hover:text-brand-700">
                      <span className="tabular block font-mono text-xs text-slate-500 dark:text-slate-400">{item.siglaTipo} {item.numero}/{item.ano}</span>
                      {item.ementa && <span className="line-clamp-2 text-sm font-medium text-slate-800 dark:text-slate-200">{item.ementa}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
};
