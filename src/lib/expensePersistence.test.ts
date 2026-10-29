// @vitest-environment node
import {describe, expect, it, vi} from 'vitest';
import {upsertExpenseBatch} from './expensePersistence';

describe('lote de despesas', () => {
  it('retorna contagens vazias sem consultar o banco', async () => {
    const query = vi.fn();
    expect(await upsertExpenseBatch({query}, '1', 2026, 10, [])).toEqual({processed: 0, changed: 0});
    expect(query).not.toHaveBeenCalled();
  });

  it('persiste cem despesas com uma única consulta e informa linhas realmente alteradas', async () => {
    const query = vi.fn().mockResolvedValue({rowCount: 37});
    const expenses = Array.from({length: 100}, (_, i) => ({codDocumento: i, valorLiquido: -i}));
    expect(await upsertExpenseBatch({query}, '1', 2026, 10, expenses)).toEqual({processed: 100, changed: 37});
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('propaga falha para o controlador externo reverter a transação', async () => {
    const error = new Error('banco indisponível');
    const query = vi.fn().mockRejectedValue(error);
    await expect(upsertExpenseBatch({query}, '1', 2026, 10, [{codDocumento: 1}])).rejects.toBe(error);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
