import {describe, it, expect, vi} from 'vitest';
import {getJudicialAction, saveJudicialAction, reconcileJudicialAction} from './judicialAdminActions';

const request = {url: '/api/admin/judicial/politicos/1/records/abc', body: {expectedVersion: 0, title: 'Documento de teste'}, recordId: 'abc'};
describe('envio administrativo judicial compartilhado', () => {
  it('bloqueia outro envio do mesmo político enquanto a operação está pendente', async () => {
    let finish!: (response: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>(resolve => {finish = resolve;}));
    const first = saveJudicialAction(fetcher, '1', request);
    expect(getJudicialAction(fetcher, '1').status).toBe('pending');
    await saveJudicialAction(fetcher, '1', request);
    expect(fetcher).toHaveBeenCalledTimes(1);
    finish(new Response(JSON.stringify({id: 'abc', version: 1}), {status: 200}));
    await first;
    expect(getJudicialAction(fetcher, '1').status).toBe('idle');
  });

  it('mantém resultado incerto e reconcilia apenas após encontrar a versão gravada', async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError('Network error'));
    await saveJudicialAction(fetcher, '1', request);
    expect(getJudicialAction(fetcher, '1').status).toBe('uncertain');
    expect(reconcileJudicialAction(fetcher, '1', {records: [], summary: {coverage: {version: 0}}} as any)).toBe(false);
    expect(getJudicialAction(fetcher, '1').status).toBe('uncertain');
    expect(reconcileJudicialAction(fetcher, '1', {records: [{id: 'abc', version: 1}], summary: {coverage: {version: 0}}} as any)).toBe(true);
    expect(getJudicialAction(fetcher, '1').status).toBe('idle');
  });

  it('permite repetir somente o mesmo envio quando o resultado é incerto', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('Network error')).mockResolvedValue(new Response('{}'));
    await saveJudicialAction(fetcher, '1', request);
    await saveJudicialAction(fetcher, '1', {...request, recordId: 'other'});
    expect(fetcher).toHaveBeenCalledTimes(1);
    await saveJudicialAction(fetcher, '1', request, true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual(request.body);
  });

  it('informa conflito de versão sem repetir automaticamente', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({error: 'Registro atualizado por outra sessão.'}), {status: 409}));
    await saveJudicialAction(fetcher, '1', request);
    expect(getJudicialAction(fetcher, '1')).toMatchObject({status: 'idle', message: 'Registro atualizado por outra sessão.', conflict: true});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
