#!/bin/bash
BASE="http://localhost:3002"

echo "=== 1. VP login ==="
VP_RESP=$(curl -s --max-time 10 -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d '{"email":"cascano@madison88.com","password":"password123"}')
VP_TOKEN=$(echo "$VP_RESP" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""))' 2>/dev/null)
echo "VP logged in: ${#VP_TOKEN} chars"
echo ""

echo "=== 2. President login ==="
P_RESP=$(curl -s --max-time 10 -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d '{"email":"chris@madison88.com","password":"password123"}')
P_TOKEN=$(echo "$P_RESP" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""))' 2>/dev/null)
echo "President logged in: ${#P_TOKEN} chars"
echo ""

echo "=== 3. VP lists pending_vp requests ==="
VP_REQS=$(curl -s --max-time 15 "$BASE/api/requests?status=pending_vp" -H "Authorization: Bearer $VP_TOKEN")
echo "$VP_REQS" | python3 -c '
import sys,json
d=json.load(sys.stdin)
items=d if isinstance(d,list) else d.get("data",d.get("requests",[]))
expense=[r for r in items if r.get("request_type") not in ("budget_request","budget_revision")]
budget=[r for r in items if r.get("request_type") in ("budget_request","budget_revision")]
print("Total pending_vp: "+str(len(items)))
print("  Expense/CA: "+str(len(expense)))
print("  Budget: "+str(len(budget)))
for r in expense[:5]:
    print("  - "+r.get("request_code","?")+" | "+r.get("request_type","?")+" | "+str(r.get("amount","?"))+" | status="+r.get("status","?"))
' 2>&1
echo ""

echo "=== 4. VP tries to approve an expense request ==="
FIRST_EXP_ID=$(echo "$VP_REQS" | python3 -c '
import sys,json
d=json.load(sys.stdin)
items=d if isinstance(d,list) else d.get("data",d.get("requests",[]))
expense=[r for r in items if r.get("request_type") not in ("budget_request","budget_revision")]
print(expense[0]["id"] if expense else "")
' 2>/dev/null)
if [ -n "$FIRST_EXP_ID" ]; then
  echo "Approving request ID: $FIRST_EXP_ID"
  APPROVE_RESP=$(curl -s --max-time 15 -X PATCH "$BASE/api/requests/$FIRST_EXP_ID/approve-vp" -H "Authorization: Bearer $VP_TOKEN" -H 'Content-Type: application/json' -d '{"note":"E2E test VP approval"}')
  echo "Response: $APPROVE_RESP"
else
  echo "No non-budget pending_vp requests found"
fi
echo ""

echo "=== 5. President lists pending_president requests ==="
P_REQS=$(curl -s --max-time 15 "$BASE/api/requests?status=pending_president" -H "Authorization: Bearer $P_TOKEN")
echo "$P_REQS" | python3 -c '
import sys,json
d=json.load(sys.stdin)
items=d if isinstance(d,list) else d.get("data",d.get("requests",[]))
print("Total pending_president: "+str(len(items)))
for r in items[:5]:
    print("  - "+r.get("request_code","?")+" | "+r.get("request_type","?")+" | "+str(r.get("amount","?")))
' 2>&1
echo ""

echo "=== 6. Check logs ==="
journalctl -u bms-backend --no-pager --since "1 minute ago" 2>&1 | grep -iE "error|forbidden|403|500|crash" | head -10 || echo "No errors"
echo ""

echo "=== Done ==="
