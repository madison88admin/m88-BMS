-- Cleanup Orphaned Request Allocations
-- This script removes request_allocations that reference non-existent expense_requests
-- Run this periodically to maintain data integrity

-- View orphaned allocations before deletion
SELECT 
  ra.id,
  ra.request_id,
  ra.department_id,
  ra.amount,
  ra.created_at
FROM request_allocations ra
LEFT JOIN expense_requests er ON ra.request_id = er.id
WHERE er.id IS NULL;

-- Delete orphaned allocations
DELETE FROM request_allocations
WHERE request_id NOT IN (SELECT id FROM expense_requests);

-- Verify cleanup
SELECT COUNT(*) as remaining_allocations
FROM request_allocations;

-- View allocations with orphaned department references
SELECT 
  ra.id,
  ra.request_id,
  ra.department_id,
  ra.amount,
  ra.created_at
FROM request_allocations ra
LEFT JOIN departments d ON ra.department_id = d.id
WHERE d.id IS NULL;

-- Delete allocations with orphaned department references
DELETE FROM request_allocations
WHERE department_id NOT IN (SELECT id FROM departments);

-- Final verification
SELECT COUNT(*) as final_allocation_count
FROM request_allocations;
