import express, {type Request, type Response} from 'express';
import {Pool} from 'pg';

const app = express();
app.disable('x-powered-by');
app.use(express.json({limit: '1mb'}));

const pool = new Pool({
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

app.get('/api/politicos/novos', async (req, res) => {
  try {
    const limit = parseLimit(req);
    const result = await pool.query(
      `
      SELECT
        p.id::text AS id,
        p.nome,
        p.sigla_partido AS partido,
        p.sigla_uf AS estado,
        p.url_foto AS foto,
        COALESCE(AVG(a.nota), 0)::double precision AS "notaMedia",
        COUNT(a.id)::int AS "totalAvaliacoes",
        p.atualizado_em AS "atualizadoEm",
        'Deputado Federal'::text AS cargo
      FROM politicos p
      LEFT JOIN avaliacoes a ON a.politico_id = p.id
      WHERE p.ativo IS DISTINCT FROM false
      GROUP BY p.id, p.nome, p.sigla_partido, p.sigla_uf, p.url_foto, p.atualizado_em
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
      WHERE p.ativo IS DISTINCT FROM false
      GROUP BY
        p.id,
        p.nome,
        p.sigla_partido,
        p.sigla_uf,
        p.url_foto,
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

app.get('/api/politicos', async (req, res) => {
  try {
    const limit = parseLimit(req);
    const offset = parseOffset(req);
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

    const where: string[] = ['p.ativo IS DISTINCT FROM false'];
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
        COALESCE(AVG(a.nota), 0)::double precision AS "notaMedia",
        COUNT(a.id)::int AS "totalAvaliacoes",
        p.atualizado_em AS "atualizadoEm",
        'Deputado Federal'::text AS cargo
      FROM politicos p
      LEFT JOIN avaliacoes a ON a.politico_id = p.id
      WHERE ${where.join(' AND ')}
      GROUP BY p.id, p.nome, p.sigla_partido, p.sigla_uf, p.url_foto, p.atualizado_em
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
        COALESCE(AVG(a.nota), 0)::double precision AS "notaMedia",
        COUNT(a.id)::int AS "totalAvaliacoes",
        p.atualizado_em AS "atualizadoEm",
        'Deputado Federal'::text AS cargo
      FROM politicos p
      LEFT JOIN avaliacoes a ON a.politico_id = p.id
      WHERE p.id::text = $1
      GROUP BY p.id, p.nome, p.sigla_partido, p.sigla_uf, p.url_foto, p.atualizado_em
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
