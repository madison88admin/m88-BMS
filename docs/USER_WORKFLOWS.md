# Budget Management System - User Workflows

## User Roles

1. **Employee** - Regular staff who submit expense requests
2. **Manager** - Department managers who submit expense requests
3. **Supervisor** - Team supervisors who approve team requests
4. **VP (Vice President)** - Executive who approves high-value requests
5. **President** - Final approver for high-value requests
6. **Accounting** - Finance team who disburse funds and manage budgets
7. **Accounting Limited** - Restricted accounting access
8. **Admin** - System administrator
9. **Super Admin** - Full system administrator

## Navigation by Role

### Employee / Manager
- Overview (EmployeeHome)
- New Expense (NewRequestForm)
- Document Uploads (DocumentUploads)
- My History (RequestTracker)
- Settings (Profile)

### Supervisor
- Overview (Dashboard)
- New Expense (NewRequestForm)
- Document Uploads (DocumentUploads)
- My History (RequestTracker)
- Team Approvals (Approvals)
- Budget Matrix (BudgetManagement)
- Settings (Profile)

### VP / President
- Overview (Dashboard)
- New Expense (NewRequestForm)
- Document Uploads (DocumentUploads)
- My History (RequestTracker)
- Approval Authority (Approvals)
- Budget View (BudgetManagement)
- Settings (Profile)

### Accounting
- Overview (AccountingDashboard)
- New Expense (NewRequestForm)
- Document Uploads (DocumentUploads)
- My History (RequestTracker)
- Fund Disbursements (Approvals)
- Budget Matrix (BudgetManagement)

### Admin
- Admin Overview (Admin)
- Budget Setup (BudgetSetup)
- Accounting (AccountingDashboard)
- Reports (Reports)

## Main Workflows

### 1. Expense Request Workflow

#### Steps:
1. **Submit Request** (Employee/Manager/Supervisor/VP/President/Accounting)
   - Navigate to "New Expense"
   - Select request type (Reimbursement, Cash Advance, Liquidation)
   - Fill in details (amount, category, purpose, attachments)
   - Submit request

2. **Budget Validation**
   - System checks category budget (main or sub-category)
   - Validates against remaining_amount in budget_categories table
   - Rejects if insufficient budget

3. **Supervisor Approval** (if applicable)
   - Supervisor reviews request in "Team Approvals"
   - Can approve, reject, or return for revision
   - Status changes to: pending_accounting (approved) or returned

4. **Accounting Review** (if applicable)
   - Accounting reviews in "Fund Disbursements"
   - Can approve, reject, or return for revision
   - Status changes to: pending_vp (if high value) or approved

5. **VP Approval** (if high value, >= threshold)
   - VP reviews in "Approval Authority"
   - Can approve or forward to President
   - Status changes to: pending_president or approved

6. **President Approval** (if very high value)
   - President reviews in "Approval Authority"
   - Final approval authority
   - Status changes to: approved

7. **Fund Disbursement**
   - Accounting releases funds
   - Budget deducted from category (used_amount increases, remaining_amount decreases)
   - Request status changes to: released

### 2. Budget Management Workflow

#### Setup (Admin only):
1. Navigate to "Budget Setup"
2. Create departments and fiscal years
3. Set department annual budgets
4. Create budget categories (main and sub-categories)
5. Assign budget amounts to categories

#### Management (Accounting/Supervisor):
1. Navigate to "Budget Matrix"
2. Select department and fiscal year
3. View category breakdown (main and sub-categories)
4. Edit category budgets
5. Lock/unlock categories
6. View budget utilization

### 3. Cash Advance Workflow

#### Steps:
1. **Request Cash Advance** (Employee/Manager)
   - Submit cash advance request
   - Specify amount and purpose
   - Supervisor approval required

2. **Approval**
   - Supervisor approves cash advance
   - Accounting disburses cash

3. **Liquidation**
   - Employee uses cash advance
   - Submits liquidation request with receipts
   - Accounting reviews and approves liquidation
   - Remaining balance returned or additional funds requested

### 4. Document Upload Workflow

#### Steps:
1. **Upload Documents** (All roles)
   - Navigate to "Document Uploads"
   - Upload supporting documents
   - Categorize documents
   - Documents available for reference

### 5. Budget Proposal/Revision Workflow

#### Steps:
1. **Submit Budget Proposal** (Supervisor/Accounting)
   - Submit proposed budget amounts for categories
   - Justification required
   - Status: pending_supervisor

2. **Supervisor Review**
   - Supervisor reviews proposal
   - Can approve or return for revision
   - Status: pending_accounting

3. **Accounting Review**
   - Accounting reviews proposal
   - Can approve or return for revision
   - Status: pending_vp (if high value) or approved

4. **VP/President Approval** (if high value)
   - Executive review and approval
   - Status: approved

5. **Budget Implementation**
   - Approved budget amounts applied to categories
   - Department annual_budget updated
   - Budget becomes active

## Budget Validation & Deduction

### Validation (on submit):
- Checks category budget (main or sub-category)
- Validates against remaining_amount
- Does NOT check department annual budget

### Deduction (on approval/release):
- Deducts from category budget (main or sub-category)
- Updates used_amount and remaining_amount in budget_categories
- Does NOT deduct from department annual budget

### Sub-category Support:
- Sub-categories have their own budgets
- Validation checks sub-category budget when sub-category selected
- Deduction happens from sub-category budget when sub-category selected
- Parent category budget not affected by sub-category transactions

## Access Control

### Department Access:
- Employee/Manager: Own department only
- Supervisor: Own department only
- Accounting: All departments (full accounting) or restricted (accounting_limited)
- VP/President: All departments
- Admin/Super Admin: All departments

### Data Visibility:
- Employee/Manager: Own requests only
- Supervisor: Team requests (department)
- Accounting: All requests (full) or restricted
- VP/President: All requests
- Admin/Super Admin: All data

## Status Flow

### Expense Requests:
- pending_supervisor → pending_accounting → pending_vp → pending_president → approved → released
- Can be returned to: returned_by_supervisor, returned_by_accounting
- Can be rejected: rejected

### Budget Proposals:
- pending_supervisor → pending_accounting → pending_vp → pending_president → approved
- Can be returned: returned_by_supervisor, returned_by_accounting

### Cash Advances:
- pending_supervisor → approved → liquidated
