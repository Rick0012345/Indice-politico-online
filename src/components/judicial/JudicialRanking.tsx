import React from 'react';
import {Link, useSearchParams} from 'react-router-dom';
import {judicialCategories, type JudicialCategory, type JudicialRankingResponse} from '../../lib/judicialTypes';
import {politicoStatusOptions} from '../../lib/politicoStatus';
import {JudicialFeedback, PrisonHistory, judicialCount} from './JudicialDetails';
import {useJudicialResource} from './useJudicialResource';
import {useDebouncedValue} from '../../hooks/useDebouncedValue';

const control = 'mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100';
export function JudicialRanking() {
  const [params, setParams] = useSearchParams();
  const rawCategory = params.get('category');
  const category: JudicialCategory = rawCategory && Object.hasOwn(judicialCategories, rawCategory) ? rawCategory as JudicialCategory : 'CRIMINAL';
  const prisonOnly = params.get('prisonOnly') === 'true';
  const status = politicoStatusOptions.some(option => option.value === params.get('status')) ? params.get('status')! : 'ativo';
  const search = params.get('search') || '';
  const debouncedSearch = useDebouncedValue(search);
  const direction = params.get('direction') === 'asc' ? 'asc' : 'desc';
  const rawOffset = Number(params.get('offset'));
  const offset = Number.isSafeInteger(rawOffset) && rawOffset > 0 ? rawOffset : 0;
  const query = new URLSearchParams({category, prisonOnly: String(prisonOnly), status, search: debouncedSearch, direction, limit: '50', offset: String(offset)});
  const {data, loading: resourceLoading, error, retry} = useJudicialResource<JudicialRankingResponse>(`/api/judicial/ranking?${query}`);
  const loading = resourceLoading || search !== debouncedSearch;
  const update = (key: string, value: string) => {
    setParams(previous => {const next = new URLSearchParams(previous); next.set('view', 'judicial'); next.set(key, value); if (key !== 'offset') next.delete('offset'); return next;});
  };
  return <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 pb-20 text-slate-900 sm:px-6 lg:px-8 dark:text-slate-100">
    <header><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Ranking de condenações definitivas</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-400">Registros encontrados por categoria em fontes oficiais. Condenações sujeitas a recurso, anuladas ou revertidas ficam fora da contagem de definitivas. Prisões são um filtro de histórico e não somam condenações.</p><Link to="/metodologia#judicial" className="inline-flex min-h-11 items-center text-sm font-medium text-brand-700 underline dark:text-brand-300">Critérios e limites da pesquisa</Link></header>
    <section aria-label="Filtros judiciais" className="surface space-y-4 p-4 sm:p-5"><div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <label className="text-sm font-medium">Categoria judicial<select value={category} onChange={event => update('category', event.target.value)} className={control}>{Object.entries(judicialCategories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="text-sm font-medium">Situação parlamentar<select value={status} onChange={event => update('status', event.target.value)} className={control}>{politicoStatusOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <label className="text-sm font-medium">Ordenação judicial<select value={direction} onChange={event => update('direction', event.target.value)} className={control}><option value="desc">Mais definitivas primeiro</option><option value="asc">Menos definitivas primeiro</option></select></label>
      <label className="text-sm font-medium">Buscar parlamentar<input type="search" value={search} onChange={event => update('search', event.target.value)} className={control} /></label>
    </div><label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm"><input type="checkbox" checked={prisonOnly} onChange={event => update('prisonOnly', String(event.target.checked))} className="h-5 w-5 shrink-0 accent-brand-600" />Somente com prisão confirmada</label><p className="text-xs leading-5 text-slate-500 dark:text-slate-400">Ausência de pesquisa é diferente de zero registros. Valores não pesquisados aparecem ao final em qualquer ordenação. Os filtros ficam salvos no endereço desta página.</p></section>
    <JudicialFeedback loading={loading} error={error} retry={retry} />
    {!loading && !error && data && <>
      <section aria-label="Cobertura do ranking judicial" className="surface p-4 text-sm leading-6"><p className="font-semibold">{data.total.toLocaleString('pt-BR')} perfis nos filtros · {data.totalCadastrados.toLocaleString('pt-BR')} cadastrados</p><p>{data.coverage.reviewed} com pesquisa revisada · {data.coverage.partial} com pesquisa parcial · {data.coverage.notResearched} sem pesquisa</p><p className="mt-1 text-slate-600 dark:text-slate-400">A base não assegura cobertura nacional completa. Consulte o escopo e as fontes de cada perfil.</p></section>
      {data.items.length === 0 ? <p className="surface p-6 text-sm">Nenhum perfil encontrado para estes filtros.</p> : <ol start={offset + 1} aria-label="Resultados judiciais" className="space-y-3">{data.items.map((item, index) => <li key={item.id} className="surface"><Link to={`/politico/${encodeURIComponent(item.id)}?tab=judicial`} className="flex min-w-0 items-start gap-3 p-4 transition-colors hover:bg-slate-50 sm:gap-5 sm:p-5 dark:hover:bg-slate-800/50"><span aria-label={item.judicial.finalConvictions === null ? 'Sem classificação' : undefined} className="w-7 shrink-0 pt-1 font-mono text-sm text-slate-500">{item.judicial.finalConvictions === null ? '—' : offset + index + 1}</span><div className="min-w-0 flex-1"><div className="flex flex-col gap-3 sm:flex-row sm:justify-between"><div className="min-w-0"><h2 className="break-words font-semibold">{item.nome}</h2><p className="text-sm text-slate-500 dark:text-slate-400">{item.partido} / {item.estado} · {item.ativo === false ? 'Fora da ativa' : 'Na ativa'}</p></div><div className="shrink-0 text-sm"><span className="text-xl font-semibold">{item.judicial.finalConvictions === null ? 'Não pesquisado' : judicialCount(item.judicial.counts[category].final)}</span><p className="text-xs text-slate-500 dark:text-slate-400">definitivas · {judicialCategories[category]}</p></div></div><p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{item.judicial.appealConvictions === null ? 'Não pesquisado' : judicialCount(item.judicial.counts[category].appeal)} sujeitas a recurso · {judicialCategories[category]}</p><p className="mt-1 text-sm text-slate-600 dark:text-slate-300"><PrisonHistory summary={item.judicial} /></p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{item.judicial.coverage.status === 'REVIEWED' ? 'Pesquisa revisada' : item.judicial.coverage.status === 'PARTIAL' ? 'Pesquisa parcial' : 'Sem pesquisa publicada'} · Ver histórico e fontes</p></div></Link></li>)}</ol>}
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm"><p aria-live="polite">Exibindo {data.items.length ? offset + 1 : 0}–{offset + data.items.length} de {data.total}</p><div className="flex gap-2"><button type="button" disabled={offset === 0} onClick={() => update('offset', String(Math.max(0, offset - 50)))} className="min-h-11 rounded-lg border border-slate-300 px-4 disabled:opacity-40 dark:border-slate-700">Anterior</button><button type="button" disabled={offset + data.items.length >= data.total} onClick={() => update('offset', String(offset + 50))} className="min-h-11 rounded-lg border border-slate-300 px-4 disabled:opacity-40 dark:border-slate-700">Próxima</button></div></div>
    </>}
  </div>;
}
