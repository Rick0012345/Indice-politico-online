import 'dotenv/config';
import {votePresentationAssignments} from './lib/votePresentationPersistence';
import {Pool} from 'pg';
import {runIngestion} from './lib/ingestionLifecycle';
import {classifyVote, type VoteProposalCandidate} from './lib/voteClassification';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  host: process.env.DATABASE_URL ? undefined : process.env.APP_DB_HOST ?? 'db',
  port: process.env.DATABASE_URL ? undefined : Number(process.env.APP_DB_PORT ?? 5432),
  user: process.env.DATABASE_URL ? undefined : process.env.APP_DB_USER ?? 'app',
  password: process.env.DATABASE_URL ? undefined : process.env.APP_DB_PASSWORD ?? 'app',
  database: process.env.DATABASE_URL ? undefined : process.env.APP_DB_NAME ?? 'app',
});

type VoteBackfillRow = {
  id: string;
  descricao: string | null;
  proposicaoObjeto: string | null;
  uriProposicaoObjeto: string | null;
  objetosPossiveis: VoteProposalCandidate[] | null;
  proposicoesAfetadas: VoteProposalCandidate[] | null;
};

const batchSize = Math.max(10, Math.min(1000, Number(process.env.VOTE_BACKFILL_BATCH_SIZE ?? 250) || 250));

const run = async () => {
  let cursor = '';
  let updated = 0;

  for (;;) {
    const result = await pool.query<VoteBackfillRow>(
      `
      SELECT
        vote_session.id,
        vote_session.ementa AS descricao,
        vote_session.proposicao_objeto AS "proposicaoObjeto",
        vote_session.uri_proposicao_objeto AS "uriProposicaoObjeto",
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', possible.proposicao_id,
            'uri', possible.uri,
            'siglaTipo', possible.sigla_tipo,
            'numero', possible.numero,
            'ano', possible.ano,
            'ementa', possible.ementa
          ) ORDER BY possible.ordem)
          FROM votacao_objetos_possiveis possible
          WHERE possible.votacao_id = vote_session.id
        ), '[]'::jsonb) AS "objetosPossiveis",
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', affected.proposicao_id,
            'uri', affected.uri,
            'siglaTipo', affected.sigla_tipo,
            'numero', affected.numero,
            'ano', affected.ano,
            'ementa', affected.ementa,
            'efeito', affected.efeito
          ) ORDER BY affected.ordem)
          FROM votacao_proposicoes_afetadas affected
          WHERE affected.votacao_id = vote_session.id
        ), '[]'::jsonb) AS "proposicoesAfetadas"
      FROM votacoes vote_session
      WHERE vote_session.id > $1
      ORDER BY vote_session.id
      LIMIT $2
      `,
      [cursor, batchSize],
    );

    if (result.rows.length === 0) break;
    const payload = result.rows.map((row) => {
      const classification = classifyVote({
        votacaoId: row.id,
        descricao: row.descricao,
        proposicaoObjeto: row.proposicaoObjeto,
        uriProposicaoObjeto: row.uriProposicaoObjeto,
        objetosPossiveis: row.objetosPossiveis,
        proposicoesAfetadas: row.proposicoesAfetadas,
      });
      return {
        id: row.id,
        tipo_votacao: classification.tipoVotacao,
        eh_subvotacao: classification.ehSubvotacao,
        titulo_publico: classification.tituloPublico,
        resumo_leigo: classification.resumoLeigo,
        classificacao_fonte: classification.classificacaoFonte,
        classificacao_confianca: classification.classificacaoConfianca,
        classificacao_versao: classification.classificacaoVersao,
        classificacao_justificativa: classification.classificacaoJustificativa,
        ai_input_hash: classification.inputHash,
      };
    });

    await pool.query(
      `
      UPDATE votacoes vote_session
      SET tipo_votacao = item.tipo_votacao,
          eh_subvotacao = item.eh_subvotacao,
          ${votePresentationAssignments('vote_session', 'item')},
          classificacao_fonte = item.classificacao_fonte,
          classificacao_confianca = item.classificacao_confianca,
          classificacao_versao = item.classificacao_versao,
          classificacao_justificativa = item.classificacao_justificativa,
          ai_input_hash = item.ai_input_hash
      FROM jsonb_to_recordset($1::jsonb) AS item(
        id text,
        tipo_votacao varchar(30),
        eh_subvotacao boolean,
        titulo_publico text,
        resumo_leigo text,
        classificacao_fonte varchar(30),
        classificacao_confianca varchar(20),
        classificacao_versao varchar(40),
        classificacao_justificativa text,
        ai_input_hash varchar(64)
      )
      WHERE vote_session.id = item.id
      `,
      [JSON.stringify(payload)],
    );

    updated += result.rows.length;
    cursor = result.rows.at(-1)?.id ?? cursor;
    console.log(`[backfill-votacoes] ${updated} votação(ões) classificadas; cursor=${cursor}`);
  }

  console.log(`[backfill-votacoes] concluído: ${updated} votação(ões)`);
};

runIngestion(pool, false, run)
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
