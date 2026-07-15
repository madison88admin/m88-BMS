-- Check all stuck requests by status
\echo '=== Request Status Distribution ==='
SELECT status, request_type, COUNT(*) as count
FROM "M88_BMS".expense_requests
GROUP BY status, request_type
ORDER BY status, request_type;

\echo '=== Requests stuck in pending_supervisor (no supervisor for that dept) ==='
SELECT r.request_code, r.request_type, r.status, r.amount, r.department_id,
       d.name as dept_name,
       u.email as submitter_email, u.role as submitter_role,
       r.submitted_at
FROM "M88_BMS".expense_requests r
LEFT JOIN "M88_BMS".departments d ON d.id = r.department_id
LEFT JOIN "M88_BMS".users u ON u.id = r.employee_id
WHERE r.status = 'pending_supervisor'
ORDER BY r.submitted_at;

\echo '=== Requests stuck in pending_accounting ==='
SELECT r.request_code, r.request_type, r.status, r.amount,
       d.name as dept_name,
       u.email as submitter_email,
       r.submitted_at
FROM "M88_BMS".expense_requests r
LEFT JOIN "M88_BMS".departments d ON d.id = r.department_id
LEFT JOIN "M88_BMS".users u ON u.id = r.employee_id
WHERE r.status = 'pending_accounting'
ORDER BY r.submitted_at;

\echo '=== Requests stuck in pending_vp ==='
SELECT r.request_code, r.request_type, r.status, r.amount,
       d.name as dept_name,
       u.email as submitter_email,
       r.submitted_at
FROM "M88_BMS".expense_requests r
LEFT JOIN "M88_BMS".departments d ON d.id = r.department_id
LEFT JOIN "M88_BMS".users u ON u.id = r.employee_id
WHERE r.status = 'pending_vp'
ORDER BY r.submitted_at;

\echo '=== Requests stuck in pending_president ==='
SELECT r.request_code, r.request_type, r.status, r.amount,
       d.name as dept_name,
       u.email as submitter_email,
       r.submitted_at
FROM "M88_BMS".expense_requests r
LEFT JOIN "M88_BMS".departments d ON d.id = r.department_id
LEFT JOIN "M88_BMS".users u ON u.id = r.employee_id
WHERE r.status = 'pending_president'
ORDER BY r.submitted_at;

\echo '=== Requests on_hold ==='
SELECT r.request_code, r.request_type, r.status, r.amount,
       d.name as dept_name, r.on_hold_reason, r.on_hold_at
FROM "M88_BMS".expense_requests r
LEFT JOIN "M88_BMS".departments d ON d.id = r.department_id
WHERE r.status = 'on_hold'
ORDER BY r.on_hold_at;

\echo '=== Supervisors per department ==='
SELECT d.name as dept_name, u.email, u.name
FROM "M88_BMS".departments d
LEFT JOIN "M88_BMS".users u ON u.department_id = d.id AND u.role = 'supervisor'
ORDER BY d.name;

\echo '=== Cash advances awaiting liquidation ==='
SELECT r.request_code, r.status, r.amount,
       d.name as dept_name,
       u.email as submitter_email
FROM "M88_BMS".expense_requests r
LEFT JOIN "M88_BMS".departments d ON d.id = r.department_id
LEFT JOIN "M88_BMS".users u ON u.id = r.employee_id
WHERE r.request_type = 'cash_advance' AND r.status = 'approved'
ORDER BY r.submitted_at;
