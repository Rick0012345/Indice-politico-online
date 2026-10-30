-- Additive, manually reviewed judicial history. RESTRICT preserves evidence during catalog cleanup.
CREATE TABLE judicial_records (
  id uuid PRIMARY KEY,
  politico_id bigint NOT NULL REFERENCES politicos(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('CONVICTION','IMPRISONMENT')),
  category text NOT NULL CHECK (category IN ('CRIMINAL','IMPROBITY','ELECTORAL','ACCOUNTS')),
  case_key text NOT NULL,
  dedupe_key text NOT NULL,
  verification text NOT NULL CHECK (verification IN ('DRAFT','VERIFIED')),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  version integer NOT NULL DEFAULT 1 CHECK (version>0),
  checked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (politico_id,dedupe_key)
);
CREATE INDEX judicial_records_public_idx ON judicial_records(politico_id,category,kind) WHERE verification='VERIFIED';
CREATE TABLE judicial_coverage (
  politico_id bigint PRIMARY KEY REFERENCES politicos(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('NOT_RESEARCHED','PARTIAL','REVIEWED')),
  scope text NOT NULL DEFAULT '',
  sources jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(sources)='array'),
  version integer NOT NULL DEFAULT 1 CHECK (version>0),
  checked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE judicial_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  politico_id bigint NOT NULL REFERENCES politicos(id) ON DELETE RESTRICT,
  record_id uuid REFERENCES judicial_records(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('CREATE','UPDATE','COVERAGE')),
  before_data jsonb,
  after_data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX judicial_audit_politico_idx ON judicial_audit(politico_id,created_at DESC);
-- Trigger is self-contained so test databases and deployments use the same notification contract.
CREATE FUNCTION notify_judicial_catalog_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('catalogo_changes',TG_TABLE_SCHEMA);
  RETURN NULL;
END;
$$;
CREATE TRIGGER judicial_records_catalog AFTER INSERT OR UPDATE OR DELETE ON judicial_records FOR EACH STATEMENT EXECUTE FUNCTION notify_judicial_catalog_change();
CREATE TRIGGER judicial_coverage_catalog AFTER INSERT OR UPDATE OR DELETE ON judicial_coverage FOR EACH STATEMENT EXECUTE FUNCTION notify_judicial_catalog_change();
