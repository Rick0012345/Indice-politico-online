import type {PoolClient} from 'pg';

export type Expense = {
  ano?: number; mes?: number; tipoDespesa?: string; codDocumento?: number | string;
  cnpjCpfFornecedor?: string; nomeFornecedor?: string; tipoDocumento?: string;
  codTipoDocumento?: number; dataDocumento?: string; numDocumento?: string;
  valorDocumento?: number; valorGlosa?: number; valorLiquido?: number;
  numLote?: number | string; codLote?: number | string;
  numRessarcimento?: number | string; parcela?: number; urlDocumento?: string;
};

const textOrNull = (value: unknown) => {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
};

const numberOrNull = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

// Types match the persisted columns, including monetary scale and nullable codes.
const columns = [
  ['politico_id', 'bigint'], ['ano', 'smallint'], ['mes', 'smallint'],
  ['tipo_despesa', 'varchar(255)'], ['cod_documento', 'varchar(100)'],
  ['cnpj_cpf_fornecedor', 'varchar(14)'], ['nome_fornecedor', 'varchar(255)'],
  ['tipo_documento', 'varchar(50)'], ['data_documento', 'date'], ['num_documento', 'varchar(100)'],
  ['valor_documento', 'numeric(12,2)'], ['valor_glosa', 'numeric(12,2)'], ['valor_liquido', 'numeric(12,2)'],
  ['num_lote', 'varchar(50)'], ['num_ressarcimento', 'varchar(50)'], ['parcela', 'smallint'],
  ['url_documento', 'text'], ['cod_tipo_documento', 'integer'], ['cod_lote', 'varchar(100)'], ['raw_json', 'jsonb'],
] as const;
const names = columns.map(([name]) => name);
const updates = names.filter((name) => name !== 'cod_documento');
const batchSql = `INSERT INTO despesas AS current (${names.join(', ')})
  SELECT ${names.join(', ')} FROM jsonb_to_recordset($1::jsonb)
    AS item (${columns.map(([name, type]) => `${name} ${type}`).join(', ')})
  ON CONFLICT (cod_documento) DO UPDATE SET
    ${updates.map((name) => `${name} = EXCLUDED.${name}`).join(', ')}
  WHERE ROW(${names.map((name) => `current.${name}`).join(', ')})
    IS DISTINCT FROM ROW(${names.map((name) => `EXCLUDED.${name}`).join(', ')})`;

export async function upsertExpenseBatch(
  client: Pick<PoolClient, 'query'>, politicoId: string, year: number, month: number, expenses: Expense[],
): Promise<{processed: number; changed: number}> {
  if (expenses.length === 0) return {processed: 0, changed: 0};

  const normalized = expenses.map((expense) => ({
    politico_id: politicoId,
    ano: expense.ano ?? year,
    mes: expense.mes ?? month,
    tipo_despesa: textOrNull(expense.tipoDespesa) ?? 'Nao informado',
    cod_documento: textOrNull(expense.codDocumento),
    cnpj_cpf_fornecedor: textOrNull(expense.cnpjCpfFornecedor),
    nome_fornecedor: textOrNull(expense.nomeFornecedor),
    tipo_documento: textOrNull(expense.tipoDocumento),
    data_documento: textOrNull(expense.dataDocumento),
    num_documento: textOrNull(expense.numDocumento),
    valor_documento: numberOrNull(expense.valorDocumento) ?? 0,
    valor_glosa: numberOrNull(expense.valorGlosa) ?? 0,
    valor_liquido: numberOrNull(expense.valorLiquido) ?? 0,
    num_lote: textOrNull(expense.numLote),
    num_ressarcimento: textOrNull(expense.numRessarcimento),
    parcela: numberOrNull(expense.parcela) ?? 0,
    url_documento: textOrNull(expense.urlDocumento),
    cod_tipo_documento: numberOrNull(expense.codTipoDocumento),
    cod_lote: textOrNull(expense.codLote) ?? textOrNull(expense.numLote),
    raw_json: expense,
  }));
  // PostgreSQL cannot update the same conflicting row twice in one INSERT.
  // Preserve the last observation, as the previous sequential writer did.
  const lastIndex = new Map<string, number>();
  normalized.forEach((row, index) => {
    if (row.cod_documento !== null) lastIndex.set(row.cod_documento, index);
  });
  const rows = normalized.filter((row, index) => row.cod_documento === null || lastIndex.get(row.cod_documento) === index);
  const result = await client.query(batchSql, [JSON.stringify(rows)]);
  return {processed: expenses.length, changed: result.rowCount ?? 0};
}
