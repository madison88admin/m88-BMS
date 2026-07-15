-- Investigate issues
\echo '=== 1. Sarah Super Admin ==='
SELECT id, email, name, role FROM "M88_BMS".users WHERE email LIKE '%sarah%' OR email LIKE '%super%' LIMIT 5;

\echo '=== 2. All Users ==='
SELECT email, name, role FROM "M88_BMS".users ORDER BY role, email;

\echo '=== 3. request_liquidations columns ==='
SELECT column_name FROM information_schema.columns WHERE table_schema='M88_BMS' AND table_name='request_liquidations' ORDER BY ordinal_position;

\echo '=== 4. Check if cash_advance_id exists ==='
SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='M88_BMS' AND table_name='request_liquidations' AND column_name='cash_advance_id') as has_cash_advance_id;
