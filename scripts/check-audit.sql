-- Check audit logs tables
\echo '=== audit_logs count ==='
SELECT COUNT(*) as total FROM "M88_BMS".audit_logs;

\echo '=== audit_logs recent entries ==='
SELECT action_type, record_type, record_label, user_name, user_role, created_at
FROM "M88_BMS".audit_logs ORDER BY created_at DESC LIMIT 10;

\echo '=== approval_logs count ==='
SELECT COUNT(*) as total FROM "M88_BMS".approval_logs;

\echo '=== approval_logs recent entries ==='
SELECT request_id, actor_id, action, stage, note, timestamp
FROM "M88_BMS".approval_logs ORDER BY timestamp DESC LIMIT 10;

\echo '=== request_audit_logs count ==='
SELECT COUNT(*) as total FROM "M88_BMS".request_audit_logs;

\echo '=== request_audit_logs recent entries ==='
SELECT request_id, actor_id, entity_type, action, field_name, old_value, new_value, created_at
FROM "M88_BMS".request_audit_logs ORDER BY created_at DESC LIMIT 10;

\echo '=== allocation_logs count ==='
SELECT COUNT(*) as total FROM "M88_BMS".allocation_logs;

\echo '=== Check if submit actions are logged ==='
SELECT action_type, record_type, COUNT(*) as count
FROM "M88_BMS".audit_logs 
GROUP BY action_type, record_type ORDER BY count DESC;

\echo '=== approval_logs action distribution ==='
SELECT action, stage, COUNT(*) as count
FROM "M88_BMS".approval_logs 
GROUP BY action, stage ORDER BY count DESC;
