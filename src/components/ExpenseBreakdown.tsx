import React from 'react';
import type {ExpenseAnalysis, ExpenseAnalysisGroup} from '../lib/expenseAnalyticsTypes';

const money = new Intl.NumberFormat('pt-BR', {style:'currency',currency:'BRL'});

export function ExpenseBreakdown({analysis, onCategory, onSupplier}: {
  analysis: ExpenseAnalysis;
  onCategory: (tipo: string) => void;
  onSupplier: (id: string, nome: string) => void;
}) {
  const {cobertura, categorias, fornecedores, outrosFornecedores} = analysis;
  const max = Math.max(1,Math.abs(outrosFornecedores.total),...categorias.map(item=>Math.abs(item.total)),...fornecedores.map(item=>Math.abs(item.total)));
  const details = (item: ExpenseAnalysisGroup) => (
    <>
      <div className="mt-1 flex flex-wrap justify-between gap-2 text-sm tabular-nums">
        <span className={item.total < 0 ? 'font-semibold text-rose-700 dark:text-rose-300' : 'font-semibold'}>{money.format(item.total)}{item.total < 0 && ' · Estorno líquido'}</span>
        <span className="text-xs text-slate-500 dark:text-slate-400">{item.quantidade.toLocaleString('pt-BR')} registros · {item.participacao == null ? 'Participação indisponível' : `${item.participacao.toLocaleString('pt-BR',{maximumFractionDigits:1})}% do total líquido`}</span>
      </div>
      <div aria-hidden="true" className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className={`h-full ${item.total < 0 ? 'bg-rose-500' : 'bg-blue-500'}`} style={{width:`${Math.min(100,Math.abs(item.total)/max*100)}%`}} /></div>
    </>
  );
  return (
    <section aria-label="Análise das despesas" className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
        <h3 className="text-lg font-bold">Distribuição das despesas</h3>
        {analysis.total === 0 && cobertura.status === 'complete' && <p className="mt-2 text-sm">Sem despesas registradas no período consultado</p>}
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{analysis.total.toLocaleString('pt-BR')} registros em todo o filtro · Total líquido {money.format(analysis.totalValor)}. Valores negativos são preservados.</p>
        <div className="mt-5 grid min-w-0 gap-6 lg:grid-cols-2">
          <div><h4 className="mb-3 font-semibold">Categorias</h4><ul className="space-y-4">{categorias.map(item=><li key={item.tipo}><button type="button" aria-label={`Filtrar categoria ${item.tipo}`} onClick={()=>onCategory(item.tipo)} className="max-w-full break-words text-left text-sm font-semibold text-blue-700 hover:underline dark:text-blue-300">{item.tipo}</button>{details(item)}</li>)}</ul></div>
          <div><h4 className="mb-3 font-semibold">Principais fornecedores</h4><ul className="space-y-4">{fornecedores.map(item=><li key={item.id}><button type="button" onClick={()=>onSupplier(item.id,item.nome)} className="max-w-full break-words text-left text-sm font-semibold text-blue-700 hover:underline dark:text-blue-300">{item.nome}</button><p className="text-xs text-slate-500 dark:text-slate-400">{item.identificacao === 'nome' ? 'Agrupado somente pelo nome' : 'Agrupado pelo documento do fornecedor'}</p>{details(item)}</li>)}{outrosFornecedores.fornecedores > 0 && <li><span className="text-sm font-semibold">Outros fornecedores ({outrosFornecedores.fornecedores})</span>{details({...outrosFornecedores,participacao:analysis.totalValor > 0 ? outrosFornecedores.total/analysis.totalValor*100 : null})}</li>}</ul></div>
        </div>
      </div>
    </section>
  );
}
