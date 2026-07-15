-- Fix missing cash_advance_id column in request_liquidations
\echo '=== Adding cash_advance_id column ==='
ALTER TABLE "M88_BMS".request_liquidations 
ADD COLUMN IF NOT EXISTS cash_advance_id UUID REFERENCES "M88_BMS".cash_advances(id) ON DELETE SET NULL;

\echo '=== Verifying ==='
SELECT column_name, data_type FROM information_schema.columns 
WHERE table_schema='M88_BMS' AND table_name='request_liquidations' AND column_name='cash_advance_id';
