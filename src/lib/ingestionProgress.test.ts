import {describe, expect, it} from 'vitest';
import {getIngestionStatus, summarizeCheckpointProgress, type CheckpointSummary} from './ingestionProgress';

const row = (status: string, total: number, emptyTotal = 0): CheckpointSummary => ({
  dataset: 'despesas', status, total, emptyTotal, itemsCount: null, periodStart: null, periodEnd: null,
});

describe('resumo da ingestão', () => {
  it('separa conclusões com e sem registros e conta tarefas, não grupos', () => {
    const progress = summarizeCheckpointProgress([row('done', 77003, 34791), row('running', 2), row('pending', 1)]);
    expect(progress).toMatchObject({total: 77006, done: 77003, withRecords: 42212, empty: 34791, running: 2, pending: 1, failed: 0});
    expect(progress.percent).toBeLessThan(100);
    expect(progress.withRecords + progress.empty + progress.running + progress.pending + progress.failed).toBe(progress.total);
  });

  it('exclui cancelamentos e só conta vazios entre tarefas concluídas', () => {
    expect(summarizeCheckpointProgress([row('done', 3, 1), row('failed', 2, 2), row('cancelled', 10)]))
      .toMatchObject({total: 5, done: 3, withRecords: 2, empty: 1, failed: 2});
  });

  it('não afirma execução só porque existem checkpoints running', () => {
    const progress = summarizeCheckpointProgress([row('running', 2)]);
    expect(getIngestionStatus(progress, {processActive: false, maintenanceActive: false}).label).toBe('Execução não confirmada');
    expect(getIngestionStatus(progress, null).label).toBe('Execução não confirmada');
  });

  it('reconhece processo preparando uma fila ainda vazia', () => {
    expect(getIngestionStatus(summarizeCheckpointProgress([]), {processActive: true, maintenanceActive: false}).label)
      .toBe('Coleta em execução');
  });

  it('distingue fila aguardando, lock compartilhado e base já processada', () => {
    const pending = summarizeCheckpointProgress([row('pending', 3)]);
    expect(getIngestionStatus(pending, {processActive: false, maintenanceActive: false}).label).toBe('Fila aguardando execução');
    expect(getIngestionStatus(pending, {processActive: false, maintenanceActive: true}).label).toBe('Operação em andamento');
    expect(getIngestionStatus(summarizeCheckpointProgress([row('done', 3)]), {processActive: false, maintenanceActive: false}).label)
      .toBe('Sem coleta em execução');
  });
});
