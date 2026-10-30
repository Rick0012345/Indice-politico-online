import {describe, expect, it} from 'vitest';
import {accumulateExpensePage, expenseQueryParams, readExpensePageProgress} from './expenseIngestion';

describe('consulta mensal de despesas por legislatura', () => {
  it.each([[2019,1,55],[2019,2,56],[2023,1,56],[2023,2,57],[2020,1,56],[2025,1,57],[2015,1,54],[2015,2,55]] as const)(
    'resolve %i/%i para legislatura %i', (year,month,idLegislatura) => {
      expect(expenseQueryParams(year,month)).toEqual({ano:year,mes:month,idLegislatura});
    },
  );
  it.each([[2014,1],[2027,1],[2026,0],[2026,13],[2026,1.5]])('rejeita calendário não suportado %i/%i', (year,month) => {
    expect(() => expenseQueryParams(year,month)).toThrow('Período');
  });
  const params = expenseQueryParams(2026,1);
  const resource = '/deputados/1/despesas';
  const cursor = {version:1,resource,params:{ano:2026,mes:1},nextPage:2,itemsCount:100,finished:true};
  it('reinicia o cursor legado mesmo quando já terminou', () => {
    expect(readExpensePageProgress(cursor,resource,params)).toMatchObject({params,nextPage:1,itemsCount:0,finished:false});
  });
  it('preserva a página e a conclusão de um cursor novo compatível', () => {
    const current = {...cursor,params,expenseAggregation:{version:2,entries:[{codDocumento:1}]}};
    expect(readExpensePageProgress(current,resource,params)).toEqual(current);
  });
  it('reinicia também cursor com legislatura mas sem acumulador', () => {
    expect(readExpensePageProgress({...cursor,params},resource,params)).toMatchObject({nextPage:1,itemsCount:0,finished:false,expenseAggregation:{version:2,entries:[]}});
  });
  it.each([
    {version:3,entries:[]}, {version:1,entries:{}}, {version:1,entries:[{}]},
    {version:1,entries:[{codDocumento:1,valorLiquido:'10'}]},
    {version:1,entries:[{codDocumento:1,mes:2}]},
    {version:1,entries:Array.from({length:20001},(_,i)=>({codDocumento:i}))},
  ])('rejeita acumulador corrompido %#', expenseAggregation => {
    expect(() => readExpensePageProgress({...cursor,params,expenseAggregation},resource,params)).toThrow();
  });
  it('rejeita estado sem originais para uma contagem já processada', () => {
    expect(() => readExpensePageProgress({...cursor,params,expenseAggregation:{version:1,entries:[]}},resource,params)).toThrow('Contagem');
  });
  it('reinicia acumulador v1 validado para corrigir categoria e identidade do arquivo raw', () => {
    expect(readExpensePageProgress({...cursor,params,expenseAggregation:{version:1,entries:[{codDocumento:0,tipoDespesa:'A'}]}},resource,params)).toMatchObject({nextPage:1,itemsCount:0,finished:false,expenseAggregation:{version:2,entries:[]}});
  });
  it('deduplica payload estruturalmente igual, preservando lançamentos distintos com o mesmo valor', () => {
    const progress = readExpensePageProgress({},resource,params);
    const first = {codDocumento:1,valorLiquido:0.1,dataDocumento:'2026-01-01'};
    const duplicate = {dataDocumento:'2026-01-01',valorLiquido:0.1,codDocumento:1};
    const second = {...first,dataDocumento:'2026-01-02'};
    const result = accumulateExpensePage(progress,[first,duplicate,second]);
    expect(result.expenseAggregation.entries).toHaveLength(2);
    expect(result.items[0]).toMatchObject({valorLiquido:0.2,sourceEntries:[first,second]});
    expect(progress.expenseAggregation.entries).toEqual([]);
  });
  it.each([{}, {codDocumento:null}, {codDocumento:''}])('impede ingestão sem identidade do documento %#', entry => {
    expect(() => accumulateExpensePage(readExpensePageProgress({},resource,params),[entry])).toThrow('codDocumento');
  });
  it('rejeita cursor novo com legislatura diferente', () => {
    expect(() => readExpensePageProgress({...cursor,params:{...params,idLegislatura:56}},resource,params)).toThrow('progresso');
  });
  it('rejeita cursor legado de outro mês ou recurso, ou malformado', () => {
    expect(() => readExpensePageProgress(cursor,resource,expenseQueryParams(2026,2))).toThrow('progresso');
    expect(() => readExpensePageProgress({...cursor,resource:'/outro'},resource,params)).toThrow('progresso');
    expect(() => readExpensePageProgress({...cursor,nextPage:0},resource,params)).toThrow('progresso');
  });
});
