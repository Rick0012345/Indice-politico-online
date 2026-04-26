export type PoliticoStatusFilter = 'ativo' | 'inativo' | 'todos';

type PoliticoStatusSnapshot = {
  ativo?: boolean | null;
  situacao?: string | null;
};

export const politicoStatusOptions: Array<{
  value: PoliticoStatusFilter;
  label: string;
}> = [
  {value: 'ativo', label: 'Na ativa'},
  {value: 'inativo', label: 'Fora da ativa'},
  {value: 'todos', label: 'Todos'},
];

export const getPoliticoStatusLabel = ({ativo}: PoliticoStatusSnapshot) => {
  return ativo === false ? 'Fora da ativa' : 'Na ativa';
};

export const getPoliticoSituacaoLabel = ({situacao}: PoliticoStatusSnapshot) => {
  const normalized = situacao?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
};

export const getPoliticoStatusClasses = ({ativo}: PoliticoStatusSnapshot) => {
  return ativo === false
    ? 'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:ring-slate-600'
    : 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:ring-emerald-900';
};
