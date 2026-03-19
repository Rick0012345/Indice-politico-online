ALTER TABLE "avaliacoes" DROP CONSTRAINT "avaliacoes_politico_id_fkey";

ALTER TABLE "despesas" DROP CONSTRAINT "despesas_politico_id_fkey";

ALTER TABLE "votos_deputados" DROP CONSTRAINT "votos_deputados_politico_id_fkey";

ALTER TABLE "votos_deputados" DROP CONSTRAINT "votos_deputados_votacao_id_fkey";

ALTER TABLE "avaliacoes"
ALTER COLUMN "politico_id" SET NOT NULL,
ALTER COLUMN "cpf_hash" SET DATA TYPE VARCHAR(255),
ALTER COLUMN "nota" SET DATA TYPE SMALLINT;

ALTER TABLE "despesas" DROP COLUMN "fornecedor",
ADD COLUMN "cnpj_cpf_fornecedor" VARCHAR(14),
ADD COLUMN "data_documento" DATE,
ADD COLUMN "nome_fornecedor" VARCHAR(255),
ADD COLUMN "num_documento" VARCHAR(100),
ADD COLUMN "num_lote" VARCHAR(50),
ADD COLUMN "num_ressarcimento" VARCHAR(50),
ADD COLUMN "parcela" SMALLINT DEFAULT 0,
ADD COLUMN "tipo_documento" VARCHAR(50),
ADD COLUMN "valor_documento" DECIMAL(12, 2) NOT NULL,
ADD COLUMN "valor_glosa" DECIMAL(12, 2) DEFAULT 0,
ALTER COLUMN "politico_id" SET NOT NULL,
ALTER COLUMN "ano" SET DATA TYPE SMALLINT,
ALTER COLUMN "mes" SET DATA TYPE SMALLINT,
ALTER COLUMN "tipo_despesa" SET DATA TYPE VARCHAR(255),
ALTER COLUMN "valor_liquido" SET DATA TYPE DECIMAL(12, 2);

ALTER TABLE "politicos"
ADD COLUMN "cpf" VARCHAR(11),
ADD COLUMN "data_nascimento" DATE,
ADD COLUMN "email" VARCHAR(100),
ADD COLUMN "nome_civil" TEXT,
ADD COLUMN "sexo" VARCHAR(1),
ADD COLUMN "situacao" VARCHAR(50) DEFAULT 'Exercício',
ADD COLUMN "telefone" VARCHAR(50);

ALTER TABLE "votacoes" DROP COLUMN "data_votacao",
ADD COLUMN "data_hora_votacao" TIMESTAMPTZ(6),
ADD COLUMN "resultado" VARCHAR(255);

ALTER TABLE "votos_deputados"
ALTER COLUMN "votacao_id" SET NOT NULL,
ALTER COLUMN "politico_id" SET NOT NULL;

CREATE INDEX "idx_despesas_fornecedor" ON "despesas"("cnpj_cpf_fornecedor");

CREATE INDEX "idx_despesas_data_competencia" ON "despesas"("ano", "mes");

CREATE UNIQUE INDEX "politicos_cpf_key" ON "politicos"("cpf");

ALTER TABLE "votos_deputados" ADD CONSTRAINT "votos_deputados_votacao_id_fkey" FOREIGN KEY ("votacao_id") REFERENCES "votacoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "votos_deputados" ADD CONSTRAINT "votos_deputados_politico_id_fkey" FOREIGN KEY ("politico_id") REFERENCES "politicos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "despesas" ADD CONSTRAINT "despesas_politico_id_fkey" FOREIGN KEY ("politico_id") REFERENCES "politicos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "avaliacoes" ADD CONSTRAINT "avaliacoes_politico_id_fkey" FOREIGN KEY ("politico_id") REFERENCES "politicos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER INDEX "idx_votos_politico" RENAME TO "votos_deputados_politico_id_idx";

ALTER INDEX "idx_votos_votacao" RENAME TO "votos_deputados_votacao_id_idx";
