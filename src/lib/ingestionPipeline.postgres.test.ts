// @vitest-environment node
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadCurrentIngestionRun} from './ingestionRun';
import {Pool} from 'pg';
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';
import {claimExpenseBatch,runExpenseBatch,type ExpenseCheckpoint} from './expenseBatch';

const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)('worker de despesas com PostgreSQL real e HTTP controlado', () => {
  const schema = `pipeline_${randomUUID().replaceAll('-', '')}`;
  const database = new Pool({connectionString: databaseUrl});
  let url: string;
  let runDirectory:string;
  const argv = process.argv;
  const expense = (codDocumento: number) => ({codDocumento, ano: 2026, mes: 1, valorDocumento: 10, valorLiquido: 10});
  const response = (dados: unknown[], next = false) => ({ok: true, status: 200, json: async () => ({dados, links: next ? [{rel: 'next'}] : []})}) as Response;
  beforeAll(async () => {
    const parsed = new URL(databaseUrl!);
    const source = parsed.searchParams.get('schema') ?? 'public';
    const identifier = '"' + source.replaceAll('"', '""') + '"';
    await database.query(`CREATE SCHEMA ${schema}`);
    for (const table of ['politicos', 'despesas', 'camara_api_raw_items', 'ingestion_checkpoints']) {
      await database.query(`CREATE TABLE ${schema}.${table} (LIKE ${identifier}.${table} INCLUDING ALL)`);
    }
    const migrationClient = await database.connect();
    try {
      await migrationClient.query(`SET search_path TO ${schema}`);
      await migrationClient.query(readFileSync(new URL('../../prisma/migrations/20261029193000_scope_expense_document_identity/migration.sql',import.meta.url),'utf8'));
      await migrationClient.query(readFileSync(new URL('../../prisma/migrations/20261030010000_expense_source_identity/migration.sql',import.meta.url),'utf8'));
    } finally {
      await migrationClient.query('RESET search_path');
      migrationClient.release();
    }
    parsed.searchParams.set('options', `-c search_path=${schema},public`);
    url = parsed.toString();
  });
  beforeEach(async () => {
    runDirectory=await mkdtemp(join(tmpdir(),'ingestion-pipeline-run-'));
    vi.stubEnv('INGESTION_RUN_DIR',runDirectory);
    await database.query(`TRUNCATE ${schema}.despesas, ${schema}.camara_api_raw_items, ${schema}.ingestion_checkpoints, ${schema}.politicos`);
    await database.query(`INSERT INTO ${schema}.politicos (id,nome,sigla_partido,sigla_uf,id_legislatura) VALUES (900001,'Pessoa sintética','TST','SP',57)`);
    vi.stubEnv('DATABASE_URL', url);
    vi.stubGlobal('fetch', vi.fn());
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    process.exitCode = 0;
  });
  afterEach(async () => {process.argv = argv; process.exitCode = 0; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();if(runDirectory)await rm(runDirectory,{recursive:true,force:true});});
  afterAll(async () => {await database.query(`DROP SCHEMA ${schema} CASCADE`); await database.end();});
  const run = async (flags = ['--reset-failed'],from='2026-01-01',to='2026-01-31',concurrency=1,maxAttempts=1) => {
    vi.resetModules();
    process.exitCode = 0;
    process.argv = ['node', 'ingest-agent.ts', '--datasets=despesas', `--from=${from}`, `--to=${to}`, `--concurrency=${concurrency}`, `--max-attempts=${maxAttempts}`, '--min-delay-ms=0', ...flags];
    const worker = await import('../ingest-agent');
    await worker.ingestionRun;
  };

  it('registra o escopo real enquanto processa e congela o resultado antes de liberar a execução',async()=>{
    let finish!:(value:Response)=>void;
    vi.mocked(fetch).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const running=run(['--reset-failed'],'2026-01-01','2026-02-28');
    const scope=new Pool({connectionString:url});
    try{
      await vi.waitFor(()=>expect(fetch).toHaveBeenCalledTimes(1));
      expect(await loadCurrentIngestionRun(scope,runDirectory)).toMatchObject({status:'running',currentDataset:'despesas',estimatedTotal:2,completed:0,remaining:2,notCreated:0,estimationComplete:true});
      finish(response([expense(901)]) as Response);await running;
      expect(process.exitCode,vi.mocked(console.error).mock.calls.flat().join('\n')).toBe(0);
      expect(await loadCurrentIngestionRun(scope,runDirectory)).toMatchObject({status:'completed',estimatedTotal:2,completed:2,reused:0,remaining:0,percent:100});
      await scope.query("UPDATE ingestion_checkpoints SET status='failed'");
      expect(await loadCurrentIngestionRun(scope,runDirectory)).toMatchObject({status:'completed',completed:2,remaining:0});
    }finally{if(finish)finish(response([]) as Response);await running;await scope.end();}
  },20000);

  it('falha na página 2 preserva a página 1 e retoma sem buscá-la ou duplicá-la', async () => {
    vi.mocked(fetch).mockImplementation(async input => new URL(String(input)).searchParams.get('pagina') === '1'
      ? response(Array.from({length: 100}, (_, i) => expense(i + 1)), true)
      : response([{...expense(101), dataDocumento: 'data-invalida'}]));
    await run();
    expect(new URL(String(vi.mocked(fetch).mock.calls[0][0])).searchParams.get('idLegislatura')).toBe('57');
    const first = (await database.query(`SELECT status,items_count,progress_json FROM ${schema}.ingestion_checkpoints`)).rows[0];
    expect(first).toMatchObject({status: 'failed', items_count: 100, progress_json: {nextPage: 2, itemsCount: 100, finished: false}});
    expect(process.exitCode).toBe(1);
    expect((await database.query(`SELECT count(*)::int AS total FROM ${schema}.despesas`)).rows[0].total).toBe(100);
    vi.mocked(fetch).mockClear().mockResolvedValue(response([expense(101)]));
    await run();
    expect(process.exitCode).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(new URL(String(vi.mocked(fetch).mock.calls[0][0])).searchParams.get('pagina')).toBe('2');
    expect((await database.query(`SELECT status,items_count FROM ${schema}.ingestion_checkpoints`)).rows[0]).toEqual({status: 'done', items_count: 101});
    expect((await database.query(`SELECT count(*)::int AS total FROM ${schema}.despesas`)).rows[0].total).toBe(101);
    expect((await database.query(`SELECT count(*)::int AS total FROM ${schema}.camara_api_raw_items`)).rows[0].total).toBe(101);
  }, 20000);

  it('não declara sucesso quando há checkpoint já esgotado sem flag de reinício', async () => {
    await database.query(`INSERT INTO ${schema}.ingestion_checkpoints
      (source,dataset,entity_id,period_start,period_end,status,attempts,last_error)
      VALUES ('camara','despesas','900001','2026-01-01','2026-01-31','failed',1,'falha anterior')`);
    await run([]);
    expect(fetch).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Ingestão incompleta'));
  }, 20000);

  it('erro no arquivo raw desfaz despesas e cursor da mesma página', async () => {
    await database.query(`CREATE FUNCTION ${schema}.reject_raw() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'raw indisponível'; END $$;
      CREATE TRIGGER reject_raw BEFORE INSERT ON ${schema}.camara_api_raw_items FOR EACH ROW EXECUTE FUNCTION ${schema}.reject_raw()`);
    try {
      vi.mocked(fetch).mockResolvedValue(response([expense(201), expense(202)]));
      await run();
      expect((await database.query(`SELECT status,items_count,progress_json FROM ${schema}.ingestion_checkpoints`)).rows[0]).toEqual({status: 'failed', items_count: 0, progress_json: {}});
      expect((await database.query(`SELECT count(*)::int AS total FROM ${schema}.despesas`)).rows[0].total).toBe(0);
    } finally {await database.query(`DROP TRIGGER reject_raw ON ${schema}.camara_api_raw_items; DROP FUNCTION ${schema}.reject_raw()`);}
  }, 20000);

  it('cursor final confirmado conclui uma retomada sem repetir HTTP ou dados', async () => {
    await database.query(`INSERT INTO ${schema}.ingestion_checkpoints
      (source,dataset,entity_id,period_start,period_end,status,items_count,progress_json)
      VALUES ('camara','despesas','900001','2026-01-01','2026-01-31','failed',100,$1::jsonb)`,
      [JSON.stringify({version: 1, resource: '/deputados/900001/despesas', params: {ano: 2026, mes: 1, idLegislatura: 57}, nextPage: 2, itemsCount: 100, finished: true,expenseAggregation:{version:2,entries:[expense(100)]}})]);
    await run();
    expect(fetch).not.toHaveBeenCalled();
    expect((await database.query(`SELECT status,items_count FROM ${schema}.ingestion_checkpoints`)).rows[0]).toEqual({status: 'done', items_count: 100});
  }, 20000);

  it('reinicia cursor legado finalizado na página 1 preservando despesas já gravadas', async () => {
    await database.query(`INSERT INTO ${schema}.despesas (politico_id,ano,mes,tipo_despesa,cod_documento,valor_documento,valor_liquido)
      VALUES (900001,2026,1,'Nao informado','401',10,10)`);
    await database.query(`INSERT INTO ${schema}.ingestion_checkpoints
      (source,dataset,entity_id,period_start,period_end,status,items_count,progress_json)
      VALUES ('camara','despesas','900001','2026-01-01','2026-01-31','failed',0,$1::jsonb)`,
      [JSON.stringify({version: 1, resource: '/deputados/900001/despesas', params: {ano: 2026, mes: 1}, nextPage: 2, itemsCount: 0, finished: true})]);
    vi.mocked(fetch).mockResolvedValue(response([expense(401),expense(402)]));
    await run();
    expect(process.exitCode, vi.mocked(console.error).mock.calls.flat().join('\n')).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    const query = new URL(String(vi.mocked(fetch).mock.calls[0][0])).searchParams;
    expect(query.get('pagina')).toBe('1');
    expect(query.get('idLegislatura')).toBe('57');
    expect((await database.query(`SELECT count(*)::int AS total FROM ${schema}.despesas`)).rows[0].total).toBe(2);
    expect((await database.query(`SELECT status,items_count,progress_json FROM ${schema}.ingestion_checkpoints`)).rows[0]).toMatchObject({status:'done',items_count:2,progress_json:{params:{idLegislatura:57},finished:true}});
  }, 20000);

  it('cancelamento confirmado durante HTTP impede gravação e avanço da página', async () => {
    vi.mocked(fetch).mockImplementation(async () => {
      await database.query(`UPDATE ${schema}.ingestion_checkpoints SET status='cancelled' WHERE status='running'`);
      return response([expense(301)]);
    });
    await run();
    expect((await database.query(`SELECT status,items_count,progress_json FROM ${schema}.ingestion_checkpoints`)).rows[0]).toEqual({status: 'cancelled', items_count: 0, progress_json: {}});
    expect((await database.query(`SELECT count(*)::int AS total FROM ${schema}.despesas`)).rows[0].total).toBe(0);
  }, 20000);

  it('acumula o documento entre páginas, retoma atomicamente e deduplica replay', async () => {
    const a = {...expense(701),valorDocumento:0.1,valorGlosa:0.01,valorLiquido:0.09};
    const b = {...expense(701),valorDocumento:0.2,valorGlosa:0.02,valorLiquido:0.18};
    const c = {...expense(701),valorDocumento:-0.05,valorGlosa:-0.01,valorLiquido:-0.04};
    vi.mocked(fetch).mockImplementation(async input => new URL(String(input)).searchParams.get('pagina') === '1'
      ? response([a],true) : response([b,{...expense(702),dataDocumento:'invalida'}]));
    await run();
    expect((await database.query(`SELECT valor_liquido::text AS total FROM ${schema}.despesas WHERE cod_documento='701'`)).rows[0].total).toBe('0.09');
    vi.mocked(fetch).mockClear().mockResolvedValue(response([b,c,b]));
    await run();
    expect(process.exitCode).toBe(0);
    expect(new URL(String(vi.mocked(fetch).mock.calls[0][0])).searchParams.get('pagina')).toBe('2');
    const read = async () => (await database.query(`SELECT valor_documento::text,valor_glosa::text,valor_liquido::text,raw_json FROM ${schema}.despesas WHERE cod_documento='701'`)).rows[0];
    expect(await read()).toMatchObject({valor_documento:'0.25',valor_glosa:'0.02',valor_liquido:'0.23',raw_json:{codDocumento:701,sourceEntries:[a,b,c]}});
    expect((await database.query(`SELECT raw_json FROM ${schema}.camara_api_raw_items WHERE resource_id=$1`,[JSON.stringify([2026,1,'701','Nao informado'])])).rows[0].raw_json).toEqual((await read()).raw_json);
    await database.query(`UPDATE ${schema}.ingestion_checkpoints SET status='failed',progress_json='{}',items_count=0`);
    vi.mocked(fetch).mockClear().mockResolvedValue(response([a,b,c,b]));
    await run();
    expect((await database.query(`SELECT count(*)::int AS total FROM ${schema}.despesas`)).rows[0].total).toBe(1);
    expect((await read()).valor_liquido).toBe('0.23');
  },20000);

  it('preserva categorias diferentes do código zero também no arquivo raw', async () => {
    vi.mocked(fetch).mockResolvedValue(response([
      {...expense(0),tipoDespesa:' A ',valorLiquido:10},
      {...expense(0),tipoDespesa:'A',valorLiquido:5},
      {...expense(0),tipoDespesa:'B',valorLiquido:20},
    ]));
    await run();
    expect(process.exitCode).toBe(0);
    expect((await database.query(`SELECT tipo_despesa,valor_liquido::text FROM ${schema}.despesas ORDER BY tipo_despesa`)).rows).toEqual([
      {tipo_despesa:'A',valor_liquido:'15.00'},{tipo_despesa:'B',valor_liquido:'20.00'},
    ]);
    const {rows} = await database.query(`SELECT resource_id,raw_json FROM ${schema}.camara_api_raw_items ORDER BY resource_id`);
    expect(rows.map(row=>JSON.parse(row.resource_id))).toEqual([[2026,1,'0','A'],[2026,1,'0','B']]);
    expect(rows[0].raw_json).toMatchObject({codDocumento:0,valorLiquido:15,sourceEntries:expect.any(Array)});
    expect(rows[1].raw_json).toMatchObject({codDocumento:0,valorLiquido:20,tipoDespesa:'B'});
  },20000);

  it('consulta dois meses fresh em um GET e confirma ambos, inclusive mês vazio', async () => {
    vi.mocked(fetch).mockResolvedValue(response([expense(801)]));
    await run(['--reset-failed'],'2026-01-01','2026-02-28');
    expect(process.exitCode).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(new URL(String(vi.mocked(fetch).mock.calls[0][0])).searchParams.get('mes')).toBe('1,2');
    expect((await database.query(`SELECT status,items_count FROM ${schema}.ingestion_checkpoints ORDER BY period_start`)).rows).toEqual([{status:'done',items_count:1},{status:'done',items_count:0}]);
    const raw=(await database.query(`SELECT query_params FROM ${schema}.camara_api_raw_items`)).rows[0].query_params;
    expect(raw).toMatchObject({ano:2026,mes:1,idLegislatura:57,requestParams:{ano:2026,mes:'1,2',idLegislatura:57}});
    expect((await database.query(`UPDATE ${schema}.ingestion_checkpoints SET status='cancelled' WHERE status IN ('pending','running')`)).rowCount).toBe(0);
  },20000);

  it('dois workers não consultam meses duplicados e preservam mês parcial no período', async () => {
    vi.mocked(fetch).mockImplementation(async input=>{
      const months=new URL(String(input)).searchParams.get('mes')!.split(',').map(Number);
      return response(months.map(mes=>({...expense(0),mes,tipoDespesa:'TELEFONIA',valorLiquido:mes})));
    });
    await run(['--reset-failed'],'2026-01-15','2026-04-20',2);
    expect(process.exitCode).toBe(0);
    const requested=vi.mocked(fetch).mock.calls.flatMap(([input])=>new URL(String(input)).searchParams.get('mes')!.split(','));
    expect(requested.sort()).toEqual(['1','2','3','4']);
    expect((await database.query(`SELECT count(*)::int AS count,SUM(valor_liquido)::text AS total FROM ${schema}.despesas`)).rows[0]).toEqual({count:4,total:'10.00'});
    expect((await database.query(`SELECT count(*)::int AS count FROM ${schema}.ingestion_checkpoints WHERE status='done'`)).rows[0].count).toBe(4);
  },20000);

  it('separa janeiro e fevereiro no ano de troca de legislatura', async () => {
    vi.mocked(fetch).mockImplementation(async input=>{
      const query=new URL(String(input)).searchParams;
      const months=query.get('mes')!.split(',').map(Number);
      expect(query.get('idLegislatura')).toBe(months.includes(1)?'56':'57');
      return response(months.map(mes=>({...expense(mes),ano:2023,mes})));
    });
    await run(['--reset-failed'],'2023-01-01','2023-03-31',2);
    expect(process.exitCode).toBe(0);
    expect((await database.query(`SELECT count(*)::int AS count FROM ${schema}.despesas`)).rows[0].count).toBe(3);
  },20000);

  it('cursor mensal parcial continua da página salva sem entrar no grupo fresh', async () => {
    await database.query(`INSERT INTO ${schema}.ingestion_checkpoints(source,dataset,entity_id,period_start,period_end,status,items_count,progress_json)
      VALUES('camara','despesas','900001','2026-01-01','2026-01-31','failed',1,$1)`,[JSON.stringify({version:1,resource:'/deputados/900001/despesas',params:{ano:2026,mes:1,idLegislatura:57},nextPage:2,itemsCount:1,finished:false,expenseAggregation:{version:2,entries:[expense(901)]}})]);
    vi.mocked(fetch).mockImplementation(async input=>{
      const query=new URL(String(input)).searchParams;
      if(query.get('mes')==='1') {expect(query.get('pagina')).toBe('2');return response([expense(902)]);}
      expect(query.get('mes')).toBe('2,3');return response([{...expense(903),mes:2}]);
    });
    await run(['--reset-failed'],'2026-01-01','2026-03-31');
    expect(process.exitCode).toBe(0);
    expect((await database.query(`SELECT items_count FROM ${schema}.ingestion_checkpoints ORDER BY period_start`)).rows.map(row=>row.items_count)).toEqual([2,1,0]);
  },20000);

  it.each(['http400','rollback','outside'])('falha %s não confirma nenhum mês do grupo', async failure=>{
    vi.mocked(fetch).mockResolvedValue(failure==='http400'?{ok:false,status:400} as Response:
      response([{...expense(910),...(failure==='rollback'?{dataDocumento:'invalida'}:{mes:3})}]));
    await run(['--reset-failed'],'2026-01-01','2026-02-28');
    expect(process.exitCode).toBe(1);
    expect((await database.query(`SELECT count(*)::int AS count FROM ${schema}.despesas`)).rows[0].count).toBe(0);
    expect((await database.query(`SELECT count(*)::int AS count FROM ${schema}.camara_api_raw_items`)).rows[0].count).toBe(0);
    expect((await database.query(`SELECT status FROM ${schema}.ingestion_checkpoints`)).rows.map(row=>row.status)).toEqual(['failed','failed']);
  },20000);

  it('cancelamento durante HTTP preserva cancelled e impede confirmação do grupo', async()=>{
    vi.mocked(fetch).mockImplementation(async()=>{
      await database.query(`UPDATE ${schema}.ingestion_checkpoints SET status='cancelled' WHERE period_start='2026-02-01'`);
      return response([expense(920)]);
    });
    await run(['--reset-failed'],'2026-01-01','2026-02-28');
    expect((await database.query(`SELECT status FROM ${schema}.ingestion_checkpoints ORDER BY period_start`)).rows.map(row=>row.status)).toEqual(['pending','cancelled']);
    expect((await database.query(`SELECT count(*)::int AS count FROM ${schema}.despesas`)).rows[0].count).toBe(0);
    expect(process.exitCode).toBe(0);
  },20000);

  it('retry recupera todos membros e não deixa falha fantasma após COMMIT', async()=>{
    vi.mocked(fetch).mockResolvedValueOnce({ok:false,status:400} as Response).mockResolvedValue(response([expense(930),{...expense(931),mes:2}]));
    await run(['--reset-failed'],'2026-01-01','2026-02-28',1,2);
    expect(process.exitCode).toBe(0);
    expect((await database.query(`SELECT status,attempts FROM ${schema}.ingestion_checkpoints ORDER BY period_start`)).rows).toEqual([{status:'done',attempts:2},{status:'done',attempts:2}]);
    const events=vi.mocked(console.log).mock.calls.map(([line])=>String(line)).filter(line=>line.includes('"stage":"checkpoint_done"'));
    expect(events).toHaveLength(2);
  },20000);

  it('flag de reversão conserva chamadas e cursores mensais',async()=>{
    vi.mocked(fetch).mockImplementation(async input=>response([{...expense(940),mes:Number(new URL(String(input)).searchParams.get('mes'))}]));
    await run(['--reset-failed','--expense-batch-months=1'],'2026-01-01','2026-02-28');
    expect(process.exitCode).toBe(0);expect(fetch).toHaveBeenCalledTimes(2);
    expect((await database.query(`SELECT progress_json FROM ${schema}.ingestion_checkpoints`)).rows.every(row=>row.progress_json.finished)).toBe(true);
  },20000);

  it('não mistura duas janelas históricas da mesma competência no mesmo grupo',async()=>{
    await database.query(`INSERT INTO ${schema}.ingestion_checkpoints(source,dataset,entity_id,period_start,period_end)
      VALUES('camara','despesas','900001','2026-02-01','2026-02-15')`);
    vi.mocked(fetch).mockImplementation(async input=>{
      const months=new URL(String(input)).searchParams.get('mes')!.split(',').map(Number);
      expect(new Set(months).size).toBe(months.length);
      return response(months.map(mes=>({...expense(950),mes})));
    });
    await run(['--reset-failed'],'2026-01-01','2026-03-31');
    expect(process.exitCode).toBe(0);
    expect((await database.query(`SELECT count(*)::int AS count FROM ${schema}.ingestion_checkpoints WHERE status='done'`)).rows[0].count).toBe(4);
    expect((await database.query(`SELECT count(*)::int AS count FROM ${schema}.despesas`)).rows[0].count).toBe(3);
  },20000);

  it.each(['pages','items'])('limite de %s falha antes de confirmar o grupo',async limit=>{
    await database.query(`INSERT INTO ${schema}.ingestion_checkpoints(source,dataset,entity_id,period_start,period_end,status)
      VALUES('camara','despesas','900001','2026-01-01','2026-01-31','running'),('camara','despesas','900001','2026-02-01','2026-02-28','running')`);
    const members=(await database.query<ExpenseCheckpoint>(`SELECT id,entity_id,period_start::text,period_end::text,progress_json,items_count FROM ${schema}.ingestion_checkpoints ORDER BY period_start`)).rows;
    const batchPool=new Pool({connectionString:url});
    const persist=vi.fn();
    try {
      await expect(runExpenseBatch(batchPool,members,{
        pages:async function*(){
          if(limit==='items') yield {items:Array.from({length:20001},()=>expense(1))};
          else for(let n=0;n<201;n++) yield {items:[]};
        },persist,
      })).rejects.toThrow('limite');
      expect(persist).not.toHaveBeenCalled();
      expect((await database.query(`SELECT status FROM ${schema}.ingestion_checkpoints`)).rows.map(row=>row.status)).toEqual(['failed','failed']);
    } finally {await batchPool.end();}
  },20000);

  it.each(['done','cancelled'])('claim concorrente ignora membro bloqueado que vira %s e usa outra janela válida',async status=>{
    await database.query(`INSERT INTO ${schema}.ingestion_checkpoints(source,dataset,entity_id,period_start,period_end,status)
      VALUES('camara','despesas','900001','2026-01-01','2026-01-31','running'),
      ('camara','despesas','900001','2026-02-01','2026-02-28','running'),
      ('camara','despesas','900001','2026-03-01','2026-03-15','pending'),
      ('camara','despesas','900001','2026-03-01','2026-03-31','pending'),
      ('camara','despesas','900001','2026-04-01','2026-04-30','done'),
      ('camara','despesas','900001','2026-05-01','2026-05-31','cancelled')`);
    const rows=(await database.query<ExpenseCheckpoint>(`SELECT id,entity_id,period_start::text,period_end::text,progress_json,items_count FROM ${schema}.ingestion_checkpoints ORDER BY period_start,period_end`)).rows;
    const batchPool=new Pool({connectionString:url});
    const barrier=await batchPool.connect();
    try {
      await barrier.query('BEGIN');
      await barrier.query('UPDATE ingestion_checkpoints SET status=$2 WHERE id=$1',[rows[2].id,status]);
      const options={from:'2026-01-01',to:'2026-05-31',maxAttempts:5,limit:12};
      const groups=await Promise.all([claimExpenseBatch(batchPool,rows[0],options),claimExpenseBatch(batchPool,rows[1],options)]);
      const ids=groups.flat().map(cp=>cp.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).not.toContain(rows[2].id);
      expect(ids).toContain(rows[3].id);
      expect(ids).not.toContain(rows[4].id);expect(ids).not.toContain(rows[5].id);
      await barrier.query('COMMIT');
      expect((await barrier.query('SELECT status FROM ingestion_checkpoints WHERE id=$1',[rows[2].id])).rows[0].status).toBe(status);
    } finally {await barrier.query('ROLLBACK');barrier.release();await batchPool.end();}
  },20000);

  it('outercatch não sobrescreve tentativa nova reivindicada logo após cleanup do lote',async()=>{
    vi.mocked(fetch).mockResolvedValue({ok:false,status:400} as Response);
    const originalQuery=Pool.prototype.query;
    let reclaimed:string|undefined;
    vi.spyOn(Pool.prototype,'query').mockImplementation(function(this:Pool,...args:any[]) {
      const result=(originalQuery as any).apply(this,args);
      if(typeof args[0]==='string' && args[0].includes("WHERE id=ANY($1::uuid[]) AND status='running'")) {
        return Promise.resolve(result).then(async value=>{
          const ids=args[1][0] as string[];
          const leader=(await database.query(`SELECT id FROM ${schema}.ingestion_checkpoints WHERE id=ANY($1::uuid[]) ORDER BY period_start LIMIT 1`,[ids])).rows[0].id;
          await database.query(`UPDATE ${schema}.ingestion_checkpoints SET status=CASE WHEN id=$1 THEN 'running' ELSE 'done' END,attempts=attempts+1 WHERE id=ANY($2::uuid[])`,[leader,ids]);
          reclaimed=leader;
          return value;
        });
      }
      return result;
    } as any);
    await run(['--reset-failed'],'2026-01-01','2026-02-28');
    expect(reclaimed).toBeDefined();
    expect((await database.query(`SELECT status,attempts FROM ${schema}.ingestion_checkpoints WHERE id=$1`,[reclaimed])).rows[0]).toEqual({status:'running',attempts:2});
    expect(process.exitCode).toBe(0);
    expect(vi.mocked(console.log).mock.calls.some(([line])=>String(line).includes('Ingestão cancelada'))).toBe(false);
  },20000);

  it('retoma documento sem código entre páginas preservando estorno, originais e raw',async()=>{
    const original={codDocumento:null,numDocumento:'N1',cnpjCpfFornecedor:'00530352000159',tipoDocumento:'Recibos/Outros',ano:2026,mes:1,valorLiquido:100};
    vi.mocked(fetch).mockImplementation(async input=>new URL(String(input)).searchParams.get('pagina')==='1'
      ?response([original],true):response([{...original,valorLiquido:-30,dataDocumento:'invalida'}]));
    await run();
    expect(process.exitCode).toBe(1);
    expect((await database.query(`SELECT valor_liquido FROM ${schema}.despesas`)).rows[0].valor_liquido).toBe('100.00');
    const reversal={...original,valorLiquido:-30};
    vi.mocked(fetch).mockClear().mockResolvedValue(response([reversal,original]));
    await run();
    expect(process.exitCode).toBe(0);
    expect(new URL(String(vi.mocked(fetch).mock.calls[0][0])).searchParams.get('pagina')).toBe('2');
    const row=(await database.query(`SELECT cod_documento,identidade_origem,valor_liquido,raw_json FROM ${schema}.despesas`)).rows[0];
    expect(row).toMatchObject({cod_documento:null,identidade_origem:expect.stringMatching(/^v1:/),valor_liquido:'70.00',raw_json:{sourceEntries:[original,reversal]}});
    const raw=(await database.query(`SELECT resource_id,raw_json FROM ${schema}.camara_api_raw_items`)).rows;
    expect(raw).toHaveLength(1);
    expect(raw[0].raw_json).toEqual(row.raw_json);
    expect(raw[0].resource_id).toContain(row.identidade_origem);
  },20000);

  it('falha apenas no SQL de cleanup é fatal sem sobrescrever nova tentativa',async()=>{
    vi.mocked(fetch).mockResolvedValue({ok:false,status:400} as Response);
    const originalQuery=Pool.prototype.query;
    let injected=false;
    let newerAttempt:string|undefined;
    vi.spyOn(Pool.prototype,'query').mockImplementation(function(this:Pool,...args:any[]) {
      if(!injected && typeof args[0]==='string' && args[0].includes("WHERE id=ANY($1::uuid[]) AND status='running'")) {
        injected=true;
        return (async()=>{
          const ids=args[1][0] as string[];
          newerAttempt=(await database.query(`SELECT id FROM ${schema}.ingestion_checkpoints WHERE id=ANY($1::uuid[]) ORDER BY period_start LIMIT 1`,[ids])).rows[0].id;
          await database.query(`UPDATE ${schema}.ingestion_checkpoints SET attempts=attempts+1 WHERE id=$1`,[newerAttempt]);
          throw new Error('Falha SQL de cleanup injetada');
        })();
      }
      return (originalQuery as any).apply(this,args);
    } as any);
    await run(['--reset-failed'],'2026-01-01','2026-02-28');
    expect(injected).toBe(true);expect(process.exitCode).toBe(1);
    expect((await database.query(`SELECT status,attempts FROM ${schema}.ingestion_checkpoints WHERE id=$1`,[newerAttempt])).rows[0]).toEqual({status:'running',attempts:2});
    expect((await database.query(`SELECT count(*)::int AS count FROM ${schema}.despesas`)).rows[0].count).toBe(0);
    expect(vi.mocked(console.error).mock.calls.flat().join('\n')).toContain('Falha SQL de cleanup injetada');
  },20000);
});
