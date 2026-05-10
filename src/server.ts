import 'dotenv/config';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
import express, {type Request, type Response} from 'express';
import {Pool} from 'pg';

const app = express();
app.disable('x-powered-by');
app.use(express.json({limit: '1mb'}));

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

let isStartingIngestion = false;

const sendJson = (res: Response, statusCode: number, body: unknown) => {
  res.status(statusCode).json(body);
};

const parseLimit = (req: Request) => {
  const raw = typeof req.query.limit === 'string' ? req.query.limit : undefined;
  const num = raw != null && raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : 20;
  return Math.max(1, Math.min(2000, num));
};

const parseOffset = (req: Request) => {
  const raw = typeof req.query.offset === 'string' ? req.query.offset : undefined;
  const num = raw != null && raw !== '' && Number.isFinite(Number(raw)) ? Number(raw) : 0;
  return Math.max(0, num);
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

const normalizeCpf = (value: unknown) => {
  if (typeof value !== 'string') return '';
  return value.replace(/\D/g, '').slice(0, 11);
};

const calculateCpfCheckDigit = (baseDigits: string) => {
  let sum = 0;
  const startWeight = baseDigits.length + 1;

  for (let index = 0; index < baseDigits.length; index += 1) {
    sum += Number(baseDigits[index]) * (startWeight - index);
  }

  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
};

const isValidCpf = (cpf: string) => {
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const firstDigit = calculateCpfCheckDigit(cpf.slice(0, 9));
  const secondDigit = calculateCpfCheckDigit(cpf.slice(0, 10));

  return firstDigit === Number(cpf[9]) && secondDigit === Number(cpf[10]);
};

const parseNota = (value: unknown) => {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;

  if (!Number.isInteger(parsed)) return null;
  if (parsed < 1 || parsed > 5) return null;
  return parsed;
};

const parseComentario = (value: unknown) => {
  if (value == null) {
    return {comentario: null, error: null};
  }

  if (typeof value !== 'string') {
    return {comentario: null, error: 'O comentario informado e invalido.'};
  }

  const comentario = value.trim();

  if (comentario.length === 0) {
    return {comentario: null, error: null};
  }

  if (comentario.length > 500) {
    return {comentario: null, error: 'O comentario deve ter no maximo 500 caracteres.'};
  }

  return {comentario, error: null};
};

const hashCpf = (cpf: string) => createHash('sha256').update(cpf).digest('hex');

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

const ensureIngestionCheckpointTable = async () => {
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
  retries: 0,
  skips: 0,
  httpRetries: 0,
  httpStatus: {} as Record<string, number>,
  lastActivityAt: null as string | null,
  lastHttpError: null as string | null,
});

const parseIngestionLogStats = (content: string) => {
  const stats = emptyLogStats();
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  stats.totalLines = lines.length;

  for (const line of lines) {
    if (line.includes('[start]')) stats.starts += 1;
    if (line.includes('[ok-items]')) stats.okItems += 1;
    if (line.includes('[ok-zero]')) stats.okZero += 1;
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

  return stats;
};

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
    const limit = parseLimit(req);
    const metricParam = typeof req.query.metric === 'string' ? req.query.metric : undefined;
    const directionParam = typeof req.query.direction === 'string' ? req.query.direction : undefined;
    const filterParam = typeof req.query.filter === 'string' ? req.query.filter : undefined;
    const status = parsePoliticoStatusFilter(req);
    const statusWhere = buildPoliticoStatusWhereSql(status);

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
      ORDER BY ${orderBy}
      LIMIT $1
      `,
      [limit],
    );

    sendJson(res, 200, {items: result.rows});
  } catch {
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

    const result = await pool.query(
      `
      SELECT
        p.sigla_partido AS partido,
        COALESCE(SUM(d.valor_liquido), 0)::double precision AS "totalDespesas",
        COUNT(DISTINCT p.id)::int AS "totalPoliticos"
      FROM politicos p
      LEFT JOIN despesas d ON d.politico_id = p.id
      WHERE ${statusWhere}
        AND p.sigla_partido IS NOT NULL
        AND p.sigla_partido <> ''
      GROUP BY p.sigla_partido
      ORDER BY "totalDespesas" ${dirSql}, partido ASC
      LIMIT $1
      `,
      [limit],
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
      WHERE p.id::text = $1
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
        WHERE proposicao_id::text = $1
        ORDER BY ordem_assinatura ASC NULLS LAST, nome ASC
        `,
        [id],
      ),
      pool.query(
        `
        SELECT tema, relevancia
        FROM camara_proposicoes_temas
        WHERE proposicao_id::text = $1
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
        WHERE proposicao_id::text = $1
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
        WHERE r.proposicao_id::text = $1
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
      WHERE d.politico_id::text = $1
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
      WHERE de.politico_id::text = $1
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
      WHERE df.politico_id::text = $1
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
        WHERE politico_id::text = $1
        ORDER BY titulo ASC
        `,
        [politicoId],
      ),
      pool.query(
        `
        SELECT titulo, entidade, entidade_uf AS "entidadeUf", entidade_pais AS "entidadePais", ano_inicio AS "anoInicio", ano_fim AS "anoFim"
        FROM camara_deputados_ocupacoes
        WHERE politico_id::text = $1
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
        WHERE d.politico_id::text = $1
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
        WHERE de.politico_id::text = $1
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
        WHERE df.politico_id::text = $1
        ORDER BY f.id_legislatura DESC NULLS LAST, f.titulo ASC
        LIMIT 80
        `,
        [politicoId],
      ),
      Promise.all([
        pool.query('SELECT titulo, data_hora AS "dataHora" FROM camara_deputados_profissoes WHERE politico_id::text = $1 ORDER BY titulo ASC', [politicoId]),
        pool.query('SELECT titulo, entidade, entidade_uf AS "entidadeUf", entidade_pais AS "entidadePais", ano_inicio AS "anoInicio", ano_fim AS "anoFim" FROM camara_deputados_ocupacoes WHERE politico_id::text = $1 ORDER BY ano_fim DESC NULLS FIRST, ano_inicio DESC NULLS LAST, titulo ASC', [politicoId]),
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
        WHERE vd.politico_id::text = $1
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
      WHERE p.id::text = $1
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

app.post('/api/politicos/:politicoId/avaliacoes', async (req, res) => {
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
      WHERE p.id::text = $1
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
      WHERE a.politico_id::text = $1
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
      WHERE a.politico_id::text = $1
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
      WHERE vd.politico_id::text = $1
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
    const limit = parseLimit(req);
    const offset = parseOffset(req);
    const ano = parseOptionalInt(req.query.ano);

    const where: string[] = ['vd.politico_id::text = $1'];
    const params: Array<string | number> = [politicoId];

    if (ano != null) {
      params.push(ano);
      where.push(`v.ano = $${params.length}`);
    }

    params.push(limit);
    params.push(offset);

    const result = await pool.query(
      `
      SELECT
        vd.id::text AS "votoId",
        vd.politico_id::text AS "politicoId",
        v.id::text AS "votacaoId",
        v.sigla_tipo AS "siglaTipo",
        v.numero,
        v.ano,
        v.ementa,
        v.data_hora_votacao AS "dataVotacao",
        vd.voto
      FROM votos_deputados vd
      JOIN votacoes v ON v.id = vd.votacao_id
      WHERE ${where.join(' AND ')}
      ORDER BY v.data_hora_votacao DESC NULLS LAST
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

app.get('/api/politicos/:politicoId/despesas/anos', async (req, res) => {
  try {
    const {politicoId} = req.params;
    const result = await pool.query(
      `
      SELECT DISTINCT d.ano
      FROM despesas d
      WHERE d.politico_id::text = $1
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
    const {politicoId} = req.params;
    const limit = parseLimit(req);
    const offset = parseOffset(req);
    const ano = parseOptionalInt(req.query.ano);
    const mes = parseOptionalInt(req.query.mes);

    const where: string[] = ['d.politico_id::text = $1'];
    const params: Array<string | number> = [politicoId];

    if (ano != null) {
      params.push(ano);
      where.push(`d.ano = $${params.length}`);
    }

    if (mes != null) {
      params.push(mes);
      where.push(`d.mes = $${params.length}`);
    }

    params.push(limit);
    params.push(offset);

    const result = await pool.query(
      `
      SELECT
        d.id::text AS id,
        d.ano,
        d.mes,
        d.tipo_despesa AS tipo,
        d.valor_liquido::double precision AS valor,
        d.url_documento AS "urlDocumento",
        d.nome_fornecedor AS fornecedor
      FROM despesas d
      WHERE ${where.join(' AND ')}
      ORDER BY d.ano DESC, d.mes DESC
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

app.get('/api/politicos/:politicoId/despesas/resumo', async (req, res) => {
  try {
    const {politicoId} = req.params;
    const ano = parseOptionalInt(req.query.ano);

    const where: string[] = ['d.politico_id::text = $1'];
    const params: Array<string | number> = [politicoId];

    if (ano != null) {
      params.push(ano);
      where.push(`d.ano = $${params.length}`);
    }

    const result = await pool.query(
      `
      SELECT
        d.ano,
        d.mes,
        SUM(d.valor_liquido)::double precision AS total
      FROM despesas d
      WHERE ${where.join(' AND ')}
      GROUP BY d.ano, d.mes
      ORDER BY d.ano ASC, d.mes ASC
      `,
      params,
    );

    sendJson(res, 200, {items: result.rows});
  } catch {
    sendJson(res, 500, {error: 'Erro ao processar requisição'});
  }
});

app.get('/api/despesas/media', async (req, res) => {
  try {
    const ano = parseOptionalInt(req.query.ano);

    const where: string[] = [];
    const params: Array<string | number> = [];

    if (ano != null) {
      params.push(ano);
      where.push(`d.ano = $${params.length}`);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const result = await pool.query(
      `
      SELECT
        sub.ano,
        sub.mes,
        AVG(sub.total_mes)::double precision AS media
      FROM (
        SELECT politico_id, ano, mes, SUM(valor_liquido) AS total_mes
        FROM despesas d
        ${whereClause}
        GROUP BY politico_id, ano, mes
      ) sub
      GROUP BY sub.ano, sub.mes
      ORDER BY sub.ano ASC, sub.mes ASC
      `,
      params,
    );

    sendJson(res, 200, {items: result.rows});
  } catch {
    sendJson(res, 500, {error: 'Erro ao processar requisição'});
  }
});

app.get('/api/admin/ingestion/summary', async (_req, res) => {
  try {
    await ensureIngestionCheckpointTable();
    await releaseStaleIngestionCheckpoints();

    const checkpointResult = await pool.query(
      `
      SELECT
        dataset,
        status,
        MIN(period_start)::text AS "periodStart",
        MAX(period_end)::text AS "periodEnd",
        COUNT(*)::int AS total,
        SUM(items_count)::int AS "itemsCount",
        MAX(updated_at)::text AS "updatedAt"
      FROM ingestion_checkpoints
      WHERE source = 'camara'
        AND status <> 'cancelled'
        AND NOT (status = 'done' AND items_count = 0)
      GROUP BY dataset, status
      ORDER BY dataset ASC, status ASC
      `,
    );

    const periodResult = await pool.query(
      `
      WITH despesas_periodos AS (
        SELECT
          'despesas'::text AS dataset,
          make_date(ano::int, mes::int, 1) AS period_start,
          (make_date(ano::int, mes::int, 1) + INTERVAL '1 month - 1 day')::date AS period_end,
          COUNT(*)::int AS total
        FROM despesas
        GROUP BY ano, mes
      ),
      votacoes_periodos AS (
        SELECT
          'votacoes'::text AS dataset,
          date_trunc('month', data_hora_votacao)::date AS period_start,
          (date_trunc('month', data_hora_votacao)::date + INTERVAL '1 month - 1 day')::date AS period_end,
          COUNT(*)::int AS total
        FROM votacoes
        WHERE data_hora_votacao IS NOT NULL
        GROUP BY date_trunc('month', data_hora_votacao)::date
      )
      SELECT dataset, period_start::text AS "periodStart", period_end::text AS "periodEnd", total
      FROM despesas_periodos
      UNION ALL
      SELECT dataset, period_start::text AS "periodStart", period_end::text AS "periodEnd", total
      FROM votacoes_periodos
      ORDER BY dataset ASC, "periodStart" DESC
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
    const logsDir = join(process.cwd(), 'logs');
    if (!existsSync(logsDir)) {
      sendJson(res, 200, {log: '', file: null});
      return;
    }

    const files = readdirSync(logsDir)
      .filter((file) => file.startsWith('ingest-') && file.endsWith('.log'))
      .map((file) => {
        const path = join(logsDir, file);
        return {file, path, mtimeMs: statSync(path).mtimeMs};
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    const latest = files[0];
    if (!latest) {
      sendJson(res, 200, {log: '', file: null});
      return;
    }

    const content = readFileSync(latest.path, 'utf8');
    const stats = parseIngestionLogStats(content);
    sendJson(res, 200, {
      file: latest.file,
      log: content.slice(-12000),
      stats,
    });
  } catch {
    sendJson(res, 500, {error: 'Erro ao carregar logs de ingestao.'});
  }
});

app.post('/api/admin/ingestion/run', async (req, res) => {
  try {
    await ensureIngestionCheckpointTable();
    await releaseStaleIngestionCheckpoints();

    if (isStartingIngestion) {
      sendJson(res, 409, {error: 'Uma ingestao ja esta sendo inicializada. Aguarde alguns segundos.'});
      return;
    }

    const from = parseIsoDateInput(req.body?.from, '2016-01-01');
    const to = parseIsoDateInput(req.body?.to, '2020-12-31');
    const datasets = parseDatasetList(req.body?.datasets);
    const window = ['month', 'quarter', 'year'].includes(req.body?.window)
      ? String(req.body.window)
      : 'month';
    const concurrency = Math.max(1, Math.min(10, Number(req.body?.concurrency) || 4));

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

    isStartingIngestion = true;
    setTimeout(() => {
      isStartingIngestion = false;
    }, 10000).unref();

    const logsDir = join(process.cwd(), 'logs');
    mkdirSync(logsDir, {recursive: true});
    const logPath = join(logsDir, `ingest-${Date.now()}.log`);
    const logStream = createWriteStream(logPath, {flags: 'a'});

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
        '--reset-empty',
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
  }
});

app.post('/api/admin/ingestion/cancel', async (req, res) => {
  try {
    await ensureIngestionCheckpointTable();

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

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    sendJson(res, 404, {error: 'Endpoint não encontrado'});
    return;
  }
  sendJson(res, 404, {error: 'Não encontrado'});
});

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? '0.0.0.0';

app.listen(port, host, () => {
  process.stdout.write(`API escutando em http://${host}:${port}\n`);
});
