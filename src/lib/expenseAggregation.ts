import type {Expense} from './expensePersistence';
import {createHash} from 'node:crypto';

export const expenseDocumentCode = (entry: Expense) => {
  const code = entry.codDocumento == null ? '' : String(entry.codDocumento).trim();
  return code || null;
};

export const expenseType = (entry: Expense) => String(entry.tipoDespesa ?? '').trim() || 'Nao informado';

const identityText = (value: unknown) => typeof value === 'string' || typeof value === 'number'
  ? String(value).normalize('NFKC').trim().replace(/\s+/g,' ').toUpperCase() : '';
export const expenseIssuerDocument = (entry: Expense) => identityText(entry.cnpjCpfFornecedor).replace(/[.\/\-\s]/g,'');

/** Technical identity only; the original official code and source payload are never filled in. */
export function expenseSourceIdentity(entry: Expense): string | null {
  const code = expenseDocumentCode(entry);
  if (code !== null) {
    if (!['string','number'].includes(typeof entry.codDocumento) ||
        (typeof entry.codDocumento === 'number' && !Number.isFinite(entry.codDocumento)) || code.length > 100) {
      throw new Error('codDocumento inválido para a identidade de despesa.');
    }
    return null;
  }
  const reference = identityText(entry.numDocumento);
  const issuer = expenseIssuerDocument(entry);
  if (!reference || !/[\p{L}\p{N}]/u.test(reference) || !/^\d{11}(?:\d{3})?$/.test(issuer)) {
    throw new Error('Despesa sem codDocumento: identidade exige numDocumento e emissor CPF/CNPJ válidos.');
  }
  const installment = entry.parcela ?? 0;
  if (!Number.isSafeInteger(installment) || installment < 0 || installment > 32767) throw new Error('Parcela inválida para a identidade de despesa.');
  const input = JSON.stringify([1,reference,issuer,identityText(entry.tipoDocumento),installment]);
  return `v1:${createHash('sha256').update(input).digest('hex')}`;
}

const documentIdentity = (entry: Expense) => {
  const fallback = expenseSourceIdentity(entry);
  return fallback === null ? expenseDocumentCode(entry) : {sourceIdentity:fallback};
};

export const expenseRawResourceId = (entry: Expense, year: number, month: number) =>
  JSON.stringify([entry.ano ?? year,entry.mes ?? month,documentIdentity(entry),expenseType(entry)]);

const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([key,item]) => [key,canonical(item)]));
  return value;
};

/** Deduplicate the complete original payload, preserving reversals and distinct financial entries. */
export function mergeExpenseEntries(previous: Expense[], incoming: Expense[]): Expense[] {
  const entries = new Map<string,Expense>();
  for (const item of [...previous,...incoming]) {
    const originals = item.sourceEntries ?? [item];
    if (!Array.isArray(originals) || !originals.length) throw new Error('Lançamentos originais de despesas inválidos.');
    for (const entry of originals) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) || entry.sourceEntries !== undefined) throw new Error('Lançamento original de despesa inválido.');
      expenseSourceIdentity(entry);
      entries.set(JSON.stringify(canonical(entry)),entry);
    }
  }
  return [...entries.values()];
}

const cents = (value: unknown): bigint => {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0n;
  if (!Number.isSafeInteger(Math.round(number * 100))) throw new Error('Valor monetário de despesa fora do limite.');
  const [whole,fraction] = Math.abs(number).toFixed(2).split('.');
  const result = BigInt(whole) * 100n + BigInt(fraction);
  return number < 0 ? -result : result;
};

export function aggregateExpenseEntries(entries: Expense[], year?: number, month?: number): Expense[] {
  const groups = new Map<string,Expense[]>();
  for (const entry of entries) {
    const key = JSON.stringify([entry.ano ?? year,entry.mes ?? month,documentIdentity(entry),expenseType(entry)]);
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key,group);
  }
  return [...groups.values()].map(group => {
    if (group.length === 1) return group[0];
    const sum = (key: 'valorDocumento'|'valorGlosa'|'valorLiquido') => {
      const total = group.reduce((value,entry) => value + cents(entry[key]),0n);
      if (total > BigInt(Number.MAX_SAFE_INTEGER) || total < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error('Soma monetária de despesa fora do limite.');
      return Number(total) / 100;
    };
    return {...group[group.length-1],valorDocumento:sum('valorDocumento'),valorGlosa:sum('valorGlosa'),valorLiquido:sum('valorLiquido'),sourceEntries:group};
  });
}
