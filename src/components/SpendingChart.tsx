import React, {useMemo} from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {useTheme} from '../context/ThemeContext';

type ResumoItem = {ano: number; mes: number; total: number};
type MediaItem = {ano: number; mes: number; media: number};

interface SpendingChartProps {
  resumo: ResumoItem[];
  media: MediaItem[];
  nomePolitico: string;
}

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

const formatBRL = (value: number) => {
  if (value >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `R$ ${(value / 1_000).toFixed(0)}k`;
  return `R$ ${value.toFixed(0)}`;
};

const formatBRLFull = (value: number) =>
  new Intl.NumberFormat('pt-BR', {style: 'currency', currency: 'BRL'}).format(value);

export const SpendingChart: React.FC<SpendingChartProps> = ({resumo, media, nomePolitico}) => {
  const {theme} = useTheme();
  const isDark = theme === 'dark';

  const chartData = useMemo(() => {
    const mediaMap = new Map<string, number>();
    for (const m of media) {
      mediaMap.set(`${m.ano}-${m.mes}`, m.media);
    }

    return resumo.map((r) => ({
      label: `${MESES[r.mes - 1]}/${String(r.ano).slice(2)}`,
      politico: r.total,
      media: mediaMap.get(`${r.ano}-${r.mes}`) ?? null,
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
      <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
        Comparação com a média de todos os parlamentares no mesmo período
      </p>

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
              name === 'politico' ? nomePolitico : 'Média geral',
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
          <Legend
            formatter={(value) => (value === 'politico' ? nomePolitico : 'Média geral')}
            wrapperStyle={{fontSize: '12px', color: colors.text, paddingTop: '12px'}}
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
    </div>
  );
};
