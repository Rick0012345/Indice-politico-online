type Query = Record<string, unknown>;
export class ExpenseFilterError extends Error {}

export const numberFilter = (query: Query, key: string, integer = false, min = -Infinity, max = Infinity) => {
  const raw = query[key];
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'string' || !raw.trim()) throw new ExpenseFilterError(`Filtro ${key} inválido.`);
  const n = Number(raw);
  if (!Number.isFinite(n) || (integer && !Number.isSafeInteger(n)) || n < min || n > max) {
    throw new ExpenseFilterError(`Filtro ${key} inválido.`);
  }
  return n;
};

export const parseExpenseFilters = (query:Query) => {
  const ano=numberFilter(query,'ano',true,1,9999),mes=numberFilter(query,'mes',true,1,12);
  let mesInicio=numberFilter(query,'mesInicio',true,1,12),mesFim=numberFilter(query,'mesFim',true,1,12);
  if(mesInicio!==null||mesFim!==null) {
    if(ano===null||mes!==null)throw new ExpenseFilterError('Intervalo de meses requer ano e não pode ser combinado com mês.');
    mesInicio??=1;mesFim??=12;
    if(mesInicio>mesFim)throw new ExpenseFilterError('Intervalo de meses inválido.');
  }
  const min=numberFilter(query,'valorMin'),max=numberFilter(query,'valorMax');
  if(min!==null&&max!==null&&min>max)throw new ExpenseFilterError('Valor mínimo maior que o máximo.');
  if(query.tipo!=null&&typeof query.tipo!=='string')throw new ExpenseFilterError('Tipo de despesa inválido.');
  const tipo=typeof query.tipo==='string'?query.tipo.trim().slice(0,255):'';
  if(query.fornecedorId!=null&&(typeof query.fornecedorId!=='string'||!/^[a-fA-F0-9]{32}$/.test(query.fornecedorId)))throw new ExpenseFilterError('Fornecedor inválido.');
  return {ano,mes,mesInicio,mesFim,min,max,tipo,fornecedorId:typeof query.fornecedorId==='string'?query.fornecedorId.toLowerCase():null};
};
export type ExpenseFilters=ReturnType<typeof parseExpenseFilters>;
export const supplierIdSql=(alias='d')=>`md5(CASE WHEN NULLIF(BTRIM(${alias}.cnpj_cpf_fornecedor),'') IS NOT NULL THEN 'doc:'||BTRIM(${alias}.cnpj_cpf_fornecedor) ELSE 'nome:'||lower(COALESCE(NULLIF(BTRIM(${alias}.nome_fornecedor),''),'Sem fornecedor informado')) END)`;
export function expenseScopeSql(filters:ExpenseFilters,values:Array<string|number>,periodOnly=false,alias='d') {
  const where:string[]=[];
  const add=(sql:string,value:string|number)=>{values.push(value);where.push(`${sql} $${values.length}`);};
  if(filters.ano!==null)add(`${alias}.ano =`,filters.ano);
  if(filters.mes!==null)add(`${alias}.mes =`,filters.mes);
  if(filters.mesInicio!==null)add(`${alias}.mes >=`,filters.mesInicio);
  if(filters.mesFim!==null)add(`${alias}.mes <=`,filters.mesFim);
  if(!periodOnly) {
    if(filters.tipo){values.push(filters.tipo);where.push(`strpos(lower(${alias}.tipo_despesa),lower($${values.length}::text))>0`);}
    if(filters.min!==null)add(`${alias}.valor_liquido >=`,filters.min);
    if(filters.max!==null)add(`${alias}.valor_liquido <=`,filters.max);
    if(filters.fornecedorId!==null)add(`${supplierIdSql(alias)} =`,filters.fornecedorId);
  }
  return where.length?where.join(' AND '):'TRUE';
}

/** Restrict IDs/competence before reading sourceEntries. No history is rewritten. */
export function expenseFinancialRowsCtes(filters:ExpenseFilters,values:Array<string|number>,politicianWhere='TRUE',aggregateOnly=false) {
  const columns=(alias:string,id=`${alias}.id::text`)=>`${id} AS id,${alias}.politico_id,${alias}.ano,${alias}.mes,${alias}.tipo_despesa,${alias}.valor_liquido,${alias}.url_documento,${alias}.nome_fornecedor,${alias}.cnpj_cpf_fornecedor`;
  // Totals per politician/month/category do not change when a document is split by supplier.
  // This avoids reading JSON across the whole catalog for unfiltered monthly comparisons.
  if(aggregateOnly && filters.fornecedorId===null && filters.min===null && filters.max===null) {
    const scope=expenseScopeSql(filters,values);
    return `financial_rows AS (SELECT ${columns('d')} FROM despesas d WHERE ${politicianWhere} AND ${scope})`;
  }
  const period=expenseScopeSql(filters,values,true);
  const componentScope=expenseScopeSql({...filters,ano:null,mes:null,mesInicio:null,mesFim:null},values);
  const originalDoc=`NULLIF(BTRIM(e.item->>'cnpjCpfFornecedor'),'')`;
  const originalName=`COALESCE(NULLIF(BTRIM(e.item->>'nomeFornecedor'),''),'Sem fornecedor informado')`;
  const originalSupplier=`md5(CASE WHEN ${originalDoc} IS NOT NULL THEN 'doc:'||${originalDoc} ELSE 'nome:'||lower(${originalName}) END)`;
  return `financial_candidates AS MATERIALIZED (
    SELECT ${columns('d','d.id')} FROM despesas d WHERE ${politicianWhere} AND ${period}
  ), financial_sources AS MATERIALIZED (
    SELECT c.id,r.raw_json->'sourceEntries' AS entries FROM financial_candidates c INNER JOIN despesas r ON r.id=c.id
    WHERE CASE WHEN jsonb_typeof(r.raw_json->'sourceEntries')='array' THEN jsonb_array_length(r.raw_json->'sourceEntries')>0 ELSE FALSE END
  ), financial_groups AS (
    SELECT s.id,${originalSupplier} AS supplier_id,MIN(${originalName}) AS nome_fornecedor,MIN(${originalDoc}) AS cnpj_cpf_fornecedor,
      CASE WHEN COUNT(DISTINCT NULLIF(BTRIM(e.item->>'urlDocumento'),''))=1 THEN MIN(NULLIF(BTRIM(e.item->>'urlDocumento'),'')) ELSE NULL END AS url_documento,
      SUM(ROUND(COALESCE((e.item->>'valorLiquido')::numeric,0),2)) AS valor_liquido
    FROM financial_sources s CROSS JOIN LATERAL jsonb_array_elements(s.entries) e(item) GROUP BY s.id,2
  ), financial_group_counts AS (
    SELECT g.*,COUNT(*) OVER(PARTITION BY id) AS suppliers FROM financial_groups g
  ), financial_segments AS (
    SELECT c.id::text||CASE WHEN g.suppliers>1 THEN ':'||g.supplier_id ELSE '' END AS id,
      c.politico_id,c.ano,c.mes,c.tipo_despesa,g.valor_liquido,g.url_documento,g.nome_fornecedor,g.cnpj_cpf_fornecedor
    FROM financial_candidates c INNER JOIN financial_group_counts g ON g.id=c.id
    UNION ALL
    SELECT ${columns('c')} FROM financial_candidates c WHERE NOT EXISTS(SELECT 1 FROM financial_sources s WHERE s.id=c.id)
  ), financial_rows AS (SELECT d.* FROM financial_segments d WHERE ${componentScope})`;
}

export const buildExpenseQuery = (politicoId: string, query: Query) => {
  if (!/^[1-9]\d{0,18}$/.test(politicoId) || BigInt(politicoId) > 9223372036854775807n) {
    throw new ExpenseFilterError('Identificador de político inválido.');
  }
  const filters=parseExpenseFilters(query);
  const limit = Math.min(2000, numberFilter(query, 'limit', true, 1) ?? 20);
  const offset = numberFilter(query, 'offset', true, 0) ?? 0;
  const values: Array<string | number> = [politicoId];
  const ctes=expenseFinancialRowsCtes(filters,values,'d.politico_id=$1::bigint');
  values.push(limit, offset);
  return {
    values,
    offset,
    text: `WITH ${ctes}, pagina AS (
      SELECT id::text AS id, ano, mes, tipo_despesa AS tipo, valor_liquido::double precision AS valor,
        url_documento AS "urlDocumento", nome_fornecedor AS fornecedor
      FROM financial_rows ORDER BY ano DESC, mes DESC, id DESC
      LIMIT $${values.length - 1} OFFSET $${values.length}
    ) SELECT
      (SELECT COUNT(*)::int FROM financial_rows) AS total,
      (SELECT COALESCE(SUM(valor_liquido),0)::double precision FROM financial_rows) AS "totalValor",
      ARRAY(SELECT DISTINCT tipo_despesa FROM financial_candidates ORDER BY tipo_despesa) AS "tiposDisponiveis",
      COALESCE((SELECT json_agg(p ORDER BY p.ano DESC,p.mes DESC,p.id DESC) FROM pagina p),'[]'::json) AS items`,
  };
};
