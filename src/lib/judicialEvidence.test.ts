// @vitest-environment node
import {describe,expect,it} from 'vitest';
import {assessJudicialEvidence} from './judicialEvidence';

const person={id:'11',nome:'João Exemplo',nomeCivil:'João de Exemplo Teste'};
const assess=(text:string,title='Notícia judicial')=>assessJudicialEvidence({title,text},person);

describe('evidência judicial atribuída à pessoa',()=>{
  it.each([
    'Foi recebida denúncia contra João Exemplo. Pedro Outro foi condenado.',
    'João Exemplo teve pedido de prisão negado.',
    'João Exemplo foi citado, mas Pedro Outro foi preso.',
    'A PGR pede a condenação de João Exemplo.',
    'O ministro votou pela condenação de João Exemplo.',
    'João Exemplo não foi condenado.',
    'O irmão de João Exemplo foi condenado.',
    'O advogado de João Exemplo foi preso.',
    'João Exemplo será condenado se comprovada a acusação.',
    'João Exemplo poderia ser condenado.',
    'Foi determinada a prisão de João Exemplo.',
    'Foi expedido mandado de prisão de João Exemplo.',
    'João Exemplo foi absolvido.',
    'João Exemplo disse que Pedro Outro foi condenado.',
    'João Exemplos foi condenado.',
    'Se João Exemplo foi condenado, poderá recorrer.',
    'Não foi mantida a condenação de João Exemplo.',
    'O ministro propôs que fosse mantida a condenação de João Exemplo.',
    'STF condenou João Exemplo Filho.',
    'Foi mantida a condenação de João Exemplo Filho.',
    'STF anulou a condenação de João Exemplo Filho.',
  ])('recusa atribuição insuficiente: %s',text=>{expect(assess(text)).toEqual([]);});

  it.each([
    ['João Exemplo foi condenado por corrupção.','CONVICTION','REPORTED'],
    ['O STF condenou o deputado João Exemplo por corrupção.','CONVICTION','REPORTED'],
    ['Foi mantida a condenação de João Exemplo.','CONVICTION','REPORTED'],
    ['STJ mantém condenação do ex-deputado João Exemplo.','CONVICTION','REPORTED'],
    ['A Primeira Turma do Supremo Tribunal Federal (STF) condenou, por unanimidade, o deputado João Exemplo (PL-SP) por corrupção.','CONVICTION','REPORTED'],
    ['Por unanimidade, o STF condenou o deputado João Exemplo.','CONVICTION','REPORTED'],
    ['O Supremo Tribunal Federal (STF), por maioria de votos, condenou o deputado João Exemplo por corrupção.','CONVICTION','REPORTED'],
    ['O deputado João Exemplo (PL-SP) foi condenado por peculato.','CONVICTION','REPORTED'],
    ['João Exemplo foi preso nesta terça-feira.','IMPRISONMENT','REPORTED'],
    ['João Exemplo havia sido condenado em primeira instância.','CONVICTION','REPORTED'],
    ['A condenação de João Exemplo foi anulada pelo STF.','CONVICTION','REVERSED'],
    ['João Exemplo teve sua condenação anulada.','CONVICTION','REVERSED'],
    ['STF anula condenação de João Exemplo.','CONVICTION','REVERSED'],
    ['João Exemplo foi condenado em 2010, mas teve sua condenação anulada em 2015.','CONVICTION','REVERSED'],
    ['João Exemplo foi condenado em decisão posteriormente anulada pelo STF.','CONVICTION','REVERSED'],
  ])('aceita relato explícito: %s',(text,kind,status)=>{
    expect(assess(text)).toEqual([{kind,status,matchedName:'João Exemplo',excerpt:text}]);
  });
  it('mantém relato histórico sem inventar estado atual, data ou trânsito',()=>{
    const result=assess('Denúncia recebida em 2010. JOÃO DE EXEMPLO TESTE foi condenado em 2015.');
    expect(result).toEqual([{kind:'CONVICTION',status:'REPORTED',matchedName:person.nomeCivil,excerpt:'JOÃO DE EXEMPLO TESTE foi condenado em 2015.'}]);
  });
  it('não conecta nome do título ao sujeito sem nome no corpo',()=>{
    expect(assess('O acusado foi condenado.','João Exemplo apresenta defesa')).toEqual([]);
  });
  it('reconhece presente passivo e cargo licenciado no relato oficial',()=>{
    expect(assess('O Plenário do Supremo Tribunal Federal (STF) condenou, por maioria de votos, a deputada federal licenciada João Exemplo (PL-SP) pelos crimes de corrupção.')).toHaveLength(1);
    expect(assess('', 'Deputada João Exemplo é condenada pelo STF por corrupção.')).toHaveLength(1);
  });
  it('reconhece rejeição efetiva de recursos contra condenação nominal',()=>{
    expect(assess('A Primeira Turma do Supremo Tribunal Federal (STF) rejeitou recursos (embargos de declaração) do deputado federal João Exemplo (PL-SP) contra a condenação por corrupção.')).toHaveLength(1);
    expect(assess('O STF analisará recursos do deputado João Exemplo contra a condenação.')).toEqual([]);
  });
  it.each(['1ª','2ª'])('reconhece ordinal oficial %s Turma com atribuição nominal',ordinal=>{
    expect(assess(`A ${ordinal} Turma do Supremo Tribunal Federal (STF) condenou o deputado João Exemplo por corrupção.`)).toHaveLength(1);
  });
  it('reconhece atualização nominal com introdução temporal oficial',()=>{
    expect(assess('Na sessão desta terça-feira (17), a Segunda Turma do Supremo Tribunal Federal (STF) acolheu recursos do ex-deputado federal João Exemplo e do engenheiro Pedro Outro contra as penas aplicadas pelo Supremo por crimes.')).toHaveLength(1);
    expect(assess('Na sessão desta terça-feira (17), o STF analisará recursos do deputado João Exemplo contra as penas.')).toEqual([]);
  });
  it('não transfere decisão entre pessoas na mesma notícia',()=>{
    expect(assess('João Exemplo foi denunciado. Pedro Outro foi condenado e preso.')).toEqual([]);
    expect(assess('João Exemplo foi condenado. Pedro Outro foi preso.').map(item=>item.kind)).toEqual(['CONVICTION']);
  });
  it('recusa regressões da notícia de Lei Seca e de recebimento de denúncia no lote oficial',()=>{
    expect(assess('O deputado João Exemplo encerrou sua exposição mostrando uma reportagem sobre um cidadão dos Estados Unidos. O norte-americano também foi condenado a 90 dias de prisão.')).toEqual([]);
    expect(assess('A Primeira Turma do Supremo Tribunal Federal (STF) recebeu denúncia contra o deputado federal João Exemplo pelo crime de peculato. A pena varia de dois a 12 anos de reclusão, mais multa.')).toEqual([]);
  });
});
