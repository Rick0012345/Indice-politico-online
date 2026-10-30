// @vitest-environment node
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Pool, type PoolClient} from 'pg';
import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';
import {upsertExpenseBatch, type Expense} from './expensePersistence';

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('lotes de despesas no PostgreSQL isolado', () => {
  const pool = new Pool({connectionString: url});
  const schema = `expense_test_${randomUUID().replaceAll('-', '')}`;
  let client: PoolClient;
  beforeAll(async () => {
    client = await pool.connect();
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(`CREATE TABLE despesas (
      id bigserial PRIMARY KEY, politico_id bigint NOT NULL, ano smallint NOT NULL, mes smallint NOT NULL,
      tipo_despesa varchar(255) NOT NULL, cod_documento varchar(100) UNIQUE,
      cnpj_cpf_fornecedor varchar(14), nome_fornecedor varchar(255), tipo_documento varchar(50),
      data_documento date, num_documento varchar(100), valor_documento numeric(12,2) NOT NULL,
      valor_glosa numeric(12,2) DEFAULT 0, valor_liquido numeric(12,2) NOT NULL,
      num_lote varchar(50), num_ressarcimento varchar(50), parcela smallint DEFAULT 0,
      url_documento text, cod_tipo_documento integer, cod_lote varchar(100), raw_json jsonb)`);
    await client.query(`INSERT INTO despesas (politico_id,ano,mes,tipo_despesa,cod_documento,valor_documento,valor_liquido)
      VALUES (99,2020,1,'Preservada','0',174.63,174.63)`);
    await client.query(readFileSync(new URL('../../prisma/migrations/20261029193000_scope_expense_document_identity/migration.sql',import.meta.url),'utf8'));
    await client.query(readFileSync(new URL('../../prisma/migrations/20261030010000_expense_source_identity/migration.sql',import.meta.url),'utf8'));
    expect((await client.query('SELECT count(*)::int AS total,SUM(valor_liquido)::text AS valor FROM despesas')).rows[0]).toEqual({total:1,valor:'174.63'});
    expect((await client.query('SELECT identidade_origem FROM despesas')).rows[0].identidade_origem).toBeNull();
  });
  beforeEach(async () => { await client.query('TRUNCATE despesas'); });
  afterAll(async () => {
    if (client) {
      await client.query(`DROP SCHEMA "${schema}" CASCADE`);
      client.release();
    }
    await pool.end();
  });

  it('soma lançamentos distintos do documento, sem inflar repetição e preservando códigos nulos', async () => {
    const expenses = [{codDocumento: ' 12 ', valorLiquido: 10}, {codDocumento: 12, valorLiquido: -4},
      {codDocumento:null,numDocumento:'A',cnpjCpfFornecedor:'00530352000159'}, {codDocumento:null,numDocumento:'B',cnpjCpfFornecedor:'00530352000159'}];
    expect(await upsertExpenseBatch(client, '1', 2026, 10, expenses)).toEqual({processed: 4, changed: 3});
    const {rows} = await client.query('SELECT cod_documento, valor_liquido FROM despesas ORDER BY cod_documento NULLS LAST');
    expect(rows).toEqual([{cod_documento: '12', valor_liquido: '6.00'}, {cod_documento: null, valor_liquido: '0.00'}, {cod_documento: null, valor_liquido: '0.00'}]);
    expect(await upsertExpenseBatch(client, '1', 2026, 10, expenses.slice(0, 2))).toEqual({processed: 2, changed: 0});
  });

  it('replay e correção substituem o mesmo documento sem código, preservando emissor e referência distintos',async()=>{
    const original:Expense={codDocumento:null,numDocumento:'2025/693656',cnpjCpfFornecedor:'00530352000159',tipoDocumento:'Recibos/Outros',valorLiquido:-61932.80};
    await upsertExpenseBatch(client,'1',2025,5,[original]);
    const first=(await client.query('SELECT id,xmin::text,identidade_origem FROM despesas')).rows[0];
    expect((await upsertExpenseBatch(client,'1',2025,5,[original,original])).changed).toBe(0);
    expect((await client.query('SELECT xmin::text FROM despesas')).rows[0].xmin).toBe(first.xmin);
    await upsertExpenseBatch(client,'1',2025,5,[{...original,valorLiquido:25,nomeFornecedor:'Nome corrigido',dataDocumento:'2025-05-12'}]);
    expect((await client.query('SELECT id,cod_documento,identidade_origem,valor_liquido FROM despesas')).rows[0]).toEqual({id:first.id,cod_documento:null,identidade_origem:first.identidade_origem,valor_liquido:'25.00'});
    await upsertExpenseBatch(client,'1',2025,5,[{...original,cnpjCpfFornecedor:'00530352000160'},{...original,numDocumento:'2025/693657'}]);
    expect((await client.query('SELECT count(*)::int AS total FROM despesas')).rows[0].total).toBe(3);
  });

  it('documentos oficiais e sem código fazem rollback juntos quando o segundo conflito falha',async()=>{
    await client.query('BEGIN');
    try {
      await expect(upsertExpenseBatch(client,'1',2025,5,[{codDocumento:701,valorLiquido:10},
        {codDocumento:null,numDocumento:'N1',cnpjCpfFornecedor:'00530352000159',dataDocumento:'invalida'}])).rejects.toThrow();
    } finally {await client.query('ROLLBACK');}
    expect((await client.query('SELECT count(*)::int AS total FROM despesas')).rows[0].total).toBe(0);
  });

  it('preserva centavos, estornos e lançamentos originais distintos em sourceEntries', async () => {
    const entries = [
      {codDocumento:301400,valorDocumento:75,valorLiquido:75},
      {codDocumento:301400,valorDocumento:1469.95,valorLiquido:1469.95},
      {codDocumento:303050,dataDocumento:'2025-01-20',valorDocumento:598.74,valorLiquido:598.74},
      {codDocumento:303050,dataDocumento:'2025-01-21',valorDocumento:-598.74,valorLiquido:-598.74},
      {codDocumento:304379,valorDocumento:-1469.95,valorLiquido:-1469.95},
      {codDocumento:304379,valorDocumento:76,valorLiquido:76},
      {codDocumento:304379,valorDocumento:1469.95,valorLiquido:1469.95},
    ];
    await upsertExpenseBatch(client,'1',2025,1,[...entries,entries[1]]);
    const {rows} = await client.query('SELECT cod_documento,valor_liquido,raw_json FROM despesas ORDER BY cod_documento');
    expect(rows.map(row => [row.cod_documento,row.valor_liquido])).toEqual([['301400','1544.95'],['303050','0.00'],['304379','76.00']]);
    expect(rows[0].raw_json).toMatchObject({codDocumento:301400,valorLiquido:1544.95,sourceEntries:entries.slice(0,2)});
    expect((await client.query('SELECT SUM(valor_liquido)::text AS total FROM despesas')).rows[0].total).toBe('1620.95');
  });

  it('retry idêntico não altera xmin e atualização financeira preserva estorno', async () => {
    const expense = {codDocumento: 10, valorDocumento: 100, valorGlosa: 20, valorLiquido: 80};
    expect(await upsertExpenseBatch(client, '1', 2026, 10, [expense])).toEqual({processed: 1, changed: 1});
    const original = (await client.query('SELECT xmin::text FROM despesas')).rows[0].xmin;
    expect(await upsertExpenseBatch(client, '1', 2026, 10, [expense])).toEqual({processed: 1, changed: 0});
    expect((await client.query('SELECT xmin::text FROM despesas')).rows[0].xmin).toBe(original);
    expect(await upsertExpenseBatch(client, '1', 2026, 10, [{...expense, valorLiquido: -80, valorDocumento: -100}])).toEqual({processed: 1, changed: 1});
    expect((await client.query('SELECT valor_liquido, valor_documento, valor_glosa FROM despesas')).rows[0]).toEqual({valor_liquido: '-80.00', valor_documento: '-100.00', valor_glosa: '20.00'});
  });

  it('normaliza todos os campos e guarda o JSON original, incluindo fallback de lote', async () => {
    const expense: Expense = {ano: 2025, mes: 2, tipoDespesa: ' Passagem ', codDocumento: 0,
      cnpjCpfFornecedor: ' 123 ', nomeFornecedor: ' Fornecedor ', tipoDocumento: ' Nota ', codTipoDocumento: 4,
      dataDocumento: '2025-02-03', numDocumento: ' 9 ', valorDocumento: 123.45, valorGlosa: 3.45,
      valorLiquido: 120, numLote: ' 33 ', numRessarcimento: ' 7 ', parcela: 2, urlDocumento: ' https://example.test/nota '};
    await upsertExpenseBatch(client, '99', 2026, 10, [expense]);
    const {rows: [row]} = await client.query('SELECT *, data_documento::text AS data_documento FROM despesas');
    expect(row).toMatchObject({politico_id: '99', ano: 2025, mes: 2, tipo_despesa: 'Passagem', cod_documento: '0',
      cnpj_cpf_fornecedor: '123', nome_fornecedor: 'Fornecedor', tipo_documento: 'Nota', cod_tipo_documento: 4,
      data_documento: '2025-02-03', num_documento: '9', valor_documento: '123.45', valor_glosa: '3.45',
      valor_liquido: '120.00', num_lote: '33', cod_lote: '33', num_ressarcimento: '7', parcela: 2,
      url_documento: 'https://example.test/nota', raw_json: expense});
  });

  it('compara campos normalizados mesmo com raw igual e detecta mudança somente no raw', async () => {
    const expense = {codDocumento: 10, nomeFornecedor: 'Original'};
    await upsertExpenseBatch(client, '1', 2026, 10, [expense]);
    await client.query("UPDATE despesas SET nome_fornecedor = 'Alterado externamente'");
    expect((await upsertExpenseBatch(client, '1', 2026, 10, [expense])).changed).toBe(1);
    expect((await client.query('SELECT nome_fornecedor FROM despesas')).rows[0].nome_fornecedor).toBe('Original');
    expect((await upsertExpenseBatch(client, '1', 2026, 10, [{...expense, nomeFornecedor: ' Original '}])).changed).toBe(1);
    expect((await upsertExpenseBatch(client, '2', 2025, 9, [{...expense, nomeFornecedor: ' Original '}])).changed).toBe(1);
    expect((await client.query('SELECT politico_id, ano, mes FROM despesas ORDER BY politico_id')).rows).toEqual([{politico_id:'1',ano:2026,mes:10},{politico_id: '2', ano: 2025, mes: 9}]);
  });

  it('preserva código zero por deputado, competência e categoria, com replay idempotente', async () => {
    const first = {codDocumento:0,tipoDespesa:' A ',valorLiquido:10};
    const second = {codDocumento:0,tipoDespesa:'B',valorLiquido:20};
    await upsertExpenseBatch(client,'1',2026,1,[first,second]);
    await upsertExpenseBatch(client,'2',2026,1,[{...first,valorLiquido:30}]);
    await upsertExpenseBatch(client,'1',2026,2,[{...first,valorLiquido:40}]);
    expect((await client.query('SELECT politico_id,mes,tipo_despesa,valor_liquido FROM despesas ORDER BY politico_id,mes,tipo_despesa')).rows).toEqual([
      {politico_id:'1',mes:1,tipo_despesa:'A',valor_liquido:'10.00'},
      {politico_id:'1',mes:1,tipo_despesa:'B',valor_liquido:'20.00'},
      {politico_id:'1',mes:2,tipo_despesa:'A',valor_liquido:'40.00'},
      {politico_id:'2',mes:1,tipo_despesa:'A',valor_liquido:'30.00'},
    ]);
    expect((await upsertExpenseBatch(client,'1',2026,1,[first,second])).changed).toBe(0);
  });

  it('agrega código não zero somente dentro da mesma categoria normalizada', async () => {
    await upsertExpenseBatch(client,'1',2026,1,[
      {codDocumento:12,tipoDespesa:' A ',valorLiquido:10},
      {codDocumento:12,tipoDespesa:'A',valorLiquido:-4},
      {codDocumento:12,tipoDespesa:'B',valorLiquido:20},
    ]);
    expect((await client.query('SELECT tipo_despesa,valor_liquido FROM despesas ORDER BY tipo_despesa')).rows).toEqual([
      {tipo_despesa:'A',valor_liquido:'6.00'},{tipo_despesa:'B',valor_liquido:'20.00'},
    ]);
  });

  it('mantém defaults e coerções anteriores e prefere codLote explícito', async () => {
    const expense = {codDocumento: 'defaults', tipoDespesa: ' ', valorDocumento: 'invalid',
      valorGlosa: null, valorLiquido: '-9.75', codTipoDocumento: null, parcela: '2', codLote: ' 44 ', numLote: 33} as unknown as Expense;
    await upsertExpenseBatch(client, '1', 2026, 10, [expense]);
    expect((await client.query('SELECT ano, mes, tipo_despesa, valor_documento, valor_glosa, valor_liquido, cod_tipo_documento, parcela, cod_lote, num_lote FROM despesas')).rows[0])
      .toEqual({ano: 2026, mes: 10, tipo_despesa: 'Nao informado', valor_documento: '0.00', valor_glosa: '0.00',
        valor_liquido: '-9.75', cod_tipo_documento: 0, parcela: 2, cod_lote: '44', num_lote: '33'});
  });

  it('participa da transação do chamador sem confirmar parcialmente o lote', async () => {
    await client.query('BEGIN');
    try {
      await upsertExpenseBatch(client, '1', 2026, 10, [{codDocumento: 1}]);
    } finally { await client.query('ROLLBACK'); }
    expect((await client.query('SELECT count(*)::int AS total FROM despesas')).rows[0].total).toBe(0);
  });
});
