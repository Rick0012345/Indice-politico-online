import {describe, expect, it, vi} from 'vitest';
import {acquireIngestionLock, createCancellationGuard, loadIngestionExecution, runIngestion} from './ingestionLifecycle';
import {resolveGroqSettings} from './groqSettings';

describe('contratos de ingestão', () => {
  it('consulta atividade sem adquirir locks ou alterar checkpoints, restringindo o banco atual', async () => {
    const query = vi.fn().mockResolvedValue({rows: [{maintenanceActive: true}]});
    expect(await loadIngestionExecution({query} as any, false)).toEqual({processActive: false, maintenanceActive: true});
    const [sql, values] = query.mock.calls[0];
    expect(sql).toContain('pg_locks');
    expect(sql).toContain('current_database()');
    expect(sql).not.toMatch(/pg_try_advisory_lock|UPDATE|DELETE|INSERT/);
    expect(values).toEqual([7710042]);
    expect(await loadIngestionExecution({query} as any, true)).toMatchObject({processActive: true});
  });
  it('dry run não abre conexão nem executa mutações', async () => {
    const connect = vi.fn(); const execute = vi.fn();
    await runIngestion({connect} as any, true, execute);
    expect(connect).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });
  it('expõe o PID da sessão dona do lock para identificar a execução correta', async () => {
    const query=vi.fn().mockResolvedValue({rows:[{acquired:true,pid:321}]});
    let owner:unknown;
    await runIngestion({connect:async()=>({query,release:vi.fn()})} as any,false,async lock=>{owner=lock.pid;});
    expect(owner).toBe(321);
    expect(query.mock.calls[0][0]).toContain('pg_backend_pid()');
  });
  it('mantém lock na sessão até release e devolve conexão quando ocupado', async () => {
    const query = vi.fn().mockResolvedValueOnce({rows:[{acquired:true}]}).mockResolvedValue({rows:[]});
    const release = vi.fn(); const client = {query,release};
    const lock = await acquireIngestionLock({connect: async () => client} as any);
    expect(release).not.toHaveBeenCalled();
    await lock!.release(); await lock!.release();
    expect(query).toHaveBeenLastCalledWith('SELECT pg_advisory_unlock($1)', [7710042]);
    expect(release).toHaveBeenCalledTimes(1);
    query.mockResolvedValueOnce({rows:[{acquired:false}]});
    expect(await acquireIngestionLock({connect: async () => client} as any)).toBeNull();
    expect(release).toHaveBeenCalledTimes(2);
  });
  it('cancelamento impede a próxima fronteira e permanece cancelado', async () => {
    const check = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const guard = createCancellationGuard(check);
    await guard(); await expect(guard()).rejects.toThrow('cancelada');
    await expect(guard()).rejects.toThrow('cancelada'); expect(check).toHaveBeenCalledTimes(2);
  });
  it('não libera a sessão antes de a operação em andamento drenar', async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const release = vi.fn();
    const query = vi.fn().mockResolvedValue({rows:[{acquired:true}]});
    const running = runIngestion({connect: async () => ({query,release})} as any, false, () => pending);
    await vi.waitFor(() => expect(query).toHaveBeenCalled());
    expect(release).not.toHaveBeenCalled();
    finish(); await running;
    expect(release).toHaveBeenCalledOnce();
  });
  it('banco desativa IA e prevalece sobre modelo de ambiente; chave só vem do ambiente', () => {
    expect(resolveGroqSettings(new Map([['groq_enabled','false'],['groq_model','modelo-banco']]), {GROQ_API_KEY:' segredo ',GROQ_MODEL:'ambiente'})).toEqual({enabled:false,groqModel:'modelo-banco',groqApiKey:'segredo'});
    expect(resolveGroqSettings(new Map(), {})).toEqual({enabled:true,groqModel:'llama-3.3-70b-versatile',groqApiKey:''});
  });
});
