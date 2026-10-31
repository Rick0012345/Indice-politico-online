// @vitest-environment node
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {createIngestionTracker,loadCurrentIngestionRun} from './ingestionRun';

const directories:string[]=[];
afterEach(async()=>{await Promise.all(directories.map(directory=>rm(directory,{recursive:true,force:true})));directories.length=0;});
const directory=async()=>{const path=await mkdtemp(join(tmpdir(),'indice-run-'));directories.push(path);return path;};
const config={from:'2026-01-01',to:'2026-01-31',datasets:['despesas'],window:'month' as const,resetEmpty:false};
const db=(counts:Record<string,unknown>[],active=true)=>({query:vi.fn().mockResolvedValue({rows:[{counts,active}]})}) as any;

describe('registro da execução atual',()=>{
  it.each(['completed','failed','cancelled'] as const)('prefere o resultado %s gravado durante uma leitura que perdeu a trava',async(status)=>{
    const path=await directory();const pool=db([{dataset:'despesas',status:'done',total:2}]);
    const tracker=await createIngestionTracker(pool,config,123,path,['1']);
    const racing={query:vi.fn(async()=>{
      await tracker.finish(status);
      return {rows:[{counts:[{dataset:'despesas',status:'done',total:2}],active:false}]};
    })} as any;
    const observed=await loadCurrentIngestionRun(racing,path);
    const frozen=await loadCurrentIngestionRun(db([]),path);
    expect(observed).toEqual(frozen);
    expect(observed).toMatchObject({status,completed:2,remaining:0});
    expect(observed?.finishedAt).not.toBeNull();
  });
  it('não mistura o snapshot de outra execução que substituiu o arquivo durante a leitura',async()=>{
    const path=await directory();await createIngestionTracker(db([{dataset:'despesas',status:'done',total:2}]),config,123,path,['1']);
    const original=await loadCurrentIngestionRun(db([{dataset:'despesas',status:'done',total:2}]),path);
    const racing={query:vi.fn(async()=>{
      const replacement=await createIngestionTracker(db([{dataset:'despesas',status:'done',total:999}]),config,456,path,['2']);
      await replacement.finish('completed');
      return {rows:[{counts:[{dataset:'despesas',status:'done',total:2}],active:false}]};
    })} as any;
    expect(await loadCurrentIngestionRun(racing,path)).toMatchObject({id:original?.id,status:'interrupted',completed:2});
  });
  it('mantém despesas sem catálogo como estimativa provisória mesmo após revisão vazia',async()=>{
    const path=await directory();const pool=db([],true);
    const tracker=await createIngestionTracker(pool,config,123,path,[]);
    expect(await loadCurrentIngestionRun(pool,path)).toMatchObject({estimationComplete:false,estimatedTotal:0});
    await tracker.refreshPoliticians([]);
    expect(await loadCurrentIngestionRun(pool,path)).toMatchObject({estimationComplete:false});
  });
  it('distingue previsão ainda não criada do acumulado e marca falta do lock correto como interrupção',async()=>{
    const path=await directory();
    const pool=db([{dataset:'despesas',status:'done',total:25,emptyTotal:0},{dataset:'despesas',status:'missing',total:75}],true);
    const tracker=await createIngestionTracker(pool,config,123,path,['1']);
    expect(await loadCurrentIngestionRun(pool,path)).toMatchObject({status:'running',estimatedTotal:100,completed:25,reused:25,remaining:75,notCreated:75,percent:25});
    const sql=pool.query.mock.calls.at(-1)[0];
    expect(sql).toContain('pg_locks');expect(sql).toContain('current_database()');
    expect(await loadCurrentIngestionRun(db([{dataset:'despesas',status:'done',total:25}],false),path)).toMatchObject({status:'interrupted'});
    expect(tracker).toBeTruthy();
  });
  it('congela o resultado final antes de outra execução e não lê novamente seus checkpoints',async()=>{
    const path=await directory();const pool=db([{dataset:'despesas',status:'done',total:2}],true);
    const tracker=await createIngestionTracker(pool,config,123,path,['1']);
    await tracker.finish('completed');
    const unrelated=db([{dataset:'despesas',status:'done',total:9000}],false);
    expect(await loadCurrentIngestionRun(unrelated,path)).toMatchObject({status:'completed',estimatedTotal:2,completed:2});
    expect(unrelated.query).not.toHaveBeenCalled();
  });
  it('não inventa metadados de execução antiga e falha explicitamente para arquivo corrompido',async()=>{
    const path=await directory();expect(await loadCurrentIngestionRun(db([]),path)).toBeNull();
    await writeFile(join(path,'camara-run-current.json'),'{');
    await expect(loadCurrentIngestionRun(db([]),path)).rejects.toThrow();
  });
  it('revisa despesas futuras após descobrir novos deputados e mantém a identidade da seleção',async()=>{
    const path=await directory();const pool=db([],true);
    const tracker=await createIngestionTracker(pool,{...config,datasets:['deputados','despesas']},123,path,[]);
    expect(await loadCurrentIngestionRun(pool,path)).toMatchObject({estimationComplete:false,datasets:['deputados','despesas']});
    await tracker.refreshPoliticians(['1','2']);
    const stored=JSON.parse(await readFile(join(path,'camara-run-current.json'),'utf8'));
    expect(stored.estimationComplete).toBe(true);
    expect(stored.plan.find((p:any)=>p.dataset==='despesas').entityIds).toEqual(['1','2']);
  });
});
