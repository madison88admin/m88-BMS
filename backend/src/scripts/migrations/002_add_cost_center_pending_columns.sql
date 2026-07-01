-- Add pending tracking columns to cost_centers for M88 Manila general budget
ALTER TABLE cost_centers
ADD COLUMN IF NOT EXISTS pending_amount NUMERIC NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS pending_count INTEGER NOT NULL DEFAULT 0;

-- Add index for pending amount lookups
CREATE INDEX IF NOT EXISTS cost_centers_pending_amount_idx
ON cost_centers (pending_amount);

COMMENT ON COLUMN cost_centers.pending_amount IS 'Total amount of pending general-category requests against this cost center';
COMMENT ON COLUMN cost_centers.pending_count IS 'Number of pending general-category requests against this cost center';
