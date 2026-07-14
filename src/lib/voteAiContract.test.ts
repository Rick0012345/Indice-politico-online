import {describe, expect, it} from 'vitest';
import {parseAndValidateVoteAiResponse} from './voteAiContract';

describe('parseAndValidateVoteAiResponse', () => {
  it('aceita JSON com referências presentes na fonte', () => {
    expect(parseAndValidateVoteAiResponse(
      JSON.stringify({titulo: 'Urgência do PL 363/2025', resumo: 'Decisão sobre a urgência do PL 363/2025.'}),
      ['PL 363/2025'],
    )).toEqual({
      titulo: 'Urgência do PL 363/2025',
      resumo: 'Decisão sobre a urgência do PL 363/2025.',
    });
  });

  it('rejeita proposição inventada', () => {
    expect(parseAndValidateVoteAiResponse(
      JSON.stringify({titulo: 'Urgência do PL 999/2025', resumo: 'Resumo.'}),
      ['PL 363/2025'],
    )).toBeNull();
  });

  it('rejeita JSON inválido ou campos vazios', () => {
    expect(parseAndValidateVoteAiResponse('não é json', [])).toBeNull();
    expect(parseAndValidateVoteAiResponse(JSON.stringify({titulo: '', resumo: ''}), [])).toBeNull();
  });
});

