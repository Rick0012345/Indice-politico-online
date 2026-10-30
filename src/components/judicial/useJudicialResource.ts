import {useEffect, useState} from 'react';
import {useCatalogRefresh} from '../../hooks/useCatalogRefresh';

/** Shared public read lifecycle: discard old contexts, abort, retry and catalog refresh. */
export function useJudicialResource<T>(url: string) {
  const [result, setResult] = useState<{url: string; data?: T; error?: string; loading: boolean}>({url, loading: true});
  const [attempt, setAttempt] = useState(0);
  const loading = result.url !== url || result.loading;
  const {revision} = useCatalogRefresh(url, loading);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setResult({url, loading: true});
    const timer = window.setTimeout(() => {
      if (!active) return;
      controller.abort();
      setResult({url, loading: false, error: 'A consulta demorou mais que o esperado. Tente novamente.'});
    }, 20_000);
    void fetch(url, {signal: controller.signal}).then(async response => {
      if (!response.ok) throw new Error('request');
      return await response.json() as T;
    }).then(data => {
      if (active && !controller.signal.aborted) setResult({url, loading: false, data});
    }).catch(() => {
      if (active && !controller.signal.aborted) setResult({url, loading: false, error: 'Não foi possível consultar os registros judiciais.'});
    }).finally(() => window.clearTimeout(timer));
    return () => {active = false; window.clearTimeout(timer); controller.abort();};
  }, [url, attempt, revision]);
  return {...(result.url === url ? result : {url, loading: true}), retry: () => setAttempt(value => value + 1)};
}
