import React, {createContext, useCallback, useContext, useEffect, useMemo, useState} from 'react';

export const COMPARE_LIMIT = 3;
const STORAGE_KEY = 'cp:comparar';

export type CompareEntry = {
  id: string;
  nome: string;
  partido?: string;
  estado?: string;
  foto?: string | null;
};

type CompareState = {
  items: CompareEntry[];
  has: (id: string) => boolean;
  toggle: (entry: CompareEntry) => void;
  remove: (id: string) => void;
  clear: () => void;
  isFull: boolean;
};

const readStored = (): CompareEntry[] => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is CompareEntry => Boolean(item) && typeof item.id === 'string' && typeof item.nome === 'string')
      .slice(0, COMPARE_LIMIT);
  } catch {
    return [];
  }
};

const useCompareState = (persist: boolean): CompareState => {
  const [items, setItems] = useState<CompareEntry[]>(() => (persist ? readStored() : []));

  useEffect(() => {
    if (!persist) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // Armazenamento indisponível (aba anônima, bloqueio): a seleção continua só em memória.
    }
  }, [items, persist]);

  const has = useCallback((id: string) => items.some((item) => item.id === id), [items]);
  const toggle = useCallback((entry: CompareEntry) => {
    setItems((current) => {
      if (current.some((item) => item.id === entry.id)) return current.filter((item) => item.id !== entry.id);
      if (current.length >= COMPARE_LIMIT) return current;
      return [...current, entry];
    });
  }, []);
  const remove = useCallback((id: string) => setItems((current) => current.filter((item) => item.id !== id)), []);
  const clear = useCallback(() => setItems([]), []);

  return useMemo(
    () => ({items, has, toggle, remove, clear, isFull: items.length >= COMPARE_LIMIT}),
    [items, has, toggle, remove, clear],
  );
};

const CompareContext = createContext<CompareState | null>(null);

export const CompareProvider: React.FC<{children: React.ReactNode}> = ({children}) => {
  const state = useCompareState(true);
  return <CompareContext.Provider value={state}>{children}</CompareContext.Provider>;
};

/** Seleção global de parlamentares para o comparador. Fora do provider, funciona só em memória. */
export const useCompare = (): CompareState => {
  const context = useContext(CompareContext);
  const local = useCompareState(false);
  return context ?? local;
};

export const compareHref = (ids: string[]) => (ids.length ? `/comparar?ids=${ids.join(',')}` : '/comparar');
