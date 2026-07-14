ALTER TABLE votacoes
  ADD COLUMN IF NOT EXISTS tipo_votacao VARCHAR(30),
  ADD COLUMN IF NOT EXISTS eh_subvotacao BOOLEAN,
  ADD COLUMN IF NOT EXISTS titulo_publico TEXT,
  ADD COLUMN IF NOT EXISTS resumo_leigo TEXT,
  ADD COLUMN IF NOT EXISTS classificacao_fonte VARCHAR(30),
  ADD COLUMN IF NOT EXISTS classificacao_confianca VARCHAR(20),
  ADD COLUMN IF NOT EXISTS classificacao_versao VARCHAR(40),
  ADD COLUMN IF NOT EXISTS classificacao_justificativa TEXT,
  ADD COLUMN IF NOT EXISTS ai_input_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS ai_model VARCHAR(120),
  ADD COLUMN IF NOT EXISTS ai_prompt_versao VARCHAR(40),
  ADD COLUMN IF NOT EXISTS ai_gerado_em TIMESTAMPTZ(6);

UPDATE votacoes
SET tipo_votacao = CASE
      WHEN ementa ~* 'destaque' THEN 'destaque'
      WHEN ementa ~* 'subemenda|\memenda\M' THEN 'emenda'
      WHEN ementa ~* 'substitutiv' THEN 'substitutivo'
      WHEN ementa ~* 'parecer' THEN 'parecer'
      WHEN ementa ~* 'requerimento' THEN 'requerimento'
      WHEN ementa ~* 'projeto|proposta|medida provisória' THEN 'principal'
      ELSE 'procedimental'
    END,
    eh_subvotacao = CASE
      WHEN ementa ~* 'projeto|proposta|medida provisória' AND ementa !~* 'requerimento|destaque|emenda|substitutiv|parecer' THEN false
      ELSE true
    END,
    titulo_publico = CASE
      WHEN ementa ~* 'destaque' THEN 'Destaque para votação em separado'
      WHEN ementa ~* 'subemenda|\memenda\M' THEN 'Emenda'
      WHEN ementa ~* 'substitutiv' THEN 'Substitutivo'
      WHEN ementa ~* 'parecer' THEN 'Parecer'
      WHEN ementa ~* 'urgência' THEN 'Requerimento de urgência'
      WHEN ementa ~* 'requerimento' THEN 'Requerimento'
      WHEN ementa ~* 'projeto|proposta|medida provisória' THEN 'Votação principal'
      ELSE 'Subvotação procedimental — objeto exato não identificado'
    END,
    resumo_leigo = NULLIF(ementa, ''),
    classificacao_fonte = 'regra_deterministica',
    classificacao_confianca = CASE WHEN proposicao_objeto IS NULL THEN 'ambigua' ELSE 'derivada' END,
    classificacao_versao = 'migration-20260714',
    classificacao_justificativa = CASE
      WHEN proposicao_objeto IS NULL THEN 'Classificação inicial sem objeto oficial identificado; requer backfill detalhado.'
      ELSE 'Classificação inicial derivada da descrição e do objeto oficial.'
    END
WHERE tipo_votacao IS NULL;

ALTER TABLE votacoes
  ALTER COLUMN tipo_votacao SET NOT NULL,
  ALTER COLUMN eh_subvotacao SET NOT NULL,
  ALTER COLUMN titulo_publico SET NOT NULL,
  ALTER COLUMN classificacao_fonte SET NOT NULL,
  ALTER COLUMN classificacao_confianca SET NOT NULL,
  ALTER COLUMN classificacao_versao SET NOT NULL;

CREATE TABLE IF NOT EXISTS votacao_objetos_possiveis (
  votacao_id TEXT NOT NULL REFERENCES votacoes(id) ON DELETE CASCADE,
  proposicao_id BIGINT NOT NULL,
  uri TEXT,
  sigla_tipo VARCHAR(30),
  numero INTEGER,
  ano INTEGER,
  ementa TEXT,
  ordem INTEGER NOT NULL DEFAULT 0,
  raw_json JSONB NOT NULL,
  atualizado_em TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (votacao_id, proposicao_id)
);

CREATE TABLE IF NOT EXISTS votacao_proposicoes_afetadas (
  votacao_id TEXT NOT NULL REFERENCES votacoes(id) ON DELETE CASCADE,
  proposicao_id BIGINT NOT NULL,
  uri TEXT,
  sigla_tipo VARCHAR(30),
  numero INTEGER,
  ano INTEGER,
  ementa TEXT,
  efeito TEXT,
  ordem INTEGER NOT NULL DEFAULT 0,
  raw_json JSONB NOT NULL,
  atualizado_em TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (votacao_id, proposicao_id)
);

CREATE TABLE IF NOT EXISTS votos_deputados_pendentes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  votacao_id TEXT NOT NULL,
  politico_id BIGINT NOT NULL,
  voto VARCHAR(50) NOT NULL,
  data_hora_voto TIMESTAMPTZ(6),
  deputado_json JSONB,
  raw_json JSONB NOT NULL,
  ultimo_erro TEXT,
  tentativas INTEGER NOT NULL DEFAULT 0,
  criado_em TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atualizado_em TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (votacao_id, politico_id)
);

CREATE INDEX IF NOT EXISTS idx_votacoes_data_cursor
ON votacoes(data_hora_votacao DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_votacoes_tipo_data
ON votacoes(tipo_votacao, data_hora_votacao DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_votos_deputados_politico_votacao
ON votos_deputados(politico_id, votacao_id) INCLUDE (voto, data_hora_voto);

CREATE INDEX IF NOT EXISTS idx_camara_proposicoes_tipo_numero_ano
ON camara_proposicoes(sigla_tipo, numero, ano);

CREATE INDEX IF NOT EXISTS idx_votos_pendentes_politico
ON votos_deputados_pendentes(politico_id, atualizado_em);

DELETE FROM app_settings WHERE key = 'groq_api_key';
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
