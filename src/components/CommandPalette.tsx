import React, {useEffect, useId, useMemo, useRef, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {
  ArrowRight,
  BookOpen,
  Building2,
  CornerDownLeft,
  Home as HomeIcon,
  Info,
  Landmark,
  Search,
  Settings2,
  Trophy,
  UserRound,
  Users,
} from 'lucide-react';
import {cn} from '../lib/utils';

type PaletteResult = {
  id: string;
  kind: 'politico' | 'pagina';
  title: string;
  subtitle: string;
  to: string;
  foto?: string | null;
  icon?: React.ComponentType<{size?: number; className?: string}>;
};

const pages: PaletteResult[] = [
  {id: 'p-home', kind: 'pagina', title: 'Início', subtitle: 'Panorama geral', to: '/', icon: HomeIcon},
  {id: 'p-ranking', kind: 'pagina', title: 'Ranking parlamentar', subtitle: 'Notas, gastos e votações', to: '/ranking', icon: Trophy},
  {id: 'p-comparar', kind: 'pagina', title: 'Comparador', subtitle: 'Até 3 parlamentares lado a lado', to: '/comparar', icon: Users},
  {id: 'p-partidos', kind: 'pagina', title: 'Partidos', subtitle: 'Gastos e composição por sigla', to: '/partidos', icon: Building2},
  {id: 'p-camara', kind: 'pagina', title: 'Câmara', subtitle: 'Proposições, eventos e frentes', to: '/camara', icon: Landmark},
  {id: 'p-metodologia', kind: 'pagina', title: 'Metodologia', subtitle: 'Como os índices são calculados', to: '/metodologia', icon: BookOpen},
  {id: 'p-sobre', kind: 'pagina', title: 'Sobre o projeto', subtitle: 'Quem somos e fontes', to: '/sobre', icon: Info},
  {id: 'p-admin', kind: 'pagina', title: 'Admin', subtitle: 'Ingestão e configurações', to: '/admin', icon: Settings2},
];

const normalize = (value: string) =>
  value
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

export const CommandPalette: React.FC<{open: boolean; onClose: () => void}> = ({open, onClose}) => {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState('');
  const [politicos, setPoliticos] = useState<PaletteResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const trimmed = query.trim();

  useEffect(() => {
    if (!open || trimmed.length < 2) {
      setPoliticos([]);
      setLoading(false);
      setFailed(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    const timeout = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/politicos?search=${encodeURIComponent(trimmed)}&limit=6&status=todos`,
          {signal: controller.signal},
        );
        if (!response.ok) throw new Error('HTTP');
        const data = (await response.json()) as {
          items?: Array<{id?: unknown; nome?: unknown; partido?: unknown; estado?: unknown; foto?: unknown}>;
        };
        if (controller.signal.aborted) return;
        setPoliticos(
          (data.items ?? [])
            .filter((item) => typeof item.id === 'string' && typeof item.nome === 'string')
            .map((item) => ({
              id: `pol-${item.id as string}`,
              kind: 'politico' as const,
              title: item.nome as string,
              subtitle: [item.partido, item.estado].filter((part) => typeof part === 'string' && part).join(' / '),
              to: `/politico/${item.id as string}`,
              foto: typeof item.foto === 'string' ? item.foto : null,
            })),
        );
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 180);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [open, trimmed]);

  const filteredPages = useMemo(() => {
    if (!trimmed) return pages;
    const needle = normalize(trimmed);
    return pages.filter((page) => normalize(`${page.title} ${page.subtitle}`).includes(needle));
  }, [trimmed]);

  const results = useMemo(() => [...politicos, ...filteredPages], [politicos, filteredPages]);

  useEffect(() => {
    setActive((current) => Math.min(current, Math.max(results.length - 1, 0)));
  }, [results.length]);

  if (!open) return null;

  const go = (result: PaletteResult | undefined) => {
    if (!result) return;
    onClose();
    navigate(result.to);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => (results.length ? (current + 1) % results.length : 0));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => (results.length ? (current - 1 + results.length) % results.length : 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      go(results[active]);
    }
  };

  const renderGroup = (label: string, items: PaletteResult[], offset: number) =>
    items.length > 0 ? (
      <div className="py-2">
        <p className="px-4 pb-1 text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
        {items.map((item, index) => {
          const position = offset + index;
          const Icon = item.icon ?? UserRound;
          const isActive = position === active;
          return (
            <button
              key={item.id}
              id={`${listId}-${position}`}
              type="button"
              role="option"
              aria-selected={isActive}
              onMouseMove={() => setActive(position)}
              onClick={() => go(item)}
              className={cn(
                'mx-2 flex w-[calc(100%-1rem)] items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors',
                isActive ? 'bg-brand-50 dark:bg-brand-950/60' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60',
              )}
            >
              {item.kind === 'politico' ? (
                item.foto ? (
                  <img src={item.foto} alt="" className="h-9 w-9 rounded-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800">
                    <UserRound size={16} />
                  </span>
                )
              ) : (
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  <Icon size={16} />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-slate-900 dark:text-slate-50">{item.title}</span>
                <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{item.subtitle}</span>
              </span>
              {isActive ? <CornerDownLeft size={14} className="text-brand-600 dark:text-brand-300" /> : <ArrowRight size={14} className="text-slate-300 dark:text-slate-600" />}
            </button>
          );
        })}
      </div>
    ) : null;

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[12vh]" onKeyDown={onKeyDown}>
      <button
        type="button"
        aria-label="Fechar busca"
        tabIndex={-1}
        className="absolute inset-0 cursor-default bg-slate-950/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Busca rápida"
        className="palette-in relative w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/20 dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="flex items-center gap-3 border-b border-slate-100 px-4 dark:border-slate-800">
          <Search size={18} className="text-slate-400" />
          <label htmlFor={`${listId}-input`} className="sr-only">
            Buscar parlamentar ou página
          </label>
          <input
            id={`${listId}-input`}
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            role="combobox"
            aria-expanded="true"
            aria-controls={`${listId}-list`}
            aria-activedescendant={results.length ? `${listId}-${active}` : undefined}
            placeholder="Nome do deputado, partido, UF ou página"
            className="h-14 flex-1 bg-transparent text-base text-slate-900 outline-none placeholder:text-slate-500 dark:text-slate-50 dark:placeholder:text-slate-400"
          />
          <span className="kbd">Esc</span>
        </div>

        <div id={`${listId}-list`} role="listbox" className="max-h-[min(60vh,440px)] overflow-y-auto pb-2">
          {loading && politicos.length === 0 ? (
            <div className="space-y-2 px-4 py-3" aria-hidden="true">
              {[0, 1, 2].map((key) => (
                <div key={key} className="flex items-center gap-3">
                  <div className="skeleton h-9 w-9 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <div className="skeleton h-3 w-1/2" />
                    <div className="skeleton h-2.5 w-1/4" />
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {failed ? (
            <p className="px-4 py-3 text-sm text-rose-700 dark:text-rose-300">Não foi possível buscar parlamentares agora.</p>
          ) : null}
          {renderGroup('Parlamentares', politicos, 0)}
          {renderGroup('Páginas', filteredPages, politicos.length)}
          {!loading && results.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">Nada encontrado para “{trimmed}”</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Tente o sobrenome, a sigla do partido ou a UF.</p>
            </div>
          ) : null}
        </div>

        <div className="flex items-center gap-4 border-t border-slate-100 bg-slate-50/80 px-4 py-2.5 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400">
          <span className="flex items-center gap-1.5"><span className="kbd">↑</span><span className="kbd">↓</span> navegar</span>
          <span className="flex items-center gap-1.5"><span className="kbd">Enter</span> abrir</span>
        </div>
      </div>
    </div>
  );
};
