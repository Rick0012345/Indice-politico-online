import {describe,expect,it} from 'vitest';
import {validateJudicialRecord, summarizeJudicial, validateCoverage, officialSource} from './judicialRules';
import type {JudicialAdminRecord, JudicialRecordInput} from './judicialTypes';
export const recordFixture = (changes: Partial<JudicialRecordInput> = {}): JudicialRecordInput => ({
  kind:'CONVICTION',category:'CRIMINAL',caseNumber:'0001-23.2025',court:'Tribunal de teste',title:'Registro fictício',
  description:'Exclusivo de teste',eventDate:'2025-01-01',convictionStatus:'FINAL',finalityDate:'2025-02-01',
  custodyType:null,custodyConfirmed:false,releasedAt:null,grounds:'Fundamento fictício',outcome:'Definitiva',
  sourceUrl:'https://www.stf.jus.br/processo/123',sourceLabel:'Fonte oficial',verification:'VERIFIED',
  identityEvidence:'Documento oficial confirma identidade por identificador e cargo',reviewNote:'Revisão de teste',...changes,
});
const saved=(changes:Partial<JudicialAdminRecord>={}):JudicialAdminRecord=>({...recordFixture(),id:'123',politicoId:'1',version:1,checkedAt:'2025-02-01T00:00:00Z',updatedAt:'2025-02-01T00:00:00Z',...changes});
describe('regras judiciais',()=>{
  it('distingue desconhecido de pesquisa sem registros',()=>{
    expect(summarizeJudicial([],null).finalConvictions).toBeNull();
    expect(summarizeJudicial([],validateCoverage({status:'REVIEWED',scope:'Consulta de teste',sources:[{label:'STF',url:'https://stf.jus.br'}]})).finalConvictions).toBe(0);
  });
  it('conta somente verificadas, definitivas e categorias separadas',()=>{
    const summary=summarizeJudicial([saved(),saved({id:'2',caseNumber:'2',convictionStatus:'ANNULLED'}),saved({id:'3',caseNumber:'3',category:'ELECTORAL'}),saved({id:'4',verification:'DRAFT'})],null);
    expect(summary.finalConvictions).toBe(1);expect(summary.counts.ELECTORAL.final).toBe(1);expect(summary.coverage.status).toBe('PARTIAL');
  });
  it('rejeita fontes falsas, credenciais e portas não HTTPS',()=>{
    for(const url of ['https://stf.jus.br.evil.com','http://stf.jus.br','https://user:pass@stf.jus.br','https://stf.jus.br:8443']) expect(()=>officialSource(url)).toThrow();
  });
  it('exige identidade, trânsito válido e confirmação de prisão',()=>{
    for(const delta of [{identityEvidence:''},{finalityDate:null},{eventDate:'2025-02-30'},{finalityDate:'2024-01-01'},{eventDate:'2099-01-01'}, {kind:'IMPRISONMENT',convictionStatus:null,finalityDate:null,custodyType:'PREVENTIVE',custodyConfirmed:false}] as Partial<JudicialRecordInput>[]) expect(()=>validateJudicialRecord(recordFixture(delta))).toThrow();
    expect(validateJudicialRecord(recordFixture()).verification).toBe('VERIFIED');
  });
  it('não publica observação privada na cobertura',()=>{
    expect(()=>validateCoverage({status:'REVIEWED',scope:'',sources:[]})).toThrow();
  });
});
