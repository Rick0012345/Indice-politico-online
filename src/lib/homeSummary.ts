/** One snapshot and one expense aggregation for the three initial Home panels. */
export const homeSummaryQuery = `WITH ativos AS MATERIALIZED (
  SELECT id,sigla_uf,sigla_partido FROM politicos WHERE ativo IS DISTINCT FROM false
), despesas_por_deputado AS (
  SELECT d.politico_id,SUM(d.valor_liquido) AS total
  FROM despesas d INNER JOIN ativos p ON p.id=d.politico_id
  GROUP BY d.politico_id
), resumo AS MATERIALIZED (
  SELECT p.id,p.sigla_uf,p.sigla_partido,COALESCE(d.total,0) AS total
  FROM ativos p LEFT JOIN despesas_por_deputado d ON d.politico_id=p.id
), estados AS (
  SELECT sigla_uf AS uf,COUNT(*)::int AS "totalPoliticos",SUM(total)::double precision AS "totalDespesas"
  FROM resumo WHERE sigla_uf IS NOT NULL AND sigla_uf<>'' GROUP BY sigla_uf
), partidos AS (
  SELECT sigla_partido AS partido,COUNT(*)::int AS "totalPoliticos",SUM(total)::double precision AS "totalDespesas"
  FROM resumo WHERE sigla_partido IS NOT NULL AND sigla_partido<>'' GROUP BY sigla_partido
)
SELECT json_build_object('total',(SELECT COUNT(*)::int FROM ativos),
  'totalCadastrados',(SELECT COUNT(*)::int FROM politicos),
  'totalDespesas',(SELECT COALESCE(SUM(total),0)::double precision FROM resumo)) AS panorama,
  COALESCE((SELECT json_agg(e ORDER BY e.uf) FROM estados e),'[]'::json) AS estados,
  COALESCE((SELECT json_agg(p ORDER BY p."totalDespesas" DESC,p.partido) FROM partidos p),'[]'::json) AS partidos`;
