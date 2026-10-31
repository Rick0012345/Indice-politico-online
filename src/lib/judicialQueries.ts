import type {JudicialCategory} from './judicialTypes';
import {proceedingAggregateSql,proceedingLatestAttemptSql,proceedingUnresolvedSql} from './judicialProceedingsRepository';

export function proceedingRankingSql(){return {
 joins:`LEFT JOIN (${proceedingAggregateSql()}) jpstats ON jpstats.politico_id=p.id LEFT JOIN (${proceedingLatestAttemptSql}) jpattempt ON jpattempt.politico_id=p.id LEFT JOIN (${proceedingUnresolvedSql}) jpunresolved ON jpunresolved.politico_id=p.id`,
 known:`(COALESCE(jpstats.against_person,0)>0 OR (COALESCE(jpattempt.status='COMPLETE',false) AND COALESCE(jpunresolved.unresolved,0)=0 AND COALESCE(jpstats.stale,0)=0))`,
 count:'COALESCE(jpstats.against_person,0)',
};}

/** Shared definition of published counts for standalone and parliamentary rankings. */
export function judicialRankingSql(values:Array<string|number>,category:JudicialCategory|string) {
  values.push(category);
  const categoryParameter=`$${values.length}`;
  return {
    joins:`LEFT JOIN judicial_coverage jcoverage ON jcoverage.politico_id=p.id
      LEFT JOIN (SELECT politico_id,count(*) AS published,
        count(*) FILTER(WHERE kind='CONVICTION' AND category=${categoryParameter} AND payload->>'convictionStatus'='FINAL') AS final_count,
        count(*) FILTER(WHERE kind='IMPRISONMENT' AND payload->>'custodyConfirmed'='true') AS prisons
        FROM judicial_records WHERE verification='VERIFIED' GROUP BY politico_id) jstats ON jstats.politico_id=p.id`,
    known:`(COALESCE(jcoverage.status IN ('PARTIAL','REVIEWED'),false) OR COALESCE(jstats.published,0)>0)`,
    finalCount:'COALESCE(jstats.final_count,0)',
    prisons:'COALESCE(jstats.prisons,0)',
    effectiveStatus:`CASE WHEN jcoverage.status='REVIEWED' THEN 'REVIEWED' WHEN jcoverage.status='PARTIAL' OR COALESCE(jstats.published,0)>0 THEN 'PARTIAL' ELSE 'NOT_RESEARCHED' END`,
  };
}
