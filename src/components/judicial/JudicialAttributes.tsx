import React from 'react';
import {Link} from 'react-router-dom';
import type {JudicialSummary} from '../../lib/judicialTypes';
import {PrisonHistory, judicialCount, judicialDate} from './JudicialDetails';
import type {ProceedingsSummary} from '../../lib/judicialProceedingsTypes';

export const proceedingCount = (value: number | null | undefined) => value == null ? 'Não apurado' : value.toLocaleString('pt-BR');
export const proceedingCoverageText = (proceedings?: ProceedingsSummary) => {
  const coverage = proceedings?.coverage;
  const label = !coverage || coverage.status === 'NOT_RESEARCHED' ? 'Consulta processual não realizada' : coverage.status === 'COMPLETE' ? 'Consulta processual concluída no escopo' : coverage.status === 'PARTIAL' ? 'Consulta processual parcial' : 'Consulta processual com falha';
  return `${label}${coverage?.sourceLabel ? ` · ${coverage.sourceLabel}` : ''}${coverage?.checkedAt ? ` · ${judicialDate(coverage.checkedAt)}` : coverage?.attemptedAt ? ` · Tentativa em ${judicialDate(coverage.attemptedAt)}` : ''}`;
};
export function ProceedingsCoverage({proceedings, compact = false}: {proceedings?: ProceedingsSummary; compact?: boolean}) {
  return <div className="space-y-1 text-xs leading-5 text-slate-600 dark:text-slate-400"><p>{proceedingCoverageText(proceedings)}</p>{!compact && <><p>{proceedings?.coverage.scope || 'Consulta aos processos públicos do STF, em tramitação e fora de tramitação.'} A cobertura não é nacional nem inclui necessariamente processos sigilosos.</p><p>Processos contra contam casos únicos com papel de réu ou requerido. Investigações e execuções são separadas; autor, recorrente, paciente e testemunha não entram nessa contagem. Não apurado não significa zero.</p>{!!proceedings?.coverage.unresolved && <p>{proceedings.coverage.unresolved.toLocaleString('pt-BR')} vínculos sem confirmação de identidade não entram nas contagens.</p>}</>}</div>;
}

/** Total identificado separado dos recortes criminais de situação conhecida. */
export function judicialAttributeValues(summary?: JudicialSummary) {
  const unavailable = !summary ? 'Indisponível' : 'Não pesquisado';
  const researched = summary && summary.coverage.status !== 'NOT_RESEARCHED';
  return [
    {id: 'identifiedConvictions', label: 'Condenações identificadas', value: researched ? judicialCount(summary.identifiedConvictions ?? ((summary.finalConvictions ?? 0) + (summary.appealConvictions ?? 0))) : unavailable},
    {id: 'finalCriminalConvictions', label: 'Condenações criminais definitivas', value: researched && summary.finalConvictions !== null ? judicialCount(summary.counts.CRIMINAL.final) : unavailable},
    {id: 'appealCriminalConvictions', label: 'Condenações criminais em recurso', value: researched && summary.appealConvictions !== null ? judicialCount(summary.counts.CRIMINAL.appeal) : unavailable},
    {id: 'againstPerson', label: 'Processos contra identificados', value: proceedingCount(summary?.proceedings?.againstPerson), proceedings: true},
    {id: 'activeAgainstPerson', label: 'Processos ativos contra', value: proceedingCount(summary?.proceedings?.activeAgainstPerson), proceedings: true},
    {id: 'investigations', label: 'Investigações', value: proceedingCount(summary?.proceedings?.investigations), proceedings: true},
    {id: 'enforcements', label: 'Execuções', value: proceedingCount(summary?.proceedings?.enforcements), proceedings: true},
  ];
}

export function JudicialAttributes({summary, detailsHref}: {summary?: JudicialSummary; detailsHref: string}) {
  return <section aria-label="Atributos judiciais" className="mb-8 min-w-0">
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {judicialAttributeValues(summary).map(attribute => <div key={attribute.label} className="surface min-w-0 p-5">
        <dt className="text-sm font-medium text-slate-600 dark:text-slate-400">{attribute.label}</dt>
        <dd className="mt-2 break-words font-mono text-xl font-semibold text-slate-950 dark:text-slate-50">{attribute.value}</dd>
      </div>)}
      <div className="surface min-w-0 p-5"><dt className="text-sm font-medium text-slate-600 dark:text-slate-400">Histórico de prisão</dt><dd className="mt-2 text-base font-semibold text-slate-950 dark:text-slate-50">{summary ? <PrisonHistory summary={summary}/> : 'Indisponível'}</dd></div>
    </dl>
    <div className="mt-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700"><ProceedingsCoverage proceedings={summary?.proceedings}/></div>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 text-xs leading-5 text-slate-500 dark:text-slate-400">
      <p>{!summary ? 'Resumo judicial indisponível.' : summary.coverage.status === 'NOT_RESEARCHED' ? 'Pesquisa não realizada.' : summary.coverage.status === 'PARTIAL' ? 'Pesquisa parcial: números limitados ao escopo consultado.' : 'Pesquisa revisada no escopo informado.'} Inclui condenações cuja situação atual não foi identificada; anuladas, revertidas e com punibilidade extinta por prescrição ficam fora do total identificado. Prisão não equivale a condenação definitiva. Estes atributos não alteram a nota.</p>
      <Link to={detailsHref} className="inline-flex min-h-11 items-center font-medium text-brand-700 underline dark:text-brand-300">Ver histórico e fontes</Link>
    </div>
  </section>;
}
