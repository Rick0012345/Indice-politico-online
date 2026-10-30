export type ExpenseCoverage = {
  status: 'complete' | 'partial' | 'not_imported';
  periods: number;
  expectedPeriods: number;
  missing: number;
  completed: number;
  empty: number;
  pending: number;
  running: number;
  failed: number;
  cancelled: number;
  politicians: number;
  withoutCheckpoints: number;
  from: string | null;
  to: string | null;
  lastUpdatedAt: string | null;
};

export type ExpenseAnalysisGroup = {
  total: number;
  quantidade: number;
  participacao: number | null;
};

export type ExpenseAnalysis = {
  total: number;
  totalValor: number;
  categorias: Array<ExpenseAnalysisGroup & {tipo: string}>;
  fornecedores: Array<ExpenseAnalysisGroup & {id: string; nome: string; identificacao: 'documento' | 'nome'}>;
  outrosFornecedores: {total: number; quantidade: number; fornecedores: number};
  cobertura: ExpenseCoverage;
  periodo: {ano: number | null; mes: number | null; mesInicio: number | null; mesFim: number | null};
};
