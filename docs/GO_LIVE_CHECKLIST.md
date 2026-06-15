# Go-Live Checklist

## Configuration Tasks

### 1. Cost Centers — Update Seed Data

**Current Seed Data:**
```sql
INSERT INTO cost_centers (name, total_budget, remaining_amount, fiscal_year)
VALUES 
  ('M88 Manila', 1000000, 1000000, 2026)
ON CONFLICT DO NOTHING;
```

**Action Required:**
Replace with your actual company cost centers:

```sql
-- Update existing cost center
UPDATE cost_centers 
SET name = 'Your Actual Cost Center Name',
    total_budget = 1000000,
    remaining_amount = 1000000
WHERE name = 'M88 Manila';

-- Or insert new cost centers
INSERT INTO cost_centers (name, total_budget, remaining_amount, fiscal_year)
VALUES 
  ('Cost Center A', 1000000, 1000000, 2026),
  ('Cost Center B', 500000, 500000, 2026)
ON CONFLICT DO NOTHING;
```

**To Update via API:**
```
POST /api/cost-centers
{
  "name": "Your Actual Cost Center Name",
  "total_budget": 1000000,
  "fiscal_year": 2026
}
```

---

### 2. Approval Thresholds — Confirm Business Rules

**Current Thresholds:**
- **Budget Proposals:** 500 (amount ≥ 500 goes to President, < 500 goes to VP)
- **Expense Requests:** Currency-based thresholds (defined in config)

**Location in Code:**
- `backend/src/routes/requests.ts` line 2347 (PRESIDENT_THRESHOLD = 500)
- `backend/src/routes/requests.ts` line 1308 (getPresidentThreshold function)

**Action Required:**
Confirm with business stakeholders if threshold of 500 is correct.

**To Update:**
1. Edit `backend/src/routes/requests.ts` line 2347:
   ```typescript
   const PRESIDENT_THRESHOLD = 500; // Change to your threshold
   ```

2. Update currency-based thresholds in config:
   ```
   PUT /api/config/auth-thresholds
   {
     "PHP": { "vp": 50000, "president": 100000 },
     "USD": { "vp": 1000, "president": 2000 }
   }
   ```

---

### 3. Petty Cash Thresholds — Set per Department

**Current Thresholds:**
- Warning: 50% of threshold
- Critical: 20% of threshold

**Action Required:**
Set actual petty cash thresholds per department.

**To Update via API:**
```
PUT /api/budget-alerts/:department_id
{
  "warning_threshold": 50,  // percentage
  "critical_threshold": 20  // percentage
}
```

**Example:**
```sql
-- Update petty cash threshold for a specific department
UPDATE departments 
SET petty_cash_threshold = 10000  -- actual amount
WHERE id = 'department_id';
```

---

## Pre-Launch Verification

### Database Checks
- [ ] Cost centers table has actual company cost centers
- [ ] Fiscal year is set to current year (2026)
- [ ] Budget categories have correct allocations
- [ ] Users have correct roles assigned

### Configuration Checks
- [ ] Approval thresholds match business rules
- [ ] Petty cash thresholds set per department
- [ ] Email notifications configured
- [ ] Sequential code prefixes are correct (REQ, CA, LIQ, BUD)

### Testing Checklist
- [ ] Employee can submit expense request
- [ ] Supervisor can approve/reject request
- [ ] Accounting can review and approve
- [ ] VP/President co-approval works for high-value requests
- [ ] Cost allocation dual-deduction works correctly
- [ ] Budget proposal approval flow works
- [ ] Petty cash replenishment works
- [ ] Liquidation submission and review works
- [ ] Cash return confirmation works
- [ ] Reconciliation works correctly

### Security Checks
- [ ] All API endpoints have proper authentication
- [ ] Role-based authorization is working
- [ ] Audit logs are being generated
- [ ] Sensitive data is not exposed in API responses

---

## Rollback Plan

If issues arise after go-live:

1. **Database Rollback:**
   ```sql
   -- Disable cost allocation feature
   UPDATE expense_requests SET status = 'pending_accounting' 
   WHERE status IN ('pending_vp', 'pending_president');
   
   -- Restore old thresholds if needed
   ```

2. **Code Rollback:**
   - Revert to previous commit
   - Redeploy backend
   - Clear browser cache

3. **Data Recovery:**
   - Audit logs track all changes
   - Cost allocation records can be rolled back
   - Budget category balances can be restored

---

## Post-Launch Monitoring

### Key Metrics to Track
- Request submission rate
- Approval cycle time
- Budget utilization
- Cost allocation accuracy
- Petty cash balance trends

### Alerts to Set Up
- Low budget balance alerts
- High-value request alerts
- Unreconciled request alerts
- Failed cost allocation alerts

---

## Support Contacts

- **Technical Support:** [Contact info]
- **Business Support:** [Contact info]
- **Emergency Contact:** [Contact info]
