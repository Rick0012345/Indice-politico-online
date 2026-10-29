// @vitest-environment node
import {describe, expect, it, vi} from 'vitest';
import {iteratePages, readPageProgress, commitCheckpointPage} from './ingestionPages';
import {IngestionCancelledError} from './ingestionLifecycle';

describe('páginas da ingestão', () => {
  it('busca a página seguinte somente depois de o consumidor concluir a atual', async () => {
    const fetch = vi.fn(async page => ({dados: [page], links: page < 2 ? [{rel: 'next'}] : []}));
    const pages = iteratePages(fetch);
    expect(fetch).not.toHaveBeenCalled();
    expect((await pages.next()).value).toMatchObject({page: 1, items: [1], hasNext: true});
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await pages.next()).value).toMatchObject({page: 2, items: [2], hasNext: false});
    expect((await pages.next()).done).toBe(true);
  });
  it('retoma a página confirmada, encerra página vazia e mantém limite de segurança', async () => {
    const fetch = vi.fn(async page => ({dados: page === 4 ? [] : [page], links: [{rel: 'next'}]}));
    const pages = iteratePages(fetch, {startPage: 3, maxPages: 5});
    expect((await pages.next()).value).toMatchObject({page: 3});
    expect((await pages.next()).value).toMatchObject({page: 4, hasNext: false});
    expect((await pages.next()).done).toBe(true);
    const overflow = iteratePages(async () => ({dados: [1], links: [{rel: 'next'}]}), {startPage: 5, maxPages: 5});
    await overflow.next();
    await expect(overflow.next()).rejects.toThrow('Limite');
  });
  it('valida identidade, versão e números do cursor; não reutiliza cursor de outra consulta', () => {
    const value = {version: 1, resource: '/despesas', params: {mes: 1, ano: 2026}, nextPage: 3, itemsCount: 200, finished: false};
    expect(readPageProgress(value, '/despesas', {ano: 2026, mes: 1})).toMatchObject({nextPage: 3, itemsCount: 200});
    expect(readPageProgress({}, '/despesas', {})).toMatchObject({nextPage: 1, itemsCount: 0, finished: false});
    expect(() => readPageProgress(value, '/outro', {})).toThrow('progresso');
    expect(() => readPageProgress({...value, nextPage: 0}, '/despesas', {ano: 2026, mes: 1})).toThrow('progresso');
  });
  it('não interpreta resposta malformada como período vazio concluído', async () => {
    const pages = iteratePages(async () => ({}));
    await expect(pages.next()).rejects.toThrow('lista de dados válida');
  });
});

describe('confirmação da página', () => {
  const progress = {version: 1 as const, resource: '/despesas', params: {}, nextPage: 2, itemsCount: 100, finished: false};
  const setup = (cancelled = false) => {
    const events: string[] = [];
    const query = vi.fn(async (sql: string) => {events.push(sql); return {rows: [], rowCount: cancelled && sql.includes('UPDATE ingestion_checkpoints') ? 0 : 1};});
    const release = vi.fn();
    const pool = {connect: async () => ({query, release})};
    return {events, query, release, pool};
  };
  it('só confirma o cursor depois da persistência, na mesma transação', async () => {
    const {pool, events, release} = setup();
    await commitCheckpointPage(pool as any, 'cp', progress, async client => {await client.query('DOMAIN'); await client.query('RAW');}, async () => {});
    expect(events[0]).toBe('BEGIN');
    expect(events[1]).toBe('DOMAIN'); expect(events[2]).toBe('RAW');
    expect(events[3]).toContain('UPDATE ingestion_checkpoints');
    expect(events.at(-1)).toBe('COMMIT'); expect(release).toHaveBeenCalledOnce();
  });
  it('falha de persistência faz rollback e não avança o cursor', async () => {
    const {pool, events, release} = setup();
    await expect(commitCheckpointPage(pool as any, 'cp', progress, async () => {throw new Error('raw falhou');}, async () => {})).rejects.toThrow('raw falhou');
    expect(events).toEqual(['BEGIN', 'ROLLBACK']); expect(release).toHaveBeenCalledOnce();
  });
  it('cancelamento durante a página impede confirmação', async () => {
    const {pool, events} = setup(true);
    await expect(commitCheckpointPage(pool as any, 'cp', progress, async client => {await client.query('DOMAIN');}, async () => {})).rejects.toBeInstanceOf(IngestionCancelledError);
    expect(events.at(-1)).toBe('ROLLBACK'); expect(events).not.toContain('COMMIT');
  });
});
