CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS politicos (
    id BIGINT PRIMARY KEY,
    nome TEXT NOT NULL,
    sigla_partido VARCHAR(50) NOT NULL,
    sigla_uf VARCHAR(2) NOT NULL,
    url_foto TEXT,
    ativo BOOLEAN DEFAULT TRUE,
    atualizado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    cpf VARCHAR(11) UNIQUE,
    data_nascimento DATE,
    email VARCHAR(100),
    nome_civil TEXT,
    sexo VARCHAR(1),
    situacao VARCHAR(50) DEFAULT 'Exercício',
    telefone VARCHAR(50)
);

CREATE TABLE IF NOT EXISTS votacoes (
    id TEXT PRIMARY KEY,
    sigla_tipo VARCHAR(20),
    numero INTEGER,
    ano INTEGER,
    ementa TEXT,
    aprovacao INTEGER,
    data_hora_votacao TIMESTAMP(6) WITH TIME ZONE,
    resultado VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS votos_deputados (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    votacao_id TEXT NOT NULL REFERENCES votacoes(id) ON UPDATE CASCADE ON DELETE CASCADE,
    politico_id BIGINT NOT NULL REFERENCES politicos(id) ON UPDATE CASCADE ON DELETE CASCADE,
    voto VARCHAR(50) NOT NULL,
    UNIQUE(votacao_id, politico_id)
);

CREATE TABLE IF NOT EXISTS despesas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    politico_id BIGINT NOT NULL REFERENCES politicos(id) ON UPDATE CASCADE ON DELETE CASCADE,
    ano SMALLINT NOT NULL,
    mes SMALLINT NOT NULL,
    tipo_despesa VARCHAR(255) NOT NULL,
    valor_liquido NUMERIC(12, 2) NOT NULL,
    url_documento TEXT,
    cnpj_cpf_fornecedor VARCHAR(14),
    cod_documento VARCHAR(100) UNIQUE,
    data_documento DATE,
    nome_fornecedor VARCHAR(255),
    num_documento VARCHAR(100),
    num_lote VARCHAR(50),
    num_ressarcimento VARCHAR(50),
    parcela SMALLINT DEFAULT 0,
    tipo_documento VARCHAR(50),
    valor_documento NUMERIC(12, 2) NOT NULL,
    valor_glosa NUMERIC(12, 2) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS avaliacoes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    politico_id BIGINT NOT NULL REFERENCES politicos(id) ON UPDATE CASCADE ON DELETE CASCADE,
    cpf_hash VARCHAR(255) NOT NULL,
    nota SMALLINT CHECK (nota >= 1 AND nota <= 5) NOT NULL,
    data_avaliacao TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(politico_id, cpf_hash)
);

CREATE INDEX IF NOT EXISTS idx_votos_votacao ON votos_deputados(votacao_id);
CREATE INDEX IF NOT EXISTS idx_votos_politico ON votos_deputados(politico_id);
CREATE INDEX IF NOT EXISTS idx_despesas_politico ON despesas(politico_id);
CREATE INDEX IF NOT EXISTS idx_despesas_fornecedor ON despesas(cnpj_cpf_fornecedor);
CREATE INDEX IF NOT EXISTS idx_despesas_data_competencia ON despesas(ano, mes);
CREATE INDEX IF NOT EXISTS idx_avaliacoes_politico ON avaliacoes(politico_id);
