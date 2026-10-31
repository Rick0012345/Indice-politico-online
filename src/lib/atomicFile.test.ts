// @vitest-environment node
import {mkdtemp,readFile,readdir,rename,rmdir,unlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {writeFileAtomic} from './atomicFile';

vi.mock('node:fs/promises',async importOriginal=>{
  const actual=await importOriginal<typeof import('node:fs/promises')>();
  return {...actual,rename:vi.fn(actual.rename)};
});
const directories:string[]=[];
let realRename:typeof rename;
beforeEach(async()=>{realRename=(await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')).rename;vi.mocked(rename).mockReset().mockImplementation(realRename);});
afterEach(async()=>{for(const directory of directories.splice(0)){for(const name of await readdir(directory))await unlink(join(directory,name));await rmdir(directory);}});
async function fixture(){const directory=await mkdtemp(join(tmpdir(),'atomic-file-'));directories.push(directory);const path=join(directory,'manifest.json');await writeFile(path,'anterior');return {directory,path};}
const busy=(code:string)=>Object.assign(new Error('Arquivo ocupado'),{code});

describe('gravação atômica com bloqueio transitório do Windows',()=>{
  it('publica texto UTF-8 e bytes inteiros, substituindo arquivo existente sem resíduos',async()=>{
    const {directory,path}=await fixture();
    await writeFileAtomic(path,'{"situação":"concluída"}');
    expect(await readFile(path,'utf8')).toBe('{"situação":"concluída"}');
    const bytes=new Uint8Array([0,255,128,1]);await writeFileAtomic(path,bytes);
    expect(new Uint8Array(await readFile(path))).toEqual(bytes);
    expect(await readdir(directory)).toEqual(['manifest.json']);
  });
  it.each(['EPERM','EACCES','EBUSY'])('preserva anterior durante bloqueio %s e publica integralmente quando liberado',async code=>{
    const {directory,path}=await fixture();let attempts=0;
    vi.mocked(rename).mockImplementation(async(from,to)=>{
      expect(await readFile(path,'utf8')).toBe('anterior');
      expect(await readFile(from,'utf8')).toBe('novo completo');
      expect(String(from)).toMatch(/manifest\.json\.[a-f0-9-]+\.tmp$/);
      if(++attempts<3)throw busy(code);
      await realRename(from,to);
    });
    await writeFileAtomic(path,'novo completo');
    expect(await readFile(path,'utf8')).toBe('novo completo');
    expect(attempts).toBe(3);expect(await readdir(directory)).toEqual(['manifest.json']);
  });
  it('limita tentativas de bloqueio persistente, propaga erro e conserva arquivo anterior',async()=>{
    const {directory,path}=await fixture();const error=busy('EPERM');vi.mocked(rename).mockRejectedValue(error);
    await expect(writeFileAtomic(path,'não publicado')).rejects.toBe(error);
    expect(rename).toHaveBeenCalledTimes(8);
    expect(await readFile(path,'utf8')).toBe('anterior');expect(await readdir(directory)).toEqual(['manifest.json']);
  },6000);
  it('não repete erro estrutural e não apaga destino para tentar forçar substituição',async()=>{
    const {directory,path}=await fixture();const error=busy('EXDEV');vi.mocked(rename).mockRejectedValue(error);
    await expect(writeFileAtomic(path,'novo')).rejects.toBe(error);
    expect(rename).toHaveBeenCalledTimes(1);expect(await readFile(path,'utf8')).toBe('anterior');expect(await readdir(directory)).toEqual(['manifest.json']);
  });
  it('não tenta renomear quando a escrita do temporário falha',async()=>{
    const {path}=await fixture();await expect(writeFileAtomic(join(path,'filho'),'novo')).rejects.toMatchObject({code:expect.stringMatching(/ENOTDIR|ENOENT/)});
    expect(rename).not.toHaveBeenCalled();expect(await readFile(path,'utf8')).toBe('anterior');
  });
});
