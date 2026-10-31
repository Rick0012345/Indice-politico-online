// @vitest-environment node
import {describe,expect,it} from 'vitest';
import {extractJudicialFacts} from './judicialAutoExtract';
import type {JudicialSourceDocument} from './judicialIngestionTypes';
const person={id:'1',nome:'Carla Zambelli',nomeCivil:'Carla Zambelli Salgado'};
const doc=(text:string,title='Notícia do STF'):JudicialSourceDocument=>({sourceId:'STF_NEWS',sourceKey:'1',url:'https://noticias.stf.jus.br/postsnoticias/teste/',title,text:`${text}\nO tribunal responsável pelo processo é o Supremo Tribunal Federal (STF).`,publishedAt:'2025-08-25T10:00:00Z',modifiedAt:null,contentHash:'hash',raw:null,matchedNames:[],signals:[]});
describe('extração judicial automática conservadora',()=>{
  it('extrai processo formal e motivo de condenação atribuída, sem inventar data ou trânsito',()=>{
    const result=extractJudicialFacts(doc('O Plenário do Supremo Tribunal Federal (STF) condenou, por maioria de votos, a deputada federal licenciada Carla Zambelli (PL-SP) pelos crimes de porte ilegal de arma de fogo e constrangimento ilegal.\nO colegiado seguiu o relator na Ação Penal (AP) 2415.'),person);
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]).toMatchObject({caseNumber:'AP 2415',court:'STF',category:'CRIMINAL',convictionStatus:'UNKNOWN',eventDate:null,finalityDate:null,custodyConfirmed:false,grounds:expect.stringContaining('porte ilegal')});
    expect(result.facts[0].eventEvidence).toContain('Carla Zambelli');
    expect(result.facts[0].caseEvidence).toContain('(AP) 2415');
  });
  it('aceita título com é condenada, mas não converte pena em prisão cumprida',()=>{
    const result=extractJudicialFacts(doc('O julgamento ocorreu na AP1044. A pena foi de dez anos de prisão.','Deputada Carla Zambelli é condenada pelo STF por corrupção'),person);
    expect(result.facts.map(f=>f.kind)).toEqual(['CONVICTION']);
  });
  it('deduplica títulos e corpo do mesmo processo e evento',()=>{
    const result=extractJudicialFacts(doc('A deputada Carla Zambelli foi condenada na AP 1044 por corrupção.','Deputada Carla Zambelli é condenada pelo STF por corrupção'),person);
    expect(result.facts).toHaveLength(1);
  });
  it('só usa datas completas explicitamente ligadas ao evento',()=>{
    expect(extractJudicialFacts(doc('A deputada Carla Zambelli foi condenada em 22 de agosto de 2025 por corrupção na AP 1044.'),person).facts[0]?.eventDate).toBe('2025-08-22');
    expect(extractJudicialFacts(doc('A deputada Carla Zambelli foi condenada por crime cometido em 22/08/2022 na AP 1044.'),person).facts[0]?.eventDate).toBeNull();
  });
  it('não considera trânsito futuro ou negado como definitivo',()=>{
    for(const suffix of ['A perda do mandato ocorrerá após o trânsito em julgado.','A decisão ainda não transitou em julgado.']){
      expect(extractJudicialFacts(doc(`A deputada Carla Zambelli foi condenada na AP 1044 por corrupção. ${suffix}`),person).facts[0]?.convictionStatus).toBe('UNKNOWN');
    }
  });
  it('registra trânsito explícito sem inventar sua data',()=>{
    expect(extractJudicialFacts(doc('A deputada Carla Zambelli foi condenada na AP 1044 por corrupção. O colegiado declarou o trânsito em julgado da decisão.'),person).facts[0]).toMatchObject({convictionStatus:'FINAL',finalityDate:null});
  });
  it('registra recursos rejeitados e trânsito do mesmo processo, inclusive data expressa',()=>{
    const result=extractJudicialFacts(doc('A Primeira Turma do Supremo Tribunal Federal (STF) rejeitou recursos (embargos de declaração) da deputada federal Carla Zambelli (PL-SP) e do hacker Walter Delgatti Neto contra a condenação pela invasão de sistemas. O colegiado declarou o trânsito em julgado da decisão em 6 de junho de 2025. Os embargos foram apresentados na Ação Penal (AP) 2428.'),person);
    expect(result.facts[0]).toMatchObject({caseNumber:'AP 2428',convictionStatus:'FINAL',finalityDate:'2025-06-06'});
  });
  it('não usa data de outro acontecimento como data do trânsito',()=>{
    expect(extractJudicialFacts(doc('A deputada Carla Zambelli foi condenada na AP1044. O colegiado declarou o trânsito em julgado da decisão relativa ao crime de 20/01/2020.'),person).facts[0]?.finalityDate).toBeNull();
  });
  it('aceita trânsito declarado mesmo quando a frase explica que não cabe mais recurso',()=>{
    expect(extractJudicialFacts(doc('A deputada Carla Zambelli foi condenada na AP1044. Pelo caráter protelatório, a Turma declarou o trânsito em julgado da decisão, que não pode mais ser objeto de recursos.'),person).facts[0]?.convictionStatus).toBe('FINAL');
  });
  it('negação de recurso cabível não produz status sujeito a recurso',()=>{
    expect(extractJudicialFacts(doc('A deputada Carla Zambelli foi condenada na AP1044. Não cabe recurso desta decisão.'),person).facts[0]?.convictionStatus).toBe('UNKNOWN');
  });
  it('normaliza número CNJ sem inventar o tipo do procedimento',()=>{
    expect(extractJudicialFacts(doc('A deputada Carla Zambelli foi condenada no processo 1234567-89.2020.8.26.0001 por corrupção.'),person).facts[0]?.caseNumber).toBe('1234567-89.2020.8.26.0001');
  });
  it('usa cargo e nome nominal juntos no mesmo documento para identificar prisão histórica',()=>{
    expect(extractJudicialFacts(doc('O deputado federal Carla Zambelli apresentou recurso. Carla Zambelli foi presa em flagrante por ameaças no Inquérito (INQ) 4781.'),person).facts[0]).toMatchObject({caseNumber:'INQ 4781',kind:'IMPRISONMENT',custodyType:'FLAGRANT'});
    expect(extractJudicialFacts(doc('O deputado Pedro Outro apresentou recurso. Carla Zambelli foi presa na AP1044.'),person).facts).toEqual([]);
  });
  it('reconhece execução penal, petição criminal e separa condenação cível',()=>{
    expect(extractJudicialFacts(doc('A deputada Carla Zambelli foi presa em cumprimento de pena na Execução Penal (EP) 150.'),person).facts[0]?.caseNumber).toBe('EP 150');
    expect(extractJudicialFacts(doc('A deputada Carla Zambelli foi condenada por peculato na Petição (PET) 1234.'),person).facts[0]?.caseNumber).toBe('PET 1234');
    expect(extractJudicialFacts(doc('A deputada Carla Zambelli foi condenada a pagar indenização cível na PET 1234.'),person).facts).toEqual([]);
    expect(extractJudicialFacts(doc('A deputada Carla Zambelli foi condenada por improbidade administrativa na PET 1234.'),person).facts[0]?.category).toBe('IMPROBITY');
  });
  it('não empresta trânsito em julgado atribuído explicitamente a terceiro',()=>{
    expect(extractJudicialFacts(doc('A deputada Carla Zambelli foi condenada na AP1044. O colegiado declarou o trânsito em julgado da condenação de Pedro Outro.'),person).facts[0]?.convictionStatus).toBe('UNKNOWN');
  });
  it('mantém estado desconhecido quando trânsito genérico segue outra pessoa condenada',()=>{
    expect(extractJudicialFacts(doc('A deputada Carla Zambelli foi condenada na AP1044. Pedro Outro foi condenado por corrupção. O colegiado declarou o trânsito em julgado da decisão.'),person).facts[0]?.convictionStatus).toBe('UNKNOWN');
  });
  it('não transforma referência de execução em nova condenação',()=>{
    expect(extractJudicialFacts(doc('O ex-deputado Carla Zambelli passou ao regime semiaberto. Carla Zambelli foi condenada em abril de 2022 por crimes de ameaça. A decisão foi proferida na Execução Penal (EP) 32.'),person).facts).toEqual([]);
  });
  it('considera plural de inquéritos para preservar ambiguidade do histórico',()=>{
    expect(extractJudicialFacts(doc('O deputado Carla Zambelli teve cautelares substituídas na Ação Penal (AP) 1044. Carla Zambelli foi presa em flagrante em fevereiro. Há investigados nos Inquéritos (INQs) 4781 e 4874.'),person).facts).toEqual([]);
  });
  it('revogação de prisão não anula condenação',()=>{
    expect(extractJudicialFacts(doc('A deputada Carla Zambelli foi condenada na AP 1044 por corrupção. O STF revogou a prisão preventiva.'),person).facts[0]?.convictionStatus).toBe('UNKNOWN');
  });
  it('exige caso identificável, identidade funcional e fonte oficial',()=>{
    expect(extractJudicialFacts(doc('A deputada Carla Zambelli foi condenada por corrupção.'),person).facts).toEqual([]);
    expect(extractJudicialFacts(doc('Carla Zambelli foi condenada na AP1044.'),person).facts).toEqual([]);
    expect(extractJudicialFacts({...doc('A deputada Carla Zambelli foi condenada na AP1044.'),url:'https://noticias.stf.jus.br.exemplo.com/falso'},person).facts).toEqual([]);
  });
  it.each([
    'A deputada Carla Zambelli não foi condenada na AP 1044.',
    'A deputada Carla Zambelli será condenada na AP 1044.',
    'O irmão da deputada Carla Zambelli foi condenado na AP 1044.',
    'Foi expedido mandado de prisão contra a deputada Carla Zambelli na AP 1044.',
    'A deputada Carla Zambelli foi denunciada na AP 1044. Pedro Outro foi condenado.',
    'A deputada Carla Zambelli foi condenada. O STF condenou o deputado Pedro Outro na AP 1044.',
    'A deputada Carla Zambelli foi condenada. O processo AP 1044 e o processo AP 1050 foram julgados.',
  ])('não publica atribuição ambígua: %s',text=>{expect(extractJudicialFacts(doc(text),person).facts).toEqual([]);});
  it('seleciona o processo na própria evidência mesmo havendo outros',()=>{
    expect(extractJudicialFacts(doc('A deputada Carla Zambelli foi condenada na AP 1044 por corrupção. O deputado Pedro Outro foi condenado na AP 1050.'),person).facts[0]?.caseNumber).toBe('AP 1044');
  });
  it('mantém anulação explícita e prisão efetiva separadas',()=>{
    expect(extractJudicialFacts(doc('A deputada Carla Zambelli teve sua condenação anulada na AP1044.'),person).facts[0]?.convictionStatus).toBe('ANNULLED');
    expect(extractJudicialFacts(doc('A deputada Carla Zambelli foi presa em 05/06/2025 na AP1044.'),person).facts[0]).toMatchObject({kind:'IMPRISONMENT',custodyConfirmed:true,custodyType:'UNKNOWN',eventDate:'2025-06-05'});
  });
  it('não atribui ao STF condenação que a própria notícia atribui a outro tribunal',()=>{
    const result=extractJudicialFacts(doc('A deputada Carla Zambelli foi condenada pelo Tribunal de Justiça de São Paulo no processo 1234567-89.2020.8.26.0001 por corrupção.'),person);
    expect(result.facts).toEqual([]);
    expect(result.issues.length).toBeGreaterThan(0);
  });
  it('exige atribuição de tribunal no texto e não presume pelo domínio oficial',()=>{
    const text='A deputada Carla Zambelli foi condenada na AP1044 por corrupção.';
    expect(extractJudicialFacts({...doc(text),text},person).facts).toEqual([]);
  });
  it('não transforma manutenção no STJ em condenação originária do STJ',()=>{
    expect(extractJudicialFacts({...doc('O STJ manteve a condenação da deputada Carla Zambelli proferida pelo Tribunal de Justiça de São Paulo na AP1044.'),sourceId:'STJ_NEWS',url:'https://www.stj.jus.br/noticia'},person).facts).toEqual([]);
  });
  it.each([
    'O STF recebeu recurso de Pedro Outro na AP 1044.',
    'Pedro Outro apresentou recurso na AP 1044 ao STF.',
    'Pedro Outro recorreu na AP 1044 ao STF.',
    'O STF recebeu recurso apresentado por Pedro Outro na AP 1044.',
    'O STF analisou a ação contra Pedro Outro na AP 1044.',
    'O STF recebeu denúncia contra Pedro Outro na AP 1044.',
    'O STF analisou recurso em nome de Pedro Outro na AP 1044.',
  ])('não empresta processo de outro participante processual: %s',caseText=>{
    const result=extractJudicialFacts(doc(`A deputada Carla Zambelli foi condenada por corrupção. ${caseText}`),person);
    expect(result.facts).toEqual([]);
    expect(result.issues).toContain('O processo identifica participante distinto da pessoa pesquisada.');
  });
  it('preserva relator nomeado como autoridade e recurso do próprio alvo',()=>{
    expect(extractJudicialFacts(doc('A deputada Carla Zambelli foi condenada por corrupção. O colegiado seguiu o relator, ministro Gilmar Mendes, na Ação Penal (AP) 2415.'),person).facts[0]?.caseNumber).toBe('AP 2415');
    expect(extractJudicialFacts(doc('A deputada Carla Zambelli foi condenada por corrupção. Carla Zambelli apresentou recurso na AP 2415 ao STF.'),person).facts[0]?.caseNumber).toBe('AP 2415');
  });
  it.each(['condenação do deputado Pedro Outro','sentença da ex-deputada Maria Outra','decisão de Pedro Outro','condenação definitiva do deputado Pedro Outro'])(
    'não empresta trânsito de terceiro com cargo: %s',decision=>{
      const result=extractJudicialFacts(doc(`A deputada Carla Zambelli foi condenada pelo STF na AP1044 por corrupção. O colegiado declarou o trânsito em julgado da ${decision}.`),person);
      expect(result.facts[0]).toMatchObject({convictionStatus:'UNKNOWN',finalityDate:null});
    });
  it('mantém data ligada ao mesmo trecho que comprovou trânsito da pessoa',()=>{
    const result=extractJudicialFacts(doc('A deputada Carla Zambelli foi condenada pelo STF na AP1044 por corrupção. O colegiado declarou o trânsito em julgado da decisão. O colegiado declarou o trânsito em julgado da condenação do deputado Pedro Outro em 05/06/2025.'),person);
    expect(result.facts[0]).toMatchObject({convictionStatus:'FINAL',finalityDate:null});
  });
  it('não transfere categoria de outra ação mencionada no documento',()=>{
    const result=extractJudicialFacts(doc('A deputada Carla Zambelli foi condenada pelo STF na AP1044 por corrupção. O tribunal julgou outra ação por improbidade de Pedro Outro.'),person);
    expect(result.facts[0]?.category).toBe('CRIMINAL');
  });
  it('atualiza AP1002 com desclassificação e prescrição, mantendo apenas motivo remanescente explícito',()=>{
    const result=extractJudicialFacts(doc('A Segunda Turma do Supremo Tribunal Federal (STF) acolheu recursos do ex-deputado federal Aníbal Gomes e do engenheiro Luiz Carlos Batista Sá contra as penas aplicadas pelo Supremo por crimes praticados no âmbito da operação Lava Jato.\nEm junho de 2020, a Segunda Turma julgou a Ação Penal (AP) 1002 e condenou o ex-parlamentar pelos crimes de corrupção passiva e lavagem de dinheiro.\nA pena definitiva de Aníbal por tráfico de influência foi fixada em dois anos e quatro meses de reclusão. Tendo em vista o prazo superior a oito anos, foi declarada a prescrição. Permanece a pena de cinco anos e dez meses de reclusão pelo crime lavagem de dinheiro, a ser cumprida em regime inicialmente semi-aberto.'),{id:'2',nome:'Aníbal Gomes',nomeCivil:null});
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]).toMatchObject({caseNumber:'AP 1002',grounds:'lavagem de dinheiro',convictionStatus:'UNKNOWN',outcome:expect.stringContaining('prescrição')});
    expect(result.facts[0].supportingEvidence?.some(excerpt=>excerpt.includes('Permanece a pena'))).toBe(true);
    expect(result.facts[0].eventEvidence).not.toContain('\n');
  });
  it('extrai suspensão dos efeitos da condenação AP965 sem tratar como anulação',()=>{
    const result=extractJudicialFacts(doc('Por unanimidade, a Primeira Turma do Supremo Tribunal Federal (STF) suspendeu os efeitos da condenação do deputado federal Paulinho da Força (Solidariedade-SP) na Ação Penal (AP) 965, entre eles a inelegibilidade.\nNa AP 965, Paulinho da Força foi condenado pela Primeira Turma do STF em junho de 2020, por crime contra o Sistema Financeiro Nacional, lavagem de dinheiro e associação criminosa.'),{id:'3',nome:'Paulinho da Força',nomeCivil:'Paulo Pereira da Silva'});
    expect(result.facts[0]).toMatchObject({caseNumber:'AP 965',convictionStatus:'SUSPENDED',grounds:expect.stringContaining('Sistema Financeiro Nacional')});
  });
  it('emite indulto das penas em dois APs explícitos, preservando demais efeitos da condenação',()=>{
    const result=extractJudicialFacts(doc('O ministro Edson Fachin, do Supremo Tribunal Federal (STF), declarou extintas as penas privativas de liberdade impostas ao ex-deputado Paulo Maluf nas Ações Penais (APS) 863 e 968. O indulto abrange apenas as penas privativas de liberdade, ficando mantidos os demais efeitos da condenação.\nNa AP 863, Maluf foi condenado, por lavagem de dinheiro, a sete anos de reclusão. Na AP 968, a sentença foi de dois anos, pela prática do crime de falsidade ideológica para fins eleitorais.'),{id:'4',nome:'PAULO MALUF',nomeCivil:'Paulo Salim Maluf'});
    expect(result.facts.map(f=>f.caseNumber)).toEqual(['AP 863','AP 968']);
    expect(result.facts[0]).toMatchObject({convictionStatus:'UNKNOWN',grounds:'lavagem de dinheiro',outcome:expect.stringContaining('mantidos os demais efeitos')});
    expect(result.facts[1].grounds).toContain('falsidade ideológica');
  });
  it.each([
    'O STF analisará pedido de suspensão dos efeitos da condenação do deputado Paulinho da Força na AP965.',
    'O STF negou indulto ao deputado Paulo Maluf na AP863.',
    'O STF recebeu recursos do deputado Aníbal Gomes na AP1002.',
    'O STF suspendeu os efeitos da condenação do deputado Pedro Outro na AP965.',
  ])('não fabrica atualização favorável apenas por pedido ou referência a terceiro: %s',text=>{
    expect(extractJudicialFacts(doc(text),{id:'3',nome:'Paulinho da Força',nomeCivil:'Paulo Pereira da Silva'}).facts).toEqual([]);
  });
  it('mantém remanescente quando anulação é só de um crime da mesma ação',()=>{
    const result=extractJudicialFacts(doc('O Plenário do Supremo Tribunal Federal (STF) anulou a condenação do deputado federal Roberto Góes (PDT-AP) pelo crime de peculato. A decisão foi tomada na Ação Penal (AP) 916. Foi mantida, contudo, a condenação pelo delito de assunção de obrigação, decorrente da não quitação das obrigações com o banco.'),{id:'5',nome:'Roberto Góes',nomeCivil:null});
    expect(result.facts[0]).toMatchObject({caseNumber:'AP 916',convictionStatus:'UNKNOWN',grounds:'assunção de obrigação',outcome:expect.stringContaining('Foi mantida')});
  });
  it('registra prescrição remanescente da AP916 sem presumir anulação integral',()=>{
    const result=extractJudicialFacts(doc('Com base na prescrição da pretensão punitiva do Estado, o ministro Alexandre de Moraes, do Supremo Tribunal Federal (STF), declarou extinta a punibilidade do ex-deputado federal Roberto Góes (AP), condenado a um ano de reclusão pelo crime de assunção de obrigação no último ano do mandato. A decisão se deu nos autos da Ação Penal (AP) 916.'),{id:'5',nome:'Roberto Góes',nomeCivil:null});
    expect(result.facts[0]).toMatchObject({caseNumber:'AP 916',convictionStatus:'PRESCRIBED',grounds:expect.stringContaining('assunção de obrigação'),outcome:expect.stringContaining('prescrição')});
  });
  it('reconhece cumprimento determinado sem presumir execução física e trânsito expresso com data própria',()=>{
    const result=extractJudicialFacts(doc('O ministro Alexandre de Moraes, do Supremo Tribunal Federal (STF), determinou o início do cumprimento da pena imposta ao ex-deputado federal Daniel Silveira. Em 20 de abril de 2022, Silveira foi condenado, na Ação Penal (AP) 1044, pelos crimes de ameaça ao Estado Democrático de Direito e coação no curso do processo. Em sua decisão, o relator observou que a condenação se tornou definitiva (transitou em julgado) em 9/8/2022, não havendo mais possibilidade de recurso.'),{id:'6',nome:'Daniel Silveira',nomeCivil:null});
    expect(result.facts[0]).toMatchObject({caseNumber:'AP 1044',kind:'CONVICTION',convictionStatus:'FINAL',finalityDate:'2022-08-09',custodyConfirmed:false});
    expect(result.facts).toHaveLength(1);
  });
  it.each([
    'Permanece a pena de cinco anos pelo crime de lavagem de dinheiro na AP 1050.',
    'Permanece a pena de cinco anos pelo crime de lavagem de dinheiro.',
  ])('não transfere pena remanescente de outro processo ou sem vínculo em documento com múltiplos casos: %s',remaining=>{
    const result=extractJudicialFacts(doc(`O STF acolheu recursos da deputada Carla Zambelli contra as penas na AP 1044. No outro processo, Pedro Outro responde na AP 1050. ${remaining}`),person);
    expect(result.facts[0]).toMatchObject({caseNumber:'AP 1044',grounds:''});
    expect(result.facts[0].supportingEvidence).toEqual([]);
    expect(result.facts[0].description).not.toContain('lavagem de dinheiro');
    expect(result.facts[0].outcome).not.toContain('lavagem de dinheiro');
  });
});
