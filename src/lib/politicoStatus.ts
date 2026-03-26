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
    ? 'bg-slate-100 text-slate-700 ring-slate-200'
    : 'bg-emerald-50 text-emerald-700 ring-emerald-200';
};
