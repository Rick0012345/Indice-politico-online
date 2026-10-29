import 'dotenv/config';
import {upsertExpenseBatch} from './lib/expensePersistence';
import {seedCheckpointBatch, type CheckpointSeed} from './lib/ingestionSeeds';
import {upsertRawBatch, type RawItemUpsert} from './lib/rawPersistence';
import {iteratePages, readPageProgress, commitCheckpointPage} from './lib/ingestionPages';
import {votePresentationAssignments} from './lib/votePresentationPersistence';
import {setTimeout as sleep} from 'node:timers/promises';
import {Pool, type PoolClient, type QueryResult, type QueryResultRow} from 'pg';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createCancellationGuard, IngestionCancelledError, runIngestion} from './lib/ingestionLifecycle';
import {classifyVote, type VoteProposalCandidate} from './lib/voteClassification';

type Dataset =
  | 'deputados'
  | 'despesas'
  | 'votacoes'
  | 'legislaturas'
  | 'partidos'
  | 'blocos'
  | 'orgaos'
  | 'eventos'
  | 'frentes'
  | 'proposicoes'
  | 'referencias';
type CheckpointStatus = 'pending' | 'running' | 'done' | 'failed';

type CliOptions = {
  from: string;
  to: string;
  datasets: Dataset[];
  window: 'month' | 'quarter' | 'year';
  concurrency: number;
  minDelayMs: number;
  maxAttempts: number;
  staleMinutes: number;
  resetFailed: boolean;
  resetCancelled: boolean;
  resetEmpty: boolean;
  dryRun: boolean;
};

type CamaraListResponse<T> = {
  dados?: T[];
  links?: Array<{rel?: string; href?: string}>;
};

type CamaraDetailResponse<T> = {
  dados?: T;
};

type DeputySummary = {
  id: number;
};

type DeputyDetails = {
  id: number;
  uri?: string;
  nomeCivil?: string;
  cpf?: string;
  dataNascimento?: string;
  dataFalecimento?: string | null;
  sexo?: string;
  escolaridade?: string;
  municipioNascimento?: string;
  ufNascimento?: string;
  ultimoStatus?: {
    nome?: string;
    nomeEleitoral?: string;
    siglaPartido?: string;
    uriPartido?: string | null;
    siglaUf?: string;
    idLegislatura?: number;
    situacao?: string;
    condicaoEleitoral?: string;
    descricaoStatus?: string | null;
    urlFoto?: string;
    email?: string;
    data?: string;
    gabinete?: {
      nome?: string;
      predio?: string;
      sala?: string;
      andar?: string;
      telefone?: string;
      email?: string;
    };
  };
  urlWebsite?: string;
  redeSocial?: string[];
};

type Expense = {
  ano?: number;
  mes?: number;
  tipoDespesa?: string;
  codDocumento?: number | string;
  cnpjCpfFornecedor?: string;
  nomeFornecedor?: string;
  tipoDocumento?: string;
  codTipoDocumento?: number;
  dataDocumento?: string;
  numDocumento?: string;
  valorDocumento?: number;
  valorGlosa?: number;
  valorLiquido?: number;
  numLote?: number | string;
  codLote?: number | string;
  numRessarcimento?: number | string;
  parcela?: number;
  urlDocumento?: string;
};

type VoteSession = {
  id: string;
  uri?: string;
  siglaTipo?: string;
  numero?: number | string;
  ano?: number | string;
  descricao?: string;
  data?: string;
  dataHoraRegistro?: string;
  siglaOrgao?: string;
  uriOrgao?: string;
  idOrgao?: number | string;
  uriEvento?: string;
  idEvento?: number | string;
  proposicaoObjeto?: string | null;
  uriProposicaoObjeto?: string | null;
  descUltimaAberturaVotacao?: string;
  dataHoraUltimaAberturaVotacao?: string;
  ultimaApresentacaoProposicao?: unknown;
  efeitosRegistrados?: unknown;
  objetosPossiveis?: VoteProposalCandidate[];
  proposicoesAfetadas?: VoteProposalCandidate[];
  aprovacao?: number | string;
  resultado?: string;
};

type DeputyVote = {
  tipoVoto?: string;
  dataHoraVoto?: string;
  dataRegistroVoto?: string;
  deputado_?: {
    id?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type RawItem = Record<string, unknown>;

type LogLevel = 'log' | 'warn' | 'error';
type FetchPagedOptions = {
  ignoreBadRequest?: boolean;
  logBadRequest?: boolean;
  onBadRequest?: (url: string) => void;
};
type ProposalChildResource = 'autores' | 'temas' | 'tramitacoes' | 'relacionadas';

const databaseUrl = process.env.DATABASE_URL?.trim();
const pool = databaseUrl
  ? new Pool({connectionString: databaseUrl})
  : new Pool({
      host: process.env.APP_DB_HOST ?? 'db',
      port: Number(process.env.APP_DB_PORT ?? 5432),
      user: process.env.APP_DB_USER ?? 'app',
      password: process.env.APP_DB_PASSWORD ?? 'app',
      database: process.env.APP_DB_NAME ?? 'app',
    });

const checkpointContext = new AsyncLocalStorage<(client?: PoolClient) => Promise<void>>();
let cancellationObserved = false;
const checkCancellation = async (client?: PoolClient) => {
  if (cancellationObserved) throw new IngestionCancelledError();
  await checkpointContext.getStore()?.(client);
};
const guardedQuery = async <T extends QueryResultRow = any>(sql: string, values?: any[]): Promise<QueryResult<T>> => {
  await checkCancellation();
  return pool.query<T>(sql, values);
};
const guardedClientQuery = async <T extends QueryResultRow = any>(client: PoolClient, sql: string, values?: any[]): Promise<QueryResult<T>> => {
  if (sql !== 'ROLLBACK') await checkCancellation(client);
  return client.query<T>(sql, values);
};

const API_BASE = 'https://dadosabertos.camara.leg.br/api/v2';
const HTTP_TIMEOUT_MS = 45000;
const MAX_HTTP_ATTEMPTS = 3;
const MAX_PAGES_PER_REQUEST = 200;
const HTTP_REQUEST_MIN_INTERVAL_MS = 1000;
const OPTIONAL_CHILD_BREAKER_MIN_ATTEMPTS = 24;
const OPTIONAL_CHILD_BREAKER_BAD_RATIO = 0.85;

const optionalChildStats = new Map<
  string,
  {attempts: number; badRequests: number; skipped: number}
>();
let nextHttpRequestAt = 0;
let httpRequestQueue = Promise.resolve();

class HttpError extends Error {
  constructor(
    public status: number,
    public url: string,
    public retryable: boolean,
  ) {
    super(`HTTP ${status} em ${url}`);
  }
}

const writeLog = (level: LogLevel, message: string) => {
  console[level](`[${new Date().toISOString()}] ${message}`);
};

const writeEvent = (
  stage:
    | 'api_fetch'
    | 'api_retry'
    | 'db_write'
    | 'checkpoint_start'
    | 'checkpoint_done'
    | 'checkpoint_failed',
  label: string,
  details: Record<string, unknown> = {},
) => {
  writeLog('log', `[event] ${JSON.stringify({stage, label, timestamp: new Date().toISOString(), ...details})}`);
};

const waitForHttpSlot = async () => {
  const wait = httpRequestQueue.then(async () => {
    const delay = Math.max(0, nextHttpRequestAt - Date.now());
    if (delay > 0) await sleep(delay);
    nextHttpRequestAt = Date.now() + HTTP_REQUEST_MIN_INTERVAL_MS;
  });
  httpRequestQueue = wait.catch(() => undefined);
  await wait;
};

const applyHttpCooldown = (delay: number) => {
  nextHttpRequestAt = Math.max(nextHttpRequestAt, Date.now() + delay);
};

const optionalChildKey = (proposal: RawItem, resource: ProposalChildResource) => {
  const siglaTipo = textOrNull(proposal.siglaTipo) ?? 'sem-tipo';
  return `${siglaTipo}/${resource}`;
};

const shouldSkipOptionalChild = (key: string) => {
  const stats = optionalChildStats.get(key);
  if (!stats || stats.attempts < OPTIONAL_CHILD_BREAKER_MIN_ATTEMPTS) return false;
  return stats.badRequests / stats.attempts >= OPTIONAL_CHILD_BREAKER_BAD_RATIO;
};

const recordOptionalChildResult = (key: string, badRequest: boolean, skipped = false) => {
  const stats = optionalChildStats.get(key) ?? {attempts: 0, badRequests: 0, skipped: 0};
  if (skipped) {
    stats.skipped += 1;
  } else {
    stats.attempts += 1;
    if (badRequest) stats.badRequests += 1;
  }

  const shouldLog =
    (badRequest && stats.badRequests % 25 === 0) ||
    (skipped && stats.skipped % 100 === 1);

  if (shouldLog) {
    const ratio = stats.attempts > 0 ? Math.round((stats.badRequests / stats.attempts) * 100) : 0;
    writeLog(
      'warn',
      `[optional-child] ${key}: ${stats.badRequests}/${stats.attempts} HTTP 400 (${ratio}%), ${stats.skipped} pulados por heuristica`,
    );
  }

  optionalChildStats.set(key, stats);
};

const parseArgs = (): CliOptions => {
  const args = process.argv.slice(2);
  const get = (name: string, fallback?: string) => {
    const prefix = `--${name}=`;
    const inline = args.find((arg) => arg.startsWith(prefix));
    if (inline) return inline.slice(prefix.length);
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : fallback;
  };

  const allDatasets: Dataset[] = [
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
  ];

  const requestedDatasets = (get('datasets', 'deputados,despesas,votacoes') ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const datasets = requestedDatasets.includes('todos')
    ? allDatasets
    : requestedDatasets.filter((item): item is Dataset => allDatasets.includes(item as Dataset));

  return {
    from: get('from', '2016-01-01') ?? '2016-01-01',
    to: get('to', '2020-12-31') ?? '2020-12-31',
    datasets,
    window: (get('window', 'month') ?? 'month') as CliOptions['window'],
    concurrency: Math.max(1, Math.min(2, Number(get('concurrency', '2')) || 2)),
    minDelayMs: Math.max(0, Number(get('min-delay-ms', '750')) || 750),
    maxAttempts: Math.max(1, Number(get('max-attempts', '5')) || 5),
    staleMinutes: Math.max(5, Number(get('stale-minutes', '30')) || 30),
    resetFailed: args.includes('--reset-failed'),
    resetCancelled: args.includes('--reset-cancelled'),
    resetEmpty: args.includes('--reset-empty'),
    dryRun: args.includes('--dry-run'),
  };
};

const toDateOnly = (date: Date) => date.toISOString().slice(0, 10);

const addMonths = (date: Date, months: number) => {
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  return next;
};

const endOfPreviousDay = (date: Date) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() - 1);
  return next;
};

const buildWindows = (from: string, to: string, mode: CliOptions['window']) => {
  const step = mode === 'year' ? 12 : mode === 'quarter' ? 3 : 1;
  const end = new Date(`${to}T00:00:00.000Z`);
  const windows: Array<{start: string; end: string}> = [];
  let cursor = new Date(`${from}T00:00:00.000Z`);

  while (cursor <= end) {
    const nextStart = addMonths(cursor, step);
    const windowEnd = endOfPreviousDay(nextStart);
    windows.push({
      start: toDateOnly(cursor),
      end: toDateOnly(windowEnd > end ? end : windowEnd),
    });
    cursor = nextStart;
  }

  return windows;
};

const yearsForRange = (from: string, to: string) => {
  const startYear = new Date(`${from}T00:00:00.000Z`).getUTCFullYear();
  const endYear = new Date(`${to}T00:00:00.000Z`).getUTCFullYear();
  return Array.from({length: endYear - startYear + 1}, (_, index) => startYear + index);
};

const legislaturesForYears = (years: number[]) => {
  const ids = new Set<number>();
  for (const year of years) {
    if (year >= 2015 && year <= 2018) ids.add(55);
    if (year >= 2019 && year <= 2022) ids.add(56);
    if (year >= 2023 && year <= 2026) ids.add(57);
  }
  return [...ids];
};

const numberOrNull = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const textOrNull = (value: unknown) => {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
};

const jsonOrNull = (value: unknown) => (value == null ? null : JSON.stringify(value));

const upsertRawItems = async (items: RawItemUpsert[], client?: PoolClient) => {
  if (!items.length) return;
  await checkCancellation(client);
  await upsertRawBatch(client ?? pool, items);
};

const upsertRawItem = async (
  resource: string,
  resourceId: string,
  endpoint: string,
  rawJson: unknown,
  options: {
    parentResource?: string | null;
    parentId?: string | null;
    queryParams?: Record<string, unknown>;
    linksJson?: unknown;
  } = {},
) => {
  await upsertRawItems([{resource, resourceId, endpoint, rawJson, ...options}]);
};

const mapConcurrent = async <T>(
  items: T[],
  concurrency: number,
  handler: (item: T) => Promise<void>,
) => {
  let index = 0;
  const workers = Array.from({length: Math.min(concurrency, items.length)}, async () => {
    for (;;) {
      const currentIndex = index;
      index += 1;
      if (currentIndex >= items.length) return;
      await handler(items[currentIndex]);
    }
  });
  const results = await Promise.allSettled(workers);
  const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (rejected) throw rejected.reason;
};

const jitter = (base: number) => Math.round(base * (0.8 + Math.random() * 0.4));

const retryDelayForStatus = (status: number, retryAfterHeader: string | null, attempt: number) => {
  const retryAfter = retryAfterHeader != null ? Number(retryAfterHeader) : Number.NaN;
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(120000, retryAfter * 1000);
  }

  const baseByStatus =
    status === 429 ? 10000 : status === 403 ? 8000 : status === 504 ? 5000 : 2000;
  return jitter(Math.min(120000, baseByStatus * 2 ** (attempt - 1)));
};

const retryWaitLabel = (delay: number, reason: string) => {
  const seconds = Math.max(1, Math.ceil(delay / 1000));
  return `Aguardando ${seconds} segundos para retomar apos ${reason}`;
};

export const fetchJson = async <T>(url: string, attempt = 1): Promise<T> => {
  await waitForHttpSlot();
  await checkCancellation();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'catalogo-politico-ingest-agent/1.0',
      },
    });

    await checkCancellation();
    const retryable = [403, 408, 429, 500, 502, 503, 504].includes(response.status);
    if (retryable && attempt < MAX_HTTP_ATTEMPTS) {
      const delay = retryDelayForStatus(response.status, response.headers.get('retry-after'), attempt);
      if (response.status === 429) {
        applyHttpCooldown(delay);
      }
      writeLog(
        'warn',
        `[http-retry] tentativa=${attempt}/${MAX_HTTP_ATTEMPTS} status=${response.status} aguardando=${Math.ceil(delay / 1000)}s url=${url}`,
      );
      writeEvent('api_retry', retryWaitLabel(delay, `erro HTTP ${response.status}`), {
        url,
        status: response.status,
        attempt,
        delay,
      });
      await sleep(delay);
      return fetchJson<T>(url, attempt + 1);
    }

    if (!response.ok) {
      throw new HttpError(response.status, url, retryable);
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof IngestionCancelledError || error instanceof HttpError) throw error;

    const isAbort = error instanceof Error && error.name === 'AbortError';
    if (attempt < MAX_HTTP_ATTEMPTS) {
      const delay = jitter(Math.min(30000, 1000 * 2 ** attempt));
      writeLog(
        'warn',
        `[http-retry] tentativa=${attempt}/${MAX_HTTP_ATTEMPTS} erro=${isAbort ? 'timeout' : error instanceof Error ? error.message : String(error)} aguardando=${Math.ceil(delay / 1000)}s url=${url}`,
      );
      writeEvent('api_retry', retryWaitLabel(delay, isAbort ? 'timeout' : 'erro de rede'), {
        url,
        attempt,
        delay,
        error: isAbort ? 'timeout' : error instanceof Error ? error.message : String(error),
      });
      await sleep(delay);
      return fetchJson<T>(url, attempt + 1);
    }

    throw new Error(`${isAbort ? 'Timeout' : 'Erro de rede'} em ${url}`);
  } finally {
    clearTimeout(timeout);
  }
};

const fetchPagedPages = <T>(
  path: string, params: Record<string, string | number>, options: FetchPagedOptions = {}, startPage = 1,
) => iteratePages<T>(async page => {
  const url = new URL(API_BASE + path);
  for (const [key, value] of Object.entries({...params, itens: 100, pagina: page})) url.searchParams.set(key, String(value));
  try {
    writeEvent('api_fetch', 'Carregando dados da API da Camara', {path, url: url.toString(), page});
    const data = await fetchJson<CamaraListResponse<T>>(url.toString());
    await checkCancellation();
    return data;
  } catch (error) {
    if (options.ignoreBadRequest && error instanceof HttpError && error.status === 400) {
      options.onBadRequest?.(url.toString());
      if (options.logBadRequest !== false) writeLog('warn', '[skip] API retornou 400 para recurso opcional: ' + url.toString());
      return {dados: []};
    }
    throw error;
  }
}, {startPage, maxPages: MAX_PAGES_PER_REQUEST});

const fetchPaged = async <T>(path: string, params: Record<string, string | number>, options: FetchPagedOptions = {}) => {
  const items: T[] = [];
  for await (const page of fetchPagedPages<T>(path, params, options)) items.push(...page.items);
  return items;
};

const fetchList = async <T>(
  path: string,
  params: Record<string, string | number> = {},
  options: FetchPagedOptions = {},
) => {
  const url = new URL(`${API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  try {
    writeEvent('api_fetch', 'Carregando dados da API da Camara', {
      path,
      url: url.toString(),
    });
    const data = await fetchJson<CamaraListResponse<T>>(url.toString());
    return data.dados ?? [];
  } catch (error) {
    if (options.ignoreBadRequest && error instanceof HttpError && [400, 404, 405].includes(error.status)) {
      options.onBadRequest?.(url.toString());
      if (options.logBadRequest !== false) {
        writeLog('warn', `[skip] API retornou ${error.status} para recurso opcional: ${url.toString()}`);
      }
      return [];
    }
    throw error;
  }
};

const fetchDetail = async <T>(path: string, options: FetchPagedOptions = {}) => {
  const url = new URL(`${API_BASE}${path}`);
  try {
    writeEvent('api_fetch', 'Carregando detalhe da API da Camara', {
      path,
      url: url.toString(),
    });
    const data = await fetchJson<CamaraDetailResponse<T>>(url.toString());
    return data.dados ?? null;
  } catch (error) {
    if (options.ignoreBadRequest && error instanceof HttpError && [400, 404, 405].includes(error.status)) {
      options.onBadRequest?.(url.toString());
      if (options.logBadRequest !== false) {
        writeLog('warn', `[skip] API retornou ${error.status} para detalhe opcional: ${url.toString()}`);
      }
      return null;
    }
    throw error;
  }
};

const seedCheckpoint = async (
  dataset: Dataset, entityId: string, start: string, end: string,
  resetFailed: boolean, resetCancelled: boolean, resetEmpty: boolean,
) => {
  await checkCancellation();
  await seedCheckpointBatch(pool, [{dataset, entityId, start, end}], {resetFailed, resetCancelled, resetEmpty});
};

const claimCheckpoint = async (dataset: Dataset, maxAttempts: number, from: string, to: string) => {
  const result = await guardedQuery<{
    id: string;
    entity_id: string;
    period_start: string;
    period_end: string;
    progress_json: unknown;
  }>(
    `
    UPDATE ingestion_checkpoints
    SET status = 'running',
        attempts = attempts + 1,
        locked_at = CURRENT_TIMESTAMP,
        started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
        last_error = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = (
      SELECT id
      FROM ingestion_checkpoints
      WHERE source = 'camara'
        AND dataset = $1
        AND status IN ('pending', 'failed')
        AND attempts < $2
        AND period_start >= $3::date
        AND period_end <= $4::date
      ORDER BY period_start ASC, entity_id ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, entity_id, period_start::text, period_end::text, progress_json
    `,
    [dataset, maxAttempts, from, to],
  );

  return result.rows[0] ?? null;
};

const releaseStaleCheckpoints = async (staleMinutes: number) => {
  const result = await guardedQuery(
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
    [String(staleMinutes)],
  );

  if ((result.rowCount ?? 0) > 0) {
    writeLog('warn', `[stale] ${result.rowCount} checkpoint(s) running liberado(s)`);
  }
};

const finishCheckpoint = async (
  id: string,
  status: CheckpointStatus,
  itemsCount: number,
  error: string | null,
) => {
  const result = await guardedQuery(
    `
    UPDATE ingestion_checkpoints
    SET status = $2::varchar,
        items_count = CASE WHEN $2::text = 'failed' THEN items_count ELSE $3 END,
        last_error = $4,
        locked_at = NULL,
        finished_at = CASE WHEN $2::text = 'done' THEN CURRENT_TIMESTAMP ELSE finished_at END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
      AND status <> 'cancelled'
    `,
    [id, status, itemsCount, error],
  );
  return (result.rowCount ?? 0) > 0;
};

const touchCheckpointProgress = async (id: string, itemsCount: number) => {
  await guardedQuery(
    `
    UPDATE ingestion_checkpoints
    SET items_count = $2,
        locked_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
      AND status = 'running'
    `,
    [id, itemsCount],
  );
};

const upsertDeputy = async (client: PoolClient, deputy: DeputyDetails) => {
  const status = deputy.ultimoStatus ?? {};
  const gabinete = status.gabinete ?? {};
  await guardedClientQuery(client,
    `
    INSERT INTO politicos (
      id, cpf, nome, nome_civil, sigla_partido, sigla_uf, id_legislatura,
      data_nascimento, data_ultimo_status, sexo, url_foto, nome_eleitoral,
      condicao_eleitoral, email, telefone, url_website, redes_sociais,
      escolaridade, municipio_nascimento, uf_nascimento, gabinete_nome,
      gabinete_predio, gabinete_sala, gabinete_andar, situacao, ativo, atualizado_em
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
      $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, CURRENT_TIMESTAMP
    )
    ON CONFLICT (id) DO UPDATE SET
      cpf = EXCLUDED.cpf,
      nome = EXCLUDED.nome,
      nome_civil = EXCLUDED.nome_civil,
      sigla_partido = EXCLUDED.sigla_partido,
      sigla_uf = EXCLUDED.sigla_uf,
      id_legislatura = EXCLUDED.id_legislatura,
      data_nascimento = EXCLUDED.data_nascimento,
      data_ultimo_status = EXCLUDED.data_ultimo_status,
      sexo = EXCLUDED.sexo,
      url_foto = EXCLUDED.url_foto,
      nome_eleitoral = EXCLUDED.nome_eleitoral,
      condicao_eleitoral = EXCLUDED.condicao_eleitoral,
      email = EXCLUDED.email,
      telefone = EXCLUDED.telefone,
      url_website = EXCLUDED.url_website,
      redes_sociais = EXCLUDED.redes_sociais,
      escolaridade = EXCLUDED.escolaridade,
      municipio_nascimento = EXCLUDED.municipio_nascimento,
      uf_nascimento = EXCLUDED.uf_nascimento,
      gabinete_nome = EXCLUDED.gabinete_nome,
      gabinete_predio = EXCLUDED.gabinete_predio,
      gabinete_sala = EXCLUDED.gabinete_sala,
      gabinete_andar = EXCLUDED.gabinete_andar,
      situacao = EXCLUDED.situacao,
      ativo = EXCLUDED.ativo,
      atualizado_em = CURRENT_TIMESTAMP
    `,
    [
      deputy.id,
      textOrNull(deputy.cpf)?.replace(/\D/g, '').slice(0, 11) ?? null,
      textOrNull(status.nome) ?? textOrNull(deputy.nomeCivil) ?? `Deputado ${deputy.id}`,
      textOrNull(deputy.nomeCivil),
      textOrNull(status.siglaPartido) ?? '',
      textOrNull(status.siglaUf) ?? '',
      numberOrNull(status.idLegislatura),
      textOrNull(deputy.dataNascimento),
      textOrNull(status.data),
      textOrNull(deputy.sexo),
      textOrNull(status.urlFoto),
      textOrNull(status.nomeEleitoral),
      textOrNull(status.condicaoEleitoral),
      textOrNull(status.email) ?? textOrNull(gabinete.email),
      textOrNull(gabinete.telefone),
      textOrNull(deputy.urlWebsite),
      deputy.redeSocial?.length ? JSON.stringify(deputy.redeSocial) : null,
      textOrNull(deputy.escolaridade),
      textOrNull(deputy.municipioNascimento),
      textOrNull(deputy.ufNascimento),
      textOrNull(gabinete.nome),
      textOrNull(gabinete.predio),
      textOrNull(gabinete.sala),
      textOrNull(gabinete.andar),
      textOrNull(status.situacao),
      textOrNull(status.situacao)?.toLowerCase().includes('exerc') ?? false,
    ],
  );

  await guardedClientQuery(client,
    `
    UPDATE politicos
    SET uri = $2,
        uri_partido = $3,
        data_falecimento = $4,
        descricao_status = $5,
        ultimo_status_json = $6::jsonb,
        raw_json = $7::jsonb
    WHERE id = $1
    `,
    [
      deputy.id,
      textOrNull(deputy.uri),
      textOrNull(status.uriPartido),
      textOrNull(deputy.dataFalecimento),
      textOrNull(status.descricaoStatus),
      jsonOrNull(status),
      JSON.stringify(deputy),
    ],
  );
  await upsertRawItem('deputados', String(deputy.id), `/deputados/${deputy.id}`, deputy);
};

const ingestDeputiesForLegislature = async (legislature: number) => {
  const ids = new Set<number>();
  const deputies = await fetchPaged<DeputySummary>('/deputados', {idLegislatura: legislature});
  deputies.forEach((deputy) => ids.add(deputy.id));

  let count = 0;
  await mapConcurrent([...ids], 2, async (id) => {
    const client = await pool.connect();
    try {
      const url = `${API_BASE}/deputados/${id}`;
      const detail = await fetchJson<{dados: DeputyDetails}>(url);
      await upsertDeputy(client, detail.dados);
      count += 1;
      await sleep(250);
    } finally {
      client.release();
    }
  });
  return count;
};

const getPoliticoIdsForRange = async (from: string, to: string) => {
  const legislatures = legislaturesForYears(yearsForRange(from, to));

  if (legislatures.length > 0) {
    const result = await guardedQuery<{id: string}>(
      `
      SELECT id::text AS id
      FROM politicos
      WHERE id_legislatura = ANY($1::int[])
      ORDER BY id ASC
      `,
      [legislatures],
    );
    return result.rows.map((row) => row.id);
  }

  const result = await guardedQuery<{id: string}>(
    'SELECT id::text AS id FROM politicos ORDER BY id ASC',
  );
  return result.rows.map((row) => row.id);
};

const upsertExpenses = async (
  politicoId: string, year: number, month: number, checkpoint: {id: string; progress_json?: unknown},
) => {
  const resource = '/deputados/' + politicoId + '/despesas';
  const params = {ano: year, mes: month};
  let progress = readPageProgress(checkpoint.progress_json, resource, params);
  if (progress.finished) return progress.itemsCount;
  for await (const page of fetchPagedPages<Expense>(resource, params, {}, progress.nextPage)) {
    const next = {...progress, nextPage: page.page + 1, itemsCount: progress.itemsCount + page.items.length, finished: !page.hasNext};
    await commitCheckpointPage(pool, checkpoint.id, next, async client => {
      await upsertExpenseBatch(client, politicoId, year, month, page.items);
      await upsertRawItems(page.items.filter(expense => expense.codDocumento != null).map(expense => ({
        resource: 'deputados_despesas', resourceId: String(expense.codDocumento), endpoint: resource,
        rawJson: expense, parentResource: 'deputados', parentId: politicoId, queryParams: params,
      })), client);
    }, checkCancellation);
    progress = next;
    writeEvent('db_write', 'Pagina de despesas confirmada', {dataset: 'despesas', entityId: politicoId, page: page.page, total: progress.itemsCount});
  }
  return progress.itemsCount;
};

const validProposalCandidates = (value: VoteProposalCandidate[] | undefined) =>
  (Array.isArray(value) ? value : []).filter((candidate) => numberOrNull(candidate.id) != null);

const upsertVoteRelations = async (
  voteSessionId: string,
  possibleObjects: VoteProposalCandidate[],
  affectedProposals: VoteProposalCandidate[],
) => {
  const client = await pool.connect();
  try {
    await guardedClientQuery(client, 'BEGIN');
    await guardedClientQuery(client, 'DELETE FROM votacao_objetos_possiveis WHERE votacao_id = $1', [voteSessionId]);
    await guardedClientQuery(client, 'DELETE FROM votacao_proposicoes_afetadas WHERE votacao_id = $1', [voteSessionId]);

    if (possibleObjects.length > 0) {
      await guardedClientQuery(client,
        `
        INSERT INTO votacao_objetos_possiveis (
          votacao_id, proposicao_id, uri, sigla_tipo, numero, ano, ementa, ordem, raw_json, atualizado_em
        )
        SELECT $1, item.id, item.uri, item.sigla_tipo, item.numero, item.ano, item.ementa, item.ordem, item.raw_json, CURRENT_TIMESTAMP
        FROM jsonb_to_recordset($2::jsonb) AS item(
          id bigint, uri text, sigla_tipo varchar(30), numero integer, ano integer,
          ementa text, ordem integer, raw_json jsonb
        )
        ON CONFLICT (votacao_id, proposicao_id) DO UPDATE SET
          uri = EXCLUDED.uri,
          sigla_tipo = EXCLUDED.sigla_tipo,
          numero = EXCLUDED.numero,
          ano = EXCLUDED.ano,
          ementa = EXCLUDED.ementa,
          ordem = EXCLUDED.ordem,
          raw_json = EXCLUDED.raw_json,
          atualizado_em = CURRENT_TIMESTAMP
        `,
        [
          voteSessionId,
          JSON.stringify(possibleObjects.map((candidate, ordem) => ({
            id: numberOrNull(candidate.id),
            uri: textOrNull(candidate.uri),
            sigla_tipo: textOrNull(candidate.siglaTipo),
            numero: numberOrNull(candidate.numero),
            ano: numberOrNull(candidate.ano),
            ementa: textOrNull(candidate.ementa),
            ordem,
            raw_json: candidate,
          }))),
        ],
      );
    }

    if (affectedProposals.length > 0) {
      await guardedClientQuery(client,
        `
        INSERT INTO votacao_proposicoes_afetadas (
          votacao_id, proposicao_id, uri, sigla_tipo, numero, ano, ementa, efeito, ordem, raw_json, atualizado_em
        )
        SELECT $1, item.id, item.uri, item.sigla_tipo, item.numero, item.ano, item.ementa, item.efeito, item.ordem, item.raw_json, CURRENT_TIMESTAMP
        FROM jsonb_to_recordset($2::jsonb) AS item(
          id bigint, uri text, sigla_tipo varchar(30), numero integer, ano integer,
          ementa text, efeito text, ordem integer, raw_json jsonb
        )
        ON CONFLICT (votacao_id, proposicao_id) DO UPDATE SET
          uri = EXCLUDED.uri,
          sigla_tipo = EXCLUDED.sigla_tipo,
          numero = EXCLUDED.numero,
          ano = EXCLUDED.ano,
          ementa = EXCLUDED.ementa,
          efeito = EXCLUDED.efeito,
          ordem = EXCLUDED.ordem,
          raw_json = EXCLUDED.raw_json,
          atualizado_em = CURRENT_TIMESTAMP
        `,
        [
          voteSessionId,
          JSON.stringify(affectedProposals.map((candidate, ordem) => ({
            id: numberOrNull(candidate.id),
            uri: textOrNull(candidate.uri),
            sigla_tipo: textOrNull(candidate.siglaTipo),
            numero: numberOrNull(candidate.numero),
            ano: numberOrNull(candidate.ano),
            ementa: textOrNull(candidate.ementa),
            efeito: textOrNull(candidate.efeito),
            ordem,
            raw_json: candidate,
          }))),
        ],
      );
    }
    await guardedClientQuery(client, 'COMMIT');
  } catch (error) {
    await guardedClientQuery(client, 'ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const upsertVoteSession = async (voteSession: VoteSession) => {
  const possibleObjects = validProposalCandidates(voteSession.objetosPossiveis);
  const affectedProposals = validProposalCandidates(voteSession.proposicoesAfetadas);
  const classification = classifyVote({
    votacaoId: voteSession.id,
    descricao: voteSession.descricao,
    proposicaoObjeto: voteSession.proposicaoObjeto,
    uriProposicaoObjeto: voteSession.uriProposicaoObjeto,
    objetosPossiveis: possibleObjects,
    proposicoesAfetadas: affectedProposals,
  });

  await guardedQuery(
    `
    INSERT INTO votacoes (
      id, uri, sigla_tipo, numero, ano, ementa, data, data_hora_registro, data_hora_votacao,
      sigla_orgao, uri_orgao, id_orgao, uri_evento, id_evento,
      proposicao_objeto, uri_proposicao_objeto, resultado, aprovacao,
      desc_ultima_abertura_votacao, data_hora_ultima_abertura_votacao,
      ultima_apresentacao_proposicao_json, efeitos_registrados_json, objetos_possiveis_json,
      tipo_votacao, eh_subvotacao, titulo_publico, resumo_leigo,
      classificacao_fonte, classificacao_confianca, classificacao_versao,
      classificacao_justificativa, ai_input_hash, raw_json
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7::date, $8::timestamptz, COALESCE($8::timestamptz, ($7::date)::timestamptz),
      $9, $10, $11, $12, $13,
      $14, $15, $16, $17,
      $18, $19,
      $20::jsonb, $21::jsonb, $22::jsonb,
      $23, $24, $25, $26,
      $27, $28, $29, $30, $31, $32::jsonb
    )
    ON CONFLICT (id) DO UPDATE SET
      uri = EXCLUDED.uri,
      sigla_tipo = EXCLUDED.sigla_tipo,
      numero = EXCLUDED.numero,
      ano = EXCLUDED.ano,
      ementa = EXCLUDED.ementa,
      data = EXCLUDED.data,
      data_hora_registro = EXCLUDED.data_hora_registro,
      data_hora_votacao = EXCLUDED.data_hora_votacao,
      sigla_orgao = EXCLUDED.sigla_orgao,
      uri_orgao = EXCLUDED.uri_orgao,
      id_orgao = EXCLUDED.id_orgao,
      uri_evento = EXCLUDED.uri_evento,
      id_evento = EXCLUDED.id_evento,
      proposicao_objeto = EXCLUDED.proposicao_objeto,
      uri_proposicao_objeto = EXCLUDED.uri_proposicao_objeto,
      resultado = EXCLUDED.resultado,
      aprovacao = EXCLUDED.aprovacao,
      desc_ultima_abertura_votacao = EXCLUDED.desc_ultima_abertura_votacao,
      data_hora_ultima_abertura_votacao = EXCLUDED.data_hora_ultima_abertura_votacao,
      ultima_apresentacao_proposicao_json = EXCLUDED.ultima_apresentacao_proposicao_json,
      efeitos_registrados_json = EXCLUDED.efeitos_registrados_json,
      objetos_possiveis_json = EXCLUDED.objetos_possiveis_json,
      tipo_votacao = EXCLUDED.tipo_votacao,
      eh_subvotacao = EXCLUDED.eh_subvotacao,
      ${votePresentationAssignments('votacoes', 'EXCLUDED')},
      classificacao_fonte = EXCLUDED.classificacao_fonte,
      classificacao_confianca = EXCLUDED.classificacao_confianca,
      classificacao_versao = EXCLUDED.classificacao_versao,
      classificacao_justificativa = EXCLUDED.classificacao_justificativa,
      ai_input_hash = EXCLUDED.ai_input_hash,
      raw_json = EXCLUDED.raw_json
    `,
    [
      voteSession.id,
      textOrNull(voteSession.uri),
      textOrNull(voteSession.siglaTipo),
      numberOrNull(voteSession.numero),
      numberOrNull(voteSession.ano),
      textOrNull(voteSession.descricao),
      textOrNull(voteSession.data),
      textOrNull(voteSession.dataHoraRegistro),
      textOrNull(voteSession.siglaOrgao),
      textOrNull(voteSession.uriOrgao),
      numberOrNull(voteSession.idOrgao),
      textOrNull(voteSession.uriEvento),
      numberOrNull(voteSession.idEvento),
      textOrNull(voteSession.proposicaoObjeto),
      textOrNull(voteSession.uriProposicaoObjeto),
      textOrNull(voteSession.resultado),
      numberOrNull(voteSession.aprovacao) ?? 0,
      textOrNull(voteSession.descUltimaAberturaVotacao),
      textOrNull(voteSession.dataHoraUltimaAberturaVotacao),
      jsonOrNull(voteSession.ultimaApresentacaoProposicao),
      jsonOrNull(voteSession.efeitosRegistrados),
      JSON.stringify(possibleObjects),
      classification.tipoVotacao,
      classification.ehSubvotacao,
      classification.tituloPublico,
      classification.resumoLeigo,
      classification.classificacaoFonte,
      classification.classificacaoConfianca,
      classification.classificacaoVersao,
      classification.classificacaoJustificativa,
      classification.inputHash,
      JSON.stringify(voteSession),
    ],
  );
  await upsertVoteRelations(voteSession.id, possibleObjects, affectedProposals);
  await upsertRawItem('votacoes', voteSession.id, `/votacoes/${voteSession.id}`, voteSession);
};

const reconcilePendingVotes = async () => {
  const result = await guardedQuery(
    `
    WITH ready AS (
      SELECT pending.*
      FROM votos_deputados_pendentes pending
      JOIN politicos politician ON politician.id = pending.politico_id
      JOIN votacoes vote_session ON vote_session.id = pending.votacao_id
    ), upserted AS (
      INSERT INTO votos_deputados (
        votacao_id, politico_id, voto, data_hora_voto, deputado_json, raw_json
      )
      SELECT votacao_id, politico_id, voto, data_hora_voto, deputado_json, raw_json
      FROM ready
      ON CONFLICT (votacao_id, politico_id) DO UPDATE SET
        voto = EXCLUDED.voto,
        data_hora_voto = EXCLUDED.data_hora_voto,
        deputado_json = EXCLUDED.deputado_json,
        raw_json = EXCLUDED.raw_json
      RETURNING votacao_id, politico_id
    )
    DELETE FROM votos_deputados_pendentes pending
    USING upserted
    WHERE pending.votacao_id = upserted.votacao_id
      AND pending.politico_id = upserted.politico_id
    `,
  );
  return result.rowCount ?? 0;
};

const upsertVotes = async (voteSessionId: string, votes: DeputyVote[]) => {
  const validVotes = votes
    .map((vote) => ({
      politicoId: vote.deputado_?.id,
      voteType: textOrNull(vote.tipoVoto),
      dataHoraVoto: textOrNull(vote.dataHoraVoto) ?? textOrNull(vote.dataRegistroVoto),
      deputyJson: vote.deputado_ == null ? null : JSON.stringify(vote.deputado_),
      rawJson: JSON.stringify(vote),
    }))
    .filter(
      (vote): vote is {
        politicoId: number;
        voteType: string;
        dataHoraVoto: string | null;
        deputyJson: string | null;
        rawJson: string;
      } =>
      Boolean(vote.politicoId && vote.voteType),
    );

  if (validVotes.length === 0) return 0;

  const politicianIds = validVotes.map((vote) => String(vote.politicoId));
  const existingResult = await guardedQuery<{id: string}>(
    'SELECT id::text AS id FROM politicos WHERE id = ANY($1::bigint[])',
    [politicianIds],
  );
  const existingIds = new Set(existingResult.rows.map((row) => row.id));
  const readyVotes = validVotes.filter((vote) => existingIds.has(String(vote.politicoId)));
  const pendingVotes = validVotes.filter((vote) => !existingIds.has(String(vote.politicoId)));

  const values: Array<string | number> = [];
  const placeholders = readyVotes.map((vote, index) => {
    const offset = index * 6;
    values.push(
      voteSessionId,
      vote.politicoId,
      vote.voteType,
      vote.dataHoraVoto ?? '',
      vote.deputyJson ?? '',
      vote.rawJson,
    );
    return `($${offset + 1}, $${offset + 2}, $${offset + 3}, NULLIF($${offset + 4}, '')::timestamptz, NULLIF($${offset + 5}, '')::jsonb, $${offset + 6}::jsonb)`;
  });

  if (readyVotes.length > 0) {
    await guardedQuery(
      `
      INSERT INTO votos_deputados (votacao_id, politico_id, voto, data_hora_voto, deputado_json, raw_json)
      VALUES ${placeholders.join(', ')}
      ON CONFLICT (votacao_id, politico_id) DO UPDATE SET
        voto = EXCLUDED.voto,
        data_hora_voto = EXCLUDED.data_hora_voto,
        deputado_json = EXCLUDED.deputado_json,
        raw_json = EXCLUDED.raw_json
      `,
      values,
    );
  }

  if (pendingVotes.length > 0) {
    await guardedQuery(
      `
      INSERT INTO votos_deputados_pendentes (
        votacao_id, politico_id, voto, data_hora_voto, deputado_json, raw_json, ultimo_erro, tentativas, atualizado_em
      )
      SELECT $1, item.politico_id, item.voto, item.data_hora_voto, item.deputado_json, item.raw_json,
        'Deputado ainda não sincronizado.', 0, CURRENT_TIMESTAMP
      FROM jsonb_to_recordset($2::jsonb) AS item(
        politico_id bigint, voto varchar(50), data_hora_voto timestamptz, deputado_json jsonb, raw_json jsonb
      )
      ON CONFLICT (votacao_id, politico_id) DO UPDATE SET
        voto = EXCLUDED.voto,
        data_hora_voto = EXCLUDED.data_hora_voto,
        deputado_json = EXCLUDED.deputado_json,
        raw_json = EXCLUDED.raw_json,
        ultimo_erro = EXCLUDED.ultimo_erro,
        atualizado_em = CURRENT_TIMESTAMP
      `,
      [
        voteSessionId,
        JSON.stringify(pendingVotes.map((vote) => ({
          politico_id: vote.politicoId,
          voto: vote.voteType,
          data_hora_voto: vote.dataHoraVoto,
          deputado_json: vote.deputyJson == null ? null : JSON.parse(vote.deputyJson),
          raw_json: JSON.parse(vote.rawJson),
        }))),
      ],
    );
  }

  await upsertRawItems(validVotes.map((vote) => ({
    resource: 'votacoes_votos',
    resourceId: `${voteSessionId}:${vote.politicoId}`,
    endpoint: `/votacoes/${voteSessionId}/votos`,
    rawJson: JSON.parse(vote.rawJson),
    parentResource: 'votacoes',
    parentId: voteSessionId,
  })));
  return readyVotes.length + pendingVotes.length;
};

const upsertVoteOrientations = async (voteSessionId: string, orientations: RawItem[]) => {
  const validOrientations = orientations.map((orientation) => ({
    siglaBancada:
      textOrNull(orientation.siglaBancada) ??
      textOrNull(orientation.siglaPartido) ??
      textOrNull(orientation.bancada),
    orientacao: textOrNull(orientation.orientacao) ?? textOrNull(orientation.voto),
    rawJson: orientation,
  })).filter((item): item is {siglaBancada: string; orientacao: string | null; rawJson: RawItem} => Boolean(item.siglaBancada));

  if (validOrientations.length > 0) {
    await guardedQuery(
      `
      INSERT INTO camara_votacoes_orientacoes (votacao_id, sigla_bancada, orientacao, raw_json)
      SELECT $1, item.sigla_bancada, item.orientacao, item.raw_json
      FROM jsonb_to_recordset($2::jsonb) AS item(sigla_bancada varchar(80), orientacao text, raw_json jsonb)
      ON CONFLICT (votacao_id, sigla_bancada) DO UPDATE SET
        orientacao = EXCLUDED.orientacao,
        raw_json = EXCLUDED.raw_json
      `,
      [
        voteSessionId,
        JSON.stringify(validOrientations.map((item) => ({
          sigla_bancada: item.siglaBancada,
          orientacao: item.orientacao,
          raw_json: item.rawJson,
        }))),
      ],
    );
  }

  await upsertRawItems(validOrientations.map((item) => ({
    resource: 'votacoes_orientacoes',
    resourceId: `${voteSessionId}:${item.siglaBancada}`,
    endpoint: `/votacoes/${voteSessionId}/orientacoes`,
    rawJson: item.rawJson,
    parentResource: 'votacoes',
    parentId: voteSessionId,
  })));

  return validOrientations.length;
};

const ingestVoteWindow = async (start: string, end: string, checkpointId?: string) => {
  writeEvent('api_fetch', 'Carregando votacoes da API da Camara', {
    dataset: 'votacoes',
    periodStart: start,
    periodEnd: end,
  });
  const voteSessions = await fetchPaged<VoteSession>('/votacoes', {
    dataInicio: start,
    dataFim: end,
  });

  let count = 0;
  let processed = 0;
  let voteRows = 0;
  let orientationRows = 0;
  await mapConcurrent(voteSessions, 2, async (voteSessionSummary) => {
    const voteSession =
      await fetchDetail<VoteSession>(`/votacoes/${voteSessionSummary.id}`, {ignoreBadRequest: true})
      ?? voteSessionSummary;
    writeEvent('db_write', 'Inserindo sessao de votacao no banco', {
      dataset: 'votacoes',
      periodStart: start,
      periodEnd: end,
      resourceId: voteSession.id,
      progress: processed,
      total: voteSessions.length,
    });
    await upsertVoteSession(voteSession);
    writeEvent('api_fetch', 'Buscando votos nominais da votacao', {
      dataset: 'votacoes',
      periodStart: start,
      periodEnd: end,
      resourceId: voteSession.id,
      progress: processed,
      total: voteSessions.length,
    });
    const votesPromise = fetchList<DeputyVote>(`/votacoes/${voteSession.id}/votos`, {}, {ignoreBadRequest: true});
    writeEvent('api_fetch', 'Buscando orientacoes de bancada da votacao', {
      dataset: 'votacoes',
      periodStart: start,
      periodEnd: end,
      resourceId: voteSession.id,
      progress: processed,
      total: voteSessions.length,
    });
    const orientationsPromise = fetchList<RawItem>(`/votacoes/${voteSession.id}/orientacoes`, {}, {ignoreBadRequest: true});
    const fetched = await Promise.allSettled([votesPromise, orientationsPromise]);
    const failure = fetched.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failure) throw failure.reason;
    const [votes, orientations] = fetched.map((result) => (result as PromiseFulfilledResult<any[]>).value);
    writeEvent('db_write', 'Inserindo votos e orientacoes no banco', {
      dataset: 'votacoes',
      periodStart: start,
      periodEnd: end,
      resourceId: voteSession.id,
      progress: processed,
      total: voteSessions.length,
      votes: votes.length,
      orientations: orientations.length,
    });
    const insertedVotes = await upsertVotes(voteSession.id, votes);
    const insertedOrientations = await upsertVoteOrientations(voteSession.id, orientations);
    count += insertedVotes + insertedOrientations;
    voteRows += insertedVotes;
    orientationRows += insertedOrientations;
    processed += 1;

    if (checkpointId && (processed % 25 === 0 || processed === voteSessions.length)) {
      const totalCount = count + processed;
      await touchCheckpointProgress(checkpointId, totalCount);
      writeLog(
        'log',
        `[progress] votacoes ${start}..${end}: ${processed}/${voteSessions.length} sessoes, ${voteRows} votos, ${orientationRows} orientacoes, ${totalCount} registros`,
      );
    }

    await sleep(250);
  });

  return count + voteSessions.length;
};

const upsertLegislature = async (item: RawItem) => {
  const id = numberOrNull(item.id);
  if (id == null) return 0;
  await guardedQuery(
    `
    INSERT INTO camara_legislaturas (id, uri, data_inicio, data_fim, raw_json, atualizado_em)
    VALUES ($1, $2, $3, $4, $5::jsonb, CURRENT_TIMESTAMP)
    ON CONFLICT (id) DO UPDATE SET
      uri = EXCLUDED.uri,
      data_inicio = EXCLUDED.data_inicio,
      data_fim = EXCLUDED.data_fim,
      raw_json = EXCLUDED.raw_json,
      atualizado_em = CURRENT_TIMESTAMP
    `,
    [
      id,
      textOrNull(item.uri),
      textOrNull(item.dataInicio),
      textOrNull(item.dataFim),
      JSON.stringify(item),
    ],
  );
  await upsertRawItem('legislaturas', String(id), `/legislaturas/${id}`, item);
  return 1;
};

const upsertParty = async (item: RawItem) => {
  const id = numberOrNull(item.id);
  if (id == null) return 0;
  await guardedQuery(
    `
    INSERT INTO camara_partidos (
      id, sigla, nome, uri, numero_eleitoral, url_logo, url_website, url_facebook,
      status_json, raw_json, atualizado_em
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, CURRENT_TIMESTAMP)
    ON CONFLICT (id) DO UPDATE SET
      sigla = EXCLUDED.sigla,
      nome = EXCLUDED.nome,
      uri = EXCLUDED.uri,
      numero_eleitoral = EXCLUDED.numero_eleitoral,
      url_logo = EXCLUDED.url_logo,
      url_website = EXCLUDED.url_website,
      url_facebook = EXCLUDED.url_facebook,
      status_json = EXCLUDED.status_json,
      raw_json = EXCLUDED.raw_json,
      atualizado_em = CURRENT_TIMESTAMP
    `,
    [
      id,
      textOrNull(item.sigla),
      textOrNull(item.nome),
      textOrNull(item.uri),
      numberOrNull(item.numeroEleitoral),
      textOrNull(item.urlLogo),
      textOrNull(item.urlWebSite) ?? textOrNull(item.urlWebsite),
      textOrNull(item.urlFacebook),
      jsonOrNull(item.status),
      JSON.stringify(item),
    ],
  );
  await upsertRawItem('partidos', String(id), `/partidos/${id}`, item);
  return 1;
};

const upsertBlock = async (item: RawItem) => {
  const id = textOrNull(item.id);
  if (!id) return 0;
  await guardedQuery(
    `
    INSERT INTO camara_blocos (id, uri, nome, id_legislatura, federacao, raw_json, atualizado_em)
    VALUES ($1, $2, $3, $4, $5, $6::jsonb, CURRENT_TIMESTAMP)
    ON CONFLICT (id) DO UPDATE SET
      uri = EXCLUDED.uri,
      nome = EXCLUDED.nome,
      id_legislatura = EXCLUDED.id_legislatura,
      federacao = EXCLUDED.federacao,
      raw_json = EXCLUDED.raw_json,
      atualizado_em = CURRENT_TIMESTAMP
    `,
    [
      id,
      textOrNull(item.uri),
      textOrNull(item.nome),
      numberOrNull(item.idLegislatura),
      typeof item.federacao === 'boolean' ? item.federacao : null,
      JSON.stringify(item),
    ],
  );
  await upsertRawItem('blocos', id, `/blocos/${id}`, item);
  return 1;
};

const upsertOrgan = async (item: RawItem) => {
  const id = numberOrNull(item.id);
  if (id == null) return 0;
  await guardedQuery(
    `
    INSERT INTO camara_orgaos (
      id, uri, sigla, nome, apelido, cod_tipo_orgao, tipo_orgao, nome_publicacao,
      nome_resumido, raw_json, atualizado_em
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, CURRENT_TIMESTAMP)
    ON CONFLICT (id) DO UPDATE SET
      uri = EXCLUDED.uri,
      sigla = EXCLUDED.sigla,
      nome = EXCLUDED.nome,
      apelido = EXCLUDED.apelido,
      cod_tipo_orgao = EXCLUDED.cod_tipo_orgao,
      tipo_orgao = EXCLUDED.tipo_orgao,
      nome_publicacao = EXCLUDED.nome_publicacao,
      nome_resumido = EXCLUDED.nome_resumido,
      raw_json = EXCLUDED.raw_json,
      atualizado_em = CURRENT_TIMESTAMP
    `,
    [
      id,
      textOrNull(item.uri),
      textOrNull(item.sigla),
      textOrNull(item.nome),
      textOrNull(item.apelido),
      numberOrNull(item.codTipoOrgao),
      textOrNull(item.tipoOrgao),
      textOrNull(item.nomePublicacao),
      textOrNull(item.nomeResumido),
      JSON.stringify(item),
    ],
  );
  await upsertRawItem('orgaos', String(id), `/orgaos/${id}`, item);
  return 1;
};

const upsertEvent = async (item: RawItem) => {
  const id = numberOrNull(item.id);
  if (id == null) return 0;
  await guardedQuery(
    `
    INSERT INTO camara_eventos (
      id, uri, data_hora_inicio, data_hora_fim, situacao, descricao_tipo, descricao,
      local_externo, local_camara_json, orgaos_json, url_registro, raw_json, atualizado_em
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12::jsonb, CURRENT_TIMESTAMP)
    ON CONFLICT (id) DO UPDATE SET
      uri = EXCLUDED.uri,
      data_hora_inicio = EXCLUDED.data_hora_inicio,
      data_hora_fim = EXCLUDED.data_hora_fim,
      situacao = EXCLUDED.situacao,
      descricao_tipo = EXCLUDED.descricao_tipo,
      descricao = EXCLUDED.descricao,
      local_externo = EXCLUDED.local_externo,
      local_camara_json = EXCLUDED.local_camara_json,
      orgaos_json = EXCLUDED.orgaos_json,
      url_registro = EXCLUDED.url_registro,
      raw_json = EXCLUDED.raw_json,
      atualizado_em = CURRENT_TIMESTAMP
    `,
    [
      id,
      textOrNull(item.uri),
      textOrNull(item.dataHoraInicio),
      textOrNull(item.dataHoraFim),
      textOrNull(item.situacao),
      textOrNull(item.descricaoTipo),
      textOrNull(item.descricao),
      textOrNull(item.localExterno),
      jsonOrNull(item.localCamara),
      jsonOrNull(item.orgaos),
      textOrNull(item.urlRegistro),
      JSON.stringify(item),
    ],
  );

  if (Array.isArray(item.orgaos)) {
    for (const orgao of item.orgaos) {
      const orgaoId = numberOrNull((orgao as RawItem).id);
      if (orgaoId == null) continue;
      await guardedQuery(
        `
        INSERT INTO camara_eventos_orgaos (evento_id, orgao_id, raw_json)
        VALUES ($1, $2, $3::jsonb)
        ON CONFLICT (evento_id, orgao_id) DO UPDATE SET raw_json = EXCLUDED.raw_json
        `,
        [id, orgaoId, JSON.stringify(orgao)],
      );
    }
  }

  await upsertRawItem('eventos', String(id), `/eventos/${id}`, item);
  return 1;
};

const upsertFront = async (item: RawItem) => {
  const id = numberOrNull(item.id);
  if (id == null) return 0;
  await guardedQuery(
    `
    INSERT INTO camara_frentes (id, uri, titulo, id_legislatura, raw_json, atualizado_em)
    VALUES ($1, $2, $3, $4, $5::jsonb, CURRENT_TIMESTAMP)
    ON CONFLICT (id) DO UPDATE SET
      uri = EXCLUDED.uri,
      titulo = EXCLUDED.titulo,
      id_legislatura = EXCLUDED.id_legislatura,
      raw_json = EXCLUDED.raw_json,
      atualizado_em = CURRENT_TIMESTAMP
    `,
    [id, textOrNull(item.uri), textOrNull(item.titulo), numberOrNull(item.idLegislatura), JSON.stringify(item)],
  );
  await upsertRawItem('frentes', String(id), `/frentes/${id}`, item);
  return 1;
};

const upsertProposal = async (item: RawItem) => {
  const id = numberOrNull(item.id);
  if (id == null) return 0;
  await guardedQuery(
    `
    INSERT INTO camara_proposicoes (
      id, uri, sigla_tipo, cod_tipo, numero, ano, ementa, data_apresentacao,
      uri_orgao_numerador, uri_autores, descricao_tipo, ementa_detalhada,
      keywords, url_inteiro_teor, urn_final, texto, justificativa,
      status_proposicao_json, raw_json, atualizado_em
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15, $16, $17, $18::jsonb, $19::jsonb, CURRENT_TIMESTAMP
    )
    ON CONFLICT (id) DO UPDATE SET
      uri = EXCLUDED.uri,
      sigla_tipo = EXCLUDED.sigla_tipo,
      cod_tipo = EXCLUDED.cod_tipo,
      numero = EXCLUDED.numero,
      ano = EXCLUDED.ano,
      ementa = EXCLUDED.ementa,
      data_apresentacao = EXCLUDED.data_apresentacao,
      uri_orgao_numerador = EXCLUDED.uri_orgao_numerador,
      uri_autores = EXCLUDED.uri_autores,
      descricao_tipo = EXCLUDED.descricao_tipo,
      ementa_detalhada = EXCLUDED.ementa_detalhada,
      keywords = EXCLUDED.keywords,
      url_inteiro_teor = EXCLUDED.url_inteiro_teor,
      urn_final = EXCLUDED.urn_final,
      texto = EXCLUDED.texto,
      justificativa = EXCLUDED.justificativa,
      status_proposicao_json = EXCLUDED.status_proposicao_json,
      raw_json = EXCLUDED.raw_json,
      atualizado_em = CURRENT_TIMESTAMP
    `,
    [
      id,
      textOrNull(item.uri),
      textOrNull(item.siglaTipo),
      numberOrNull(item.codTipo),
      numberOrNull(item.numero),
      numberOrNull(item.ano),
      textOrNull(item.ementa),
      textOrNull(item.dataApresentacao),
      textOrNull(item.uriOrgaoNumerador),
      textOrNull(item.uriAutores),
      textOrNull(item.descricaoTipo),
      textOrNull(item.ementaDetalhada),
      textOrNull(item.keywords),
      textOrNull(item.urlInteiroTeor),
      textOrNull(item.urnFinal),
      textOrNull(item.texto),
      textOrNull(item.justificativa),
      jsonOrNull(item.statusProposicao),
      JSON.stringify(item),
    ],
  );
  await upsertRawItem('proposicoes', String(id), `/proposicoes/${id}`, item);
  return 1;
};

const fetchProposalChild = async (
  proposal: RawItem,
  proposalId: number,
  resource: ProposalChildResource,
) => {
  const key = optionalChildKey(proposal, resource);
  if (shouldSkipOptionalChild(key)) {
    recordOptionalChildResult(key, false, true);
    return [] as RawItem[];
  }

  let badRequest = false;
  try {
    return await fetchPaged<RawItem>(
      `/proposicoes/${proposalId}/${resource}`,
      {},
      {
        ignoreBadRequest: true,
        logBadRequest: false,
        onBadRequest: () => {
          badRequest = true;
        },
      },
    );
  } finally {
    recordOptionalChildResult(key, badRequest);
  }
};

const upsertProposalChildren = async (proposalId: number, proposal: RawItem) => {
  let count = 0;
  const authors = await fetchProposalChild(proposal, proposalId, 'autores');
  for (const author of authors) {
    const uri = textOrNull(author.uri);
    if (!uri) continue;
    await guardedQuery(
      `
      INSERT INTO camara_proposicoes_autores (
        proposicao_id, uri, nome, cod_tipo, tipo, ordem_assinatura, proponente, raw_json
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      ON CONFLICT (proposicao_id, uri) DO UPDATE SET
        nome = EXCLUDED.nome,
        cod_tipo = EXCLUDED.cod_tipo,
        tipo = EXCLUDED.tipo,
        ordem_assinatura = EXCLUDED.ordem_assinatura,
        proponente = EXCLUDED.proponente,
        raw_json = EXCLUDED.raw_json
      `,
      [
        proposalId,
        uri,
        textOrNull(author.nome),
        numberOrNull(author.codTipo),
        textOrNull(author.tipo),
        numberOrNull(author.ordemAssinatura),
        numberOrNull(author.proponente),
        JSON.stringify(author),
      ],
    );
    await upsertRawItem('proposicoes_autores', `${proposalId}:${uri}`, `/proposicoes/${proposalId}/autores`, author, {
      parentResource: 'proposicoes',
      parentId: String(proposalId),
    });
    count += 1;
  }

  const themes = await fetchProposalChild(proposal, proposalId, 'temas');
  for (const theme of themes) {
    const codTema = numberOrNull(theme.codTema);
    if (codTema == null) continue;
    await guardedQuery(
      `
      INSERT INTO camara_proposicoes_temas (proposicao_id, cod_tema, tema, relevancia, raw_json)
      VALUES ($1, $2, $3, $4, $5::jsonb)
      ON CONFLICT (proposicao_id, cod_tema) DO UPDATE SET
        tema = EXCLUDED.tema,
        relevancia = EXCLUDED.relevancia,
        raw_json = EXCLUDED.raw_json
      `,
      [proposalId, codTema, textOrNull(theme.tema), numberOrNull(theme.relevancia), JSON.stringify(theme)],
    );
    count += 1;
  }

  const proceedings = await fetchProposalChild(proposal, proposalId, 'tramitacoes');
  for (const proceeding of proceedings) {
    const sequencia = numberOrNull(proceeding.sequencia);
    if (sequencia == null) continue;
    await guardedQuery(
      `
      INSERT INTO camara_proposicoes_tramitacoes (
        proposicao_id, sequencia, data_hora, sigla_orgao, uri_orgao, uri_ultimo_relator,
        regime, descricao_tramitacao, cod_tipo_tramitacao, descricao_situacao,
        cod_situacao, despacho, url, ambito, apreciacao, raw_json
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb)
      ON CONFLICT (proposicao_id, sequencia) DO UPDATE SET
        data_hora = EXCLUDED.data_hora,
        sigla_orgao = EXCLUDED.sigla_orgao,
        uri_orgao = EXCLUDED.uri_orgao,
        uri_ultimo_relator = EXCLUDED.uri_ultimo_relator,
        regime = EXCLUDED.regime,
        descricao_tramitacao = EXCLUDED.descricao_tramitacao,
        cod_tipo_tramitacao = EXCLUDED.cod_tipo_tramitacao,
        descricao_situacao = EXCLUDED.descricao_situacao,
        cod_situacao = EXCLUDED.cod_situacao,
        despacho = EXCLUDED.despacho,
        url = EXCLUDED.url,
        ambito = EXCLUDED.ambito,
        apreciacao = EXCLUDED.apreciacao,
        raw_json = EXCLUDED.raw_json
      `,
      [
        proposalId,
        sequencia,
        textOrNull(proceeding.dataHora),
        textOrNull(proceeding.siglaOrgao),
        textOrNull(proceeding.uriOrgao),
        textOrNull(proceeding.uriUltimoRelator),
        textOrNull(proceeding.regime),
        textOrNull(proceeding.descricaoTramitacao),
        textOrNull(proceeding.codTipoTramitacao),
        textOrNull(proceeding.descricaoSituacao),
        numberOrNull(proceeding.codSituacao),
        textOrNull(proceeding.despacho),
        textOrNull(proceeding.url),
        textOrNull(proceeding.ambito),
        textOrNull(proceeding.apreciacao),
        JSON.stringify(proceeding),
      ],
    );
    count += 1;
  }

  const related = await fetchProposalChild(proposal, proposalId, 'relacionadas');
  for (const relation of related) {
    const relatedId = numberOrNull(relation.id);
    if (relatedId == null) continue;
    await guardedQuery(
      `
      INSERT INTO camara_proposicoes_relacionadas (proposicao_id, relacionada_id, raw_json)
      VALUES ($1, $2, $3::jsonb)
      ON CONFLICT (proposicao_id, relacionada_id) DO UPDATE SET raw_json = EXCLUDED.raw_json
      `,
      [proposalId, relatedId, JSON.stringify(relation)],
    );
    count += 1;
  }

  return count;
};

const ingestPagedResource = async (
  dataset: Dataset, path: string, params: Record<string, string | number>, upsert: (item: RawItem) => Promise<number>,
) => {
  let count = 0;
  for await (const page of fetchPagedPages<RawItem>(path, params, {ignoreBadRequest: true})) {
    writeEvent('db_write', 'Inserindo ' + dataset + ' no banco de dados', {dataset, path, page: page.page, total: page.items.length});
    for (const item of page.items) count += await upsert(item);
  }
  writeLog('log', '[resource] ' + dataset + ' ' + path + ': ' + count + ' itens');
  return count;
};

const ingestParties = async () => {
  const summaries = await fetchPaged<RawItem>('/partidos', {});
  let count = 0;
  await mapConcurrent(summaries, 4, async (summary) => {
    const id = numberOrNull(summary.id);
    if (id == null) return;
    let item = summary;
    try {
      const detail = await fetchJson<{dados: RawItem}>(`${API_BASE}/partidos/${id}`);
      item = detail.dados ?? summary;
    } catch (error) {
      if (!(error instanceof HttpError) || ![400, 404, 405].includes(error.status)) throw error;
      item = summary;
    }
    count += await upsertParty(item);
    await sleep(150);
  });
  return count;
};

const ingestProposalsWindow = async (start: string, end: string, checkpointId?: string) => {
  writeEvent('api_fetch', 'Carregando proposicoes da API da Camara', {
    dataset: 'proposicoes',
    periodStart: start,
    periodEnd: end,
  });
  const proposals = await fetchPaged<RawItem>('/proposicoes', {dataInicio: start, dataFim: end});
  let count = 0;
  let processed = 0;
  await mapConcurrent(proposals, 3, async (summary) => {
    const id = numberOrNull(summary.id);
    if (id == null) return;
    let item = summary;
    try {
      const detail = await fetchJson<{dados: RawItem}>(`${API_BASE}/proposicoes/${id}`);
      item = detail.dados ?? summary;
    } catch (error) {
      if (!(error instanceof HttpError) || ![400, 404, 405].includes(error.status)) throw error;
      item = summary;
    }
    if (processed % 25 === 0) {
      writeEvent('db_write', 'Inserindo proposicoes e dados relacionados', {
        dataset: 'proposicoes',
        periodStart: start,
        periodEnd: end,
        resourceId: id,
        progress: processed,
        total: proposals.length,
      });
    }
    count += await upsertProposal(item);
    count += await upsertProposalChildren(id, item);
    processed += 1;
    if (checkpointId && (processed % 100 === 0 || processed === proposals.length)) {
      await touchCheckpointProgress(checkpointId, count);
      writeLog(
        'log',
        `[progress] proposicoes ${start}..${end}: ${processed}/${proposals.length} proposicoes, ${count} registros`,
      );
    }
    await sleep(250);
  });
  return count;
};

const ingestReferences = async () => {
  const groups = ['deputados', 'proposicoes', 'eventos', 'orgaos', 'votacoes'];
  let count = 0;

  for (const group of groups) {
    let response: {dados?: Record<string, RawItem[]>; links?: unknown};
    try {
      response = await fetchJson<{dados?: Record<string, RawItem[]>; links?: unknown}>(
        `${API_BASE}/referencias/${group}`,
      );
    } catch (error) {
      if (error instanceof HttpError && [400, 404, 405].includes(error.status)) {
        writeLog('warn', `[skip] referencias/${group}: HTTP ${error.status}`);
        continue;
      }
      throw error;
    }
    const dados = response.dados ?? {};
    await upsertRawItem('referencias', group, `/referencias/${group}`, dados, {
      linksJson: response.links,
    });

    for (const [key, values] of Object.entries(dados)) {
      if (!Array.isArray(values)) continue;
      for (const value of values) {
        const cod = textOrNull(value.cod) ?? textOrNull(value.sigla) ?? textOrNull(value.nome);
        if (!cod) continue;
        await guardedQuery(
          `
          INSERT INTO camara_referencias (grupo, chave, cod, sigla, nome, descricao, raw_json, atualizado_em)
          VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, CURRENT_TIMESTAMP)
          ON CONFLICT (grupo, chave, cod) DO UPDATE SET
            sigla = EXCLUDED.sigla,
            nome = EXCLUDED.nome,
            descricao = EXCLUDED.descricao,
            raw_json = EXCLUDED.raw_json,
            atualizado_em = CURRENT_TIMESTAMP
          `,
          [
            group,
            key,
            cod,
            textOrNull(value.sigla),
            textOrNull(value.nome),
            textOrNull(value.descricao),
            JSON.stringify(value),
          ],
        );
        count += 1;
      }
    }
  }

  return count;
};

const runCheckpointWorkers = async (
  dataset: Dataset,
  options: CliOptions,
  handler: (checkpoint: {
    id: string;
    entity_id: string;
    period_start: string;
    period_end: string;
    progress_json?: unknown;
  }) => Promise<number>,
) => {
  const worker = async () => {
    for (;;) {
      await checkCancellation();
      const checkpoint = await claimCheckpoint(dataset, options.maxAttempts, options.from, options.to);
      if (!checkpoint) return;

      try {
        writeLog(
          'log',
          `[start] ${dataset} ${checkpoint.entity_id} ${checkpoint.period_start}..${checkpoint.period_end}`,
        );
        writeEvent('checkpoint_start', 'Checkpoint iniciado', {
          dataset,
          entityId: checkpoint.entity_id,
          periodStart: checkpoint.period_start,
          periodEnd: checkpoint.period_end,
        });
        const guard = createCancellationGuard(async (client?: PoolClient) => {
          const result = await (client ?? pool).query<{status: string}>('SELECT status FROM ingestion_checkpoints WHERE id = $1', [checkpoint.id]);
          const cancelled = result.rows[0]?.status !== 'running';
          if (cancelled) cancellationObserved = true;
          return cancelled;
        });
        const itemsCount = await checkpointContext.run(guard, async () => {
          await guard();
          const count = await handler(checkpoint);
          await guard();
          return count;
        });
        if (!await finishCheckpoint(checkpoint.id, 'done', itemsCount, null)) throw new IngestionCancelledError();
        writeLog(
          'log',
          `[${itemsCount > 0 ? 'ok-items' : 'ok-zero'}] ${dataset} ${checkpoint.entity_id} ${checkpoint.period_start}..${checkpoint.period_end}: ${itemsCount}`,
        );
        writeEvent('checkpoint_done', itemsCount > 0 ? 'Checkpoint concluido com dados' : 'Checkpoint concluido sem itens', {
          dataset,
          entityId: checkpoint.entity_id,
          periodStart: checkpoint.period_start,
          periodEnd: checkpoint.period_end,
          total: itemsCount,
        });
      } catch (error) {
        if (error instanceof IngestionCancelledError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        await finishCheckpoint(checkpoint.id, 'failed', 0, message);
        writeLog(
          'warn',
          `[retry] ${dataset} ${checkpoint.entity_id} ${checkpoint.period_start}..${checkpoint.period_end}: ${message}`,
        );
        writeEvent('checkpoint_failed', 'Checkpoint falhou e sera reprocessado', {
          dataset,
          entityId: checkpoint.entity_id,
          periodStart: checkpoint.period_start,
          periodEnd: checkpoint.period_end,
          error: message,
        });
      }

      await sleep(options.minDelayMs);
    }
  };

  const results = await Promise.allSettled(Array.from({length: options.concurrency}, worker));
  const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failed) throw failed.reason;
};

const seedExpenseCheckpoints = async (options: CliOptions) => {
  const politicoIds = await getPoliticoIdsForRange(options.from, options.to);
  const windows = buildWindows(options.from, options.to, 'month');
  let batch: CheckpointSeed[] = [];
  const flush = async () => {
    await checkCancellation();
    await seedCheckpointBatch(pool, batch, options);
    batch = [];
  };
  for (const politicoId of politicoIds) {
    for (const window of windows) {
      batch.push({dataset: 'despesas', entityId: politicoId, start: window.start, end: window.end});
      if (batch.length === 1000) await flush();
    }
  }
  if (batch.length) await flush();
  writeLog('log', '[seed] despesas: ' + politicoIds.length * windows.length + ' tarefas');
};

const seedVoteCheckpoints = async (options: CliOptions) => {
  const windows = buildWindows(options.from, options.to, options.window);
  for (const window of windows) {
    await seedCheckpoint(
      'votacoes',
      '',
      window.start,
      window.end,
      options.resetFailed,
      options.resetCancelled,
      options.resetEmpty,
    );
  }
  writeLog('log', `[seed] votacoes: ${windows.length} tarefas`);
};

const seedDeputyCheckpoints = async (options: CliOptions) => {
  const legislatures = legislaturesForYears(yearsForRange(options.from, options.to));
  for (const legislature of legislatures) {
    await seedCheckpoint(
      'deputados',
      String(legislature),
      options.from,
      options.to,
      options.resetFailed,
      options.resetCancelled,
      options.resetEmpty,
    );
  }
  writeLog('log', `[seed] deputados: ${legislatures.length} tarefas`);
};

const seedSingleCheckpoint = async (dataset: Dataset, options: CliOptions) => {
  await seedCheckpoint(
    dataset,
    '',
    options.from,
    options.to,
    options.resetFailed,
    options.resetCancelled,
    options.resetEmpty,
  );
  writeLog('log', `[seed] ${dataset}: 1 tarefa`);
};

const seedWindowCheckpoints = async (dataset: Dataset, options: CliOptions) => {
  const windows = buildWindows(options.from, options.to, options.window);
  for (const window of windows) {
    await seedCheckpoint(
      dataset,
      '',
      window.start,
      window.end,
      options.resetFailed,
      options.resetCancelled,
      options.resetEmpty,
    );
  }
  writeLog('log', `[seed] ${dataset}: ${windows.length} tarefas`);
};

const run = async () => {
  const options = parseArgs();

  writeLog(
    'log',
    `[agent] periodo=${options.from}..${options.to} datasets=${options.datasets.join(',')} janela=${options.window} concorrencia=${options.concurrency}`,
  );

  if (options.dryRun) {
    writeLog('log', '[dry-run] nenhum dado sera gravado');
    return;
  }

  await runIngestion(pool, options.dryRun, async () => {
    await releaseStaleCheckpoints(options.staleMinutes);

    if (options.datasets.includes('deputados')) {
      await seedDeputyCheckpoints(options);
      await runCheckpointWorkers('deputados', options, async (checkpoint) =>
        ingestDeputiesForLegislature(Number(checkpoint.entity_id)),
      );
      const reconciled = await reconcilePendingVotes();
      if (reconciled > 0) writeLog('log', `[reconcile] ${reconciled} voto(s) pendente(s) incorporado(s)`);
    }

    if (options.datasets.includes('proposicoes')) {
      await seedWindowCheckpoints('proposicoes', options);
      await runCheckpointWorkers('proposicoes', options, async (checkpoint) =>
        ingestProposalsWindow(checkpoint.period_start, checkpoint.period_end, checkpoint.id),
      );
    }

    if (options.datasets.includes('despesas')) {
      await seedExpenseCheckpoints(options);
      await runCheckpointWorkers('despesas', options, async (checkpoint) => {
        const date = new Date(`${checkpoint.period_start}T00:00:00.000Z`);
        return upsertExpenses(
          checkpoint.entity_id,
          date.getUTCFullYear(),
          date.getUTCMonth() + 1,
          checkpoint,
        );
      });
    }

    if (options.datasets.includes('votacoes')) {
      await seedVoteCheckpoints(options);
      await runCheckpointWorkers('votacoes', options, async (checkpoint) =>
        ingestVoteWindow(checkpoint.period_start, checkpoint.period_end, checkpoint.id),
      );
      const reconciled = await reconcilePendingVotes();
      if (reconciled > 0) writeLog('log', `[reconcile] ${reconciled} voto(s) pendente(s) incorporado(s)`);
    }

    if (options.datasets.includes('legislaturas')) {
      await seedSingleCheckpoint('legislaturas', options);
      await runCheckpointWorkers('legislaturas', options, async () =>
        ingestPagedResource('legislaturas', '/legislaturas', {}, upsertLegislature),
      );
    }

    if (options.datasets.includes('partidos')) {
      await seedSingleCheckpoint('partidos', options);
      await runCheckpointWorkers('partidos', options, async () => ingestParties());
    }

    if (options.datasets.includes('blocos')) {
      await seedSingleCheckpoint('blocos', options);
      await runCheckpointWorkers('blocos', options, async () =>
        ingestPagedResource('blocos', '/blocos', {}, upsertBlock),
      );
    }

    if (options.datasets.includes('orgaos')) {
      await seedSingleCheckpoint('orgaos', options);
      await runCheckpointWorkers('orgaos', options, async () =>
        ingestPagedResource('orgaos', '/orgaos', {}, upsertOrgan),
      );
    }

    if (options.datasets.includes('eventos')) {
      await seedWindowCheckpoints('eventos', options);
      await runCheckpointWorkers('eventos', options, async (checkpoint) =>
        ingestPagedResource('eventos', '/eventos', {
          dataInicio: checkpoint.period_start,
          dataFim: checkpoint.period_end,
        }, upsertEvent),
      );
    }

    if (options.datasets.includes('frentes')) {
      await seedSingleCheckpoint('frentes', options);
      await runCheckpointWorkers('frentes', options, async () =>
        ingestPagedResource('frentes', '/frentes', {}, upsertFront),
      );
    }

    if (options.datasets.includes('referencias')) {
      await seedSingleCheckpoint('referencias', options);
      await runCheckpointWorkers('referencias', options, async () => ingestReferences());
    }
  });
};

export const ingestionRun = run()
  .catch((error) => {
    if (error instanceof IngestionCancelledError) { writeLog('log', error.message); return; }
    writeLog('error', error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
