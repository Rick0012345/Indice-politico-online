import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv, type PluginOption} from 'vite';
import {Pool} from 'pg';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  const usePolling =
    env.VITE_USE_POLLING === 'true' || process.env.CHOKIDAR_USEPOLLING === 'true';
  const pollingInterval = Number(env.CHOKIDAR_INTERVAL ?? 100);
  const apiProxyTarget = env.VITE_API_PROXY_TARGET?.trim() || '';
  const useLocalApi = apiProxyTarget.length === 0;

  const pool = useLocalApi
    ? new Pool({
        host: process.env.APP_DB_HOST ?? 'db',
        port: Number(process.env.APP_DB_PORT ?? 5432),
        user: process.env.APP_DB_USER ?? 'app',
        password: process.env.APP_DB_PASSWORD ?? 'app',
        database: process.env.APP_DB_NAME ?? 'app',
      })
    : null;

  const plugins: PluginOption[] = [react(), tailwindcss()];
  if (useLocalApi) {
    plugins.push({
      name: 'local-api',
      configureServer(server) {
        const sendJson = (res: any, statusCode: number, body: unknown) => {
          res.statusCode = statusCode;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(body));
        };

        server.middlewares.use(async (req, res, next) => {
          if (!req.url) {
            next();
            return;
          }

          const url = new URL(req.url, 'http://localhost');
          if (!url.pathname.startsWith('/api/')) {
            next();
            return;
          }

          try {
            if (req.method !== 'GET') {
              sendJson(res, 405, {error: 'Método não permitido'});
              return;
            }

            const limitRaw = url.searchParams.get('limit');
            const limit = Math.max(
              1,
              Math.min(2000, Number.isFinite(Number(limitRaw)) ? Number(limitRaw) : 20),
            );

            const offsetRaw = url.searchParams.get('offset');
            const offset = Math.max(0, Number.isFinite(Number(offsetRaw)) ? Number(offsetRaw) : 0);

            if (url.pathname === '/api/politicos/novos') {
              const result = await pool!.query(
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
              return;
            }

            if (url.pathname === '/api/politicos/ranking') {
              const metricParam = url.searchParams.get('metric');
              const directionParam = url.searchParams.get('direction');
              const filter = url.searchParams.get('filter');

              const metric =
                metricParam === 'despesas' || metricParam === 'votacoes' || metricParam === 'nota'
                  ? metricParam
                  : 'nota';

              const direction =
                directionParam === 'asc' || directionParam === 'desc'
                  ? directionParam
                  : filter === 'worst'
                    ? 'asc'
                    : 'desc';

              const dirSql = direction === 'asc' ? 'ASC' : 'DESC';

              const orderBy =
                metric === 'despesas'
                  ? `"totalDespesas" ${dirSql}, "notaMedia" DESC, "totalAvaliacoes" DESC, "atualizadoEm" DESC`
                  : metric === 'votacoes'
                    ? `"totalVotacoes" ${dirSql}, "notaMedia" DESC, "totalAvaliacoes" DESC, "atualizadoEm" DESC`
                    : `"notaMedia" ${dirSql}, "totalAvaliacoes" DESC, "atualizadoEm" DESC`;

              const result = await pool!.query(
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
              return;
            }

            if (url.pathname === '/api/partidos/gastos') {
              const directionParam = url.searchParams.get('direction');
              const direction =
                directionParam === 'asc' || directionParam === 'desc' ? directionParam : 'desc';
              const dirSql = direction === 'asc' ? 'ASC' : 'DESC';

              const result = await pool!.query(
                `
                SELECT
                  p.sigla_partido AS partido,
                  COALESCE(SUM(d.valor_liquido), 0)::double precision AS "totalDespesas",
                  COUNT(DISTINCT p.id)::int AS "totalPoliticos"
                FROM politicos p
                LEFT JOIN despesas d ON d.politico_id = p.id
                WHERE p.ativo IS DISTINCT FROM false
                  AND p.sigla_partido IS NOT NULL
                  AND p.sigla_partido <> ''
                GROUP BY p.sigla_partido
                ORDER BY "totalDespesas" ${dirSql}, partido ASC
                LIMIT $1
                `,
                [limit],
              );

              sendJson(res, 200, {items: result.rows});
              return;
            }

            if (url.pathname === '/api/partidos') {
              const search = (url.searchParams.get('search') ?? '').trim();
              const sortParam = url.searchParams.get('sort') ?? '';
              const directionParam = url.searchParams.get('direction');
              const statusParam = url.searchParams.get('status');
              const direction =
                directionParam === 'asc' || directionParam === 'desc' ? directionParam : 'asc';
              const dirSql = direction === 'desc' ? 'DESC' : 'ASC';
              const statusWhere =
                statusParam === 'todos'
                  ? '1 = 1'
                  : statusParam === 'inativo'
                    ? 'p.ativo = false'
                    : 'p.ativo IS DISTINCT FROM false';

              const params: Array<string | number> = [];
              const where: string[] = [];

              if (search) {
                params.push(`%${search}%`);
                where.push(
                  `(COALESCE(c.sigla, agg.partido) ILIKE $${params.length} OR c.nome ILIKE $${params.length})`,
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

              const result = await pool!.query(
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
              return;
            }

            const partidoPoliticosMatch = url.pathname.match(/^\/api\/partidos\/([^/]+)\/politicos$/);
            if (partidoPoliticosMatch) {
              const sigla = decodeURIComponent(partidoPoliticosMatch[1]).trim();
              const statusParam = url.searchParams.get('status');
              const statusWhere =
                statusParam === 'todos'
                  ? '1 = 1'
                  : statusParam === 'inativo'
                    ? 'p.ativo = false'
                    : 'p.ativo IS DISTINCT FROM false';

              if (!sigla) {
                sendJson(res, 400, {error: 'Partido invalido'});
                return;
              }

              const result = await pool!.query(
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
              return;
            }

            if (url.pathname === '/api/camara/proposicoes') {
              const search = (url.searchParams.get('search') ?? '').trim();
              const tipo = (url.searchParams.get('tipo') ?? '').trim();
              const anoRaw = url.searchParams.get('ano');
              const ano = anoRaw && Number.isFinite(Number(anoRaw)) ? Number(anoRaw) : null;
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

              params.push(limit, offset);
              const result = await pool!.query(
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
                LEFT JOIN (SELECT proposicao_id, COUNT(*)::int AS total FROM camara_proposicoes_temas GROUP BY proposicao_id) tema ON tema.proposicao_id = p.id
                LEFT JOIN (SELECT proposicao_id, COUNT(*)::int AS total FROM camara_proposicoes_autores GROUP BY proposicao_id) autor ON autor.proposicao_id = p.id
                LEFT JOIN (SELECT proposicao_id, COUNT(*)::int AS total FROM camara_proposicoes_tramitacoes GROUP BY proposicao_id) tram ON tram.proposicao_id = p.id
                ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
                ORDER BY p.data_apresentacao DESC NULLS LAST, p.ano DESC NULLS LAST, p.id DESC
                LIMIT $${params.length - 1}
                OFFSET $${params.length}
                `,
                params,
              );
              sendJson(res, 200, {items: result.rows});
              return;
            }

            const camaraProposicaoMatch = url.pathname.match(/^\/api\/camara\/proposicoes\/([^/]+)$/);
            if (camaraProposicaoMatch) {
              const id = decodeURIComponent(camaraProposicaoMatch[1]);
              const proposicaoResult = await pool!.query(
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
                  COALESCE(p.status_proposicao_json->>'descricaoSituacao', p.status_proposicao_json->>'situacao') AS situacao
                FROM camara_proposicoes p
                WHERE p.id::text = $1
                LIMIT 1
                `,
                [id],
              );
              const proposicao = proposicaoResult.rows[0];
              if (!proposicao) {
                sendJson(res, 404, {error: 'Proposicao nao encontrada'});
                return;
              }
              const [autores, temas, tramitacoes, relacionadas] = await Promise.all([
                pool!.query('SELECT nome, tipo, ordem_assinatura AS "ordemAssinatura", proponente FROM camara_proposicoes_autores WHERE proposicao_id::text = $1 ORDER BY ordem_assinatura ASC NULLS LAST, nome ASC', [id]),
                pool!.query('SELECT tema, relevancia FROM camara_proposicoes_temas WHERE proposicao_id::text = $1 ORDER BY relevancia DESC NULLS LAST, tema ASC', [id]),
                pool!.query('SELECT sequencia, data_hora AS "dataHora", sigla_orgao AS "siglaOrgao", regime, descricao_tramitacao AS "descricaoTramitacao", descricao_situacao AS "descricaoSituacao", despacho, url FROM camara_proposicoes_tramitacoes WHERE proposicao_id::text = $1 ORDER BY sequencia DESC LIMIT 80', [id]),
                pool!.query('SELECT r.relacionada_id::text AS id, p.sigla_tipo AS "siglaTipo", p.numero, p.ano, p.ementa FROM camara_proposicoes_relacionadas r LEFT JOIN camara_proposicoes p ON p.id = r.relacionada_id WHERE r.proposicao_id::text = $1 ORDER BY p.ano DESC NULLS LAST, p.numero DESC NULLS LAST LIMIT 40', [id]),
              ]);
              sendJson(res, 200, {proposicao, autores: autores.rows, temas: temas.rows, tramitacoes: tramitacoes.rows, relacionadas: relacionadas.rows});
              return;
            }

            if (url.pathname === '/api/camara/eventos') {
              const search = (url.searchParams.get('search') ?? '').trim();
              const tipo = (url.searchParams.get('tipo') ?? '').trim();
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
              params.push(limit, offset);
              const result = await pool!.query(
                `
                SELECT e.id::text AS id, e.data_hora_inicio AS "dataHoraInicio", e.data_hora_fim AS "dataHoraFim", e.situacao, e.descricao_tipo AS "descricaoTipo", e.descricao, e.local_externo AS "localExterno", e.local_camara_json AS "localCamara", e.orgaos_json AS orgaos, e.url_registro AS "urlRegistro"
                FROM camara_eventos e
                ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
                ORDER BY e.data_hora_inicio DESC NULLS LAST, e.id DESC
                LIMIT $${params.length - 1}
                OFFSET $${params.length}
                `,
                params,
              );
              sendJson(res, 200, {items: result.rows});
              return;
            }

            if (url.pathname === '/api/camara/orgaos') {
              const search = (url.searchParams.get('search') ?? '').trim();
              const tipo = (url.searchParams.get('tipo') ?? '').trim();
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
              params.push(limit, offset);
              const result = await pool!.query(
                `
                SELECT o.id::text AS id, o.sigla, o.nome, o.apelido, o.tipo_orgao AS "tipoOrgao", o.nome_publicacao AS "nomePublicacao", o.nome_resumido AS "nomeResumido"
                FROM camara_orgaos o
                ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
                ORDER BY o.sigla ASC NULLS LAST, o.nome ASC
                LIMIT $${params.length - 1}
                OFFSET $${params.length}
                `,
                params,
              );
              sendJson(res, 200, {items: result.rows});
              return;
            }

            if (url.pathname === '/api/camara/frentes') {
              const search = (url.searchParams.get('search') ?? '').trim();
              const legislaturaRaw = url.searchParams.get('legislatura');
              const legislatura = legislaturaRaw && Number.isFinite(Number(legislaturaRaw)) ? Number(legislaturaRaw) : null;
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
              params.push(limit, offset);
              const result = await pool!.query(
                `
                SELECT f.id::text AS id, f.titulo, f.id_legislatura AS "idLegislatura", f.uri
                FROM camara_frentes f
                ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
                ORDER BY f.id_legislatura DESC NULLS LAST, f.titulo ASC
                LIMIT $${params.length - 1}
                OFFSET $${params.length}
                `,
                params,
              );
              sendJson(res, 200, {items: result.rows});
              return;
            }

            const politicoAtuacaoMatch = url.pathname.match(/^\/api\/politicos\/([^/]+)\/atuacao$/);
            if (politicoAtuacaoMatch) {
              const politicoId = decodeURIComponent(politicoAtuacaoMatch[1]);
              const [orgaos, eventos, frentes, profissoes, ocupacoes, proposicoes] = await Promise.all([
                pool!.query('SELECT d.orgao_id::text AS "orgaoId", d.sigla_orgao AS "siglaOrgao", d.nome_orgao AS "nomeOrgao", d.nome_publicacao AS "nomePublicacao", d.titulo, d.data_inicio AS "dataInicio", d.data_fim AS "dataFim", o.tipo_orgao AS "tipoOrgao" FROM camara_deputados_orgaos d LEFT JOIN camara_orgaos o ON o.id = d.orgao_id WHERE d.politico_id::text = $1 ORDER BY d.data_fim DESC NULLS FIRST, d.data_inicio DESC NULLS LAST LIMIT 80', [politicoId]),
                pool!.query('SELECT e.id::text AS id, e.data_hora_inicio AS "dataHoraInicio", e.situacao, e.descricao_tipo AS "descricaoTipo", e.descricao, e.local_externo AS "localExterno", e.local_camara_json AS "localCamara", e.url_registro AS "urlRegistro" FROM camara_deputados_eventos de JOIN camara_eventos e ON e.id = de.evento_id WHERE de.politico_id::text = $1 ORDER BY e.data_hora_inicio DESC NULLS LAST LIMIT 20', [politicoId]),
                pool!.query('SELECT f.id::text AS id, f.titulo, f.id_legislatura AS "idLegislatura", f.uri FROM camara_deputados_frentes df JOIN camara_frentes f ON f.id = df.frente_id WHERE df.politico_id::text = $1 ORDER BY f.id_legislatura DESC NULLS LAST, f.titulo ASC LIMIT 80', [politicoId]),
                pool!.query('SELECT titulo, data_hora AS "dataHora" FROM camara_deputados_profissoes WHERE politico_id::text = $1 ORDER BY titulo ASC', [politicoId]),
                pool!.query('SELECT titulo, entidade, entidade_uf AS "entidadeUf", entidade_pais AS "entidadePais", ano_inicio AS "anoInicio", ano_fim AS "anoFim" FROM camara_deputados_ocupacoes WHERE politico_id::text = $1 ORDER BY ano_fim DESC NULLS FIRST, ano_inicio DESC NULLS LAST, titulo ASC', [politicoId]),
                pool!.query('SELECT DISTINCT p.id::text AS id, p.sigla_tipo AS "siglaTipo", p.numero, p.ano, p.ementa, p.data_apresentacao AS "dataApresentacao", p.url_inteiro_teor AS "urlInteiroTeor", COALESCE(p.status_proposicao_json->>\'descricaoSituacao\', p.status_proposicao_json->>\'situacao\') AS situacao FROM votos_deputados vd JOIN votacoes v ON v.id = vd.votacao_id JOIN camara_proposicoes p ON p.uri = v.uri_proposicao_objeto OR p.id::text = regexp_replace(COALESCE(v.uri_proposicao_objeto, \'\'), \'^.*/\', \'\') WHERE vd.politico_id::text = $1 ORDER BY p.data_apresentacao DESC NULLS LAST LIMIT 20', [politicoId]),
              ]);
              sendJson(res, 200, {orgaos: orgaos.rows, eventos: eventos.rows, frentes: frentes.rows, profissoes: profissoes.rows, ocupacoes: ocupacoes.rows, proposicoes: proposicoes.rows});
              return;
            }

            const politicoOrgaosMatch = url.pathname.match(/^\/api\/politicos\/([^/]+)\/orgaos$/);
            if (politicoOrgaosMatch) {
              const politicoId = decodeURIComponent(politicoOrgaosMatch[1]);
              const result = await pool!.query('SELECT d.orgao_id::text AS "orgaoId", d.sigla_orgao AS "siglaOrgao", d.nome_orgao AS "nomeOrgao", d.nome_publicacao AS "nomePublicacao", d.titulo, d.data_inicio AS "dataInicio", d.data_fim AS "dataFim", o.tipo_orgao AS "tipoOrgao" FROM camara_deputados_orgaos d LEFT JOIN camara_orgaos o ON o.id = d.orgao_id WHERE d.politico_id::text = $1 ORDER BY d.data_fim DESC NULLS FIRST, d.data_inicio DESC NULLS LAST', [politicoId]);
              sendJson(res, 200, {items: result.rows});
              return;
            }

            const politicoEventosMatch = url.pathname.match(/^\/api\/politicos\/([^/]+)\/eventos$/);
            if (politicoEventosMatch) {
              const politicoId = decodeURIComponent(politicoEventosMatch[1]);
              const result = await pool!.query('SELECT e.id::text AS id, e.data_hora_inicio AS "dataHoraInicio", e.situacao, e.descricao_tipo AS "descricaoTipo", e.descricao, e.local_externo AS "localExterno", e.local_camara_json AS "localCamara", e.orgaos_json AS orgaos, e.url_registro AS "urlRegistro" FROM camara_deputados_eventos de JOIN camara_eventos e ON e.id = de.evento_id WHERE de.politico_id::text = $1 ORDER BY e.data_hora_inicio DESC NULLS LAST LIMIT $2', [politicoId, limit]);
              sendJson(res, 200, {items: result.rows});
              return;
            }

            const politicoFrentesMatch = url.pathname.match(/^\/api\/politicos\/([^/]+)\/frentes$/);
            if (politicoFrentesMatch) {
              const politicoId = decodeURIComponent(politicoFrentesMatch[1]);
              const result = await pool!.query('SELECT f.id::text AS id, f.titulo, f.id_legislatura AS "idLegislatura", f.uri FROM camara_deputados_frentes df JOIN camara_frentes f ON f.id = df.frente_id WHERE df.politico_id::text = $1 ORDER BY f.id_legislatura DESC NULLS LAST, f.titulo ASC', [politicoId]);
              sendJson(res, 200, {items: result.rows});
              return;
            }

            const politicoHistoricoMatch = url.pathname.match(/^\/api\/politicos\/([^/]+)\/historico-profissional$/);
            if (politicoHistoricoMatch) {
              const politicoId = decodeURIComponent(politicoHistoricoMatch[1]);
              const [profissoes, ocupacoes] = await Promise.all([
                pool!.query('SELECT titulo, data_hora AS "dataHora" FROM camara_deputados_profissoes WHERE politico_id::text = $1 ORDER BY titulo ASC', [politicoId]),
                pool!.query('SELECT titulo, entidade, entidade_uf AS "entidadeUf", entidade_pais AS "entidadePais", ano_inicio AS "anoInicio", ano_fim AS "anoFim" FROM camara_deputados_ocupacoes WHERE politico_id::text = $1 ORDER BY ano_fim DESC NULLS FIRST, ano_inicio DESC NULLS LAST, titulo ASC', [politicoId]),
              ]);
              sendJson(res, 200, {profissoes: profissoes.rows, ocupacoes: ocupacoes.rows});
              return;
            }

            if (url.pathname === '/api/politicos') {
              const search = (url.searchParams.get('search') ?? '').trim();

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

              const result = await pool!.query(
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
              return;
            }

            const politicoMatch = url.pathname.match(/^\/api\/politicos\/([^/]+)$/);
            if (politicoMatch) {
              const politicoId = politicoMatch[1];
              const result = await pool!.query(
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
              return;
            }

            const votacoesAnosMatch = url.pathname.match(
              /^\/api\/politicos\/([^/]+)\/votacoes\/anos$/,
            );
            if (votacoesAnosMatch) {
              const politicoId = votacoesAnosMatch[1];
              const result = await pool!.query(
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

              sendJson(res, 200, {items: result.rows.map((r) => r.ano)});
              return;
            }

            const votacoesMatch = url.pathname.match(/^\/api\/politicos\/([^/]+)\/votacoes$/);
            if (votacoesMatch) {
              const politicoId = votacoesMatch[1];
              const anoParam = url.searchParams.get('ano');
              const ano =
                anoParam != null && anoParam !== '' && Number.isFinite(Number(anoParam))
                  ? Number(anoParam)
                  : null;

              const where: string[] = ['vd.politico_id::text = $1'];
              const params: Array<string | number> = [politicoId];

              if (ano != null && Number.isFinite(ano)) {
                params.push(ano);
                where.push(`v.ano = $${params.length}`);
              }

              params.push(limit);
              params.push(offset);

              const result = await pool!.query(
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
              return;
            }

            const despesasAnosMatch = url.pathname.match(
              /^\/api\/politicos\/([^/]+)\/despesas\/anos$/,
            );
            if (despesasAnosMatch) {
              const politicoId = despesasAnosMatch[1];
              const result = await pool!.query(
                  `
                  SELECT DISTINCT d.ano
                  FROM despesas d
                  WHERE d.politico_id::text = $1
                    AND d.ano IS NOT NULL
                  ORDER BY d.ano DESC
                  `,
                  [politicoId],
                );

              sendJson(res, 200, {items: result.rows.map((r) => r.ano)});
              return;
            }

            const despesasMatch = url.pathname.match(/^\/api\/politicos\/([^/]+)\/despesas$/);
            if (despesasMatch) {
              const politicoId = despesasMatch[1];
              const anoParam = url.searchParams.get('ano');
              const mesParam = url.searchParams.get('mes');
              const ano =
                anoParam != null && anoParam !== '' && Number.isFinite(Number(anoParam))
                  ? Number(anoParam)
                  : null;
              const mes =
                mesParam != null && mesParam !== '' && Number.isFinite(Number(mesParam))
                  ? Number(mesParam)
                  : null;

              const where: string[] = ['d.politico_id::text = $1'];
              const params: Array<string | number> = [politicoId];

              if (ano != null && Number.isFinite(ano)) {
                params.push(ano);
                where.push(`d.ano = $${params.length}`);
              }

              if (mes != null && Number.isFinite(mes)) {
                params.push(mes);
                where.push(`d.mes = $${params.length}`);
              }

              params.push(limit);
              params.push(offset);

              const result = await pool!.query(
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
              return;
            }

            sendJson(res, 404, {error: 'Endpoint não encontrado'});
          } catch {
            sendJson(res, 500, {error: 'Erro ao processar requisição'});
          }
        });
      },
    });
  }

  return {
    plugins,
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      host: true,
      port: 3000,
      strictPort: true,
      proxy: apiProxyTarget
        ? {
            '/api': {
              target: apiProxyTarget,
              changeOrigin: true,
            },
          }
        : undefined,
      watch: usePolling ? {usePolling: true, interval: pollingInterval} : undefined,
    },
  };
});
