import {describe, expect, it, vi} from 'vitest';
import {seedCheckpointBatch} from './ingestionSeeds';

const options = {resetFailed: false, resetCancelled: false, resetEmpty: false};
describe('semeadura em lote de checkpoints', () => {
  it('não consulta o banco para lote vazio', async () => {
    const query = vi.fn();
    await seedCheckpointBatch({query} as any, [], options);
    expect(query).not.toHaveBeenCalled();
  });
  it('envia mil checkpoints em uma consulta, eliminando apenas chaves repetidas', async () => {
    const query = vi.fn().mockResolvedValue({rows: []});
    const seeds = Array.from({length: 1000}, (_, i) => ({dataset: 'despesas', entityId: String(i), start: '2026-01-01', end: '2026-01-31'}));
    await seedCheckpointBatch({query} as any, [...seeds, seeds[0]], options);
    expect(query).toHaveBeenCalledTimes(1);
    expect(JSON.parse(query.mock.calls[0][1][0])).toHaveLength(1000);
  });
});
