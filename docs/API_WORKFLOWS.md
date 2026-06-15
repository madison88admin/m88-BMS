# BMS API Workflows by User Role

## User Roles
- **Employee**: Submits expense requests, cash advances, liquidations
- **Supervisor**: Approves/rejects employee requests, manages department budget
- **Accounting**: Reviews requests, releases funds, manages petty cash, reconciles
- **VP**: Executive approval for budget proposals and high-value requests
- **President**: Final approval for budget proposals and high-value requests
- **Admin**: Full system access
- **Super Admin**: Full system access + configuration

---

## 1. EMPLOYEE WORKFLOW

### 1.1 Submit Expense Request
**API Flow:**
```
POST /api/requests
```
- **Body:** `item_name`, `category`, `category_id`, `amount`, `purpose`, `priority`, `department_id`, `request_type`, `attachments`, `metadata`, `items`
- **Response:** Created request with `status: 'pending_supervisor'`
- **Sequential Code:** Auto-generated (REQ-00001, REQ-00002, etc.)

### 1.2 Submit Cash Advance
**API Flow:**
```
POST /api/requests
```
- **Body:** Same as expense request with `request_type: 'cash_advance'`
- **Response:** Created request with `status: 'pending_supervisor'`
- **Sequential Code:** Auto-generated (CA-00001, CA-00002, etc.)

### 1.3 Submit Liquidation
**API Flow:**
```
PATCH /api/requests/:id/liquidation
```
- **Body:** `cash_advance_id`, `items`, `attachments`
- **Response:** Liquidation record created with `status: 'submitted'`
- **Sequential Code:** Auto-generated (LIQ-00001, LIQ-00002, etc.)

### 1.4 View My Requests
**API Flow:**
```
GET /api/requests/my
```
- **Response:** List of current user's requests

### 1.5 View Official Expense Catalog
**API Flow:**
```
GET /api/requests/official-list
```
- **Response:** Filtered expense catalog for request forms

---

## 2. SUPERVISOR WORKFLOW

### 2.1 View Pending Requests
**API Flow:**
```
GET /api/requests
```
- **Query:** `status: 'pending_supervisor'`
- **Response:** List of pending requests from department employees

### 2.2 Approve Request
**API Flow:**
```
PATCH /api/requests/:id/approve
```
- **Body:** `note` (optional)
- **Response:** Request status changes to `pending_accounting`

### 2.3 Reject Request
**API Flow:**
```
PATCH /api/requests/:id/reject
```
- **Body:** `reason`
- **Response:** Request status changes to `rejected`

### 2.4 Return for Revision
**API Flow:**
```
PATCH /api/requests/:id/return
```
- **Body:** `reason`
- **Response:** Request status changes to `returned_for_revision`

### 2.5 Place On Hold
**API Flow:**
```
PATCH /api/requests/:id/hold
```
- **Response:** Request status changes to `on_hold`

### 2.6 Set Priority
**API Flow:**
```
PATCH /api/requests/:id/priority
```
- **Body:** `priority` (normal, high, urgent)
- **Response:** Request priority updated

### 2.7 View Department Budget
**API Flow:**
```
GET /api/budget/monitoring
```
- **Response:** Department budget summary with remaining amounts

### 2.8 View Budget Categories
**API Flow:**
```
GET /api/budget/categories
```
- **Query:** `department_id`
- **Response:** List of budget categories for department

---

## 3. ACCOUNTING WORKFLOW

### 3.1 View Pending Requests
**API Flow:**
```
GET /api/requests
```
- **Query:** `status: 'pending_accounting'`
- **Response:** List of requests awaiting accounting review

### 3.2 Approve Accounting Review
**API Flow:**
```
PATCH /api/requests/:id/approve-accounting
```
- **Body:** `note` (optional)
- **Response:** Request status changes to `pending_vp` (if amount ≤ threshold) or `pending_president` (if amount > threshold) for VP/President co-approval

### 3.3 Cost Allocation (NEW)
**API Flow:**
```
PATCH /api/requests/:id/confirm-allocation
```
- **Body:** `cost_center_id`, `budget_category_id`, `notes`
- **Response:** Dual deduction from cost center and budget category
- **Timing:** Performed after accounting approval but before release. Deducts amount from both cost center and budget category atomically.

### 3.4 View Cost Centers
**API Flow:**
```
GET /api/cost-centers
```
- **Response:** List of cost centers with remaining balances

### 3.5 Manage Cost Centers
**API Flow:**
```
POST /api/cost-centers
PUT /api/cost-centers/:id
DELETE /api/cost-centers/:id
```
- **Body:** `name`, `total_budget`, `fiscal_year`, `is_active`
- **Response:** Cost center CRUD operations

### 3.6 Release Funds
**API Flow:**
```
PATCH /api/requests/:id/release
```
- **Body:** `release_method`, `release_reference_no`, `release_note`, `liquidation_due_at`
- **Response:** Request status changes to `released`, funds disbursed

### 3.7 View Petty Cash
**API Flow:**
```
GET /api/petty-cash/:department_id
```
- **Response:** Petty cash balance and history

### 3.8 Manage Petty Cash
**API Flow:**
```
POST /api/petty-cash/:department_id/replenish
POST /api/petty-cash/:departmentId/withdraw
```
- **Body:** `amount`, `reference_no`, `note`
- **Response:** Petty cash balance updated

### 3.9 Reconcile Requests
**API Flow:**
```
PATCH /api/requests/:id/reconcile
```
- **Body:** `reconciled`, `discrepancy_note`
- **Response:** Request marked as reconciled

### 3.10 View Audit Logs
**API Flow:**
```
GET /api/requests/audit-logs
GET /api/requests/:id/audit-logs
```
- **Response:** Audit trail of request actions

### 3.11 View Budget Matrix
**API Flow:**
```
GET /api/budget/monitoring
```
- **Response:** Budget matrix with department and category breakdowns

### 3.12 View Document Uploads
**API Flow:**
```
GET /api/document-uploads
```
- **Response:** List of budget override documents awaiting review

### 3.13 Submit Budget Override Document
**API Flow:**
```
POST /api/document-uploads
```
- **Body:** `file`, `category`, `description`
- **Response:** Document uploaded for accounting review
- **Access:** Employee, Manager, Supervisor, Accounting, Admin

### 3.14 Review Liquidation
**API Flow:**
```
GET /api/requests/:id/liquidation
PATCH /api/requests/:id/liquidation
```
- **Body:** `status` (approved, rejected, returned), `note`
- **Response:** Liquidation status updated
- **Access:** Accounting only

### 3.15 Confirm Cash Return
**API Flow:**
```
PATCH /api/requests/:id/cash-return
```
- **Body:** `cash_return_status` (pending_return, returned), `amount_returned`, `return_date`
- **Response:** Cash return status updated
- **Access:** Accounting only

### 3.16 Petty Cash Low Balance Warning
**API Flow:**
```
GET /api/petty-cash/:department_id
GET /api/budget-alerts
```
- **Response:** Petty cash balance with warning status (warning at 50%, critical at 20% of threshold)
- **Automatic Alerts:** System generates alerts when balance falls below thresholds
- **Configurable Thresholds:** Admin can configure warning and critical thresholds per department via:
  ```
  PUT /api/budget-alerts/:department_id
  ```
  - **Body:** `warning_threshold` (default 50%), `critical_threshold` (default 20%)
  - **Access:** Admin, Super Admin

### 3.17 Aging Report
**API Flow:**
```
GET /api/reports/aging
```
- **Query:** `department_id`, `date_range`
- **Response:** Report showing unreconciled requests by age (0-30 days, 31-60 days, 61-90 days, 90+ days)
- **Access:** Accounting, Admin, Super Admin

---

## 4. VP WORKFLOW

### 4.1 View Pending Budget Proposals
**API Flow:**
```
GET /api/requests
```
- **Query:** `request_type: 'budget_request'`, `status: 'pending_vp'`
- **Response:** List of budget proposals awaiting VP review

### 4.2 View Budget Revisions
**API Flow:**
```
GET /api/requests
```
- **Query:** `request_type: 'budget_revision'`, `status: 'pending_vp'`
- **Response:** List of budget revisions awaiting VP review

### 4.3 Co-Approve High-Value Requests
**API Flow:**
```
POST /api/requests/:id/co-approve
```
- **Body:** `note` (optional)
- **Response:** Request marked as VP co-approved, ready for release

### 4.4 Approve Budget Proposal
**API Flow:**
```
PATCH /api/requests/:id/approve-vp
```
- **Body:** `note` (optional)
- **Response:** Budget proposal approved, forwarded to President

### 4.5 Mark as Viewed
**API Flow:**
```
PATCH /api/requests/:id/mark-viewed
```
- **Response:** Budget proposal marked as viewed

### 4.6 Place On Hold
**API Flow:**
```
PATCH /api/requests/:id/hold
```
- **Response:** Request status changes to `on_hold`

### 4.7 View Department Budgets
**API Flow:**
```
GET /api/departments
```
- **Response:** List of all departments with budget summaries

---

## 5. PRESIDENT WORKFLOW

### 5.1 View Pending Budget Proposals
**API Flow:**
```
GET /api/requests
```
- **Query:** `request_type: 'budget_request'`, `status: 'pending_president'`
- **Response:** List of budget proposals awaiting President review

### 5.2 Approve Budget Proposal
**API Flow:**
```
PATCH /api/requests/:id/approve-president
```
- **Body:** `note` (optional)
- **Response:** Budget proposal approved, budget updated

### 5.3 Co-Approve High-Value Requests
**API Flow:**
```
POST /api/requests/:id/co-approve
```
- **Body:** `note` (optional)
- **Response:** Request marked as President co-approved, ready for release

### 5.4 Place On Hold
**API Flow:**
```
PATCH /api/requests/:id/hold
```
- **Response:** Request status changes to `on_hold`

### 5.5 View All Department Budgets
**API Flow:**
```
GET /api/departments
```
- **Response:** List of all departments with budget summaries

---

## 6. ADMIN / SUPER ADMIN WORKFLOW

### 6.1 User Management
**API Flow:**
```
GET /api/auth/users
POST /api/auth/users
PUT /api/auth/users/:id
DELETE /api/auth/users/:id
```
- **Response:** User CRUD operations

### 6.2 Department Management
**API Flow:**
```
GET /api/departments
POST /api/departments
PUT /api/departments/:id
DELETE /api/departments/:id
```
- **Response:** Department CRUD operations

### 6.3 Budget Management
**API Flow:**
```
GET /api/budget/categories
POST /api/budget/categories
PUT /api/budget/categories/:id
DELETE /api/budget/categories/:id
```
- **Response:** Budget category CRUD operations

### 6.4 Configuration Management
**API Flow:**
```
GET /api/config/auth-thresholds
PUT /api/config/auth-thresholds
```
- **Response:** VP/President approval thresholds

### 6.5 Fiscal Year Management
**API Flow:**
```
GET /api/fiscal-year
POST /api/fiscal-year
PUT /api/fiscal-year/:id
```
- **Response:** Fiscal year configuration

### 6.6 Vendor Management
**API Flow:**
```
GET /api/vendors
POST /api/vendors
PUT /api/vendors/:id
DELETE /api/vendors/:id
```
- **Response:** Vendor CRUD operations

### 6.7 Full Request Access
**API Flow:**
```
GET /api/requests (all_years=true)
GET /api/requests/:id
PATCH /api/requests/:id (any action)
```
- **Response:** Full access to all requests across all fiscal years

### 6.8 Fiscal Year Rollover
**API Flow:**
```
POST /api/fiscal-year/rollover
```
- **Body:** `from_year`, `to_year`, `carry_over_balances` (boolean)
- **Response:** Fiscal year rollover completed, balances carried over
- **Process:**
  1. Closes current fiscal year
  2. Creates new fiscal year
  3. Optionally carries over remaining budget balances
  4. Resets sequential codes for new year
  5. Archives completed requests

### 6.9 Approval Delegation
**API Flow:**
```
GET /api/auth/delegations
POST /api/auth/delegations
DELETE /api/auth/delegations/:id
```
- **Body:** `delegator_id`, `delegate_id`, `role`, `start_date`, `end_date`
- **Response:** Delegation created/updated/deleted
- **Purpose:** Allow temporary approval delegation during absences
- **Access:** Admin, Super Admin

**Approval Delegation Workflow:**
1. Admin creates delegation rule (e.g., Supervisor A delegates to Supervisor B for 2 weeks)
2. When Supervisor A is absent, Supervisor B can approve requests in Supervisor A's department
3. System checks delegation rules before allowing approval actions
4. Audit logs track both delegator and delegate actions
5. Delegation automatically expires after end_date

---

## BUDGET PROPOSAL APPROVAL FLOW (DETAILED)

### Step 1: Supervisor Submit Budget Proposal
**API Flow:**
```
POST /api/requests
```
- **Body:** `request_type: 'budget_request'`, `items` (budget category allocations), `total_amount`, `fiscal_year`, `justification`
- **Response:** Created budget proposal with `status: 'pending_supervisor'`
- **Sequential Code:** Auto-generated (BUD-00001, BUD-00002, etc.)

### Step 2: Supervisor Self-Approval
**API Flow:**
```
PATCH /api/requests/:id/approve
```
- **Body:** `note` (optional)
- **Response:** Status changes to `pending_accounting`

### Step 3: Accounting Review
**API Flow:**
```
PATCH /api/requests/:id/approve-accounting
```
- **Body:** `note` (optional)
- **Response:** Status changes to `pending_vp`

### Step 4: VP Viewing
**API Flow:**
```
PATCH /api/requests/:id/mark-viewed
```
- **Response:** Budget proposal marked as viewed by VP
- **Purpose:** Track VP review progress

### Step 5: VP Approval
**API Flow:**
```
PATCH /api/requests/:id/approve-vp
```
- **Body:** `note` (optional)
- **Response:** Status changes to `pending_president`

### Step 6: President Final Approval
**API Flow:**
```
PATCH /api/requests/:id/approve-president
```
- **Body:** `note` (optional)
- **Response:** Status changes to `approved`, budget categories updated with new allocations

### Step 7: Budget Lock
**API Flow:**
```
PATCH /api/budget/categories/:id/lock
```
- **Response:** Budget category locked after approval
- **Purpose:** Prevent unauthorized budget changes after approval

---

## REQUEST STATUS FLOW

### Expense Request Flow
```
pending_supervisor → pending_accounting → pending_vp → released
                    ↓                  ↓
                 rejected          pending_president
                    ↓                  ↓
         returned_for_revision         ↓
                    ↓              released
               pending_supervisor
                    ↓
                 on_hold
```

### Budget Proposal Flow
```
pending_supervisor → pending_accounting → pending_vp → pending_president → approved
                    ↓                  ↓
                 rejected          on_hold
                    ↓
         returned_for_revision
                    ↓
               pending_supervisor
```

### Cash Advance Flow
```
pending_supervisor → pending_accounting → pending_vp → released
                    ↓                  ↓
                 rejected          pending_president
                    ↓                  ↓
         returned_for_revision         ↓
                    ↓              released
               pending_supervisor
                    ↓
                 on_hold
```

### Liquidation Flow
```
submitted → pending_accounting → approved
           ↓
        rejected
           ↓
     returned
           ↓
        submitted
```

---

## SEQUENTIAL CODE GENERATION

- **Expense Requests:** REQ-00001, REQ-00002, ...
- **Cash Advances:** CA-00001, CA-00002, ...
- **Liquidations:** LIQ-00001, LIQ-00002, ...
- **Budget Proposals:** BUD-00001, BUD-00002, ...

Codes are auto-incremented per request type and reset annually based on fiscal year.
