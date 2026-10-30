import React from 'react';
import {Link} from 'react-router-dom';
import {convictionStatuses, custodyTypes, judicialCategories, type JudicialProfile as Profile, type JudicialCategory} from '../../lib/judicialTypes';
import {JudicialCoverageNotice, JudicialFeedback, PrisonHistory, SourceLink, judicialDate} from './JudicialDetails';
import {useJudicialResource} from './useJudicialResource';

export function JudicialProfile({politicoId}: {politicoId: string}) {
  const {data, loading, error, retry} = useJudicialResource<Profile>(`/api/politicos/${encodeURIComponent(politicoId)}/judicial`);
  if (loading || error || !data) return <JudicialFeedback loading={loading} error={error} retry={retry} />;
  const {summary, records} = data;
  return <section aria-labelledby="judicial-profile-title" className="min-w-0 space-y-5 text-slate-900 dark:text-slate-100">
    <div><h2 id="judicial-profile-title" className="text-2xl font-semibold text-slate-900 dark:text-slate-50">Histórico judicial</h2><p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">Condenações e prisões são registros distintos. Prisão efetiva não equivale a condenação definitiva nem acrescenta pontos ao ranking. <Link to="/metodologia#judicial" className="text-brand-700 underline dark:text-brand-300">Entenda os critérios</Link>.</p></div>
    <JudicialCoverageNotice coverage={summary.coverage} />
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{(Object.entries(judicialCategories) as Array<[JudicialCategory, string]>).map(([category, label]) => <div key={category} className="surface p-4"><dt className="text-sm font-medium text-slate-600 dark:text-slate-400">{label}</dt><dd className="mt-2 text-xl font-semibold text-slate-900 dark:text-slate-50">{summary.finalConvictions === null ? 'Não pesquisado' : summary.counts[category].final} <span className="text-sm font-normal">definitivas</span></dd><dd className="mt-1 text-sm text-slate-600 dark:text-slate-400">{summary.appealConvictions === null ? 'Não pesquisado' : summary.counts[category].appeal} sujeitas a recurso</dd></div>)}</dl>
    <p className="text-sm text-slate-700 dark:text-slate-300"><PrisonHistory summary={summary} /></p>
    {records.length === 0 ? <p className="surface p-5 text-slate-600 dark:text-slate-300">{summary.coverage.status === 'NOT_RESEARCHED' ? 'Sem pesquisa publicada para este perfil.' : 'Nenhum registro encontrado no escopo pesquisado.'}</p> : <ol className="space-y-4">{records.map(record => <li key={record.id} className="surface min-w-0 break-words p-5 sm:p-6">
      <div className="flex flex-wrap gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300"><span>{record.kind === 'CONVICTION' ? 'Condenação' : 'Prisão efetiva confirmada'}</span><span>· {judicialCategories[record.category]}</span><span>· {record.kind === 'CONVICTION' ? record.convictionStatus && convictionStatuses[record.convictionStatus] : record.custodyType && custodyTypes[record.custodyType]}</span></div>
      <h3 className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-50">{record.title}</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-slate-300">{record.description}</p>
      <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2"><div><dt className="font-semibold">Processo / órgão</dt><dd>{record.caseNumber} · {record.court}</dd></div><div><dt className="font-semibold">{record.kind === 'CONVICTION' ? 'Data da decisão' : 'Data da prisão'}</dt><dd>{judicialDate(record.eventDate)}</dd></div>
      {record.kind === 'CONVICTION' && record.finalityDate && <div><dt className="font-semibold">Trânsito em julgado</dt><dd>{judicialDate(record.finalityDate)}</dd></div>}
      {record.kind === 'IMPRISONMENT' && <><div><dt className="font-semibold">Motivo / fundamento</dt><dd className="whitespace-pre-wrap">{record.grounds}</dd></div><div><dt className="font-semibold">Soltura</dt><dd>{record.releasedAt ? judicialDate(record.releasedAt) : 'Sem data informada na base'}</dd></div></>}
      <div className="sm:col-span-2"><dt className="font-semibold">Desfecho registrado</dt><dd className="whitespace-pre-wrap">{record.outcome || 'Não informado na fonte cadastrada'}</dd></div></dl>
      <div className="mt-3"><SourceLink url={record.sourceUrl} label={record.sourceLabel} /></div><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Verificado em {judicialDate(record.checkedAt)}</p>
    </li>)}</ol>}
  </section>;
}
