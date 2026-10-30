import React from 'react';
import {ExternalLink} from 'lucide-react';
import type {JudicialCoverage, JudicialSummary} from '../../lib/judicialTypes';
import {officialJudicialUrl} from '../../lib/judicialSources';

export const judicialDate = (value: string | null) => value ? new Intl.DateTimeFormat('pt-BR', {timeZone: 'UTC'}).format(new Date(value)) : 'Não informada';
export const judicialCount = (value: number | null) => value === null ? 'Não pesquisado' : value.toLocaleString('pt-BR');
export function SourceLink({url, label}: {url: string; label: string}) {
  const official = officialJudicialUrl(url);
  return official ? <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 max-w-full items-center gap-2 break-words text-sm font-medium text-brand-700 underline underline-offset-4 dark:text-brand-300"><span className="min-w-0 break-words">{label || 'Consultar fonte oficial'}</span><ExternalLink size={14} aria-hidden="true" className="shrink-0" /><span className="sr-only"> (abre em nova aba)</span></a> : <span className="text-sm text-slate-500">Fonte oficial indisponível</span>;
}
export function JudicialCoverageNotice({coverage}: {coverage: JudicialCoverage}) {
  return <section aria-label="Cobertura judicial" className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-700 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
    <p className="font-semibold">{coverage.status === 'REVIEWED' ? 'Pesquisa revisada no escopo informado' : coverage.status === 'PARTIAL' ? 'Pesquisa parcial' : 'Pesquisa não realizada'}</p>
    <p>Registros encontrados em fontes oficiais. A cobertura é limitada ao escopo pesquisado e não representa uma certidão nacional completa.</p>
    {coverage.scope && <p className="mt-2 break-words"><strong>Escopo:</strong> {coverage.scope}</p>}
    {coverage.checkedAt && <p>Última revisão: {judicialDate(coverage.checkedAt)}</p>}
    {coverage.sources.length > 0 && <ul className="mt-2 space-y-1">{coverage.sources.map((source, index) => <li key={`${source.url}-${index}`}><SourceLink url={source.url} label={source.label} /></li>)}</ul>}
  </section>;
}
export function PrisonHistory({summary}: {summary: JudicialSummary}) {
  return <span>{summary.prisonHistory === 'CONFIRMED' ? `${judicialCount(summary.confirmedImprisonments)} registro(s) de prisão confirmada` : summary.prisonHistory === 'NO_RECORDS' ? 'Sem registro de prisão no escopo pesquisado' : 'Histórico de prisão não pesquisado'}</span>;
}
export function JudicialFeedback({loading, error, retry}: {loading: boolean; error?: string; retry: () => void}) {
  if (loading) return <p role="status" className="surface p-6 text-slate-600 dark:text-slate-300">Consultando registros judiciais…</p>;
  if (error) return <div role="alert" className="surface p-5 text-rose-800 dark:text-rose-300"><p>{error}</p><button type="button" onClick={retry} className="mt-3 min-h-11 rounded-lg border border-current px-4 text-sm font-semibold">Tentar novamente</button></div>;
  return null;
}
