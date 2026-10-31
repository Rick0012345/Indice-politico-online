import {describe,it,expect} from 'vitest';
import {anchorsFromOfficialNews} from './judicialProceedingsIdentity';
const person={id:'1',nome:'João Exemplo',nomeCivil:'João de Exemplo Silva'};
const doc=(text:string,url='https://noticias.stf.jus.br/postsnoticias/exemplo/')=>({text,url});
describe('âncoras processuais em notícias oficiais',()=>{
 it('identifica vínculo com o processo sem transformar denúncia em condenação',()=>{
  const text='O STF recebeu denúncia na Ação Penal (AP) 123 contra o deputado federal João Exemplo por fato descrito na acusação.';
  expect(anchorsFromOfficialNews(doc(text),person)).toEqual([{court:'STF',caseNumber:'AP 123',sourceUrl:doc('').url,excerpt:text}]);
 });
 it('exige contexto nominal parlamentar no mesmo parágrafo e um caso inequívoco',()=>{
  expect(anchorsFromOfficialNews(doc('O deputado João Exemplo comentou a notícia.\nO julgamento ocorreu na AP 123.'),person)).toEqual([]);
  expect(anchorsFromOfficialNews(doc('A AP 123 menciona João Exemplo, advogado.'),person)).toEqual([]);
  expect(anchorsFromOfficialNews(doc('O deputado João Exemplo falou da AP 123 e da AP 456 envolvendo outras pessoas.'),person)).toEqual([]);
 });
 it('não aceita nome parcial nem fonte externa',()=>{
  expect(anchorsFromOfficialNews(doc('O deputado federal João Exemplo Junior é réu na AP 123.'),person)).toEqual([]);
  expect(anchorsFromOfficialNews(doc('O deputado João Exemplo é réu na AP 123.','https://exemplo.com/noticia'),person)).toEqual([]);
  expect(anchorsFromOfficialNews(doc('O deputado João Exemplo apresentou solidariedade a Pedro Silva, condenado na AP 123.'),person)).toEqual([]);
  expect(anchorsFromOfficialNews(doc('O deputado João Exemplo comentou o julgamento de Pedro Silva na AP 123.'),person)).toEqual([]);
 });
 it('aceita somente relação direta antes ou depois da referência processual',()=>{
  expect(anchorsFromOfficialNews(doc('O deputado federal João Exemplo é réu na Ação Penal (AP) 123.'),person)).toMatchObject([{caseNumber:'AP 123'}]);
  expect(anchorsFromOfficialNews(doc('O Inquérito (Inq) 456 foi instaurado contra o ex-deputado João Exemplo.'),person)).toMatchObject([{caseNumber:'Inq 456'}]);
 });
 it('reconhece qualificação depois do nome civil e deduplica o mesmo caso',()=>{
  const text='João de Exemplo Silva, ex-deputado federal, figura no Inquérito (Inq) 456. O Inq 456 está em andamento.';
  expect(anchorsFromOfficialNews(doc(text),person)).toMatchObject([{caseNumber:'Inq 456'}]);
 });
});
