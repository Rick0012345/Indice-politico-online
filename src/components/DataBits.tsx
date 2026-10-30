import React from 'react';
import {Link} from 'react-router-dom';
import {ArrowRight, X} from 'lucide-react';
import {cn} from '../lib/utils';
import {compareHref, COMPARE_LIMIT, useCompare} from '../lib/compare';
import {iniciais, mesCurto, type GastoMensal} from '../lib/indicadores';

/** Minigráfico de barras dos gastos mensais (sem trilho de fundo). O último mês fica em destaque. */
export const Sparkline: React.FC<{data: GastoMensal[]; label: string; className?: string}> = ({data, label, className}) => {
  if (data.length === 0) {
    return <span className="text-xs text-slate-500 dark:text-slate-400">sem despesas</span>;
  }
  const max = Math.max(...data.map((d) => d.total), 1);
  const resumo = data.map((d) => `${mesCurto(d.mes)}/${String(d.ano).slice(2)}`).join(', ');
  return (
    <span role="img" aria-label={`${label}: gastos mensais de ${resumo}`} className={cn('flex h-7 items-end gap-[2px]', className)}>
      {data.map((d, index) => (
        <span
          key={`${d.ano}-${d.mes}`}
          className={cn(
            'w-[5px] rounded-[2px]',
            index === data.length - 1 ? 'bg-brand-600 dark:bg-brand-400' : 'bg-brand-200 dark:bg-brand-800',
          )}
          style={{height: `${Math.max(3, Math.round((d.total / max) * 28))}px`}}
        />
      ))}
    </span>
  );
};

export const Avatar: React.FC<{nome: string; foto?: string | null; size?: number; className?: string}> = ({
  nome,
  foto,
  size = 40,
  className,
}) =>
  foto ? (
    <img
      src={foto}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      className={cn('shrink-0 rounded-full bg-slate-100 object-cover ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700', className)}
      style={{width: size, height: size}}
    />
  ) : (
    <span
      aria-hidden="true"
      className={cn('flex shrink-0 items-center justify-center rounded-full bg-slate-100 font-semibold text-slate-600 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700', className)}
      style={{width: size, height: size, fontSize: Math.round(size * 0.34)}}
    >
      {iniciais(nome)}
    </span>
  );

/** Barra flutuante com os parlamentares escolhidos para comparar. Some quando a seleção está vazia. */
export const CompareTray: React.FC = () => {
  const {items, remove, clear} = useCompare();
  if (items.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
      <div className="palette-in pointer-events-auto flex max-w-full flex-wrap items-center gap-3 rounded-2xl bg-slate-900 py-2 pl-4 pr-2 text-white shadow-2xl shadow-slate-900/30 dark:bg-slate-800 dark:ring-1 dark:ring-slate-700">
        <span className="text-sm">
          <span className="tabular font-mono font-semibold">{items.length}</span> de {COMPARE_LIMIT} para comparar
        </span>
        <ul className="flex flex-wrap gap-1.5">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-1.5 rounded-full bg-white/10 py-1 pl-1 pr-1 text-sm">
              <Avatar nome={item.nome} foto={item.foto} size={22} className="ring-0" />
              <span className="max-w-[140px] truncate">{item.nome}</span>
              <button
                type="button"
                onClick={() => remove(item.id)}
                aria-label={`Tirar ${item.nome} da comparação`}
                className="flex h-6 w-6 items-center justify-center rounded-full text-slate-300 hover:bg-white/15 hover:text-white"
              >
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
        <button type="button" onClick={clear} className="rounded-lg px-2 py-1.5 text-xs text-slate-300 hover:text-white">
          Limpar
        </button>
        <Link
          to={compareHref(items.map((item) => item.id))}
          className="inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-100 active:scale-[0.98]"
        >
          Abrir comparador <ArrowRight size={15} />
        </Link>
      </div>
    </div>
  );
};
