import {describe, expect, it} from 'vitest';
import {hashCpf, isValidCpf, normalizeCpf, parseComentario, parseNota} from './evaluationRules';

describe('evaluationRules', () => {
  it('normaliza CPF mantendo apenas 11 digitos', () => {
    expect(normalizeCpf('529.982.247-25abc99')).toBe('52998224725');
    expect(normalizeCpf(null)).toBe('');
  });

  it('valida CPF pelo digito verificador', () => {
    expect(isValidCpf('52998224725')).toBe(true);
    expect(isValidCpf('11111111111')).toBe(false);
    expect(isValidCpf('52998224724')).toBe(false);
    expect(isValidCpf('123')).toBe(false);
  });

  it('aceita somente notas inteiras entre 1 e 5', () => {
    expect(parseNota(1)).toBe(1);
    expect(parseNota('5')).toBe(5);
    expect(parseNota(0)).toBeNull();
    expect(parseNota(6)).toBeNull();
    expect(parseNota(3.5)).toBeNull();
    expect(parseNota('abc')).toBeNull();
  });

  it('normaliza comentarios vazios, validos e invalidos', () => {
    expect(parseComentario(null)).toEqual({comentario: null, error: null});
    expect(parseComentario('   ')).toEqual({comentario: null, error: null});
    expect(parseComentario('  Bom trabalho  ')).toEqual({comentario: 'Bom trabalho', error: null});
    expect(parseComentario(123)).toEqual({
      comentario: null,
      error: 'O comentario informado e invalido.',
    });
    expect(parseComentario('a'.repeat(501))).toEqual({
      comentario: null,
      error: 'O comentario deve ter no maximo 500 caracteres.',
    });
  });

  it('gera hash estavel para o CPF normalizado', () => {
    expect(hashCpf('52998224725')).toBe(
      '7281dfb5e8becca0a1c5e77c1268baacb0f983572b8c204fd8df72b24175b231',
    );
  });
});
