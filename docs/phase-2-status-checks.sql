-- Phase 2: Status Cleanup Database Checks
-- Run these queries in Supabase SQL Editor to check for existing records before status removal

-- Check draft records in expense_requests
SELECT COUNT(*) as draft_count FROM expense_requests WHERE status = 'draft';

-- Check allocated usage in expense_requests
SELECT COUNT(*) as allocated_count FROM expense_requests WHERE status = 'allocated';

-- Check all statuses in document_uploads
SELECT status, COUNT(*) as count FROM document_uploads GROUP BY status;

-- Additional check: List all unique statuses in expense_requests
SELECT status, COUNT(*) as count FROM expense_requests GROUP BY status ORDER BY status;

-- Additional check: List all unique statuses in request_liquidations
SELECT status, COUNT(*) as count FROM request_liquidations GROUP BY status ORDER BY status;
