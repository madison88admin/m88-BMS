-- Add cash return columns to request_liquidations table
-- Run this in Supabase SQL Editor

ALTER TABLE request_liquidations 
ADD COLUMN IF NOT EXISTS cash_return_status TEXT,
ADD COLUMN IF NOT EXISTS cash_returned_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS cash_returned_confirmed_by TEXT;

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_request_liquidations_cash_return_status 
ON request_liquidations(cash_return_status);

-- Add comment
COMMENT ON COLUMN request_liquidations.cash_return_status IS 'Status of cash return: pending_return, returned, or null';
COMMENT ON COLUMN request_liquidations.cash_returned_at IS 'Timestamp when cash return was confirmed';
COMMENT ON COLUMN request_liquidations.cash_returned_confirmed_by IS 'User ID who confirmed the cash return';
