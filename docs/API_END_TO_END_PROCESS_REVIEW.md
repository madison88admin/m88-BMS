# API and End-to-End Process Review

## System Overview

This document reviews the API endpoints and end-to-end workflows for each user role in the M88 BMS system.

---

## User Roles and Workflows

### 1. Employee Role

**Navigation:**
- Dashboard (`/employee`)
- Create Ticket (`/requests/new`)
- My Requests (`/tracker`)

**API Endpoints:**
- `POST /api/requests` - Submit new request (reimbursement, cash advance)
- `GET /api/requests/my` - Get current user's requests
- `PATCH /api/requests/:id/liquidation` - Submit liquidation for cash advance
- `GET /api/requests/:id` - View request details
- `GET /api/requests/official-list` - Get filtered expense catalog

**Workflow:**
1. Employee submits request (reimbursement/cash advance)
   - Selects expense category from official list
   - Enters amount, purpose, attachments
   - Request status: `pending_supervisor`
2. Supervisor reviews and approves/rejects
   - If approved: status changes to `pending_accounting` (small amounts) or `pending_vp` (large amounts)
   - If rejected: status changes to `rejected`
3. Accounting reviews and approves/rejects
   - If approved: status changes to `pending_accounting` for co-approval
4. VP/President co-approves
   - VP: amounts below threshold
   - President: amounts above threshold
   - Status changes to `pending_accounting`
5. Accounting releases funds
   - Status changes to `released`
6. Employee submits liquidation (for cash advances)
   - Liquidation status: `submitted`
   - Accounting reviews liquidation
   - If approved: cash advance is closed

---

### 2. Supervisor Role

**Navigation:**
- Dashboard (`/`)
- Create Ticket (`/requests/new`)
- My Requests (`/tracker`)
- Team Approvals (`/approvals`)
- Budget Matrix (`/budget-management`)

**API Endpoints:**
- `GET /api/requests` - List filtered by role/dept
- `PATCH /api/requests/:id/approve` - Approve/reject supervisor requests
- `PATCH /api/requests/:id/priority` - Set request priority
- `GET /api/budget/categories` - View budget categories
- `GET /api/departments` - View departments

**Workflow:**
1. Supervisor views pending requests for their department
2. Supervisor reviews request details, attachments, amount
3. Supervisor approves or rejects
   - Approve: status changes to `pending_accounting` (small) or `pending_vp` (large)
   - Reject: status changes to `rejected` with reason
4. Supervisor can set priority on requests
5. Supervisor can view budget matrix for their department

---

### 3. Accounting Role

**Navigation:**
- Budget Matrix (`/budget-management`)
- Budget Adjustments (`/document-uploads`)
- Disbursement Hub (`/approvals`)
- My Requests (`/tracker`)
- Ticket Audit Log (`/ticket-audit-log`)

**API Endpoints:**
- `GET /api/requests` - List all requests
- `PATCH /api/requests/:id/approve-accounting` - Accounting review
- `PATCH /api/requests/:id/release` - Release funds
- `GET /api/budget/categories` - View/manage budget categories
- `PATCH /api/budget/categories/:id` - Update category budget
- `GET /api/budget/cost-centers` - View cost centers
- `GET /api/departments` - View departments
- `POST /api/document-uploads` - Submit budget adjustments
- `PATCH /api/document-uploads/:id/review` - Review budget adjustments
- `GET /api/audit-logs` - View audit logs
- `GET /api/requests/:id/audit-logs` - View request audit logs

**Workflow:**
1. Accounting views pending requests
2. Accounting reviews request details, budget availability
3. Accounting approves or rejects
   - Approve: status changes to `pending_accounting` for co-approval
   - Reject: status changes to `rejected`
4. VP/President co-approves
5. Accounting releases funds
   - Deducts from budget category
   - Deducts from department budget
   - Updates M88 Manila cost center
   - Status changes to `released`
6. Accounting manages budget matrix
   - Can lock/unlock budget categories
   - Can adjust category budgets
   - Can view M88 Manila cost center
7. Accounting reviews budget adjustments
   - Can acknowledge or return adjustments
   - Updates budgets accordingly

---

### 4. VP Role

**Navigation:**
- Dashboard (`/`)
- Create Ticket (`/requests/new`)
- My Requests (`/tracker`)
- Disbursement Hub (`/approvals`)

**API Endpoints:**
- `GET /api/requests` - List all requests
- `PATCH /api/requests/:id/approve-vp` - VP approval routing
- `POST /api/requests/:id/co-approve` - VP co-approval
- `GET /api/audit-logs` - View audit logs

**Workflow:**
1. VP views pending requests
2. VP reviews request details, amount
3. VP approves or forwards to President
   - Amount below threshold: co-approves, status changes to `pending_accounting`
   - Amount above threshold: forwards to President, status changes to `pending_president`
4. VP can co-approve requests
5. VP can view audit logs

---

### 5. President Role

**Navigation:**
- Dashboard (`/`)
- Create Ticket (`/requests/new`)
- My Requests (`/tracker`)
- Disbursement Hub (`/approvals`)

**API Endpoints:**
- `GET /api/requests` - List all requests
- `PATCH /api/requests/:id/approve-president` - President approval
- `POST /api/requests/:id/co-approve` - President co-approval
- `GET /api/audit-logs` - View audit logs

**Workflow:**
1. President views pending requests (large amounts)
2. President reviews request details, amount
3. President approves or rejects
   - Approve: co-approves, status changes to `pending_accounting`
   - Reject: status changes to `rejected`
4. President can approve budget proposals
   - Applies approved budget proposal
   - Updates budget categories
   - Updates department budgets
   - Updates M88 Manila cost center
5. President can view audit logs

---

## Request Status Flow

```
pending_supervisor
  ↓ (supervisor approves)
pending_accounting (small amounts) OR pending_vp (large amounts)
  ↓ (accounting approves)
pending_accounting (for co-approval)
  ↓ (VP/President co-approves)
pending_accounting (for release)
  ↓ (accounting releases)
released
```

**Alternative flows:**
- Supervisor rejects → `rejected`
- Accounting rejects → `rejected`
- VP/President rejects → `rejected`
- On hold → `on_hold`
- Returned for revision → `returned_for_revision`

---

## Budget Management Workflow

1. **Budget Categories:**
   - Admin/Accounting can create budget categories
   - Categories can be General (All departments) or Dept Only
   - Categories have budget_amount, used_amount, committed_amount, remaining_amount

2. **Department Budgets:**
   - Sum of all category budgets for a department
   - Updated when category budgets change
   - Used budget calculated from approved/released requests

3. **M88 Manila Cost Center:**
   - Sum of all department budgets
   - Used amount = sum of all department used budgets
   - Remaining amount = total budget - used amount
   - Updated when:
     - Budget adjustments are acknowledged
     - Budget proposals are approved
     - Requests are released

---

## Authentication & Authorization

**Middleware:**
- `authenticate` - Verifies JWT token
- `authorize(...roles)` - Checks if user has required role
- `authorizeOrDelegate(...roles)` - Checks role or active delegation
- `hasAccountingAccess(role)` - Checks if user has accounting access
- `hasFullAccountingAccess(role)` - Checks if user has full accounting access (not limited)

**Role Hierarchy:**
- `employee` - Basic access
- `manager` - Employee with additional permissions
- `supervisor` - Can approve team requests
- `accounting` - Can review, approve, release funds
- `accounting_limited` - Limited accounting access (cannot release funds)
- `vp` - Can co-approve requests
- `president` - Can co-approve requests, approve budget proposals
- `admin` - Full system access
- `super_admin` - Full system access

---

## Key API Routes Summary

**Requests:**
- `GET /api/requests` - List requests (filtered by role)
- `POST /api/requests` - Submit new request
- `GET /api/requests/:id` - Get request details
- `PATCH /api/requests/:id/approve` - Supervisor approval
- `PATCH /api/requests/:id/approve-accounting` - Accounting approval
- `PATCH /api/requests/:id/approve-vp` - VP approval
- `PATCH /api/requests/:id/approve-president` - President approval
- `POST /api/requests/:id/co-approve` - VP/President co-approval
- `PATCH /api/requests/:id/release` - Release funds
- `PATCH /api/requests/:id/liquidation` - Submit liquidation
- `PATCH /api/requests/:id/allocations` - Update department allocations
- `PATCH /api/requests/:id/priority` - Set priority
- `PATCH /api/requests/:id/return` - Return for revision
- `PATCH /api/requests/:id/hold` - Place on hold

**Budget:**
- `GET /api/budget/categories` - List budget categories
- `PATCH /api/budget/categories/:id` - Update category budget
- `GET /api/budget/cost-centers` - List cost centers
- `GET /api/budget/summary` - Get budget summary
- `GET /api/departments` - List departments
- `PATCH /api/departments/:id` - Update department

**Document Uploads:**
- `POST /api/document-uploads` - Submit budget adjustment
- `GET /api/document-uploads` - List budget adjustments
- `PATCH /api/document-uploads/:id/review` - Review budget adjustment

**Audit Logs:**
- `GET /api/audit-logs` - List audit logs
- `GET /api/requests/:id/audit-logs` - Get request audit logs

---

## Real-time Updates

**Supabase Realtime Subscriptions:**
- `expense_requests` table changes trigger request list updates
- `departments` table changes trigger budget updates
- `budget_categories` table changes trigger budget updates
- `cost_centers` table changes trigger cost center updates
- `notifications` table changes trigger notification updates

**Cache Invalidation:**
- Request approvals invalidate department/budget caches
- Budget adjustments invalidate department/budget caches
- Budget proposal approvals invalidate all budget caches
- Request releases invalidate department/budget caches

---

## Security Considerations

1. **JWT Authentication:** All API endpoints require valid JWT token
2. **Role-based Authorization:** Each endpoint checks user role
3. **Department Access:** Users can only access their department's data (except accounting/admin)
4. **Dual Authorization:** Large amounts require VP/President co-approval
5. **Budget Validation:** Requests are validated against available budget
6. **Audit Logging:** All actions are logged for accountability

---

## Known Issues & Recommendations

1. **M88 Manila Cost Center Updates:**
   - Currently updates on: budget adjustments, budget proposals, request releases
   - Should also update when tickets are approved (not just released)
   - Recommendation: Add `updateM88ManilaCostCenterBudget` call in approval endpoints

2. **Dept Only Label:**
   - User requested removal of "Dept Only" label from budget matrix
   - Currently removed from BudgetManagement.tsx
   - User reverted the change - label is now visible again

3. **Expense Categories Cross-Check:**
   - Minor description differences between seed file and Excel
   - 6330 Insurance Expense assigned to 'Admin' but should be 'Accounting' per Excel
   - Recommendation: Fix department assignment and standardize descriptions

4. **Lint Warnings:**
   - Multiple unused variables in BudgetManagement.tsx
   - Recommendation: Remove unused variables to clean up code

---

## Conclusion

The system has a well-structured API and workflow for each user role. The approval flow is clear with proper dual authorization for large amounts. Budget management is integrated with request processing. Real-time updates ensure data consistency across the system.

**Key Strengths:**
- Clear role-based access control
- Comprehensive audit logging
- Real-time data synchronization
- Dual authorization for security
- Integrated budget management

**Areas for Improvement:**
- M88 Manila cost center should update on ticket approval (not just release)
- Expense categories need standardization with Excel data
- Clean up unused variables in codebase
