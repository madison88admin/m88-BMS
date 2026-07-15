#!/bin/bash
set -e

echo "=========================================="
echo "  BMS END-TO-END SYSTEM TEST"
echo "=========================================="
echo ""

# 1. Health check
echo "--- 1. Health Check ---"
curl -s http://localhost:3002/api/system/health
echo ""
echo ""

# 2. Login as Alice Admin
echo "--- 2. Login (Alice Admin) ---"
LOGIN_RESP=$(curl -s -X POST http://localhost:3002/api/auth/login -H 'Content-Type: application/json' -d '{"email":"alice.admin@madison88.com","password":"password123"}')
TOKEN=$(echo "$LOGIN_RESP" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("token",""))' 2>/dev/null)
if [ -z "$TOKEN" ]; then
  echo "FAILED: No token received"
  echo "$LOGIN_RESP"
  exit 1
fi
USER_INFO=$(echo "$LOGIN_RESP" | python3 -c 'import sys,json; d=json.load(sys.stdin)["user"]; print(d["name"]+" ("+d["role"]+")")' 2>/dev/null)
echo "OK: Logged in as $USER_INFO"
echo ""

# 3. Auth: /me
echo "--- 3. GET /api/auth/me ---"
curl -s http://localhost:3002/api/auth/me -H "Authorization: Bearer $TOKEN" | python3 -c 'import sys,json; d=json.load(sys.stdin); print("OK: "+d["name"]+" | "+d["email"]+" | role="+d["role"]+" | dept="+str(d.get("department",{}).get("name","N/A")))' 2>/dev/null || echo "FAILED"
echo ""

# 4. Auth: list users
echo "--- 4. GET /api/auth/users ---"
curl -s http://localhost:3002/api/auth/users -H "Authorization: Bearer $TOKEN" | python3 -c 'import sys,json; d=json.load(sys.stdin); print("OK: "+str(len(d))+" users")' 2>/dev/null || echo "FAILED"
echo ""

# 5. Departments
echo "--- 5. GET /api/departments ---"
curl -s http://localhost:3002/api/departments -H "Authorization: Bearer $TOKEN" | python3 -c 'import sys,json; d=json.load(sys.stdin); print("OK: "+str(len(d))+" departments")' 2>/dev/null || echo "FAILED"
echo ""

# 6. Expense requests (tickets)
echo "--- 6. GET /api/requests ---"
curl -s http://localhost:3002/api/requests -H "Authorization: Bearer $TOKEN" | python3 -c 'import sys,json; d=json.load(sys.stdin); items=d if isinstance(d,list) else d.get("data",d.get("requests",[])); print("OK: "+str(len(items))+" requests")' 2>/dev/null || echo "FAILED"
echo ""

# 7. Budget categories
echo "--- 7. GET /api/budget/categories ---"
curl -s 'http://localhost:3002/api/budget/categories?fiscal_year=2026' -H "Authorization: Bearer $TOKEN" | python3 -c 'import sys,json; d=json.load(sys.stdin); items=d if isinstance(d,list) else d.get("data",[]); print("OK: "+str(len(items))+" categories")' 2>/dev/null || echo "FAILED"
echo ""

# 8. Budget summary
echo "--- 8. GET /api/budget/summary ---"
curl -s 'http://localhost:3002/api/budget/summary?fiscal_year=2026' -H "Authorization: Bearer $TOKEN" | python3 -c 'import sys,json; d=json.load(sys.stdin); print("OK: "+str(d)[:200])' 2>/dev/null || echo "FAILED"
echo ""

# 9. Cost centers (budget)
echo "--- 9. GET /api/budget/cost-centers ---"
curl -s http://localhost:3002/api/budget/cost-centers -H "Authorization: Bearer $TOKEN" | python3 -c 'import sys,json; d=json.load(sys.stdin); items=d if isinstance(d,list) else d.get("data",[]); print("OK: "+str(len(items))+" cost centers")' 2>/dev/null || echo "FAILED"
echo ""

# 10. Budget monitoring
echo "--- 10. GET /api/budget/monitoring ---"
curl -s 'http://localhost:3002/api/budget/monitoring?fiscal_year=2026' -H "Authorization: Bearer $TOKEN" | python3 -c 'import sys,json; d=json.load(sys.stdin); print("OK: "+str(d)[:200])' 2>/dev/null || echo "FAILED"
echo ""

# 11. Notifications
echo "--- 11. GET /api/notifications ---"
curl -s http://localhost:3002/api/notifications -H "Authorization: Bearer $TOKEN" | python3 -c 'import sys,json; d=json.load(sys.stdin); items=d if isinstance(d,list) else d.get("data",d.get("notifications",[])); print("OK: "+str(len(items))+" notifications")' 2>/dev/null || echo "FAILED"
echo ""

# 12. Direct expenses
echo "--- 12. GET /api/expenses ---"
curl -s http://localhost:3002/api/expenses -H "Authorization: Bearer $TOKEN" | python3 -c 'import sys,json; d=json.load(sys.stdin); items=d if isinstance(d,list) else d.get("data",[]); print("OK: "+str(len(items))+" direct expenses")' 2>/dev/null || echo "FAILED"
echo ""

# 13. Petty cash
echo "--- 13. GET /api/petty-cash ---"
curl -s http://localhost:3002/api/petty-cash -H "Authorization: Bearer $TOKEN" | python3 -c 'import sys,json; d=json.load(sys.stdin); items=d if isinstance(d,list) else d.get("data",[]); print("OK: "+str(len(items))+" petty cash transactions")' 2>/dev/null || echo "FAILED"
echo ""

# 14. Projects
echo "--- 14. GET /api/projects ---"
curl -s http://localhost:3002/api/projects -H "Authorization: Bearer $TOKEN" | python3 -c 'import sys,json; d=json.load(sys.stdin); items=d if isinstance(d,list) else d.get("data",d.get("projects",[])); print("OK: "+str(len(items))+" projects")' 2>/dev/null || echo "FAILED"
echo ""

# 15. Vendors
echo "--- 15. GET /api/vendors ---"
curl -s http://localhost:3002/api/vendors -H "Authorization: Bearer $TOKEN" | python3 -c 'import sys,json; d=json.load(sys.stdin); items=d if isinstance(d,list) else d.get("data",d.get("vendors",[])); print("OK: "+str(len(items))+" vendors")' 2>/dev/null || echo "FAILED"
echo ""

# 16. SLA policies
echo "--- 16. GET /api/sla ---"
curl -s http://localhost:3002/api/sla -H "Authorization: Bearer $TOKEN" | python3 -c 'import sys,json; d=json.load(sys.stdin); items=d if isinstance(d,list) else d.get("data",d.get("policies",[])); print("OK: "+str(len(items))+" SLA policies")' 2>/dev/null || echo "FAILED"
echo ""

# 17. Budget alerts
echo "--- 17. GET /api/budget-alerts ---"
curl -s http://localhost:3002/api/budget-alerts -H "Authorization: Bearer $TOKEN" | python3 -c 'import sys,json; d=json.load(sys.stdin); items=d if isinstance(d,list) else d.get("data",[]); print("OK: "+str(len(items))+" budget alerts")' 2>/dev/null || echo "FAILED"
echo ""

# 18. Cash advances
echo "--- 18. GET /api/cash-advances ---"
curl -s http://localhost:3002/api/cash-advances -H "Authorization: Bearer $TOKEN" | python3 -c 'import sys,json; d=json.load(sys.stdin); items=d if isinstance(d,list) else d.get("data",d.get("advances",[])); print("OK: "+str(len(items))+" cash advances")' 2>/dev/null || echo "FAILED"
echo ""

# 19. Audit logs
echo "--- 19. GET /api/audit-logs ---"
curl -s 'http://localhost:3002/api/audit-logs?limit=5' -H "Authorization: Bearer $TOKEN" | python3 -c 'import sys,json; d=json.load(sys.stdin); items=d if isinstance(d,list) else d.get("data",d.get("logs",[])); print("OK: "+str(len(items))+" audit logs (limit 5)")' 2>/dev/null || echo "FAILED"
echo ""

# 20. Document uploads
echo "--- 20. GET /api/document-uploads ---"
curl -s http://localhost:3002/api/document-uploads -H "Authorization: Bearer $TOKEN" | python3 -c 'import sys,json; d=json.load(sys.stdin); items=d if isinstance(d,list) else d.get("data",[]); print("OK: "+str(len(items))+" document uploads")' 2>/dev/null || echo "FAILED"
echo ""

# 21. Fiscal year
echo "--- 21. GET /api/fiscal-year ---"
curl -s http://localhost:3002/api/fiscal-year -H "Authorization: Bearer $TOKEN" | python3 -c 'import sys,json; d=json.load(sys.stdin); print("OK: "+str(d)[:200])' 2>/dev/null || echo "FAILED"
echo ""

# 22. Cost centers (direct)
echo "--- 22. GET /api/cost-centers ---"
curl -s http://localhost:3002/api/cost-centers -H "Authorization: Bearer $TOKEN" | python3 -c 'import sys,json; d=json.load(sys.stdin); items=d if isinstance(d,list) else d.get("data",[]); print("OK: "+str(len(items))+" cost centers")' 2>/dev/null || echo "FAILED"
echo ""

# 23. Delegation candidates
echo "--- 23. GET /api/auth/delegation-candidates ---"
curl -s http://localhost:3002/api/auth/delegation-candidates -H "Authorization: Bearer $TOKEN" | python3 -c 'import sys,json; d=json.load(sys.stdin); items=d if isinstance(d,list) else d.get("data",[]); print("OK: "+str(len(items))+" delegation candidates")' 2>/dev/null || echo "FAILED"
echo ""

# 24. Config
echo "--- 24. GET /api/config ---"
curl -s http://localhost:3002/api/config -H "Authorization: Bearer $TOKEN" | python3 -c 'import sys,json; d=json.load(sys.stdin); print("OK: "+str(d)[:200])' 2>/dev/null || echo "FAILED"
echo ""

# 25. 404 handling
echo "--- 25. Unknown route (404) ---"
curl -s http://localhost:3002/api/nonexistent | python3 -c 'import sys,json; d=json.load(sys.stdin); print("OK: "+d["error"]+" - "+d["code"])' 2>/dev/null || echo "FAILED"
echo ""

# 26. Service status
echo "--- 26. Systemd Service ---"
echo "Active: $(systemctl is-active bms-backend)"
echo "Enabled: $(systemctl is-enabled bms-backend)"
echo ""

# 27. Error log check
echo "--- 27. Error log check (last 50 lines) ---"
ERRORS=$(journalctl -u bms-backend --no-pager -n 50 2>&1 | grep -iE "error|fail|crash|exception" | grep -v "Invalid credentials" | grep -v "Route not found" | grep -v "Brevo" | grep -v "unrecognised IP" | grep -v "401" || true)
if [ -z "$ERRORS" ]; then
  echo "OK: No errors in recent logs"
else
  echo "WARN: Found errors:"
  echo "$ERRORS"
fi
echo ""

echo "=========================================="
echo "  E2E TEST COMPLETE"
echo "=========================================="
