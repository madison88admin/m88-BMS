-- Table to record fiscal year rollovers
CREATE TABLE IF NOT EXISTS fiscal_rollovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL,
  from_year integer NOT NULL,
  to_year integer NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fiscal_rollovers_to_year ON fiscal_rollovers(to_year);
