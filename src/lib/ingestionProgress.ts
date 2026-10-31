export type CheckpointSummary = {
  dataset: string;
  status: string;
  periodStart: string | null;
  periodEnd: string | null;
  total: number;
  itemsCount: number | null;
  emptyTotal?: number;
};

export type IngestionExecution = {processActive: boolean; maintenanceActive: boolean};

export const calculatePercent = (completed: number, total: number) =>
  total > 0 ? Math.min(100, (completed / total) * 100) : 0;

export const formatPercent = (percent: number, completed: number, total: number) => {
  if (total <= 0) return '0%';
  if (completed >= total) return '100%';
  const visiblePercent = Math.min(99.99, percent);
  const fractionDigits = visiblePercent >= 99 ? 2 : visiblePercent >= 10 ? 1 : 0;
  return `${visiblePercent.toLocaleString('pt-BR', {minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits})}%`;
};

export const summarizeCheckpointProgress = (rows: CheckpointSummary[]) => {
  const count = (status: string) => rows.filter(row => row.status === status).reduce((sum, row) => sum + Number(row.total ?? 0), 0);
  const done = count('done');
  const running = count('running');
  const pending = count('pending');
  const failed = count('failed');
  const empty = rows.filter(row => row.status === 'done').reduce((sum, row) => sum + Number(row.emptyTotal ?? 0), 0);
  const total = done + running + pending + failed;
  return {total, done, withRecords: done - empty, empty, running, pending, failed, percent: calculatePercent(done, total)};
};

export type IngestionProgress = ReturnType<typeof summarizeCheckpointProgress>;

export const getIngestionStatus = (progress: IngestionProgress, execution: IngestionExecution | null) => {
  if (execution?.processActive) return {
    label: 'Coleta em execução', tone: 'active',
    detail: progress.running > 0 ? 'O agente está processando tarefas. A fila pode crescer conforme novos dados são descobertos.' : 'O agente está preparando a fila ou finalizando a execução.',
  };
  if (execution?.maintenanceActive) return {
    label: 'Operação em andamento', tone: 'active',
    detail: 'O banco registra uma operação de ingestão, enriquecimento ou manutenção. Esse sinal sozinho não identifica uma coleta.',
  };
  if (progress.running > 0 || !execution) return {
    label: 'Execução não confirmada', tone: 'warning',
    detail: progress.running > 0 ? 'Há tarefas marcadas em processamento, mas nenhum agente ativo foi confirmado. Elas podem pertencer a uma execução interrompida.' : 'O servidor não informou o estado do agente nesta leitura.',
  };
  if (progress.pending > 0) return {
    label: 'Fila aguardando execução', tone: 'neutral',
    detail: 'Existem tarefas pendentes. Uma fila pendente não significa que o agente esteja em execução.',
  };
  if (progress.failed > 0) return {
    label: 'Há tarefas com falha', tone: 'warning',
    detail: 'Consulte os detalhes na aba Progresso e os eventos na aba Logs.',
  };
  if (progress.total === 0) return {label: 'Nenhuma tarefa registrada', tone: 'neutral', detail: 'Inicie uma coleta para criar ou retomar tarefas.'};
  return {label: 'Sem coleta em execução', tone: 'neutral', detail: 'As tarefas registradas foram concluídas. Isso não comprova cobertura integral do período.'};
};
