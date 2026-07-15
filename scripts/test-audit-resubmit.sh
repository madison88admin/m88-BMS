#!/bin/bash
BASE="http://localhost:3002"

echo "=== 1. Login as accounting (Bob) ==="
ACC_RESP=$(curl -s --max-time 10 -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d '{"email":"bob.accounting@gmail.com","password":"password123"}')
ACC_TOKEN=$(echo "$ACC_RESP" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""))' 2>/dev/null)
echo "Accounting logged in: ${#ACC_TOKEN} chars"
echo ""

echo "=== 2. Test audit-logs endpoint ==="
AUDIT_RESP=$(curl -s --max-time 15 "$BASE/api/requests/audit-logs" -H "Authorization: Bearer $ACC_TOKEN")
echo "$AUDIT_RESP" | python3 -c '
import sys,json
d=json.load(sys.stdin)
if isinstance(d, list):
    print("Total audit log entries: "+str(len(d)))
    types = {}
    for log in d:
        lt = log.get("log_type","?")
        a = log.get("action","?")
        key = lt+":"+a
        types[key] = types.get(key, 0) + 1
    print("Breakdown by type:action:")
    for k in sorted(types.keys()):
        print("  "+k+": "+str(types[k]))
    print()
    print("Last 5 entries:")
    for log in d[:5]:
        print("  "+str(log.get("event_time","?"))+" | "+log.get("log_type","?")+" | "+str(log.get("action","?"))+" | "+str(log.get("request_code",""))+" | "+str(log.get("actor_name","")))
else:
    print("Error: "+str(d))
' 2>&1
echo ""

echo "=== 3. Test resubmit with changed items ==="
CREATE_RESP=$(curl -s --max-time 15 -X POST $BASE/api/requests -H "Authorization: Bearer $ACC_TOKEN" -H 'Content-Type: application/json' -d '{
  "item_name": "Resubmit Test 2",
  "category": "Office Supplies",
  "amount": 1000,
  "purpose": "Test resubmit items",
  "request_type": "reimbursement",
  "items": [
    {"item_name": "Original A", "amount": 400},
    {"item_name": "Original B", "amount": 600}
  ]
}')
REQ_ID=$(echo "$CREATE_RESP" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("id",""))' 2>/dev/null)
echo "Created: $(echo "$CREATE_RESP" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("request_code","?"))' 2>/dev/null)"

curl -s --max-time 15 -X PATCH "$BASE/api/requests/$REQ_ID/return" -H "Authorization: Bearer $ACC_TOKEN" -H 'Content-Type: application/json' -d '{"reason": "Test return"}' > /dev/null
echo "Returned for revision"

RESUBMIT_RESP=$(curl -s --max-time 15 -X PATCH "$BASE/api/requests/$REQ_ID/resubmit" -H "Authorization: Bearer $ACC_TOKEN" -H 'Content-Type: application/json' -d '{
  "item_name": "Resubmit Test 2 UPDATED",
  "category": "Meals and Entertainment",
  "amount": 1500,
  "items": [
    {"item_name": "Changed A", "amount": 500},
    {"item_name": "Changed B", "amount": 700},
    {"item_name": "New C", "amount": 300}
  ]
}')
echo "$RESUBMIT_RESP" | python3 -c '
import sys,json
d=json.load(sys.stdin)
print("After resubmit:")
print("  item_name: "+str(d.get("item_name","?")))
print("  category: "+str(d.get("category","?")))
print("  amount: "+str(d.get("amount","?")))
print("  status: "+str(d.get("status","?")))
items = d.get("metadata",{}).get("items",[])
print("  metadata items: "+str(len(items)))
for i,item in enumerate(items):
    print("    Item "+str(i)+": "+str(item.get("item_name","?"))+" = "+str(item.get("amount","?")))
' 2>&1
echo ""

echo "=== 4. Check DB for request_items ==="
echo "(Checked via API above)"
echo ""

echo "=== 5. Check logs ==="
journalctl -u bms-backend --no-pager --since "1 minute ago" 2>&1 | grep -iE "error|crash|resubmit" | grep -v "error: null" | head -10 || echo "No errors"
echo ""

echo "=== Done ==="
