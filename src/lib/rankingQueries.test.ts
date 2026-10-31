import {describe,expect,it,vi} from 'vitest';
import type {Pool} from 'pg';
import {attachJudicialSummaries} from './judicialRepository';
import {buildProgressiveRankingQuery,expenseYearsQuery} from './rankingQueries';
import {parseExpenseFilters} from './expenseQueries';

const options={where:'COALESCE(p.ativo,true)=true',values:[],filters:parseExpenseFilters({}),metric:'nota' as const,direction:'desc' as const,limit:5,offset:0};
describe('consultas progressivas do ranking',()=>{
  it('cards consultam apenas identidade e avaliações',()=>{
    const query=buildProgressiveRankingQuery({...options,view:'cards'});
    expect(query.text).not.toMatch(/\bdespesas\b|votos_deputados|ingestion_checkpoints|nome_civil/);
    expect(query.values).toEqual([5,0]);
  });
  it('ordenação por nota enriquece despesas e votos somente depois da página',()=>{
    const query=buildProgressiveRankingQuery({...options,view:'items'});
    expect(query.text.indexOf('LIMIT')).toBeLessThan(query.text.indexOf('FROM despesas'));
    expect(query.text.indexOf('LIMIT')).toBeLessThan(query.text.indexOf('FROM votos_deputados'));
  });
  it('resumo não inclui paginação nem campos de perfil',()=>{
    const query=buildProgressiveRankingQuery({...options,view:'summary'});
    expect(query.values).toEqual([]);
    expect(query.text).not.toMatch(/LIMIT|OFFSET|nome_civil|url_foto/);
  });
  it('segmenta fornecedores somente depois da página quando ordenado por nota',()=>{
    const query=buildProgressiveRankingQuery({...options,view:'items',filters:parseExpenseFilters({valorMin:'15'})});
    expect(query.text).toContain('sourceEntries');
    expect(query.text.indexOf('LIMIT')).toBeLessThan(query.text.indexOf('jsonb_array_elements'));
  });
  it('anos saltam entre valores distintos usando o índice existente',()=>{
    expect(expenseYearsQuery).toMatch(/WITH RECURSIVE/);
    expect(expenseYearsQuery).toMatch(/ano </);
  });
  it('ordena condenações globais antes da página, com desconhecidos por último e empate por nome/id',()=>{
    const query=buildProgressiveRankingQuery({...options,view:'items',metric:'condenacoes',category:'ELECTORAL',prisonOnly:true});
    expect(query.values[0]).toBe('ELECTORAL');
    expect(query.text).toContain('judicial_records');
    expect(query.text).toMatch(/"judicialKnown" DESC.*"judicialFinal" DESC.*nome ASC.*id::bigint ASC/);
    expect(query.text.indexOf('jstats.prisons,0)>0')).toBeLessThan(query.text.indexOf('LIMIT'));
  });
  it('ordena processos únicos antes da página sem promover desconhecidos a zero',()=>{
    for(const direction of ['asc','desc'] as const){
      const query=buildProgressiveRankingQuery({...options,view:'items',metric:'processos',direction});
      expect(query.text).toContain('judicial_process_observations');
      expect(query.text).toContain(`"proceedingsKnown" DESC,"proceedingsCount" ${direction.toUpperCase()}`);
      expect(query.text.indexOf('GROUP BY politico_id,canonical_key')).toBeLessThan(query.text.indexOf('LIMIT'));
    }
  });
  it('enriquece uma coleção em consultas em lote e não consulta coleção vazia',async()=>{
    const query=vi.fn().mockResolvedValue({rows:[{id:'1',coverage:null,records:[]},{id:'2',coverage:null,records:[]}]});
    const pool={query} as unknown as Pool;
    expect(await attachJudicialSummaries(pool,[])).toEqual([]);expect(query).not.toHaveBeenCalled();
    const items=await attachJudicialSummaries(pool,[{id:'1',nome:'A'},{id:'2',nome:'B'}]);
    expect(query).toHaveBeenCalledTimes(2);expect(query.mock.calls[0][1]).toEqual([['1','2']]);
    expect(items.map(p=>p.judicial.finalConvictions)).toEqual([null,null]);
    expect(items[0].nome).toBe('A');
  });
});
