import React from 'react';
import type {ExpenseCoverage} from '../lib/expenseAnalyticsTypes';
import {cn} from '../lib/utils';

const date = (value:string) => value.slice(0,7).split('-').reverse().join('/');

export const ExpenseCoverageNotice = ({coverage,loading=false,error=false}:{coverage?:ExpenseCoverage|null;loading?:boolean;error?:boolean}) => {
  const title = !coverage ? loading ? 'Consultando cobertura…' : 'Cobertura indisponível'
    : coverage.status==='complete' ? 'Consultas do período concluídas'
    : coverage.status==='not_imported' ? 'Dados de despesas ainda não importados para este período'
    : 'Dados parciais no período';
  return <section aria-label="Cobertura dos gastos" className={cn('rounded-xl border p-4 text-sm', coverage?.status==='partial'
    ? 'border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100'
    : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300')}>
    <p className="font-semibold">{title}</p>
    {error && <p role="alert" className="mt-1 text-rose-700 dark:text-rose-300">Não foi possível atualizar a cobertura da coleta.</p>}
    {coverage && <>
      <p className="mt-1">{coverage.completed.toLocaleString('pt-BR')} de {(coverage.expectedPeriods ?? coverage.periods).toLocaleString('pt-BR')} consultas mensais por parlamentar concluídas.</p>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs leading-5">
        {coverage.empty>0 && <span>{coverage.empty.toLocaleString('pt-BR')} consultas concluídas sem registros</span>}
        {coverage.failed>0 && <span>{coverage.failed.toLocaleString('pt-BR')} consultas com falha</span>}
        {coverage.pending>0 && <span>{coverage.pending.toLocaleString('pt-BR')} consultas pendentes</span>}
        {coverage.running>0 && <span>{coverage.running.toLocaleString('pt-BR')} consultas em andamento</span>}
        {coverage.cancelled>0 && <span>{coverage.cancelled.toLocaleString('pt-BR')} consultas canceladas</span>}
        {coverage.missing>0 && <span>{coverage.missing.toLocaleString('pt-BR')} consultas ainda não programadas</span>}
        {coverage.withoutCheckpoints>0 && <span>{coverage.withoutCheckpoints.toLocaleString('pt-BR')} parlamentares sem consulta neste período</span>}
      </div>
      {coverage.from && coverage.to && <p className="mt-2 text-xs">Competências consultadas: {date(coverage.from)} a {date(coverage.to)}.</p>}
      {coverage.lastUpdatedAt && <p className="mt-1 text-xs">Última atualização da coleta: {new Date(coverage.lastUpdatedAt).toLocaleString('pt-BR')}.</p>}
      <p className="mt-2 text-xs leading-5">Os valores representam os registros já importados. Uma consulta concluída sem registros é diferente de um período sem consulta.</p>
    </>}
  </section>;
};
