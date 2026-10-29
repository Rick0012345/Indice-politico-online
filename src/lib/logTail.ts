import {open} from 'node:fs/promises';

/** Bound work before parsing; never load an entire ingestion log into the API. */
export const readLogTail = async (path: string, maxBytes = 512 * 1024) => {
  let file: Awaited<ReturnType<typeof open>>;
  try { file = await open(path, 'r'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {content:'',truncated:false};
    throw error;
  }
  try {
    const {size} = await file.stat();
    const start = Math.max(0, size - maxBytes);
    const buffer = Buffer.alloc(Math.min(size, maxBytes));
    const {bytesRead} = await file.read(buffer, 0, buffer.length, start);
    let content = buffer.subarray(0,bytesRead).toString('utf8');
    if (start > 0) {
      const newline = content.indexOf('\n');
      content = newline >= 0 ? content.slice(newline + 1) : '';
    }
    return {content,truncated:start > 0};
  } finally { await file.close(); }
};
