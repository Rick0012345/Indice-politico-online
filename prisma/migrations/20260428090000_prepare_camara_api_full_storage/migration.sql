CREATE TABLE IF NOT EXISTS camara_api_raw_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource VARCHAR(120) NOT NULL,
  resource_id TEXT NOT NULL,
  parent_resource VARCHAR(120) NOT NULL DEFAULT '',
  parent_id TEXT NOT NULL DEFAULT '',
  endpoint TEXT NOT NULL,
  query_params JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_json JSONB NOT NULL,
  links_json JSONB,
  fetched_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (resource, resource_id, parent_resource, parent_id)
);

CREATE INDEX IF NOT EXISTS idx_camara_api_raw_items_resource
ON camara_api_raw_items(resource);

CREATE INDEX IF NOT EXISTS idx_camara_api_raw_items_parent
ON camara_api_raw_items(parent_resource, parent_id);

CREATE INDEX IF NOT EXISTS idx_camara_api_raw_items_raw_json
ON camara_api_raw_items USING GIN(raw_json);

ALTER TABLE politicos
  ADD COLUMN IF NOT EXISTS uri TEXT,
  ADD COLUMN IF NOT EXISTS uri_partido TEXT,
  ADD COLUMN IF NOT EXISTS data_falecimento DATE,
  ADD COLUMN IF NOT EXISTS descricao_status TEXT,
  ADD COLUMN IF NOT EXISTS ultimo_status_json JSONB,
  ADD COLUMN IF NOT EXISTS raw_json JSONB;

ALTER TABLE despesas
  ADD COLUMN IF NOT EXISTS cod_tipo_documento INTEGER,
  ADD COLUMN IF NOT EXISTS cod_lote VARCHAR(100),
  ADD COLUMN IF NOT EXISTS raw_json JSONB;

ALTER TABLE votacoes
  ADD COLUMN IF NOT EXISTS uri TEXT,
  ADD COLUMN IF NOT EXISTS data DATE,
  ADD COLUMN IF NOT EXISTS data_hora_registro TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS sigla_orgao VARCHAR(50),
  ADD COLUMN IF NOT EXISTS uri_orgao TEXT,
  ADD COLUMN IF NOT EXISTS id_orgao INTEGER,
  ADD COLUMN IF NOT EXISTS uri_evento TEXT,
  ADD COLUMN IF NOT EXISTS id_evento INTEGER,
  ADD COLUMN IF NOT EXISTS proposicao_objeto TEXT,
  ADD COLUMN IF NOT EXISTS uri_proposicao_objeto TEXT,
  ADD COLUMN IF NOT EXISTS desc_ultima_abertura_votacao TEXT,
  ADD COLUMN IF NOT EXISTS data_hora_ultima_abertura_votacao TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS ultima_apresentacao_proposicao_json JSONB,
  ADD COLUMN IF NOT EXISTS efeitos_registrados_json JSONB,
  ADD COLUMN IF NOT EXISTS objetos_possiveis_json JSONB,
  ADD COLUMN IF NOT EXISTS raw_json JSONB;

ALTER TABLE votos_deputados
  ADD COLUMN IF NOT EXISTS data_hora_voto TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS deputado_json JSONB,
  ADD COLUMN IF NOT EXISTS raw_json JSONB;

CREATE TABLE IF NOT EXISTS camara_legislaturas (
  id INTEGER PRIMARY KEY,
  uri TEXT,
  data_inicio DATE,
  data_fim DATE,
  raw_json JSONB NOT NULL,
  atualizado_em TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS camara_partidos (
  id INTEGER PRIMARY KEY,
  sigla VARCHAR(50),
  nome TEXT,
  uri TEXT,
  numero_eleitoral INTEGER,
  url_logo TEXT,
  url_website TEXT,
  url_facebook TEXT,
  status_json JSONB,
  raw_json JSONB NOT NULL,
  atualizado_em TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS camara_blocos (
  id TEXT PRIMARY KEY,
  uri TEXT,
  nome TEXT,
  id_legislatura INTEGER,
  federacao BOOLEAN,
  raw_json JSONB NOT NULL,
  atualizado_em TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS camara_orgaos (
  id INTEGER PRIMARY KEY,
  uri TEXT,
  sigla VARCHAR(80),
  nome TEXT,
  apelido TEXT,
  cod_tipo_orgao INTEGER,
  tipo_orgao TEXT,
  nome_publicacao TEXT,
  nome_resumido TEXT,
  raw_json JSONB NOT NULL,
  atualizado_em TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS camara_eventos (
  id BIGINT PRIMARY KEY,
  uri TEXT,
  data_hora_inicio TIMESTAMPTZ(6),
  data_hora_fim TIMESTAMPTZ(6),
  situacao TEXT,
  descricao_tipo TEXT,
  descricao TEXT,
  local_externo TEXT,
  local_camara_json JSONB,
  orgaos_json JSONB,
  url_registro TEXT,
  raw_json JSONB NOT NULL,
  atualizado_em TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS camara_eventos_orgaos (
  evento_id BIGINT NOT NULL REFERENCES camara_eventos(id) ON DELETE CASCADE,
  orgao_id INTEGER NOT NULL,
  raw_json JSONB NOT NULL,
  PRIMARY KEY (evento_id, orgao_id)
);

CREATE TABLE IF NOT EXISTS camara_frentes (
  id BIGINT PRIMARY KEY,
  uri TEXT,
  titulo TEXT,
  id_legislatura INTEGER,
  raw_json JSONB NOT NULL,
  atualizado_em TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS camara_deputados_orgaos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  politico_id BIGINT NOT NULL REFERENCES politicos(id) ON DELETE CASCADE,
  orgao_id INTEGER NOT NULL,
  uri_orgao TEXT,
  sigla_orgao VARCHAR(80),
  nome_orgao TEXT,
  nome_publicacao TEXT,
  titulo TEXT,
  cod_titulo VARCHAR(50),
  data_inicio TIMESTAMPTZ(6),
  data_fim TIMESTAMPTZ(6),
  raw_json JSONB NOT NULL,
  atualizado_em TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_camara_deputados_orgaos_politico
ON camara_deputados_orgaos(politico_id);

CREATE TABLE IF NOT EXISTS camara_deputados_eventos (
  politico_id BIGINT NOT NULL REFERENCES politicos(id) ON DELETE CASCADE,
  evento_id BIGINT NOT NULL,
  raw_json JSONB NOT NULL,
  atualizado_em TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (politico_id, evento_id)
);

CREATE TABLE IF NOT EXISTS camara_deputados_frentes (
  politico_id BIGINT NOT NULL REFERENCES politicos(id) ON DELETE CASCADE,
  frente_id BIGINT NOT NULL,
  raw_json JSONB NOT NULL,
  atualizado_em TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (politico_id, frente_id)
);

CREATE TABLE IF NOT EXISTS camara_deputados_profissoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  politico_id BIGINT NOT NULL REFERENCES politicos(id) ON DELETE CASCADE,
  data_hora TIMESTAMPTZ(6),
  cod_tipo_profissao INTEGER,
  titulo TEXT,
  raw_json JSONB NOT NULL,
  atualizado_em TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (politico_id, cod_tipo_profissao, titulo)
);

CREATE TABLE IF NOT EXISTS camara_deputados_ocupacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  politico_id BIGINT NOT NULL REFERENCES politicos(id) ON DELETE CASCADE,
  titulo TEXT,
  entidade TEXT,
  entidade_uf VARCHAR(2),
  entidade_pais TEXT,
  ano_inicio INTEGER,
  ano_fim INTEGER,
  raw_json JSONB NOT NULL,
  atualizado_em TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS camara_proposicoes (
  id BIGINT PRIMARY KEY,
  uri TEXT,
  sigla_tipo VARCHAR(50),
  cod_tipo INTEGER,
  numero INTEGER,
  ano INTEGER,
  ementa TEXT,
  data_apresentacao TIMESTAMPTZ(6),
  uri_orgao_numerador TEXT,
  uri_autores TEXT,
  descricao_tipo TEXT,
  ementa_detalhada TEXT,
  keywords TEXT,
  url_inteiro_teor TEXT,
  urn_final TEXT,
  texto TEXT,
  justificativa TEXT,
  status_proposicao_json JSONB,
  raw_json JSONB NOT NULL,
  atualizado_em TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_camara_proposicoes_tipo_ano
ON camara_proposicoes(sigla_tipo, ano);

CREATE INDEX IF NOT EXISTS idx_camara_proposicoes_raw_json
ON camara_proposicoes USING GIN(raw_json);

CREATE TABLE IF NOT EXISTS camara_proposicoes_autores (
  proposicao_id BIGINT NOT NULL REFERENCES camara_proposicoes(id) ON DELETE CASCADE,
  uri TEXT NOT NULL,
  nome TEXT,
  cod_tipo INTEGER,
  tipo TEXT,
  ordem_assinatura INTEGER,
  proponente INTEGER,
  raw_json JSONB NOT NULL,
  PRIMARY KEY (proposicao_id, uri)
);

CREATE TABLE IF NOT EXISTS camara_proposicoes_temas (
  proposicao_id BIGINT NOT NULL REFERENCES camara_proposicoes(id) ON DELETE CASCADE,
  cod_tema INTEGER NOT NULL,
  tema TEXT,
  relevancia INTEGER,
  raw_json JSONB NOT NULL,
  PRIMARY KEY (proposicao_id, cod_tema)
);

CREATE TABLE IF NOT EXISTS camara_proposicoes_tramitacoes (
  proposicao_id BIGINT NOT NULL REFERENCES camara_proposicoes(id) ON DELETE CASCADE,
  sequencia INTEGER NOT NULL,
  data_hora TIMESTAMPTZ(6),
  sigla_orgao VARCHAR(80),
  uri_orgao TEXT,
  uri_ultimo_relator TEXT,
  regime TEXT,
  descricao_tramitacao TEXT,
  cod_tipo_tramitacao VARCHAR(50),
  descricao_situacao TEXT,
  cod_situacao INTEGER,
  despacho TEXT,
  url TEXT,
  ambito TEXT,
  apreciacao TEXT,
  raw_json JSONB NOT NULL,
  PRIMARY KEY (proposicao_id, sequencia)
);

CREATE TABLE IF NOT EXISTS camara_proposicoes_relacionadas (
  proposicao_id BIGINT NOT NULL REFERENCES camara_proposicoes(id) ON DELETE CASCADE,
  relacionada_id BIGINT NOT NULL,
  raw_json JSONB NOT NULL,
  PRIMARY KEY (proposicao_id, relacionada_id)
);

CREATE TABLE IF NOT EXISTS camara_votacoes_orientacoes (
  votacao_id TEXT NOT NULL REFERENCES votacoes(id) ON DELETE CASCADE,
  sigla_bancada VARCHAR(80) NOT NULL,
  orientacao TEXT,
  raw_json JSONB NOT NULL,
  PRIMARY KEY (votacao_id, sigla_bancada)
);

CREATE TABLE IF NOT EXISTS camara_referencias (
  grupo VARCHAR(120) NOT NULL,
  chave VARCHAR(120) NOT NULL,
  cod VARCHAR(80) NOT NULL,
  sigla VARCHAR(80),
  nome TEXT,
  descricao TEXT,
  raw_json JSONB NOT NULL,
  atualizado_em TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (grupo, chave, cod)
);

CREATE INDEX IF NOT EXISTS idx_camara_referencias_grupo_chave
ON camara_referencias(grupo, chave);
