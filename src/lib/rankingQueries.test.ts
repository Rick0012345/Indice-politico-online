import {describe,expect,it} from 'vitest';
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
});
