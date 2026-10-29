// @vitest-environment node
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {it,expect} from 'vitest';
import {readLogTail} from './logTail';

it('limita bytes e descarta a primeira linha parcial de um log grande', async()=>{
  const dir=await mkdtemp(join(tmpdir(),'indice-log-'));
  try {
    const path=join(dir,'events.log');
    await writeFile(path,'linha antiga muito comprida\nevento recente\n');
    const result=await readLogTail(path,22);
    expect(result.truncated).toBe(true);
    expect(result.content).toBe('evento recente\n');
    expect(await readLogTail(join(dir,'missing.log'))).toEqual({content:'',truncated:false});
  } finally {await rm(dir,{recursive:true,force:true});}
});
