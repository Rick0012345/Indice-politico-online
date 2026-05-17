import 'dotenv/config';
import {setTimeout as sleep} from 'node:timers/promises';
import {Pool, type PoolClient} from 'pg';

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
  objetosPossiveis?: unknown;
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

const API_BASE = 'https://dadosabertos.camara.leg.br/api/v2';
const HTTP_TIMEOUT_MS = 45000;
const MAX_HTTP_ATTEMPTS = 2;
const MAX_PAGES_PER_REQUEST = 200;
const HTTP_REQUEST_MIN_INTERVAL_MS = 500;
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
    concurrency: Math.max(1, Number(get('concurrency', '2')) || 2),
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
  await pool.query(
    `
    INSERT INTO camara_api_raw_items (
      resource, resource_id, parent_resource, parent_id, endpoint, query_params, raw_json, links_json
    )
    VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb)
    ON CONFLICT (resource, resource_id, parent_resource, parent_id) DO UPDATE SET
      endpoint = EXCLUDED.endpoint,
      query_params = EXCLUDED.query_params,
      raw_json = EXCLUDED.raw_json,
      links_json = EXCLUDED.links_json,
      fetched_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
    `,
    [
      resource,
      resourceId,
      options.parentResource ?? '',
      options.parentId ?? '',
      endpoint,
      JSON.stringify(options.queryParams ?? {}),
      JSON.stringify(rawJson),
      options.linksJson == null ? null : JSON.stringify(options.linksJson),
    ],
  );
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
  await Promise.all(workers);
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

const fetchJson = async <T>(url: string, attempt = 1): Promise<T> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

  try {
    await waitForHttpSlot();
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'catalogo-politico-ingest-agent/1.0',
      },
    });

    const retryable = [403, 408, 429, 500, 502, 503, 504].includes(response.status);
    if (retryable && attempt < MAX_HTTP_ATTEMPTS) {
      const delay = retryDelayForStatus(response.status, response.headers.get('retry-after'), attempt);
      if (response.status === 429) {
        applyHttpCooldown(delay);
      }
      writeLog(
        'warn',
        `[http-retry] tentativa=${attempt} status=${response.status} delay=${delay} url=${url}`,
      );
      await sleep(delay);
      return fetchJson<T>(url, attempt + 1);
    }

    if (!response.ok) {
      throw new HttpError(response.status, url, retryable);
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof HttpError) throw error;

    const isAbort = error instanceof Error && error.name === 'AbortError';
    if (attempt < MAX_HTTP_ATTEMPTS) {
      const delay = jitter(Math.min(30000, 1000 * 2 ** attempt));
      writeLog(
        'warn',
        `[http-retry] tentativa=${attempt} erro=${isAbort ? 'timeout' : error instanceof Error ? error.message : String(error)} delay=${delay} url=${url}`,
      );
      await sleep(delay);
      return fetchJson<T>(url, attempt + 1);
    }

    throw new Error(`${isAbort ? 'Timeout' : 'Erro de rede'} em ${url}`);
  } finally {
    clearTimeout(timeout);
  }
};

const fetchPaged = async <T>(
  path: string,
  params: Record<string, string | number>,
  options: FetchPagedOptions = {},
) => {
  const items: T[] = [];
  let page = 1;

  for (;;) {
    if (page > MAX_PAGES_PER_REQUEST) {
      throw new Error(`Limite de paginacao excedido (${MAX_PAGES_PER_REQUEST}) em ${path}`);
    }

    const url = new URL(`${API_BASE}${path}`);
    for (const [key, value] of Object.entries({...params, itens: 100, pagina: page})) {
      url.searchParams.set(key, String(value));
    }

    let data: CamaraListResponse<T>;
    try {
      data = await fetchJson<CamaraListResponse<T>>(url.toString());
    } catch (error) {
      if (options.ignoreBadRequest && error instanceof HttpError && error.status === 400) {
        options.onBadRequest?.(url.toString());
        if (options.logBadRequest !== false) {
          writeLog('warn', `[skip] API retornou 400 para recurso opcional: ${url.toString()}`);
        }
        return items;
      }
      throw error;
    }
    const pageItems = data.dados ?? [];
    items.push(...pageItems);

    const hasNext = data.links?.some((link) => link.rel === 'next');
    if (!hasNext || pageItems.length === 0) break;
    page += 1;
  }

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

const ensureCheckpointTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ingestion_checkpoints (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      source VARCHAR(50) NOT NULL,
      dataset VARCHAR(50) NOT NULL,
      entity_id TEXT NOT NULL DEFAULT '',
      period_start DATE NOT NULL,
      period_end DATE NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      items_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      locked_at TIMESTAMPTZ(6),
      started_at TIMESTAMPTZ(6),
      finished_at TIMESTAMPTZ(6),
      created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ingestion_checkpoints_unique_window
    ON ingestion_checkpoints(source, dataset, entity_id, period_start, period_end)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ingestion_checkpoints_running_lock
    ON ingestion_checkpoints(source, status, locked_at)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ingestion_checkpoints_claim_queue
    ON ingestion_checkpoints(source, dataset, status, attempts, period_start, entity_id)
  `);
};

const seedCheckpoint = async (
  dataset: Dataset,
  entityId: string,
  start: string,
  end: string,
  resetFailed: boolean,
  resetCancelled: boolean,
  resetEmpty: boolean,
) => {
  await pool.query(
    `
    INSERT INTO ingestion_checkpoints (source, dataset, entity_id, period_start, period_end)
    VALUES ('camara', $1, $2, $3, $4)
    ON CONFLICT (source, dataset, entity_id, period_start, period_end)
    DO UPDATE SET
      status = CASE
        WHEN $5::boolean AND ingestion_checkpoints.status = 'failed' THEN 'pending'
        WHEN $6::boolean AND ingestion_checkpoints.status = 'cancelled' THEN 'pending'
        WHEN $7::boolean AND ingestion_checkpoints.status = 'done' AND ingestion_checkpoints.items_count = 0 THEN 'pending'
        WHEN ingestion_checkpoints.status = 'cancelled' THEN 'cancelled'
        ELSE ingestion_checkpoints.status
      END,
      attempts = CASE
        WHEN $5::boolean AND ingestion_checkpoints.status = 'failed' THEN 0
        WHEN $5::boolean AND ingestion_checkpoints.status = 'pending' AND ingestion_checkpoints.attempts >= 5 THEN 0
        WHEN $6::boolean AND ingestion_checkpoints.status = 'cancelled' THEN 0
        WHEN $7::boolean AND ingestion_checkpoints.status = 'done' AND ingestion_checkpoints.items_count = 0 THEN 0
        ELSE ingestion_checkpoints.attempts
      END,
      last_error = CASE
        WHEN $5::boolean AND ingestion_checkpoints.status = 'failed' THEN NULL
        WHEN $5::boolean AND ingestion_checkpoints.status = 'pending' AND ingestion_checkpoints.attempts >= 5 THEN NULL
        WHEN $6::boolean AND ingestion_checkpoints.status = 'cancelled' THEN NULL
        WHEN $7::boolean AND ingestion_checkpoints.status = 'done' AND ingestion_checkpoints.items_count = 0 THEN NULL
        ELSE ingestion_checkpoints.last_error
      END,
      updated_at = CURRENT_TIMESTAMP
    `,
    [dataset, entityId, start, end, resetFailed, resetCancelled, resetEmpty],
  );
};

const claimCheckpoint = async (dataset: Dataset, maxAttempts: number) => {
  const result = await pool.query<{
    id: string;
    entity_id: string;
    period_start: string;
    period_end: string;
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
      ORDER BY period_start ASC, entity_id ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, entity_id, period_start::text, period_end::text
    `,
    [dataset, maxAttempts],
  );

  return result.rows[0] ?? null;
};

const releaseStaleCheckpoints = async (staleMinutes: number) => {
  const result = await pool.query(
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
  await pool.query(
    `
    UPDATE ingestion_checkpoints
    SET status = $2::varchar,
        items_count = $3,
        last_error = $4,
        locked_at = NULL,
        finished_at = CASE WHEN $2::text = 'done' THEN CURRENT_TIMESTAMP ELSE finished_at END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
      AND status <> 'cancelled'
    `,
    [id, status, itemsCount, error],
  );
};

const touchCheckpointProgress = async (id: string, itemsCount: number) => {
  await pool.query(
    `
    UPDATE ingestion_checkpoints
    SET items_count = $2,
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
  await client.query(
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

  await client.query(
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
  await mapConcurrent([...ids], 5, async (id) => {
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
    const result = await pool.query<{id: string}>(
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

  const result = await pool.query<{id: string}>(
    'SELECT id::text AS id FROM politicos ORDER BY id ASC',
  );
  return result.rows.map((row) => row.id);
};

const upsertExpenses = async (politicoId: string, year: number, month: number) => {
  const expenses = await fetchPaged<Expense>(`/deputados/${politicoId}/despesas`, {
    ano: year,
    mes: month,
  });

  for (const expense of expenses) {
    await pool.query(
      `
      INSERT INTO despesas (
        politico_id, ano, mes, tipo_despesa, cod_documento, cnpj_cpf_fornecedor,
        nome_fornecedor, tipo_documento, data_documento, num_documento,
        valor_documento, valor_glosa, valor_liquido, num_lote,
        num_ressarcimento, parcela, url_documento
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      ON CONFLICT (cod_documento) DO UPDATE SET
        politico_id = EXCLUDED.politico_id,
        ano = EXCLUDED.ano,
        mes = EXCLUDED.mes,
        tipo_despesa = EXCLUDED.tipo_despesa,
        cnpj_cpf_fornecedor = EXCLUDED.cnpj_cpf_fornecedor,
        nome_fornecedor = EXCLUDED.nome_fornecedor,
        tipo_documento = EXCLUDED.tipo_documento,
        data_documento = EXCLUDED.data_documento,
        num_documento = EXCLUDED.num_documento,
        valor_documento = EXCLUDED.valor_documento,
        valor_glosa = EXCLUDED.valor_glosa,
        valor_liquido = EXCLUDED.valor_liquido,
        num_lote = EXCLUDED.num_lote,
        num_ressarcimento = EXCLUDED.num_ressarcimento,
        parcela = EXCLUDED.parcela,
        url_documento = EXCLUDED.url_documento
      `,
      [
        politicoId,
        expense.ano ?? year,
        expense.mes ?? month,
        textOrNull(expense.tipoDespesa) ?? 'Nao informado',
        textOrNull(expense.codDocumento),
        textOrNull(expense.cnpjCpfFornecedor),
        textOrNull(expense.nomeFornecedor),
        textOrNull(expense.tipoDocumento),
        textOrNull(expense.dataDocumento),
        textOrNull(expense.numDocumento),
        numberOrNull(expense.valorDocumento) ?? 0,
        numberOrNull(expense.valorGlosa) ?? 0,
        numberOrNull(expense.valorLiquido) ?? 0,
        textOrNull(expense.numLote),
        textOrNull(expense.numRessarcimento),
        numberOrNull(expense.parcela) ?? 0,
        textOrNull(expense.urlDocumento),
      ],
    );

    if (expense.codDocumento != null) {
      await pool.query(
        `
        UPDATE despesas
        SET cod_tipo_documento = $2,
            cod_lote = $3,
            raw_json = $4::jsonb
        WHERE cod_documento = $1
        `,
        [
          textOrNull(expense.codDocumento),
          numberOrNull(expense.codTipoDocumento),
          textOrNull(expense.codLote) ?? textOrNull(expense.numLote),
          JSON.stringify(expense),
        ],
      );
      await upsertRawItem(
        'deputados_despesas',
        String(expense.codDocumento),
        `/deputados/${politicoId}/despesas`,
        expense,
        {
          parentResource: 'deputados',
          parentId: politicoId,
          queryParams: {ano: year, mes: month},
        },
      );
    }
  }

  return expenses.length;
};

const upsertVoteSession = async (voteSession: VoteSession) => {
  await pool.query(
    `
    INSERT INTO votacoes (id, sigla_tipo, numero, ano, ementa, data_hora_votacao, resultado, aprovacao)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (id) DO UPDATE SET
      sigla_tipo = EXCLUDED.sigla_tipo,
      numero = EXCLUDED.numero,
      ano = EXCLUDED.ano,
      ementa = EXCLUDED.ementa,
      data_hora_votacao = EXCLUDED.data_hora_votacao,
      resultado = EXCLUDED.resultado,
      aprovacao = EXCLUDED.aprovacao
    `,
    [
      voteSession.id,
      textOrNull(voteSession.siglaTipo),
      numberOrNull(voteSession.numero),
      numberOrNull(voteSession.ano),
      textOrNull(voteSession.descricao),
      textOrNull(voteSession.data),
      textOrNull(voteSession.resultado),
      numberOrNull(voteSession.aprovacao) ?? 0,
    ],
  );

  await pool.query(
    `
    UPDATE votacoes
    SET uri = $2,
        data = $3,
        data_hora_registro = $4,
        sigla_orgao = $5,
        uri_orgao = $6,
        id_orgao = $7,
        uri_evento = $8,
        id_evento = $9,
        proposicao_objeto = $10,
        uri_proposicao_objeto = $11,
        desc_ultima_abertura_votacao = $12,
        data_hora_ultima_abertura_votacao = $13,
        ultima_apresentacao_proposicao_json = $14::jsonb,
        efeitos_registrados_json = $15::jsonb,
        objetos_possiveis_json = $16::jsonb,
        raw_json = $17::jsonb
    WHERE id = $1
    `,
    [
      voteSession.id,
      textOrNull(voteSession.uri),
      textOrNull(voteSession.data),
      textOrNull(voteSession.dataHoraRegistro),
      textOrNull(voteSession.siglaOrgao),
      textOrNull(voteSession.uriOrgao),
      numberOrNull(voteSession.idOrgao),
      textOrNull(voteSession.uriEvento),
      numberOrNull(voteSession.idEvento),
      textOrNull(voteSession.proposicaoObjeto),
      textOrNull(voteSession.uriProposicaoObjeto),
      textOrNull(voteSession.descUltimaAberturaVotacao),
      textOrNull(voteSession.dataHoraUltimaAberturaVotacao),
      jsonOrNull(voteSession.ultimaApresentacaoProposicao),
      jsonOrNull(voteSession.efeitosRegistrados),
      jsonOrNull(voteSession.objetosPossiveis),
      JSON.stringify(voteSession),
    ],
  );
  await upsertRawItem('votacoes', voteSession.id, `/votacoes/${voteSession.id}`, voteSession);
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

  const values: Array<string | number> = [];
  const placeholders = validVotes.map((vote, index) => {
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

  await pool.query(
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

  await Promise.all(
    validVotes.map((vote) =>
      upsertRawItem(
        'votacoes_votos',
        `${voteSessionId}:${vote.politicoId}`,
        `/votacoes/${voteSessionId}/votos`,
        JSON.parse(vote.rawJson),
        {parentResource: 'votacoes', parentId: voteSessionId},
      ),
    ),
  );
  return validVotes.length;
};

const upsertVoteOrientations = async (voteSessionId: string, orientations: RawItem[]) => {
  for (const orientation of orientations) {
    const siglaBancada =
      textOrNull(orientation.siglaBancada) ??
      textOrNull(orientation.siglaPartido) ??
      textOrNull(orientation.bancada);
    if (!siglaBancada) continue;

    await pool.query(
      `
      INSERT INTO camara_votacoes_orientacoes (votacao_id, sigla_bancada, orientacao, raw_json)
      VALUES ($1, $2, $3, $4::jsonb)
      ON CONFLICT (votacao_id, sigla_bancada) DO UPDATE SET
        orientacao = EXCLUDED.orientacao,
        raw_json = EXCLUDED.raw_json
      `,
      [
        voteSessionId,
        siglaBancada,
        textOrNull(orientation.orientacao) ?? textOrNull(orientation.voto),
        JSON.stringify(orientation),
      ],
    );
    await upsertRawItem(
      'votacoes_orientacoes',
      `${voteSessionId}:${siglaBancada}`,
      `/votacoes/${voteSessionId}/orientacoes`,
      orientation,
      {parentResource: 'votacoes', parentId: voteSessionId},
    );
  }

  return orientations.length;
};

const ingestVoteWindow = async (start: string, end: string, checkpointId?: string) => {
  const voteSessions = await fetchPaged<VoteSession>('/votacoes', {
    dataInicio: start,
    dataFim: end,
  });

  let count = 0;
  let processed = 0;
  let voteRows = 0;
  let orientationRows = 0;
  await mapConcurrent(voteSessions, 4, async (voteSession) => {
    await upsertVoteSession(voteSession);
    const votes = await fetchList<DeputyVote>(
      `/votacoes/${voteSession.id}/votos`,
      {},
      {ignoreBadRequest: true},
    );
    const orientations = await fetchList<RawItem>(
      `/votacoes/${voteSession.id}/orientacoes`,
      {},
      {ignoreBadRequest: true},
    );
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
  await pool.query(
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
  await pool.query(
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
  await pool.query(
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
  await pool.query(
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
  await pool.query(
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
      await pool.query(
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
  await pool.query(
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
  await pool.query(
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
    await pool.query(
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
    await pool.query(
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
    await pool.query(
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
    await pool.query(
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
  dataset: Dataset,
  path: string,
  params: Record<string, string | number>,
  upsert: (item: RawItem) => Promise<number>,
) => {
  const items = await fetchPaged<RawItem>(path, params, {ignoreBadRequest: true});
  let count = 0;
  for (const item of items) {
    count += await upsert(item);
  }
  writeLog('log', `[resource] ${dataset} ${path}: ${items.length} itens`);
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
    } catch {
      item = summary;
    }
    count += await upsertParty(item);
    await sleep(150);
  });
  return count;
};

const ingestProposalsWindow = async (start: string, end: string, checkpointId?: string) => {
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
    } catch {
      item = summary;
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
        await pool.query(
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
  }) => Promise<number>,
) => {
  const worker = async () => {
    for (;;) {
      const checkpoint = await claimCheckpoint(dataset, options.maxAttempts);
      if (!checkpoint) return;

      try {
        writeLog(
          'log',
          `[start] ${dataset} ${checkpoint.entity_id} ${checkpoint.period_start}..${checkpoint.period_end}`,
        );
        const itemsCount = await handler(checkpoint);
        await finishCheckpoint(checkpoint.id, 'done', itemsCount, null);
        writeLog(
          'log',
          `[${itemsCount > 0 ? 'ok-items' : 'ok-zero'}] ${dataset} ${checkpoint.entity_id} ${checkpoint.period_start}..${checkpoint.period_end}: ${itemsCount}`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await finishCheckpoint(checkpoint.id, 'failed', 0, message);
        writeLog(
          'warn',
          `[retry] ${dataset} ${checkpoint.entity_id} ${checkpoint.period_start}..${checkpoint.period_end}: ${message}`,
        );
      }

      await sleep(options.minDelayMs);
    }
  };

  await Promise.all(Array.from({length: options.concurrency}, worker));
};

const seedExpenseCheckpoints = async (options: CliOptions) => {
  const politicoIds = await getPoliticoIdsForRange(options.from, options.to);
  const windows = buildWindows(options.from, options.to, 'month');
  for (const politicoId of politicoIds) {
    for (const window of windows) {
      await seedCheckpoint(
        'despesas',
        politicoId,
        window.start,
        window.end,
        options.resetFailed,
        options.resetCancelled,
        options.resetEmpty,
      );
    }
  }
  writeLog('log', `[seed] despesas: ${politicoIds.length * windows.length} tarefas`);
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
  await ensureCheckpointTable();
  await releaseStaleCheckpoints(options.staleMinutes);

  writeLog(
    'log',
    `[agent] periodo=${options.from}..${options.to} datasets=${options.datasets.join(',')} janela=${options.window} concorrencia=${options.concurrency}`,
  );

  if (options.dryRun) {
    writeLog('log', '[dry-run] nenhum dado sera gravado');
    return;
  }

  if (options.datasets.includes('deputados')) {
    await seedDeputyCheckpoints(options);
    await runCheckpointWorkers('deputados', options, async (checkpoint) =>
      ingestDeputiesForLegislature(Number(checkpoint.entity_id)),
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
      );
    });
  }

  if (options.datasets.includes('votacoes')) {
    await seedVoteCheckpoints(options);
    await runCheckpointWorkers('votacoes', options, async (checkpoint) =>
      ingestVoteWindow(checkpoint.period_start, checkpoint.period_end, checkpoint.id),
    );
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

  if (options.datasets.includes('proposicoes')) {
    await seedWindowCheckpoints('proposicoes', options);
    await runCheckpointWorkers('proposicoes', options, async (checkpoint) =>
      ingestProposalsWindow(checkpoint.period_start, checkpoint.period_end, checkpoint.id),
    );
  }

  if (options.datasets.includes('referencias')) {
    await seedSingleCheckpoint('referencias', options);
    await runCheckpointWorkers('referencias', options, async () => ingestReferences());
  }
};

run()
  .catch((error) => {
    writeLog('error', error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
