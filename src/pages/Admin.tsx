import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Activity, CalendarDays, Database, Play, RefreshCw, ScrollText, Settings, XCircle} from 'lucide-react';
import {cn} from '../lib/utils';

type CheckpointSummary = {
  dataset: string;
  status: string;
  periodStart: string | null;
  periodEnd: string | null;
  total: number;
  itemsCount: number | null;
};

type PopulatedPeriod = {
  dataset: string;
  periodStart: string;
  periodEnd: string;
  total: number;
};

type LogStats = {
  totalLines: number;
  starts: number;
  okItems: number;
  okZero: number;
  retries: number;
  skips: number;
  httpRetries: number;
  httpStatus: Record<string, number>;
  lastActivityAt: string | null;
  lastHttpError: string | null;
};

const datasetOptions = [
  {id: 'deputados', label: 'Deputados'},
  {id: 'despesas', label: 'Despesas'},
  {id: 'votacoes', label: 'Votacoes'},
];

const statusClasses: Record<string, string> = {
  done: 'bg-emerald-50 text-emerald-700 ring-emerald-100 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-900',
  running: 'bg-blue-50 text-blue-700 ring-blue-100 dark:bg-blue-950 dark:text-blue-300 dark:ring-blue-900',
  pending: 'bg-amber-50 text-amber-700 ring-amber-100 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900',
  failed: 'bg-rose-50 text-rose-700 ring-rose-100 dark:bg-rose-950 dark:text-rose-300 dark:ring-rose-900',
  cancelled: 'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700',
};

const formatDate = (value: string | null) => {
  if (!value) return '-';
  return new Intl.DateTimeFormat('pt-BR', {timeZone: 'UTC'}).format(new Date(value));
};

const countWindows = (start: string, end: string, mode: 'month' | 'quarter' | 'year') => {
  const fromDate = new Date(`${start}T00:00:00.000Z`);
  const toDate = new Date(`${end}T00:00:00.000Z`);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return 0;

  const months =
    (toDate.getUTCFullYear() - fromDate.getUTCFullYear()) * 12 +
    (toDate.getUTCMonth() - fromDate.getUTCMonth()) +
    1;
  const step = mode === 'year' ? 12 : mode === 'quarter' ? 3 : 1;
  return Math.max(0, Math.ceil(months / step));
};

const countLegislatures = (start: string, end: string) => {
  const fromYear = new Date(`${start}T00:00:00.000Z`).getUTCFullYear();
  const toYear = new Date(`${end}T00:00:00.000Z`).getUTCFullYear();
  const ranges = [
    [2015, 2018],
    [2019, 2022],
    [2023, 2026],
  ];
  return ranges.filter(([rangeStart, rangeEnd]) => fromYear <= rangeEnd && toYear >= rangeStart).length;
};

const defaultLogStats = (): LogStats => ({
  totalLines: 0,
  starts: 0,
  okItems: 0,
  okZero: 0,
  retries: 0,
  skips: 0,
  httpRetries: 0,
  httpStatus: {},
  lastActivityAt: null,
  lastHttpError: null,
});

const formatNumber = (value: number) => value.toLocaleString('pt-BR');

export const Admin = () => {
  const [from, setFrom] = useState('2016-01-01');
  const [to, setTo] = useState('2020-12-31');
  const [windowSize, setWindowSize] = useState<'month' | 'quarter' | 'year'>('month');
  const [concurrency, setConcurrency] = useState(4);
  const [selectedDatasets, setSelectedDatasets] = useState<string[]>([
    'deputados',
    'despesas',
    'votacoes',
  ]);
  const [checkpoints, setCheckpoints] = useState<CheckpointSummary[]>([]);
  const [periods, setPeriods] = useState<PopulatedPeriod[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isPolling, setIsPolling] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [logFile, setLogFile] = useState<string | null>(null);
  const [logText, setLogText] = useState('');
  const [logStats, setLogStats] = useState<LogStats>(() => defaultLogStats());
  const refreshInFlightRef = useRef(false);

  const loadSummary = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/admin/ingestion/summary');
      if (!response.ok) throw new Error('Falha ao carregar resumo.');
      const data = await response.json();
      setCheckpoints(data.checkpoints ?? []);
      setPeriods(data.periods ?? []);
      setLastUpdatedAt(new Date());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Erro ao carregar dados.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadLogs = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/ingestion/logs');
      if (!response.ok) return;
      const data = await response.json();
      setLogFile(data.file ?? null);
      setLogText(data.log ?? '');
      setLogStats(data.stats ?? defaultLogStats());
    } catch {
      // Logs are auxiliary; keep the ingestion panel usable if this fails.
    }
  }, []);

  const refreshAdminData = useCallback(async () => {
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    try {
      await Promise.all([loadSummary(), loadLogs()]);
    } finally {
      refreshInFlightRef.current = false;
    }
  }, [loadLogs, loadSummary]);

  useEffect(() => {
    void refreshAdminData();
  }, [refreshAdminData]);

  const groupedCheckpoints = useMemo(() => {
    return datasetOptions.map((dataset) => {
      const rows = checkpoints.filter((row) => row.dataset === dataset.id);
      const total = rows.reduce((sum, row) => sum + Number(row.total ?? 0), 0);
      const done = rows
        .filter((row) => row.status === 'done')
        .reduce((sum, row) => sum + Number(row.total ?? 0), 0);
      const failed = rows
        .filter((row) => row.status === 'failed')
        .reduce((sum, row) => sum + Number(row.total ?? 0), 0);
      return {...dataset, total, done, failed, progress: total > 0 ? Math.round((done / total) * 100) : 0};
    });
  }, [checkpoints]);

  const selectedProgress = useMemo(() => {
    const rows = checkpoints.filter((row) => selectedDatasets.includes(row.dataset));
    const total = rows.reduce((sum, row) => sum + Number(row.total ?? 0), 0);
    const done = rows
      .filter((row) => row.status === 'done')
      .reduce((sum, row) => sum + Number(row.total ?? 0), 0);
    const running = rows
      .filter((row) => row.status === 'running')
      .reduce((sum, row) => sum + Number(row.total ?? 0), 0);
    const failed = rows
      .filter((row) => row.status === 'failed')
      .reduce((sum, row) => sum + Number(row.total ?? 0), 0);
    const pending = Math.max(0, total - done - running - failed);

    return {
      total,
      done,
      running,
      failed,
      pending,
      percent: total > 0 ? Math.round((done / total) * 100) : 0,
      activePercent: total > 0 ? Math.round(((done + running) / total) * 100) : 0,
    };
  }, [checkpoints, selectedDatasets]);

  const estimatedQueueTotal = useMemo(() => {
    return selectedDatasets.reduce((sum, dataset) => {
      if (dataset === 'deputados') return sum + countLegislatures(from, to);
      if (dataset === 'votacoes') return sum + countWindows(from, to, windowSize);
      return sum;
    }, 0);
  }, [from, selectedDatasets, to, windowSize]);

  const queuePercent =
    estimatedQueueTotal > 0
      ? Math.min(100, Math.round((selectedProgress.total / estimatedQueueTotal) * 100))
      : selectedProgress.total > 0
        ? 100
        : 0;

  const httpStatusEntries = useMemo(
    () =>
      Object.entries(logStats.httpStatus)
        .sort(([, a], [, b]) => Number(b) - Number(a))
        .slice(0, 4),
    [logStats.httpStatus],
  );

  useEffect(() => {
    const hasActiveWork = checkpoints.some((row) => row.status === 'running' || row.status === 'pending');
    if (!hasActiveWork && !isPolling) return;

    const timer = window.setInterval(() => {
      void refreshAdminData();
    }, 1000);

    return () => window.clearInterval(timer);
  }, [checkpoints, isPolling, refreshAdminData]);

  useEffect(() => {
    const hasActiveWork = checkpoints.some((row) => row.status === 'running' || row.status === 'pending');
    if (!hasActiveWork && isPolling && checkpoints.length > 0) {
      setIsPolling(false);
    }
  }, [checkpoints, isPolling]);

  const toggleDataset = (dataset: string) => {
    setSelectedDatasets((current) =>
      current.includes(dataset) ? current.filter((item) => item !== dataset) : [...current, dataset],
    );
  };

  const runIngestion = async () => {
    setIsRunning(true);
    setMessage(null);
    try {
      const response = await fetch('/api/admin/ingestion/run', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({from, to, datasets: selectedDatasets, window: windowSize, concurrency}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Erro ao iniciar ingestao.');
      setMessage(data.message ?? 'Ingestao iniciada.');
      setIsPolling(true);
      await refreshAdminData();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Erro ao iniciar ingestao.');
    } finally {
      setIsRunning(false);
    }
  };

  const cancelCheckpointGroup = async (dataset: string, status: string) => {
    setMessage(null);
    try {
      const response = await fetch('/api/admin/ingestion/cancel', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({dataset, status}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Erro ao cancelar tarefas.');
      setMessage(`${data.cancelled ?? 0} tarefa(s) cancelada(s).`);
      await loadSummary();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Erro ao cancelar tarefas.');
    }
  };

  return (
    <div className="min-h-screen overflow-x-hidden bg-slate-50 py-8 dark:bg-slate-950">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-bold uppercase text-blue-600 dark:text-blue-400">
              <Settings size={16} />
              Administracao
            </div>
            <h1 className="mt-2 text-3xl font-black text-slate-900 dark:text-slate-50">
              Ingestao de dados
            </h1>
          </div>
          <button
            type="button"
            onClick={refreshAdminData}
            disabled={isLoading}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <RefreshCw size={18} className={cn(isLoading && 'animate-spin')} />
            Atualizar
          </button>
        </div>

        <section className="grid min-w-0 gap-6 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)] xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
            <div className="mb-5 flex items-center gap-2">
              <CalendarDays size={20} className="text-blue-600 dark:text-blue-400" />
              <h2 className="text-lg font-black text-slate-900 dark:text-slate-50">Nova coleta</h2>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm font-bold text-slate-700 dark:text-slate-200">
                  Inicio
                  <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50" />
                </label>
                <label className="text-sm font-bold text-slate-700 dark:text-slate-200">
                  Fim
                  <input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50" />
                </label>
              </div>

              <div>
                <span className="text-sm font-bold text-slate-700 dark:text-slate-200">Dados</span>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {datasetOptions.map((dataset) => (
                    <button
                      key={dataset.id}
                      type="button"
                      onClick={() => toggleDataset(dataset.id)}
                      className={cn(
                        'rounded-lg px-3 py-2 text-xs font-black ring-1 ring-inset transition',
                        selectedDatasets.includes(dataset.id)
                          ? 'bg-blue-600 text-white ring-blue-600'
                          : 'bg-slate-50 text-slate-600 ring-slate-200 hover:bg-slate-100 dark:bg-slate-950 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800',
                      )}
                    >
                      {dataset.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm font-bold text-slate-700 dark:text-slate-200">
                  Janela
                  <select value={windowSize} onChange={(event) => setWindowSize(event.target.value as typeof windowSize)} className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50">
                    <option value="month">Mensal</option>
                    <option value="quarter">Trimestral</option>
                    <option value="year">Anual</option>
                  </select>
                </label>
                <label className="text-sm font-bold text-slate-700 dark:text-slate-200">
                  Paralelo
                  <input type="number" min={1} max={10} value={concurrency} onChange={(event) => setConcurrency(Number(event.target.value))} className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50" />
                </label>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-xs font-black uppercase text-slate-500 dark:text-slate-400">
                    Criacao da fila
                  </span>
                  <span className="text-sm font-black text-slate-900 dark:text-slate-50">
                    {queuePercent}%
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <div
                    className="h-full rounded-full bg-cyan-500 transition-all"
                    style={{width: `${queuePercent}%`}}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400">
                  <span>{selectedProgress.total} checkpoints visiveis</span>
                  <span>{estimatedQueueTotal > 0 ? `${estimatedQueueTotal} estimados` : 'estimativa aberta'}</span>
                </div>

                <div className="mb-2 mt-4 flex items-center justify-between gap-3">
                  <span className="text-xs font-black uppercase text-slate-500 dark:text-slate-400">
                    Processamento
                  </span>
                  <span className="text-sm font-black text-slate-900 dark:text-slate-50">
                    {selectedProgress.percent}%
                  </span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <div
                    className="h-full rounded-full bg-blue-600 transition-all"
                    style={{width: `${selectedProgress.percent}%`}}
                  >
                    <div className="h-full w-full bg-blue-500" />
                  </div>
                  {selectedProgress.running > 0 && selectedProgress.percent < 100 && (
                    <div
                      className="relative -mt-3 h-3 animate-pulse rounded-full bg-blue-400/70 transition-all"
                      style={{
                        marginLeft: `${selectedProgress.percent}%`,
                        width: `${Math.max(3, selectedProgress.activePercent - selectedProgress.percent)}%`,
                      }}
                    />
                  )}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-bold text-slate-500 dark:text-slate-400">
                  <span>{selectedProgress.done} concluidas</span>
                  <span className="text-right">{selectedProgress.total} tarefas</span>
                  <span>{selectedProgress.running} rodando</span>
                  <span className="text-right">{selectedProgress.pending} na fila</span>
                  <span>{selectedProgress.failed} falhas</span>
                  <span className="text-right">
                    {selectedProgress.running > 0 ? 'Agente trabalhando' : 'Sem tarefa ativa'}
                  </span>
                </div>
                {selectedProgress.total === 0 && (
                  <div className="mt-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
                    Aguardando o agente criar os checkpoints desta coleta.
                  </div>
                )}
                <div className="mt-2 flex items-center justify-between gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
                  <span>{isPolling ? 'Monitorando agente' : 'Monitoramento parado'}</span>
                  <span>
                    {lastUpdatedAt
                      ? `Atualizado ${lastUpdatedAt.toLocaleTimeString('pt-BR')}`
                      : 'Ainda sem leitura'}
                  </span>
                </div>
              </div>

              <button type="button" onClick={runIngestion} disabled={isRunning || selectedDatasets.length === 0} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-sm font-black text-white transition hover:bg-blue-700 disabled:opacity-60">
                <Play size={18} />
                {isRunning ? 'Iniciando...' : 'Iniciar coleta'}
              </button>

              {message && <div className="rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">{message}</div>}
            </div>
          </div>

          <div className="min-w-0 space-y-6">
            <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {groupedCheckpoints.map((dataset) => (
                <div key={dataset.id} className="min-w-0 rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-black text-slate-900 dark:text-slate-50">{dataset.label}</div>
                      <div className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">{dataset.done} de {dataset.total} tarefas</div>
                    </div>
                    <Database size={20} className="text-slate-400" />
                  </div>
                  <div className="mt-4 h-2 rounded-full bg-slate-100 dark:bg-slate-800">
                    <div className="h-2 rounded-full bg-blue-600" style={{width: `${dataset.progress}%`}} />
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400">
                    <span>{dataset.progress}% concluido</span>
                    <span>{dataset.failed} falhas</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="min-w-0 rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
              <div className="border-b border-slate-200 p-5 dark:border-slate-700">
                <h2 className="text-lg font-black text-slate-900 dark:text-slate-50">Checkpoints</h2>
              </div>
              <div className="min-w-0 overflow-x-auto">
                <table className="min-w-[720px] w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs font-black uppercase text-slate-500 dark:bg-slate-950 dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-3">Dataset</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Periodo</th>
                      <th className="px-4 py-3 text-right">Tarefas</th>
                      <th className="px-4 py-3 text-right">Itens</th>
                      <th className="px-4 py-3 text-right">Acao</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {checkpoints.map((row) => (
                      <tr key={`${row.dataset}-${row.status}`} className="text-slate-700 dark:text-slate-200">
                        <td className="px-4 py-3 font-bold">{row.dataset}</td>
                        <td className="px-4 py-3">
                          <span className={cn('inline-flex rounded-full px-2.5 py-1 text-xs font-black ring-1 ring-inset', statusClasses[row.status] ?? 'bg-slate-100 text-slate-600 ring-slate-200')}>
                            {row.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">{formatDate(row.periodStart)} - {formatDate(row.periodEnd)}</td>
                        <td className="px-4 py-3 text-right font-bold">{row.total}</td>
                        <td className="px-4 py-3 text-right font-bold">{row.itemsCount ?? 0}</td>
                        <td className="px-4 py-3 text-right">
                          {['pending', 'running', 'failed'].includes(row.status) ? (
                            <button
                              type="button"
                              onClick={() => cancelCheckpointGroup(row.dataset, row.status)}
                              className="inline-flex items-center justify-center rounded-lg p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950 dark:hover:text-rose-300"
                              title="Cancelar tarefas deste grupo"
                              aria-label={`Cancelar ${row.dataset} ${row.status}`}
                            >
                              <XCircle size={18} />
                            </button>
                          ) : (
                            <span className="text-xs text-slate-400">-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {checkpoints.length === 0 && (
                      <tr>
                        <td className="px-4 py-6 text-center text-slate-500 dark:text-slate-400" colSpan={6}>Nenhum checkpoint registrado.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="min-w-0 rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
              <div className="flex items-center justify-between gap-3 border-b border-slate-200 p-5 dark:border-slate-700">
                <div className="flex items-center gap-2">
                  <ScrollText size={20} className="text-blue-600 dark:text-blue-400" />
                  <h2 className="text-lg font-black text-slate-900 dark:text-slate-50">Logs da ingestao</h2>
                </div>
                <button
                  type="button"
                  onClick={loadLogs}
                  className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                  aria-label="Atualizar logs"
                  title="Atualizar logs"
                >
                  <RefreshCw size={18} />
                </button>
              </div>
              <div className="p-5">
                <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-950">
                    <div className="flex items-center gap-2 text-xs font-black uppercase text-slate-500 dark:text-slate-400">
                      <Activity size={14} />
                      Processadas
                    </div>
                    <div className="mt-2 text-xl font-black tabular-nums text-slate-900 dark:text-slate-50">
                      {formatNumber(logStats.okItems + logStats.okZero)}
                    </div>
                    <div className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">
                      {formatNumber(logStats.starts)} iniciadas
                    </div>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-950">
                    <div className="text-xs font-black uppercase text-slate-500 dark:text-slate-400">
                      Com dados
                    </div>
                    <div className="mt-2 text-xl font-black tabular-nums text-emerald-700 dark:text-emerald-300">
                      {formatNumber(logStats.okItems)}
                    </div>
                    <div className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">
                      gravaram 1+ item
                    </div>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-950">
                    <div className="text-xs font-black uppercase text-slate-500 dark:text-slate-400">
                      Sem itens
                    </div>
                    <div className="mt-2 text-xl font-black tabular-nums text-amber-700 dark:text-amber-300">
                      {formatNumber(logStats.okZero)}
                    </div>
                    <div className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">
                      API respondeu zero
                    </div>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-950">
                    <div className="text-xs font-black uppercase text-slate-500 dark:text-slate-400">
                      Retentativas
                    </div>
                    <div className="mt-2 text-xl font-black tabular-nums text-rose-700 dark:text-rose-300">
                      {formatNumber(logStats.httpRetries)}
                    </div>
                    <div className="mt-1 truncate text-xs font-bold text-slate-500 dark:text-slate-400">
                      {httpStatusEntries.length > 0
                        ? httpStatusEntries.map(([status, total]) => `${status}: ${formatNumber(total)}`).join(' / ')
                        : 'sem erro HTTP'}
                    </div>
                  </div>
                </div>

                {(logStats.retries > 0 || logStats.skips > 0 || logStats.lastActivityAt) && (
                  <div className="mb-4 grid gap-2 text-xs font-bold text-slate-500 dark:text-slate-400 sm:grid-cols-3">
                    <div className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
                      Falhas reprocessaveis: {formatNumber(logStats.retries)}
                    </div>
                    <div className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
                      Recursos ignorados: {formatNumber(logStats.skips)}
                    </div>
                    <div className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
                      Ultima atividade:{' '}
                      {logStats.lastActivityAt
                        ? new Date(logStats.lastActivityAt).toLocaleTimeString('pt-BR')
                        : 'sem timestamp'}
                    </div>
                  </div>
                )}

                {logStats.lastHttpError && (
                  <div className="mb-4 truncate rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                    Ultimo retry HTTP: {logStats.lastHttpError}
                  </div>
                )}

                <div className="mb-3 flex items-center justify-between gap-3 text-xs font-bold text-slate-500 dark:text-slate-400">
                  <span>{logFile ?? 'Nenhum arquivo de log'}</span>
                  <span>{logText ? `${logText.split('\n').length} linhas` : 'sem saida'}</span>
                </div>
                <pre className="max-h-80 max-w-full overflow-auto rounded-lg bg-slate-950 p-4 text-xs leading-relaxed text-slate-100">
                  {logText || 'Nenhum log de ingestao disponivel ainda.'}
                </pre>
              </div>
            </div>

            <div className="min-w-0 rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
              <div className="border-b border-slate-200 p-5 dark:border-slate-700">
                <h2 className="text-lg font-black text-slate-900 dark:text-slate-50">Meses populados</h2>
              </div>
              <div className="grid min-w-0 gap-2 p-5 sm:grid-cols-2 xl:grid-cols-3">
                {periods.slice(0, 36).map((period) => (
                  <div key={`${period.dataset}-${period.periodStart}`} className="rounded-lg bg-slate-50 p-3 dark:bg-slate-950">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-black uppercase text-slate-500 dark:text-slate-400">{period.dataset}</span>
                      <span className="text-xs font-bold text-slate-500 dark:text-slate-400">{period.total.toLocaleString('pt-BR')}</span>
                    </div>
                    <div className="mt-2 text-sm font-black text-slate-900 dark:text-slate-50">{formatDate(period.periodStart)}</div>
                  </div>
                ))}
                {periods.length === 0 && <div className="text-sm text-slate-500 dark:text-slate-400">Nenhum periodo encontrado no banco.</div>}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
