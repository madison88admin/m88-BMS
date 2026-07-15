-- Check request_items for latest test request
\echo '=== request_items for REQ-00016 ==='
SELECT ri.id, ri.item_name, ri.category_id, ri.amount
FROM "M88_BMS".request_items ri
JOIN "M88_BMS".expense_requests r ON r.id = ri.request_id
WHERE r.request_code = 'REQ-00016'
ORDER BY ri.created_at;
