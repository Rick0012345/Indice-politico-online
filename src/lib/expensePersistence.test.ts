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

  it('separa conflitos oficiais e fallback sem injetar a identidade no payload original',async()=>{
    const query=vi.fn().mockResolvedValue({rowCount:1});
    const uncoded={codDocumento:null,numDocumento:'2025/693656',cnpjCpfFornecedor:'00530352000159',tipoDocumento:'Recibos/Outros',valorLiquido:-61932.80};
    expect(await upsertExpenseBatch({query},'1',2025,5,[{codDocumento:1},uncoded])).toEqual({processed:2,changed:2});
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0]).toContain('ON CONFLICT (politico_id, ano, mes, cod_documento, tipo_despesa)');
    expect(query.mock.calls[1][0]).toContain('ON CONFLICT (politico_id, ano, mes, tipo_despesa, identidade_origem) WHERE cod_documento IS NULL');
    const row=JSON.parse(query.mock.calls[1][1][0])[0];
    expect(row).toMatchObject({cod_documento:null,identidade_origem:expect.stringMatching(/^v1:/),raw_json:uncoded});
    expect(row.raw_json).not.toHaveProperty('identidade_origem');
  });
});
