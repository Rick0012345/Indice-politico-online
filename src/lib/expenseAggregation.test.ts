// @vitest-environment node
import {describe,expect,it} from 'vitest';
import {aggregateExpenseEntries,expenseRawResourceId,expenseSourceIdentity,mergeExpenseEntries} from './expenseAggregation';
import {accumulateExpensePage,expenseQueryParams,readExpensePageProgress} from './expenseIngestion';

const original={codDocumento:null,numDocumento:'2025/693656',cnpjCpfFornecedor:'00530352000159',tipoDocumento:'Recibos/Outros',ano:2025,mes:5,valorLiquido:-61932.80};
describe('identidade técnica sem código oficial',()=>{
  it('aceita o estorno da fonte sem preencher nem mutar codDocumento',()=>{
    const copy=structuredClone(original);
    const progress=readExpensePageProgress({},'/deputados/1/despesas',expenseQueryParams(2025,5));
    const result=accumulateExpensePage(progress,[original]);
    expect(result.items).toEqual([original]);
    expect(expenseSourceIdentity(original)).toMatch(/^v1:[a-f0-9]{64}$/);
    expect(original).toEqual(copy);
  });
  it('normaliza referência, emissor, tipo e parcela, sem usar campos corrigíveis',()=>{
    const key=expenseSourceIdentity(original);
    expect(expenseSourceIdentity({...original,numDocumento:' 2025/693656 ',cnpjCpfFornecedor:'00.530.352/0001-59',tipoDocumento:' recibos/outros ',parcela:0,
      valorLiquido:90,nomeFornecedor:'Nome novo',dataDocumento:'2025-05-31'})).toBe(key);
    for(const changed of [{cnpjCpfFornecedor:'00530352000160'},{numDocumento:'2025/693657'},{tipoDocumento:'Nota Fiscal'},{parcela:1}]) {
      expect(expenseSourceIdentity({...original,...changed})).not.toBe(key);
    }
  });
  it('mantém chave raw de código oficial e separa fallback por referência, emissor e competência',()=>{
    expect(expenseSourceIdentity({...original,codDocumento:0})).toBeNull();
    expect(expenseRawResourceId({...original,codDocumento:0,tipoDespesa:' A '},2025,5)).toBe('[2025,5,"0","A"]');
    const key=expenseRawResourceId(original,2025,5);
    expect(key).not.toContain(',null,');
    expect(expenseRawResourceId({...original,numDocumento:'outra'},2025,5)).not.toBe(key);
    expect(expenseRawResourceId({...original,mes:6},2025,6)).not.toBe(key);
  });
  it('deduplica replay completo, agrega componentes/estornos e preserva originais sem identidade injetada',()=>{
    const positive={...original,valorLiquido:100};
    const reversal={...original,valorLiquido:-30};
    const entries=mergeExpenseEntries([positive],[positive,reversal]);
    expect(entries).toHaveLength(2);
    expect(aggregateExpenseEntries(entries)).toEqual([{...reversal,valorDocumento:0,valorGlosa:0,valorLiquido:70,sourceEntries:[positive,reversal]}]);
  });
  it.each([{numDocumento:''},{cnpjCpfFornecedor:''},{cnpjCpfFornecedor:'texto'},{cnpjCpfFornecedor:'123'},{parcela:-1}])('recusa fallback sem identificação suficiente %#',change=>{
    expect(()=>expenseSourceIdentity({...original,...change})).toThrow(/identidade|emissor|parcela/i);
  });
});
