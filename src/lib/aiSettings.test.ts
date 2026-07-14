import {describe, expect, it} from 'vitest';
import {getGroqModelValidationError} from './aiSettings';

describe('getGroqModelValidationError', () => {
  it('aceita nomes de modelos Groq', () => {
    expect(getGroqModelValidationError('llama-3.3-70b-versatile')).toBeNull();
    expect(getGroqModelValidationError('meta-llama/llama-4-scout-17b-16e-instruct')).toBeNull();
  });

  it('rejeita chave de API no campo de modelo', () => {
    expect(getGroqModelValidationError('gsk_segredo')).toContain('não uma chave de API');
    expect(getGroqModelValidationError('Bearer segredo')).toContain('não uma chave de API');
  });

  it('rejeita valor vazio ou com caracteres inválidos', () => {
    expect(getGroqModelValidationError('')).toBe('Informe o nome do modelo Groq.');
    expect(getGroqModelValidationError('modelo com espaços')).toContain('Nome de modelo inválido');
  });
});
