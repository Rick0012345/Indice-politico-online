import {useEffect, useRef, useState} from 'react';
import {useCatalogUpdates} from './useCatalogUpdates';

// Defer invalidation until the current page/refresh finishes, rather than
// cancelling pagination or fetching the same resource concurrently.
export function useCatalogRefresh(context: string, busy: boolean) {
  const [revision, setRevision] = useState(0);
  const state = useRef({context, busy, refreshing: false});
  if (state.current.context !== context) state.current = {context, busy, refreshing: false};
  state.current.busy = busy;
  const pending = useRef<Array<{context: string; resolve: () => void}>>([]);
  const refresh = () => {
    const waiting = pending.current;
    pending.current = [];
    if (waiting.some(item => item.context === state.current.context)) {
      state.current.refreshing = true;
      setRevision(value => value + 1);
    }
    waiting.forEach(item => item.resolve());
  };
  useCatalogUpdates(() => new Promise<void>(resolve => {
    pending.current.push({context: state.current.context, resolve});
    if (!state.current.busy) refresh();
  }));
  useEffect(() => {if (!busy && pending.current.length) refresh();});
  useEffect(() => () => {
    pending.current.forEach(item => item.resolve());
    pending.current = [];
  }, []);
  return {revision, refreshing: state.current.refreshing};
}
