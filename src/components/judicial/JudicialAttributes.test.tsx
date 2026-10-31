import React from 'react';
import {render, screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {expect, it} from 'vitest';
import type {JudicialSummary} from '../../lib/judicialTypes';
import {JudicialAttributes, proceedingCoverageText} from './JudicialAttributes';

const summary: JudicialSummary = {
  finalConvictions: 0, appealConvictions: 0, confirmedImprisonments: 0, prisonHistory: 'NO_RECORDS',
  counts: {CRIMINAL:{final:0,appeal:0},IMPROBITY:{final:0,appeal:0},ELECTORAL:{final:0,appeal:0},ACCOUNTS:{final:0,appeal:0}},
  coverage: {status:'REVIEWED',scope:'Escopo restrito',sources:[],checkedAt:null,version:1},lastCheckedAt:null,
};
it('distingue zero pesquisado de resumo ausente e pesquisa não realizada',()=>{
 const {rerender}=render(<JudicialAttributes summary={summary} detailsHref="?tab=geral#historico-judicial"/>,{wrapper:MemoryRouter});
 expect(screen.getAllByText('0')).toHaveLength(3);
 expect(screen.getByText('Sem registro de prisão no escopo pesquisado')).toBeVisible();
 expect(screen.getByRole('link',{name:'Ver histórico e fontes'})).toHaveAttribute('href','/?tab=geral#historico-judicial');
 rerender(<JudicialAttributes summary={{...summary,finalConvictions:null,appealConvictions:null,confirmedImprisonments:null,prisonHistory:'NOT_RESEARCHED',coverage:{...summary.coverage,status:'NOT_RESEARCHED'}}} detailsHref="#historico-judicial"/>);
 expect(screen.getAllByText('Não pesquisado')).toHaveLength(3);
 expect(screen.queryByText('0')).not.toBeInTheDocument();
 expect(screen.getByText('Histórico de prisão não pesquisado')).toBeVisible();
 rerender(<JudicialAttributes detailsHref="#historico-judicial"/>);
 expect(screen.getAllByText('Indisponível')).toHaveLength(4);
 expect(screen.queryByText('0')).not.toBeInTheDocument();
});

it('inclui condenações identificadas mesmo sem situação atual na contagem geral', () => {
  render(<JudicialAttributes summary={{...summary, identifiedConvictions: 2}} detailsHref="#historico-judicial"/>, {wrapper: MemoryRouter});
  expect(screen.getByText('Condenações identificadas').nextElementSibling).toHaveTextContent('2');
  expect(screen.getByText(/Inclui condenações cuja situação atual não foi identificada/)).toBeInTheDocument();
});

it('separa processos contra, investigações e execuções, com cobertura própria e desconhecido sem zero',()=>{
 const proceedings={identified:9,againstPerson:3,activeAgainstPerson:2,investigations:4,enforcements:1,coverage:{status:'PARTIAL' as const,scope:'Processos públicos do STF, em tramitação e fora de tramitação',sourceLabel:'STF',sourceUrl:'https://portal.stf.jus.br/',checkedAt:'2026-10-30',attemptedAt:'2026-10-30',unresolved:2}};
 const view=render(<JudicialAttributes summary={{...summary,proceedings}} detailsHref="#historico-judicial"/>,{wrapper:MemoryRouter});
 expect(screen.getByText('Processos contra identificados').nextElementSibling).toHaveTextContent('3');
 expect(screen.getByText('Processos ativos contra').nextElementSibling).toHaveTextContent('2');
 expect(screen.getByText('Investigações').nextElementSibling).toHaveTextContent('4');
 expect(screen.getByText('Execuções').nextElementSibling).toHaveTextContent('1');
 expect(screen.getByText(/Consulta processual parcial/)).toBeInTheDocument();
 expect(screen.getByText(/30\/10\/2026/)).toBeInTheDocument();
 view.rerender(<JudicialAttributes summary={summary} detailsHref="#historico-judicial"/>);
 expect(screen.getByText('Processos contra identificados').nextElementSibling).toHaveTextContent('Não apurado');
});

it('mostra a data da tentativa quando a consulta processual falhou sem resultado anterior',()=>{
 expect(proceedingCoverageText({identified:null,againstPerson:null,activeAgainstPerson:null,investigations:null,enforcements:null,coverage:{status:'FAILED',scope:'STF',sourceLabel:'STF',sourceUrl:'https://portal.stf.jus.br/',checkedAt:null,attemptedAt:'2026-10-30T12:00:00Z',unresolved:0}})).toContain('Tentativa em 30/10/2026');
});
