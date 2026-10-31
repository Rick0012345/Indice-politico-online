import {randomUUID} from 'node:crypto';
import {rename,unlink,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';

const retryableRenameCodes=new Set(['EPERM','EACCES','EBUSY']);
const retryDelaysMs=[40,80,160,320,500,600,800];

/** Replace a complete file using a same-directory temporary. Windows readers
 * can briefly prevent rename; retry those sharing/access errors for 2.5 seconds.
 * Never unlink the destination: a permanent failure preserves its old contents.
 * The parent directory must already exist. */
export async function writeFileAtomic(path:string,data:string|Uint8Array):Promise<void>{
  const temporary=path+'.'+randomUUID()+'.tmp';
  try{
    await writeFile(temporary,data,{flag:'wx'});
    for(let attempt=0;;attempt++){
      try{await rename(temporary,path);return;}
      catch(error){
        if(!retryableRenameCodes.has((error as NodeJS.ErrnoException).code??'')||attempt>=retryDelaysMs.length)throw error;
        await delay(retryDelaysMs[attempt]);
      }
    }
  }finally{
    // Only our uniquely named staging file is eligible for cleanup.
    await unlink(temporary).catch(()=>undefined);
  }
}
