BEGIN;
SET LOCAL lock_timeout = '5s';

-- The official document code remains untouched. Existing rows are not backfilled.
ALTER TABLE despesas ADD COLUMN IF NOT EXISTS identidade_origem VARCHAR(100);
CREATE UNIQUE INDEX IF NOT EXISTS despesas_sem_codigo_identidade_origem_key
  ON despesas (politico_id, ano, mes, tipo_despesa, identidade_origem)
  WHERE cod_documento IS NULL;

COMMIT;
