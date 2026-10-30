import type {JudicialAdminProfile} from './judicialTypes';

export type JudicialAdminFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type JudicialSaveRequest = {url: string; body: {expectedVersion: number; [key: string]: unknown}; recordId?: string};
type ActionState = {status: 'idle' | 'pending' | 'uncertain'; message: string; conflict?: boolean; saved?: boolean; request?: JudicialSaveRequest};
type Entry = {state: ActionState; listeners: Set<() => void>};
// The fetch function is scoped to one authenticated AdminPanel mount. All entry
// points for the same politician share a pending/uncertain operation across tabs.
const sessions = new WeakMap<JudicialAdminFetch, Map<string, Entry>>();
function entry(fetcher: JudicialAdminFetch, politician: string): Entry {
  let session = sessions.get(fetcher);
  if (!session) {session = new Map(); sessions.set(fetcher, session);}
  let value = session.get(politician);
  if (!value) {value = {state: {status: 'idle', message: ''}, listeners: new Set()}; session.set(politician, value);}
  return value;
}
function publish(value: Entry, state: ActionState) {value.state = state; value.listeners.forEach(listener => listener());}
export function getJudicialAction(fetcher: JudicialAdminFetch, politician: string) {return entry(fetcher, politician).state;}
export function subscribeJudicialAction(fetcher: JudicialAdminFetch, politician: string, listener: () => void) {
  const value = entry(fetcher, politician); value.listeners.add(listener);
  return () => {value.listeners.delete(listener);};
}
export async function saveJudicialAction(fetcher: JudicialAdminFetch, politician: string, request: JudicialSaveRequest, retry = false) {
  const value = entry(fetcher, politician);
  if (value.state.status === 'pending' || (value.state.status === 'uncertain' && !retry)) return;
  // Retries reuse the exact original id, expected version and body.
  const operation = value.state.status === 'uncertain' ? value.state.request! : request;
  publish(value, {status: 'pending', message: 'Salvando registro…', request: operation});
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 40_000);
  try {
    const response = await fetcher(operation.url, {
      method: 'PUT', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(operation.body), signal: controller.signal,
    });
    const result = await response.json();
    if (response.ok) publish(value, {status: 'idle', saved: true, message: 'Alteração salva. Consulte a situação atual abaixo.'});
    else if (response.status < 500) publish(value, {
      status: 'idle', message: result.error ?? 'Não foi possível salvar. Confira os dados.', conflict: response.status === 409,
    });
    else throw new Error('Resposta inconclusiva do servidor');
  } catch {
    publish(value, {status: 'uncertain', request: operation, message: 'Não foi possível confirmar o resultado. Confira o registro antes de fazer outra alteração.'});
  } finally {clearTimeout(timeout);}
}
export function reconcileJudicialAction(fetcher: JudicialAdminFetch, politician: string, profile: JudicialAdminProfile) {
  const value = entry(fetcher, politician);
  if (value.state.status !== 'uncertain' || !value.state.request) return false;
  const request = value.state.request;
  const current = request.recordId ? profile.records.find(record => record.id === request.recordId) : profile.summary.coverage;
  if (current && current.version > request.body.expectedVersion) {
    publish(value, {status: 'idle', message: 'Há uma versão gravada no servidor. Confira os dados atuais antes de continuar.'});
    return true;
  }
  return false;
}
