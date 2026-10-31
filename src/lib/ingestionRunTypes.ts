export type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export type RunDatasetStage = 'waiting' | 'seeding' | 'running' | 'completed';

export type RunTaskProgress = {
  estimatedTotal: number;
  completed: number;
  reused: number;
  remaining: number;
  running: number;
  pending: number;
  failed: number;
  cancelled: number;
  notCreated: number;
  percent: number;
};

export type RunDatasetProgress = RunTaskProgress & {dataset: string; stage: RunDatasetStage};

export type IngestionRunProgress = RunTaskProgress & {
  id: string;
  from: string;
  to: string;
  datasets: string[];
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  status: RunStatus;
  currentDataset: string | null;
  estimationComplete: boolean;
  byDataset: RunDatasetProgress[];
};
