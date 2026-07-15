SET search_path TO "M88_BMS", public;
SET session_replication_role = 'replica';

ALTER TABLE "M88_BMS".cash_advances ADD COLUMN IF NOT EXISTS liquidation_rejection_reason TEXT;
ALTER TABLE "M88_BMS".cash_advances ADD COLUMN IF NOT EXISTS liquidation_rejected_at TIMESTAMPTZ;
ALTER TABLE "M88_BMS".cash_advances ADD COLUMN IF NOT EXISTS liquidation_rejected_by UUID;

DELETE FROM "M88_BMS".cash_advances;
INSERT INTO "M88_BMS".cash_advances ("id", "request_id", "employee_id", "department_id", "advance_code", "amount_issued", "amount_liquidated", "balance", "expected_liquidation_date", "liquidation_due_at", "purpose", "status", "issued_at", "issued_by", "fully_liquidated_at", "created_at", "updated_at", "liquidation_approved_by", "liquidation_approved_at", "liquidation_rejection_reason") VALUES
('bc9bbbd0-92a9-4582-b282-264ed810928a', 'a1c9f447-3995-436b-ab3c-aceb54bde073', 'b9ffa29a-2b06-4e95-aba7-cc75658bc504', '1320d89d-5b10-457e-a335-c4f80bc6e3db', 'CA-1780875977327', 300, 0, 300, NULL, NULL, 'dfsdf', 'outstanding', '2026-06-07T23:46:17.327', '7e3c7577-b904-4f3f-ab29-155dc772a758', NULL, '2026-06-07T23:46:17.327', '2026-06-07T23:46:17.327', NULL, NULL, NULL);

-- No data for liquidation_items

-- No data for request_liquidations

-- No data for request_attachments

SET session_replication_role = 'origin';

SELECT 'cash_advances' as t, count(*) as c FROM "M88_BMS".cash_advances
UNION ALL
SELECT 'liquidation_items', count(*) FROM "M88_BMS".liquidation_items
UNION ALL
SELECT 'request_liquidations', count(*) FROM "M88_BMS".request_liquidations
UNION ALL
SELECT 'request_attachments', count(*) FROM "M88_BMS".request_attachments;
