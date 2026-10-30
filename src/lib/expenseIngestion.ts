import {readPageProgress} from './ingestionPages';
import type {PageProgress} from './ingestionPages';
import type {Expense} from './expensePersistence';
import {aggregateExpenseEntries, expenseSourceIdentity, mergeExpenseEntries} from './expenseAggregation';

export type ExpensePageProgress = PageProgress & {expenseAggregation: {version:2; entries:Expense[]}};
const MAX_EXPENSE_ENTRIES = 20000;

function validateEntries(entries: unknown, params: ReturnType<typeof expenseQueryParams>): asserts entries is Expense[] {
  if (!Array.isArray(entries) || entries.length > MAX_EXPENSE_ENTRIES) throw new Error('Acumulador de despesas inválido ou acima do limite.');
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || entry.sourceEntries !== undefined ||
        (entry.ano != null && entry.ano !== params.ano) || (entry.mes != null && entry.mes !== params.mes)) {
      throw new Error('Lançamento de despesa sem codDocumento válido ou com período/acumulador divergente.');
    }
    expenseSourceIdentity(entry);
    for (const key of ['valorDocumento','valorGlosa','valorLiquido']) {
      const value = entry[key];
      if (value != null && (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) >= 1e10 || Math.abs(value - Number(value.toFixed(2))) > 1e-9)) {
        throw new Error('Valor monetário inválido no acumulador de despesas.');
      }
    }
  }
}

export function expenseQueryParams(year: number, month: number) {
  if (!Number.isSafeInteger(year) || year < 2015 || year > 2026 ||
      !Number.isSafeInteger(month) || month < 1 || month > 12) {
    throw new Error('Período de despesas fora do calendário de legislaturas suportado (2015–2026).');
  }
  // Legislatures change in February; January of an inauguration year still belongs to the previous one.
  const idLegislatura = 55 + Math.floor((year - 2015 - (month === 1 ? 1 : 0)) / 4);
  return {ano: year, mes: month, idLegislatura};
}

export function readExpensePageProgress(value: unknown, resource: string, params: ReturnType<typeof expenseQueryParams>): ExpensePageProgress {
  const saved = value as {params?: Record<string, unknown>;expenseAggregation?: unknown} | null;
  const fresh = () => ({...readPageProgress({},resource,params),expenseAggregation:{version:2 as const,entries:[]}});
  if (saved?.params && !Object.hasOwn(saved.params, 'idLegislatura')) {
    // Only the known legacy query is restartable. Other corrupt/mismatched cursors still fail validation.
    readPageProgress(value, resource, {ano: params.ano, mes: params.mes});
    if (saved.expenseAggregation !== undefined) throw new Error('Acumulador de despesas com consulta legada inválido.');
    return fresh();
  }
  const progress = readPageProgress(value, resource, params);
  // Even the first idLegislatura-aware release did not accumulate documents across pages.
  if (saved?.expenseAggregation === undefined) return fresh();
  const state = saved.expenseAggregation as {version:number;entries:unknown};
  if (!state || Array.isArray(state) || ![1,2].includes(state.version)) throw new Error('Versão do acumulador de despesas inválida.');
  validateEntries(state.entries,params);
  if (state.entries.length > progress.itemsCount || (progress.itemsCount > 0 && state.entries.length === 0) ||
      (progress.nextPage === 1 && progress.itemsCount !== 0) ||
      mergeExpenseEntries([],state.entries).length !== state.entries.length) throw new Error('Contagem do acumulador de despesas inválida.');
  // v1 merged categories and used an unscoped raw identity. Re-fetch to publish the corrected groups.
  if (state.version === 1) return fresh();
  return {...progress,expenseAggregation:{version:2,entries:state.entries}};
}

export function accumulateExpensePage(progress: ExpensePageProgress, incoming: Expense[]) {
  validateEntries(incoming,progress.params as ReturnType<typeof expenseQueryParams>);
  const entries = mergeExpenseEntries(progress.expenseAggregation.entries,incoming);
  validateEntries(entries,progress.params as ReturnType<typeof expenseQueryParams>);
  return {expenseAggregation:{version:2 as const,entries},items:aggregateExpenseEntries(entries,Number(progress.params.ano),Number(progress.params.mes))};
}
