CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS politicos (
    id BIGINT PRIMARY KEY,
    nome TEXT NOT NULL,
    sigla_partido VARCHAR(50) NOT NULL,
    sigla_uf VARCHAR(2) NOT NULL,
    url_foto TEXT,
    ativo BOOLEAN DEFAULT TRUE,
    atualizado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS votacoes (
    id TEXT PRIMARY KEY,
    sigla_tipo VARCHAR(20),
    numero INTEGER,
    ano INTEGER,
    ementa TEXT,
    data_votacao DATE NOT NULL,
    aprovacao INTEGER
);

CREATE TABLE IF NOT EXISTS votos_deputados (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    votacao_id TEXT REFERENCES votacoes(id) ON DELETE CASCADE,
    politico_id BIGINT REFERENCES politicos(id) ON DELETE CASCADE,
    voto VARCHAR(50) NOT NULL,
    UNIQUE(votacao_id, politico_id)
);

CREATE TABLE IF NOT EXISTS despesas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    politico_id BIGINT REFERENCES politicos(id) ON DELETE CASCADE,
    ano INTEGER NOT NULL,
    mes INTEGER NOT NULL,
    tipo_despesa TEXT NOT NULL,
    valor_liquido NUMERIC(10, 2) NOT NULL,
    url_documento TEXT,
    fornecedor TEXT
);

CREATE TABLE IF NOT EXISTS avaliacoes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    politico_id BIGINT REFERENCES politicos(id) ON DELETE CASCADE,
    cpf_hash TEXT NOT NULL,
    nota INTEGER CHECK (nota >= 1 AND nota <= 5) NOT NULL,
    data_avaliacao TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(politico_id, cpf_hash)
);

CREATE INDEX IF NOT EXISTS idx_votos_votacao ON votos_deputados(votacao_id);
CREATE INDEX IF NOT EXISTS idx_votos_politico ON votos_deputados(politico_id);
CREATE INDEX IF NOT EXISTS idx_despesas_politico ON despesas(politico_id);
CREATE INDEX IF NOT EXISTS idx_avaliacoes_politico ON avaliacoes(politico_id);
