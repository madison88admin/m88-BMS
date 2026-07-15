#!/bin/bash
BASE="http://localhost:3002"

echo "=== 1. Login as accounting (Bob) ==="
ACC_RESP=$(curl -s --max-time 10 -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d '{"email":"bob.accounting@gmail.com","password":"password123"}')
ACC_TOKEN=$(echo "$ACC_RESP" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("token",""))' 2>/dev/null)
echo "Accounting logged in: ${#ACC_TOKEN} chars"
echo ""

echo "=== 2. Create a test request with items ==="
CREATE_RESP=$(curl -s --max-time 15 -X POST $BASE/api/requests -H "Authorization: Bearer $ACC_TOKEN" -H 'Content-Type: application/json' -d '{
  "item_name": "Resubmit Test",
  "category": "Office Supplies",
  "amount": 1000,
  "purpose": "Test resubmit with changed items",
  "request_type": "reimbursement",
  "items": [
    {"item_name": "Item A", "amount": 400, "category_id": null},
    {"item_name": "Item B", "amount": 600, "category_id": null}
  ]
}')
echo "$CREATE_RESP" | python3 -c 'import sys,json; d=json.load(sys.stdin); print("Created: "+d.get("request_code","?")+" | id: "+d.get("id","?")+" | amount: "+str(d.get("amount","?"))+" | status: "+d.get("status","?"))' 2>&1
REQ_ID=$(echo "$CREATE_RESP" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("id",""))' 2>/dev/null)
echo "Request ID: $REQ_ID"
echo ""

echo "=== 3. Return the request (accounting returns it) ==="
RETURN_RESP=$(curl -s --max-time 15 -X PATCH "$BASE/api/requests/$REQ_ID/return" -H "Authorization: Bearer $ACC_TOKEN" -H 'Content-Type: application/json' -d '{"reason": "Need to update items and amounts"}')
echo "$RETURN_RESP" | python3 -c 'import sys,json; d=json.load(sys.stdin); print("Status after return: "+d.get("status","?"))' 2>&1
echo ""

echo "=== 4. Check request_items before resubmit ==="
ITEMS_BEFORE=$(curl -s --max-time 15 "$BASE/api/requests/$REQ_ID" -H "Authorization: Bearer $ACC_TOKEN")
echo "$ITEMS_BEFORE" | python3 -c '
import sys,json
d=json.load(sys.stdin)
items = d.get("metadata",{}).get("items",[])
print("Items before resubmit: "+str(len(items)))
for i,item in enumerate(items):
    print("  Item "+str(i)+": name="+str(item.get("item_name","?"))+" amount="+str(item.get("amount","?"))+" category_id="+str(item.get("category_id","?")))
' 2>&1
echo ""

echo "=== 5. Resubmit with changed amount, category, and items ==="
RESUBMIT_RESP=$(curl -s --max-time 15 -X PATCH "$BASE/api/requests/$REQ_ID/resubmit" -H "Authorization: Bearer $ACC_TOKEN" -H 'Content-Type: application/json' -d '{
  "item_name": "Resubmit Test UPDATED",
  "category": "Meals and Entertainment",
  "amount": 1500,
  "purpose": "Updated purpose",
  "items": [
    {"item_name": "Item A CHANGED", "amount": 500, "category_id": null},
    {"item_name": "Item B CHANGED", "amount": 700, "category_id": null},
    {"item_name": "Item C NEW", "amount": 300, "category_id": null}
  ]
}')
echo "$RESUBMIT_RESP" | python3 -c 'import sys,json; d=json.load(sys.stdin); print("Status after resubmit: "+d.get("status","?")+" | amount: "+str(d.get("amount","?"))+" | category: "+d.get("category","?")+" | item_name: "+d.get("item_name","?"))' 2>&1
echo ""

echo "=== 6. Check request after resubmit ==="
AFTER_RESP=$(curl -s --max-time 15 "$BASE/api/requests/$REQ_ID" -H "Authorization: Bearer $ACC_TOKEN")
echo "$AFTER_RESP" | python3 -c '
import sys,json
d=json.load(sys.stdin)
print("Request fields:")
print("  item_name: "+str(d.get("item_name","?")))
print("  category: "+str(d.get("category","?")))
print("  amount: "+str(d.get("amount","?")))
print("  status: "+str(d.get("status","?")))
print("  revision_count: "+str(d.get("revision_count","?")))
items = d.get("metadata",{}).get("items",[])
print("Items after resubmit: "+str(len(items)))
for i,item in enumerate(items):
    print("  Item "+str(i)+": name="+str(item.get("item_name","?"))+" amount="+str(item.get("amount","?"))+" category_id="+str(item.get("category_id","?")))
' 2>&1
echo ""

echo "=== 7. Verify via DB ==="
echo "(Checking via API response above)"
echo ""

echo "=== 8. Check logs for errors ==="
journalctl -u bms-backend --no-pager --since "1 minute ago" 2>&1 | grep -iE "error|crash|500" | grep -v "error: null" | head -10 || echo "No errors"
echo ""

echo "=== Done ==="
