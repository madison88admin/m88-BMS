-- Audit Log Retention Policy
-- This script sets up automatic cleanup of old audit logs
-- Retention period: 2 years (730 days)
-- Run this in Supabase SQL Editor

-- Enable pg_cron extension for scheduled jobs
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Create a function to delete old audit logs
CREATE OR REPLACE FUNCTION cleanup_old_audit_logs()
RETURNS void AS $$
BEGIN
  DELETE FROM request_audit_logs
  WHERE created_at < NOW() - INTERVAL '730 days';
  
  DELETE FROM approval_logs
  WHERE timestamp < NOW() - INTERVAL '730 days';
END;
$$ LANGUAGE plpgsql;

-- Schedule the cleanup job to run daily at 2 AM UTC
SELECT cron.schedule(
  'cleanup-audit-logs',
  '0 2 * * *', -- Every day at 2 AM UTC
  'SELECT cleanup_old_audit_logs();'
);

-- Verify the scheduled job
SELECT * FROM cron.job WHERE jobname = 'cleanup-audit-logs';

-- Manual cleanup (run immediately if needed)
SELECT cleanup_old_audit_logs();

-- Check how many records would be deleted (without actually deleting)
SELECT 
  COUNT(*) as audit_logs_to_delete
FROM request_audit_logs
WHERE created_at < NOW() - INTERVAL '730 days';

SELECT 
  COUNT(*) as approval_logs_to_delete
FROM approval_logs
WHERE timestamp < NOW() - INTERVAL '730 days';

-- View current audit log counts
SELECT 
  'request_audit_logs' as table_name,
  COUNT(*) as record_count,
  MIN(created_at) as oldest_record,
  MAX(created_at) as newest_record
FROM request_audit_logs
UNION ALL
SELECT 
  'approval_logs' as table_name,
  COUNT(*) as record_count,
  MIN(timestamp) as oldest_record,
  MAX(timestamp) as newest_record
FROM approval_logs;

-- To adjust retention period, modify the INTERVAL value in the function
-- Examples:
-- 1 year: INTERVAL '365 days'
-- 6 months: INTERVAL '180 days'
-- 3 years: INTERVAL '1095 days'
