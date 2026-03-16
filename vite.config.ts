import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import {Pool} from 'pg';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  const usePolling =
    env.VITE_USE_POLLING === 'true' || process.env.CHOKIDAR_USEPOLLING === 'true';
  const pollingInterval = Number(env.CHOKIDAR_INTERVAL ?? 100);

  const pool = new Pool({
    host: process.env.APP_DB_HOST ?? 'n8n-db',
    port: Number(process.env.APP_DB_PORT ?? 5432),
    user: process.env.APP_DB_USER ?? 'n8n',
    password: process.env.APP_DB_PASSWORD ?? 'n8n',
    database: process.env.APP_DB_NAME ?? 'n8n',
  });

  return {
    plugins: [
      react(),
      tailwindcss(),
      {
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

              if (url.pathname === '/api/politicos/novos') {
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
                return;
              }

              if (url.pathname === '/api/politicos/ranking') {
                const filter = url.searchParams.get('filter') ?? 'best';
                const orderBy =
                  filter === 'worst'
                    ? `"notaMedia" ASC, "totalAvaliacoes" DESC, "atualizadoEm" DESC`
                    : `"notaMedia" DESC, "totalAvaliacoes" DESC, "atualizadoEm" DESC`;

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
                  ORDER BY ${orderBy}
                  LIMIT $1
                  `,
                  [limit],
                );

                sendJson(res, 200, {items: result.rows});
                return;
              }

              if (url.pathname === '/api/politicos') {
                const search = (url.searchParams.get('search') ?? '').trim();
                const offsetRaw = url.searchParams.get('offset');
                const offset = Math.max(0, Number.isFinite(Number(offsetRaw)) ? Number(offsetRaw) : 0);

                const where: string[] = ['p.ativo IS DISTINCT FROM false'];
                const params: Array<string | number> = [];

                if (search) {
                  params.push(`%${search}%`);
                  where.push(`(p.nome ILIKE $${params.length} OR p.sigla_partido ILIKE $${params.length} OR p.sigla_uf ILIKE $${params.length})`);
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
                return;
              }

              const politicoMatch = url.pathname.match(/^\/api\/politicos\/([^/]+)$/);
              if (politicoMatch) {
                const politicoId = politicoMatch[1];
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
                return;
              }

              const votacoesMatch = url.pathname.match(/^\/api\/politicos\/([^/]+)\/votacoes$/);
              if (votacoesMatch) {
                const politicoId = votacoesMatch[1];
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
                    v.data_votacao AS "dataVotacao",
                    vd.voto
                  FROM votos_deputados vd
                  JOIN votacoes v ON v.id = vd.votacao_id
                  WHERE vd.politico_id::text = $1
                  ORDER BY v.data_votacao DESC NULLS LAST
                  LIMIT $2
                  `,
                  [politicoId, limit],
                );

                sendJson(res, 200, {items: result.rows});
                return;
              }

              const despesasMatch = url.pathname.match(/^\/api\/politicos\/([^/]+)\/despesas$/);
              if (despesasMatch) {
                const politicoId = despesasMatch[1];
                const result = await pool.query(
                  `
                  SELECT
                    d.id::text AS id,
                    d.ano,
                    d.mes,
                    d.tipo_despesa AS tipo,
                    d.valor_liquido::double precision AS valor,
                    d.url_documento AS "urlDocumento",
                    d.fornecedor
                  FROM despesas d
                  WHERE d.politico_id::text = $1
                  ORDER BY d.ano DESC, d.mes DESC
                  LIMIT $2
                  `,
                  [politicoId, limit],
                );

                sendJson(res, 200, {items: result.rows});
                return;
              }

              sendJson(res, 404, {error: 'Endpoint não encontrado'});
            } catch (err) {
              sendJson(res, 500, {error: 'Erro ao processar requisição'});
            }
          });
        },
      },
    ],
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
      watch: usePolling ? {usePolling: true, interval: pollingInterval} : undefined,
    },
  };
});
