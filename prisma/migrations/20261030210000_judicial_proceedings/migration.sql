-- Process discovery is independent from convictions and imprisonment evidence.
CREATE TABLE judicial_process_observations (
  politico_id bigint NOT NULL REFERENCES politicos(id) ON DELETE RESTRICT,
  source_id text NOT NULL CHECK(source_id='STF_CASES'),
  source_key text NOT NULL,
  canonical_key text NOT NULL,
  identity text NOT NULL CHECK(identity IN ('CONFIRMED','UNRESOLVED')),
  payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(politico_id,source_id,source_key)
);
CREATE INDEX judicial_process_observations_public_idx ON judicial_process_observations(politico_id,canonical_key) WHERE identity='CONFIRMED';
CREATE TABLE judicial_process_attempts (
  run_id uuid NOT NULL REFERENCES judicial_ingestion_runs(id) ON DELETE RESTRICT,
  politico_id bigint NOT NULL REFERENCES politicos(id) ON DELETE RESTRICT,
  source_id text NOT NULL CHECK(source_id='STF_CASES'),
  status text NOT NULL CHECK(status IN ('RUNNING','COMPLETE','PARTIAL','FAILED')),
  processed_pages integer NOT NULL DEFAULT 0,
  nominal_matches integer NOT NULL DEFAULT 0,
  errors jsonb NOT NULL DEFAULT '[]',
  truncated boolean NOT NULL DEFAULT false,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  checked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(run_id,politico_id,source_id)
);
CREATE INDEX judicial_process_attempts_person_idx ON judicial_process_attempts(politico_id,started_at DESC);
CREATE TABLE judicial_process_pages (
  run_id uuid NOT NULL,
  politico_id bigint NOT NULL,
  source_id text NOT NULL DEFAULT 'STF_CASES',
  page integer NOT NULL CHECK(page>0),
  succeeded boolean NOT NULL,
  nominal_matches integer NOT NULL,
  errors jsonb NOT NULL DEFAULT '[]',
  PRIMARY KEY(run_id,politico_id,source_id,page),
  FOREIGN KEY(run_id,politico_id,source_id) REFERENCES judicial_process_attempts(run_id,politico_id,source_id) ON DELETE RESTRICT
);
CREATE TRIGGER judicial_process_observations_catalog AFTER INSERT OR UPDATE OR DELETE ON judicial_process_observations FOR EACH STATEMENT EXECUTE FUNCTION notify_judicial_catalog_change();
CREATE TRIGGER judicial_process_attempts_catalog AFTER INSERT OR UPDATE OR DELETE ON judicial_process_attempts FOR EACH STATEMENT EXECUTE FUNCTION notify_judicial_catalog_change();
