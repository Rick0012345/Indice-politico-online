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
        host: process.env.APP_DB_HOST ?? 'n8n-db',
        port: Number(process.env.APP_DB_PORT ?? 5432),
        user: process.env.APP_DB_USER ?? 'n8n',
        password: process.env.APP_DB_PASSWORD ?? 'n8n',
        database: process.env.APP_DB_NAME ?? 'n8n',
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
