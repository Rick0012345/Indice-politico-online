// @vitest-environment node
import {describe, expect, it, vi} from 'vitest';
import {upsertRawBatch} from './rawPersistence';

describe('persistência raw em lote', () => {
  it('lote vazio não consulta o banco', async () => {
    const query = vi.fn();
    expect(await upsertRawBatch({query}, [])).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });
  it('usa uma operação para cem itens e retorna somente linhas alteradas', async () => {
    const query = vi.fn().mockResolvedValue({rowCount: 3});
    const items = Array.from({length: 100}, (_, i) => ({resource: 'despesas', resourceId: String(i), endpoint: '/despesas', rawJson: {id: i}}));
    expect(await upsertRawBatch({query}, items)).toBe(3);
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('propaga falha sem confirmar transação por conta própria', async () => {
    const error = new Error('falha raw');
    const query = vi.fn().mockRejectedValue(error);
    await expect(upsertRawBatch({query}, [{resource: 'x', resourceId: '1', endpoint: '/x', rawJson: {}}])).rejects.toBe(error);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
