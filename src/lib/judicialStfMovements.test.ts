import {createHash} from 'node:crypto';
import {describe,expect,it,vi} from 'vitest';
import {createStfMovementReconciler} from './judicialStfMovements';

const person={id:'1',nome:'Paulinho da Força',nomeCivil:'Paulo Pereira da Silva'};
const lookup='<input id="classe-numero-processo" value="AP 965"><input id="incidente" value="4877924"><div>Número Único: 0002711-11.2008.1.00.0000</div>';
const decision='Decisão: A Turma, por maioria, acolheu os embargos de declaração, com efeitos infringentes, para julgar improcedente a ação penal promovida contra Paulo Pereira da Silva e absolvê-lo da prática dos crimes previstos no art. 20, da Lei 7.492/86. De ofício, por unanimidade, a Turma declarou extinta a sua punibilidade em relação ao crime de quadrilha pela prescrição da pretensão punitiva.';
const movement=(text=decision,date='25/03/2024',judge='1ª TURMA - SESSÃO VIRTUAL',title='Embargos recebidos')=>`<li><div class="andamento-item"><div class="andamento-data">${date}</div><h5 class="andamento-nome">${title}</h5><span class="andamento-julgador">${judge}</span><div class="col-md-9 p-0">${text}</div></div></li>`;
function setup(body:string,detail=lookup){
  const fetcher=vi.fn(async(input:RequestInfo|URL)=>new Response(String(input).includes('abaAndamentos')?body:detail,{headers:{'content-type':'text/html'}}));
  const reconcile=createStfMovementReconciler({fetcher,intervalMs:1,attempts:1});
  return {fetcher,reconcile};
}
const signal=new AbortController().signal;
describe('reconciliação nominal e dispositiva dos andamentos do STF',()=>{
  it('comprova reversão integral com hash dos documentos e trecho, sem confundir andamento e data do fato',async()=>{
    const body=`<div class="processo-andamentos"><ul>${movement('Certidão de trânsito em julgado em 11/06/2024.','14/06/2024','','Transitado(a) em julgado')}${movement()}</ul></div>`;
    const {reconcile,fetcher}=setup(body);
    const result=await reconcile(person,'AP 965',signal);
    expect(result).toMatchObject({caseNumber:'AP 965',incidentId:'4877924',convictionStatus:'OVERTURNED',movementDate:'2024-03-25',finalityDate:'2024-06-11',eventEvidence:decision,snapshotHash:createHash('sha256').update(body).digest('hex')});
    expect(result).not.toHaveProperty('eventDate');
    expect(fetcher.mock.calls.map(([url])=>String(url))).toEqual(['https://portal.stf.jus.br/processos/listarProcessos.asp?classe=AP&numeroProcesso=965','https://portal.stf.jus.br/processos/abaAndamentos.asp?incidente=4877924&imprimir=']);
    expect((await reconcile(person,'AP 965',signal))?.snapshotHash).toBe(result?.snapshotHash);
  });
  it.each([
    decision.replace('Paulo Pereira da Silva','Paulo Pereira da Silveira'),
    decision.replace('improcedente','parcialmente improcedente'),
    decision.replace('A Turma, por maioria, acolheu','Após o voto do Ministro, que acolhia'),
    decision.replace('A Turma, por maioria, acolheu','A defesa pediu à Turma que acolhesse'),
    decision.replace('A Turma, por maioria, acolheu','A Turma poderá acolher'),
    decision.replace('e absolvê-lo','e absolvê-lo parcialmente'),
    decision.replace('A Turma, por maioria, acolheu','A Turma, por maioria, não acolheu'),
    decision+' Foi mantida a condenação por outro delito.',
  ])('recusa atribuição não comprovada: %s',async(text)=>{
    expect(await setup(`<div class="processo-andamentos">${movement(text)}</div>`).reconcile(person,'AP 965',signal)).toBeNull();
  });
  it('recusa voto individual mesmo com fórmula colegiada citada',async()=>{
    expect(await setup(`<div class="processo-andamentos">${movement(decision,undefined,'MIN. EXEMPLO')}</div>`).reconcile(person,'AP 965',signal)).toBeNull();
  });
  it('falha fechada para segredo, estrutura alterada e lookup diferente',async()=>{
    for(const body of ['Segredo de justiça',`<article>${decision}</article>`])expect(await setup(body).reconcile(person,'AP 965',signal)).toBeNull();
    for(const detail of [lookup.replace('AP 965','AP 966'),lookup+'<p>Segredo de justiça</p>',lookup.replace('4877924','invalido')])expect(await setup(`<div class="processo-andamentos">${movement()}</div>`,detail).reconcile(person,'AP 965',signal)).toBeNull();
  });
  it('mantém último dispositivo comprovado quando movimentação administrativa posterior é incompreensível',async()=>{
    const body=`<div class="processo-andamentos">${movement('Texto administrativo desconhecido','06/02/2025','','Baixa ao arquivo')}${movement()}</div>`;
    expect(await setup(body).reconcile(person,'AP 965',signal)).toMatchObject({convictionStatus:'OVERTURNED'});
  });
  it('ignora placeholder de decisão sigilosa sem descartar dispositivo público anterior',async()=>{
    const body=`<div class="processo-andamentos">${movement('','01/01/2025','','Decisão (segredo de justiça)')}${movement()}</div>`;
    expect(await setup(body).reconcile(person,'AP 965',signal)).toMatchObject({convictionStatus:'OVERTURNED'});
    expect(await setup(`<div class="processo-andamentos">${movement(decision,undefined,undefined,'Decisão (segredo de justiça)')}</div>`).reconcile(person,'AP 965',signal)).toBeNull();
    expect(await setup(`<div class="processo-andamentos">${movement()}</div>`,lookup+'<span class="badge bg-warning">Segredo de Justiça</span>').reconcile(person,'AP 965',signal)).toMatchObject({convictionStatus:'OVERTURNED'});
  });
  it('não aplica absolvição antiga diante de novo dispositivo condenatório',async()=>{
    const later='Decisão: A Turma, por unanimidade, julgou procedente a ação penal e condenou Paulo Pereira da Silva.';
    const body=`<div class="processo-andamentos">${movement(later,'01/01/2025')}${movement()}</div>`;
    expect(await setup(body).reconcile(person,'AP 965',signal)).toBeNull();
  });
  it('não consulta outras classes, número ambíguo ou nome civil ausente',async()=>{
    const {reconcile,fetcher}=setup('');
    for(const number of ['965','INQ 965','AP 965 e AP 966'])expect(await reconcile(person,number,signal)).toBeNull();
    expect(await reconcile({...person,nomeCivil:null},'AP 965',signal)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('aceita andamento de 9,6 MB como a AP 1044 sem descartar o dispositivo público',async()=>{
    const body=`<div class="processo-andamentos">${movement()}</div><!--${'x'.repeat(9_611_361)}-->`;
    expect(await setup(body).reconcile(person,'AP 965',signal)).toMatchObject({convictionStatus:'OVERTURNED'});
  });
  it('mantém limite finito de 16 MiB e propaga erro sem tratar ausência de coleta como resultado',async()=>{
    await expect(setup('x'.repeat(16*1024*1024+1)).reconcile(person,'AP 965',signal)).rejects.toThrow(/limite de tamanho/);
  });
});
