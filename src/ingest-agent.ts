import 'dotenv/config';
import {setTimeout as sleep} from 'node:timers/promises';
import {Pool, type PoolClient} from 'pg';

type Dataset = 'deputados' | 'despesas' | 'votacoes';
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
  nomeCivil?: string;
  cpf?: string;
  dataNascimento?: string;
  sexo?: string;
  escolaridade?: string;
  municipioNascimento?: string;
  ufNascimento?: string;
  ultimoStatus?: {
    nome?: string;
    nomeEleitoral?: string;
    siglaPartido?: string;
    siglaUf?: string;
    idLegislatura?: number;
    situacao?: string;
    condicaoEleitoral?: string;
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
  dataDocumento?: string;
  numDocumento?: string;
  valorDocumento?: number;
  valorGlosa?: number;
  valorLiquido?: number;
  numLote?: number | string;
  numRessarcimento?: number | string;
  parcela?: number;
  urlDocumento?: string;
};

type VoteSession = {
  id: string;
  siglaTipo?: string;
  numero?: number | string;
  ano?: number | string;
  descricao?: string;
  data?: string;
  aprovacao?: number | string;
  resultado?: string;
};

type DeputyVote = {
  tipoVoto?: string;
  deputado_?: {
    id?: number;
  };
};

type LogLevel = 'log' | 'warn' | 'error';

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
const MAX_HTTP_ATTEMPTS = 5;
const MAX_PAGES_PER_REQUEST = 200;

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

const parseArgs = (): CliOptions => {
  const args = process.argv.slice(2);
  const get = (name: string, fallback?: string) => {
    const prefix = `--${name}=`;
    const inline = args.find((arg) => arg.startsWith(prefix));
    if (inline) return inline.slice(prefix.length);
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : fallback;
  };

  const datasets = (get('datasets', 'deputados,despesas,votacoes') ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean) as Dataset[];

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
  options: {ignoreBadRequest?: boolean} = {},
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
        writeLog('warn', `[skip] API retornou 400 para recurso opcional: ${url.toString()}`);
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
        WHEN $7::boolean AND ingestion_checkpoints.status = 'done' AND ingestion_checkpoints.items_count = 0 THEN 0
        ELSE ingestion_checkpoints.attempts
      END,
      last_error = CASE
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
};

const upsertVotes = async (voteSessionId: string, votes: DeputyVote[]) => {
  const validVotes = votes
    .map((vote) => ({
      politicoId: vote.deputado_?.id,
      voteType: textOrNull(vote.tipoVoto),
    }))
    .filter((vote): vote is {politicoId: number; voteType: string} =>
      Boolean(vote.politicoId && vote.voteType),
    );

  if (validVotes.length === 0) return 0;

  const values: Array<string | number> = [];
  const placeholders = validVotes.map((vote, index) => {
    const offset = index * 3;
    values.push(voteSessionId, vote.politicoId, vote.voteType);
    return `($${offset + 1}, $${offset + 2}, $${offset + 3})`;
  });

  await pool.query(
    `
    INSERT INTO votos_deputados (votacao_id, politico_id, voto)
    VALUES ${placeholders.join(', ')}
    ON CONFLICT (votacao_id, politico_id) DO UPDATE SET voto = EXCLUDED.voto
    `,
    values,
  );
  return validVotes.length;
};

const ingestVoteWindow = async (start: string, end: string) => {
  const voteSessions = await fetchPaged<VoteSession>('/votacoes', {
    dataInicio: start,
    dataFim: end,
  });

  let count = 0;
  await mapConcurrent(voteSessions, 4, async (voteSession) => {
    await upsertVoteSession(voteSession);
    const votes = await fetchPaged<DeputyVote>(
      `/votacoes/${voteSession.id}/votos`,
      {},
      {ignoreBadRequest: true},
    );
    count += await upsertVotes(voteSession.id, votes);
    await sleep(250);
  });

  return count + voteSessions.length;
};

const runCheckpointWorkers = async (
  dataset: Dataset,
  options: CliOptions,
  handler: (checkpoint: {entity_id: string; period_start: string; period_end: string}) => Promise<number>,
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
      ingestVoteWindow(checkpoint.period_start, checkpoint.period_end),
    );
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
