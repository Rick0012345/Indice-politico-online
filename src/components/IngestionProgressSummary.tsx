import React from 'react';
import {Activity, AlertCircle, Clock} from 'lucide-react';
import {formatPercent, getIngestionStatus, type IngestionExecution, type IngestionProgress} from '../lib/ingestionProgress';
import {cn} from '../lib/utils';

type Props = {
  progress: IngestionProgress;
  execution: IngestionExecution | null;
  lastUpdatedAt: Date | null;
  error: string | null;
};

const number = (value: number) => value.toLocaleString('pt-BR');

export const IngestionProgressSummary = ({progress, execution, lastUpdatedAt, error}: Props) => {
  const status = error
    ? {label: 'Status desatualizado', tone: 'warning', detail: lastUpdatedAt ? 'Não foi possível consultar a ingestão. Os números abaixo são da última leitura válida.' : 'Não foi possível consultar a ingestão. Aguardando uma leitura válida.'}
    : !lastUpdatedAt
      ? {label: 'Consultando ingestão', tone: 'neutral', detail: 'Aguardando o estado informado pelo servidor.'}
      : getIngestionStatus(progress, execution);
  const StatusIcon = status.tone === 'warning' ? AlertCircle : status.tone === 'active' ? Activity : Clock;
  const stats = [
    {label: 'Com registros', value: progress.withRecords},
    {label: 'Sem registros', value: progress.empty},
    {label: 'Em processamento', value: progress.running},
    {label: 'Aguardando', value: progress.pending},
    {label: 'Com falha', value: progress.failed},
    {label: 'Total de tarefas', value: progress.total},
  ];

  return (
    <section aria-label="Resumo da ingestão" className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950">
      <div className="flex items-start gap-2.5">
        <StatusIcon size={19} aria-hidden="true" className={cn('mt-0.5 shrink-0', status.tone === 'warning' ? 'text-amber-700 dark:text-amber-400' : status.tone === 'active' ? 'text-blue-700 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400')} />
        <div className="min-w-0">
          <p role="status" className="text-sm font-semibold text-slate-900 dark:text-slate-50">{status.label}</p>
          <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">{status.detail}</p>
        </div>
      </div>

      {lastUpdatedAt && (
        <div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">Tarefas acumuladas na base</h3>
          <p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-300">Todos os conjuntos e períodos já registrados. As datas e categorias de Nova coleta não filtram estes totais.</p>
          <div className="mb-2 mt-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 tabular-nums">
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-50">{number(progress.done)} de {number(progress.total)} tarefas concluídas</span>
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{formatPercent(progress.percent, progress.done, progress.total)}</span>
          </div>
          <div role="progressbar" aria-label="Tarefas concluídas no acumulado" aria-valuemin={0} aria-valuemax={progress.total || 1} aria-valuenow={progress.done} aria-valuetext={`${number(progress.done)} de ${number(progress.total)} tarefas concluídas`} className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
            <div className="h-full rounded-full bg-blue-600" style={{width: `${progress.percent}%`}} />
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 xl:grid-cols-6">
            {stats.map(stat => (
              <div key={stat.label} className="min-w-0">
                <dt className="text-xs leading-5 text-slate-600 dark:text-slate-300">{stat.label}</dt>
                <dd className="text-base font-semibold tabular-nums text-slate-900 dark:text-slate-50">{number(stat.value)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs leading-5 text-slate-600 dark:text-slate-300">Com registros + sem registros = concluídas. Uma consulta sem registros não é uma falha. Canceladas ficam fora deste total.</p>
        </div>
      )}

      <div className="mt-4 border-t border-slate-200 pt-3 text-xs leading-5 text-slate-600 dark:border-slate-800 dark:text-slate-300">
        <p>{error ? 'Tentando atualizar a cada 5 s' : 'Atualização automática a cada 5 s'}</p>
        <p>{lastUpdatedAt ? `Última leitura: ${lastUpdatedAt.toLocaleString('pt-BR')}` : 'Ainda sem leitura válida'}</p>
      </div>
    </section>
  );
};
