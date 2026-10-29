// @vitest-environment node
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import type {Server} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import express from 'express';
import {Pool} from 'pg';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {CatalogEvents,attachCatalogRoutes} from './catalogEvents';
import {startCatalogListener} from './catalogListener';

const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('eventos verdadeiros do catálogo em schema isolado',()=>{
  const schema=`live_test_${randomUUID().replaceAll('-','')}`;
  const hub=new CatalogEvents(25);
  let pool:Pool;let admin:Pool;let server:Server;let base:string;let stop:()=>void;
  const controllers:AbortController[]=[];
  beforeAll(async()=>{
    admin=new Pool({connectionString:url});
    await admin.query(`CREATE SCHEMA ${schema}`);
    for(const table of ['politicos','despesas','votos_deputados','avaliacoes']) {
      await admin.query(`CREATE TABLE ${schema}.${table} (id integer PRIMARY KEY)`);
    }
    const connection=new URL(url!);
    connection.searchParams.set('options',`-c search_path=${schema},public`);
    connection.searchParams.set('application_name',schema);
    pool=new Pool({connectionString:connection.toString()});
    const migration=await readFile('prisma/migrations/20261028160000_catalog_live_events/migration.sql','utf8');
    await pool.query(migration);
    const before=hub.revision;stop=startCatalogListener(pool,hub,25);
    await vi.waitFor(()=>expect(hub.revision).not.toBe(before));
    const app=express();attachCatalogRoutes(app,hub);
    server=app.listen(0,'127.0.0.1');
    await new Promise<void>(resolve=>server.once('listening',resolve));
    base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  },15000);
  afterAll(async()=>{
    controllers.forEach(c=>c.abort());stop?.();hub.close();
    server?.closeAllConnections();
    if(server) await new Promise<void>(resolve=>server.close(()=>resolve()));
    await pool?.end();
    await admin?.query(`DROP SCHEMA ${schema} CASCADE`);await admin?.end();
  });
  const openStream=async()=>{
    const controller=new AbortController();controllers.push(controller);
    const response=await fetch(`${base}/api/catalogo/events`,{signal:controller.signal});
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    const reader=response.body!.getReader();const decoder=new TextDecoder();let buffer='';
    const next=async():Promise<string>=>{
      for(;;){
        const boundary=buffer.indexOf('\n\n');
        if(boundary>=0){const frame=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);const data=frame.match(/^data: (.+)$/m);if(data)return JSON.parse(data[1]).revision;continue;}
        const read=await reader.read();if(read.done)throw new Error('SSE encerrado');buffer+=decoder.decode(read.value,{stream:true});
      }
    };
    return {next,controller};
  };
  it('entrega snapshot, ignora rollback/outro schema e avisa dois clientes após commit',async()=>{
    const a=await openStream();const b=await openStream();
    const initial=await a.next();expect(await b.next()).toBe(initial);
    const writer=await pool.connect();
    try {await writer.query('BEGIN');await writer.query('INSERT INTO politicos VALUES (1)');await writer.query('ROLLBACK');}
    finally{writer.release();}
    await pool.query("SELECT pg_notify('catalogo_changes','outro_schema')");
    await delay(100);expect(hub.revision).toBe(initial);
    await pool.query('INSERT INTO politicos VALUES (1),(2)');
    const revision=await a.next();expect(revision).not.toBe(initial);expect(await b.next()).toBe(revision);
    expect(await (await fetch(`${base}/api/catalogo/revision`)).json()).toEqual({revision});
    a.controller.abort();b.controller.abort();
    await vi.waitFor(()=>expect(hub.size).toBe(0));
  });
  it.each(['despesas','votos_deputados','avaliacoes'])('avisa atualização e exclusão de %s',async table=>{
    await pool.query(`INSERT INTO ${table} VALUES (10)`);
    await delay(75);const initial=hub.revision;
    await pool.query(`UPDATE ${table} SET id=11 WHERE id=10`);
    await vi.waitFor(()=>expect(hub.revision).not.toBe(initial));
    const updated=hub.revision;await pool.query(`DELETE FROM ${table} WHERE id=11`);
    await vi.waitFor(()=>expect(hub.revision).not.toBe(updated));
  });
  it('reconecta o LISTEN e força reconciliação após perda da sessão',async()=>{
    const initial=hub.revision;
    const sessions=await admin.query("SELECT pid FROM pg_stat_activity WHERE application_name=$1 AND query='LISTEN catalogo_changes'",[schema]);
    expect(sessions.rows).toHaveLength(1);
    await admin.query('SELECT pg_terminate_backend($1)',[sessions.rows[0].pid]);
    await vi.waitFor(()=>expect(hub.revision).not.toBe(initial),{timeout:3000});
    const reconnected=hub.revision;await pool.query('INSERT INTO politicos VALUES (3)');
    await vi.waitFor(()=>expect(hub.revision).not.toBe(reconnected));
  });
});
