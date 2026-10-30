import React from 'react';
import {cn} from '../../lib/utils';
import {brlCompact, mesCurto, tituloCategoria, type GastoMensal, type Indicadores, type MediaCamara} from '../../lib/indicadores';

/**
 * Raio-X da cota parlamentar: gastos por categoria do parlamentar com um marcador da média da Câmara
 * e o histórico mensal recente. Categorias acima da média ficam em laranja; abaixo, em azul.
 */
export const RaioXGastos: React.FC<{indicadores: Indicadores | null; media: MediaCamara; loading: boolean}> = ({indicadores, media, loading}) => {
  const categorias = (indicadores?.gastosCategorias ?? []).slice(0, 7);
  const mediaPorTipo = new Map<string, number>((media?.categorias ?? []).map((c) => [c.tipo, c.media] as [string, number]));
  const max = Math.max(1, ...categorias.map((c) => Math.max(c.total, mediaPorTipo.get(c.tipo) ?? 0)));
  const mensal = indicadores?.gastosMensais ?? [];
  const maxMensal = Math.max(1, ...mensal.map((m) => m.total));
  const pico: GastoMensal | null = mensal.reduce((best: GastoMensal | null, m: GastoMensal) => (!best || m.total > best.total ? m : best), null);

  return (
    <div className="surface p-5 sm:p-6">
      <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Raio-X dos gastos</h3>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        Despesas por categoria. O traço escuro marca a média da Câmara.
      </p>

      {loading && !indicadores ? (
        <div className="mt-6 space-y-4" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((key) => (
            <div key={key} className="space-y-1.5">
              <div className="skeleton h-3 w-40" />
              <div className="skeleton h-3" style={{width: `${85 - key * 12}%`}} />
            </div>
          ))}
        </div>
      ) : categorias.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          Sem despesas registradas na base para este parlamentar.
        </p>
      ) : (
        <ul className="mt-6 space-y-4">
          {categorias.map((categoria) => {
            const mediaTipo = mediaPorTipo.get(categoria.tipo);
            const diff = mediaTipo ? Math.round(((categoria.total - mediaTipo) / mediaTipo) * 100) : null;
            const acima = diff !== null && diff > 0;
            return (
              <li key={categoria.tipo} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5">
                <span className="truncate text-sm text-slate-800 dark:text-slate-200">{tituloCategoria(categoria.tipo)}</span>
                <span className="tabular text-right font-mono text-xs text-slate-700 dark:text-slate-300">
                  {brlCompact.format(categoria.total)}
                  {diff !== null && (
                    <span className={cn('ml-2', acima ? 'text-orange-700 dark:text-orange-300' : 'text-emerald-700 dark:text-emerald-300')}>
                      {acima ? '+' : ''}
                      {diff}%
                    </span>
                  )}
                </span>
                <span className="relative col-span-2 block h-3" aria-hidden="true">
                  <span
                    className={cn('grow-bar absolute inset-y-0 left-0 rounded-full', acima ? 'bg-orange-400 dark:bg-orange-500' : 'bg-brand-500 dark:bg-brand-400')}
                    style={{width: `${Math.max(1, (categoria.total / max) * 100)}%`}}
                  />
                  {mediaTipo ? (
                    <span className="absolute -top-1 h-5 w-0.5 rounded bg-slate-900 dark:bg-white" style={{left: `${Math.min(99.5, (mediaTipo / max) * 100)}%`}} />
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {mensal.length > 1 && (
        <div className="mt-8 border-t border-slate-100 pt-5 dark:border-slate-800">
          <div className="flex items-baseline justify-between gap-3">
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-50">Mês a mês</h4>
            {pico && (
              <span className="text-xs text-slate-600 dark:text-slate-400">
                Pico em {mesCurto(pico.mes)}/{pico.ano}: <span className="tabular font-mono font-semibold text-slate-900 dark:text-slate-50">{brlCompact.format(pico.total)}</span>
              </span>
            )}
          </div>
          <div className="mt-4 flex h-28 items-end gap-1.5" role="img" aria-label="Gastos mensais recentes">
            {mensal.map((m) => (
              <div key={`${m.ano}-${m.mes}`} className="flex flex-1 flex-col items-center gap-1">
                <span
                  className={cn('w-full rounded-t-[4px]', m === pico ? 'bg-brand-600 dark:bg-brand-400' : 'bg-brand-200 dark:bg-brand-800')}
                  style={{height: `${Math.max(3, (m.total / maxMensal) * 92)}px`}}
                  title={`${mesCurto(m.mes)}/${m.ano}: ${brlCompact.format(m.total)}`}
                />
                <span className="text-[10px] text-slate-500 dark:text-slate-400">{mesCurto(m.mes)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
