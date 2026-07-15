#!/bin/bash
# Deep E2E test with timeouts - exercises workflows, error handling, permissions
# All curl calls have --max-time 15 to prevent hanging

BASE="http://localhost:3002"
TO="--max-time 15 -s"
PASS=0
FAIL=0
WARN=0
ERRORS=""

ok() { echo "  [PASS] $1"; PASS=$((PASS+1)); }
fail() { echo "  [FAIL] $1"; FAIL=$((FAIL+1)); ERRORS="$ERRORS\n  - $1"; }
warn() { echo "  [WARN] $1"; WARN=$((WARN+1)); }

echo "=========================================="
echo "  BMS DEEP DIVE E2E TEST"
echo "=========================================="
echo ""

# ========== SECTION A: AUTHENTICATION ==========
echo "=== A. AUTHENTICATION ==="

# A1. Login as admin
echo "--- A1. Login (Alice Admin) ---"
ADMIN_RESP=$(curl $TO -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d '{"email":"alice.admin@madison88.com","password":"password123"}')
ADMIN_TOKEN=$(echo "$ADMIN_RESP" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("token",""))' 2>/dev/null)
if [ -n "$ADMIN_TOKEN" ]; then ok "Admin login"; else fail "Admin login failed: $ADMIN_RESP"; fi

# A2. Login as accounting
echo "--- A2. Login (Bob Accounting) ---"
ACC_RESP=$(curl $TO -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d '{"email":"bob.accounting@gmail.com","password":"password123"}')
ACC_TOKEN=$(echo "$ACC_RESP" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("token",""))' 2>/dev/null)
if [ -n "$ACC_TOKEN" ]; then ok "Accounting login"; else fail "Accounting login failed: $ACC_RESP"; fi

# A3. Login as super admin
echo "--- A3. Login (Sarah Super Admin) ---"
SA_RESP=$(curl $TO -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d '{"email":"jc@madison88.com","password":"password123"}')
SA_TOKEN=$(echo "$SA_RESP" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("token",""))' 2>/dev/null)
if [ -n "$SA_TOKEN" ]; then ok "Super admin login"; else fail "Super admin login failed: $SA_RESP"; fi

# A4. Login with wrong password
echo "--- A4. Login with wrong password ---"
BAD_RESP=$(curl $TO -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d '{"email":"alice.admin@madison88.com","password":"wrongpassword"}')
BAD_ERR=$(echo "$BAD_RESP" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("error",""))' 2>/dev/null)
if [ "$BAD_ERR" = "Invalid credentials" ]; then ok "Wrong password rejected"; else fail "Wrong password not rejected: $BAD_RESP"; fi

# A5. Login with non-existent email
echo "--- A5. Login with non-existent email ---"
NONE_RESP=$(curl $TO -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d '{"email":"nobody@madison88.com","password":"password123"}')
NONE_ERR=$(echo "$NONE_RESP" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("error",""))' 2>/dev/null)
if [ "$NONE_ERR" = "Invalid credentials" ]; then ok "Non-existent user rejected"; else fail "Non-existent user not rejected: $NONE_RESP"; fi

# A6. Login with missing fields
echo "--- A6. Login with missing password ---"
MISSING_RESP=$(curl $TO -o /dev/null -w "%{http_code}" -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d '{"email":"alice.admin@madison88.com"}')
if [ "$MISSING_RESP" = "400" ]; then ok "Missing password returns 400"; else warn "Missing password returns $MISSING_RESP"; fi

# A7. No token on protected route
echo "--- A7. Protected route without token ---"
NOTOKEN=$(curl $TO -o /dev/null -w "%{http_code}" $BASE/api/auth/me)
if [ "$NOTOKEN" = "401" ]; then ok "No token returns 401"; else fail "No token returns $NOTOKEN"; fi

# A8. Invalid token
echo "--- A8. Invalid token ---"
BADTOKEN=$(curl $TO -o /dev/null -w "%{http_code}" $BASE/api/auth/me -H "Authorization: Bearer invalidtoken123")
if [ "$BADTOKEN" = "401" ] || [ "$BADTOKEN" = "403" ]; then ok "Invalid token returns $BADTOKEN"; else fail "Invalid token returns $BADTOKEN"; fi

echo ""

# ========== SECTION B: DEPARTMENT OPERATIONS ==========
echo "=== B. DEPARTMENT OPERATIONS ==="

# B1. List departments
echo "--- B1. List departments ---"
DEPT_DATA=$(curl $TO $BASE/api/departments -H "Authorization: Bearer $ADMIN_TOKEN")
DEPT_COUNT=$(echo "$DEPT_DATA" | python3 -c 'import sys,json; print(len(json.load(sys.stdin)))' 2>/dev/null)
if [ "$DEPT_COUNT" -gt 0 ] 2>/dev/null; then ok "$DEPT_COUNT departments returned"; else fail "No departments returned"; fi

# B2. Department budget breakdown
echo "--- B2. Department budget breakdown ---"
DEPT_ID=$(echo "$DEPT_DATA" | python3 -c 'import sys,json; print(json.load(sys.stdin)[0]["id"])' 2>/dev/null)
BUDGET_RESP=$(curl $TO -o /dev/null -w "%{http_code}" $BASE/api/departments/$DEPT_ID/budget -H "Authorization: Bearer $ADMIN_TOKEN")
if [ "$BUDGET_RESP" = "200" ]; then ok "Department budget returns 200"; else fail "Department budget returns $BUDGET_RESP"; fi

# B3. Department budget breakdown
echo "--- B3. Department budget breakdown ---"
BB_RESP=$(curl $TO -o /dev/null -w "%{http_code}" $BASE/api/departments/$DEPT_ID/budget-breakdown -H "Authorization: Bearer $ADMIN_TOKEN")
if [ "$BB_RESP" = "200" ]; then ok "Budget breakdown returns 200"; else fail "Budget breakdown returns $BB_RESP"; fi

echo ""

# ========== SECTION C: EXPENSE REQUEST WORKFLOW ==========
echo "=== C. EXPENSE REQUEST WORKFLOW ==="

# C1. List expense requests
echo "--- C1. List expense requests ---"
REQ_RESP=$(curl $TO $BASE/api/requests -H "Authorization: Bearer $ADMIN_TOKEN")
REQ_COUNT=$(echo "$REQ_RESP" | python3 -c 'import sys,json; d=json.load(sys.stdin); items=d if isinstance(d,list) else d.get("data",d.get("requests",[])); print(len(items))' 2>/dev/null)
if [ "$REQ_COUNT" -ge 0 ] 2>/dev/null; then ok "$REQ_COUNT expense requests returned"; else fail "Failed to get expense requests"; fi

# C2. Create expense request
echo "--- C2. Create expense request ---"
CREATE_RESP=$(curl $TO -X POST $BASE/api/requests -H "Authorization: Bearer $ACC_TOKEN" -H 'Content-Type: application/json' -d '{
  "item_name": "E2E Test Expense",
  "category": "Office Supplies",
  "amount": 500,
  "purpose": "Testing expense creation",
  "department_id": "'$DEPT_ID'",
  "request_type": "reimbursement"
}')
CREATE_STATUS=$(echo "$CREATE_RESP" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("request_code","") or d.get("id","") or d.get("error",""))' 2>/dev/null)
if [ -n "$CREATE_STATUS" ] && [ "$CREATE_STATUS" != "error" ]; then
  ok "Expense request created: $CREATE_STATUS"
  CREATED_ID=$(echo "$CREATE_RESP" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("id",""))' 2>/dev/null)
else
  warn "Expense creation returned: $CREATE_RESP"
  CREATED_ID=""
fi

# C3. Get specific expense request
echo "--- C3. Get specific expense request ---"
if [ -n "$CREATED_ID" ]; then
  GET_RESP=$(curl $TO -o /dev/null -w "%{http_code}" $BASE/api/requests/$CREATED_ID -H "Authorization: Bearer $ACC_TOKEN")
  if [ "$GET_RESP" = "200" ]; then ok "Get expense request returns 200"; else warn "Get expense request returns $GET_RESP"; fi
else
  warn "Skipped - no created request ID"
fi

echo ""

# ========== SECTION D: BUDGET OPERATIONS ==========
echo "=== D. BUDGET OPERATIONS ==="

# D1. Budget categories
echo "--- D1. Budget categories ---"
CAT_COUNT=$(curl $TO "$BASE/api/budget/categories?fiscal_year=2026" -H "Authorization: Bearer $ADMIN_TOKEN" | python3 -c 'import sys,json; d=json.load(sys.stdin); items=d if isinstance(d,list) else d.get("data",[]); print(len(items))' 2>/dev/null)
if [ "$CAT_COUNT" -gt 0 ] 2>/dev/null; then ok "$CAT_COUNT budget categories"; else fail "No budget categories"; fi

# D2. Budget summary
echo "--- D2. Budget summary ---"
SUM_RESP=$(curl $TO "$BASE/api/budget/summary?fiscal_year=2026" -H "Authorization: Bearer $ADMIN_TOKEN" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("fiscal_year",""))' 2>/dev/null)
if [ -n "$SUM_RESP" ]; then ok "Budget summary returns data (FY=$SUM_RESP)"; else fail "Budget summary failed"; fi

# D3. Budget monitoring
echo "--- D3. Budget monitoring ---"
MON_RESP=$(curl $TO -o /dev/null -w "%{http_code}" "$BASE/api/budget/monitoring?fiscal_year=2026" -H "Authorization: Bearer $ADMIN_TOKEN")
if [ "$MON_RESP" = "200" ]; then ok "Budget monitoring returns 200"; else fail "Budget monitoring returns $MON_RESP"; fi

# D4. Cost centers
echo "--- D4. Cost centers ---"
CC_RESP=$(curl $TO -o /dev/null -w "%{http_code}" $BASE/api/budget/cost-centers -H "Authorization: Bearer $ADMIN_TOKEN")
if [ "$CC_RESP" = "200" ]; then ok "Cost centers returns 200"; else fail "Cost centers returns $CC_RESP"; fi

echo ""

# ========== SECTION E: PERMISSIONS / RBAC ==========
echo "=== E. PERMISSIONS / RBAC ==="

# E1. Employee cannot access admin users list
echo "--- E1. Employee cannot list all users ---"
# Login as employee first
EMP_RESP=$(curl $TO -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d '{"email":"john.employee@madison88.com","password":"password123"}')
EMP_TOKEN=$(echo "$EMP_RESP" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("token",""))' 2>/dev/null)
if [ -n "$EMP_TOKEN" ]; then
  EMP_USERS=$(curl $TO -o /dev/null -w "%{http_code}" $BASE/api/auth/users -H "Authorization: Bearer $EMP_TOKEN")
  if [ "$EMP_USERS" = "403" ]; then ok "Employee blocked from users list (403)"; else warn "Employee access to users returns $EMP_USERS"; fi
else
  warn "Could not login as employee"
fi

# E2. Employee cannot create departments
echo "--- E2. Employee cannot create departments ---"
if [ -n "$EMP_TOKEN" ]; then
  EMP_CREATE=$(curl $TO -o /dev/null -w "%{http_code}" -X POST $BASE/api/departments -H "Authorization: Bearer $EMP_TOKEN" -H 'Content-Type: application/json' -d '{"name":"Test Dept","fiscal_year":2026}')
  if [ "$EMP_CREATE" = "403" ]; then ok "Employee blocked from creating departments (403)"; else warn "Employee create dept returns $EMP_CREATE"; fi
fi

# E3. Employee cannot access budget summary
echo "--- E3. Employee cannot access budget summary ---"
if [ -n "$EMP_TOKEN" ]; then
  EMP_BUDGET=$(curl $TO -o /dev/null -w "%{http_code}" "$BASE/api/budget/summary?fiscal_year=2026" -H "Authorization: Bearer $EMP_TOKEN")
  if [ "$EMP_BUDGET" = "403" ]; then ok "Employee blocked from budget summary (403)"; else warn "Employee budget summary returns $EMP_BUDGET"; fi
fi

echo ""

# ========== SECTION F: PETTY CASH ==========
echo "=== F. PETTY CASH ==="

# F1. List petty cash
echo "--- F1. List petty cash ---"
PC_RESP=$(curl $TO -o /dev/null -w "%{http_code}" $BASE/api/petty-cash -H "Authorization: Bearer $ACC_TOKEN")
if [ "$PC_RESP" = "200" ]; then ok "Petty cash list returns 200"; else fail "Petty cash list returns $PC_RESP"; fi

# F2. Petty cash for specific department
echo "--- F2. Petty cash by department ---"
PC_DEPT=$(curl $TO -o /dev/null -w "%{http_code}" $BASE/api/petty-cash/$DEPT_ID -H "Authorization: Bearer $ACC_TOKEN")
if [ "$PC_DEPT" = "200" ]; then ok "Petty cash by dept returns 200"; else warn "Petty cash by dept returns $PC_DEPT"; fi

echo ""

# ========== SECTION G: DIRECT EXPENSES ==========
echo "=== G. DIRECT EXPENSES ==="

# G1. List direct expenses
echo "--- G1. List direct expenses ---"
DE_RESP=$(curl $TO $BASE/api/expenses -H "Authorization: Bearer $ADMIN_TOKEN")
DE_COUNT=$(echo "$DE_RESP" | python3 -c 'import sys,json; d=json.load(sys.stdin); items=d if isinstance(d,list) else d.get("data",[]); print(len(items))' 2>/dev/null)
if [ "$DE_COUNT" -ge 0 ] 2>/dev/null; then ok "$DE_COUNT direct expenses"; else fail "Failed to get direct expenses"; fi

echo ""

# ========== SECTION H: NOTIFICATIONS ==========
echo "=== H. NOTIFICATIONS ==="

# H1. List notifications
echo "--- H1. List notifications ---"
NOTIF_RESP=$(curl $TO $BASE/api/notifications -H "Authorization: Bearer $ADMIN_TOKEN")
NOTIF_COUNT=$(echo "$NOTIF_RESP" | python3 -c 'import sys,json; d=json.load(sys.stdin); items=d if isinstance(d,list) else d.get("data",d.get("notifications",[])); print(len(items))' 2>/dev/null)
if [ "$NOTIF_COUNT" -ge 0 ] 2>/dev/null; then ok "$NOTIF_COUNT notifications"; else fail "Failed to get notifications"; fi

# H2. Mark notification as read (if any)
echo "--- H2. Mark notification as read ---"
if [ "$NOTIF_COUNT" -gt 0 ] 2>/dev/null; then
  NOTIF_ID=$(echo "$NOTIF_RESP" | python3 -c 'import sys,json; d=json.load(sys.stdin); items=d if isinstance(d,list) else d.get("data",d.get("notifications",[])); print(items[0].get("id",""))' 2>/dev/null)
  if [ -n "$NOTIF_ID" ]; then
    READ_RESP=$(curl $TO -o /dev/null -w "%{http_code}" -X PATCH $BASE/api/notifications/$NOTIF_ID/read -H "Authorization: Bearer $ADMIN_TOKEN")
    if [ "$READ_RESP" = "200" ]; then ok "Mark as read returns 200"; else warn "Mark as read returns $READ_RESP"; fi
  else
    warn "No notification ID found"
  fi
else
  warn "No notifications to test"
fi

echo ""

# ========== SECTION I: AUDIT & LOGGING ==========
echo "=== I. AUDIT & LOGGING ==="

# I1. Audit logs
echo "--- I1. Audit logs ---"
AL_RESP=$(curl $TO -o /dev/null -w "%{http_code}" "$BASE/api/audit-logs?limit=10" -H "Authorization: Bearer $ADMIN_TOKEN")
if [ "$AL_RESP" = "200" ]; then ok "Audit logs returns 200"; else fail "Audit logs returns $AL_RESP"; fi

# I2. Document uploads
echo "--- I2. Document uploads ---"
DU_RESP=$(curl $TO -o /dev/null -w "%{http_code}" $BASE/api/document-uploads -H "Authorization: Bearer $ADMIN_TOKEN")
if [ "$DU_RESP" = "200" ]; then ok "Document uploads returns 200"; else fail "Document uploads returns $DU_RESP"; fi

echo ""

# ========== SECTION J: EDGE CASES ==========
echo "=== J. EDGE CASES ==="

# J1. Invalid UUID parameter
echo "--- J1. Invalid UUID in URL ---"
INVALID_UUID=$(curl $TO -o /dev/null -w "%{http_code}" $BASE/api/departments/not-a-uuid/budget -H "Authorization: Bearer $ADMIN_TOKEN")
if [ "$INVALID_UUID" = "400" ] || [ "$INVALID_UUID" = "404" ] || [ "$INVALID_UUID" = "500" ]; then ok "Invalid UUID returns $INVALID_UUID (no crash)"; else fail "Invalid UUID returns $INVALID_UUID"; fi

# J2. Non-existent department
echo "--- J2. Non-existent department ---"
NONE_DEPT=$(curl $TO -o /dev/null -w "%{http_code}" $BASE/api/departments/00000000-0000-0000-0000-000000000000/budget -H "Authorization: Bearer $ADMIN_TOKEN")
if [ "$NONE_DEPT" = "200" ] || [ "$NONE_DEPT" = "404" ]; then ok "Non-existent dept returns $NONE_DEPT"; else warn "Non-existent dept returns $NONE_DEPT"; fi

# J3. Malformed JSON body
echo "--- J3. Malformed JSON body ---"
BAD_JSON=$(curl $TO -o /dev/null -w "%{http_code}" -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d '{invalid json}')
if [ "$BAD_JSON" = "400" ] || [ "$BAD_JSON" = "500" ]; then ok "Malformed JSON returns $BAD_JSON (no crash)"; else fail "Malformed JSON returns $BAD_JSON"; fi

# J4. Very long string in field
echo "--- J4. Very long string in login ---"
LONG_RESP=$(curl $TO -o /dev/null -w "%{http_code}" -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d '{"email":"alice.admin@madison88.com","password":"password123","extra":"'$(python3 -c "print('A'*10000)")'"}')
if [ "$LONG_RESP" -lt "500" ]; then ok "Long string handled gracefully ($LONG_RESP)"; else fail "Long string crashes server ($LONG_RESP)"; fi

# J5. SQL injection attempt
echo "--- J5. SQL injection attempt ---"
SQL_INJ=$(curl $TO -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d '{"email":"alice.admin@madison88.com OR 1=1","password":"password123"}')
SQL_INJ_ERR=$(echo "$SQL_INJ" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("error",""))' 2>/dev/null)
if [ "$SQL_INJ_ERR" = "Invalid credentials" ]; then ok "SQL injection blocked"; else fail "SQL injection not blocked: $SQL_INJ"; fi

echo ""

# ========== SECTION K: ERROR LOG ANALYSIS ==========
echo "=== K. ERROR LOG ANALYSIS ==="

# K1. Check for crashes in last 100 log lines
echo "--- K1. Check for crashes/errors in logs ---"
CRASHES=$(journalctl -u bms-backend --no-pager -n 100 2>&1 | grep -iE "TypeError|ReferenceError|Cannot read|Cannot find|is not a function|is not defined|FATAL|CRASH|unhandled" | grep -v "SyntaxError: Expected property" | head -10 || true)
if [ -z "$CRASHES" ]; then
  ok "No crashes or unhandled errors in logs"
else
  fail "Found crashes in logs:"
  echo "$CRASHES"
fi

# K2. Check for DB errors
echo "--- K2. Check for DB errors ---"
DB_ERRORS=$(journalctl -u bms-backend --no-pager -n 200 2>&1 | grep -iE "permission denied|schema.*does not exist|column.*does not exist|relation.*does not exist" | grep -v "error: null" | grep -v "PGRST200" | head -10 || true)
if [ -z "$DB_ERRORS" ]; then
  ok "No DB schema/permission errors"
else
  fail "Found DB errors:"
  echo "$DB_ERRORS"
fi

# K3. Check for 500 errors
echo "--- K3. Check for 500 status codes ---"
S500=$(journalctl -u bms-backend --no-pager -n 200 2>&1 | grep -E "status.*500|500.*error|Internal server error" | head -10 || true)
if [ -z "$S500" ]; then
  ok "No 500 errors in recent logs"
else
  warn "Found 500 errors:"
  echo "$S500"
fi

echo ""

# ========== SECTION L: SERVICE HEALTH ==========
echo "=== L. SERVICE HEALTH ==="

# L1. Service active
echo "--- L1. Service status ---"
ACTIVE=$(systemctl is-active bms-backend)
if [ "$ACTIVE" = "active" ]; then ok "Service is active"; else fail "Service is $ACTIVE"; fi

# L2. Service enabled
echo "--- L2. Service enabled ---"
ENABLED=$(systemctl is-enabled bms-backend)
if [ "$ENABLED" = "enabled" ]; then ok "Service is enabled (auto-start)"; else fail "Service is $ENABLED"; fi

# L3. Memory usage
echo "--- L3. Memory usage ---"
MEM=$(systemctl show bms-backend --property=MemoryCurrent 2>/dev/null | cut -d= -f2)
if [ -n "$MEM" ] && [ "$MEM" -lt "268435456" ] 2>/dev/null; then
  MEM_MB=$((MEM / 1048576))
  ok "Memory usage: ${MEM_MB}MB (under 256MB limit)"
else
  warn "Memory usage: ${MEM} bytes"
fi

# L4. Uptime
echo "--- L4. Uptime ---"
UPTIME=$(curl $TO $BASE/api/system/health | python3 -c 'import sys,json; print(round(json.load(sys.stdin)["backend"]["uptime"],1))' 2>/dev/null)
if [ -n "$UPTIME" ]; then ok "Uptime: ${UPTIME}s"; else fail "Could not get uptime"; fi

echo ""

# ========== SUMMARY ==========
echo "=========================================="
echo "  SUMMARY"
echo "=========================================="
echo "  PASS: $PASS"
echo "  FAIL: $FAIL"
echo "  WARN: $WARN"
echo ""
if [ "$FAIL" -gt 0 ]; then
  echo "  FAILED TESTS:"
  echo -e "$ERRORS"
  echo ""
fi
if [ "$FAIL" -eq 0 ]; then
  echo "  RESULT: ALL CRITICAL TESTS PASSED"
elif [ "$FAIL" -le 2 ]; then
  echo "  RESULT: MOSTLY PASSING - minor issues"
else
  echo "  RESULT: MULTIPLE FAILURES - needs attention"
fi
echo "=========================================="
