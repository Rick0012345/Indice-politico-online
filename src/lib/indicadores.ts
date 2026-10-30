import {fetchCatalogJson} from './catalogResource';

export type GastoMensal = {ano: number; mes: number; total: number};
export type GastoCategoria = {tipo: string; total: number};

export type Indicadores = {
  id: string;
  participacao: number | null;
  votosRegistrados: number;
  votacoesPossiveis: number;
  alinhamentoGoverno: number | null;
  votosComOrientacao: number;
  proposicoes: number;
  totalDespesas: number;
  gastosMensais: GastoMensal[];
  gastosCategorias: GastoCategoria[];
};

export type MediaCamara = {
  gastoPorDeputado: number;
  categorias: Array<{tipo: string; media: number}>;
} | null;

const num = (value: unknown, fallback = 0) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const numOrNull = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** Normaliza a resposta de /api/politicos/indicadores, descartando itens malformados. */
export const parseIndicadores = (data: unknown): {items: Map<string, Indicadores>; media: MediaCamara} => {
  const items = new Map<string, Indicadores>();
  const raw = (data ?? {}) as {items?: unknown; media?: unknown};
  if (Array.isArray(raw.items)) {
    for (const entry of raw.items as Array<Record<string, unknown>>) {
      if (!entry || typeof entry.id !== 'string') continue;
      if (!('participacao' in entry) && !('gastosMensais' in entry)) continue;
      items.set(entry.id, {
        id: entry.id,
        participacao: numOrNull(entry.participacao),
        votosRegistrados: num(entry.votosRegistrados),
        votacoesPossiveis: num(entry.votacoesPossiveis),
        alinhamentoGoverno: numOrNull(entry.alinhamentoGoverno),
        votosComOrientacao: num(entry.votosComOrientacao),
        proposicoes: num(entry.proposicoes),
        totalDespesas: num(entry.totalDespesas),
        gastosMensais: Array.isArray(entry.gastosMensais)
          ? (entry.gastosMensais as Array<Record<string, unknown>>)
              .filter((m) => m && typeof m.ano === 'number' && typeof m.mes === 'number')
              .map((m) => ({ano: m.ano as number, mes: m.mes as number, total: num(m.total)}))
          : [],
        gastosCategorias: Array.isArray(entry.gastosCategorias)
          ? (entry.gastosCategorias as Array<Record<string, unknown>>)
              .filter((c) => c && typeof c.tipo === 'string')
              .map((c) => ({tipo: c.tipo as string, total: num(c.total)}))
          : [],
      });
    }
  }
  const mediaRaw = raw.media as {gastoPorDeputado?: unknown; categorias?: unknown} | null | undefined;
  const media: MediaCamara =
    mediaRaw && typeof mediaRaw.gastoPorDeputado === 'number'
      ? {
          gastoPorDeputado: mediaRaw.gastoPorDeputado,
          categorias: Array.isArray(mediaRaw.categorias)
            ? (mediaRaw.categorias as Array<Record<string, unknown>>)
                .filter((c) => c && typeof c.tipo === 'string' && typeof c.media === 'number')
                .map((c) => ({tipo: c.tipo as string, media: c.media as number}))
            : [],
        }
      : null;
  return {items, media};
};

export const fetchIndicadores = async (ids: string[], options: {ano?: number | null; signal?: AbortSignal; force?: boolean} = {}) => {
  if (ids.length === 0) return {items: new Map<string, Indicadores>(), media: null as MediaCamara};
  const params = new URLSearchParams({ids: [...new Set(ids)].sort().join(',')});
  if (options.ano) params.set('ano', String(options.ano));
  return parseIndicadores(await fetchCatalogJson(`/api/politicos/indicadores?${params.toString()}`, {signal: options.signal, force: options.force}));
};

export const brlCompact = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
});

export const brlFull = new Intl.NumberFormat('pt-BR', {style: 'currency', currency: 'BRL', maximumFractionDigits: 0});

export const formatPercent = (value: number | null) =>
  value == null ? 'n/d' : `${value.toLocaleString('pt-BR', {maximumFractionDigits: 1})}%`;

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const mesCurto = (mes: number) => MESES[(mes - 1 + 12) % 12] ?? String(mes);

/** "DIVULGAÇÃO DA ATIVIDADE PARLAMENTAR" -> "Divulgação da atividade parlamentar" */
export const tituloCategoria = (tipo: string) => {
  const lower = tipo.trim().toLocaleLowerCase('pt-BR');
  return lower.charAt(0).toLocaleUpperCase('pt-BR') + lower.slice(1);
};

export const iniciais = (nome: string) =>
  nome
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase('pt-BR') ?? '')
    .join('');
