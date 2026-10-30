import 'dotenv/config';
import {spawn} from 'node:child_process';
import {timingSafeEqual} from 'node:crypto';
import {createWriteStream, mkdirSync} from 'node:fs';
import {readdir, stat} from 'node:fs/promises';
import {readLogTail} from './lib/logTail';
import {join} from 'node:path';
import express, {type NextFunction, type Request, type Response} from 'express';
import {Pool} from 'pg';
import {CatalogEvents, attachCatalogRoutes} from './lib/catalogEvents';
import {attachJudicialRoutes} from './lib/judicialRoutes';
import {buildProgressiveRankingQuery,expenseYearsQuery} from './lib/rankingQueries';
import {startCatalogListener} from './lib/catalogListener';
import {getGroqModelValidationError} from './lib/aiSettings';
import {acquireIngestionLock} from './lib/ingestionLifecycle';
import {resolveGroqSettings, type GroqSettings} from './lib/groqSettings';
import {buildExpenseQuery,ExpenseFilterError,parseExpenseFilters,expenseScopeSql,expenseFinancialRowsCtes} from './lib/expenseQueries';
import {expenseCoverageSql,buildExpenseAnalysisQuery} from './lib/expenseAnalytics';
import {hashCpf, isValidCpf, normalizeCpf, parseComentario, parseNota} from './lib/evaluationRules';

type ApiDurationMetric = {requests: number; errors: number; durations: number[]};
const apiDurationMetrics = new Map<string, ApiDurationMetric>();

const app = express();
app.disable('x-powered-by');
app.use(express.json({limit: '1mb'}));
app.use((req, res, next) => {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    if (String(res.getHeader('Content-Type') ?? '').startsWith('text/event-stream')) return;
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const routePath = req.route?.path ? `${req.baseUrl}${String(req.route.path)}` : req.path;
    const key = `${req.method} ${routePath}`;
    const metric = apiDurationMetrics.get(key) ?? {requests: 0, errors: 0, durations: []};
    metric.requests += 1;
    if (res.statusCode >= 500) metric.errors += 1;
    metric.durations.push(durationMs);
    if (metric.durations.length > 500) metric.durations.shift();
    if (apiDurationMetrics.has(key) || apiDurationMetrics.size < 500) apiDurationMetrics.set(key, metric);
    if (durationMs >= 500) {
      process.stdout.write(`[api-slow] ${req.method} ${req.path} ${res.statusCode} ${durationMs.toFixed(1)}ms\n`);
    }
  });
  next();
});

const databaseUrl = process.env.DATABASE_URL?.trim();
const poolOptions = {connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, statement_timeout: 30000};

const pool = databaseUrl
  ? new Pool({...poolOptions, connectionString: databaseUrl})
  : new Pool({
      ...poolOptions,
      host: process.env.APP_DB_HOST ?? 'db',
      port: Number(process.env.APP_DB_PORT ?? 5432),
      user: process.env.APP_DB_USER ?? 'app',
      password: process.env.APP_DB_PASSWORD ?? 'app',
      database: process.env.APP_DB_NAME ?? 'app',
    });

app.param('politicoId', (_req, res, next, value) => {
  if (!/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n) {
    sendJson(res, 400, {error: 'Identificador de político inválido.'});
    return;
  }
  next();
});

const catalogEvents = new CatalogEvents();
attachCatalogRoutes(app, catalogEvents);

let isStartingIngestion = false;
let cachedAiSettings: AiSettings | null = null;
let cachedAiSettingsAt = 0;

type AiSettings = GroqSettings;

type ActivityEventStage =
  | 'api_fetch'
  | 'api_retry'
  | 'db_write'
  | 'checkpoint_start'
  | 'checkpoint_done'
  | 'checkpoint_failed'
  | 'vote_ai_start'
  | 'vote_ai_done'
  | 'vote_ai_fallback';

type ActivityEvent = {
  stage: ActivityEventStage;
  label: string;
  timestamp: string;
  source?: 'ingestion' | 'ai';
  dataset?: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  resourceId?: string | number | null;
  url?: string;
  path?: string;
  progress?: number;
  total?: number;
  status?: number;
  attempt?: number;
  delay?: number;
  error?: string;
  model?: string;
  reason?: string;
};

const sendJson = (res: Response, statusCode: number, body: unknown) => {
  res.status(statusCode).json(body);
};

const secureTextEquals = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

const requireAdminAuthorization = (req: Request, res: Response, next: NextFunction) => {
  const expectedToken = process.env.ADMIN_API_TOKEN?.trim() ?? '';
  if (!expectedToken) {
    sendJson(res, 503, {error: 'ADMIN_API_TOKEN nao configurado no servidor.'});
    return;
  }

  const authorization = req.header('authorization') ?? '';
  const suppliedToken = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!suppliedToken || !secureTextEquals(suppliedToken, expectedToken)) {
    sendJson(res, 401, {error: 'Acesso administrativo nao autorizado.'});
    return;
  }
  next();
};

const evaluationWindows = new Map<string, {count: number; resetAt: number}>();
const limitEvaluations = (req: Request, res: Response, next: NextFunction) => {
  const now = Date.now();
  if (evaluationWindows.size > 1000) {
    for (const [entry, value] of evaluationWindows) if (value.resetAt <= now) evaluationWindows.delete(entry);
  }
  const key = `${req.ip}:${req.params.politicoId}`;
  const current = evaluationWindows.get(key);
  const window = !current || current.resetAt <= now
    ? {count: 0, resetAt: now + 60 * 60 * 1000}
    : current;
  if (window.count >= 10) {
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((window.resetAt - now) / 1000))));
    sendJson(res, 429, {error: 'Limite de avaliacoes excedido. Tente novamente mais tarde.'});
    return;
  }
  window.count += 1;
  evaluationWindows.set(key, window);
  next();
};

const parseLimit = (req: Request) => {
  const raw = typeof req.query.limit === 'string' ? req.query.limit : undefined;
  const num = raw != null && raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : 20;
  return Math.max(1, Math.min(2000, Math.trunc(num)));
};

const parseOffset = (req: Request) => {
  const raw = typeof req.query.offset === 'string' ? req.query.offset : undefined;
  const num = raw != null && raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : 0;
  return Math.max(0, Math.trunc(num));
};

const parseOptionalInt = (raw: unknown) => {
  if (typeof raw !== 'string') return null;
  if (raw.trim().length === 0) return null;
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
};

type PoliticoStatusFilter = 'ativo' | 'inativo' | 'todos';

const parsePoliticoStatusFilter = (req: Request): PoliticoStatusFilter => {
  const raw = typeof req.query.status === 'string' ? req.query.status : undefined;
  if (raw === 'inativo' || raw === 'todos') return raw;
  return 'ativo';
};

const buildPoliticoStatusWhereSql = (status: PoliticoStatusFilter) => {
  if (status === 'todos') return '1 = 1';
  if (status === 'inativo') return 'p.ativo = false';
  return 'p.ativo IS DISTINCT FROM false';
};

const parseJsonStringArray = (value: unknown) => {
  const normalize = (items: unknown[]) =>
    items.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);

  if (Array.isArray(value)) return normalize(value);
  if (typeof value !== 'string' || value.trim().length === 0) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? normalize(parsed) : [];
  } catch {
    return [];
  }
};

const parseVoteLimit = (req: Request) => {
  const raw = typeof req.query.limit === 'string' ? req.query.limit : undefined;
  const num = raw != null && raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : 30;
  return Math.max(1, Math.min(50, Math.trunc(num)));
};

type VoteCursor = {dataVotacao: string; votacaoId: string};

const parseVoteCursor = (raw: unknown): VoteCursor | null => {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<VoteCursor>;
    if (typeof parsed.dataVotacao !== 'string' || typeof parsed.votacaoId !== 'string') return null;
    const date = new Date(parsed.dataVotacao);
    if (Number.isNaN(date.getTime()) || !parsed.votacaoId.trim()) return null;
    return {dataVotacao: date.toISOString(), votacaoId: parsed.votacaoId};
  } catch {
    return null;
  }
};

const buildVoteCursor = (value: VoteCursor) =>
  Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

const normalizeText = (value: unknown) =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const getSettingMap = async () => {
  const result = await pool.query<{key: string; value: string}>(
    'SELECT key, value FROM app_settings WHERE key = ANY($1::text[])',
    [['groq_model', 'groq_enabled']],
  );
  return new Map<string, string>(result.rows.map((row) => [row.key, row.value]));
};

const getAiSettings = async (): Promise<AiSettings> => {
  const now = Date.now();
  if (cachedAiSettings && now - cachedAiSettingsAt < 30_000) return cachedAiSettings;

  const settings = await getSettingMap();
  cachedAiSettings = resolveGroqSettings(settings);
  cachedAiSettingsAt = now;
  return cachedAiSettings;
};

const setAppSetting = async (key: string, value: string) => {
  await pool.query(
    `
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (key)
    DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `,
    [key, value],
  );
};

const parseIsoDateInput = (value: unknown, fallback: string) => {
  if (typeof value !== 'string') return fallback;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
};

const parseDatasetList = (value: unknown) => {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  const allowed = new Set([
    'deputados',
    'despesas',
    'votacoes',
    'legislaturas',
    'partidos',
    'blocos',
    'orgaos',
    'eventos',
    'frentes',
    'proposicoes',
    'referencias',
    'todos',
  ]);
  return raw.filter((item): item is string => typeof item === 'string' && allowed.has(item));
};

const parseCheckpointStatus = (value: unknown) => {
  const allowed = new Set(['pending', 'running', 'failed']);
  return typeof value === 'string' && allowed.has(value) ? value : null;
};

const parseCleanupDataset = (value: unknown) => {
  const allowed = new Set([
    'deputados',
    'despesas',
    'votacoes',
    'legislaturas',
    'partidos',
    'blocos',
    'orgaos',
    'eventos',
    'frentes',
    'proposicoes',
    'referencias',
    'todos',
  ]);
  return typeof value === 'string' && allowed.has(value) ? value : null;
};

const cleanupDefinitions: Record<string, {label: string; tables: string[]; rawResources: string[]; checkpointDatasets: string[]}> = {
  deputados: {
    label: 'Deputados',
    tables: [
      'camara_deputados_ocupacoes',
      'camara_deputados_profissoes',
      'camara_deputados_orgaos',
      'camara_deputados_eventos',
      'camara_deputados_frentes',
      'politicos',
    ],
    rawResources: ['deputados'],
    checkpointDatasets: ['deputados'],
  },
  despesas: {
    label: 'Despesas',
    tables: ['despesas'],
    rawResources: ['deputados_despesas'],
    checkpointDatasets: ['despesas'],
  },
  votacoes: {
    label: 'Votações',
    tables: ['camara_votacoes_orientacoes', 'votos_deputados', 'votacoes'],
    rawResources: ['votacoes', 'votacoes_votos', 'votacoes_orientacoes'],
    checkpointDatasets: ['votacoes'],
  },
  legislaturas: {
    label: 'Legislaturas',
    tables: ['camara_legislaturas'],
    rawResources: ['legislaturas'],
    checkpointDatasets: ['legislaturas'],
  },
  partidos: {
    label: 'Partidos',
    tables: ['camara_partidos'],
    rawResources: ['partidos'],
    checkpointDatasets: ['partidos'],
  },
  blocos: {
    label: 'Blocos',
    tables: ['camara_blocos'],
    rawResources: ['blocos'],
    checkpointDatasets: ['blocos'],
  },
  orgaos: {
    label: 'Órgãos',
    tables: ['camara_deputados_orgaos', 'camara_eventos_orgaos', 'camara_orgaos'],
    rawResources: ['orgaos'],
    checkpointDatasets: ['orgaos'],
  },
  eventos: {
    label: 'Eventos',
    tables: ['camara_deputados_eventos', 'camara_eventos_orgaos', 'camara_eventos'],
    rawResources: ['eventos'],
    checkpointDatasets: ['eventos'],
  },
  frentes: {
    label: 'Frentes',
    tables: ['camara_deputados_frentes', 'camara_frentes'],
    rawResources: ['frentes'],
    checkpointDatasets: ['frentes'],
  },
  proposicoes: {
    label: 'Proposições',
    tables: [
      'camara_proposicoes_autores',
      'camara_proposicoes_temas',
      'camara_proposicoes_tramitacoes',
      'camara_proposicoes_relacionadas',
      'camara_proposicoes',
    ],
    rawResources: ['proposicoes', 'proposicoes_autores'],
    checkpointDatasets: ['proposicoes'],
  },
  referencias: {
    label: 'Referências',
    tables: ['camara_referencias'],
    rawResources: ['referencias'],
    checkpointDatasets: ['referencias'],
  },
};

const cleanupOrder = [
  'despesas',
  'votacoes',
  'deputados',
  'proposicoes',
  'eventos',
  'frentes',
  'orgaos',
  'blocos',
  'partidos',
  'legislaturas',
  'referencias',
];

const releaseStaleIngestionCheckpoints = async (minutes = 30) => {
  await pool.query(
    `
    UPDATE ingestion_checkpoints
    SET status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'pending' END,
        locked_at = NULL,
        last_error = COALESCE(last_error, 'Checkpoint running expirou e foi liberado automaticamente.'),
        updated_at = CURRENT_TIMESTAMP
    WHERE source = 'camara'
      AND status = 'running'
      AND locked_at < CURRENT_TIMESTAMP - ($1::text || ' minutes')::interval
    `,
    [String(minutes)],
  );
};

const emptyLogStats = () => ({
  totalLines: 0,
  starts: 0,
  okItems: 0,
  okZero: 0,
  progressUpdates: 0,
  progressItems: 0,
  retries: 0,
  skips: 0,
  httpRetries: 0,
  httpStatus: {} as Record<string, number>,
  lastActivityAt: null as string | null,
  lastHttpError: null as string | null,
});

export const parseIngestionLogStats = (content: string) => {
  const stats = emptyLogStats();
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const progressByWindow = new Map<string, number>();
  stats.totalLines = lines.length;

  for (const line of lines) {
    if (line.includes('[start]')) stats.starts += 1;
    if (line.includes('[ok-items]')) stats.okItems += 1;
    if (line.includes('[ok-zero]')) stats.okZero += 1;
    const terminal = line.match(/\[(?:ok-items|ok-zero|retry)\]\s+(\S+)\s+(?:\S+\s+)?(\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2})/);
    if (terminal) progressByWindow.delete(`${terminal[1]}:${terminal[2]}`);
    if (line.includes('[progress]')) {
      stats.progressUpdates += 1;
      const progressMatch = line.match(/\[progress\]\s+(\S+)\s+([^:]+):.*?(\d+)\s+registros/);
      const progressItems = Number(progressMatch?.[3] ?? 0);
      if (progressMatch && Number.isFinite(progressItems)) {
        progressByWindow.set(`${progressMatch[1]}:${progressMatch[2]}`, progressItems);
      }
    }
    if (line.includes('[retry]')) stats.retries += 1;
    if (line.includes('[skip]')) stats.skips += 1;

    if (line.includes('[http-retry]')) {
      stats.httpRetries += 1;
      const status = line.match(/status=(\d+)/)?.[1] ?? 'rede';
      stats.httpStatus[status] = (stats.httpStatus[status] ?? 0) + 1;
      stats.lastHttpError = line;
    }

    const timestamp = line.match(/^\[(\d{4}-\d{2}-\d{2}T[^\]]+Z)\]/)?.[1];
    if (timestamp) stats.lastActivityAt = timestamp;
  }

  stats.progressItems = Array.from(progressByWindow.values()).reduce((sum, value) => sum + value, 0);

  return stats;
};

const isActivityEventStage = (value: unknown): value is ActivityEventStage =>
  typeof value === 'string' &&
  [
    'api_fetch',
    'api_retry',
    'db_write',
    'checkpoint_start',
    'checkpoint_done',
    'checkpoint_failed',
    'vote_ai_start',
    'vote_ai_done',
    'vote_ai_fallback',
  ].includes(value);

const toOptionalNumber = (value: unknown) => {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : undefined;
};

const parseStructuredLogEvents = (content: string, source: ActivityEvent['source']) => {
  const events: ActivityEvent[] = [];
  const lines = content.split(/\r?\n/).filter((line) => line.includes('[event]'));

  for (const line of lines) {
    const jsonStart = line.indexOf('{');
    if (jsonStart < 0) continue;
    try {
      const parsed = JSON.parse(line.slice(jsonStart)) as Record<string, unknown>;
      if (!isActivityEventStage(parsed.stage)) continue;
      const timestamp =
        normalizeText(parsed.timestamp) ||
        line.match(/^\[(\d{4}-\d{2}-\d{2}T[^\]]+Z)\]/)?.[1] ||
        new Date().toISOString();
      events.push({
        stage: parsed.stage,
        label: normalizeText(parsed.label) || 'Atividade em andamento',
        timestamp,
        source: (parsed.source === 'ai' || parsed.source === 'ingestion' ? parsed.source : source) ?? source,
        dataset: normalizeText(parsed.dataset) || undefined,
        periodStart: normalizeText(parsed.periodStart) || null,
        periodEnd: normalizeText(parsed.periodEnd) || null,
        resourceId:
          typeof parsed.resourceId === 'string' || typeof parsed.resourceId === 'number'
            ? parsed.resourceId
            : null,
        url: normalizeText(parsed.url) || undefined,
        path: normalizeText(parsed.path) || undefined,
        progress: toOptionalNumber(parsed.progress),
        total: toOptionalNumber(parsed.total),
        status: toOptionalNumber(parsed.status),
        attempt: toOptionalNumber(parsed.attempt),
        delay: toOptionalNumber(parsed.delay),
        error: normalizeText(parsed.error) || undefined,
        model: normalizeText(parsed.model) || undefined,
        reason: normalizeText(parsed.reason) || undefined,
      });
    } catch {
      // Linhas de log antigas ou truncadas continuam sendo exibidas no log bruto.
    }
  }

  return events;
};

const buildIngestionFlowKey = (event: Pick<ActivityEvent, 'dataset' | 'periodStart' | 'periodEnd'>) =>
  `ingestion:${event.dataset ?? 'geral'}:${event.periodStart ?? ''}:${event.periodEnd ?? ''}`;

const isTerminalActivityStage = (stage: ActivityEventStage) =>
  stage === 'checkpoint_done' ||
  stage === 'checkpoint_failed' ||
  stage === 'vote_ai_done' ||
  stage === 'vote_ai_fallback';

const buildCurrentStatus = (events: ActivityEvent[], activeIngestionKeys: Set<string> = new Set<string>()) => {
  const latestByFlow = new Map<string, ActivityEvent>();
  const now = Date.now();
  for (const event of events) {
    const key = event.source === 'ai' ? `ai:${event.resourceId ?? 'global'}` : buildIngestionFlowKey(event);
    if (!latestByFlow.has(key)) {
      latestByFlow.set(key, event);
    }
  }

  return Array.from(latestByFlow.values())
    .filter((event) => {
      if (isTerminalActivityStage(event.stage)) return false;
      if (event.source !== 'ai') return activeIngestionKeys.has(buildIngestionFlowKey(event));

      const eventTime = new Date(event.timestamp).getTime();
      return Number.isFinite(eventTime) && now - eventTime <= 2 * 60 * 1000;
    })
    .slice(0, 6);
};

const buildRecentTimeline = (events: ActivityEvent[]) =>
  events
    .filter(
      (event) =>
        isTerminalActivityStage(event.stage) ||
        event.stage === 'api_retry',
    )
    .slice(0, 16);

const loadActiveIngestionKeys = async (): Promise<Set<string>> => {
  const result = await pool.query<{
    dataset: string | null;
    periodStart: string | null;
    periodEnd: string | null;
  }>(
    `
    SELECT
      dataset,
      period_start::text AS "periodStart",
      period_end::text AS "periodEnd"
    FROM ingestion_checkpoints
    WHERE source = 'camara'
      AND status = 'running'
    `,
  );

  return new Set<string>(result.rows.map((row) => buildIngestionFlowKey(row)));
};

const enrichLogStatsWithDatabaseProgress = async (stats: ReturnType<typeof emptyLogStats>) => {
  const result = await pool.query(
    `
    SELECT
      COUNT(*)::int AS windows,
      COALESCE(SUM(votacoes_total + votos_total + orientacoes_total), 0)::int AS total
    FROM (
      SELECT
        (
          SELECT COUNT(*)::int
          FROM votacoes v
          WHERE v.data_hora_votacao::date BETWEEN ic.period_start AND ic.period_end
        ) AS votacoes_total,
        (
          SELECT COUNT(*)::int
          FROM votos_deputados vd
          JOIN votacoes v ON v.id = vd.votacao_id
          WHERE v.data_hora_votacao::date BETWEEN ic.period_start AND ic.period_end
        ) AS votos_total,
        (
          SELECT COUNT(*)::int
          FROM camara_votacoes_orientacoes cvo
          JOIN votacoes v ON v.id = cvo.votacao_id
          WHERE v.data_hora_votacao::date BETWEEN ic.period_start AND ic.period_end
        ) AS orientacoes_total
      FROM ingestion_checkpoints ic
      WHERE ic.source = 'camara'
        AND ic.dataset = 'votacoes'
        AND ic.status = 'running'
      UNION ALL
      SELECT ic.items_count, 0, 0
      FROM ingestion_checkpoints ic
      WHERE ic.source = 'camara'
        AND ic.dataset <> 'votacoes'
        AND ic.status = 'running'
    ) progress
    `,
  );

  const databaseProgress = Number(result.rows[0]?.total ?? 0);
  const runningWindows = Number(result.rows[0]?.windows ?? 0);
  stats.progressItems = databaseProgress;
  if (runningWindows > 0 && stats.progressUpdates === 0 && databaseProgress > 0) {
    stats.progressUpdates = runningWindows;
  }
};

const parseIdList = (raw: unknown, max: number) => {
  if (typeof raw !== 'string') return [];
  const ids = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => /^\d{1,18}$/.test(part));
  return Array.from(new Set(ids)).slice(0, max);
};

/**
 * Indicadores derivados por parlamentar, usados por Ranking, Comparador e Perfil.
 * - participacao: votos registrados / votações nominais ocorridas entre o primeiro e o último voto do parlamentar.
 * - alinhamentoGoverno: votos iguais à orientação do Governo (Sim/Não) / votos dados em votações com essa orientação.
 * - proposicoes: proposições em que o parlamentar aparece como autor.
 * - gastosMensais: últimos 12 meses com despesas; gastosCategorias: total por tipo de despesa (ano opcional).
 * - media: referência da Câmara (mesmo ano e status) para comparar gasto por deputado e por categoria.
 */
app.get('/api/politicos/indicadores', async (req, res) => {
  try {
    const ids = parseIdList(req.query.ids, 60);
    if (ids.length === 0) {
      sendJson(res, 200, {items: [], media: null});
      return;
    }
    const ano = parseOptionalInt(req.query.ano);
    const status = parsePoliticoStatusFilter(req);
    const anoFilter = ano != null ? 'AND d.ano = $2' : '';
    const params: Array<string[] | number> = [ids];
    if (ano != null) params.push(ano);

    const [votos, proposicoes, mensais, categorias, totais] = await Promise.all([
      pool.query<{id: string; votos: number; possiveis: number; alinhados: number; comOrientacao: number}>(
        `
        WITH alvo AS (SELECT unnest($1::bigint[]) AS id),
        janela AS (
          SELECT vd.politico_id, MIN(v.data_hora_votacao) AS ini, MAX(v.data_hora_votacao) AS fim, COUNT(*)::int AS votos
          FROM votos_deputados vd
          JOIN alvo a ON a.id = vd.politico_id
          JOIN votacoes v ON v.id = vd.votacao_id
          GROUP BY vd.politico_id
        ),
        governo AS (
          SELECT vd.politico_id,
            COUNT(*)::int AS com_orientacao,
            COUNT(*) FILTER (WHERE lower(trim(vd.voto)) = lower(trim(cvo.orientacao)))::int AS alinhados
          FROM votos_deputados vd
          JOIN alvo a ON a.id = vd.politico_id
          JOIN camara_votacoes_orientacoes cvo ON cvo.votacao_id = vd.votacao_id
          WHERE upper(trim(cvo.sigla_bancada)) IN ('GOVERNO', 'GOV.')
            AND lower(trim(cvo.orientacao)) IN ('sim', 'não', 'nao')
            AND lower(trim(vd.voto)) IN ('sim', 'não', 'nao')
          GROUP BY vd.politico_id
        )
        SELECT
          j.politico_id::text AS id,
          j.votos,
          (
            SELECT COUNT(*)::int FROM votacoes v
            WHERE v.data_hora_votacao BETWEEN j.ini AND j.fim
              AND EXISTS (SELECT 1 FROM votos_deputados x WHERE x.votacao_id = v.id)
          ) AS possiveis,
          COALESCE(g.alinhados, 0) AS alinhados,
          COALESCE(g.com_orientacao, 0) AS "comOrientacao"
        FROM janela j
        LEFT JOIN governo g ON g.politico_id = j.politico_id
        `,
        [ids],
      ),
      pool.query<{id: string; total: number}>(
        `
        SELECT substring(uri FROM '/deputados/([0-9]+)$') AS id, COUNT(DISTINCT proposicao_id)::int AS total
        FROM camara_proposicoes_autores
        WHERE substring(uri FROM '/deputados/([0-9]+)$') = ANY($1::text[])
        GROUP BY 1
        `,
        [ids],
      ),
      pool.query<{id: string; ano: number; mes: number; total: number}>(
        `
        SELECT politico_id::text AS id, ano, mes, total FROM (
          SELECT d.politico_id, d.ano, d.mes, SUM(d.valor_liquido)::double precision AS total,
            ROW_NUMBER() OVER (PARTITION BY d.politico_id ORDER BY d.ano DESC, d.mes DESC) AS rn
          FROM despesas d
          WHERE d.politico_id = ANY($1::bigint[]) ${anoFilter}
          GROUP BY d.politico_id, d.ano, d.mes
        ) t
        WHERE rn <= 12
        ORDER BY id, ano, mes
        `,
        params,
      ),
      pool.query<{id: string; tipo: string; total: number}>(
        `
        SELECT d.politico_id::text AS id, d.tipo_despesa AS tipo, SUM(d.valor_liquido)::double precision AS total
        FROM despesas d
        WHERE d.politico_id = ANY($1::bigint[]) ${anoFilter}
        GROUP BY d.politico_id, d.tipo_despesa
        ORDER BY total DESC
        `,
        params,
      ),
      pool.query<{tipo: string | null; total: number; politicos: number}>(
        `
        SELECT GROUPING(d.tipo_despesa) = 1 AS geral, d.tipo_despesa AS tipo,
          SUM(d.valor_liquido)::double precision AS total,
          COUNT(DISTINCT d.politico_id)::int AS politicos
        FROM despesas d
        JOIN politicos p ON p.id = d.politico_id
        WHERE ${buildPoliticoStatusWhereSql(status)} ${ano != null ? 'AND d.ano = $1' : ''}
        GROUP BY GROUPING SETS ((d.tipo_despesa), ())
        `,
        ano != null ? [ano] : [],
      ),
    ]);

    const byId = new Map<string, Record<string, unknown>>();
    for (const id of ids) {
      byId.set(id, {
        id,
        participacao: null,
        votosRegistrados: 0,
        votacoesPossiveis: 0,
        alinhamentoGoverno: null,
        votosComOrientacao: 0,
        proposicoes: 0,
        totalDespesas: 0,
        gastosMensais: [] as Array<{ano: number; mes: number; total: number}>,
        gastosCategorias: [] as Array<{tipo: string; total: number}>,
      });
    }
    for (const row of votos.rows) {
      const item = byId.get(row.id);
      if (!item) continue;
      item.votosRegistrados = row.votos;
      item.votacoesPossiveis = row.possiveis;
      item.participacao = row.possiveis > 0 ? Math.round((row.votos / row.possiveis) * 1000) / 10 : null;
      item.votosComOrientacao = row.comOrientacao;
      item.alinhamentoGoverno = row.comOrientacao > 0 ? Math.round((row.alinhados / row.comOrientacao) * 1000) / 10 : null;
    }
    for (const row of proposicoes.rows) {
      const item = byId.get(row.id);
      if (item) item.proposicoes = row.total;
    }
    for (const row of mensais.rows) {
      (byId.get(row.id)?.gastosMensais as Array<unknown> | undefined)?.push({ano: row.ano, mes: row.mes, total: row.total});
    }
    for (const row of categorias.rows) {
      const item = byId.get(row.id);
      if (!item) continue;
      (item.gastosCategorias as Array<unknown>).push({tipo: row.tipo, total: row.total});
      item.totalDespesas = Number(item.totalDespesas) + row.total;
    }

    const geral = (totais.rows as Array<{geral?: boolean; tipo: string | null; total: number; politicos: number}>).find((row) => row.geral);
    const media = geral && geral.politicos > 0
      ? {
          gastoPorDeputado: geral.total / geral.politicos,
          categorias: (totais.rows as Array<{geral?: boolean; tipo: string | null; total: number; politicos: number}>)
            .filter((row) => !row.geral && row.tipo)
            .map((row) => ({tipo: row.tipo as string, media: row.total / geral.politicos})),
        }
      : null;

    sendJson(res, 200, {items: ids.map((id) => byId.get(id)), media});
  } catch {
    sendJson(res, 500, {error: 'Erro ao processar requisição'});
  }
});

app.get('/api/politicos/concordancia', async (req, res) => {
  try {
    const [a, b] = parseIdList(`${req.query.a ?? ''},${req.query.b ?? ''}`, 2);
    if (!a || !b) {
      sendJson(res, 400, {error: 'Informe dois parlamentares diferentes.'});
      return;
    }
    const result = await pool.query<{
      total: number;
      iguais: number;
      items: Array<{
        votacaoId: string;
        titulo: string;
        referencia: string | null;
        data: string | null;
        votoA: string;
        votoB: string;
      }>;
    }>(
      `
      WITH pares AS (
        SELECT v.id, v.titulo_publico, v.sigla_tipo, v.numero, v.ano, v.data_hora_votacao, va.voto AS voto_a, vb.voto AS voto_b
        FROM votos_deputados va
        JOIN votos_deputados vb ON vb.votacao_id = va.votacao_id AND vb.politico_id = $2::bigint
        JOIN votacoes v ON v.id = va.votacao_id
        WHERE va.politico_id = $1::bigint AND v.eh_subvotacao = false
      ), recentes AS (
        SELECT * FROM pares ORDER BY data_hora_votacao DESC NULLS LAST LIMIT 40
      )
      SELECT
        (SELECT COUNT(*)::int FROM pares) AS total,
        (SELECT COUNT(*)::int FROM pares WHERE lower(trim(voto_a)) = lower(trim(voto_b))) AS iguais,
        COALESCE((
          SELECT json_agg(json_build_object(
            'votacaoId', id,
            'titulo', titulo_publico,
            'referencia', CASE WHEN sigla_tipo IS NOT NULL AND numero IS NOT NULL THEN sigla_tipo || ' ' || numero || '/' || ano END,
            'data', data_hora_votacao,
            'votoA', voto_a,
            'votoB', voto_b
          ) ORDER BY data_hora_votacao DESC NULLS LAST)
          FROM recentes
        ), '[]'::json) AS items
      `,
      [a, b],
    );
    sendJson(res, 200, result.rows[0] ?? {total: 0, iguais: 0, items: []});
  } catch {
    sendJson(res, 500, {error: 'Erro ao processar requisição'});
  }
});

app.get('/api/politicos/novos', async (req, res) => {
  try {
    const limit = parseLimit(req);
    const status = parsePoliticoStatusFilter(req);
    const statusWhere = buildPoliticoStatusWhereSql(status);
    const result = await pool.query<{
      id: string;
      nome: string;
      partido: string;
      estado: string;
      foto: string | null;
      ativo: boolean;
      situacao: string | null;
      notaMedia: number;
      totalAvaliacoes: number;
      atualizadoEm: string | Date | null;
      cargo: string;
      nomeCivil: string | null;
      dataNascimento: string | Date | null;
      sexo: string | null;
      email: string | null;
      telefone: string | null;
      idLegislatura: number | null;
      dataUltimoStatus: string | Date | null;
      nomeEleitoral: string | null;
      condicaoEleitoral: string | null;
      urlWebsite: string | null;
      redesSociaisRaw: string | null;
      escolaridade: string | null;
      municipioNascimento: string | null;
      ufNascimento: string | null;
      gabineteNome: string | null;
      gabinetePredio: string | null;
      gabineteSala: string | null;
      gabineteAndar: string | null;
    }>(
      `
      SELECT
        p.id::text AS id,
        p.nome,
        p.sigla_partido AS partido,
        p.sigla_uf AS estado,
        p.url_foto AS foto,
        COALESCE(p.ativo, true) AS ativo,
        p.situacao,
        COALESCE(AVG(a.nota), 0)::double precision AS "notaMedia",
        COUNT(a.id)::int AS "totalAvaliacoes",
        p.atualizado_em AS "atualizadoEm",
        'Deputado Federal'::text AS cargo,
        p.nome_civil AS "nomeCivil",
        p.data_nascimento AS "dataNascimento",
        p.sexo,
        p.email,
        p.telefone,
        p.id_legislatura AS "idLegislatura",
        p.data_ultimo_status AS "dataUltimoStatus",
        p.nome_eleitoral AS "nomeEleitoral",
        p.condicao_eleitoral AS "condicaoEleitoral",
        p.url_website AS "urlWebsite",
        p.redes_sociais AS "redesSociaisRaw",
        p.escolaridade,
        p.municipio_nascimento AS "municipioNascimento",
        p.uf_nascimento AS "ufNascimento",
        p.gabinete_nome AS "gabineteNome",
        p.gabinete_predio AS "gabinetePredio",
        p.gabinete_sala AS "gabineteSala",
        p.gabinete_andar AS "gabineteAndar"
      FROM politicos p
      LEFT JOIN avaliacoes a ON a.politico_id = p.id
      WHERE ${statusWhere}
      GROUP BY
        p.id,
        p.nome,
        p.sigla_partido,
        p.sigla_uf,
        p.url_foto,
        p.ativo,
        p.situacao,
        p.atualizado_em
      ORDER BY p.atualizado_em DESC
      LIMIT $1
      `,
      [limit],
    );
    sendJson(res, 200, {items: result.rows});
  } catch {
    sendJson(res, 500, {error: 'Erro ao processar requisição'});
  }
});

app.get('/api/politicos/ranking', async (req, res) => {
  try {
    const expenseFilters=parseExpenseFilters(req.query);
    const limit = parseLimit(req);
    const offset = parseOffset(req);
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const metricParam = typeof req.query.metric === 'string' ? req.query.metric : undefined;
    const directionParam = typeof req.query.direction === 'string' ? req.query.direction : undefined;
    const filterParam = typeof req.query.filter === 'string' ? req.query.filter : undefined;
    const status = parsePoliticoStatusFilter(req);
    const where: string[] = [buildPoliticoStatusWhereSql(status)];
    const params: Array<string | number> = [];

    if (search) {
      params.push(`%${search}%`);
      where.push(
        `(p.nome ILIKE $${params.length} OR p.sigla_partido ILIKE $${params.length} OR p.sigla_uf ILIKE $${params.length} OR 'Deputado Federal' ILIKE $${params.length})`,
      );
    }

    const metric =
      metricParam === 'despesas' || metricParam === 'votacoes' || metricParam === 'nota'
        ? metricParam
        : 'nota';

    const direction =
      directionParam === 'asc' || directionParam === 'desc'
        ? directionParam
        : filterParam === 'worst'
          ? 'asc'
          : 'desc';

    const dirSql = direction === 'asc' ? 'ASC' : 'DESC';

    const orderBy =
      metric === 'despesas'
        ? `"totalDespesas" ${dirSql}, "notaMedia" DESC, "totalAvaliacoes" DESC, "atualizadoEm" DESC`
        : metric === 'votacoes'
          ? `"totalVotacoes" ${dirSql}, "notaMedia" DESC, "totalAvaliacoes" DESC, "atualizadoEm" DESC`
          : `"notaMedia" ${dirSql}, "totalAvaliacoes" DESC, "atualizadoEm" DESC`;

    const view=req.query.view;
    if(view==='cards'||view==='items'||view==='summary') {
      const revision=catalogEvents.revision;
      const query=buildProgressiveRankingQuery({view,where:where.join(' AND '),values:params,filters:expenseFilters,metric,direction,limit,offset});
      const result=await pool.query(query.text,query.values);
      sendJson(res,200,{...result.rows[0],revision});
      return;
    }

    const financial=expenseFinancialRowsCtes(expenseFilters,params,'d.politico_id IN (SELECT id FROM filtrados)',true);
    const coverage=expenseCoverageSql('filtrados',expenseFilters,params);

    const result = await pool.query<{
      totalCadastrados: number;
      total: number;
      totalDespesas: number;
      items: Array<{
        id: string;
        nome: string;
        partido: string;
        estado: string;
        foto: string | null;
        ativo: boolean;
        situacao: string | null;
        notaMedia: number;
        totalAvaliacoes: number;
        atualizadoEm: string | Date | null;
        cargo: string;
        nomeCivil: string | null;
        dataNascimento: string | Date | null;
        sexo: string | null;
        email: string | null;
        telefone: string | null;
        idLegislatura: number | null;
        dataUltimoStatus: string | Date | null;
        nomeEleitoral: string | null;
        condicaoEleitoral: string | null;
        urlWebsite: string | null;
        redesSociaisRaw: string | null;
        escolaridade: string | null;
        municipioNascimento: string | null;
        ufNascimento: string | null;
        gabineteNome: string | null;
        gabinetePredio: string | null;
        gabineteSala: string | null;
        gabineteAndar: string | null;
      }>;
    }>(
      `
      WITH filtrados AS (
        SELECT p.id FROM politicos p WHERE ${where.join(' AND ')}
      ), ${financial}, despesas_filtradas AS (
        SELECT d.politico_id, SUM(d.valor_liquido) AS total_despesas
        FROM financial_rows d
        GROUP BY d.politico_id
      ), pagina AS (
      SELECT
        p.id::text AS id,
        p.nome,
        p.sigla_partido AS partido,
        p.sigla_uf AS estado,
        p.url_foto AS foto,
        COALESCE(p.ativo, true) AS ativo,
        p.situacao,
        COALESCE(AVG(a.nota), 0)::double precision AS "notaMedia",
        COUNT(a.id)::int AS "totalAvaliacoes",
        COALESCE(dsum.total_despesas, 0)::double precision AS "totalDespesas",
        COALESCE(vcnt.total_votacoes, 0)::int AS "totalVotacoes",
        p.atualizado_em AS "atualizadoEm",
        'Deputado Federal'::text AS cargo,
        p.nome_civil AS "nomeCivil",
        p.data_nascimento AS "dataNascimento",
        p.sexo,
        p.email,
        p.telefone,
        p.id_legislatura AS "idLegislatura",
        p.data_ultimo_status AS "dataUltimoStatus",
        p.nome_eleitoral AS "nomeEleitoral",
        p.condicao_eleitoral AS "condicaoEleitoral",
        p.url_website AS "urlWebsite",
        p.redes_sociais AS "redesSociaisRaw",
        p.escolaridade,
        p.municipio_nascimento AS "municipioNascimento",
        p.uf_nascimento AS "ufNascimento",
        p.gabinete_nome AS "gabineteNome",
        p.gabinete_predio AS "gabinetePredio",
        p.gabinete_sala AS "gabineteSala",
        p.gabinete_andar AS "gabineteAndar"
      FROM politicos p
      INNER JOIN filtrados f ON f.id = p.id
      LEFT JOIN avaliacoes a ON a.politico_id = p.id
      LEFT JOIN despesas_filtradas dsum ON dsum.politico_id = p.id
      LEFT JOIN (
        SELECT politico_id, COUNT(*)::int AS total_votacoes
        FROM votos_deputados
        GROUP BY politico_id
      ) vcnt ON vcnt.politico_id = p.id
      GROUP BY
        p.id,
        p.nome,
        p.sigla_partido,
        p.sigla_uf,
        p.url_foto,
        p.ativo,
        p.situacao,
        p.atualizado_em,
        dsum.total_despesas,
        vcnt.total_votacoes
      ORDER BY ${orderBy}, p.id ASC
      LIMIT $${params.length + 1}
      OFFSET $${params.length + 2}
      )
      SELECT
        (SELECT COUNT(*)::int FROM politicos) AS "totalCadastrados",
        (SELECT COUNT(*)::int FROM filtrados) AS total,
        (SELECT COALESCE(SUM(total_despesas), 0)::double precision FROM despesas_filtradas) AS "totalDespesas",
        (SELECT COUNT(*)::int FROM avaliacoes a INNER JOIN filtrados f ON f.id=a.politico_id) AS "totalAvaliacoes",
        (SELECT COALESCE(AVG(a.nota),0)::double precision FROM avaliacoes a INNER JOIN filtrados f ON f.id=a.politico_id) AS "notaMedia",
        (SELECT COUNT(*)::int FROM votos_deputados v INNER JOIN filtrados f ON f.id=v.politico_id) AS "totalVotacoes",
        EXISTS(SELECT 1 FROM votos_deputados) AS "votacoesDisponiveis",
        ${coverage} AS cobertura,
        COALESCE((SELECT json_agg(pagina ORDER BY ${orderBy}, id::bigint ASC) FROM pagina), '[]'::json) AS items
      `,
      [...params, limit, offset],
    );

    sendJson(res, 200, result.rows[0]);
  } catch(error) {
    if(error instanceof ExpenseFilterError){sendJson(res,400,{error:error.message});return;}
    sendJson(res, 500, {error: 'Erro ao processar requisição'});
  }
});

app.get('/api/partidos/gastos', async (req, res) => {
  try {
    const limit = parseLimit(req);
    const directionParam = typeof req.query.direction === 'string' ? req.query.direction : undefined;
    const direction = directionParam === 'asc' || directionParam === 'desc' ? directionParam : 'desc';
    const dirSql = direction === 'asc' ? 'ASC' : 'DESC';
    const status = parsePoliticoStatusFilter(req);
    const statusWhere = buildPoliticoStatusWhereSql(status);
    const values:Array<string|number>=[];
    const expenseWhere=expenseScopeSql(parseExpenseFilters(req.query),values,false,'e');

    const result = await pool.query(
      `
      SELECT
        p.sigla_partido AS partido,
        COALESCE(SUM(d.total), 0)::double precision AS "totalDespesas",
        COUNT(p.id)::int AS "totalPoliticos"
      FROM politicos p
      LEFT JOIN (SELECT e.politico_id, SUM(e.valor_liquido) AS total FROM despesas e WHERE ${expenseWhere} GROUP BY e.politico_id) d ON d.politico_id = p.id
      WHERE ${statusWhere}
        AND p.sigla_partido IS NOT NULL
        AND p.sigla_partido <> ''
      GROUP BY p.sigla_partido
      ORDER BY "totalDespesas" ${dirSql}, partido ASC
      LIMIT $${values.length+1}
      `,
      [...values,limit],
    );

    sendJson(res, 200, {items: result.rows});
  } catch(error) {
    if(error instanceof ExpenseFilterError){sendJson(res,400,{error:error.message});return;}
    sendJson(res, 500, {error: 'Erro ao processar requisição'});
  }
});

app.get('/api/estados/resumo', async (req, res) => {
  try {
    const status = parsePoliticoStatusFilter(req);
    const statusWhere = buildPoliticoStatusWhereSql(status);

    const result = await pool.query(
      `
      SELECT
        p.sigla_uf AS uf,
        COUNT(p.id)::int AS "totalPoliticos",
        COALESCE(SUM(d.total), 0)::double precision AS "totalDespesas"
      FROM politicos p
      LEFT JOIN (SELECT politico_id, SUM(valor_liquido) AS total FROM despesas GROUP BY politico_id) d ON d.politico_id = p.id
      WHERE ${statusWhere}
        AND p.sigla_uf IS NOT NULL
        AND p.sigla_uf <> ''
      GROUP BY p.sigla_uf
      ORDER BY p.sigla_uf ASC
      `,
    );

    sendJson(res, 200, {items: result.rows});
  } catch {
    sendJson(res, 500, {error: 'Erro ao processar requisição'});
  }
});

app.get('/api/partidos', async (req, res) => {
  try {
    const limit = parseLimit(req);
    const offset = parseOffset(req);
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const sortParam = typeof req.query.sort === 'string' ? req.query.sort : undefined;
    const directionParam = typeof req.query.direction === 'string' ? req.query.direction : undefined;
    const direction = directionParam === 'asc' || directionParam === 'desc' ? directionParam : 'asc';
    const dirSql = direction === 'desc' ? 'DESC' : 'ASC';
    const status = parsePoliticoStatusFilter(req);
    const statusWhere = buildPoliticoStatusWhereSql(status);
    const params: Array<string | number> = [];
    const where: string[] = [];

    if (search) {
      params.push(`%${search}%`);
      const searchParamIndex = params.length;
      where.push(
        `(COALESCE(c.sigla, agg.partido) ILIKE $${searchParamIndex} OR c.nome ILIKE $${searchParamIndex})`,
      );
    }

    const orderBy =
      sortParam === 'despesas'
        ? `"totalDespesas" ${dirSql}, partido ASC`
        : sortParam === 'politicos'
          ? `"totalPoliticos" ${dirSql}, partido ASC`
          : sortParam === 'nota'
            ? `"notaMedia" ${dirSql}, partido ASC`
            : sortParam === 'votacoes'
              ? `"totalVotacoes" ${dirSql}, partido ASC`
              : sortParam === 'nome'
                ? `nome ${dirSql}, partido ASC`
                : `partido ${dirSql}`;

    params.push(limit);
    params.push(offset);

    const result = await pool.query(
      `
      WITH dsum AS (
        SELECT politico_id, SUM(valor_liquido)::double precision AS total_despesas
        FROM despesas
        GROUP BY politico_id
      ),
      vcnt AS (
        SELECT politico_id, COUNT(*)::int AS total_votacoes
        FROM votos_deputados
        GROUP BY politico_id
      ),
      ar AS (
        SELECT politico_id, AVG(nota)::double precision AS nota_media, COUNT(*)::int AS total_avaliacoes
        FROM avaliacoes
        GROUP BY politico_id
      ),
      agg AS (
        SELECT
          p.sigla_partido AS partido,
          COUNT(DISTINCT p.id)::int AS "totalPoliticos",
          COUNT(DISTINCT p.id) FILTER (WHERE p.ativo IS DISTINCT FROM false)::int AS "totalAtivos",
          COUNT(DISTINCT p.sigla_uf)::int AS "totalEstados",
          COALESCE(SUM(dsum.total_despesas), 0)::double precision AS "totalDespesas",
          COALESCE(SUM(vcnt.total_votacoes), 0)::int AS "totalVotacoes",
          COALESCE(AVG(ar.nota_media), 0)::double precision AS "notaMedia",
          COALESCE(SUM(ar.total_avaliacoes), 0)::int AS "totalAvaliacoes",
          MAX(p.atualizado_em) AS "atualizadoEm"
        FROM politicos p
        LEFT JOIN dsum ON dsum.politico_id = p.id
        LEFT JOIN vcnt ON vcnt.politico_id = p.id
        LEFT JOIN ar ON ar.politico_id = p.id
        WHERE ${statusWhere}
          AND p.sigla_partido IS NOT NULL
          AND p.sigla_partido <> ''
        GROUP BY p.sigla_partido
      )
      SELECT
        COALESCE(c.sigla, agg.partido) AS partido,
        COALESCE(c.nome, COALESCE(c.sigla, agg.partido)) AS nome,
        c.id::text AS id,
        c.numero_eleitoral AS "numeroEleitoral",
        c.url_logo AS "logoUrl",
        c.url_website AS "websiteUrl",
        c.url_facebook AS "facebookUrl",
        c.status_json AS "statusJson",
        c.atualizado_em AS "partidoAtualizadoEm",
        COALESCE(agg."totalPoliticos", 0)::int AS "totalPoliticos",
        COALESCE(agg."totalAtivos", 0)::int AS "totalAtivos",
        COALESCE(agg."totalEstados", 0)::int AS "totalEstados",
        COALESCE(agg."totalDespesas", 0)::double precision AS "totalDespesas",
        COALESCE(agg."totalVotacoes", 0)::int AS "totalVotacoes",
        COALESCE(agg."notaMedia", 0)::double precision AS "notaMedia",
        COALESCE(agg."totalAvaliacoes", 0)::int AS "totalAvaliacoes",
        agg."atualizadoEm"
      FROM camara_partidos c
      FULL OUTER JOIN agg ON agg.partido = c.sigla
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${orderBy}
      LIMIT $${params.length - 1}
      OFFSET $${params.length}
      `,
      params,
    );

    sendJson(res, 200, {items: result.rows});
  } catch {
    sendJson(res, 500, {error: 'Erro ao processar requisição'});
  }
});

app.get('/api/partidos/:sigla/politicos', async (req, res) => {
  try {
    const limit = parseLimit(req);
    const offset = parseOffset(req);
    const sigla = req.params.sigla.trim();
    const status = parsePoliticoStatusFilter(req);
    const statusWhere = buildPoliticoStatusWhereSql(status);

    if (!sigla) {
      sendJson(res, 400, {error: 'Partido invalido'});
      return;
    }

    const result = await pool.query(
      `
      SELECT
        p.id::text AS id,
        p.nome,
        p.sigla_partido AS partido,
        p.sigla_uf AS estado,
        p.url_foto AS foto,
        COALESCE(p.ativo, true) AS ativo,
        p.situacao,
        COALESCE(AVG(a.nota), 0)::double precision AS "notaMedia",
        COUNT(a.id)::int AS "totalAvaliacoes",
        COALESCE(dsum.total_despesas, 0)::double precision AS "totalDespesas",
        COALESCE(vcnt.total_votacoes, 0)::int AS "totalVotacoes",
        p.atualizado_em AS "atualizadoEm",
        'Deputado Federal'::text AS cargo
      FROM politicos p
      LEFT JOIN avaliacoes a ON a.politico_id = p.id
      LEFT JOIN (
        SELECT politico_id, SUM(valor_liquido)::double precision AS total_despesas
        FROM despesas
        GROUP BY politico_id
      ) dsum ON dsum.politico_id = p.id
      LEFT JOIN (
        SELECT politico_id, COUNT(*)::int AS total_votacoes
        FROM votos_deputados
        GROUP BY politico_id
      ) vcnt ON vcnt.politico_id = p.id
      WHERE ${statusWhere}
        AND p.sigla_partido = $1
      GROUP BY
        p.id,
        p.nome,
        p.sigla_partido,
        p.sigla_uf,
        p.url_foto,
        p.ativo,
        p.situacao,
        p.atualizado_em,
        dsum.total_despesas,
        vcnt.total_votacoes
      ORDER BY p.nome ASC
      LIMIT $2
      OFFSET $3
      `,
      [sigla, limit, offset],
    );

    sendJson(res, 200, {items: result.rows});
  } catch {
    sendJson(res, 500, {error: 'Erro ao processar requisição'});
  }
});

app.get('/api/camara/proposicoes', async (req, res) => {
  try {
    const limit = parseLimit(req);
    const offset = parseOffset(req);
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const tipo = typeof req.query.tipo === 'string' ? req.query.tipo.trim() : '';
    const situacao = typeof req.query.situacao === 'string' ? req.query.situacao.trim() : '';
    const ano = parseOptionalInt(req.query.ano);
    const params: Array<string | number> = [];
    const where: string[] = [];

    if (search) {
      params.push(`%${search}%`);
      where.push(`(p.ementa ILIKE $${params.length} OR p.keywords ILIKE $${params.length} OR p.texto ILIKE $${params.length})`);
    }
    if (tipo) {
      params.push(tipo);
      where.push(`p.sigla_tipo = $${params.length}`);
    }
    if (ano != null) {
      params.push(ano);
      where.push(`p.ano = $${params.length}`);
    }
    if (situacao) {
      params.push(`%${situacao}%`);
      where.push(`COALESCE(p.status_proposicao_json->>'descricaoSituacao', p.status_proposicao_json->>'situacao') ILIKE $${params.length}`);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    params.push(limit, offset);

    const result = await pool.query(
      `
      SELECT
        p.id::text AS id,
        p.sigla_tipo AS "siglaTipo",
        p.numero,
        p.ano,
        p.ementa,
        p.descricao_tipo AS "descricaoTipo",
        p.data_apresentacao AS "dataApresentacao",
        p.url_inteiro_teor AS "urlInteiroTeor",
        COALESCE(p.status_proposicao_json->>'descricaoSituacao', p.status_proposicao_json->>'situacao') AS situacao,
        COALESCE(tema.total, 0)::int AS "totalTemas",
        COALESCE(autor.total, 0)::int AS "totalAutores",
        COALESCE(tram.total, 0)::int AS "totalTramitacoes"
      FROM camara_proposicoes p
      LEFT JOIN (
        SELECT proposicao_id, COUNT(*)::int AS total
        FROM camara_proposicoes_temas
        GROUP BY proposicao_id
      ) tema ON tema.proposicao_id = p.id
      LEFT JOIN (
        SELECT proposicao_id, COUNT(*)::int AS total
        FROM camara_proposicoes_autores
        GROUP BY proposicao_id
      ) autor ON autor.proposicao_id = p.id
      LEFT JOIN (
        SELECT proposicao_id, COUNT(*)::int AS total
        FROM camara_proposicoes_tramitacoes
        GROUP BY proposicao_id
      ) tram ON tram.proposicao_id = p.id
      ${whereClause}
      ORDER BY p.data_apresentacao DESC NULLS LAST, p.ano DESC NULLS LAST, p.id DESC
      LIMIT $${params.length - 1}
      OFFSET $${params.length}
      `,
      params,
    );

    sendJson(res, 200, {items: result.rows});
  } catch {
    sendJson(res, 500, {error: 'Erro ao processar requisição'});
  }
});

app.get('/api/camara/proposicoes/:id', async (req, res) => {
  try {
    const {id} = req.params;
    if (!/^[1-9]\d{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n) {
      sendJson(res, 400, {error: 'Identificador de proposição inválido.'});
      return;
    }
    const proposicaoResult = await pool.query(
      `
      SELECT
        p.id::text AS id,
        p.sigla_tipo AS "siglaTipo",
        p.numero,
        p.ano,
        p.ementa,
        p.ementa_detalhada AS "ementaDetalhada",
        p.descricao_tipo AS "descricaoTipo",
        p.data_apresentacao AS "dataApresentacao",
        p.keywords,
        p.url_inteiro_teor AS "urlInteiroTeor",
        p.texto,
        p.justificativa,
        p.status_proposicao_json AS "statusProposicao",
        COALESCE(p.status_proposicao_json->>'descricaoSituacao', p.status_proposicao_json->>'situacao') AS situacao
      FROM camara_proposicoes p
      WHERE p.id = $1::bigint
      LIMIT 1
      `,
      [id],
    );

    const proposicao = proposicaoResult.rows[0];
    if (!proposicao) {
      sendJson(res, 404, {error: 'Proposição não encontrada'});
      return;
    }

    const [autores, temas, tramitacoes, relacionadas] = await Promise.all([
      pool.query(
        `
        SELECT nome, tipo, ordem_assinatura AS "ordemAssinatura", proponente
        FROM camara_proposicoes_autores
        WHERE proposicao_id = $1::bigint
        ORDER BY ordem_assinatura ASC NULLS LAST, nome ASC
        `,
        [id],
      ),
      pool.query(
        `
        SELECT tema, relevancia
        FROM camara_proposicoes_temas
        WHERE proposicao_id = $1::bigint
        ORDER BY relevancia DESC NULLS LAST, tema ASC
        `,
        [id],
      ),
      pool.query(
        `
        SELECT
          sequencia,
          data_hora AS "dataHora",
          sigla_orgao AS "siglaOrgao",
          regime,
          descricao_tramitacao AS "descricaoTramitacao",
          descricao_situacao AS "descricaoSituacao",
          despacho,
          url
        FROM camara_proposicoes_tramitacoes
        WHERE proposicao_id = $1::bigint
        ORDER BY sequencia DESC
        LIMIT 80
        `,
        [id],
      ),
      pool.query(
        `
        SELECT r.relacionada_id::text AS id, p.sigla_tipo AS "siglaTipo", p.numero, p.ano, p.ementa
        FROM camara_proposicoes_relacionadas r
        LEFT JOIN camara_proposicoes p ON p.id = r.relacionada_id
        WHERE r.proposicao_id = $1::bigint
        ORDER BY p.ano DESC NULLS LAST, p.numero DESC NULLS LAST
        LIMIT 40
        `,
        [id],
      ),
    ]);

    sendJson(res, 200, {
      proposicao,
      autores: autores.rows,
      temas: temas.rows,
      tramitacoes: tramitacoes.rows,
      relacionadas: relacionadas.rows,
    });
  } catch {
    sendJson(res, 500, {error: 'Erro ao processar requisição'});
  }
});

app.get('/api/camara/eventos', async (req, res) => {
  try {
    const limit = parseLimit(req);
    const offset = parseOffset(req);
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const tipo = typeof req.query.tipo === 'string' ? req.query.tipo.trim() : '';
    const situacao = typeof req.query.situacao === 'string' ? req.query.situacao.trim() : '';
    const params: Array<string | number> = [];
    const where: string[] = [];

    if (search) {
      params.push(`%${search}%`);
      where.push(`(e.descricao ILIKE $${params.length} OR e.descricao_tipo ILIKE $${params.length} OR e.local_externo ILIKE $${params.length})`);
    }
    if (tipo) {
      params.push(`%${tipo}%`);
      where.push(`e.descricao_tipo ILIKE $${params.length}`);
    }
    if (situacao) {
      params.push(`%${situacao}%`);
      where.push(`e.situacao ILIKE $${params.length}`);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    params.push(limit, offset);
    const result = await pool.query(
      `
      SELECT
        e.id::text AS id,
        e.data_hora_inicio AS "dataHoraInicio",
        e.data_hora_fim AS "dataHoraFim",
        e.situacao,
        e.descricao_tipo AS "descricaoTipo",
        e.descricao,
        e.local_externo AS "localExterno",
        e.local_camara_json AS "localCamara",
        e.orgaos_json AS orgaos,
        e.url_registro AS "urlRegistro"
      FROM camara_eventos e
      ${whereClause}
      ORDER BY e.data_hora_inicio DESC NULLS LAST, e.id DESC
      LIMIT $${params.length - 1}
      OFFSET $${params.length}
      `,
      params,
    );
    sendJson(res, 200, {items: result.rows});
  } catch {
    sendJson(res, 500, {error: 'Erro ao processar requisição'});
  }
});

app.get('/api/camara/orgaos', async (req, res) => {
  try {
    const limit = parseLimit(req);
    const offset = parseOffset(req);
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const tipo = typeof req.query.tipo === 'string' ? req.query.tipo.trim() : '';
    const params: Array<string | number> = [];
    const where: string[] = [];

    if (search) {
      params.push(`%${search}%`);
      where.push(`(o.sigla ILIKE $${params.length} OR o.nome ILIKE $${params.length} OR o.apelido ILIKE $${params.length})`);
    }
    if (tipo) {
      params.push(`%${tipo}%`);
      where.push(`o.tipo_orgao ILIKE $${params.length}`);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    params.push(limit, offset);
    const result = await pool.query(
      `
      SELECT
        o.id::text AS id,
        o.sigla,
        o.nome,
        o.apelido,
        o.tipo_orgao AS "tipoOrgao",
        o.nome_publicacao AS "nomePublicacao",
        o.nome_resumido AS "nomeResumido"
      FROM camara_orgaos o
      ${whereClause}
      ORDER BY o.sigla ASC NULLS LAST, o.nome ASC
      LIMIT $${params.length - 1}
      OFFSET $${params.length}
      `,
      params,
    );
    sendJson(res, 200, {items: result.rows});
  } catch {
    sendJson(res, 500, {error: 'Erro ao processar requisição'});
  }
});

app.get('/api/camara/frentes', async (req, res) => {
  try {
    const limit = parseLimit(req);
    const offset = parseOffset(req);
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const legislatura = parseOptionalInt(req.query.legislatura);
    const params: Array<string | number> = [];
    const where: string[] = [];

    if (search) {
      params.push(`%${search}%`);
      where.push(`f.titulo ILIKE $${params.length}`);
    }
    if (legislatura != null) {
      params.push(legislatura);
      where.push(`f.id_legislatura = $${params.length}`);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    params.push(limit, offset);
    const result = await pool.query(
      `
      SELECT
        f.id::text AS id,
        f.titulo,
        f.id_legislatura AS "idLegislatura",
        f.uri
      FROM camara_frentes f
      ${whereClause}
      ORDER BY f.id_legislatura DESC NULLS LAST, f.titulo ASC
      LIMIT $${params.length - 1}
      OFFSET $${params.length}
      `,
      params,
    );
    sendJson(res, 200, {items: result.rows});
  } catch {
    sendJson(res, 500, {error: 'Erro ao processar requisição'});
  }
});

app.get('/api/politicos/:politicoId/orgaos', async (req, res) => {
  try {
    const {politicoId} = req.params;
    const result = await pool.query(
      `
      SELECT
        d.orgao_id::text AS "orgaoId",
        d.sigla_orgao AS "siglaOrgao",
        d.nome_orgao AS "nomeOrgao",
        d.nome_publicacao AS "nomePublicacao",
        d.titulo,
        d.data_inicio AS "dataInicio",
        d.data_fim AS "dataFim",
        o.tipo_orgao AS "tipoOrgao"
      FROM camara_deputados_orgaos d
      LEFT JOIN camara_orgaos o ON o.id = d.orgao_id
      WHERE d.politico_id = $1::bigint
      ORDER BY d.data_fim DESC NULLS FIRST, d.data_inicio DESC NULLS LAST, d.sigla_orgao ASC
      `,
      [politicoId],
    );
    sendJson(res, 200, {items: result.rows});
  } catch {
    sendJson(res, 500, {error: 'Erro ao processar requisição'});
  }
});

app.get('/api/politicos/:politicoId/eventos', async (req, res) => {
  try {
    const {politicoId} = req.params;
    const limit = parseLimit(req);
    const result = await pool.query(
      `
      SELECT
        e.id::text AS id,
        e.data_hora_inicio AS "dataHoraInicio",
        e.data_hora_fim AS "dataHoraFim",
        e.situacao,
        e.descricao_tipo AS "descricaoTipo",
        e.descricao,
        e.local_externo AS "localExterno",
        e.local_camara_json AS "localCamara",
        e.orgaos_json AS orgaos,
        e.url_registro AS "urlRegistro"
      FROM camara_deputados_eventos de
      JOIN camara_eventos e ON e.id = de.evento_id
      WHERE de.politico_id = $1::bigint
      ORDER BY e.data_hora_inicio DESC NULLS LAST
      LIMIT $2
      `,
      [politicoId, limit],
    );
    sendJson(res, 200, {items: result.rows});
  } catch {
    sendJson(res, 500, {error: 'Erro ao processar requisição'});
  }
});

app.get('/api/politicos/:politicoId/frentes', async (req, res) => {
  try {
    const {politicoId} = req.params;
    const result = await pool.query(
      `
      SELECT
        f.id::text AS id,
        f.titulo,
        f.id_legislatura AS "idLegislatura",
        f.uri
      FROM camara_deputados_frentes df
      JOIN camara_frentes f ON f.id = df.frente_id
      WHERE df.politico_id = $1::bigint
      ORDER BY f.id_legislatura DESC NULLS LAST, f.titulo ASC
      `,
      [politicoId],
    );
    sendJson(res, 200, {items: result.rows});
  } catch {
    sendJson(res, 500, {error: 'Erro ao processar requisição'});
  }
});

app.get('/api/politicos/:politicoId/historico-profissional', async (req, res) => {
  try {
    const {politicoId} = req.params;
    const [profissoes, ocupacoes] = await Promise.all([
      pool.query(
        `
        SELECT titulo, data_hora AS "dataHora"
        FROM camara_deputados_profissoes
        WHERE politico_id = $1::bigint
        ORDER BY titulo ASC
        `,
        [politicoId],
      ),
      pool.query(
        `
        SELECT titulo, entidade, entidade_uf AS "entidadeUf", entidade_pais AS "entidadePais", ano_inicio AS "anoInicio", ano_fim AS "anoFim"
        FROM camara_deputados_ocupacoes
        WHERE politico_id = $1::bigint
        ORDER BY ano_fim DESC NULLS FIRST, ano_inicio DESC NULLS LAST, titulo ASC
        `,
        [politicoId],
      ),
    ]);
    sendJson(res, 200, {profissoes: profissoes.rows, ocupacoes: ocupacoes.rows});
  } catch {
    sendJson(res, 500, {error: 'Erro ao processar requisição'});
  }
});

app.get('/api/politicos/:politicoId/atuacao', async (req, res) => {
  try {
    const {politicoId} = req.params;
    const [orgaos, eventos, frentes, historico, proposicoes] = await Promise.all([
      pool.query(
        `
        SELECT d.orgao_id::text AS "orgaoId", d.sigla_orgao AS "siglaOrgao", d.nome_orgao AS "nomeOrgao", d.nome_publicacao AS "nomePublicacao", d.titulo, d.data_inicio AS "dataInicio", d.data_fim AS "dataFim", o.tipo_orgao AS "tipoOrgao"
        FROM camara_deputados_orgaos d
        LEFT JOIN camara_orgaos o ON o.id = d.orgao_id
        WHERE d.politico_id = $1::bigint
        ORDER BY d.data_fim DESC NULLS FIRST, d.data_inicio DESC NULLS LAST
        LIMIT 80
        `,
        [politicoId],
      ),
      pool.query(
        `
        SELECT e.id::text AS id, e.data_hora_inicio AS "dataHoraInicio", e.situacao, e.descricao_tipo AS "descricaoTipo", e.descricao, e.local_externo AS "localExterno", e.local_camara_json AS "localCamara", e.orgaos_json AS orgaos, e.url_registro AS "urlRegistro"
        FROM camara_deputados_eventos de
        JOIN camara_eventos e ON e.id = de.evento_id
        WHERE de.politico_id = $1::bigint
        ORDER BY e.data_hora_inicio DESC NULLS LAST
        LIMIT 20
        `,
        [politicoId],
      ),
      pool.query(
        `
        SELECT f.id::text AS id, f.titulo, f.id_legislatura AS "idLegislatura", f.uri
        FROM camara_deputados_frentes df
        JOIN camara_frentes f ON f.id = df.frente_id
        WHERE df.politico_id = $1::bigint
        ORDER BY f.id_legislatura DESC NULLS LAST, f.titulo ASC
        LIMIT 80
        `,
        [politicoId],
      ),
      Promise.all([
        pool.query('SELECT titulo, data_hora AS "dataHora" FROM camara_deputados_profissoes WHERE politico_id = $1::bigint ORDER BY titulo ASC', [politicoId]),
        pool.query('SELECT titulo, entidade, entidade_uf AS "entidadeUf", entidade_pais AS "entidadePais", ano_inicio AS "anoInicio", ano_fim AS "anoFim" FROM camara_deputados_ocupacoes WHERE politico_id = $1::bigint ORDER BY ano_fim DESC NULLS FIRST, ano_inicio DESC NULLS LAST, titulo ASC', [politicoId]),
      ]),
      pool.query(
        `
        SELECT DISTINCT
          p.id::text AS id,
          p.sigla_tipo AS "siglaTipo",
          p.numero,
          p.ano,
          p.ementa,
          p.data_apresentacao AS "dataApresentacao",
          p.url_inteiro_teor AS "urlInteiroTeor",
          COALESCE(p.status_proposicao_json->>'descricaoSituacao', p.status_proposicao_json->>'situacao') AS situacao
        FROM votos_deputados vd
        JOIN votacoes v ON v.id = vd.votacao_id
        JOIN camara_proposicoes p ON p.uri = v.uri_proposicao_objeto OR p.id::text = regexp_replace(COALESCE(v.uri_proposicao_objeto, ''), '^.*/', '')
        WHERE vd.politico_id = $1::bigint
        ORDER BY p.data_apresentacao DESC NULLS LAST
        LIMIT 20
        `,
        [politicoId],
      ),
    ]);

    const [profissoes, ocupacoes] = historico;
    sendJson(res, 200, {
      orgaos: orgaos.rows,
      eventos: eventos.rows,
      frentes: frentes.rows,
      profissoes: profissoes.rows,
      ocupacoes: ocupacoes.rows,
      proposicoes: proposicoes.rows,
    });
  } catch {
    sendJson(res, 500, {error: 'Erro ao processar requisição'});
  }
});

app.get('/api/politicos', async (req, res) => {
  try {
    const limit = parseLimit(req);
    const offset = parseOffset(req);
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const status = parsePoliticoStatusFilter(req);

    const where: string[] = [buildPoliticoStatusWhereSql(status)];
    const params: Array<string | number> = [];
    let orderBy = 'p.nome ASC';

    if (search) {
      params.push(`%${search}%`);
      const searchParamIndex = params.length;
      params.push(search);
      const searchExactParamIndex = params.length;
      where.push(
        `(p.nome ILIKE $${searchParamIndex} OR p.sigla_partido ILIKE $${searchParamIndex} OR p.sigla_uf ILIKE $${searchParamIndex})`,
      );

      orderBy = `
        CASE
          WHEN p.nome ILIKE $${searchExactParamIndex} THEN 0
          WHEN p.nome ILIKE $${searchExactParamIndex} || '%' THEN 1
          WHEN p.nome ILIKE '% ' || $${searchExactParamIndex} || '%' THEN 2
          WHEN p.sigla_partido ILIKE $${searchExactParamIndex} || '%' THEN 3
          WHEN p.sigla_uf ILIKE $${searchExactParamIndex} || '%' THEN 4
          ELSE 5
        END,
        p.nome ASC
      `;
    }

    params.push(limit);
    params.push(offset);

    const result = await pool.query(
      `
      SELECT
        p.id::text AS id,
        p.nome,
        p.sigla_partido AS partido,
        p.sigla_uf AS estado,
        p.url_foto AS foto,
        COALESCE(p.ativo, true) AS ativo,
        p.situacao,
        COALESCE(AVG(a.nota), 0)::double precision AS "notaMedia",
        COUNT(a.id)::int AS "totalAvaliacoes",
        p.atualizado_em AS "atualizadoEm",
        'Deputado Federal'::text AS cargo,
        p.nome_civil AS "nomeCivil",
        p.data_nascimento AS "dataNascimento",
        p.sexo,
        p.email,
        p.telefone,
        p.id_legislatura AS "idLegislatura",
        p.data_ultimo_status AS "dataUltimoStatus",
        p.nome_eleitoral AS "nomeEleitoral",
        p.condicao_eleitoral AS "condicaoEleitoral",
        p.url_website AS "urlWebsite",
        p.redes_sociais AS "redesSociaisRaw",
        p.escolaridade,
        p.municipio_nascimento AS "municipioNascimento",
        p.uf_nascimento AS "ufNascimento",
        p.gabinete_nome AS "gabineteNome",
        p.gabinete_predio AS "gabinetePredio",
        p.gabinete_sala AS "gabineteSala",
        p.gabinete_andar AS "gabineteAndar"
      FROM politicos p
      LEFT JOIN avaliacoes a ON a.politico_id = p.id
      WHERE ${where.join(' AND ')}
      GROUP BY
        p.id,
        p.nome,
        p.sigla_partido,
        p.sigla_uf,
        p.url_foto,
        p.ativo,
        p.situacao,
        p.atualizado_em,
        p.nome_civil,
        p.data_nascimento,
        p.sexo,
        p.email,
        p.telefone,
        p.id_legislatura,
        p.data_ultimo_status,
        p.nome_eleitoral,
        p.condicao_eleitoral,
        p.url_website,
        p.redes_sociais,
        p.escolaridade,
        p.municipio_nascimento,
        p.uf_nascimento,
        p.gabinete_nome,
        p.gabinete_predio,
        p.gabinete_sala,
        p.gabinete_andar
      ORDER BY ${orderBy}
      LIMIT $${params.length - 1}
      OFFSET $${params.length}
      `,
      params,
    );

    sendJson(res, 200, {items: result.rows});
  } catch {
    sendJson(res, 500, {error: 'Erro ao processar requisição'});
  }
});

app.get('/api/politicos/:politicoId', async (req, res) => {
  try {
    const {politicoId} = req.params;
    const result = await pool.query<{
      id: string;
      nome: string;
      partido: string;
      estado: string;
      foto: string | null;
      ativo: boolean;
      situacao: string | null;
      notaMedia: number;
      totalAvaliacoes: number;
      atualizadoEm: string | Date | null;
      cargo: string;
      nomeCivil: string | null;
      dataNascimento: string | Date | null;
      sexo: string | null;
      email: string | null;
      telefone: string | null;
      idLegislatura: number | null;
      dataUltimoStatus: string | Date | null;
      nomeEleitoral: string | null;
      condicaoEleitoral: string | null;
      urlWebsite: string | null;
      redesSociaisRaw: string | null;
      escolaridade: string | null;
      municipioNascimento: string | null;
      ufNascimento: string | null;
      gabineteNome: string | null;
      gabinetePredio: string | null;
      gabineteSala: string | null;
      gabineteAndar: string | null;
    }>(
      `
      SELECT
        EXISTS(SELECT 1 FROM votos_deputados) AS "votacoesDisponiveis",
        p.id::text AS id,
        p.nome,
        p.sigla_partido AS partido,
        p.sigla_uf AS estado,
        p.url_foto AS foto,
        COALESCE(p.ativo, true) AS ativo,
        p.situacao,
        COALESCE(AVG(a.nota), 0)::double precision AS "notaMedia",
        COUNT(a.id)::int AS "totalAvaliacoes",
        p.atualizado_em AS "atualizadoEm",
        'Deputado Federal'::text AS cargo,
        p.nome_civil AS "nomeCivil",
        p.data_nascimento AS "dataNascimento",
        p.sexo,
        p.email,
        p.telefone,
        p.id_legislatura AS "idLegislatura",
        p.data_ultimo_status AS "dataUltimoStatus",
        p.nome_eleitoral AS "nomeEleitoral",
        p.condicao_eleitoral AS "condicaoEleitoral",
        p.url_website AS "urlWebsite",
        p.redes_sociais AS "redesSociaisRaw",
        p.escolaridade,
        p.municipio_nascimento AS "municipioNascimento",
        p.uf_nascimento AS "ufNascimento",
        p.gabinete_nome AS "gabineteNome",
        p.gabinete_predio AS "gabinetePredio",
        p.gabinete_sala AS "gabineteSala",
        p.gabinete_andar AS "gabineteAndar"
      FROM politicos p
      LEFT JOIN avaliacoes a ON a.politico_id = p.id
      WHERE p.id = $1::bigint
      GROUP BY
        p.id,
        p.nome,
        p.sigla_partido,
        p.sigla_uf,
        p.url_foto,
        p.ativo,
        p.situacao,
        p.atualizado_em,
        p.nome_civil,
        p.data_nascimento,
        p.sexo,
        p.email,
        p.telefone,
        p.id_legislatura,
        p.data_ultimo_status,
        p.nome_eleitoral,
        p.condicao_eleitoral,
        p.url_website,
        p.redes_sociais,
        p.escolaridade,
        p.municipio_nascimento,
        p.uf_nascimento,
        p.gabinete_nome,
        p.gabinete_predio,
        p.gabinete_sala,
        p.gabinete_andar
      LIMIT 1
      `,
      [politicoId],
    );

    const politicoRow = result.rows[0];
    if (!politicoRow) {
      sendJson(res, 404, {error: 'Político não encontrado'});
      return;
    }

    const {redesSociaisRaw, ...politicoBase} = politicoRow;
    const politico = {
      ...politicoBase,
      redesSociais: parseJsonStringArray(redesSociaisRaw),
    };

    sendJson(res, 200, {politico});
  } catch {
    sendJson(res, 500, {error: 'Erro ao processar requisição'});
  }
});

app.post('/api/politicos/:politicoId/avaliacoes', limitEvaluations, async (req, res) => {
  try {
    const {politicoId} = req.params;
    const cpf = normalizeCpf(req.body?.cpf);
    const nota = parseNota(req.body?.nota);
    const {comentario, error: comentarioError} = parseComentario(req.body?.comentario);

    if (!isValidCpf(cpf)) {
      sendJson(res, 400, {error: 'CPF invalido. Confira os numeros e tente novamente.'});
      return;
    }

    if (nota == null) {
      sendJson(res, 400, {error: 'A nota deve ser um numero inteiro entre 1 e 5.'});
      return;
    }

    if (comentarioError) {
      sendJson(res, 400, {error: comentarioError});
      return;
    }

    const politicoResult = await pool.query<{id: string}>(
      `
      SELECT p.id::text AS id
      FROM politicos p
      WHERE p.id = $1::bigint
      LIMIT 1
      `,
      [politicoId],
    );

    const politico = politicoResult.rows[0];

    if (!politico) {
      sendJson(res, 404, {error: 'Politico nao encontrado.'});
      return;
    }

    const cpfHash = hashCpf(cpf);
    const existingResult = await pool.query(
      `
      SELECT a.id
      FROM avaliacoes a
      WHERE a.politico_id = $1::bigint
        AND a.cpf_hash = $2
      LIMIT 1
      `,
      [politico.id, cpfHash],
    );

    await pool.query(
      `
      INSERT INTO avaliacoes (politico_id, cpf_hash, nota, comentario)
      VALUES ($1::bigint, $2, $3, $4)
      ON CONFLICT (politico_id, cpf_hash)
      DO UPDATE SET
        nota = EXCLUDED.nota,
        comentario = EXCLUDED.comentario,
        data_avaliacao = NOW()
      `,
      [politico.id, cpfHash, nota, comentario],
    );

    const summaryResult = await pool.query<{
      notaMedia: number;
      totalAvaliacoes: number;
    }>(
      `
      SELECT
        COALESCE(AVG(a.nota), 0)::double precision AS "notaMedia",
        COUNT(a.id)::int AS "totalAvaliacoes"
      FROM avaliacoes a
      WHERE a.politico_id = $1::bigint
      `,
      [politico.id],
    );

    const summary = summaryResult.rows[0] ?? {notaMedia: 0, totalAvaliacoes: 0};
    const action = existingResult.rowCount > 0 ? 'updated' : 'created';

    sendJson(res, 200, {
      action,
      comentario,
      notaMedia: summary.notaMedia,
      totalAvaliacoes: summary.totalAvaliacoes,
      message:
        action === 'updated'
          ? 'Avaliacao atualizada com sucesso.'
          : 'Avaliacao registrada com sucesso.',
    });
  } catch {
    sendJson(res, 500, {error: 'Erro ao registrar avaliacao.'});
  }
});

app.get('/api/politicos/:politicoId/votacoes/anos', async (req, res) => {
  try {
    const {politicoId} = req.params;
    const result = await pool.query(
      `
      SELECT DISTINCT v.ano
      FROM votos_deputados vd
      JOIN votacoes v ON v.id = vd.votacao_id
      WHERE vd.politico_id = $1::bigint
        AND v.ano IS NOT NULL
      ORDER BY v.ano DESC
      `,
      [politicoId],
    );
    const anos = result.rows.map((r) => Number(r.ano)).filter((v) => Number.isFinite(v));
    sendJson(res, 200, {items: anos});
  } catch {
    sendJson(res, 500, {error: 'Erro ao processar requisição'});
  }
});

app.get('/api/politicos/:politicoId/votacoes', async (req, res) => {
  try {
    const {politicoId} = req.params;
    const limit = parseVoteLimit(req);
    const ano = parseOptionalInt(req.query.ano);
    const voteFilter = normalizeText(req.query.voto).slice(0, 50);
    const typeFilter = normalizeText(req.query.tipoVotacao).toLowerCase().slice(0, 30);
    const query = normalizeText(req.query.q).slice(0, 120);
    const cursor = parseVoteCursor(req.query.cursor);

    const where: string[] = ['vd.politico_id = $1::bigint'];
    const params: Array<string | number> = [politicoId];

    if (ano != null) {
      params.push(ano);
      where.push(`COALESCE(v.ano, EXTRACT(YEAR FROM v.data_hora_votacao)::int) = $${params.length}`);
    }

    if (voteFilter) {
      params.push(voteFilter);
      where.push(`vd.voto = $${params.length}`);
    }

    if (typeFilter) {
      params.push(typeFilter);
      where.push(`v.tipo_votacao = $${params.length}`);
    }

    if (query) {
      params.push(`%${query}%`);
      where.push(`(
        v.titulo_publico ILIKE $${params.length}
        OR v.ementa ILIKE $${params.length}
        OR v.proposicao_objeto ILIKE $${params.length}
      )`);
    }

    if (cursor) {
      params.push(cursor.dataVotacao, cursor.votacaoId);
      where.push(`(
        COALESCE(v.data_hora_votacao, TIMESTAMPTZ '1970-01-01'),
        v.id
      ) < ($${params.length - 1}::timestamptz, $${params.length})`);
    }

    params.push(limit + 1);

    const result = await pool.query<{
      votoId: string;
      politicoId: string;
      votacaoId: string;
      siglaTipo: string | null;
      numero: number | null;
      ano: number | null;
      ementa: string | null;
      resultado: string | null;
      proposicaoObjeto: string | null;
      uriProposicaoObjeto: string | null;
      tipoVotacao: string;
      ehSubvotacao: boolean;
      tituloPublico: string;
      resumoLeigo: string | null;
      classificacaoFonte: string;
      classificacaoConfianca: string;
      classificacaoVersao: string;
      classificacaoJustificativa: string | null;
      proposicaoPrincipalId: string | null;
      proposicaoPrincipalSiglaTipo: string | null;
      proposicaoPrincipalNumero: number | null;
      proposicaoPrincipalAno: number | null;
      proposicaoPrincipalEmenta: string | null;
      dataVotacao: string | Date | null;
      voto: string;
    }>(
      `
      SELECT
        vd.id::text AS "votoId",
        vd.politico_id::text AS "politicoId",
        v.id::text AS "votacaoId",
        v.sigla_tipo AS "siglaTipo",
        v.numero,
        v.ano,
        v.ementa,
        v.resultado,
        v.proposicao_objeto AS "proposicaoObjeto",
        v.uri_proposicao_objeto AS "uriProposicaoObjeto",
        v.tipo_votacao AS "tipoVotacao",
        v.eh_subvotacao AS "ehSubvotacao",
        v.titulo_publico AS "tituloPublico",
        v.resumo_leigo AS "resumoLeigo",
        v.classificacao_fonte AS "classificacaoFonte",
        v.classificacao_confianca AS "classificacaoConfianca",
        v.classificacao_versao AS "classificacaoVersao",
        v.classificacao_justificativa AS "classificacaoJustificativa",
        main_proposal.proposicao_id::text AS "proposicaoPrincipalId",
        main_proposal.sigla_tipo AS "proposicaoPrincipalSiglaTipo",
        main_proposal.numero AS "proposicaoPrincipalNumero",
        main_proposal.ano AS "proposicaoPrincipalAno",
        main_proposal.ementa AS "proposicaoPrincipalEmenta",
        v.data_hora_votacao AS "dataVotacao",
        vd.voto
      FROM votos_deputados vd
      JOIN votacoes v ON v.id = vd.votacao_id
      LEFT JOIN LATERAL (
        SELECT affected.proposicao_id, affected.sigla_tipo, affected.numero, affected.ano, affected.ementa
        FROM votacao_proposicoes_afetadas affected
        WHERE affected.votacao_id = v.id
        ORDER BY
          CASE WHEN affected.sigla_tipo IN ('PEC', 'PLP', 'PL', 'MPV', 'MP', 'PDL', 'PRC', 'PLV') THEN 0 ELSE 1 END,
          affected.ordem
        LIMIT 1
      ) main_proposal ON true
      WHERE ${where.join(' AND ')}
      ORDER BY COALESCE(v.data_hora_votacao, TIMESTAMPTZ '1970-01-01') DESC, v.id DESC
      LIMIT $${params.length}
      `,
      params,
    );

    const hasMore = result.rows.length > limit;
    const items = hasMore ? result.rows.slice(0, limit) : result.rows;
    const lastItem = items.at(-1);
    const nextCursor = hasMore && lastItem
      ? buildVoteCursor({
          dataVotacao: lastItem.dataVotacao
            ? new Date(lastItem.dataVotacao).toISOString()
            : new Date(0).toISOString(),
          votacaoId: lastItem.votacaoId,
        })
      : null;

    const metadata = await pool.query<{
      anos: number[] | null;
      tiposVotacao: string[] | null;
      votos: string[] | null;
    }>(
      `
      WITH available AS MATERIALIZED (
        SELECT COALESCE(v.ano, EXTRACT(YEAR FROM v.data_hora_votacao)::int) AS ano, v.tipo_votacao, vd.voto
        FROM votos_deputados vd
        JOIN votacoes v ON v.id = vd.votacao_id
        WHERE vd.politico_id = $1::bigint
      )
      SELECT
        array_agg(DISTINCT ano ORDER BY ano DESC) FILTER (WHERE ano IS NOT NULL) AS anos,
        array_agg(DISTINCT tipo_votacao ORDER BY tipo_votacao) FILTER (WHERE tipo_votacao IS NOT NULL) AS "tiposVotacao",
        array_agg(DISTINCT voto ORDER BY voto) FILTER (WHERE voto IS NOT NULL) AS votos
      FROM available
      `,
      [politicoId],
    );

    sendJson(res, 200, {
      items,
      nextCursor,
      meta: {
        anos: metadata.rows[0]?.anos ?? [],
        tiposVotacao: metadata.rows[0]?.tiposVotacao ?? [],
        votos: metadata.rows[0]?.votos ?? [],
      },
    });
  } catch {
    sendJson(res, 500, {error: 'Erro ao processar requisição'});
  }
});

app.get('/api/votacoes/:votacaoId', async (req, res) => {
  try {
    const {votacaoId} = req.params;
    const result = await pool.query(
      `
      SELECT
        v.id::text AS "votacaoId",
        v.ementa AS "textoOficial",
        v.resultado,
        v.aprovacao,
        v.proposicao_objeto AS "proposicaoObjeto",
        v.uri_proposicao_objeto AS "uriProposicaoObjeto",
        v.tipo_votacao AS "tipoVotacao",
        v.eh_subvotacao AS "ehSubvotacao",
        v.titulo_publico AS "tituloPublico",
        v.resumo_leigo AS "resumoLeigo",
        v.classificacao_fonte AS "classificacaoFonte",
        v.classificacao_confianca AS "classificacaoConfianca",
        v.classificacao_versao AS "classificacaoVersao",
        v.classificacao_justificativa AS "classificacaoJustificativa",
        v.data_hora_votacao AS "dataVotacao",
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', possible.proposicao_id::text,
            'uri', possible.uri,
            'siglaTipo', possible.sigla_tipo,
            'numero', possible.numero,
            'ano', possible.ano,
            'ementa', possible.ementa
          ) ORDER BY possible.ordem)
          FROM votacao_objetos_possiveis possible
          WHERE possible.votacao_id = v.id
        ), '[]'::jsonb) AS "objetosPossiveis",
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', affected.proposicao_id::text,
            'uri', affected.uri,
            'siglaTipo', affected.sigla_tipo,
            'numero', affected.numero,
            'ano', affected.ano,
            'ementa', affected.ementa,
            'efeito', affected.efeito
          ) ORDER BY affected.ordem)
          FROM votacao_proposicoes_afetadas affected
          WHERE affected.votacao_id = v.id
        ), '[]'::jsonb) AS "proposicoesAfetadas"
      FROM votacoes v
      WHERE v.id = $1
      LIMIT 1
      `,
      [votacaoId],
    );

    const votacao = result.rows[0];
    if (!votacao) {
      sendJson(res, 404, {error: 'Votação não encontrada.'});
      return;
    }
    sendJson(res, 200, {votacao});
  } catch {
    sendJson(res, 500, {error: 'Erro ao carregar detalhes da votação.'});
  }
});

const expenseResponseError=(res:Response,error:unknown)=>{
  if(error instanceof ExpenseFilterError)sendJson(res,400,{error:error.message});
  else {console.error('[expense-analytics]',error);sendJson(res,500,{error:'Erro ao carregar despesas.'});}
};

app.get('/api/despesas/anos',async(_req,res)=>{
  try {const result=await pool.query(expenseYearsQuery);sendJson(res,200,{items:result.rows.map(row=>Number(row.ano))});}
  catch(error){expenseResponseError(res,error);}
});

app.get('/api/politicos/:politicoId/despesas/analise',async(req,res)=>{
  try {
    // Reuse identity validation and the complete common financial parser.
    buildExpenseQuery(req.params.politicoId,req.query);
    const filters=parseExpenseFilters(req.query),query=buildExpenseAnalysisQuery(req.params.politicoId,filters);
    const result=await pool.query(query.text,query.values);
    const {ano,mes,mesInicio,mesFim}=filters;
    sendJson(res,200,{...result.rows[0],periodo:{ano,mes,mesInicio,mesFim}});
  } catch(error){expenseResponseError(res,error);}
});

app.get('/api/politicos/:politicoId/despesas/anos', async (req, res) => {
  try {
    const {politicoId} = req.params;
    const result = await pool.query(
      `
      SELECT DISTINCT d.ano
      FROM despesas d
      WHERE d.politico_id = $1::bigint
        AND d.ano IS NOT NULL
      ORDER BY d.ano DESC
      `,
      [politicoId],
    );
    const anos = result.rows.map((r) => Number(r.ano)).filter((v) => Number.isFinite(v));
    sendJson(res, 200, {items: anos});
  } catch {
    sendJson(res, 500, {error: 'Erro ao processar requisição'});
  }
});

app.get('/api/politicos/:politicoId/despesas', async (req, res) => {
  try {
    const query = buildExpenseQuery(req.params.politicoId, req.query);
    const result = await pool.query(query.text, query.values);
    const data = result.rows[0];
    sendJson(res, 200, {...data, hasMore: query.offset + data.items.length < data.total});
  } catch (error) {
    if (error instanceof ExpenseFilterError) {
      sendJson(res, 400, {error: error.message});
      return;
    }
    console.error('[despesas]', error);
    sendJson(res, 500, {error: 'Erro ao carregar despesas.'});
  }
});

app.get('/api/politicos/:politicoId/despesas/resumo', async (req, res) => {
  try {
    const {politicoId} = req.params;
    buildExpenseQuery(politicoId,req.query);
    const params: Array<string | number> = [politicoId];
    const financial=expenseFinancialRowsCtes(parseExpenseFilters(req.query),params,'d.politico_id=$1::bigint',true);

    const result = await pool.query(
      `
      WITH ${financial} SELECT
        d.ano,
        d.mes,
        SUM(d.valor_liquido)::double precision AS total
      FROM financial_rows d
      GROUP BY d.ano, d.mes
      ORDER BY d.ano ASC, d.mes ASC
      `,
      params,
    );

    sendJson(res, 200, {items: result.rows});
  } catch(error){expenseResponseError(res,error);}
});

app.get('/api/despesas/media', async (req, res) => {
  try {
    const params: Array<string | number> = [];
    const financial=expenseFinancialRowsCtes(parseExpenseFilters(req.query),params,'TRUE',true);

    const result = await pool.query(
      `
      WITH ${financial} SELECT
        sub.ano,
        sub.mes,
        AVG(sub.total_mes)::double precision AS media,
        COUNT(*)::int AS participantes
      FROM (
        SELECT politico_id, ano, mes, SUM(valor_liquido) AS total_mes
        FROM financial_rows d
        GROUP BY politico_id, ano, mes
      ) sub
      GROUP BY sub.ano, sub.mes
      ORDER BY sub.ano ASC, sub.mes ASC
      `,
      params,
    );

    sendJson(res, 200, {items: result.rows});
  } catch(error){expenseResponseError(res,error);}
});

app.use('/api/admin', requireAdminAuthorization);

app.get('/api/admin/metrics', async (_req, res) => {
  try {
    const database = await pool.query(
      `
      SELECT
        (SELECT COUNT(*)::int FROM votacoes) AS votacoes,
        (SELECT COUNT(*)::int FROM votacoes WHERE titulo_publico IS NOT NULL AND classificacao_fonte IS NOT NULL) AS votacoes_classificadas,
        (SELECT COUNT(*)::int FROM votacoes WHERE ai_gerado_em IS NOT NULL) AS votacoes_enriquecidas_ia,
        (SELECT COUNT(*)::int FROM ingestion_checkpoints WHERE status = 'running' AND locked_at < NOW() - INTERVAL '30 minutes') AS checkpoints_estagnados,
        (SELECT COUNT(*)::int FROM votos_deputados_pendentes) AS votos_pendentes,
        (SELECT COUNT(*)::bigint FROM camara_api_raw_items) AS raw_items,
        pg_total_relation_size('camara_api_raw_items')::bigint AS raw_items_bytes
      `,
    );
    const api = [...apiDurationMetrics.entries()].map(([route, metric]) => {
      const sorted = [...metric.durations].sort((left, right) => left - right);
      const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
      return {
        route,
        requests: metric.requests,
        errors: metric.errors,
        p95Ms: Number((sorted[p95Index] ?? 0).toFixed(1)),
      };
    });
    sendJson(res, 200, {api, database: database.rows[0]});
  } catch {
    sendJson(res, 500, {error: 'Erro ao carregar metricas operacionais.'});
  }
});

app.get('/api/admin/ingestion/summary', async (_req, res) => {
  try {

    const checkpointResult = await pool.query(
      `
      SELECT
        dataset,
        status,
        MIN(period_start)::text AS "periodStart",
        MAX(period_end)::text AS "periodEnd",
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'done' AND items_count = 0)::int AS "emptyTotal",
        SUM(items_count)::int AS "itemsCount",
        MAX(updated_at)::text AS "updatedAt"
      FROM ingestion_checkpoints
      WHERE source = 'camara'
        AND status <> 'cancelled'
      GROUP BY dataset, status
      ORDER BY dataset ASC, status ASC
      `,
    );

    const periodResult = await pool.query(
      `
      WITH coverage AS (
        SELECT
          'despesas'::text AS dataset,
          MIN(make_date(ano::int, mes::int, 1))::date AS period_start,
          MAX((make_date(ano::int, mes::int, 1) + INTERVAL '1 month - 1 day')::date) AS period_end,
          COUNT(*)::int AS total
        FROM despesas
        UNION ALL
        SELECT
          'votacoes'::text AS dataset,
          MIN(date_trunc('month', data_hora_votacao)::date) AS period_start,
          MAX((date_trunc('month', data_hora_votacao)::date + INTERVAL '1 month - 1 day')::date) AS period_end,
          COUNT(*)::int AS total
        FROM votacoes
        WHERE data_hora_votacao IS NOT NULL
        UNION ALL
        SELECT
          'proposicoes'::text AS dataset,
          MIN(date_trunc('month', data_apresentacao)::date) AS period_start,
          MAX((date_trunc('month', data_apresentacao)::date + INTERVAL '1 month - 1 day')::date) AS period_end,
          COUNT(*)::int AS total
        FROM camara_proposicoes
        WHERE data_apresentacao IS NOT NULL
        UNION ALL
        SELECT
          'eventos'::text AS dataset,
          MIN(date_trunc('month', data_hora_inicio)::date) AS period_start,
          MAX((date_trunc('month', data_hora_inicio)::date + INTERVAL '1 month - 1 day')::date) AS period_end,
          COUNT(*)::int AS total
        FROM camara_eventos
        WHERE data_hora_inicio IS NOT NULL
        UNION ALL
        SELECT
          'legislaturas'::text AS dataset,
          MIN(date_trunc('month', data_inicio)::date) AS period_start,
          MAX((date_trunc('month', data_fim)::date + INTERVAL '1 month - 1 day')::date) AS period_end,
          COUNT(*)::int AS total
        FROM camara_legislaturas
        WHERE data_inicio IS NOT NULL
        UNION ALL
        SELECT
          'deputados'::text AS dataset,
          MIN(date_trunc('month', data_ultimo_status)::date) AS period_start,
          MAX((date_trunc('month', data_ultimo_status)::date + INTERVAL '1 month - 1 day')::date) AS period_end,
          COUNT(*)::int AS total
        FROM politicos
        WHERE data_ultimo_status IS NOT NULL
        UNION ALL SELECT 'partidos'::text, NULL::date, NULL::date, COUNT(*)::int FROM camara_partidos
        UNION ALL SELECT 'blocos'::text, NULL::date, NULL::date, COUNT(*)::int FROM camara_blocos
        UNION ALL SELECT 'orgaos'::text, NULL::date, NULL::date, COUNT(*)::int FROM camara_orgaos
        UNION ALL SELECT 'frentes'::text, NULL::date, NULL::date, COUNT(*)::int FROM camara_frentes
        UNION ALL SELECT 'referencias'::text, NULL::date, NULL::date, COUNT(*)::int FROM camara_referencias
      )
      SELECT dataset, period_start::text AS "periodStart", period_end::text AS "periodEnd", total
      FROM coverage
      WHERE total > 0
      ORDER BY dataset ASC, "periodStart" DESC NULLS LAST
      `,
    );

    sendJson(res, 200, {
      checkpoints: checkpointResult.rows,
      periods: periodResult.rows,
    });
  } catch {
    sendJson(res, 500, {error: 'Erro ao carregar resumo de ingestao.'});
  }
});

app.get('/api/admin/ingestion/logs', async (_req, res) => {
  try {
    const activeIngestionKeys = await loadActiveIngestionKeys();
    const logsDir = join(process.cwd(), 'logs');
    const names = await readdir(logsDir).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [] as string[];
      throw error;
    });
    const files = (await Promise.all(names
      .filter((file) => file.startsWith('ingest-') && file.endsWith('.log'))
      .map(async (file) => {
        const path = join(logsDir, file);
        const info = await stat(path).catch(() => null);
        return info ? {file, path, mtimeMs: info.mtimeMs} : null;
      }))).filter((file) => file !== null)
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    const latest = files[0];
    if (!latest) {
      const activityPath = join(logsDir, 'activity-events.log');
      const activityTail = await readLogTail(activityPath);
      const activityContent = activityTail.content;
      const activityEvents = parseStructuredLogEvents(activityContent, 'ai').sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );
      sendJson(res, 200, {
        log: '',
        file: null,
        truncated: activityTail.truncated,
        statsScope: 'recent',
        events: activityEvents.slice(0, 80),
        currentStatus: buildCurrentStatus(activityEvents, activeIngestionKeys),
        timeline: buildRecentTimeline(activityEvents),
      });
      return;
    }

    const [logTail, activityTail] = await Promise.all([
      readLogTail(latest.path),
      readLogTail(join(logsDir, 'activity-events.log')),
    ]);
    const content = logTail.content;
    const activityContent = activityTail.content;
    const stats = parseIngestionLogStats(content);
    await enrichLogStatsWithDatabaseProgress(stats);
    const events = [
      ...parseStructuredLogEvents(content, 'ingestion'),
      ...parseStructuredLogEvents(activityContent, 'ai'),
    ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    sendJson(res, 200, {
      file: latest.file,
      log: content.slice(-12000),
      truncated: logTail.truncated || activityTail.truncated,
      statsScope: 'recent',
      stats,
      events: events.slice(0, 80),
      currentStatus: buildCurrentStatus(events, activeIngestionKeys),
      timeline: buildRecentTimeline(events),
    });
  } catch {
    sendJson(res, 500, {error: 'Erro ao carregar logs de ingestao.'});
  }
});

app.get('/api/admin/settings/ai', async (_req, res) => {
  try {
    const settings = await getAiSettings();
    sendJson(res, 200, {
      enabled: settings.enabled,
      groqModel: settings.groqModel,
      hasGroqApiKey: settings.groqApiKey.length > 0,
      secretSource: 'environment',
    });
  } catch {
    sendJson(res, 500, {error: 'Erro ao carregar configuracoes de IA.'});
  }
});

app.post('/api/admin/settings/ai', async (req, res) => {
  try {
    const enabled = req.body?.enabled !== false;
    const model = normalizeText(req.body?.groqModel) || 'llama-3.3-70b-versatile';
    const modelValidationError = getGroqModelValidationError(model);
    if (modelValidationError) {
      sendJson(res, 400, {error: modelValidationError});
      return;
    }
    await setAppSetting('groq_enabled', enabled ? 'true' : 'false');
    await setAppSetting('groq_model', model);

    cachedAiSettings = null;
    const settings = await getAiSettings();
    sendJson(res, 200, {
      message: 'Configuracoes de IA salvas.',
      enabled: settings.enabled,
      groqModel: settings.groqModel,
      hasGroqApiKey: settings.groqApiKey.length > 0,
      secretSource: 'environment',
    });
  } catch {
    sendJson(res, 500, {error: 'Erro ao salvar configuracoes de IA.'});
  }
});

app.post('/api/admin/ingestion/run', async (req, res) => {
  if (isStartingIngestion) {
    sendJson(res, 409, {error: 'Uma ingestão está sendo inicializada ou executada.'});
    return;
  }
  isStartingIngestion = true;
  let startupLock: Awaited<ReturnType<typeof acquireIngestionLock>> = null;
  let spawned = false;
  try {
    startupLock = await acquireIngestionLock(pool);
    if (!startupLock) {
      sendJson(res, 409, {error: 'Existe importação, enriquecimento ou limpeza em andamento.'});
      return;
    }
    await releaseStaleIngestionCheckpoints();

    const from = parseIsoDateInput(req.body?.from, '2016-01-01');
    const to = parseIsoDateInput(req.body?.to, '2020-12-31');
    const datasets = parseDatasetList(req.body?.datasets);
    const window = 'month';
    const concurrency = 2;

    if (datasets.length === 0) {
      sendJson(res, 400, {error: 'Selecione pelo menos um conjunto de dados.'});
      return;
    }

    const activeResult = await pool.query(
      `
      SELECT COUNT(*)::int AS total
      FROM ingestion_checkpoints
      WHERE source = 'camara'
        AND status = 'running'
      `,
    );
    const activeTotal = Number(activeResult.rows[0]?.total ?? 0);

    if (activeTotal > 0) {
      sendJson(res, 409, {
        error: 'Ja existe uma ingestao em andamento. Cancele ou aguarde terminar antes de iniciar outra.',
        activeTotal,
      });
      return;
    }


    const logsDir = join(process.cwd(), 'logs');
    mkdirSync(logsDir, {recursive: true});
    const logPath = join(logsDir, `ingest-${Date.now()}.log`);
    const logStream = createWriteStream(logPath, {flags: 'a'});

    await startupLock.release();
    startupLock = null;
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        'src/ingest-agent.ts',
        `--from=${from}`,
        `--to=${to}`,
        `--datasets=${datasets.join(',')}`,
        `--window=${window}`,
        `--concurrency=${concurrency}`,
        '--stale-minutes=30',
        '--reset-failed',
        '--reset-cancelled',
        ...(req.body?.reprocessEmpty === true ? ['--reset-empty'] : []),
      ],
      {
        cwd: process.cwd(),
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );

    child.stdout?.pipe(logStream);
    child.stderr?.pipe(logStream);
    child.on('exit', (code, signal) => {
      logStream.write(`\n[exit] code=${code ?? ''} signal=${signal ?? ''}\n`);
      logStream.end();
      isStartingIngestion = false;
    });
    child.on('error', (error) => {
      logStream.write(`\n[spawn-error] ${error.message}\n`);
      logStream.end();
      isStartingIngestion = false;
    });
    spawned = true;
    child.unref();

    sendJson(res, 202, {
      message: 'Ingestao iniciada em segundo plano.',
      pid: child.pid,
      from,
      to,
      datasets,
      window,
      concurrency,
      logPath,
    });
  } catch {
    sendJson(res, 500, {error: 'Erro ao iniciar ingestao.'});
  } finally {
    await startupLock?.release();
    if (!spawned) isStartingIngestion = false;
  }
});

app.post('/api/admin/ingestion/cancel', async (req, res) => {
  try {

    const dataset = parseDatasetList(req.body?.dataset)[0] ?? null;
    const status = parseCheckpointStatus(req.body?.status);

    if (!dataset || !status) {
      sendJson(res, 400, {error: 'Informe dataset e status validos para cancelar.'});
      return;
    }

    const result = await pool.query(
      `
      UPDATE ingestion_checkpoints
      SET status = 'cancelled',
          locked_at = NULL,
          last_error = COALESCE(last_error, 'Cancelado pelo administrador.'),
          updated_at = CURRENT_TIMESTAMP
      WHERE source = 'camara'
        AND dataset = $1
        AND status = $2
      RETURNING id
      `,
      [dataset, status],
    );

    sendJson(res, 200, {
      message: 'Tarefas canceladas.',
      cancelled: result.rowCount,
      dataset,
      status,
    });
  } catch {
    sendJson(res, 500, {error: 'Erro ao cancelar tarefas.'});
  }
});

app.post('/api/admin/database/clear', async (req, res) => {
  let lock: Awaited<ReturnType<typeof acquireIngestionLock>> = null;
  let client: Awaited<ReturnType<typeof pool.connect>> | undefined;
  try {
    if (isStartingIngestion) {
      sendJson(res, 409, {error: 'Aguarde a parada da ingestão antes de limpar dados.'});
      return;
    }
    lock = await acquireIngestionLock(pool);
    if (!lock) {
      sendJson(res, 409, {error: 'Existe importação ou enriquecimento ativo. Aguarde sua parada antes de limpar dados.'});
      return;
    }
    client = await pool.connect();

    const dataset = parseCleanupDataset(req.body?.dataset);
    if (!dataset) {
      sendJson(res, 400, {error: 'Informe uma categoria valida para limpar.'});
      return;
    }

    const activeResult = await pool.query(
      `
      SELECT COUNT(*)::int AS total
      FROM ingestion_checkpoints
      WHERE source = 'camara'
        AND status = 'running'
      `,
    );
    const activeTotal = Number(activeResult.rows[0]?.total ?? 0);
    if (activeTotal > 0) {
      sendJson(res, 409, {
        error: 'Existe ingestao em andamento. Cancele ou aguarde terminar antes de limpar dados.',
        activeTotal,
      });
      return;
    }

    const targets = dataset === 'todos' ? cleanupOrder : [dataset];
    const cleaned: Array<{dataset: string; deletedRows: number}> = [];

    await client.query('BEGIN');
    for (const target of targets) {
      const definition = cleanupDefinitions[target];
      if (!definition) continue;

      let deletedRows = 0;
      for (const table of definition.tables) {
        const result = await client.query(`DELETE FROM ${table}`);
        deletedRows += result.rowCount ?? 0;
      }

      if (definition.rawResources.length > 0) {
        const result = await client.query(
          `
          DELETE FROM camara_api_raw_items
          WHERE resource = ANY($1::text[])
             OR parent_resource = ANY($1::text[])
          `,
          [definition.rawResources],
        );
        deletedRows += result.rowCount ?? 0;
      }

      if (definition.checkpointDatasets.length > 0) {
        const result = await client.query(
          `
          DELETE FROM ingestion_checkpoints
          WHERE source = 'camara'
            AND dataset = ANY($1::text[])
          `,
          [definition.checkpointDatasets],
        );
        deletedRows += result.rowCount ?? 0;
      }

      cleaned.push({dataset: target, deletedRows});
    }

    await client.query('COMMIT');
    sendJson(res, 200, {
      message: 'Dados removidos.',
      dataset,
      cleaned,
      deletedRows: cleaned.reduce((sum, item) => sum + item.deletedRows, 0),
    });
  } catch (error) {
    await client?.query('ROLLBACK').catch(() => undefined);
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : 'Erro ao limpar dados.',
    });
  } finally {
    client?.release();
    await lock?.release();
  }
});

attachJudicialRoutes(app,pool,requireAdminAuthorization,catalogEvents);

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    sendJson(res, 404, {error: 'Endpoint não encontrado'});
    return;
  }
  sendJson(res, 404, {error: 'Não encontrado'});
});

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? '0.0.0.0';

if (process.env.NODE_ENV !== 'test') {
  startCatalogListener(pool, catalogEvents);
  app.listen(port, host, () => {
    process.stdout.write(`API escutando em http://${host}:${port}\n`);
  });
}

export {app, pool, catalogEvents};
