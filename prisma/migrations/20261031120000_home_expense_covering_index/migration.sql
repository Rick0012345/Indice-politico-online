-- Compact financial scan for Home and unfiltered expense totals.
-- Keeps existing indexes and source rows; PostgreSQL maintains this on every write.
CREATE INDEX IF NOT EXISTS idx_despesas_politico_valor
  ON despesas (politico_id) INCLUDE (valor_liquido);
