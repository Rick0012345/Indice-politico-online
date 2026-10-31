import React from 'react';
import {Link} from 'react-router-dom';
import {convictionStatuses, custodyTypes, judicialCategories, type JudicialProfile as Profile, type JudicialCategory, judicialCaseKey} from '../../lib/judicialTypes';
import {JudicialCoverageNotice, JudicialFeedback, PrisonHistory, SourceLink, judicialDate} from './JudicialDetails';
import {ProceedingsCoverage, proceedingCount} from './JudicialAttributes';
import {useJudicialResource} from './useJudicialResource';

export function JudicialProfile({politicoId}: {politicoId: string}) {
  const {data, loading, error, retry} = useJudicialResource<Profile>(`/api/politicos/${encodeURIComponent(politicoId)}/judicial`);
  if (loading || error || !data) return <JudicialFeedback loading={loading} error={error} retry={retry} />;
  const {summary, records} = data;
  const proceedings = (data.cases ?? []).map(item => ({...item, aliases: item.aliases.filter(alias => judicialCaseKey({court:item.court,caseNumber:alias}) !== judicialCaseKey(item))}));
  const cases = new Map<string, typeof records>();
  for (const record of records) {
    const key = judicialCaseKey(record);
    cases.set(key, [...(cases.get(key) ?? []), record]);
  }
  return <section aria-labelledby="judicial-profile-title" className="min-w-0 space-y-5 text-slate-900 dark:text-slate-100">
    <div><h2 id="judicial-profile-title" className="text-2xl font-semibold text-slate-900 dark:text-slate-50">Histórico judicial</h2><p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">Condenações e prisões são registros distintos. Prisão efetiva não equivale a condenação definitiva nem acrescenta pontos ao ranking. <Link to="/metodologia#judicial" className="text-brand-700 underline dark:text-brand-300">Entenda os critérios</Link>.</p></div>
    <section aria-labelledby="proceedings-profile-title" className="space-y-4">
      <h3 id="proceedings-profile-title" className="text-xl font-semibold">Processos identificados</h3>
      <ProceedingsCoverage proceedings={summary.proceedings}/>
      <p className="text-sm">{proceedingCount(summary.proceedings?.againstPerson)} processos contra identificados · {proceedingCount(summary.proceedings?.activeAgainstPerson)} ativos contra · {proceedingCount(summary.proceedings?.investigations)} investigações · {proceedingCount(summary.proceedings?.enforcements)} execuções</p>
      {!!proceedings.length ? <><p className="text-sm text-slate-600 dark:text-slate-300">O histórico inclui todos os papéis processuais com identidade confirmada. Uma menção a processo não comprova condenação ou prisão.</p><ol aria-label="Processos identificados" className="space-y-4">{proceedings.map(item => <li key={item.id} className="surface min-w-0 space-y-4 break-words p-5 sm:p-6">
        <div><h4 className="text-lg font-semibold">{item.caseNumber} · {item.court}</h4><p className="mt-1 text-sm">{item.status === 'ACTIVE' ? 'Em tramitação' : item.status === 'INACTIVE' ? 'Fora de tramitação' : 'Situação processual não identificada'}</p></div>
        <dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="font-semibold">Número CNJ</dt><dd>{item.cnjNumber || 'Não informado pela fonte'}</dd></div><div><dt className="font-semibold">Papel da pessoa</dt><dd>{item.roles.map(role => role.label || role.role).join(' · ') || 'Não identificado'}</dd></div><div><dt className="font-semibold">Fase</dt><dd>{{ACTION:'Ação',INVESTIGATION:'Investigação',ENFORCEMENT:'Execução',OTHER:'Outra'}[item.phase]}</dd></div><div><dt className="font-semibold">Distribuição</dt><dd>{judicialDate(item.filedAt)}</dd></div><div className="sm:col-span-2"><dt className="font-semibold">Assunto</dt><dd>{item.subjects.join(' · ') || 'Não informado pela fonte'}</dd></div>{item.aliases.length > 0 && <div className="sm:col-span-2"><dt className="font-semibold">Outras numerações do mesmo processo</dt><dd>{item.aliases.join(' · ')}</dd></div>}</dl>
        <p className="text-sm">{item.countsAgainstPerson ? 'Réu ou requerido: entra na contagem de processos contra identificados.' : 'Este papel ou fase não entra na contagem de processos contra. Investigações e execuções têm contadores próprios.'}</p>
        <ul className="space-y-1">{item.sources.map(source => <li key={source.url}><SourceLink url={source.url} label={source.label}/></li>)}</ul><p className="text-xs text-slate-500 dark:text-slate-400">Consulta em {judicialDate(item.checkedAt)}</p>
      </li>)}</ol></> : <p className="surface p-4 text-sm text-slate-600 dark:text-slate-300">{!summary.proceedings || summary.proceedings.coverage.status === 'NOT_RESEARCHED' ? 'Processos ainda não apurados para este perfil.' : summary.proceedings.coverage.status === 'FAILED' ? 'A consulta processual não foi concluída. A falha não indica ausência de processos.' : 'Nenhum vínculo processual confirmado nas fontes consultadas. Isso não indica ausência de processos em outras fontes ou de vínculos ainda pendentes.'}</p>}
    </section>
    <h3 className="text-xl font-semibold">Condenações e prisões</h3>
    <JudicialCoverageNotice coverage={summary.coverage} />
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{(Object.entries(judicialCategories) as Array<[JudicialCategory, string]>).map(([category, label]) => <div key={category} className="surface p-4"><dt className="text-sm font-medium text-slate-600 dark:text-slate-400">{label}</dt><dd className="mt-2 font-semibold text-slate-900 dark:text-slate-50">{summary.coverage.status === 'NOT_RESEARCHED' ? 'Não pesquisado' : `${summary.counts[category].identified ?? summary.counts[category].final + summary.counts[category].appeal} identificadas`}</dd><dd className="mt-2 text-xl font-semibold text-slate-900 dark:text-slate-50">{summary.finalConvictions === null ? 'Não pesquisado' : summary.counts[category].final} <span className="text-sm font-normal">definitivas</span></dd><dd className="mt-1 text-sm text-slate-600 dark:text-slate-400">{summary.appealConvictions === null ? 'Não pesquisado' : summary.counts[category].appeal} sujeitas a recurso</dd></div>)}</dl>
    <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">Identificadas inclui condenações sem situação atual descrita na fonte; anuladas, revertidas e com punibilidade extinta por prescrição ficam fora desse total. Somente definitivas entram na ordenação por condenações.</p>
    <p className="text-sm text-slate-700 dark:text-slate-300"><PrisonHistory summary={summary} /></p>
    {records.length === 0 ? <p className="surface p-5 text-slate-600 dark:text-slate-300">{summary.coverage.status === 'NOT_RESEARCHED' ? 'Sem pesquisa publicada para este perfil.' : 'Nenhum registro encontrado no escopo pesquisado.'}</p> : <ol aria-label="Casos judiciais" className="space-y-4">{[...cases.entries()].map(([key, events]) => {
      const first = events[0];
      const sources = new Map<string, {url: string; label: string}>(events.flatMap(record => [{url: record.sourceUrl, label: record.sourceLabel}, ...(record.sources ?? [])]).map(source => [source.url, source] as const));
      return <li key={key} className="surface min-w-0 break-words p-5 sm:p-6">
        <h3 className="text-lg font-semibold">Processo {first.caseNumber}</h3><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{first.court}</p>
        <ul className="mt-4 space-y-5">{events.map(record => <li key={record.id} className="border-t border-slate-200 pt-4 dark:border-slate-700">
      <div className="flex flex-wrap gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300"><span>{record.kind === 'CONVICTION' ? 'Condenação' : 'Prisão efetiva confirmada'}</span><span>· {judicialCategories[record.category]}</span><span>· {record.kind === 'CONVICTION' ? convictionStatuses[record.convictionStatus ?? 'UNKNOWN'] : custodyTypes[record.custodyType ?? 'UNKNOWN']}</span></div>
      <h4 className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-50">{record.title}</h4><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-slate-300">{record.description}</p>
      <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2"><div><dt className="font-semibold">{record.kind === 'CONVICTION' ? 'Data da decisão' : 'Data da prisão'}</dt><dd>{judicialDate(record.eventDate)}</dd></div>
      {record.kind === 'CONVICTION' && record.finalityDate && <div><dt className="font-semibold">Trânsito em julgado</dt><dd>{judicialDate(record.finalityDate)}</dd></div>}
      {record.kind === 'IMPRISONMENT' && <><div><dt className="font-semibold">Motivo / fundamento</dt><dd className="whitespace-pre-wrap">{record.grounds}</dd></div><div><dt className="font-semibold">Soltura</dt><dd>{record.releasedAt ? judicialDate(record.releasedAt) : 'Sem data informada na base'}</dd></div></>}
      <div className="sm:col-span-2"><dt className="font-semibold">Desfecho registrado</dt><dd className="whitespace-pre-wrap">{record.outcome || 'Não informado na fonte cadastrada'}</dd></div></dl>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Verificado em {judicialDate(record.checkedAt)}</p>
    </li>)}</ul><div className="mt-5 border-t border-slate-200 pt-3 dark:border-slate-700"><h4 className="text-sm font-semibold">Fontes oficiais deste processo</h4><ul className="mt-1 space-y-1">{[...sources.values()].map(source => <li key={source.url}><SourceLink url={source.url} label={source.label}/></li>)}</ul></div>
    </li>;
    })}</ol>}
  </section>;
}
