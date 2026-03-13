CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Tabela de Políticos (Deputados Federais) 
-- O 'id' será o id exato fornecido pela API da Câmara dos Deputados. 
CREATE TABLE IF NOT EXISTS politicos ( 
    id BIGINT PRIMARY KEY, 
    nome TEXT NOT NULL, 
    sigla_partido VARCHAR(50) NOT NULL, 
    sigla_uf VARCHAR(2) NOT NULL, 
    url_foto TEXT, 
    ativo BOOLEAN DEFAULT TRUE, 
    atualizado_em TIMESTAMP WITH TIME ZONE DEFAULT NOW() 
); 

-- 2. Tabela de Votações (Os Projetos de Lei, PECs, etc.) 
-- O 'id' também vem da API da Câmara. 
CREATE TABLE IF NOT EXISTS votacoes ( 
    id TEXT PRIMARY KEY, 
    sigla_tipo VARCHAR(10), -- Ex: PL, PEC, MPV 
    numero INTEGER, 
    ano INTEGER, 
    ementa TEXT, -- Descrição do que está a ser votado 
    data_votacao DATE NOT NULL 
); 

-- 3. Tabela de Votos dos Parlamentares (Como cada deputado votou) 
CREATE TABLE IF NOT EXISTS votos_deputados ( 
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), 
    votacao_id TEXT REFERENCES votacoes(id) ON DELETE CASCADE, 
    politico_id BIGINT REFERENCES politicos(id) ON DELETE CASCADE, 
    voto VARCHAR(20) NOT NULL, -- Ex: 'Sim', 'Não', 'Abstenção', 'Obstrução' 
    UNIQUE(votacao_id, politico_id) -- Garante que o n8n não duplique o voto de um deputado na mesma sessão 
); 

-- 4. Tabela de Despesas (Cota Parlamentar) 
CREATE TABLE IF NOT EXISTS despesas ( 
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), 
    politico_id BIGINT REFERENCES politicos(id) ON DELETE CASCADE, 
    ano INTEGER NOT NULL, 
    mes INTEGER NOT NULL, 
    tipo_despesa TEXT NOT NULL, -- Ex: 'COMBUSTÍVEL', 'PASSAGEM AÉREA' 
    valor_liquido NUMERIC(10, 2) NOT NULL, 
    url_documento TEXT, -- Link para o recibo/fatura, se existir na API 
    fornecedor TEXT 
); 

-- 5. Tabela de Avaliações dos Cidadãos (O teu sistema de estrelas) 
CREATE TABLE IF NOT EXISTS avaliacoes ( 
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), 
    politico_id BIGINT REFERENCES politicos(id) ON DELETE CASCADE, 
    cpf_hash TEXT NOT NULL, -- Armazena apenas o hash criptografado do CPF 
    nota INTEGER CHECK (nota >= 1 AND nota <= 5) NOT NULL, 
    data_avaliacao TIMESTAMP WITH TIME ZONE DEFAULT NOW(), 
    -- A MÁGICA CONTRA FRAUDES ESTÁ AQUI: 
    -- Esta regra impede que o mesmo cpf_hash avalie o mesmo politico_id mais de uma vez. 
    UNIQUE(politico_id, cpf_hash) 
); 

-- Criação de Índices para garantir que o site carregue rápido quando houver muitos dados 
CREATE INDEX IF NOT EXISTS idx_votos_politico ON votos_deputados(politico_id); 
CREATE INDEX IF NOT EXISTS idx_despesas_politico ON despesas(politico_id); 
CREATE INDEX IF NOT EXISTS idx_avaliacoes_politico ON avaliacoes(politico_id); 
