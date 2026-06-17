import {describe, expect, it} from 'vitest';
import {
  getPoliticoSituacaoLabel,
  getPoliticoStatusClasses,
  getPoliticoStatusLabel,
  politicoStatusOptions,
} from './politicoStatus';

describe('politicoStatus', () => {
  it('mantem as opcoes publicas de filtro', () => {
    expect(politicoStatusOptions).toEqual([
      {value: 'ativo', label: 'Na ativa'},
      {value: 'inativo', label: 'Fora da ativa'},
      {value: 'todos', label: 'Todos'},
    ]);
  });

  it('trata parlamentares ativos, nulos ou indefinidos como na ativa', () => {
    expect(getPoliticoStatusLabel({ativo: true})).toBe('Na ativa');
    expect(getPoliticoStatusLabel({ativo: null})).toBe('Na ativa');
    expect(getPoliticoStatusLabel({})).toBe('Na ativa');
  });

  it('identifica parlamentares inativos', () => {
    expect(getPoliticoStatusLabel({ativo: false})).toBe('Fora da ativa');
    expect(getPoliticoStatusClasses({ativo: false})).toContain('text-slate-700');
  });

  it('normaliza situacao textual vazia para null', () => {
    expect(getPoliticoSituacaoLabel({situacao: ' Em exercicio '})).toBe('Em exercicio');
    expect(getPoliticoSituacaoLabel({situacao: '   '})).toBeNull();
    expect(getPoliticoSituacaoLabel({situacao: null})).toBeNull();
  });
});
