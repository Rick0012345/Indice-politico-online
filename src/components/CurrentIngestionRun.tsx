import React from 'react';
import {Layers3} from 'lucide-react';
import type {IngestionRunProgress, RunTaskProgress} from '../lib/ingestionRunTypes';
import {calculatePercent} from '../lib/ingestionProgress';

const number = (value: number) => value.toLocaleString('pt-BR');
const names: Record<string, string> = {
  deputados:'Deputados', despesas:'Despesas', votacoes:'Votações', legislaturas:'Legislaturas',
  partidos:'Partidos', blocos:'Blocos', orgaos:'Órgãos', eventos:'Eventos', frentes:'Frentes',
  proposicoes:'Proposições', referencias:'Referências',
};
const datasetName = (dataset: string) => names[dataset] ?? dataset;
const date = (value: string) => value.slice(0, 10).split('-').reverse().join('/');
const states = {running:'Em execução', completed:'Concluída', failed:'Com falha', cancelled:'Cancelada', interrupted:'Interrompida'};
const stages = {waiting:'Aguardando etapa', seeding:'Preparando tarefas', running:'Em processamento', completed:'Etapa encerrada'};

const ProgressBar = ({progress, label, estimationComplete}: {progress: RunTaskProgress; label: string; estimationComplete: boolean}) => {
  if (!progress.estimatedTotal) return <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{estimationComplete ? 'Nenhuma tarefa prevista neste escopo' : 'Estimativa em descoberta'}</p>;
  const percent = calculatePercent(progress.completed, progress.estimatedTotal);
  const visiblePercent = `${(Math.floor(percent * 100) / 100).toLocaleString('pt-BR', {maximumFractionDigits:2})}%`;
  return (
    <div className="mt-3">
      <div className="mb-2 flex flex-wrap justify-between gap-x-3 gap-y-1 text-sm tabular-nums">
        <span>{number(progress.completed)} de {number(progress.estimatedTotal)} tarefas concluídas</span>
        <span className="font-semibold">{visiblePercent}</span>
      </div>
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={progress.estimatedTotal} aria-valuenow={progress.completed} aria-valuetext={`${visiblePercent}: ${number(progress.completed)} de ${number(progress.estimatedTotal)} tarefas concluídas; ${number(progress.remaining)} restantes`} className="h-2 overflow-hidden rounded-full bg-blue-100 dark:bg-slate-800">
        <div className="h-full rounded-full bg-blue-600 dark:bg-blue-400" style={{width:`${percent}%`}} />
      </div>
    </div>
  );
};

export const CurrentIngestionRun = ({currentRun, stale = false}: {currentRun: IngestionRunProgress | null; stale?: boolean}) => {
  if (!currentRun) return (
    <section aria-label="Execução atual" className="rounded-lg border border-blue-200 bg-white p-4 dark:border-blue-900 dark:bg-slate-900">
      <h3 className="text-base font-semibold text-slate-900 dark:text-slate-50">Execução atual</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Ainda não há planejamento registrado para a execução atual. O acumulado da base não informa a porcentagem desta coleta.</p>
    </section>
  );
  const run = currentRun;
  const statusLabel = run.status === 'completed' && run.remaining > 0 ? 'Finalizada com pendências' : states[run.status];
  return (
    <section aria-label="Execução atual" className="min-w-0 rounded-lg border border-blue-200 bg-white p-4 text-slate-900 dark:border-blue-900 dark:bg-slate-900 dark:text-slate-50">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="flex items-center gap-2 text-base font-semibold"><Layers3 size={18} aria-hidden="true" className="shrink-0 text-blue-600 dark:text-blue-400" />{stale ? 'Última leitura' : run.status === 'running' ? 'Execução atual' : 'Última execução'}</h3>
        <span className="rounded border border-slate-200 px-2 py-1 text-xs font-semibold dark:border-slate-700">{stale ? 'Estado desatualizado' : statusLabel}</span>
      </div>
      <p className="mt-3 break-words text-sm font-medium">Coletas selecionadas: {run.datasets.map(datasetName).join(', ')}</p>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Período: <span>{date(run.from)} a {date(run.to)}</span></p>
      {run.status === 'running' && !stale && <p className="mt-1 break-words text-sm text-slate-600 dark:text-slate-300">{run.currentDataset ? `Etapa atual: ${datasetName(run.currentDataset)}` : 'Preparando a execução'}</p>}
      {stale && <p className="mt-2 text-xs leading-5 text-amber-800 dark:text-amber-200">Os números são da última leitura disponível. A atividade desta execução não está confirmada nesta consulta.</p>}
      {run.status === 'interrupted' && <p className="mt-2 text-xs leading-5 text-amber-800 dark:text-amber-200">O término da execução não foi confirmado. Estes são valores observados, que podem mudar; não representam um resultado final congelado.</p>}
      {!run.estimationComplete && <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"><p className="text-sm font-semibold">Estimativa provisória</p><p className="mt-1 text-xs leading-5">O total pode mudar conforme os deputados e as tarefas dos próximos conjuntos forem identificados.</p></div>}
      <dl className="mt-4 grid grid-cols-1 gap-3 min-[360px]:grid-cols-3">
        {[{label:'Tarefas estimadas', value:run.estimatedTotal}, {label:'Concluídas', value:run.completed}, {label:'Restantes', value:run.remaining}].map(stat => <div key={stat.label} className="min-w-0"><dt className="text-xs leading-5 text-slate-600 dark:text-slate-300">{stat.label}</dt><dd className="break-all text-2xl font-semibold tabular-nums">{number(stat.value)}</dd></div>)}
      </dl>
      <ProgressBar progress={run} label="Progresso da ingestão atual" estimationComplete={run.estimationComplete} />
      <p className="mt-3 text-xs leading-5 text-slate-600 dark:text-slate-300">{number(run.reused)} das {number(run.completed)} concluídas já estavam prontas na base e foram reaproveitadas.</p>
      <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">Restantes = estimadas − concluídas. As tarefas dos próximos conjuntos entram no total antes de serem criadas.</p>
      {(run.failed > 0 || run.cancelled > 0) && <p className="mt-2 text-sm font-medium text-amber-800 dark:text-amber-200">{number(run.failed)} com falha · {number(run.cancelled)} canceladas</p>}
      <div className="mt-4 space-y-3">
        {run.byDataset.map(item => <section key={item.dataset} aria-label={`Conjunto ${datasetName(item.dataset)}`} className="min-w-0 rounded border border-slate-200 p-3 dark:border-slate-700">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><h4 className="break-words text-sm font-semibold">{datasetName(item.dataset)}</h4><span className="text-xs text-slate-600 dark:text-slate-300">{stale && (item.stage === 'running' || item.stage === 'seeding') ? 'Etapa sem confirmação atual' : run.status !== 'running' && (item.stage === 'running' || item.stage === 'seeding') ? 'Etapa não concluída' : stages[item.stage]}</span></div>
          <ProgressBar progress={item} label={`Progresso de ${datasetName(item.dataset)}`} estimationComplete={run.estimationComplete} />
          <p className="mt-2 break-words text-xs leading-5 tabular-nums text-slate-600 dark:text-slate-300">{number(item.estimatedTotal)} estimadas · {number(item.completed)} concluídas · {number(item.remaining)} restantes</p>
          <p className="mt-1 break-words text-xs leading-5 tabular-nums text-slate-600 dark:text-slate-300">{number(item.reused)} reaproveitadas · {number(item.notCreated)} ainda não criadas</p>
          {(item.failed > 0 || item.cancelled > 0) && <p className="mt-1 text-xs leading-5 text-amber-800 dark:text-amber-200">{number(item.failed)} com falha · {number(item.cancelled)} canceladas</p>}
        </section>)}
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-500 dark:text-slate-400">O progresso mede tarefas de coleta, sem estimar registros ou tempo restante.</p>
    </section>
  );
};
