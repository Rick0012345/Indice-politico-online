import {expenseFinancialRowsCtes,type ExpenseFilters} from './expenseQueries';
import {expenseCoverageSql} from './expenseAnalytics';
import {judicialRankingSql,proceedingRankingSql} from './judicialQueries';
import type {JudicialCategory} from './judicialTypes';

type RankingOptions={
  view:'cards'|'items'|'summary';
  /** Internal SQL, built by the route; user input belongs in values. */
  where:string;
  values:Array<string|number>;
  filters:ExpenseFilters;
  metric:'nota'|'despesas'|'votacoes'|'condenacoes'|'processos';
  category?:JudicialCategory;
  prisonOnly?:boolean;
  direction:'asc'|'desc';
  limit:number;
  offset:number;
};

/** Keep expensive independent aggregates out of the first useful response. */
export function buildProgressiveRankingQuery(options:RankingOptions) {
  const {view,where,filters,limit,offset}=options;
  const values=[...options.values];
  const metric=view==='cards'?'nota':options.metric;
  const judicial=metric==='condenacoes'||options.prisonOnly?judicialRankingSql(values,options.category??'CRIMINAL'):null;
  const proceedings=metric==='processos'?proceedingRankingSql():null;
  const judicialWhere=options.prisonOnly?` AND ${judicial!.prisons}>0`:'';
  const counts=`(SELECT COUNT(*)::int FROM politicos) AS "totalCadastrados",(SELECT COUNT(*)::int FROM filtrados) AS total`;
  if(view==='summary') {
    const financial=expenseFinancialRowsCtes(filters,values,'d.politico_id IN (SELECT id FROM filtrados)',true);
    const coverage=expenseCoverageSql('filtrados',filters,values);
    return {values,text:`WITH filtrados AS (SELECT p.id FROM politicos p ${judicial?.joins??''} WHERE ${where}${judicialWhere}),${financial}
      SELECT ${counts},
      (SELECT COALESCE(SUM(d.valor_liquido),0)::double precision FROM financial_rows d) AS "totalDespesas",
      (SELECT COUNT(*)::int FROM avaliacoes a INNER JOIN filtrados f ON f.id=a.politico_id) AS "totalAvaliacoes",
      (SELECT COALESCE(AVG(a.nota),0)::double precision FROM avaliacoes a INNER JOIN filtrados f ON f.id=a.politico_id) AS "notaMedia",
      (SELECT COUNT(*)::int FROM votos_deputados v INNER JOIN filtrados f ON f.id=v.politico_id) AS "totalVotacoes",
      EXISTS(SELECT 1 FROM votos_deputados) AS "votacoesDisponiveis",${coverage} AS cobertura`};
  }
  // Cards always use the score order used by Home, independently of financial data.
  const financial=view==='items'?expenseFinancialRowsCtes(filters,values,
    metric==='despesas'?'d.politico_id IN (SELECT id FROM filtrados)':'d.politico_id=p.id::bigint',true):'';
  const orderBy=(prefix='')=>{
    const p=prefix?`${prefix}.`:'';
    const score=`${p}"notaMedia" ${options.direction==='asc'?'ASC':'DESC'}, ${p}"totalAvaliacoes" DESC, ${p}"atualizadoEm" DESC`;
    if(metric==='condenacoes')return `${p}"judicialKnown" DESC,${p}"judicialFinal" ${options.direction==='asc'?'ASC':'DESC'},${p}nome ASC,${p}id::bigint ASC`;
    if(metric==='processos')return `${p}"proceedingsKnown" DESC,${p}"proceedingsCount" ${options.direction==='asc'?'ASC':'DESC'},${p}nome ASC,${p}id::bigint ASC`;
    return metric==='nota'?`${score},${p}id::bigint ASC`:
      `${p}"${metric==='despesas'?'totalDespesas':'totalVotacoes'}" ${options.direction==='asc'?'ASC':'DESC'},${p}"notaMedia" DESC,${p}"totalAvaliacoes" DESC,${p}"atualizadoEm" DESC,${p}id::bigint ASC`;
  };
  const expenseAggregate=`WITH ${financial} SELECT COALESCE(SUM(d.valor_liquido),0)::double precision AS "totalDespesas" FROM financial_rows d`;
  const voteAggregate=`SELECT COUNT(*)::int AS "totalVotacoes" FROM votos_deputados v WHERE v.politico_id=p.id::bigint`;
  values.push(limit,offset);
  return {values,text:`WITH filtrados AS MATERIALIZED (
    SELECT p.id,p.nome,p.sigla_partido,p.sigla_uf,p.url_foto,p.ativo,p.situacao,p.atualizado_em
      ${metric==='condenacoes'?`,${judicial!.known} AS "judicialKnown",${judicial!.finalCount} AS "judicialFinal"`:''}
      ${metric==='processos'?`,${proceedings!.known} AS "proceedingsKnown",${proceedings!.count} AS "proceedingsCount"`:''}
      FROM politicos p ${judicial?.joins??''} ${proceedings?.joins??''} WHERE ${where}${judicialWhere}
  )${metric==='despesas'?`,${financial}, despesas_ordem AS (
    SELECT d.politico_id,SUM(d.valor_liquido)::double precision AS total
    FROM financial_rows d GROUP BY d.politico_id
  )`:''}, classificados AS (
    SELECT p.id::text AS id,p.nome,p.sigla_partido AS partido,p.sigla_uf AS estado,p.url_foto AS foto,
      COALESCE(p.ativo,true) AS ativo,p.situacao,p.atualizado_em AS "atualizadoEm",'Deputado Federal'::text AS cargo,
      a."notaMedia",a."totalAvaliacoes"
      ${metric==='condenacoes'?',p."judicialKnown",p."judicialFinal"':''}
      ${metric==='processos'?',p."proceedingsKnown",p."proceedingsCount"':''}
      ${metric==='despesas'?',COALESCE(d.total,0)::double precision AS "totalDespesas"':''}${metric==='votacoes'?',v."totalVotacoes"':''}
    FROM filtrados p
    CROSS JOIN LATERAL (SELECT COALESCE(AVG(a.nota),0)::double precision AS "notaMedia",COUNT(a.id)::int AS "totalAvaliacoes" FROM avaliacoes a WHERE a.politico_id=p.id) a
    ${metric==='despesas'?'LEFT JOIN despesas_ordem d ON d.politico_id=p.id':''}
    ${metric==='votacoes'?`CROSS JOIN LATERAL (${voteAggregate}) v`:''}
  ), pagina AS MATERIALIZED (
    SELECT * FROM classificados ORDER BY ${orderBy()} LIMIT $${values.length-1} OFFSET $${values.length}
  ), linhas AS (
    SELECT p.*${view==='items'&&metric!=='despesas'?',d."totalDespesas"':''}${view==='items'&&metric!=='votacoes'?',v."totalVotacoes"':''}
    FROM pagina p
    ${view==='items'&&metric!=='despesas'?`CROSS JOIN LATERAL (${expenseAggregate}) d`:''}
    ${view==='items'&&metric!=='votacoes'?`CROSS JOIN LATERAL (${voteAggregate}) v`:''}
  ) SELECT ${counts},COALESCE((SELECT json_agg(to_jsonb(l)-'judicialKnown'-'judicialFinal'-'proceedingsKnown'-'proceedingsCount' ORDER BY ${orderBy('l')}) FROM linhas l),'[]'::json) AS items`};
}

/** Loose index scan: one backward index seek per year instead of every expense. */
export const expenseYearsQuery=`WITH RECURSIVE years(ano) AS (
  (SELECT ano FROM despesas WHERE ano IS NOT NULL ORDER BY ano DESC LIMIT 1)
  UNION ALL
  SELECT next_year.ano FROM years y CROSS JOIN LATERAL (
    SELECT ano FROM despesas WHERE ano < y.ano ORDER BY ano DESC LIMIT 1
  ) next_year
) SELECT ano FROM years ORDER BY ano DESC`;
