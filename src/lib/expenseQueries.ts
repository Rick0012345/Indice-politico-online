type Query = Record<string, unknown>;
export class ExpenseFilterError extends Error {}

const numberFilter = (query: Query, key: string, integer = false, min = -Infinity, max = Infinity) => {
  const raw = query[key];
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'string' || !raw.trim()) throw new ExpenseFilterError(`Filtro ${key} inválido.`);
  const n = Number(raw);
  if (!Number.isFinite(n) || (integer && !Number.isSafeInteger(n)) || n < min || n > max) {
    throw new ExpenseFilterError(`Filtro ${key} inválido.`);
  }
  return n;
};

export const buildExpenseQuery = (politicoId: string, query: Query) => {
  if (!/^[1-9]\d{0,18}$/.test(politicoId) || BigInt(politicoId) > 9223372036854775807n) {
    throw new ExpenseFilterError('Identificador de político inválido.');
  }
  const ano = numberFilter(query, 'ano', true, 1, 9999);
  const mes = numberFilter(query, 'mes', true, 1, 12);
  const min = numberFilter(query, 'valorMin');
  const max = numberFilter(query, 'valorMax');
  if (min != null && max != null && min > max) throw new ExpenseFilterError('Valor mínimo maior que o máximo.');
  if (query.tipo != null && typeof query.tipo !== 'string') throw new ExpenseFilterError('Tipo de despesa inválido.');
  const tipo = typeof query.tipo === 'string' ? query.tipo.trim().slice(0, 255) : '';
  const limit = Math.min(2000, numberFilter(query, 'limit', true, 1) ?? 20);
  const offset = numberFilter(query, 'offset', true, 0) ?? 0;
  const values: Array<string | number> = [politicoId];
  const period = ['d.politico_id = $1::bigint'];
  const filters: string[] = [];
  const add = (target: string[], expression: string, value: string | number) => {
    values.push(value);
    target.push(`${expression} $${values.length}`);
  };
  if (ano != null) add(period, 'd.ano =', ano);
  if (mes != null) add(period, 'd.mes =', mes);
  if (tipo) {
    values.push(tipo);
    filters.push(`strpos(lower(tipo_despesa), lower($${values.length}::text)) > 0`);
  }
  if (min != null) add(filters, 'valor_liquido >=', min);
  if (max != null) add(filters, 'valor_liquido <=', max);
  values.push(limit, offset);
  return {
    values,
    offset,
    text: `WITH periodo AS (
      SELECT d.id, d.ano, d.mes, d.tipo_despesa, d.valor_liquido, d.url_documento, d.nome_fornecedor
      FROM despesas d WHERE ${period.join(' AND ')}
    ), filtradas AS (
      SELECT * FROM periodo ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
    ), pagina AS (
      SELECT id::text AS id, ano, mes, tipo_despesa AS tipo, valor_liquido::double precision AS valor,
        url_documento AS "urlDocumento", nome_fornecedor AS fornecedor
      FROM filtradas ORDER BY ano DESC, mes DESC, id DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}
    ) SELECT
      (SELECT COUNT(*)::int FROM filtradas) AS total,
      (SELECT COALESCE(SUM(valor_liquido),0)::double precision FROM filtradas) AS "totalValor",
      ARRAY(SELECT DISTINCT tipo_despesa FROM periodo ORDER BY tipo_despesa) AS "tiposDisponiveis",
      COALESCE((SELECT json_agg(p ORDER BY p.ano DESC,p.mes DESC,p.id DESC) FROM pagina p),'[]'::json) AS items`,
  };
};
