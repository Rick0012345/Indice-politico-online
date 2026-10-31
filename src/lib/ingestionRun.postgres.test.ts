// @vitest-environment node
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Pool} from 'pg';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {acquireIngestionLock} from './ingestionLifecycle';
import {createIngestionTracker,loadCurrentIngestionRun} from './ingestionRun';

const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('planejamento e execução com PostgreSQL isolado',()=>{
  const schema='run_progress_'+randomUUID().replaceAll('-','');
  let admin:Pool,pool:Pool,directory:string;
  const config={from:'2026-01-01',to:'2026-02-28',datasets:['votacoes'],window:'month' as const,resetEmpty:false};
  beforeAll(async()=>{
    if(new URL(url!).pathname!=='/app_test')throw new Error('Apenas app_test é permitido.');
    admin=new Pool({connectionString:url});await admin.query(`CREATE SCHEMA ${schema}`);
    const connection=new URL(url!);connection.searchParams.set('options',`-c search_path=${schema},public`);
    pool=new Pool({connectionString:connection.toString()});
    await pool.query(`CREATE TABLE ingestion_checkpoints(id uuid DEFAULT gen_random_uuid(),source text,dataset text,entity_id text,period_start date,period_end date,status text,items_count int DEFAULT 0)`);
    await pool.query('CREATE UNIQUE INDEX checkpoints_scope_key ON ingestion_checkpoints(source,dataset,entity_id,period_start,period_end)');
    directory=await mkdtemp(join(tmpdir(),'run-progress-pg-'));
  });
  beforeEach(async()=>{await pool.query('TRUNCATE ingestion_checkpoints');});
  afterAll(async()=>{await pool?.end();await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin?.end();if(directory)await rm(directory,{recursive:true,force:true});});
  it('soma a união do escopo existente e de tarefas futuras sem duplicar nem misturar datas',async()=>{
    await pool.query(`INSERT INTO ingestion_checkpoints(source,dataset,entity_id,period_start,period_end,status,items_count) VALUES
      ('camara','votacoes','','2026-01-01','2026-01-31','done',10),
      ('camara','votacoes','','2026-01-10','2026-01-20','done',5),
      ('camara','votacoes','','2025-01-01','2025-01-31','done',10),
      ('camara','despesas','1','2026-01-01','2026-01-31','done',20)`);
    const lock=await acquireIngestionLock(pool);expect(lock?.pid).toBeGreaterThan(0);
    try{
      await createIngestionTracker(pool,config,lock!.pid!,directory,[]);
      const progress=await loadCurrentIngestionRun(pool,directory);
      expect(progress).toMatchObject({status:'running',estimatedTotal:3,completed:2,reused:2,remaining:1,notCreated:1});
    }finally{await lock?.release();}
    expect(await loadCurrentIngestionRun(pool,directory)).toMatchObject({status:'interrupted'});
  });
  it('projeta resetEmpty somente em chaves realmente semeadas e conta vazios refeitos como conclusão',async()=>{
    await pool.query(`INSERT INTO ingestion_checkpoints(source,dataset,entity_id,period_start,period_end,status,items_count) VALUES
      ('camara','votacoes','','2026-01-01','2026-01-31','done',0),
      ('camara','votacoes','','2026-01-10','2026-01-20','done',0)`);
    const lock=await acquireIngestionLock(pool);
    try{
      const tracker=await createIngestionTracker(pool,{...config,to:'2026-01-31',resetEmpty:true},lock!.pid!,directory,[]);
      expect(await loadCurrentIngestionRun(pool,directory)).toMatchObject({estimatedTotal:2,completed:1,reused:1,remaining:1});
      await pool.query("UPDATE ingestion_checkpoints SET status='pending' WHERE period_start='2026-01-01'");
      await tracker.seeded('votacoes');
      await pool.query("UPDATE ingestion_checkpoints SET status='done' WHERE period_start='2026-01-01'");
      expect(await loadCurrentIngestionRun(pool,directory)).toMatchObject({completed:2,reused:1,remaining:0});
    }finally{await lock?.release();}
  });
  it('não atribui à execução velha um lock de outra sessão no mesmo banco',async()=>{
    const first=await acquireIngestionLock(pool);
    await createIngestionTracker(pool,config,first!.pid!,directory,[]);await first!.release();
    const other=new Pool({connectionString:url});
    const second=await acquireIngestionLock(other);
    try{
      expect(second!.pid).not.toBe(first!.pid);
      expect(await loadCurrentIngestionRun(pool,directory)).toMatchObject({status:'interrupted'});
    }finally{await second?.release();await other.end();}
  });
  it('mede o plano de 1252 políticos por142 meses com e sem reconsulta de vazios',async()=>{
    await pool.query(`INSERT INTO ingestion_checkpoints(source,dataset,entity_id,period_start,period_end,status,items_count)
      SELECT 'camara','despesas',person::text,month::date,(month+INTERVAL '1 month - 1 day')::date,'done',CASE WHEN person%3=0 THEN 0 ELSE 1 END
      FROM generate_series(1,1252) person CROSS JOIN generate_series('2015-01-01'::date,'2026-10-01'::date,INTERVAL '1 month') month
      ORDER BY month,person LIMIT 77003`);
    await pool.query('ANALYZE ingestion_checkpoints');
    const lock=await acquireIngestionLock(pool);const measurements=[];
    try{
      for(const resetEmpty of [false,true]){
        await createIngestionTracker(pool,{from:'2015-01-01',to:'2026-10-31',datasets:['despesas'],window:'month',resetEmpty},lock!.pid!,directory,Array.from({length:1252},(_,i)=>String(i+1)));
        const start=performance.now();const result=await loadCurrentIngestionRun(pool,directory);const elapsedMs=performance.now()-start;
        expect(result?.estimatedTotal).toBe(177784);expect(result?.remaining).toBe(177784-result!.completed);
        if(resetEmpty)expect(result!.completed).toBeLessThan(77003);else expect(result!.completed).toBe(77003);
        expect(elapsedMs).toBeLessThan(4000);measurements.push({resetEmpty,elapsedMs:Math.round(elapsedMs)});
      }
      console.log('INGESTION_PLAN_MEASUREMENT',JSON.stringify({plannedTasks:177784,existingTasks:77003,measurements}));
    }finally{await lock?.release();}
  },20000);
});
