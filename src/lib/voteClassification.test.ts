import {describe, expect, it} from 'vitest';
import {classifyVote} from './voteClassification';

const pl363 = {id: 2483495, siglaTipo: 'PL', numero: 363, ano: 2025, ementa: 'Política Nacional Aldir Blanc'};

describe('classifyVote', () => {
  it('classifica votação principal usando a proposição afetada', () => {
    const result = classifyVote({
      votacaoId: '2483495-40',
      descricao: 'Aprovado o Projeto de Lei nº 363, de 2025.',
      proposicoesAfetadas: [pl363],
    });

    expect(result).toMatchObject({
      tipoVotacao: 'principal',
      ehSubvotacao: false,
      tituloPublico: 'Votação principal do PL 363/2025',
      classificacaoConfianca: 'derivada',
    });
  });

  it('nomeia requerimento de urgência sem chamar IA', () => {
    const result = classifyVote({
      descricao: 'Aprovado o Requerimento de Urgência (Art. 155 do RICD).',
      proposicaoObjeto: 'REQ 1516/2025',
      proposicoesAfetadas: [pl363],
    });

    expect(result.tipoVotacao).toBe('requerimento');
    expect(result.tituloPublico).toBe('Requerimento de urgência do PL 363/2025');
    expect(result.classificacaoConfianca).toBe('exata');
  });

  it('distingue retirada de pauta', () => {
    const result = classifyVote({
      descricao: 'Rejeitado o Requerimento de Retirada de Matéria da Pauta - PL 363/2025.',
      proposicoesAfetadas: [pl363],
    });
    expect(result.tituloPublico).toBe('Requerimento de retirada de pauta do PL 363/2025');
  });

  it('distingue destaque para votação em separado', () => {
    const result = classifyVote({
      descricao: 'Votação nominal do Destaque para Votação em Separado - PL 363/2025.',
      objetosPossiveis: [{id: 1, siglaTipo: 'DTQ', numero: 1, ano: 0, ementa: 'Destaque para Votação em Separado - PL 363/2025'}],
      proposicoesAfetadas: [pl363],
    });
    expect(result).toMatchObject({tipoVotacao: 'destaque', tituloPublico: 'Destaque para votação em separado do PL 363/2025'});
  });

  it('distingue emenda e substitutivo', () => {
    expect(classifyVote({descricao: 'Aprovada a Emenda de Plenário nº 1.', proposicoesAfetadas: [pl363]}).tipoVotacao).toBe('emenda');
    expect(classifyVote({descricao: 'Aprovado o Substitutivo ao Projeto de Lei nº 363, de 2025.', proposicoesAfetadas: [pl363]}).tipoVotacao).toBe('substitutivo');
  });

  it('não escolhe um objeto quando existem vários candidatos equivalentes', () => {
    const result = classifyVote({
      descricao: 'Rejeitado o Requerimento. Sim: 116; Não: 269; Total: 385.',
      objetosPossiveis: [
        {id: 1, siglaTipo: 'RPD', numero: 10, ano: 0, ementa: 'Requerimento de retirada de pauta - PL 363/2025'},
        {id: 2, siglaTipo: 'RPD', numero: 11, ano: 0, ementa: 'Requerimento de votação nominal - PL 363/2025'},
      ],
      proposicoesAfetadas: [pl363],
    });

    expect(result.objetoIdentificado).toBeNull();
    expect(result.classificacaoConfianca).toBe('ambigua');
    expect(result.tituloPublico).toBe('Requerimento do PL 363/2025');
    expect(result.classificacaoJustificativa).toContain('não identifica');
  });

  it('gera hash estável e muda quando a fonte muda', () => {
    const first = classifyVote({votacaoId: '1-1', descricao: 'Aprovado o requerimento.'});
    const same = classifyVote({votacaoId: '1-1', descricao: 'Aprovado o requerimento.'});
    const changed = classifyVote({votacaoId: '1-1', descricao: 'Rejeitado o requerimento.'});
    expect(first.inputHash).toBe(same.inputHash);
    expect(first.inputHash).not.toBe(changed.inputHash);
  });
});

