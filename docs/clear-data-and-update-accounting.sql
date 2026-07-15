-- ============================================================
-- Clear all ticket & money data + update accounting user
-- Schema: M88_BMS
-- ============================================================

SET search_path TO "M88_BMS", public;

-- ============================================================
-- PART 1: Clear all transactional data (tickets & pera)
-- ============================================================

-- 1. Delete liquidation items
DELETE FROM "M88_BMS".liquidation_items;

-- 2. Delete request liquidations
DELETE FROM "M88_BMS".request_liquidations;

-- 3. Delete request attachments
DELETE FROM "M88_BMS".request_attachments;

-- 4. Delete request items
DELETE FROM "M88_BMS".request_items;

-- 5. Delete cash advances
DELETE FROM "M88_BMS".cash_advances;

-- 6. Delete travel booking sub-tables
DELETE FROM "M88_BMS".travel_booking_flights;
DELETE FROM "M88_BMS".travel_booking_hotels;

-- 7. Delete travel bookings
DELETE FROM "M88_BMS".travel_bookings;

-- 8. Delete expense requests (tickets)
DELETE FROM "M88_BMS".expense_requests;

-- 9. Delete petty cash transactions
DELETE FROM "M88_BMS".petty_cash_transactions;

-- 10. Reset petty cash fund balances to 0
UPDATE "M88_BMS".petty_cash_fund SET balance = 0, updated_at = NOW();

-- 11. Delete direct expenses
DELETE FROM "M88_BMS".direct_expenses;

-- 12. Delete document uploads (budget adjustments)
DELETE FROM "M88_BMS".document_uploads;

-- 13. Delete audit logs (references tickets that no longer exist)
DELETE FROM "M88_BMS".audit_logs;

-- 14. Delete notifications (references tickets that no longer exist)
DELETE FROM "M88_BMS".notifications;

-- 15. Delete SLA compliance records (references liquidations)
DELETE FROM "M88_BMS".sla_compliance;

-- 16. Delete cost allocations (references requests/direct expenses)
DELETE FROM "M88_BMS".cost_allocations;

-- ============================================================
-- PART 2: Reset budget category utilization to zero
-- (budget amounts stay, but used/committed are reset)
-- ============================================================
UPDATE "M88_BMS".budget_categories
SET used_amount = 0,
    committed_amount = 0,
    remaining_amount = budget_amount,
    is_locked = false,
    locked_at = NULL,
    updated_at = NOW();

-- ============================================================
-- PART 3: Update accounting user email
-- From: bob.accounting@madison88.com
-- To:   michael@madison88.com
-- ============================================================
UPDATE "M88_BMS".users
SET email = 'michael@madison88.com',
    name = 'Michael Accounting',
    updated_at = NOW()
WHERE email = 'bob.accounting@madison88.com';

-- Also check if the email was already changed or the user uses a different email pattern
-- If no rows were updated, try these alternative queries:
-- UPDATE "M88_BMS".users SET email = 'michael@madison88.com', updated_at = NOW() WHERE email ILIKE '%bob%accounting%';
-- UPDATE "M88_BMS".users SET email = 'michael@madison88.com', updated_at = NOW() WHERE role = 'accounting' AND email ILIKE '%bob%';

-- ============================================================
-- PART 4: Verification queries
-- ============================================================

-- Verify tickets are cleared
SELECT 'expense_requests count' as check_name, count(*) as remaining FROM "M88_BMS".expense_requests
UNION ALL
SELECT 'cash_advances count', count(*) FROM "M88_BMS".cash_advances
UNION ALL
SELECT 'request_liquidations count', count(*) FROM "M88_BMS".request_liquidations
UNION ALL
SELECT 'liquidation_items count', count(*) FROM "M88_BMS".liquidation_items
UNION ALL
SELECT 'direct_expenses count', count(*) FROM "M88_BMS".direct_expenses
UNION ALL
SELECT 'petty_cash_transactions count', count(*) FROM "M88_BMS".petty_cash_transactions
UNION ALL
SELECT 'document_uploads count', count(*) FROM "M88_BMS".document_uploads
UNION ALL
SELECT 'travel_bookings count', count(*) FROM "M88_BMS".travel_bookings;

-- Verify accounting user
SELECT id, name, email, role FROM "M88_BMS".users WHERE role = 'accounting';

-- Verify budget categories are reset
SELECT count(*) as total_categories,
       count(*) FILTER (WHERE used_amount = 0) as zero_used,
       count(*) FILTER (WHERE committed_amount = 0) as zero_committed
FROM "M88_BMS".budget_categories;
