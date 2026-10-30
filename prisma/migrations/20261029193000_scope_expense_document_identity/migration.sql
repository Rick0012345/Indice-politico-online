BEGIN;
SET LOCAL lock_timeout = '5s';

-- Add the scoped identity before removing the global uniqueness; no business rows are changed.
CREATE UNIQUE INDEX IF NOT EXISTS despesas_politico_competencia_documento_tipo_key
  ON despesas (politico_id, ano, mes, cod_documento, tipo_despesa);
ALTER TABLE despesas DROP CONSTRAINT IF EXISTS despesas_cod_documento_key;
DROP INDEX IF EXISTS despesas_cod_documento_key;

COMMIT;
