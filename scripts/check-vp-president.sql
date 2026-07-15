-- Check VP and President users
\echo '=== VP and President users ==='
SELECT u.id, u.email, u.name, u.role, u.department_id, d.name as dept_name
FROM "M88_BMS".users u
LEFT JOIN "M88_BMS".departments d ON d.id = u.department_id
WHERE u.role IN ('vp', 'president')
ORDER BY u.role;

\echo '=== Requests pending VP approval ==='
SELECT r.request_code, r.request_type, r.status, r.amount,
       d.name as dept_name, u.email as submitter_email
FROM "M88_BMS".expense_requests r
LEFT JOIN "M88_BMS".departments d ON d.id = r.department_id
LEFT JOIN "M88_BMS".users u ON u.id = r.employee_id
WHERE r.status = 'pending_vp'
ORDER BY r.submitted_at;

\echo '=== Requests pending President approval ==='
SELECT r.request_code, r.request_type, r.status, r.amount,
       d.name as dept_name, u.email as submitter_email
FROM "M88_BMS".expense_requests r
LEFT JOIN "M88_BMS".departments d ON d.id = r.department_id
LEFT JOIN "M88_BMS".users u ON u.id = r.employee_id
WHERE r.status = 'pending_president'
ORDER BY r.submitted_at;

\echo '=== Approval logs - recent activity ==='
SELECT al.request_id, al.actor_id, al.action, al.stage, al.note,
       u.email as actor_email, u.role as actor_role
FROM "M88_BMS".approval_logs al
LEFT JOIN "M88_BMS".users u ON u.id = al.actor_id
ORDER BY al.id DESC LIMIT 20;

\echo '=== All users with roles (for reference) ==='
SELECT email, name, role FROM "M88_BMS".users ORDER BY role, email;
