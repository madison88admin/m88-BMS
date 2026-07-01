# M88-BMS System Overview

## Architecture

- **Frontend**: React + TypeScript + TailwindCSS + Vite (`frontend/`)
- **Backend**: Express + TypeScript + Netlify Functions (`backend/`)
- **Database**: Supabase (PostgreSQL)
- **Auth**: JWT with role-based access control (RBAC)
- **Storage**: Supabase Storage for attachments
- **Email**: Brevo SMTP for notifications
- **Real-time**: Supabase subscriptions for live updates

---

## User Roles

| Role | Purpose |
|------|---------|
| `employee` | Submits expense requests (reimbursement, cash advance) for their department |
| `manager` | Submits expense requests; higher level than employee |
| `supervisor` | Submits budget proposals/revisions; approves team requests; manages department budget matrix |
| `accounting` | Reviews and approves requests; releases funds; manages full accounting workflow |
| `accounting_limited` | Limited accounting access (cannot release funds) |
| `vp` | Approves high-value requests and budget proposals; views office-wide budget |
| `president` | Final approval for requests above VP threshold; views office-wide budget |
| `admin` | Full system access; can manage users, departments, categories, budgets |
| `super_admin` | Superuser access |

---

## Core Entities

- **Users**: system users with role, department, and fiscal year
- **Departments**: cost centers with annual budget, used budget, fiscal year
- **Budget Categories**: department-level categories with budget amounts, used, committed, remaining
- **Cost Centers**: master fund sources (e.g., M88 Manila)
- **Expense Requests**: reimbursement, cash advance, liquidation, budget_request, budget_revision
- **Request Items**: line items for multi-item requests
- **Request Allocations**: cross-department allocations for a request
- **Approval Logs**: record of approval/rejection actions
- **Audit Logs**: detailed change tracking
- **Notifications**: in-app and email notifications

---

## Request Types

### Expense Requests

| Type | Description |
|------|-------------|
| `reimbursement` | Employee requests reimbursement for expenses already paid |
| `cash_advance` | Employee requests cash advance before spending |
| `liquidation` | Liquidation of a previous cash advance |

### Budget Requests

| Type | Description |
|------|-------------|
| `budget_request` | Supervisor proposes new budget categories/amounts for a department |
| `budget_revision` | Supervisor proposes changes to already-approved budget categories |

---

## Status Values

| Status | Meaning |
|--------|---------|
| `pending_supervisor` | Waiting for supervisor approval |
| `pending_accounting` | Supervisor approved; waiting for accounting review |
| `pending_vp` | Waiting for VP approval (above threshold) |
| `pending_president` | Waiting for President approval |
| `approved` | Budget proposal/revision approved; matrix locked |
| `rejected` | Request rejected and archived |
| `released` | Funds released by accounting |
| `returned_for_revision` | Returned to submitter for revision |
| `on_hold` | Temporarily paused by accounting/VP/President |

---

## End-to-End Flows

### 1. Expense Request Flow (Reimbursement / Cash Advance)

```
Submit
  ↓
pending_supervisor
  ↓
Supervisor approves
  ↓
pending_vp OR pending_president (if amount >= threshold)
  ↓
VP / President approves
  ↓
pending_accounting
  ↓
Accounting releases funds
  ↓
released
```

**Thresholds**:
- VP handles up to PHP 500K equivalent
- President handles above PHP 500K equivalent

**What happens at each step**:
- **Submit**: Budget category is checked; committed_amount is reserved
- **Supervisor approval**: Request moves to VP/President or accounting
- **VP/President approval**: Request moves to accounting
- **Accounting release**: Funds are deducted from department budget and M88 Manila (for General Category); status becomes `released`

---

### 2. Budget Proposal Flow

```
Submit (supervisor only)
  ↓
pending_supervisor
  ↓
Supervisor approves own proposal
  ↓
pending_accounting
  ↓
Accounting reviews
  ↓
pending_vp OR pending_president (based on amount)
  ↓
VP / President approves
  ↓
approved
  ↓
Budget categories are created/updated and locked
```

**What happens at approval**:
- Budget categories are created with the proposed amounts
- Categories are locked (`is_locked = true`)
- Department annual budget is updated
- M88 Manila total budget is recalculated

---

### 3. Budget Revision Flow

```
Submit (supervisor only, after budget proposal is approved)
  ↓
pending_supervisor
  ↓
Supervisor approves
  ↓
pending_accounting
  ↓
Accounting reviews
  ↓
pending_vp OR pending_president
  ↓
VP / President approves
  ↓
approved
  ↓
Category budget amounts are updated
```

**UI for supervisors**:
- Shows both **Proposed** (current approved amount) and **Revised** (new input) amounts
- Budget Proposal section is hidden once categories are locked

---

### 4. Fund Release Flow

```
Request is pending_accounting and co-approved by VP/President
  ↓
Accounting opens release dialog
  ↓
Select release method (bank transfer, cash, petty cash, etc.)
  ↓
System checks M88 Manila balance (for General Category)
  ↓
Deducts from department category and M88 Manila
  ↓
status = released
  ↓
Email notification sent to employee
```

---

## Dual Deduction

For **General Category** requests (department = 'All'):
- Amount is deducted from both the department budget category AND the M88 Manila cost center

For regular department categories:
- Amount is deducted only from the department budget category

---

## M88 Manila General Budget

- **Total Budget**: Sum of all departments' annual budgets for the fiscal year
- **Used**: Sum of all departments' used budgets
- **Pending**: Sum of all departments' pending supervisor + accounting + VP + president totals
- **Available**: Total − Used − Pending

---

## Per-Role Dashboard Views

### Employee / Manager

- **Dashboard**: Personal expense stats, recent requests, spending by category
- **New Request**: Submit reimbursement or cash advance
- **My Requests**: List of own requests with status
- **Liquidation**: Submit liquidation for cash advances

### Supervisor

- **Dashboard**:
  - Team stats (pending, total, disbursed, pending amount)
  - Budget Utilization pie chart
  - Spending by Category bar chart
  - Monthly Spending Trends
  - Department Budget Categories breakdown
  - M88 Manila General Budget card
- **Approvals**: Team Approvals
- **Budget Management**: Submit budget proposals and revisions

### Accounting

- **Dashboard**: Same KPI cards as supervisor (plus system health for admin)
- **Approvals**: Approval page (Disbursement Hub renamed to Approval)
  - Review pending requests
  - Release funds
  - Process liquidations
  - View budget proposals/revisions
- **Budget Management**: Can override budget matrix

### VP / President

- **Dashboard**:
  - Office Budget Overview
  - Currency switcher (PHP/USD/IDR)
  - M88 Manila General Budget card
  - Department Budget Breakdown table
- **Approvals**: Approval Authority
  - Review high-value requests (VP: ≤500K, President: >500K)
  - Approve budget proposals/revisions
  - Co-approve requests before release

### Admin / Super Admin

- **Dashboard**: System-wide stats, system health, all departments
- **User Management**: Manage users and roles
- **Department Management**: Manage departments and fiscal years
- **Budget Management**: Full budget matrix control
- **Approvals**: All approvals

---

## Key UI Pages

| Page | Access | Purpose |
|------|--------|---------|
| `/` | All | Dashboard |
| `/requests` | All | View requests |
| `/requests/new` | Employee+ | Submit new request |
| `/approvals` | Supervisor, Accounting, VP, President, Admin | Approval workflows |
| `/budget` | Supervisor, Accounting, VP, President, Admin | Budget management |
| `/users` | Admin | User management |
| `/departments` | Admin | Department management |
| `/reports` | Accounting, Admin | Reports and exports |
| `/profile` | All | User profile |

---

## Notifications

Email and in-app notifications are sent for:
- New request submitted
- Request approved/rejected
- Request returned for revision
- Request released
- Budget proposal submitted/approved
- Budget utilization warnings

---

## Audit Logging

Every significant action is logged:
- Who performed the action
- What record was affected
- Old and new values
- Remarks

---

## Multi-Currency Support

- Backend converts amounts to PHP base for budget calculations
- Frontend can display amounts in PHP, USD, or IDR using live exchange rates
- Exchange rates are cached with fallback rates

---

## Approval Thresholds

- Expense requests: PHP 500K equivalent
- Budget proposals: PHP 500K equivalent
- Above threshold goes to President; at or below goes to VP
