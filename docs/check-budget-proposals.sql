-- Check budget proposals and their status
SELECT 
  id,
  request_code,
  request_type,
  status,
  employee_id,
  department_id,
  amount,
  updated_at,
  submitted_at
FROM expense_requests
WHERE request_type IN ('budget_request', 'budget_revision')
ORDER BY updated_at DESC;

-- Check all budget proposals with department info
SELECT 
  er.id,
  er.request_code,
  er.request_type,
  er.status,
  er.amount,
  d.name as department_name,
  u.name as employee_name,
  er.updated_at,
  er.submitted_at
FROM expense_requests er
LEFT JOIN departments d ON er.department_id = d.id
LEFT JOIN users u ON er.employee_id = u.id
WHERE er.request_type IN ('budget_request', 'budget_revision')
ORDER BY er.updated_at DESC;

-- Check budget proposals by status
SELECT 
  status,
  COUNT(*) as count
FROM expense_requests
WHERE request_type IN ('budget_request', 'budget_revision')
GROUP BY status;
