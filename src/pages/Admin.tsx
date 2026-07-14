import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Activity,
  AlertCircle,
  Bot,
  CalendarDays,
  CheckCircle2,
  Clock,
  Database,
  Layers3,
  Loader2,
  Play,
  RefreshCw,
  ScrollText,
  Settings,
  Trash2,
  XCircle,
} from 'lucide-react';
import {getGroqModelValidationError} from '../lib/aiSettings';
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
  periodStart: string | null;
  periodEnd: string | null;
  total: number;
};

type LogStats = {
  totalLines: number;
  starts: number;
  okItems: number;
  okZero: number;
  progressUpdates: number;
  progressItems: number;
  retries: number;
  skips: number;
  httpRetries: number;
  httpStatus: Record<string, number>;
  lastActivityAt: string | null;
  lastHttpError: string | null;
};

type LogEvent = {
  stage: string;
  label: string;
  timestamp: string;
  source?: 'ingestion' | 'ai';
  dataset?: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  resourceId?: string | number | null;
  url?: string;
  path?: string;
  progress?: number;
  total?: number;
  status?: number;
  attempt?: number;
  delay?: number;
  error?: string;
  model?: string;
  reason?: string;
};

type AiSettings = {
  enabled: boolean;
  groqModel: string;
  hasGroqApiKey: boolean;
};

const datasetOptions = [
  {id: 'deputados', label: 'Deputados'},
  {id: 'despesas', label: 'Despesas'},
  {id: 'votacoes', label: 'Votações'},
  {id: 'legislaturas', label: 'Legislaturas'},
  {id: 'partidos', label: 'Partidos'},
  {id: 'blocos', label: 'Blocos'},
  {id: 'orgaos', label: 'Orgaos'},
  {id: 'eventos', label: 'Eventos'},
  {id: 'frentes', label: 'Frentes'},
  {id: 'proposicoes', label: 'Proposicoes'},
  {id: 'referencias', label: 'Referencias'},
];

const cleanupOptions = [...datasetOptions, {id: 'todos', label: 'Tudo'}];

const adminSections = [
  {id: 'coleta', label: 'Coleta', icon: CalendarDays},
  {id: 'progresso', label: 'Progresso', icon: Database},
  {id: 'logs', label: 'Logs', icon: ScrollText},
  {id: 'cobertura', label: 'Cobertura', icon: Layers3},
  {id: 'ia', label: 'IA', icon: Bot},
] as const;

type AdminSection = (typeof adminSections)[number]['id'];

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

const formatPeriodRange = (start: string | null, end: string | null) => {
  if (!start && !end) return 'Sem periodo associado';
  if (start === end || !end) return formatDate(start);
  return `${formatDate(start)} a ${formatDate(end)}`;
};

const calculatePercent = (completed: number, total: number) =>
  total > 0 ? Math.min(100, (completed / total) * 100) : 0;

const formatPercent = (percent: number, completed: number, total: number) => {
  if (total <= 0) return '0%';
  if (completed >= total) return '100%';
  const visiblePercent = Math.min(99.99, percent);
  const fractionDigits = visiblePercent >= 99 ? 2 : visiblePercent >= 10 ? 1 : 0;
  return `${visiblePercent.toLocaleString('pt-BR', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })}%`;
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
  progressUpdates: 0,
  progressItems: 0,
  retries: 0,
  skips: 0,
  httpRetries: 0,
  httpStatus: {},
  lastActivityAt: null,
  lastHttpError: null,
});

const formatNumber = (value: number) => value.toLocaleString('pt-BR');

const formatEventTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--:--';
  return date.toLocaleTimeString('pt-BR');
};

const formatEventDetail = (event: LogEvent) => {
  const parts: string[] = [];
  if (event.dataset) parts.push(event.dataset);
  if (event.periodStart || event.periodEnd) parts.push(formatPeriodRange(event.periodStart ?? null, event.periodEnd ?? null));
  if (event.resourceId) parts.push(`ID ${event.resourceId}`);
  if (event.progress != null && event.total != null) parts.push(`${event.progress}/${event.total}`);
  if (event.status) parts.push(`HTTP ${event.status}`);
  if (event.delay != null) parts.push(`espera ${Math.max(1, Math.ceil(event.delay / 1000))}s`);
  if (event.attempt != null) parts.push(`tentativa ${event.attempt}`);
  if (event.model) parts.push(event.model);
  return parts.join(' · ');
};

const getEventIcon = (stage: string) => {
  if (stage.includes('failed') || stage.includes('fallback') || stage.includes('retry')) return AlertCircle;
  if (stage.includes('done')) return CheckCircle2;
  if (stage.includes('ai')) return Bot;
  if (stage.includes('start') || stage.includes('fetch') || stage.includes('write')) return Loader2;
  return Clock;
};

const getEventClass = (stage: string) => {
  if (stage.includes('failed') || stage.includes('fallback')) {
    return 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100';
  }
  if (stage.includes('retry')) {
    return 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-100';
  }
  if (stage.includes('done')) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100';
  }
  if (stage.includes('ai')) {
    return 'border-violet-200 bg-violet-50 text-violet-900 dark:border-violet-900 dark:bg-violet-950 dark:text-violet-100';
  }
  return 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-100';
};

const LogEventCard = ({event, compact = false}: {event: LogEvent; compact?: boolean; key?: React.Key}) => {
  const Icon = getEventIcon(event.stage);
  const detail = formatEventDetail(event);
  return (
    <div className={cn('rounded-lg border', compact ? 'px-3 py-2' : 'p-3', getEventClass(event.stage))}>
      <div className={cn('flex gap-3', compact ? 'items-center' : 'items-start')}>
        <Icon
          size={compact ? 16 : 18}
          className={cn(
            'shrink-0',
            !compact && 'mt-0.5',
            !compact && (event.stage.includes('fetch') || event.stage.includes('write')) ? 'animate-spin' : '',
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className={cn('truncate font-black', compact ? 'text-xs' : 'text-sm')}>{event.label}</span>
            <span className="shrink-0 rounded-full bg-white/60 px-2 py-0.5 text-[10px] font-black uppercase dark:bg-slate-950/40">
              {event.source === 'ai' ? 'IA' : 'Ingestao'}
            </span>
          </div>
          {detail && <div className="mt-1 truncate text-xs font-bold opacity-80">{detail}</div>}
          {!compact && (event.url || event.path || event.error) && (
            <div className="mt-2 truncate text-xs font-semibold opacity-75">
              {event.error || event.url || event.path}
            </div>
          )}
        </div>
        <div className="shrink-0 text-xs font-black opacity-70">{formatEventTime(event.timestamp)}</div>
      </div>
    </div>
  );
};

const summarizeCheckpointProgress = (rows: CheckpointSummary[]) => {
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
  const pending = rows
    .filter((row) => row.status === 'pending')
    .reduce((sum, row) => sum + Number(row.total ?? 0), 0);

  return {
    total,
    done,
    running,
    failed,
    pending,
    percent: calculatePercent(done, total),
    activePercent: calculatePercent(done + running, total),
  };
};

export const Admin = () => {
  const [adminToken, setAdminToken] = useState(() => window.sessionStorage.getItem('admin_api_token') ?? '');
  const [adminTokenInput, setAdminTokenInput] = useState('');
  const [activeSection, setActiveSection] = useState<AdminSection>('coleta');
  const [from, setFrom] = useState('2016-01-01');
  const [to, setTo] = useState('2020-12-31');
  const [selectedDatasets, setSelectedDatasets] = useState<string[]>([
    'deputados',
    'despesas',
    'votacoes',
    'legislaturas',
    'partidos',
    'orgaos',
    'referencias',
  ]);
  const [checkpoints, setCheckpoints] = useState<CheckpointSummary[]>([]);
  const [periods, setPeriods] = useState<PopulatedPeriod[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [clearingDataset, setClearingDataset] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [logFile, setLogFile] = useState<string | null>(null);
  const [logText, setLogText] = useState('');
  const [logStats, setLogStats] = useState<LogStats>(() => defaultLogStats());
  const [logEvents, setLogEvents] = useState<LogEvent[]>([]);
  const [currentStatus, setCurrentStatus] = useState<LogEvent[]>([]);
  const [logTimeline, setLogTimeline] = useState<LogEvent[]>([]);
  const [aiSettings, setAiSettings] = useState<AiSettings>({
    enabled: true,
    groqModel: 'llama-3.3-70b-versatile',
    hasGroqApiKey: false,
  });
  const [isSavingAi, setIsSavingAi] = useState(false);
  const aiModelError = getGroqModelValidationError(aiSettings.groqModel);
  const refreshInFlightRef = useRef(false);

  const adminFetch = useCallback((input: RequestInfo | URL, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${adminToken}`);
    return fetch(input, {...init, headers});
  }, [adminToken]);

  const loadSummary = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await adminFetch('/api/admin/ingestion/summary');
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
  }, [adminFetch]);

  const loadLogs = useCallback(async () => {
    try {
      const response = await adminFetch('/api/admin/ingestion/logs');
      if (!response.ok) return;
      const data = await response.json();
      setLogFile(data.file ?? null);
      setLogText(data.log ?? '');
      setLogStats(data.stats ?? defaultLogStats());
      setLogEvents(Array.isArray(data.events) ? data.events : []);
      setCurrentStatus(Array.isArray(data.currentStatus) ? data.currentStatus : []);
      setLogTimeline(Array.isArray(data.timeline) ? data.timeline : []);
    } catch {
      // Logs are auxiliary; keep the ingestion panel usable if this fails.
    }
  }, [adminFetch]);

  const loadAiSettings = useCallback(async () => {
    try {
      const response = await adminFetch('/api/admin/settings/ai');
      if (!response.ok) return;
      const data = await response.json();
      setAiSettings({
        enabled: data.enabled !== false,
        groqModel: data.groqModel || 'llama-3.3-70b-versatile',
        hasGroqApiKey: Boolean(data.hasGroqApiKey),
      });
    } catch {
      // Configuracao auxiliar; a coleta deve continuar acessivel.
    }
  }, [adminFetch]);

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
    if (!adminToken) return;
    void Promise.all([refreshAdminData(), loadAiSettings()]);
  }, [adminToken, loadAiSettings, refreshAdminData]);

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
      return {...dataset, total, done, failed, progress: calculatePercent(done, total)};
    });
  }, [checkpoints]);

  const selectedProgress = useMemo(
    () => summarizeCheckpointProgress(checkpoints.filter((row) => selectedDatasets.includes(row.dataset))),
    [checkpoints, selectedDatasets],
  );

  const overallProgress = useMemo(
    () => summarizeCheckpointProgress(checkpoints),
    [checkpoints],
  );

  const activeCheckpoints = useMemo(
    () => checkpoints.filter((row) => row.status !== 'done'),
    [checkpoints],
  );

  const estimatedQueueTotal = useMemo(() => {
    return selectedDatasets.reduce((sum, dataset) => {
      if (dataset === 'deputados') return sum + countLegislatures(from, to);
      if (dataset === 'votacoes') return sum + countWindows(from, to, 'month');
      return sum;
    }, 0);
  }, [from, selectedDatasets, to]);

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

  const currentAiEvents = useMemo(
    () => currentStatus.filter((event) => event.source === 'ai').slice(0, 2),
    [currentStatus],
  );

  const currentIngestionEvents = useMemo(
    () => currentStatus.filter((event) => event.source !== 'ai').slice(0, 2),
    [currentStatus],
  );

  useEffect(() => {
    const hasActiveWork = checkpoints.some((row) => row.status === 'running' || row.status === 'pending');
    if (!hasActiveWork && !isPolling && activeSection !== 'logs') return;

    const timer = window.setInterval(() => {
      void refreshAdminData();
    }, 5000);

    return () => window.clearInterval(timer);
  }, [activeSection, checkpoints, isPolling, refreshAdminData]);

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
      const response = await adminFetch('/api/admin/ingestion/run', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({from, to, datasets: selectedDatasets}),
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
      const response = await adminFetch('/api/admin/ingestion/cancel', {
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

  const clearDataset = async (dataset: string, label: string) => {
    const confirmation =
      dataset === 'todos'
        ? 'Isto vai limpar todos os dados oficiais e checkpoints da Camara. As avaliacoes ligadas a politicos tambem podem ser removidas por cascata. Continuar?'
        : `Limpar dados de ${label}? Os checkpoints desta categoria tambem serao removidos.`;

    if (!window.confirm(confirmation)) return;

    setClearingDataset(dataset);
    setMessage(null);
    try {
      const response = await adminFetch('/api/admin/database/clear', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({dataset}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Erro ao limpar dados.');
      setMessage(`${data.deletedRows ?? 0} registro(s) removido(s) de ${label}.`);
      await refreshAdminData();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Erro ao limpar dados.');
    } finally {
      setClearingDataset(null);
    }
  };

  const saveAiSettings = async () => {
    if (aiModelError) {
      setMessage(aiModelError);
      return;
    }
    setIsSavingAi(true);
    setMessage(null);
    try {
      const response = await adminFetch('/api/admin/settings/ai', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          enabled: aiSettings.enabled,
          groqModel: aiSettings.groqModel,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Erro ao salvar IA.');
      setAiSettings({
        enabled: data.enabled !== false,
        groqModel: data.groqModel || aiSettings.groqModel,
        hasGroqApiKey: Boolean(data.hasGroqApiKey),
      });
      setMessage(data.message ?? 'Configuracoes de IA salvas.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Erro ao salvar IA.');
    } finally {
      setIsSavingAi(false);
    }
  };

  if (!adminToken) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-16 dark:bg-slate-950">
        <form
          className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900"
          onSubmit={(event) => {
            event.preventDefault();
            const token = adminTokenInput.trim();
            if (!token) return;
            window.sessionStorage.setItem('admin_api_token', token);
            setAdminToken(token);
            setAdminTokenInput('');
          }}
        >
          <h1 className="text-2xl font-black text-slate-900 dark:text-slate-50">Acesso administrativo</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Informe o token administrativo configurado no servidor.</p>
          <input
            type="password"
            autoComplete="current-password"
            value={adminTokenInput}
            onChange={(event) => setAdminTokenInput(event.target.value)}
            className="mt-5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50"
            placeholder="Token administrativo"
          />
          <button type="submit" className="mt-4 w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-black text-white hover:bg-blue-700">
            Entrar
          </button>
        </form>
      </div>
    );
  }

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
          <button
            type="button"
            onClick={() => {
              window.sessionStorage.removeItem('admin_api_token');
              setAdminToken('');
            }}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            Sair
          </button>
        </div>

        <nav className="mb-6 flex gap-2 overflow-x-auto rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-900">
          {adminSections.map((section) => {
            const Icon = section.icon;
            const isActive = activeSection === section.id;
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => setActiveSection(section.id)}
                className={cn(
                  'inline-flex shrink-0 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-black transition',
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                )}
              >
                <Icon size={16} />
                {section.label}
              </button>
            );
          })}
        </nav>

        {activeSection === 'coleta' && (
        <section className="min-w-0">
          <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(280px,420px)_minmax(280px,1fr)]">
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
                  <span>{activeCheckpoints.length} checkpoints acionaveis</span>
                  <span>{estimatedQueueTotal > 0 ? `${estimatedQueueTotal} estimados` : 'estimativa aberta'}</span>
                </div>

                <div className="mb-2 mt-4 flex items-center justify-between gap-3">
                  <span className="text-xs font-black uppercase text-slate-500 dark:text-slate-400">
                    Processamento
                  </span>
                  <span className="text-sm font-black text-slate-900 dark:text-slate-50">
                    {formatPercent(overallProgress.percent, overallProgress.done, overallProgress.total)}
                  </span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                  <div
                    className="h-full rounded-full bg-blue-600 transition-all"
                    style={{width: `${overallProgress.percent}%`}}
                  >
                    <div className="h-full w-full bg-blue-500" />
                  </div>
                  {overallProgress.running > 0 && overallProgress.percent < 100 && (
                    <div
                      className="relative -mt-3 h-3 animate-pulse rounded-full bg-blue-400/70 transition-all"
                      style={{
                        marginLeft: `${overallProgress.percent}%`,
                        width: `${Math.max(3, overallProgress.activePercent - overallProgress.percent)}%`,
                      }}
                    />
                  )}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-bold text-slate-500 dark:text-slate-400">
                  <span>{overallProgress.done} concluidas</span>
                  <span className="text-right">{overallProgress.total} tarefas</span>
                  <span>{overallProgress.running} rodando</span>
                  <span className="text-right">{overallProgress.pending} na fila</span>
                  <span>{overallProgress.failed} falhas</span>
                  <span className="text-right">
                    {overallProgress.running > 0 ? 'Agente trabalhando' : 'Sem tarefa ativa'}
                  </span>
                </div>
                {overallProgress.total === 0 && (
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

          <div className="min-w-0 rounded-lg border border-rose-200 bg-white p-5 dark:border-rose-900 dark:bg-slate-900">
            <div className="mb-4 flex items-center gap-2">
              <Trash2 size={20} className="text-rose-600 dark:text-rose-400" />
              <h2 className="text-lg font-black text-slate-900 dark:text-slate-50">Limpar banco</h2>
            </div>
            <p className="mb-4 text-sm font-semibold text-slate-600 dark:text-slate-300">
              Remove dados oficiais e checkpoints por categoria. Use antes de reingerir uma base que ficou inconsistente.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {cleanupOptions.map((dataset) => {
                const isAll = dataset.id === 'todos';
                const isClearing = clearingDataset === dataset.id;
                return (
                  <button
                    key={dataset.id}
                    type="button"
                    onClick={() => clearDataset(dataset.id, dataset.label)}
                    disabled={clearingDataset != null || overallProgress.running > 0}
                    className={cn(
                      'inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-black ring-1 ring-inset transition disabled:cursor-not-allowed disabled:opacity-50',
                      isAll
                        ? 'col-span-2 bg-rose-600 text-white ring-rose-600 hover:bg-rose-700'
                        : 'bg-rose-50 text-rose-700 ring-rose-200 hover:bg-rose-100 dark:bg-rose-950 dark:text-rose-200 dark:ring-rose-900 dark:hover:bg-rose-900',
                    )}
                  >
                    <Trash2 size={14} />
                    {isClearing ? 'Limpando...' : `Limpar ${dataset.label}`}
                  </button>
                );
              })}
            </div>
            {overallProgress.running > 0 && (
              <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                A limpeza fica bloqueada enquanto houver ingestao rodando.
              </div>
            )}
          </div>
          </div>
        </section>
        )}

        {activeSection === 'progresso' && (
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
                    <span>{formatPercent(dataset.progress, dataset.done, dataset.total)} concluido</span>
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
                      <th className="px-4 py-3 text-right">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {activeCheckpoints.map((row) => (
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
                    {activeCheckpoints.length === 0 && (
                      <tr>
                        <td className="px-4 py-6 text-center text-slate-500 dark:text-slate-400" colSpan={6}>Nenhuma tarefa ativa, pendente ou com falha.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeSection === 'logs' && (
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
                <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
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
                      Em andamento
                    </div>
                    <div className="mt-2 text-xl font-black tabular-nums text-blue-700 dark:text-blue-300">
                      {formatNumber(logStats.progressItems)}
                    </div>
                    <div className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">
                      {formatNumber(logStats.progressUpdates)} atualizacoes
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

                <div className="mb-5 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-black text-slate-900 dark:text-slate-50">
                        Status operacional
                      </div>
                      <div className="text-xs font-bold text-slate-500 dark:text-slate-400">
                        {currentStatus.length > 0
                          ? `${formatNumber(currentStatus.length)} fluxo(s) ativo(s) agora`
                          : logEvents.length > 0
                            ? 'Sem processo ativo; exibindo historico recente abaixo'
                            : 'Aguardando eventos da ingestao ou da IA'}
                      </div>
                    </div>
                    <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-black text-slate-500 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700">
                      <RefreshCw size={13} className={cn((isPolling || activeSection === 'logs') && 'animate-spin')} />
                      Atualiza a cada 5s
                    </div>
                  </div>

                  {(currentIngestionEvents.length > 0 || currentAiEvents.length > 0) ? (
                    <div className="grid gap-3 lg:grid-cols-2">
                      <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="text-xs font-black uppercase text-slate-500 dark:text-slate-400">Ingestao ativa</span>
                          <span className="text-[11px] font-bold text-slate-400">{currentIngestionEvents.length} agora</span>
                        </div>
                        <div className="grid gap-2">
                          {currentIngestionEvents.length > 0 ? (
                            currentIngestionEvents.map((event, index) => (
                              <LogEventCard key={`${event.timestamp}-${event.stage}-${index}`} event={event} compact />
                            ))
                          ) : (
                            <div className="rounded-lg border border-dashed border-slate-200 px-3 py-3 text-xs font-bold text-slate-500 dark:border-slate-700 dark:text-slate-400">
                              Nenhuma etapa de ingestao ativa no momento.
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="text-xs font-black uppercase text-slate-500 dark:text-slate-400">IA em execucao</span>
                          <span className="text-[11px] font-bold text-slate-400">{currentAiEvents.length} agora</span>
                        </div>
                        <div className="grid gap-2">
                          {currentAiEvents.length > 0 ? (
                            currentAiEvents.map((event, index) => (
                              <LogEventCard key={`${event.timestamp}-${event.stage}-${index}`} event={event} compact />
                            ))
                          ) : (
                            <div className="rounded-lg border border-dashed border-slate-200 px-3 py-3 text-xs font-bold text-slate-500 dark:border-slate-700 dark:text-slate-400">
                              Nenhuma chamada de IA ativa agora.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center text-sm font-bold text-slate-500 dark:border-slate-700 dark:text-slate-400">
                      Inicie uma coleta ou abra votacoes com IA ativa para ver as etapas aqui.
                    </div>
                  )}

                  {logTimeline.length > 0 && (
                    <div className="mt-4">
                      <div className="mb-2 text-xs font-black uppercase text-slate-500 dark:text-slate-400">
                        Linha do tempo recente
                      </div>
                      <div className="grid gap-2">
                        {logTimeline.slice(0, 6).map((event, index) => (
                          <LogEventCard
                            key={`timeline-${event.timestamp}-${event.stage}-${index}`}
                            event={event}
                            compact
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="mb-3 flex items-center justify-between gap-3 text-xs font-bold text-slate-500 dark:text-slate-400">
                  <span>{logFile ?? 'Nenhum arquivo de log'}</span>
                  <span>{logText ? `${logText.split('\n').length} linhas` : 'sem saida'}</span>
                </div>
                <pre className="max-h-80 max-w-full overflow-auto rounded-lg bg-slate-950 p-4 text-xs leading-relaxed text-slate-100">
                  {logText || 'Nenhum log de ingestao disponivel ainda.'}
                </pre>
              </div>
            </div>
        )}

        {activeSection === 'cobertura' && (
            <div className="min-w-0 rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
              <div className="border-b border-slate-200 p-5 dark:border-slate-700">
                <h2 className="text-lg font-black text-slate-900 dark:text-slate-50">Cobertura populada</h2>
              </div>
              <div className="grid min-w-0 gap-2 p-5 sm:grid-cols-2 xl:grid-cols-3">
                {periods.map((period) => (
                  <div key={`${period.dataset}-${period.periodStart ?? 'static'}-${period.periodEnd ?? 'static'}`} className="rounded-lg bg-slate-50 p-3 dark:bg-slate-950">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-black uppercase text-slate-500 dark:text-slate-400">{period.dataset}</span>
                      <span className="text-xs font-bold text-slate-500 dark:text-slate-400">{period.total.toLocaleString('pt-BR')}</span>
                    </div>
                    <div className="mt-2 text-sm font-black text-slate-900 dark:text-slate-50">
                      {formatPeriodRange(period.periodStart, period.periodEnd)}
                    </div>
                  </div>
                ))}
                {periods.length === 0 && <div className="text-sm text-slate-500 dark:text-slate-400">Nenhum periodo encontrado no banco.</div>}
              </div>
            </div>
        )}

        {activeSection === 'ia' && (
          <div className="grid gap-6 lg:grid-cols-[minmax(280px,520px)_minmax(0,1fr)]">
            <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
              <div className="mb-5 flex items-center gap-2">
                <Bot size={20} className="text-blue-600 dark:text-blue-400" />
                <h2 className="text-lg font-black text-slate-900 dark:text-slate-50">Resumo por IA</h2>
              </div>
              <div className="space-y-4">
                <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-3 text-sm font-bold text-slate-700 dark:border-slate-700 dark:text-slate-200">
                  Ativar IA nas votacoes
                  <input
                    type="checkbox"
                    checked={aiSettings.enabled}
                    onChange={(event) => setAiSettings((current) => ({...current, enabled: event.target.checked}))}
                    className="h-5 w-5 rounded border-slate-300 text-blue-600"
                  />
                </label>

                <label className="text-sm font-bold text-slate-700 dark:text-slate-200">
                  Nome do modelo Groq
                  <input
                    value={aiSettings.groqModel}
                    onChange={(event) => setAiSettings((current) => ({...current, groqModel: event.target.value}))}
                    placeholder="llama-3.3-70b-versatile"
                    spellCheck={false}
                    aria-invalid={Boolean(aiModelError)}
                    aria-describedby="groq-model-help"
                    className={cn(
                      'mt-2 w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 dark:bg-slate-950 dark:text-slate-50',
                      aiModelError ? 'border-red-500' : 'border-slate-200 dark:border-slate-700',
                    )}
                  />
                  <span id="groq-model-help" className={cn('mt-2 block text-xs font-semibold', aiModelError ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400')}>
                    {aiModelError ?? 'Exemplo: llama-3.3-70b-versatile. Não cole uma chave gsk_ neste campo.'}
                  </span>
                </label>

                <div className={cn(
                  'rounded-lg border px-3 py-3 text-sm font-bold',
                  aiSettings.hasGroqApiKey
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                    : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
                )}>
                  <div className="flex items-start gap-2">
                    <AlertCircle size={18} className="mt-0.5 shrink-0" />
                    <div>
                      <p>Chave da Groq: {aiSettings.hasGroqApiKey ? 'configurada no servidor' : 'não configurada'}</p>
                      {!aiSettings.hasGroqApiKey && (
                        <p className="mt-2 text-xs font-semibold">
                          Adicione <code>GROQ_API_KEY=sua_nova_chave</code> ao arquivo <code>.env</code> e recrie o serviço da API.
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={saveAiSettings}
                  disabled={isSavingAi || Boolean(aiModelError)}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-sm font-black text-white transition hover:bg-blue-700 disabled:opacity-60"
                >
                  <Settings size={18} />
                  {isSavingAi ? 'Salvando...' : 'Salvar IA'}
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
              <h2 className="text-lg font-black text-slate-900 dark:text-slate-50">Como sera usado</h2>
              <div className="mt-4 space-y-3 text-sm font-semibold text-slate-600 dark:text-slate-300">
                <p>
                  Modelo recomendado: <span className="font-black text-slate-900 dark:text-slate-50">llama-3.3-70b-versatile</span>.
                </p>
                <p>
                  A IA é opcional e executada fora da requisição pública. Ela só simplifica fatos previamente classificados e nunca escolhe o objeto real da votação.
                </p>
                <p>
                  A chave é lida exclusivamente da variável de ambiente GROQ_API_KEY e nunca é salva no banco.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};


