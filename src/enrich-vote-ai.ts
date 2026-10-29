import 'dotenv/config';
import {setTimeout as sleep} from 'node:timers/promises';
import {Pool} from 'pg';
import {runIngestion} from './lib/ingestionLifecycle';
import {resolveGroqSettings} from './lib/groqSettings';
import {parseAndValidateVoteAiResponse} from './lib/voteAiContract';

const PROMPT_VERSION = 'vote-summary-2026-07-14.1';
let apiKey = '';
let model = '';
const concurrency = Math.max(1, Math.min(2, Number(process.env.VOTE_AI_CONCURRENCY ?? 2) || 2));
const timeoutMs = Math.max(3000, Math.min(30000, Number(process.env.VOTE_AI_TIMEOUT_MS ?? 15000) || 15000));
const batchLimit = Math.max(1, Math.min(5000, Number(process.env.VOTE_AI_LIMIT ?? 500) || 500));
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  host: process.env.DATABASE_URL ? undefined : process.env.APP_DB_HOST ?? 'db',
  port: process.env.DATABASE_URL ? undefined : Number(process.env.APP_DB_PORT ?? 5432),
  user: process.env.DATABASE_URL ? undefined : process.env.APP_DB_USER ?? 'app',
  password: process.env.DATABASE_URL ? undefined : process.env.APP_DB_PASSWORD ?? 'app',
  database: process.env.DATABASE_URL ? undefined : process.env.APP_DB_NAME ?? 'app',
});

type VoteAiRow = {
  id: string;
  tituloPublico: string;
  resumoLeigo: string | null;
  textoOficial: string | null;
  tipoVotacao: string;
  classificacaoConfianca: string;
  classificacaoJustificativa: string | null;
  aiInputHash: string;
  referencias: string[] | null;
};

let cooldownUntil = 0;
let consecutiveRateLimits = 0;
let circuitOpen = false;
let rateLimitResponses = 0;
let cacheHits = 0;
const requestsByInputHash = new Map<string, Promise<{titulo: string; resumo: string} | null>>();

const requestSummary = async (row: VoteAiRow, attempt = 1): Promise<{titulo: string; resumo: string} | null> => {
  if (circuitOpen) return null;
  const wait = Math.max(0, cooldownUntil - Date.now());
  if (wait > 0) await sleep(wait);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 180,
        response_format: {type: 'json_object'},
        messages: [
          {
            role: 'system',
            content: 'Reescreva somente os fatos fornecidos. Não escolha objetos ambíguos, não invente proposições e responda JSON com titulo e resumo.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              tituloDeterministico: row.tituloPublico,
              resumoDeterministico: row.resumoLeigo,
              textoOficial: row.textoOficial,
              tipoVotacao: row.tipoVotacao,
              confianca: row.classificacaoConfianca,
              justificativa: row.classificacaoJustificativa,
              referenciasPermitidas: row.referencias ?? [],
            }),
          },
        ],
      }),
    });

    if (response.status === 429) {
      rateLimitResponses += 1;
      consecutiveRateLimits += 1;
      const retryAfter = Number(response.headers.get('retry-after'));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** (attempt - 1);
      cooldownUntil = Date.now() + Math.min(60000, delay);
      if (consecutiveRateLimits >= 3) circuitOpen = true;
      if (!circuitOpen && attempt < 3) return requestSummary(row, attempt + 1);
      return null;
    }
    if (!response.ok) return null;
    consecutiveRateLimits = 0;
    const data = (await response.json()) as {choices?: Array<{message?: {content?: unknown}}>};
    return parseAndValidateVoteAiResponse(data.choices?.[0]?.message?.content, row.referencias ?? []);
  } catch {
    if (attempt < 3 && !circuitOpen) {
      await sleep(1000 * 2 ** (attempt - 1));
      return requestSummary(row, attempt + 1);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

const requestSummaryOncePerHash = (row: VoteAiRow) => {
  const cached = requestsByInputHash.get(row.aiInputHash);
  if (cached) {
    cacheHits += 1;
    return cached;
  }
  const request = requestSummary(row);
  requestsByInputHash.set(row.aiInputHash, request);
  return request;
};

const run = async () => {
  const settings = await pool.query<{key: string; value: string}>(
    'SELECT key, value FROM app_settings WHERE key = ANY($1::text[])', [['groq_enabled', 'groq_model']],
  );
  const config = resolveGroqSettings(new Map(settings.rows.map((row) => [row.key, row.value])));
  apiKey = config.groqApiKey;
  model = config.groqModel;
  if (!config.enabled || !apiKey) {
    console.log('[vote-ai] GROQ_API_KEY não configurada; enriquecimento opcional ignorado.');
    return;
  }
  const result = await pool.query<VoteAiRow>(
    `
    SELECT
      v.id,
      v.titulo_publico AS "tituloPublico",
      v.resumo_leigo AS "resumoLeigo",
      v.ementa AS "textoOficial",
      v.tipo_votacao AS "tipoVotacao",
      v.classificacao_confianca AS "classificacaoConfianca",
      v.classificacao_justificativa AS "classificacaoJustificativa",
      v.ai_input_hash AS "aiInputHash",
      COALESCE((
        SELECT array_agg(DISTINCT concat_ws(' ', affected.sigla_tipo, concat(affected.numero, '/', affected.ano)))
          FILTER (WHERE affected.sigla_tipo IS NOT NULL AND affected.numero IS NOT NULL AND affected.ano > 0)
        FROM votacao_proposicoes_afetadas affected
        WHERE affected.votacao_id = v.id
      ), ARRAY[]::text[]) AS referencias
    FROM votacoes v
    WHERE v.ai_input_hash IS NOT NULL
      AND v.classificacao_confianca <> 'ambigua'
      AND (
        v.ai_gerado_em IS NULL
        OR v.ai_model IS DISTINCT FROM $1
        OR v.ai_prompt_versao IS DISTINCT FROM $2
      )
    ORDER BY v.data_hora_votacao DESC NULLS LAST, v.id DESC
    LIMIT $3
    `,
    [model, PROMPT_VERSION, batchLimit],
  );

  let index = 0;
  let enriched = 0;
  const worker = async () => {
    for (;;) {
      const row = result.rows[index++];
      if (!row || circuitOpen) return;
      const summary = await requestSummaryOncePerHash(row);
      if (!summary) continue;
      const updated = await pool.query(
        `
        UPDATE votacoes
        SET titulo_publico = $2,
            resumo_leigo = $3,
            ai_model = $4,
            ai_prompt_versao = $5,
            ai_gerado_em = CURRENT_TIMESTAMP
        WHERE id = $1
          AND ai_input_hash = $6
        `,
        [row.id, summary.titulo, summary.resumo, model, PROMPT_VERSION, row.aiInputHash],
      );
      enriched += updated.rowCount ?? 0;
    }
  };

  const workers = await Promise.allSettled(Array.from({length: concurrency}, worker));
  const failure = workers.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failure) throw failure.reason;
  console.log(`[vote-ai] ${enriched}/${result.rows.length} votação(ões) enriquecida(s); cacheHits=${cacheHits}; http429=${rateLimitResponses}; circuitOpen=${circuitOpen}`);
};

runIngestion(pool, false, run)
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => pool.end());
