# Madison88 BMS: End-to-End System Audit & Cross-Checking Report

This comprehensive audit report provides a complete, structured verification and cross-checking analysis of the **Madison88 Budget Management System (BMS)** user workflows, roles, API behaviors, database state synchronization, and permission models.

---

## 1. Executive Summary

A complete, systematic code and logic audit has been performed across all core route handlers (`auth.ts`, `requests.ts`, `cashAdvances.ts`, `budget.ts`, `departments.ts`), netlify functions, and database schema definitions. 

### Key Audit Findings:
- **Permission Boundary Alignment**: Role-based access gates (`employee`, `manager`, `supervisor`, `accounting`, `vp`, `president`, `admin`) are strictly enforced at the API routing layer using dedicated middleware (`authenticate` and `authorize`). Non-permitted actions result in proper `403 Forbidden` responses.
- **Audit Compliance & Data Integrity**: Financial transactions and requests are protected from hard-deletions through foreign key constraints referencing historical audit tables. Safe error interceptors have been successfully deployed in both the TypeScript production backend and local-dev-server to prevent database-leaking SQL constraints from displaying on the UI.
- **Budget Commitment Integrity**: Budget category allocations and commitments are logically deferred to the **Accounting finalization stage** (allocations splits). This ensures category deductions are split accurately before funds are locked, protecting multi-department cost center pools.
- **Executive Co-Approval Limits**: Multi-currency thresholds (PHP, USD, IDR) are dynamically handled at the **500,000 unit limit**, ensuring dual-authorization flows between VP and President roles.

---

## 2. E2E Role Scope & Permissions Matrix

This matrix summarizes the capabilities, view boundaries, and operational constraints for each role in the system:

| Role | Visibility Scope (GET) | Request Action Gates | Approval & Hold Gates | Disbursement & Release Gates |
| :--- | :--- | :--- | :--- | :--- |
| **Employee** | Own requests only (`employee_id = id`) | Create, resubmit, submit liquidation | None | None |
| **Manager** | Own requests only (`employee_id = id`) | Create, resubmit, submit liquidation | None | None |
| **Supervisor** | Assigned department scope (via `getAccessibleDepartmentIdsForUser`) | Resubmit request (for employee) | Approve request, return for revision, reject, update priority/urgency | None (Self-approval blocked) |
| **Accounting** | All departments & fiscal years | Resubmit, edit allocations splits, verify liquidations | Toggle `on_hold` status, return for revision, reject | Release disbursements (Requires Co-approval, blocked by `on_hold`) |
| **VP (Vice President)** | Executive-level read-all | None | Toggle `on_hold`, return, reject, **Co-approve up to 500k** (PHP/USD/IDR) | Blocked from direct disbursement releases |
| **President**| Executive-level read-all | None | Toggle `on_hold`, return, reject, **Co-approve any amount** | Blocked from direct disbursement releases |
| **Admin / Super Admin** | Console-level read-all | Manage users console, delete users | Override/co-approve, toggle hold status | Override release disbursements, archiver |

---

## 3. Core Workflow Deep-Dive & Logic Verification

### 3.1 Request Creation & Budget Check Flow
- **Endpoint**: `POST /api/requests`
- **Permissions**: `employee`, `manager`, `supervisor`, `accounting`
- **Validation Actions**:
  - **Department Integrity**: Non-accounting users are restricted to their own department. Accounting can specify target departments.
  - **Expense List Checks**: Automatically validates items against the canonical department list (`validateExpense`). Prevents non-reimburseable or non-CA expenses from being submitted.
  - **Double Budget Check**: Validates that request amount is smaller than `Math.min(Department Remaining Budget, Category Remaining Budget)`. This prevents concurrent over-drafts on category cost pools.
  - **Deferred Commitment**: The request is created in `pending_supervisor` (or `pending_accounting` if created by supervisor/accounting) without allocating budget categories immediately. Commitment occurs once department splits are set.

### 3.2 Supervisor Approval & Self-Approval Prevention
- **Endpoint**: `PATCH /api/requests/:id/approve`
- **Permissions**: `supervisor`, `admin`
- **Validation Actions**:
  - **Scope Check**: Asserts that `request.department_id` belongs to the supervisor's active year department boundaries (`getAccessibleDepartmentIdsForUser`).
  - **Self-Approval Guard**: Prevents supervisors from approving tickets where they are the `employee_id`. Throws `403 You cannot approve your own request`.
  - **Return & Reject Budget Rollbacks** (`/return` and `/reject`): Successfully reverses any allocated category committed balances. Deducts from `committed_amount` and adds back to `remaining_amount` inside `budget_categories` before status moves to `returned_for_revision` or `rejected`.

### 3.3 VP & President Dual Authorization
- **Endpoint**: `POST /api/requests/:id/co-approve`
- **Permissions**: `vp`, `president`, `admin`
- **Validation Actions**:
  - **Currency-Specific Thresholds**: Automatically pulls currency from request metadata (defaults to `PHP`). Set limits are **500,000** for each currency (`PHP`, `USD`, `IDR`).
  - **VP Limit**: Blocked if `amount > 500,000` in request's currency. Throws `403 President approval required`.
  - **President Gate**: Bypasses all upper threshold limits, co-approving any amount.
  - **Status Guard**: Only co-approves requests in `pending_accounting` status. Blocks co-approval if `co_approved_by` is already populated.

### 3.4 Accounting Allocation & Disbursement Release
- **Endpoints**: `PATCH /:id/allocations` (splits), `PATCH /:id/release` (disburse)
- **Permissions**: `accounting`, `admin`
- **Validation Actions**:
  - **Allocation Splits**: Accounting must specify splits that sum exactly to the request amount. Newly allocated departments' categories are verified for budget availability before allocations are saved.
  - **Hold Gate**: Releases are blocked if request status is `on_hold` (toggled via `/hold`).
  - **Co-Approval Guard**: Releases are strictly blocked if `request.co_approved_by` is null. Prevents manual releasing without VP/President co-approvals.
  - **Disbursement Release Hook**: Decreases `committed_amount` and increases `used_amount` in categories, updates `used_budget` in departments, and deducts from `petty_cash_balance` if petty cash disbursement is chosen.

### 3.5 Cash Advances & Liquidations Workflow
- **Endpoints**: `POST /api/cash-advances` (issue), `POST /:id/liquidate` (liquidate), `PATCH /:id/liquidation/review` (accounting review)
- **Permissions**: `accounting` to issue/review, `employee` to liquidate
- **Validation Actions**:
  - **Issue Guard**: Prevents duplicate cash advances for the same request code.
  - **Balance Math**: Calculates reimbursable and return cash balances mathematically using:
    - `reimbursable_amount = Math.max(Spent - Issued, 0)` (Excess spent is owed to employee).
    - `cash_return_amount = Math.max(Issued - Spent, 0)` (Unspent balance must be returned to cashier).
  - **DB Triggers**: Triggers automatically recalculate the outstanding balances and status (`fully_liquidated`, `partially_liquidated`, `outstanding`) on every liquidation line insert, update, or delete.
  - **Verification Gate**: Accounting reviews liquidations. If `verified`, cash advance status transitions to `fully_liquidated` or `partially_liquidated`. If `returned` (rejected by accounting), status reverts to `outstanding`.

---

## 4. Verification Checklists & Status

All audited flows are verified against their code implementations and database triggers:

- **E2E Access Scopes**: Verified. Scope boundaries are correct.
- **Budget Category Locking**: Verified. Rolled back correctly on return/reject.
- **VP/President limits**: Verified. Strictly currency-bounded and threshold-locked.
- **Cash Advance Triggers**: Verified. Balance updates are transactionally safe via PL/pgSQL database triggers.
- **TypeScript Compilation**: Clean. Compiles with zero compilation or type warnings.

---

### Audit Certificate

This system audit confirms that the Madison88 Budget Management System's business logic, role divisions, and database constraints are robustly implemented, secure, and compliant with standard financial auditing practices.
