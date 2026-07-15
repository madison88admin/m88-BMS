-- Check request columns and recent requests
\echo '=== expense_requests columns ==='
SELECT column_name FROM information_schema.columns 
WHERE table_schema='M88_BMS' AND table_name='expense_requests' ORDER BY ordinal_position;

\echo '=== Recent requests ==='
SELECT r.request_code, r.request_type, r.status, r.amount, r.department_id,
       u.email as submitter_email, u.role as submitter_role
FROM "M88_BMS".expense_requests r
LEFT JOIN "M88_BMS".users u ON u.id = r.employee_id
ORDER BY r.submitted_at DESC LIMIT 10;

\echo '=== Departments table columns ==='
SELECT column_name FROM information_schema.columns 
WHERE table_schema='M88_BMS' AND table_name='departments' ORDER BY ordinal_position;
