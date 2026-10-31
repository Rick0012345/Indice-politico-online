-- Additive private evidence storage. No automatic publication or coverage updates.
CREATE TABLE judicial_ingestion_runs (
  id uuid PRIMARY KEY,
  data jsonb NOT NULL,
  lock_pid integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX judicial_ingestion_runs_created_idx ON judicial_ingestion_runs(created_at DESC);
CREATE TABLE judicial_source_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id text NOT NULL CHECK(source_id IN ('STF_NEWS','STJ_NEWS')),
  source_key text NOT NULL,
  content_hash text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_id,source_key,content_hash)
);
CREATE TABLE judicial_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  politico_id bigint NOT NULL REFERENCES politicos(id) ON DELETE RESTRICT,
  source_id text NOT NULL,
  source_key text NOT NULL,
  document_id uuid NOT NULL REFERENCES judicial_source_documents(id) ON DELETE RESTRICT,
  matched_names jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','IMPORTED','DISMISSED')),
  version integer NOT NULL DEFAULT 1,
  record_id uuid REFERENCES judicial_records(id) ON DELETE RESTRICT,
  content_changed boolean NOT NULL DEFAULT false,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  review_note text NOT NULL DEFAULT '',
  UNIQUE(politico_id,source_id,source_key)
);
CREATE INDEX judicial_candidates_review_idx ON judicial_candidates(status,last_seen_at DESC);
CREATE TABLE judicial_candidate_evidence (
  candidate_id uuid NOT NULL REFERENCES judicial_candidates(id) ON DELETE RESTRICT,
  document_id uuid NOT NULL REFERENCES judicial_source_documents(id) ON DELETE RESTRICT,
  run_id uuid NOT NULL REFERENCES judicial_ingestion_runs(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(candidate_id,document_id,run_id)
);
