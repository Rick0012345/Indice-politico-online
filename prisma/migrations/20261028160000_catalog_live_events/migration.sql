BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION notify_catalog_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('catalogo_changes', TG_TABLE_SCHEMA);
  RETURN NULL;
END;
$$;

CREATE TRIGGER catalog_change_politicos
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON politicos
FOR EACH STATEMENT EXECUTE FUNCTION notify_catalog_change();

CREATE TRIGGER catalog_change_despesas
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON despesas
FOR EACH STATEMENT EXECUTE FUNCTION notify_catalog_change();

CREATE TRIGGER catalog_change_votos
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON votos_deputados
FOR EACH STATEMENT EXECUTE FUNCTION notify_catalog_change();

CREATE TRIGGER catalog_change_avaliacoes
AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE ON avaliacoes
FOR EACH STATEMENT EXECUTE FUNCTION notify_catalog_change();
COMMIT;
