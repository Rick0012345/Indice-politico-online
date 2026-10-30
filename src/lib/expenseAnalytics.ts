import {expenseScopeSql,expenseFinancialRowsCtes,supplierIdSql,type ExpenseFilters} from './expenseQueries';

/** ids is an internal CTE name; callers supply bound values for all user input. */
export function expenseCoverageSql(ids:string,filters:ExpenseFilters,values:Array<string|number>) {
  const scope=expenseScopeSql(filters,values,true,'x');
  return `(WITH RECURSIVE global_window AS (
    SELECT MIN(period_start) AS first,MAX(period_end) AS last FROM ingestion_checkpoints WHERE source='camara' AND dataset='despesas'
  ), calendar(month) AS (
    SELECT date_trunc('month',first) FROM global_window WHERE first IS NOT NULL
    UNION ALL
    SELECT calendar.month+interval '1 month' FROM calendar,global_window WHERE calendar.month<date_trunc('month',last)
  ), expected_months AS (
    SELECT month::date AS competence,EXTRACT(YEAR FROM month)::int AS ano,EXTRACT(MONTH FROM month)::int AS mes FROM calendar
  ), expected AS (SELECT COUNT(*)::int * (SELECT COUNT(*)::int FROM ${ids}) AS n FROM expected_months x WHERE ${scope}), checkpoint_scope AS MATERIALIZED (
    SELECT cp.id,cp.entity_id,cp.period_start,cp.period_end,cp.status,cp.items_count,cp.updated_at
    FROM ingestion_checkpoints cp INNER JOIN ${ids} i ON cp.entity_id=i.id::text
    WHERE cp.source='camara' AND cp.dataset='despesas'
  ), expanded AS (
    SELECT cp.id,cp.entity_id,cp.period_start,cp.period_end,cp.status,cp.items_count,cp.updated_at,
      date_trunc('month',cp.period_start)::date AS competence,EXTRACT(YEAR FROM cp.period_start)::int AS ano,EXTRACT(MONTH FROM cp.period_start)::int AS mes
    FROM checkpoint_scope cp WHERE date_trunc('month',cp.period_start)=date_trunc('month',cp.period_end)
    UNION ALL
    SELECT cp.id,cp.entity_id,cp.period_start,cp.period_end,cp.status,cp.items_count,cp.updated_at,
      m.competence,m.ano,m.mes
    FROM checkpoint_scope cp INNER JOIN expected_months m ON m.competence BETWEEN date_trunc('month',cp.period_start) AND date_trunc('month',cp.period_end)
    WHERE date_trunc('month',cp.period_start)<>date_trunc('month',cp.period_end)
  ), ordered AS (
    SELECT x.*,row_number() OVER(PARTITION BY entity_id,competence ORDER BY period_end-period_start DESC,updated_at DESC,id DESC) AS priority
    FROM expanded x WHERE ${scope}
  ), chosen AS (SELECT * FROM ordered WHERE priority=1), stats AS (
    SELECT COUNT(*)::int AS periods,COUNT(*) FILTER(WHERE status='done')::int AS completed,
      COUNT(*) FILTER(WHERE status='done' AND items_count=0)::int AS empty,
      COUNT(*) FILTER(WHERE status='pending')::int AS pending,COUNT(*) FILTER(WHERE status='running')::int AS running,
      COUNT(*) FILTER(WHERE status='failed')::int AS failed,COUNT(*) FILTER(WHERE status='cancelled')::int AS cancelled,
      MIN(GREATEST(period_start,competence)) AS first,MAX(LEAST(period_end,(competence+interval '1 month - 1 day')::date)) AS last,
      MAX(updated_at) AS updated FROM chosen
  ), universe AS (
    SELECT COUNT(*)::int AS politicians,COUNT(*) FILTER(WHERE c.entity_id IS NULL)::int AS missing_politicians
    FROM ${ids} i LEFT JOIN(SELECT DISTINCT entity_id FROM chosen) c ON c.entity_id=i.id::text
  ) SELECT json_build_object('status',CASE WHEN periods=0 THEN 'not_imported' WHEN completed=periods AND expected.n<=periods AND missing_politicians=0 THEN 'complete' ELSE 'partial' END,
    'periods',periods,'expectedPeriods',expected.n,'missing',GREATEST(0,expected.n-periods),'completed',completed,'empty',empty,
    'pending',pending,'running',running,'failed',failed,'cancelled',cancelled,'politicians',politicians,'withoutCheckpoints',missing_politicians,
    'from',stats.first,'to',stats.last,'lastUpdatedAt',stats.updated) FROM stats,universe,expected)`;
}

export function buildExpenseAnalysisQuery(id:string,filters:ExpenseFilters) {
  const values:Array<string|number>=[id];
  const financial=expenseFinancialRowsCtes(filters,values,'d.politico_id=$1::bigint');
  const coverage=expenseCoverageSql('politicos_escopo',filters,values);
  return {values,text:`WITH politicos_escopo AS (SELECT id FROM politicos WHERE id=$1::bigint),${financial}, filtered AS (
    SELECT d.*,${supplierIdSql()} AS supplier_id,
      COALESCE(NULLIF(BTRIM(nome_fornecedor),''),'Sem fornecedor informado') AS supplier_name,
      CASE WHEN NULLIF(BTRIM(cnpj_cpf_fornecedor),'') IS NULL THEN 'nome' ELSE 'documento' END AS supplier_kind
    FROM financial_rows d
  ), totals AS (SELECT COUNT(*)::int AS count,COALESCE(SUM(valor_liquido),0) AS total FROM filtered), categories AS (
    SELECT tipo_despesa AS tipo,COUNT(*)::int AS quantidade,SUM(valor_liquido) AS value FROM filtered GROUP BY tipo_despesa
  ), suppliers AS (
    SELECT supplier_id AS id,MIN(supplier_name) AS nome,MIN(supplier_kind) AS identificacao,COUNT(*)::int AS quantidade,SUM(valor_liquido) AS value
    FROM filtered GROUP BY supplier_id
  ), top_suppliers AS (SELECT * FROM suppliers ORDER BY value DESC,id LIMIT 10)
  SELECT totals.count AS total,totals.total::double precision AS "totalValor",
    COALESCE((SELECT json_agg(json_build_object('tipo',tipo,'quantidade',quantidade,'total',value::double precision,'participacao',CASE WHEN totals.total>0 THEN (value/totals.total*100)::double precision ELSE NULL END) ORDER BY value DESC,tipo) FROM categories),'[]'::json) AS categorias,
    COALESCE((SELECT json_agg(json_build_object('id',id,'nome',nome,'identificacao',identificacao,'quantidade',quantidade,'total',value::double precision,'participacao',CASE WHEN totals.total>0 THEN (value/totals.total*100)::double precision ELSE NULL END) ORDER BY value DESC,id) FROM top_suppliers),'[]'::json) AS fornecedores,
    (SELECT json_build_object('total',COALESCE(SUM(value),0)::double precision,'quantidade',COALESCE(SUM(quantidade),0)::int,'fornecedores',COUNT(*)::int) FROM suppliers WHERE id NOT IN(SELECT id FROM top_suppliers)) AS "outrosFornecedores",
    ${coverage} AS cobertura FROM totals`};
}
