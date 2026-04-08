CREATE TABLE "noticias_politicos" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "politico_id" BIGINT NOT NULL,
    "titulo" TEXT NOT NULL,
    "resumo" TEXT,
    "url" TEXT NOT NULL,
    "veiculo" VARCHAR(255),
    "dominio" VARCHAR(255),
    "data_publicacao" TIMESTAMPTZ(6),
    "imagem_url" TEXT,
    "idioma" VARCHAR(20),
    "pais_origem" VARCHAR(10),
    "fonte_coleta" VARCHAR(50) NOT NULL DEFAULT 'gdelt_doc_2',
    "periodo_tipo" VARCHAR(20),
    "janela_consulta" VARCHAR(20),
    "query_usada" TEXT,
    "criado_em" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "noticias_politicos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "noticias_politicos_politico_id_url_key"
ON "noticias_politicos"("politico_id", "url");

CREATE INDEX "idx_noticias_politico"
ON "noticias_politicos"("politico_id");

CREATE INDEX "idx_noticias_data_publicacao"
ON "noticias_politicos"("data_publicacao");

CREATE INDEX "idx_noticias_periodo_tipo"
ON "noticias_politicos"("periodo_tipo");

ALTER TABLE "noticias_politicos"
ADD CONSTRAINT "noticias_politicos_politico_id_fkey"
FOREIGN KEY ("politico_id") REFERENCES "politicos"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
