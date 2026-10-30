import React, {useMemo} from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {useTheme} from '../context/ThemeContext';

type ResumoItem = {ano: number; mes: number; total: number};
type MediaItem = {ano: number; mes: number; media: number; participantes: number};

interface SpendingChartProps {
  resumo: ResumoItem[];
  media: MediaItem[];
  nomePolitico: string;
  scopeLabel?: string;
}

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

const formatBRL = (value: number) => {
  const prefix = value < 0 ? '-R$' : 'R$';
  const magnitude = Math.abs(value);
  if (magnitude >= 1_000_000) return `${prefix} ${(magnitude / 1_000_000).toFixed(1)}M`;
  if (magnitude >= 1_000) return `${prefix} ${(magnitude / 1_000).toFixed(0)}k`;
  return `${prefix} ${magnitude.toFixed(0)}`;
};

const formatBRLFull = (value: number) =>
  new Intl.NumberFormat('pt-BR', {style: 'currency', currency: 'BRL'}).format(value);

export const SpendingChart: React.FC<SpendingChartProps> = ({resumo, media, nomePolitico, scopeLabel}) => {
  const {theme} = useTheme();
  const isDark = theme === 'dark';

  const chartData = useMemo(() => {
    const mediaMap = new Map<string, MediaItem>();
    for (const m of media) {
      mediaMap.set(`${m.ano}-${m.mes}`, m);
    }

    return resumo.map((r) => ({
      label: `${MESES[r.mes - 1]}/${String(r.ano).slice(2)}`,
      politico: r.total,
      media: mediaMap.get(`${r.ano}-${r.mes}`)?.media ?? null,
      participantes: mediaMap.get(`${r.ano}-${r.mes}`)?.participantes ?? null,
    }));
  }, [resumo, media]);

  if (chartData.length === 0) return null;

  const colors = {
    bar: '#3b82f6',
    barFill: isDark ? '#1d4ed8' : '#3b82f6',
    line: '#f59e0b',
    grid: isDark ? '#334155' : '#e2e8f0',
    text: isDark ? '#94a3b8' : '#64748b',
    tooltip: {
      bg: isDark ? '#1e293b' : '#ffffff',
      border: isDark ? '#334155' : '#e2e8f0',
      text: isDark ? '#f1f5f9' : '#0f172a',
    },
  };

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-700 dark:bg-slate-900">
      <div className="mb-1 text-base font-bold text-slate-900 dark:text-slate-50">Gastos mensais</div>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Média dos parlamentares com despesas registradas no mesmo filtro e mês. Ausência de dados não é preenchida com zero.
      </p>
      {scopeLabel && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Escopo: {scopeLabel}</p>}
      <details className="my-4 text-xs text-slate-600 dark:text-slate-400"><summary className="cursor-pointer font-semibold">Universo da comparação por mês</summary><ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1">{chartData.map(item=><li key={item.label}>{item.label}: {item.participantes == null ? 'universo indisponível' : `${item.participantes.toLocaleString('pt-BR')} parlamentares`}</li>)}</ul></details>

      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={chartData} margin={{top: 4, right: 8, left: 0, bottom: 4}}>
          <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{fill: colors.text, fontSize: 11}}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={formatBRL}
            tick={{fill: colors.text, fontSize: 11}}
            axisLine={false}
            tickLine={false}
            width={72}
          />
          <Tooltip
            formatter={(value: number, name: string) => [
              formatBRLFull(value),
              name === 'politico' ? nomePolitico : 'Média dos parlamentares com registros',
            ]}
            contentStyle={{
              backgroundColor: colors.tooltip.bg,
              border: `1px solid ${colors.tooltip.border}`,
              borderRadius: '12px',
              fontSize: '13px',
              color: colors.tooltip.text,
            }}
            cursor={{fill: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'}}
          />
          <Bar dataKey="politico" fill={colors.barFill} radius={[4, 4, 0, 0]} maxBarSize={48} />
          <Line
            dataKey="media"
            stroke={colors.line}
            strokeWidth={2}
            strokeDasharray="5 4"
            dot={false}
            activeDot={{r: 4}}
          />
        </ComposedChart>
      </ResponsiveContainer>
      <ul aria-label="Legenda dos gastos mensais" className="mt-3 flex flex-col gap-2 text-xs text-slate-600 sm:flex-row sm:flex-wrap sm:justify-center sm:gap-x-5 dark:text-slate-400">
        <li className="flex min-w-0 items-start gap-2"><span aria-hidden="true" className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-sm" style={{backgroundColor:colors.barFill}} /><span className="break-words">{nomePolitico}</span></li>
        <li className="flex min-w-0 items-start gap-2"><span aria-hidden="true" className="mt-1.5 w-3 shrink-0 border-t-2 border-dashed" style={{borderColor:colors.line}} /><span className="break-words">Média dos parlamentares com registros</span></li>
      </ul>
    </div>
  );
};
