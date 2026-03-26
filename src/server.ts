import 'dotenv/config';
import {createHash} from 'node:crypto';
import express, {type Request, type Response} from 'express';
import {Pool} from 'pg';

const app = express();
app.disable('x-powered-by');
app.use(express.json({limit: '1mb'}));

const databaseUrl = process.env.DATABASE_URL?.trim();

const pool = databaseUrl
  ? new Pool({connectionString: databaseUrl})
  : new Pool({
      host: process.env.APP_DB_HOST ?? 'n8n-db',
      port: Number(process.env.APP_DB_PORT ?? 5432),
      user: process.env.APP_DB_USER ?? 'n8n',
      password: process.env.APP_DB_PASSWORD ?? 'n8n',
      database: process.env.APP_DB_NAME ?? 'n8n',
    });

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

const hashCpf = (cpf: string) => createHash('sha256').update(cpf).digest('hex');

app.get('/api/politicos/novos', async (req, res) => {
  try {
    const limit = parseLimit(req);
    const status = parsePoliticoStatusFilter(req);
    const statusWhere = buildPoliticoStatusWhereSql(status);
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
        'Deputado Federal'::text AS cargo
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

app.get('/api/politicos', async (req, res) => {
  try {
    const limit = parseLimit(req);
    const offset = parseOffset(req);
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const status = parsePoliticoStatusFilter(req);

    const where: string[] = [buildPoliticoStatusWhereSql(status)];
    const params: Array<string | number> = [];

    if (search) {
      params.push(`%${search}%`);
      where.push(
        `(p.nome ILIKE $${params.length} OR p.sigla_partido ILIKE $${params.length} OR p.sigla_uf ILIKE $${params.length})`,
      );
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
        'Deputado Federal'::text AS cargo
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
        p.atualizado_em
      ORDER BY p.nome ASC
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
        'Deputado Federal'::text AS cargo
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
        p.atualizado_em
      LIMIT 1
      `,
      [politicoId],
    );

    const politico = result.rows[0];
    if (!politico) {
      sendJson(res, 404, {error: 'Político não encontrado'});
      return;
    }

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

    if (!isValidCpf(cpf)) {
      sendJson(res, 400, {error: 'CPF invalido. Confira os numeros e tente novamente.'});
      return;
    }

    if (nota == null) {
      sendJson(res, 400, {error: 'A nota deve ser um numero inteiro entre 1 e 5.'});
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
      INSERT INTO avaliacoes (politico_id, cpf_hash, nota)
      VALUES ($1::bigint, $2, $3)
      ON CONFLICT (politico_id, cpf_hash)
      DO UPDATE SET
        nota = EXCLUDED.nota,
        data_avaliacao = NOW()
      `,
      [politico.id, cpfHash, nota],
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
