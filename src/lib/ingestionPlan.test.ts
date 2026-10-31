import {describe, expect, it} from 'vitest';
import {buildIngestionPlan, buildWindows, legislaturesForYears, yearsForRange} from './ingestionPlan';

describe('planejamento compartilhado da ingestão', () => {
  it('inclui despesas futuras e todos os conjuntos selecionados antes de criar checkpoints', () => {
    const plan=buildIngestionPlan({from:'2026-01-01',to:'2026-02-28',datasets:['deputados','despesas','votacoes','partidos'],window:'month'},['1','2']);
    expect(plan.map(p=>[p.dataset,p.entityIds.length*p.windows.length])).toEqual([['deputados',1],['despesas',4],['votacoes',2],['partidos',1]]);
  });
  it('preserva as janelas com primeiro e último períodos parciais e legislaturas suportadas', () => {
    expect(buildWindows('2025-12-17','2026-02-10','month')).toEqual([{start:'2025-12-17',end:'2025-12-31'},{start:'2026-01-01',end:'2026-01-31'},{start:'2026-02-01',end:'2026-02-10'}]);
    expect(legislaturesForYears(yearsForRange('2015-01-01','2026-10-31'))).toEqual([55,56,57]);
  });
  it('deduplica a seleção e não inventa despesas quando o catálogo ainda está vazio', () => {
    expect(buildIngestionPlan({from:'2026-01-01',to:'2026-01-31',datasets:['despesas','despesas'],window:'month'},[])).toHaveLength(1);
    expect(buildIngestionPlan({from:'2026-01-01',to:'2026-01-31',datasets:['despesas'],window:'month'},[])[0].entityIds).toEqual([]);
  });
});
